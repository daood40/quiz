import { query } from '../../db/pool.js';

export interface PoolFilter {
  categoryId?: string | null;
  difficulty?: string | null;
  language?: string | null;
  types?: string[];
  tags?: string[];
  count: number;
  /** avoid questions this user answered recently */
  excludeAnsweredBy?: string | null;
  /** minimum quality score gate */
  minQuality?: number;
}

export interface PoolQuestion {
  id: string;
  type: string;
  difficulty: string;
  points: number;
  time_limit_sec: number | null;
}

/**
 * Question Pool Engine — picks approved questions matching the filter,
 * excluding anything the user answered in the last 90 days (repeat
 * questions are the #1 complaint about the big trivia apps), randomized,
 * quality-gated. Falls back to already-answered questions only when the
 * fresh pool is too small.
 */
export async function pickQuestions(filter: PoolFilter): Promise<PoolQuestion[]> {
  const params: unknown[] = [];
  const where: string[] = [`q.status = 'approved'`];
  const add = (v: unknown): string => {
    params.push(v);
    return `$${params.length}`;
  };
  if (filter.categoryId) where.push(`(q.category_id = ${add(filter.categoryId)} OR q.subcategory_id = $${params.length})`);
  if (filter.difficulty) where.push(`q.difficulty = ${add(filter.difficulty)}`);
  if (filter.language) where.push(`q.language = ${add(filter.language)}`);
  if (filter.types?.length) where.push(`q.type = ANY(${add(filter.types)})`);
  if (filter.tags?.length) where.push(`q.tags && ${add(filter.tags)}`);
  if (filter.minQuality !== undefined) where.push(`q.quality_score >= ${add(filter.minQuality)}`);

  const base = `FROM questions q WHERE ${where.join(' AND ')}`;
  const cols = 'q.id, q.type, q.difficulty, q.points, q.time_limit_sec';

  if (filter.excludeAnsweredBy) {
    const userParam = add(filter.excludeAnsweredBy);
    const countParam = add(filter.count);
    const fresh = await query<PoolQuestion>(
      `SELECT ${cols} ${base}
         AND q.id NOT IN (
           SELECT aa.question_id FROM attempt_answers aa
           JOIN attempts a ON a.id = aa.attempt_id
           WHERE a.user_id = ${userParam}
             AND aa.answered_at > now() - interval '90 days'
         )
       ORDER BY random() LIMIT ${countParam}`,
      params,
    );
    if (fresh.rows.length >= filter.count) return fresh.rows;
    // top up with previously-answered questions (fresh params — pg rejects unused ones)
    const missing = filter.count - fresh.rows.length;
    const excludeIds = fresh.rows.map((r) => r.id);
    const baseParams = params.slice(0, params.length - 2); // drop user + count params
    const topUp = await query<PoolQuestion>(
      `SELECT ${cols} ${base} AND NOT (q.id = ANY($${baseParams.length + 1}::uuid[]))
       ORDER BY random() LIMIT $${baseParams.length + 2}`,
      [...baseParams, excludeIds, missing],
    );
    return [...fresh.rows, ...topUp.rows];
  }

  const { rows } = await query<PoolQuestion>(
    `SELECT ${cols} ${base} ORDER BY random() LIMIT ${add(filter.count)}`,
    params,
  );
  return rows;
}
