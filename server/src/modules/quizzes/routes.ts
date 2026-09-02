import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { badRequest, notFound } from '../../core/errors.js';
import { rateLimit } from '../../core/rateLimit.js';
import { query } from '../../db/pool.js';
import { requireAuth } from '../../plugins/auth.js';
import { registry } from '../questions/engine/registry.js';
import { answerQuestion, getAttemptReview, startAttempt, submitAttempt, usePowerup } from './attempts.js';
import { ensureDailyQuiz } from './daily.js';

const startSchema = z.object({
  mode: z
    .enum(['practice', 'timed', 'speed', 'survival', 'knowledge', 'daily', 'bookmarks', 'challenge', 'competitive', 'random', 'category', 'difficulty', 'review'])
    .default('practice'),
  categoryId: z.string().uuid().nullish(),
  difficulty: z.enum(['easy', 'medium', 'hard', 'expert']).nullish(),
  language: z.enum(['ar', 'en']).nullish(),
  questionCount: z.number().int().min(1).max(100).optional(),
  types: z.array(z.string()).max(20).optional(),
});

export async function quizRoutes(app: FastifyInstance): Promise<void> {
  const startLimiter = rateLimit({ max: 20, keyPrefix: 'quiz-start' });
  const answerLimiter = rateLimit({ max: 300, keyPrefix: 'quiz-answer' });

  /** Supported question types (for clients & admin editors). */
  app.get('/question-types', async () => ({
    types: registry.listTypes().map((t) => ({
      id: t.id,
      family: t.family,
      scored: t.scored,
      manualReview: t.manualReview,
      media: t.media,
    })),
  }));

  app.post('/start', { preHandler: [requireAuth, startLimiter] }, async (req) => {
    const parsed = startSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw badRequest('Invalid quiz options', parsed.error.issues);
    const opts = parsed.data;
    if (opts.mode === 'daily') {
      // question of the day: one shared set per date — everyone competes equally
      const daily = await ensureDailyQuiz();
      if (!daily) throw badRequest('No questions available for today');
      return startAttempt(req.userId!, req.isGuest, {
        mode: 'daily',
        contextType: 'daily',
        contextId: daily.id,
        fixedQuestionIds: daily.questionIds,
      });
    }
    if (opts.mode === 'bookmarks') {
      const saved = await query<{ question_id: string }>(
        `SELECT b.question_id FROM question_bookmarks b JOIN questions q ON q.id = b.question_id
         WHERE b.user_id = $1 AND q.status = 'approved' ORDER BY b.created_at DESC LIMIT $2`,
        [req.userId, opts.questionCount ?? 10],
      );
      if (saved.rows.length === 0) throw badRequest('No bookmarked questions yet');
      return startAttempt(req.userId!, req.isGuest, { ...opts, mode: 'practice', fixedQuestionIds: saved.rows.map((r) => r.question_id) });
    }
    return startAttempt(req.userId!, req.isGuest, opts);
  });

  /** Bookmarks — save a question to study later (Quizlet-style). */
  app.get('/bookmarks', { preHandler: [requireAuth] }, async (req) => {
    const { rows } = await query(
      `SELECT q.id, q.type, q.difficulty, q.content->'prompt' AS prompt, b.created_at
       FROM question_bookmarks b JOIN questions q ON q.id = b.question_id
       WHERE b.user_id = $1 ORDER BY b.created_at DESC LIMIT 200`,
      [req.userId],
    );
    return { bookmarks: rows };
  });
  app.post('/bookmarks/:questionId', { preHandler: [requireAuth] }, async (req) => {
    const { questionId } = req.params as { questionId: string };
    if (!z.string().uuid().safeParse(questionId).success) throw badRequest('Invalid question id');
    await query(
      `INSERT INTO question_bookmarks (user_id, question_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [req.userId, questionId],
    );
    return { ok: true, bookmarked: true };
  });
  app.delete('/bookmarks/:questionId', { preHandler: [requireAuth] }, async (req) => {
    const { questionId } = req.params as { questionId: string };
    await query(`DELETE FROM question_bookmarks WHERE user_id = $1 AND question_id = $2`, [req.userId, questionId]);
    return { ok: true, bookmarked: false };
  });

  /** Today's shared quiz status (played or not) + today's board key. */
  app.get('/daily', { preHandler: [requireAuth] }, async (req) => {
    const daily = await ensureDailyQuiz();
    if (!daily) return { available: false };
    const mine = await query(
      `SELECT id, status, score FROM attempts
       WHERE user_id = $1 AND context_type = 'daily' AND context_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [req.userId, daily.id],
    );
    return {
      available: true,
      day: daily.day,
      questionCount: daily.questionIds.length,
      myAttempt: mine.rows[0] ?? null,
    };
  });

  /** Server-side power-ups: 50/50 and time extension. */
  app.post('/attempts/:id/powerups', { preHandler: [requireAuth, answerLimiter] }, async (req) => {
    const { id } = req.params as { id: string };
    const parsed = z
      .object({ kind: z.enum(['fifty_fifty', 'time_extend', 'audience']), questionId: z.string().uuid() })
      .safeParse(req.body);
    if (!parsed.success) throw badRequest('Invalid power-up request', parsed.error.issues);
    return usePowerup(id, req.userId!, parsed.data.questionId, parsed.data.kind);
  });

  /** Active admin-curated (scheduled) quizzes. */
  app.get('/scheduled', async () => {
    const { rows } = await query(
      `SELECT id, title, mode, difficulty, question_count, time_limit_sec, starts_at, ends_at
       FROM quizzes
       WHERE status = 'active'
         AND (starts_at IS NULL OR starts_at <= now())
         AND (ends_at IS NULL OR ends_at > now())
       ORDER BY created_at DESC LIMIT 20`,
    );
    return { quizzes: rows };
  });

  /** Play an admin-curated quiz (fixed identical question set). */
  app.post('/:quizId/start', { preHandler: [requireAuth, startLimiter] }, async (req) => {
    const { quizId } = req.params as { quizId: string };
    const { rows } = await query('SELECT * FROM quizzes WHERE id = $1', [quizId]);
    const quiz = rows[0];
    if (!quiz) throw notFound('Quiz not found');
    if (quiz.status !== 'active') throw badRequest('Quiz is not active');
    if (quiz.starts_at && new Date(quiz.starts_at).getTime() > Date.now()) throw badRequest('Quiz has not started yet');
    if (quiz.ends_at && new Date(quiz.ends_at).getTime() < Date.now()) throw badRequest('Quiz has ended');
    const started = await startAttempt(req.userId!, req.isGuest, {
      mode: quiz.mode,
      fixedQuestionIds: quiz.question_ids,
      overallTimeLimitSec: quiz.time_limit_sec,
    });
    await query('UPDATE attempts SET quiz_id = $2 WHERE id = $1', [started.attemptId, quizId]);
    return started;
  });

  app.post('/attempts/:id/answers', { preHandler: [requireAuth, answerLimiter] }, async (req) => {
    const { id } = req.params as { id: string };
    const schema = z.object({ questionId: z.string().uuid(), answer: z.unknown() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Invalid answer payload', parsed.error.issues);
    return answerQuestion(id, req.userId!, parsed.data.questionId, parsed.data.answer);
  });

  app.post('/attempts/:id/submit', { preHandler: [requireAuth] }, async (req) => {
    const { id } = req.params as { id: string };
    return submitAttempt(id, req.userId!);
  });

  app.get('/attempts/:id/review', { preHandler: [requireAuth] }, async (req) => {
    const { id } = req.params as { id: string };
    return getAttemptReview(id, req.userId!);
  });

  /** Resume data for an in-progress attempt (network-recovery support). */
  app.get('/attempts/:id', { preHandler: [requireAuth] }, async (req) => {
    const { id } = req.params as { id: string };
    const { rows } = await query(
      `SELECT a.id, a.status, a.mode, a.question_ids, a.question_meta, a.started_at, a.deadline_at,
              a.score, a.max_score
       FROM attempts a WHERE a.id = $1 AND a.user_id = $2`,
      [id, req.userId],
    );
    const a = rows[0];
    if (!a) throw notFound('Attempt not found');
    const answered = await query('SELECT question_id, outcome, score FROM attempt_answers WHERE attempt_id = $1', [id]);
    return {
      attempt: {
        id: a.id,
        status: a.status,
        mode: a.mode,
        questionIds: a.question_ids,
        startedAt: a.started_at,
        deadlineAt: a.deadline_at,
        score: a.score,
        maxScore: a.max_score,
      },
      answered: answered.rows.map((r) => ({ questionId: r.question_id, outcome: r.outcome, score: r.score })),
    };
  });

  /** Recent results for the current user. */
  app.get('/attempts', { preHandler: [requireAuth] }, async (req) => {
    const q = req.query as { limit?: string; offset?: string };
    const limit = Math.min(Number(q.limit ?? 20), 100);
    const offset = Math.max(Number(q.offset ?? 0), 0);
    const { rows } = await query(
      `SELECT id, mode, context_type, status, score, max_score, correct_count, incorrect_count,
              timeout_count, skipped_count, started_at, submitted_at, server_duration_ms
       FROM attempts WHERE user_id = $1 AND status <> 'in_progress'
       ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [req.userId, limit, offset],
    );
    return { attempts: rows };
  });
}
