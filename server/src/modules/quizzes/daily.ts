import { query } from '../../db/pool.js';
import { pickQuestions } from './pool.js';

/**
 * Question-of-the-day engine: one deterministic question set per calendar day,
 * created once and shared by every player (fair daily competition, like the
 * daily formats popularized by Wordle/Duolingo). Idempotent under races via
 * ON CONFLICT DO NOTHING.
 */
export async function ensureDailyQuiz(day?: string): Promise<{ id: string; day: string; questionIds: string[] } | null> {
  const key = day ?? new Date().toISOString().slice(0, 10);
  const existing = await query<{ id: string; day: string; question_ids: string[] }>(
    'SELECT id, day, question_ids FROM daily_quizzes WHERE day = $1',
    [key],
  );
  if (existing.rows[0]) {
    return { id: existing.rows[0].id, day: key, questionIds: existing.rows[0].question_ids };
  }

  const picked = await pickQuestions({ count: 10 });
  if (picked.length === 0) return null;
  await query(
    `INSERT INTO daily_quizzes (day, question_ids) VALUES ($1, $2) ON CONFLICT (day) DO NOTHING`,
    [key, picked.map((p) => p.id)],
  );
  const { rows } = await query<{ id: string; day: string; question_ids: string[] }>(
    'SELECT id, day, question_ids FROM daily_quizzes WHERE day = $1',
    [key],
  );
  return rows[0] ? { id: rows[0].id, day: key, questionIds: rows[0].question_ids } : null;
}
