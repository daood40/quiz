/**
 * AI gateway (admin/editor only):
 *   web → POST /admin/ai/draft-questions → validation → quota → provider → output validation → pending_review
 * SOURCE_LOCK: religious categories are refused here entirely — such questions require a human specialist and a source.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../../core/audit.js';
import { AppError, badRequest, forbidden, notFound } from '../../core/errors.js';
import { query, withTransaction } from '../../db/pool.js';
import { getSettings } from '../../core/settings.js';
import { requireRole } from '../../plugins/auth.js';
import { registry } from '../questions/engine/index.js';
import { computeContentHash } from '../questions/service.js';
import { getAiProvider } from './provider.js';

const RELIGION_PATTERN = /(islam|religion|quran|hadith|fiqh|دين|إسلام|قرآن|حديث|فقه|شرع)/i;
// read per request so operators can tune quotas without a redeploy of the module state
const dailyPerUser = () => Number(process.env.AI_DAILY_PER_USER ?? 20);
const dailyPlatform = () => Number(process.env.AI_DAILY_PLATFORM ?? 500);

export function isSourceLocked(category: { slug: string; name: unknown }): boolean {
  const names = typeof category.name === 'object' && category.name ? Object.values(category.name as Record<string, string>).join(' ') : String(category.name ?? '');
  return RELIGION_PATTERN.test(`${category.slug} ${names}`);
}

async function usage(userId: string): Promise<{ user: number; platform: number }> {
  const { rows } = await query<{ user_n: string; platform_n: string }>(
    `SELECT count(*) FILTER (WHERE user_id = $1) AS user_n, count(*) AS platform_n
     FROM ai_requests WHERE created_at >= date_trunc('day', now()) AND status <> 'blocked'`,
    [userId],
  );
  return { user: Number(rows[0]?.user_n ?? 0), platform: Number(rows[0]?.platform_n ?? 0) };
}

export async function aiRoutes(app: FastifyInstance): Promise<void> {
  const editor = requireRole('editor');

  app.get('/status', { preHandler: [editor] }, async (req) => {
    const provider = getAiProvider();
    const u = await usage(req.userId!);
    return {
      enabled: !!provider,
      provider: provider?.name ?? null,
      model: provider?.model ?? null,
      sourceLock: true,
      quota: { dailyPerUser: dailyPerUser(), dailyPlatform: dailyPlatform(), usedByMe: u.user, usedByPlatform: u.platform },
    };
  });

  app.post('/draft-questions', { preHandler: [editor] }, async (req) => {
    const parsed = z
      .object({
        categoryId: z.string().uuid(),
        difficulty: z.enum(['easy', 'medium', 'hard', 'expert']).default('medium'),
        language: z.enum(['ar', 'en']).default('ar'),
        count: z.number().int().min(1).max(20).default(5),
        topic: z.string().max(120).optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) throw badRequest('Invalid draft request', parsed.error.flatten());
    const input = parsed.data;

    const cat = await query<{ id: string; slug: string; name: unknown }>('SELECT id, slug, name FROM categories WHERE id = $1', [input.categoryId]);
    if (!cat.rows[0]) throw notFound('Category not found');
    if (isSourceLocked(cat.rows[0])) {
      await query(`INSERT INTO ai_requests (user_id, kind, provider, model, category_id, requested, status, error) VALUES ($1,'draft_questions','none','none',$2,$3,'blocked','source_lock')`, [req.userId, cat.rows[0].id, input.count]);
      audit(req.userId, 'ai.blocked.source_lock', 'category', cat.rows[0].id, { count: input.count }, req.ip);
      throw forbidden('SOURCE_LOCK: religious content is written by specialists with sources, never generated');
    }

    const provider = getAiProvider();
    if (!provider) throw new AppError(503, 'ai_disabled', 'AI drafting is not configured (set AI_PROVIDER and AI_API_KEY on the server)');
    if (!(await getSettings()).aiEnabled) throw new AppError(503, 'ai_disabled', 'AI drafting is switched off by an administrator');

    // quota check + reservation in one short transaction under an advisory lock: two concurrent
    // requests can no longer both pass the count. The reserved row is finalised after the call.
    const reservedId = await withTransaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock($1)', [7_412_011]);
      const { rows } = await client.query<{ user_n: string; platform_n: string }>(
        `SELECT count(*) FILTER (WHERE user_id = $1) AS user_n, count(*) AS platform_n
         FROM ai_requests WHERE created_at >= date_trunc('day', now()) AND status <> 'blocked'`,
        [req.userId],
      );
      if (Number(rows[0]?.user_n ?? 0) >= dailyPerUser()) throw new AppError(429, 'ai_quota_user', 'Daily AI quota reached for your account');
      if (Number(rows[0]?.platform_n ?? 0) >= dailyPlatform()) throw new AppError(429, 'ai_quota_platform', 'Daily AI quota reached for the platform');
      const ins = await client.query<{ id: string }>(
        `INSERT INTO ai_requests (user_id, kind, provider, model, category_id, requested, status)
         VALUES ($1,'draft_questions',$2,$3,$4,$5,'pending') RETURNING id`,
        [req.userId, provider.name, provider.model, cat.rows[0].id, input.count],
      );
      return ins.rows[0].id;
    });

    const categoryName = typeof cat.rows[0].name === 'object' && cat.rows[0].name
      ? ((cat.rows[0].name as Record<string, string>)[input.language] ?? (cat.rows[0].name as Record<string, string>).en ?? cat.rows[0].slug)
      : String(cat.rows[0].name ?? cat.rows[0].slug);

    let result;
    try {
      result = await provider.draftQuestions({ categoryName, difficulty: input.difficulty, language: input.language, count: input.count, topic: input.topic });
    } catch (err) {
      await query(`UPDATE ai_requests SET status = 'error', error = $2 WHERE id = $1`, [reservedId, (err as Error).message.slice(0, 500)]);
      throw new AppError(502, 'ai_provider_error', 'The AI provider failed; nothing was saved');
    }

    // output validation: engine rules + duplicate detection; nothing is approved here
    const accepted: string[] = [];
    const errors: Array<{ index: number; error: string }> = [];
    for (const [i, q] of result.questions.entries()) {
      const options = q.options.map((text, idx) => ({ id: `o${idx + 1}`, text }));
      const correct = options[q.correctIndex]?.id;
      const content = { prompt: { [input.language]: q.prompt }, options };
      if (!correct) { errors.push({ index: i, error: 'correct index out of range' }); continue; }
      // SOURCE_LOCK on the output too: the system prompt is advisory, a leak in a secular category is never filed
      if (RELIGION_PATTERN.test(`${q.prompt} ${q.options.join(' ')} ${q.explanation} ${q.tags.join(' ')}`)) { errors.push({ index: i, error: 'source_lock' }); continue; }
      const problems = registry.validate('multiple_choice', { type: 'multiple_choice', content, correctAnswer: correct, configuration: {} });
      if (problems.length) { errors.push({ index: i, error: problems.join('; ') }); continue; }
      const hash = computeContentHash('multiple_choice', content, correct);
      const dupe = await query(`SELECT 1 FROM questions WHERE content_hash = $1 AND status <> 'archived' LIMIT 1`, [hash]);
      if (dupe.rowCount) { errors.push({ index: i, error: 'duplicate' }); continue; }
      const { rows } = await query(
        `INSERT INTO questions (type, category_id, difficulty, language, content, correct_answer, configuration, explanation, tags,
           status, content_hash, source, created_by)
         VALUES ('multiple_choice',$1,$2,$3,$4,$5,'{}',$6,$7,'pending_review',$8,'ai',$9) RETURNING id`,
        [cat.rows[0].id, input.difficulty, input.language, JSON.stringify(content), JSON.stringify(correct),
         JSON.stringify(q.explanation ? { [input.language]: q.explanation } : {}), ['ai-draft', ...q.tags.slice(0, 4)], hash, req.userId],
      );
      await query('INSERT INTO question_stats (question_id) VALUES ($1) ON CONFLICT DO NOTHING', [rows[0].id]);
      accepted.push(rows[0].id);
    }
    await query(
      `UPDATE ai_requests SET status = 'ok', model = $2, produced = $3, accepted = $4, input_tokens = $5, output_tokens = $6 WHERE id = $1`,
      [reservedId, result.model, result.questions.length, accepted.length, result.inputTokens, result.outputTokens],
    );
    audit(req.userId, 'ai.draft_questions', 'category', cat.rows[0].id, { requested: input.count, accepted: accepted.length, model: result.model }, req.ip);
    return { drafted: accepted.length, produced: result.questions.length, questionIds: accepted, errors, status: 'pending_review' };
  });
}
