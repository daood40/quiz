import type { FastifyInstance } from 'fastify';
import { badRequest, conflict, notFound } from '../../core/errors.js';
import { query } from '../../db/pool.js';
import { requireAccount } from '../../plugins/auth.js';
import { fetchLeaderboard } from '../leaderboards/routes.js';
import { startAttempt } from '../quizzes/attempts.js';
import { pickQuestions } from '../quizzes/pool.js';

export function currentYearMonth(now: Date = new Date()): string {
  return now.toISOString().slice(0, 7);
}

/**
 * Ensures the monthly challenge for the given month exists (idempotent).
 * Called by the background scheduler at month rollover and lazily on access.
 */
export async function ensureMonthlyChallenge(yearMonth: string = currentYearMonth()): Promise<string | null> {
  const existing = await query('SELECT id FROM monthly_challenges WHERE year_month = $1', [yearMonth]);
  if (existing.rows[0]) return existing.rows[0].id;

  const picked = await pickQuestions({ count: 20 });
  if (picked.length === 0) return null; // no approved questions yet

  const [y, m] = yearMonth.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1)); // exclusive
  const { rows } = await query(
    `INSERT INTO monthly_challenges (year_month, title, question_ids, rules, rewards, starts_at, ends_at, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'active')
     ON CONFLICT (year_month) DO NOTHING
     RETURNING id`,
    [
      yearMonth,
      JSON.stringify({ en: `Monthly Challenge ${yearMonth}`, ar: `التحدي الشهري ${yearMonth}` }),
      picked.map((p) => p.id),
      JSON.stringify({ attemptsPerUser: 1 }),
      JSON.stringify({ xpBonus: true }),
      start.toISOString(),
      end.toISOString(),
    ],
  );
  return rows[0]?.id ?? (await query('SELECT id FROM monthly_challenges WHERE year_month = $1', [yearMonth])).rows[0]?.id ?? null;
}

/** Ends past-due monthly challenges (scheduler). */
export async function closeEndedMonthlyChallenges(): Promise<number> {
  const { rowCount } = await query(
    `UPDATE monthly_challenges SET status = 'ended' WHERE status = 'active' AND ends_at <= now()`,
  );
  return rowCount ?? 0;
}

export async function monthlyRoutes(app: FastifyInstance): Promise<void> {
  app.get('/current', async (req) => {
    const id = await ensureMonthlyChallenge();
    if (!id) throw notFound('No monthly challenge available yet');
    const { rows } = await query('SELECT * FROM monthly_challenges WHERE id = $1', [id]);
    const mc = rows[0];
    const { entries, me } = await fetchLeaderboard('monthly_challenge', id, 100, req.userId);
    let myStatus: string | null = null;
    if (req.userId) {
      const attempt = await query(
        `SELECT status FROM attempts WHERE user_id = $1 AND context_type = 'monthly' AND context_id = $2
         ORDER BY created_at DESC LIMIT 1`,
        [req.userId, id],
      );
      myStatus = attempt.rows[0]?.status ?? null;
    }
    return {
      monthlyChallenge: {
        id: mc.id,
        yearMonth: mc.year_month,
        title: mc.title,
        questionCount: mc.question_ids.length,
        rules: mc.rules,
        rewards: mc.rewards,
        startsAt: mc.starts_at,
        endsAt: mc.ends_at,
        status: mc.status,
      },
      leaderboard: entries,
      me,
      myStatus,
    };
  });

  app.post('/current/start', { preHandler: [requireAccount] }, async (req) => {
    const id = await ensureMonthlyChallenge();
    if (!id) throw notFound('No monthly challenge available yet');
    const { rows } = await query('SELECT * FROM monthly_challenges WHERE id = $1', [id]);
    const mc = rows[0];
    if (mc.status !== 'active') throw conflict('Monthly challenge has ended');
    if (new Date(mc.ends_at).getTime() < Date.now()) throw conflict('Monthly challenge has ended');
    const prior = await query(
      `SELECT 1 FROM attempts WHERE user_id = $1 AND context_type = 'monthly' AND context_id = $2
       AND status IN ('in_progress','submitted')`,
      [req.userId, id],
    );
    if (prior.rowCount) throw conflict('You already participated this month');
    return startAttempt(req.userId!, false, {
      mode: 'monthly',
      contextType: 'monthly',
      contextId: id,
      fixedQuestionIds: mc.question_ids,
    });
  });

  app.get('/history', async () => {
    const { rows } = await query(
      `SELECT id, year_month, title, status, starts_at, ends_at,
              cardinality(question_ids) AS question_count
       FROM monthly_challenges ORDER BY year_month DESC LIMIT 24`,
    );
    return { months: rows };
  });

  app.get('/:id/leaderboard', async (req) => {
    const { id } = req.params as { id: string };
    const q = req.query as { limit?: string };
    const exists = await query('SELECT 1 FROM monthly_challenges WHERE id = $1', [id]);
    if (!exists.rowCount) throw badRequest('Unknown monthly challenge');
    const { entries, me } = await fetchLeaderboard('monthly_challenge', id, Math.min(Number(q.limit ?? 100), 500), req.userId);
    return { entries, me };
  });
}
