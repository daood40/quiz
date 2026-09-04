import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../../core/audit.js';
import { badRequest, notFound } from '../../core/errors.js';
import { query } from '../../db/pool.js';
import { requireAccount, requireAuth } from '../../plugins/auth.js';
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

  /** Data export (privacy): everything the platform stores about the caller, as one JSON document. */
  app.get('/me/export', { preHandler: [requireAccount] }, async (req, reply) => {
    const uid = req.userId!;
    const [user, stats, attempts, achievements, bookmarks, friends, notifications, activityLog] = await Promise.all([
      query(`SELECT id, email, username, display_name, avatar, language, country, role, plan, xp, level, total_points,
                    current_streak, longest_streak, email_verified_at, created_at, updated_at FROM users WHERE id = $1`, [uid]),
      query('SELECT * FROM user_stats WHERE user_id = $1', [uid]),
      query(`SELECT a.id, a.mode, a.context_type, a.status, a.score, a.max_score, a.correct_count, a.started_at, a.submitted_at,
                    a.server_duration_ms,
                    (SELECT json_agg(json_build_object('questionId', aa.question_id, 'answer', aa.answer, 'outcome', aa.outcome,
                                                       'score', aa.score, 'answeredAt', aa.answered_at) ORDER BY aa.answered_at)
                       FROM attempt_answers aa WHERE aa.attempt_id = a.id) AS answers
             FROM attempts a WHERE a.user_id = $1 ORDER BY a.started_at DESC LIMIT 5000`, [uid]),
      query(`SELECT a.slug, ua.earned_at FROM user_achievements ua JOIN achievements a ON a.id = ua.achievement_id WHERE ua.user_id = $1`, [uid]),
      query('SELECT question_id, created_at FROM question_bookmarks WHERE user_id = $1', [uid]),
      query(`SELECT CASE WHEN user_id = $1 THEN friend_id ELSE user_id END AS friend_id, status, created_at
             FROM friendships WHERE user_id = $1 OR friend_id = $1`, [uid]),
      query('SELECT kind, title, body, read_at, created_at FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1000', [uid]),
      query('SELECT action, entity, created_at FROM audit_logs WHERE actor_id = $1 ORDER BY created_at DESC LIMIT 1000', [uid]),
    ]);
    audit(uid, 'user.data_export', 'user', uid, {}, req.ip);
    reply.header('content-disposition', `attachment; filename="quiz-data-${uid.slice(0, 8)}.json"`);
    return {
      exportedAt: new Date().toISOString(),
      format: 'quiz-platform/1',
      user: user.rows[0],
      stats: stats.rows[0] ?? null,
      attempts: attempts.rows,
      achievements: achievements.rows,
      bookmarks: bookmarks.rows,
      friends: friends.rows,
      notifications: notifications.rows,
      activity: activityLog.rows,
    };
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
