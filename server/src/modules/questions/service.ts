import { createHash } from 'node:crypto';
import { z } from 'zod';
import { audit } from '../../core/audit.js';
import { badRequest, notFound, validationError } from '../../core/errors.js';
import { query } from '../../db/pool.js';
import { normalizeText } from './engine/normalize.js';
import { registry } from './engine/registry.js';

export const questionInputSchema = z.object({
  type: z.string().min(1),
  categoryId: z.string().uuid().nullish(),
  subcategoryId: z.string().uuid().nullish(),
  difficulty: z.enum(['easy', 'medium', 'hard', 'expert']).default('medium'),
  language: z.enum(['ar', 'en']).default('en'),
  content: z.record(z.unknown()),
  correctAnswer: z.unknown(),
  configuration: z.record(z.unknown()).default({}),
  points: z.number().int().min(0).max(1000).optional(),
  timeLimitSec: z.number().int().min(5).max(3600).nullish(),
  explanation: z.record(z.string()).default({}),
  tags: z.array(z.string().min(1).max(64)).max(20).default([]),
  source: z.string().max(500).default(''),
  sourceUrl: z.string().max(1000).default(''),
  sourceReference: z.string().max(1000).default(''),
  status: z.enum(['draft', 'pending_review', 'approved', 'rejected', 'archived']).optional(),
});
export type QuestionInput = z.infer<typeof questionInputSchema>;

function promptText(content: Record<string, unknown>): string {
  const p = content.prompt;
  if (typeof p === 'string') return p;
  if (p && typeof p === 'object') {
    const o = p as Record<string, unknown>;
    return `${o.en ?? ''} ${o.ar ?? ''}`;
  }
  return '';
}

/** Normalized hash of prompt + answer for exact-duplicate detection. */
export function computeContentHash(type: string, content: Record<string, unknown>, correctAnswer: unknown): string {
  const normalized = normalizeText(promptText(content));
  const payload = `${type}|${normalized}|${JSON.stringify(correctAnswer ?? null)}`;
  return createHash('sha256').update(payload).digest('hex');
}

export interface DuplicateHit {
  id: string;
  kind: 'exact' | 'near';
  similarity: number;
  prompt: string;
}

/** Exact (hash) + near (trigram similarity on normalized prompt) duplicate check. */
export async function findDuplicates(
  type: string,
  content: Record<string, unknown>,
  correctAnswer: unknown,
  excludeId?: string,
): Promise<DuplicateHit[]> {
  const hash = computeContentHash(type, content, correctAnswer);
  const normalizedPrompt = normalizeText(promptText(content));
  const hits: DuplicateHit[] = [];

  const exact = await query(
    `SELECT id, content FROM questions WHERE content_hash = $1 AND status <> 'archived' AND id <> COALESCE($2::uuid, '00000000-0000-0000-0000-000000000000') LIMIT 5`,
    [hash, excludeId ?? null],
  );
  for (const row of exact.rows) {
    hits.push({ id: row.id, kind: 'exact', similarity: 1, prompt: promptText(row.content) });
  }

  if (normalizedPrompt.length >= 10) {
    const near = await query(
      `SELECT id, content,
              similarity(lower(coalesce(content->>'prompt', content->'prompt'->>'en', '') || ' ' || coalesce(content->'prompt'->>'ar','')), $1) AS sim
       FROM questions
       WHERE status <> 'archived' AND type = $2
         AND id <> COALESCE($3::uuid, '00000000-0000-0000-0000-000000000000')
         AND similarity(lower(coalesce(content->>'prompt', content->'prompt'->>'en', '') || ' ' || coalesce(content->'prompt'->>'ar','')), $1) > 0.6
       ORDER BY sim DESC LIMIT 5`,
      [normalizedPrompt, type, excludeId ?? null],
    );
    for (const row of near.rows) {
      if (!hits.some((h) => h.id === row.id)) {
        hits.push({ id: row.id, kind: 'near', similarity: Number(row.sim), prompt: promptText(row.content) });
      }
    }
  }
  return hits;
}

/** Validates via the registry; throws 422 with per-field errors when invalid. */
export function validateQuestionOrThrow(input: QuestionInput): void {
  if (!registry.has(input.type)) {
    throw validationError(`Unknown question type: ${input.type}`, { field: 'type' });
  }
  const errors = registry.validate(input.type, {
    type: input.type,
    content: input.content,
    correctAnswer: input.correctAnswer,
    configuration: input.configuration,
  });
  if (errors.length) throw validationError('Question failed validation', { errors });
}

export async function createQuestion(input: QuestionInput, createdBy: string | null): Promise<string> {
  validateQuestionOrThrow(input);
  const hash = computeContentHash(input.type, input.content, input.correctAnswer);
  const { rows } = await query(
    `INSERT INTO questions
       (type, category_id, subcategory_id, difficulty, language, content, correct_answer,
        configuration, points, time_limit_sec, explanation, tags, source, source_url,
        source_reference, status, content_hash, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     RETURNING id`,
    [
      input.type,
      input.categoryId ?? null,
      input.subcategoryId ?? null,
      input.difficulty,
      input.language,
      JSON.stringify(input.content),
      JSON.stringify(input.correctAnswer ?? null),
      JSON.stringify(input.configuration),
      input.points ?? 10,
      input.timeLimitSec ?? null,
      JSON.stringify(input.explanation),
      input.tags,
      input.source,
      input.sourceUrl,
      input.sourceReference,
      input.status ?? 'draft',
      hash,
      createdBy,
    ],
  );
  await query('INSERT INTO question_stats (question_id) VALUES ($1) ON CONFLICT DO NOTHING', [rows[0].id]);
  audit(createdBy, 'question.created', 'question', rows[0].id, { type: input.type });
  return rows[0].id;
}

export async function updateQuestion(id: string, input: QuestionInput, actor: string | null): Promise<void> {
  validateQuestionOrThrow(input);
  // full history: snapshot the current row as version N, bump to N+1;
  // an approved question that gets edited goes back to review (directive §13)
  await query(
    `INSERT INTO question_versions (question_id, version, snapshot, edited_by)
     SELECT id, version, to_jsonb(questions.*) - 'content_hash', $2 FROM questions WHERE id = $1`,
    [id, actor],
  );
  await query(
    `UPDATE questions SET version = version + 1,
       status = CASE WHEN status = 'approved' THEN 'pending_review' ELSE status END
     WHERE id = $1`,
    [id],
  );
  const hash = computeContentHash(input.type, input.content, input.correctAnswer);
  const { rowCount } = await query(
    `UPDATE questions SET
       type=$2, category_id=$3, subcategory_id=$4, difficulty=$5, language=$6, content=$7,
       correct_answer=$8, configuration=$9, points=$10, time_limit_sec=$11, explanation=$12,
       tags=$13, source=$14, source_url=$15, source_reference=$16, content_hash=$17, updated_at=now()
     WHERE id = $1`,
    [
      id,
      input.type,
      input.categoryId ?? null,
      input.subcategoryId ?? null,
      input.difficulty,
      input.language,
      JSON.stringify(input.content),
      JSON.stringify(input.correctAnswer ?? null),
      JSON.stringify(input.configuration),
      input.points ?? 10,
      input.timeLimitSec ?? null,
      JSON.stringify(input.explanation),
      input.tags,
      input.source,
      input.sourceUrl,
      input.sourceReference,
      hash,
    ],
  );
  if (!rowCount) throw notFound('Question not found');
  audit(actor, 'question.updated', 'question', id);
}

export async function setQuestionStatus(
  id: string,
  status: 'draft' | 'pending_review' | 'approved' | 'rejected' | 'archived',
  actor: string | null,
  note = '',
): Promise<void> {
  if (status === 'approved') {
    // Directive §10: religion-category questions need a documented source before approval
    const chk = await query<{ slug: string | null; source: string | null; source_url: string | null }>(
      `SELECT c.slug, q.source, q.source_url FROM questions q LEFT JOIN categories c ON c.id = q.category_id WHERE q.id = $1`,
      [id],
    );
    const row = chk.rows[0];
    if (!row) throw notFound('Question not found');
    if (row.slug && /islamic|religion|quran|hadith|دين/i.test(row.slug) && !row.source && !row.source_url) {
      throw badRequest('Religion-category questions require a source before approval');
    }
  }
  const { rowCount } = await query(
    `UPDATE questions SET status=$2, review_note=$3, reviewed_by=$4, updated_at=now() WHERE id=$1`,
    [id, status, note, actor],
  );
  if (!rowCount) throw notFound('Question not found');
  audit(actor, `question.${status}`, 'question', id, { note });
  if (status === 'archived' && /wrong|incorrect|خطأ|خاطئ|refund/i.test(note)) {
    await refundQuestionThisSeason(id, actor);
  }
}

/**
 * A question confirmed wrong is archived; everyone who lost points on it this
 * month gets the question's max points credited (directive §13 appeals).
 */
export async function refundQuestionThisSeason(questionId: string, actor: string | null): Promise<number> {
  const { rows } = await query<{ user_id: string; max_score: number }>(
    `SELECT a.user_id, max(aa.max_score) AS max_score
     FROM attempt_answers aa JOIN attempts a ON a.id = aa.attempt_id
     WHERE aa.question_id = $1 AND aa.outcome IN ('incorrect','timeout','partial')
       AND a.status = 'submitted' AND a.submitted_at >= date_trunc('month', now())
       AND a.mode NOT IN ('practice','review')
     GROUP BY a.user_id`,
    [questionId],
  );
  for (const r of rows) {
    const pts = Number(r.max_score) || 0;
    if (pts <= 0) continue;
    await query(`UPDATE users SET total_points = total_points + $2 WHERE id = $1`, [r.user_id, pts]);
    await query(
      `UPDATE leaderboard_scores SET points = points + $2
       WHERE user_id = $1 AND scope IN ('global','monthly') `,
      [r.user_id, pts],
    );
    await query(
      `INSERT INTO notifications (user_id, kind, title, body, data) VALUES ($1,'system',$2,$3,$4)`,
      [r.user_id, JSON.stringify({ en: 'Points refunded', ar: 'تمت إعادة نقاطك' }),
       JSON.stringify({ en: `A question was confirmed wrong — +${pts} points`, ar: `ثبت خطأ سؤال — +${pts} نقطة` }),
       JSON.stringify({ questionId, points: pts })],
    );
  }
  audit(actor, 'question.refund', 'question', questionId, { users: rows.length });
  return rows.length;
}

export async function reportQuestion(
  questionId: string,
  userId: string | null,
  reason: string,
  details: string,
): Promise<string> {
  const exists = await query(`SELECT 1 FROM questions WHERE id = $1`, [questionId]);
  if (!exists.rowCount) throw notFound('Question not found');
  const { rows } = await query(
    `INSERT INTO question_reports (question_id, user_id, reason, details) VALUES ($1,$2,$3,$4) RETURNING id`,
    [questionId, userId, reason, details],
  );
  return rows[0].id;
}

/**
 * Recomputes quality score (0–100) from live stats:
 * correct-rate closeness to a healthy band, skip rate, timeout rate, open reports.
 */
export async function recomputeQuality(questionId: string): Promise<number> {
  const { rows } = await query(
    `SELECT s.attempts, s.correct, s.skips, s.timeouts,
            (SELECT count(*) FROM question_reports r WHERE r.question_id = s.question_id AND r.status IN ('open','reviewing')) AS open_reports
     FROM question_stats s WHERE s.question_id = $1`,
    [questionId],
  );
  const s = rows[0];
  if (!s) throw notFound('Question stats not found');
  const attempts = Number(s.attempts);
  let score = 50;
  if (attempts >= 5) {
    const correctRate = Number(s.correct) / attempts;
    const skipRate = Number(s.skips) / attempts;
    const timeoutRate = Number(s.timeouts) / attempts;
    // healthy questions land between 25% and 90% correct
    const band = correctRate < 0.25 ? correctRate / 0.25 : correctRate > 0.9 ? (1 - correctRate) / 0.1 : 1;
    score = 100 * (0.6 * band + 0.25 * (1 - skipRate) + 0.15 * (1 - timeoutRate));
  }
  score -= Number(s.open_reports) * 10;
  score = Math.max(0, Math.min(100, Math.round(score * 100) / 100));
  await query('UPDATE questions SET quality_score = $2 WHERE id = $1', [questionId, score]);
  return score;
}
