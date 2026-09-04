import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { badRequest, notFound } from '../../core/errors.js';
import { query } from '../../db/pool.js';
import { requireAuth } from '../../plugins/auth.js';
import { toPublicUser, toProfileUser } from '../auth/service.js';

export async function userRoutes(app: FastifyInstance): Promise<void> {
  app.get('/me', { preHandler: [requireAuth] }, async (req) => {
    const { rows } = await query('SELECT * FROM users WHERE id = $1', [req.userId]);
    if (!rows[0]) throw notFound('User not found');
    return { user: toPublicUser(rows[0]) };
  });

  app.patch('/me', { preHandler: [requireAuth] }, async (req) => {
    const schema = z.object({
      displayName: z.string().min(1).max(64).optional(),
      avatar: z.string().max(500).optional(),
      language: z.enum(['ar', 'en']).optional(),
      country: z.string().length(2).or(z.literal('')).optional(),
      timezone: z.string().max(64).optional(),
    });
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) throw badRequest('Invalid profile update');
    const patch = result.data;
    const { rows } = await query(
      `UPDATE users SET
         display_name = COALESCE($2, display_name),
         avatar = COALESCE($3, avatar),
         language = COALESCE($4, language),
         country = COALESCE(upper($5), country),
         timezone = COALESCE($6, timezone),
         updated_at = now()
       WHERE id = $1 RETURNING *`,
      [req.userId, patch.displayName, patch.avatar, patch.language, patch.country, patch.timezone],
    );
    return { user: toPublicUser(rows[0]) };
  });

  /** Public profile with headline stats + achievements. */
  app.get('/:username', async (req) => {
    const { username } = req.params as { username: string };
    const { rows } = await query(
      `SELECT u.*, s.quizzes_completed, s.questions_answered, s.correct_total, s.incorrect_total,
              s.best_score, s.total_time_ms, s.perfect_quizzes
       FROM users u LEFT JOIN user_stats s ON s.user_id = u.id
       WHERE u.username = $1 AND u.status = 'active' AND u.is_guest = false`,
      [username],
    );
    const row = rows[0];
    if (!row) throw notFound('User not found');
    const achievements = await query(
      `SELECT a.slug, a.name, a.icon, ua.earned_at
       FROM user_achievements ua JOIN achievements a ON a.id = ua.achievement_id
       WHERE ua.user_id = $1 ORDER BY ua.earned_at DESC`,
      [row.id],
    );
    const answered = Number(row.questions_answered ?? 0);
    const correct = Number(row.correct_total ?? 0);
    const globalRank = await query(
      `SELECT COUNT(*) + 1 AS rank FROM users
       WHERE status = 'active' AND is_guest = false AND total_points > $1`,
      [row.total_points],
    );
    return {
      user: toProfileUser(row),
      stats: {
        quizzesCompleted: Number(row.quizzes_completed ?? 0),
        questionsAnswered: answered,
        correct,
        incorrect: Number(row.incorrect_total ?? 0),
        accuracy: answered > 0 ? Math.round((correct / answered) * 1000) / 10 : 0,
        bestScore: Number(row.best_score ?? 0),
        perfectQuizzes: Number(row.perfect_quizzes ?? 0),
        globalRank: Number(globalRank.rows[0].rank),
      },
      achievements: achievements.rows,
    };
  });
}
