import { query } from '../db/pool.js';
import { expireStaleAttempts } from '../modules/quizzes/attempts.js';
import { closeEndedMonthlyChallenges, ensureMonthlyChallenge } from '../modules/monthly/service.js';
import { recomputeQuality } from '../modules/questions/service.js';

/**
 * Background jobs — lightweight in-process scheduler.
 * Heavy multi-instance deployments should move these to a dedicated worker
 * (see docs/DEPLOYMENT.md); the functions are already isolated for that.
 */
const timers: NodeJS.Timeout[] = [];

function every(ms: number, name: string, fn: () => Promise<unknown>): void {
  const t = setInterval(() => {
    fn().catch((err) => console.error(`job ${name} failed:`, err.message));
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
       WHERE s.attempts >= 5 ORDER BY s.updated_at DESC LIMIT 50`,
    );
    for (const r of rows) await recomputeQuality(r.question_id).catch(() => undefined);
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
