import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../../core/audit.js';
import { badRequest, notFound, validationError } from '../../core/errors.js';
import { query } from '../../db/pool.js';
import { requireRole } from '../../plugins/auth.js';
import { registry } from '../questions/engine/registry.js';
import {
  createQuestion,
  findDuplicates,
  questionInputSchema,
  recomputeQuality,
  setQuestionStatus,
  updateQuestion,
  validateQuestionOrThrow,
} from '../questions/service.js';

const listQuery = z.object({
  status: z.enum(['draft', 'pending_review', 'approved', 'rejected', 'archived']).optional(),
  type: z.string().optional(),
  categoryId: z.string().uuid().optional(),
  difficulty: z.enum(['easy', 'medium', 'hard', 'expert']).optional(),
  language: z.enum(['ar', 'en']).optional(),
  search: z.string().max(200).optional(),
  tag: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
  sort: z.enum(['created_at', 'updated_at', 'quality_score', 'difficulty']).default('created_at'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

function rowToAdminQuestion(r: Record<string, unknown>) {
  return {
    id: r.id,
    type: r.type,
    categoryId: r.category_id,
    subcategoryId: r.subcategory_id,
    difficulty: r.difficulty,
    language: r.language,
    content: r.content,
    correctAnswer: r.correct_answer,
    configuration: r.configuration,
    points: r.points,
    timeLimitSec: r.time_limit_sec,
    explanation: r.explanation,
    tags: r.tags,
    source: r.source,
    sourceUrl: r.source_url,
    sourceReference: r.source_reference,
    verificationStatus: r.verification_status,
    status: r.status,
    reviewNote: r.review_note,
    qualityScore: Number(r.quality_score),
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function adminQuestionRoutes(app: FastifyInstance): Promise<void> {
  const editor = requireRole('editor');
  const moderator = requireRole('moderator');

  app.get('/', { preHandler: [moderator] }, async (req) => {
    const parsed = listQuery.safeParse(req.query ?? {});
    if (!parsed.success) throw badRequest('Invalid filters', parsed.error.issues);
    const f = parsed.data;
    const params: unknown[] = [];
    const where: string[] = ['1=1'];
    const add = (v: unknown): string => {
      params.push(v);
      return `$${params.length}`;
    };
    if (f.status) where.push(`status = ${add(f.status)}`);
    if (f.type) where.push(`type = ${add(f.type)}`);
    if (f.categoryId) where.push(`(category_id = ${add(f.categoryId)} OR subcategory_id = $${params.length})`);
    if (f.difficulty) where.push(`difficulty = ${add(f.difficulty)}`);
    if (f.language) where.push(`language = ${add(f.language)}`);
    if (f.tag) where.push(`${add(f.tag)} = ANY(tags)`);
    if (f.search)
      where.push(
        `(coalesce(content->>'prompt','') || ' ' || coalesce(content->'prompt'->>'en','') || ' ' || coalesce(content->'prompt'->>'ar','')) ILIKE ${add(`%${f.search}%`)}`,
      );
    const total = await query<{ n: string }>(`SELECT count(*) AS n FROM questions WHERE ${where.join(' AND ')}`, params);
    const { rows } = await query(
      `SELECT * FROM questions WHERE ${where.join(' AND ')}
       ORDER BY ${f.sort} ${f.order.toUpperCase()} LIMIT ${add(f.limit)} OFFSET ${add(f.offset)}`,
      params,
    );
    return { total: Number(total.rows[0].n), questions: rows.map(rowToAdminQuestion) };
  });

  app.get('/:id', { preHandler: [moderator] }, async (req) => {
    const { id } = req.params as { id: string };
    const { rows } = await query('SELECT * FROM questions WHERE id = $1', [id]);
    if (!rows[0]) throw notFound('Question not found');
    const stats = await query('SELECT * FROM question_stats WHERE question_id = $1', [id]);
    const reports = await query(
      `SELECT r.*, u.username FROM question_reports r LEFT JOIN users u ON u.id = r.user_id
       WHERE r.question_id = $1 ORDER BY r.created_at DESC LIMIT 20`,
      [id],
    );
    const s = stats.rows[0];
    const attempts = Number(s?.attempts ?? 0);
    return {
      question: rowToAdminQuestion(rows[0]),
      analytics: s
        ? {
            attempts,
            correctRate: attempts ? Number(s.correct) / attempts : null,
            wrongRate: attempts ? Number(s.incorrect) / attempts : null,
            timeoutRate: attempts ? Number(s.timeouts) / attempts : null,
            skipRate: attempts ? Number(s.skips) / attempts : null,
            averageTimeMs: attempts ? Math.round(Number(s.total_time_ms) / attempts) : null,
          }
        : null,
      reports: reports.rows,
    };
  });

  app.post('/', { preHandler: [editor] }, async (req) => {
    const parsed = questionInputSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Invalid question', parsed.error.issues);
    const duplicates = await findDuplicates(parsed.data.type, parsed.data.content, parsed.data.correctAnswer);
    if (duplicates.some((d) => d.kind === 'exact') && (req.query as { force?: string }).force !== 'true') {
      throw validationError('Exact duplicate question exists', { duplicates });
    }
    const id = await createQuestion(parsed.data, req.userId);
    return { id, duplicates };
  });

  /** Pre-flight validation / duplicate check without saving. */
  app.post('/validate', { preHandler: [editor] }, async (req) => {
    const parsed = questionInputSchema.safeParse(req.body);
    if (!parsed.success) return { valid: false, errors: parsed.error.issues };
    try {
      validateQuestionOrThrow(parsed.data);
    } catch (err) {
      const e = err as { details?: unknown };
      return { valid: false, errors: e.details ?? [{ message: (err as Error).message }] };
    }
    const duplicates = await findDuplicates(parsed.data.type, parsed.data.content, parsed.data.correctAnswer);
    return { valid: true, duplicates };
  });

  app.put('/:id', { preHandler: [editor] }, async (req) => {
    const { id } = req.params as { id: string };
    const parsed = questionInputSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Invalid question', parsed.error.issues);
    await updateQuestion(id, parsed.data, req.userId);
    return { ok: true };
  });

  app.post('/:id/status', { preHandler: [moderator] }, async (req) => {
    const { id } = req.params as { id: string };
    const parsed = z
      .object({
        status: z.enum(['draft', 'pending_review', 'approved', 'rejected', 'archived']),
        note: z.string().max(1000).default(''),
      })
      .safeParse(req.body);
    if (!parsed.success) throw badRequest('Invalid status change');
    await setQuestionStatus(id, parsed.data.status, req.userId, parsed.data.note);
    return { ok: true };
  });

  app.post('/bulk-status', { preHandler: [moderator] }, async (req) => {
    const parsed = z
      .object({
        ids: z.array(z.string().uuid()).min(1).max(500),
        status: z.enum(['pending_review', 'approved', 'rejected', 'archived']),
      })
      .safeParse(req.body);
    if (!parsed.success) throw badRequest('Invalid bulk action');
    const { rowCount } = await query(
      `UPDATE questions SET status = $2, reviewed_by = $3, updated_at = now() WHERE id = ANY($1::uuid[])`,
      [parsed.data.ids, parsed.data.status, req.userId],
    );
    audit(req.userId, 'question.bulk_status', 'question', '', { count: rowCount, status: parsed.data.status });
    return { updated: rowCount };
  });

  app.delete('/:id', { preHandler: [requireRole('admin')] }, async (req) => {
    const { id } = req.params as { id: string };
    const { rowCount } = await query('DELETE FROM questions WHERE id = $1', [id]);
    if (!rowCount) throw notFound('Question not found');
    audit(req.userId, 'question.deleted', 'question', id);
    return { ok: true };
  });

  app.post('/:id/recompute-quality', { preHandler: [moderator] }, async (req) => {
    const { id } = req.params as { id: string };
    const score = await recomputeQuality(id);
    return { qualityScore: score };
  });

  app.get('/meta/types', { preHandler: [moderator] }, async () => ({
    types: registry.listTypes(),
  }));
}
