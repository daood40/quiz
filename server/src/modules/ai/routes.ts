/**
 * AI gateway (admin/editor only):
 *   web → POST /admin/ai/draft-questions → validation → quota → provider → output validation → pending_review
 * SOURCE_LOCK: religious categories are refused here entirely — such questions require a human specialist and a source.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../../core/audit.js';
import { AppError, badRequest, forbidden, notFound } from '../../core/errors.js';
import { query } from '../../db/pool.js';
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

    const u = await usage(req.userId!);
    if (u.user >= dailyPerUser()) throw new AppError(429, 'ai_quota_user', 'Daily AI quota reached for your account');
    if (u.platform >= dailyPlatform()) throw new AppError(429, 'ai_quota_platform', 'Daily AI quota reached for the platform');

    const categoryName = typeof cat.rows[0].name === 'object' && cat.rows[0].name
      ? ((cat.rows[0].name as Record<string, string>)[input.language] ?? (cat.rows[0].name as Record<string, string>).en ?? cat.rows[0].slug)
      : String(cat.rows[0].name ?? cat.rows[0].slug);

    let result;
    try {
      result = await provider.draftQuestions({ categoryName, difficulty: input.difficulty, language: input.language, count: input.count, topic: input.topic });
    } catch (err) {
      await query(`INSERT INTO ai_requests (user_id, kind, provider, model, category_id, requested, status, error) VALUES ($1,'draft_questions',$2,$3,$4,$5,'error',$6)`,
        [req.userId, provider.name, provider.model, cat.rows[0].id, input.count, (err as Error).message.slice(0, 500)]);
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
      `INSERT INTO ai_requests (user_id, kind, provider, model, category_id, requested, produced, accepted, input_tokens, output_tokens)
       VALUES ($1,'draft_questions',$2,$3,$4,$5,$6,$7,$8,$9)`,
      [req.userId, provider.name, result.model, cat.rows[0].id, input.count, result.questions.length, accepted.length, result.inputTokens, result.outputTokens],
    );
    audit(req.userId, 'ai.draft_questions', 'category', cat.rows[0].id, { requested: input.count, accepted: accepted.length, model: result.model }, req.ip);
    return { drafted: accepted.length, produced: result.questions.length, questionIds: accepted, errors, status: 'pending_review' };
  });
}
