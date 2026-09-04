import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../../core/audit.js';
import { badRequest, conflict, notFound } from '../../core/errors.js';
import { uuidParam } from '../../core/validate.js';
import { query } from '../../db/pool.js';
import { requireAccount } from '../../plugins/auth.js';

/**
 * Friend system — requests, accept/decline, list, remove.
 * The friendships row is stored once with (user_id = requester); status
 * 'pending' until the addressee accepts. Blocked rows silently swallow
 * new requests (no information leak).
 */
export async function friendRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: [requireAccount] }, async (req) => {
    const { rows } = await query(
      `SELECT f.user_id, f.friend_id, f.status, f.created_at,
              u.id AS other_id, u.username, u.display_name, u.avatar, u.level, u.total_points, u.current_streak
       FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.user_id = $1 THEN f.friend_id ELSE f.user_id END
       WHERE (f.user_id = $1 OR f.friend_id = $1) AND f.status <> 'blocked' AND u.status = 'active'
       ORDER BY f.created_at DESC LIMIT 1000`,
      [req.userId],
    );
    const friends = [];
    const incoming = [];
    const outgoing = [];
    for (const r of rows) {
      const item = {
        userId: r.other_id,
        username: r.username,
        displayName: r.display_name,
        avatar: r.avatar,
        level: r.level,
        totalPoints: Number(r.total_points),
        currentStreak: r.current_streak,
        since: r.created_at,
      };
      if (r.status === 'accepted') friends.push(item);
      else if (r.friend_id === req.userId) incoming.push(item);
      else outgoing.push(item);
    }
    return { friends, incoming, outgoing };
  });

  app.post('/request', { preHandler: [requireAccount] }, async (req) => {
    const parsed = z.object({ username: z.string().min(1).max(64) }).safeParse(req.body);
    if (!parsed.success) throw badRequest('Invalid username');
    const target = await query(
      `SELECT id FROM users WHERE username = $1 AND status = 'active' AND is_guest = false`,
      [parsed.data.username],
    );
    if (!target.rows[0]) throw notFound('User not found');
    const otherId = target.rows[0].id;
    if (otherId === req.userId) throw badRequest('You cannot add yourself');

    const existing = await query(
      `SELECT user_id, friend_id, status FROM friendships
       WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)`,
      [req.userId, otherId],
    );
    const row = existing.rows[0];
    if (row) {
      if (row.status === 'blocked') return { ok: true, status: 'pending' }; // no info leak
      if (row.status === 'accepted') throw conflict('Already friends');
      if (row.user_id === req.userId) throw conflict('Request already sent');
      // they already asked us → auto-accept
      await query(`UPDATE friendships SET status = 'accepted' WHERE user_id = $1 AND friend_id = $2`, [otherId, req.userId]);
      return { ok: true, status: 'accepted' };
    }
    await query(`INSERT INTO friendships (user_id, friend_id, status) VALUES ($1, $2, 'pending')`, [req.userId, otherId]);
    await query(
      `INSERT INTO notifications (user_id, kind, title, body, data) VALUES ($1, 'friend_request', $2, $3, $4)`,
      [
        otherId,
        JSON.stringify({ en: 'Friend request', ar: 'طلب صداقة' }),
        JSON.stringify({ en: 'Someone wants to compete with you!', ar: 'أحدهم يريد منافستك!' }),
        JSON.stringify({ fromUserId: req.userId }),
      ],
    );
    audit(req.userId, 'friend.requested', 'user', otherId);
    return { ok: true, status: 'pending' };
  });

  app.post('/respond', { preHandler: [requireAccount] }, async (req) => {
    const parsed = z.object({ userId: z.string().uuid(), accept: z.boolean() }).safeParse(req.body);
    if (!parsed.success) throw badRequest('Invalid response');
    const { rowCount } = parsed.data.accept
      ? await query(
          `UPDATE friendships SET status = 'accepted' WHERE user_id = $1 AND friend_id = $2 AND status = 'pending'`,
          [parsed.data.userId, req.userId],
        )
      : await query(`DELETE FROM friendships WHERE user_id = $1 AND friend_id = $2 AND status = 'pending'`, [
          parsed.data.userId,
          req.userId,
        ]);
    if (!rowCount) throw notFound('No pending request from this user');
    return { ok: true };
  });

  app.delete('/:userId', { preHandler: [requireAccount] }, async (req) => {
    const userId = uuidParam((req.params as { userId: string }).userId, 'user id');
    await query(
      `DELETE FROM friendships WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)`,
      [req.userId, userId],
    );
    return { ok: true };
  });
}
