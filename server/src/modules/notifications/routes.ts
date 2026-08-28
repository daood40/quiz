import type { FastifyInstance } from 'fastify';
import { query } from '../../db/pool.js';
import { requireAuth } from '../../plugins/auth.js';

export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: [requireAuth] }, async (req) => {
    const q = req.query as { limit?: string; offset?: string };
    const limit = Math.min(Number(q.limit ?? 30), 100);
    const offset = Math.max(Number(q.offset ?? 0), 0);
    const { rows } = await query(
      `SELECT id, kind, title, body, data, read_at, created_at
       FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [req.userId, limit, offset],
    );
    const unread = await query(
      'SELECT count(*) AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL',
      [req.userId],
    );
    return { notifications: rows, unreadCount: Number(unread.rows[0].n) };
  });

  app.post('/read', { preHandler: [requireAuth] }, async (req) => {
    const body = (req.body ?? {}) as { ids?: string[] };
    if (Array.isArray(body.ids) && body.ids.length > 0) {
      await query(
        `UPDATE notifications SET read_at = now() WHERE user_id = $1 AND id = ANY($2::uuid[]) AND read_at IS NULL`,
        [req.userId, body.ids],
      );
    } else {
      await query(`UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL`, [req.userId]);
    }
    return { ok: true };
  });
}
