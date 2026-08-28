import type { FastifyInstance } from 'fastify';
import { query } from '../../db/pool.js';
import { requireAuth } from '../../plugins/auth.js';

export async function statsRoutes(app: FastifyInstance): Promise<void> {
  /** Personal statistics dashboard. */
  app.get('/me', { preHandler: [requireAuth] }, async (req) => {
    const { rows } = await query(
      `SELECT s.*, u.xp, u.level, u.total_points, u.current_streak, u.longest_streak
       FROM user_stats s JOIN users u ON u.id = s.user_id WHERE s.user_id = $1`,
      [req.userId],
    );
    const s = rows[0];
    if (!s) return { stats: null };
    const answered = Number(s.questions_answered);
    const correct = Number(s.correct_total);

    // per-category with names — best/weakest categories
    const perCategory = s.per_category as Record<string, { answered: number; correct: number; timeMs: number }>;
    const catIds = Object.keys(perCategory);
    let categories: Array<{ id: string; name: unknown; answered: number; correct: number; accuracy: number }> = [];
    if (catIds.length) {
      const names = await query(`SELECT id, name FROM categories WHERE id = ANY($1::uuid[])`, [catIds]);
      const nameMap = new Map(names.rows.map((r) => [r.id, r.name]));
      categories = catIds
        .map((id) => {
          const c = perCategory[id];
          const a = Number(c.answered ?? 0);
          const cor = Number(c.correct ?? 0);
          return { id, name: nameMap.get(id) ?? {}, answered: a, correct: cor, accuracy: a > 0 ? Math.round((cor / a) * 1000) / 10 : 0 };
        })
        .filter((c) => c.answered > 0)
        .sort((a, b) => b.accuracy - a.accuracy);
    }

    const activity = await query(
      `SELECT day, quizzes, questions, correct, points, xp FROM daily_activity
       WHERE user_id = $1 AND day > current_date - 90 ORDER BY day`,
      [req.userId],
    );

    return {
      stats: {
        quizzesCompleted: Number(s.quizzes_completed),
        questionsAnswered: answered,
        correct,
        incorrect: Number(s.incorrect_total),
        timeouts: Number(s.timeout_total),
        skipped: Number(s.skipped_total),
        accuracy: answered > 0 ? Math.round((correct / answered) * 1000) / 10 : 0,
        averageTimeMs: answered > 0 ? Math.round(Number(s.total_time_ms) / answered) : 0,
        bestScore: Number(s.best_score),
        perfectQuizzes: Number(s.perfect_quizzes),
        xp: Number(s.xp),
        level: s.level,
        totalPoints: Number(s.total_points),
        currentStreak: s.current_streak,
        longestStreak: s.longest_streak,
        bestCategory: categories[0] ?? null,
        weakestCategory: categories.length > 1 ? categories[categories.length - 1] : null,
        categories,
      },
      activity: activity.rows,
    };
  });
}
