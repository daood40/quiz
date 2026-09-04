import { reportError } from '../core/alerts.js';
import { log } from '../core/log.js';
import { jobRuns } from '../core/metrics.js';
import { pool, query } from '../db/pool.js';
import { expireStaleAttempts } from '../modules/quizzes/attempts.js';
import { closeEndedMonthlyChallenges, ensureMonthlyChallenge } from '../modules/monthly/service.js';
import { recomputeQuality } from '../modules/questions/service.js';

/**
 * Background jobs — lightweight in-process scheduler.
 * Heavy multi-instance deployments should move these to a dedicated worker
 * (see docs/DEPLOYMENT.md); the functions are already isolated for that.
 */
const timers: NodeJS.Timeout[] = [];
const inFlight = new Set<string>();

/** Runs one job tick: cluster-wide advisory lock (no double runs), overlap guard, telemetry row. */
export async function runJob(name: string, fn: () => Promise<unknown>): Promise<'ok' | 'error' | 'skipped'> {
  if (inFlight.has(name)) return 'skipped';
  inFlight.add(name);
  const client = await pool.connect();
  try {
    const lock = await client.query<{ ok: boolean }>('SELECT pg_try_advisory_lock(hashtext($1)) AS ok', [`job:${name}`]);
    if (!lock.rows[0]?.ok) return 'skipped';
    await query(
      `INSERT INTO job_runs (name, last_started_at, last_status, runs) VALUES ($1, now(), 'running', 1)
       ON CONFLICT (name) DO UPDATE SET last_started_at = now(), last_status = 'running', runs = job_runs.runs + 1`,
      [name],
    );
    try {
      await fn();
      await query(`UPDATE job_runs SET last_finished_at = now(), last_status = 'ok', last_error = NULL WHERE name = $1`, [name]);
      jobRuns.inc({ job: name, status: 'ok' });
      return 'ok';
    } catch (err) {
      const message = (err as Error).message;
      log.error({ job: name, err }, 'background job failed');
      jobRuns.inc({ job: name, status: 'error' });
      reportError(err, { kind: 'job_failed', job: name });
      await query(
        `UPDATE job_runs SET last_finished_at = now(), last_status = 'error', last_error = $2, failures = failures + 1 WHERE name = $1`,
        [name, message.slice(0, 2000)],
      ).catch(() => undefined);
      return 'error';
    } finally {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [`job:${name}`]).catch(() => undefined);
    }
  } finally {
    client.release();
    inFlight.delete(name);
  }
}

function every(ms: number, name: string, fn: () => Promise<unknown>): void {
  const t = setInterval(() => {
    void runJob(name, fn).catch((err) => log.error({ job: name, err }, 'job runner failed'));
  }, ms);
  t.unref();
  timers.push(t);
}

export function startJobs(): void {
  // monthly challenge rollover + closing (also lazily ensured on access)
  every(10 * 60 * 1000, 'monthly-rollover', async () => {
    await closeEndedMonthlyChallenges();
    await ensureMonthlyChallenge();
  });

  // expire abandoned attempts
  every(5 * 60 * 1000, 'expire-attempts', () => expireStaleAttempts());

  // challenge expiry
  every(10 * 60 * 1000, 'expire-challenges', () =>
    query(`UPDATE challenges SET status = 'expired' WHERE status IN ('open','active') AND expires_at < now()`),
  );

  // rolling question-quality recompute (50 stalest at a time)
  every(15 * 60 * 1000, 'question-quality', async () => {
    const { rows } = await query(
      `SELECT s.question_id FROM question_stats s
       WHERE s.attempts >= 5 ORDER BY s.quality_computed_at ASC NULLS FIRST LIMIT 50`,
    );
    for (const r of rows) {
      await recomputeQuality(r.question_id);
      await query('UPDATE question_stats SET quality_computed_at = now() WHERE question_id = $1', [r.question_id]);
    }
  });

  // retention: stale guest accounts (never played), old audit/analytics rows
  every(6 * 60 * 60 * 1000, 'retention', async () => {
    await query(
      `DELETE FROM users u WHERE u.is_guest = true AND u.created_at < now() - interval '30 days'
         AND NOT EXISTS (SELECT 1 FROM attempts a WHERE a.user_id = u.id AND a.status = 'submitted')`,
    );
    await query(`DELETE FROM analytics_events WHERE created_at < now() - interval '180 days'`);
    await query(`DELETE FROM audit_logs WHERE created_at < now() - interval '400 days'`);
  });

  // leaderboard snapshot freshness for hot boards
  every(60 * 1000, 'leaderboard-snapshots', async () => {
    await query(`DELETE FROM leaderboard_snapshots WHERE computed_at < now() - interval '1 day'`);
  });

  // streak reminder notifications (users about to lose a streak, inactive ~20h)
  every(60 * 60 * 1000, 'streak-reminders', async () => {
    await query(
      `INSERT INTO notifications (user_id, kind, title, body, data)
       SELECT u.id, 'streak_reminder',
              '{"en":"Your streak is at risk!","ar":"سلسلتك في خطر!"}'::jsonb,
              '{"en":"Play a quiz today to keep your streak.","ar":"العب اختبارًا اليوم للحفاظ على سلسلتك."}'::jsonb,
              jsonb_build_object('streak', u.current_streak)
       FROM users u
       WHERE u.status = 'active' AND u.current_streak >= 2
         AND u.last_activity_date = current_date - 1
         AND NOT EXISTS (
           SELECT 1 FROM notifications n
           WHERE n.user_id = u.id AND n.kind = 'streak_reminder' AND n.created_at > now() - interval '20 hours')`,
    );
  });
}

export function stopJobs(): void {
  for (const t of timers) clearInterval(t);
  timers.length = 0;
}
