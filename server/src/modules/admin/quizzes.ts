import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../../core/audit.js';
import { badRequest, notFound } from '../../core/errors.js';
import { query } from '../../db/pool.js';
import { requireRole } from '../../plugins/auth.js';
import { pickQuestions } from '../quizzes/pool.js';

const quizSchema = z.object({
  title: z.record(z.string()).default({}),
  mode: z.enum(['practice', 'timed', 'daily', 'competitive', 'custom']).default('custom'),
  categoryId: z.string().uuid().nullish(),
  difficulty: z.enum(['easy', 'medium', 'hard', 'expert']).nullish(),
  questionCount: z.number().int().min(1).max(200).default(10),
  questionIds: z.array(z.string().uuid()).max(200).optional(),
  rules: z.record(z.unknown()).default({}),
  timeLimitSec: z.number().int().min(30).max(14400).nullish(),
  startsAt: z.string().datetime().nullish(),
  endsAt: z.string().datetime().nullish(),
});

/** Admin quiz management — scheduled/curated quizzes users can play. */
export async function adminQuizRoutes(app: FastifyInstance): Promise<void> {
  const admin = requireRole('admin');

  app.get('/', { preHandler: [requireRole('moderator')] }, async (req) => {
    const q = req.query as Record<string, string>;
    const limit = Math.min(Number(q.limit ?? 25), 100);
    const offset = Math.max(Number(q.offset ?? 0), 0);
    const { rows } = await query(
      `SELECT id, title, mode, category_id, difficulty, question_count,
              cardinality(question_ids) AS fixed_questions, status, starts_at, ends_at, created_at,
              (SELECT count(*) FROM attempts a WHERE a.quiz_id = quizzes.id) AS attempts
       FROM quizzes ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    const total = await query('SELECT count(*) AS n FROM quizzes');
    return { total: Number(total.rows[0].n), quizzes: rows };
  });

  app.post('/', { preHandler: [admin] }, async (req) => {
    const parsed = quizSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw badRequest('Invalid quiz', parsed.error.issues);
    const input = parsed.data;
    let questionIds = input.questionIds ?? [];
    if (questionIds.length === 0) {
      // curate a fixed set now so every player gets identical questions
      const picked = await pickQuestions({
        categoryId: input.categoryId,
        difficulty: input.difficulty,
        count: input.questionCount,
      });
      if (picked.length === 0) throw badRequest('No approved questions match the filters');
      questionIds = picked.map((p) => p.id);
    } else {
      const found = await query(`SELECT count(*) AS n FROM questions WHERE id = ANY($1::uuid[]) AND status = 'approved'`, [questionIds]);
      if (Number(found.rows[0].n) !== questionIds.length) throw badRequest('All questions must exist and be approved');
    }
    const { rows } = await query(
      `INSERT INTO quizzes (title, mode, category_id, difficulty, question_count, question_ids,
         rules, time_limit_sec, starts_at, ends_at, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'draft',$11) RETURNING id`,
      [
        JSON.stringify(input.title), input.mode, input.categoryId ?? null, input.difficulty ?? null,
        questionIds.length, questionIds, JSON.stringify(input.rules), input.timeLimitSec ?? null,
        input.startsAt ?? null, input.endsAt ?? null, req.userId,
      ],
    );
    audit(req.userId, 'admin.quiz.created', 'quiz', rows[0].id);
    return { id: rows[0].id, questionCount: questionIds.length };
  });

  app.post('/:id/status', { preHandler: [admin] }, async (req) => {
    const { id } = req.params as { id: string };
    const parsed = z.object({ status: z.enum(['draft', 'scheduled', 'active', 'paused', 'ended', 'archived']) }).safeParse(req.body);
    if (!parsed.success) throw badRequest('Invalid status');
    const { rowCount } = await query('UPDATE quizzes SET status = $2, updated_at = now() WHERE id = $1', [id, parsed.data.status]);
    if (!rowCount) throw notFound('Quiz not found');
    audit(req.userId, `admin.quiz.${parsed.data.status}`, 'quiz', id);
    return { ok: true };
  });
}
