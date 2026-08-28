import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../../core/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../../core/errors.js';
import { query, withTransaction } from '../../db/pool.js';
import { requireAccount } from '../../plugins/auth.js';

export async function groupRoutes(app: FastifyInstance): Promise<void> {
  app.post('/', { preHandler: [requireAccount] }, async (req) => {
    const parsed = z
      .object({
        name: z.string().min(2).max(64),
        description: z.string().max(500).default(''),
        isPublic: z.boolean().default(true),
      })
      .safeParse(req.body);
    if (!parsed.success) throw badRequest('Invalid group data', parsed.error.issues);
    const { name, description, isPublic } = parsed.data;
    const id = await withTransaction(async (client) => {
      const res = await client.query(
        `INSERT INTO groups (name, description, code, owner_id, is_public) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [name, description, randomBytes(4).toString('hex').toUpperCase(), req.userId, isPublic],
      );
      await client.query(`INSERT INTO group_members (group_id, user_id, role) VALUES ($1,$2,'owner')`, [
        res.rows[0].id,
        req.userId,
      ]);
      return res.rows[0].id as string;
    });
    audit(req.userId, 'group.created', 'group', id);
    return getGroup(id, req.userId!);
  });

  app.get('/', { preHandler: [requireAccount] }, async (req) => {
    const mine = await query(
      `SELECT g.id, g.name, g.description, g.code, g.is_public, gm.role,
              (SELECT count(*) FROM group_members m2 WHERE m2.group_id = g.id) AS member_count
       FROM group_members gm JOIN groups g ON g.id = gm.group_id
       WHERE gm.user_id = $1 ORDER BY gm.joined_at DESC`,
      [req.userId],
    );
    const discover = await query(
      `SELECT g.id, g.name, g.description, g.is_public,
              (SELECT count(*) FROM group_members m2 WHERE m2.group_id = g.id) AS member_count
       FROM groups g
       WHERE g.is_public = true AND NOT EXISTS
         (SELECT 1 FROM group_members gm WHERE gm.group_id = g.id AND gm.user_id = $1)
       ORDER BY member_count DESC LIMIT 20`,
      [req.userId],
    );
    return { myGroups: mine.rows, discover: discover.rows };
  });

  app.get('/:id', { preHandler: [requireAccount] }, async (req) => {
    const { id } = req.params as { id: string };
    return getGroup(id, req.userId!);
  });

  app.post('/join', { preHandler: [requireAccount] }, async (req) => {
    const parsed = z.object({ code: z.string().min(4).max(16).optional(), groupId: z.string().uuid().optional() }).safeParse(req.body ?? {});
    if (!parsed.success || (!parsed.data.code && !parsed.data.groupId)) throw badRequest('Provide a group code or id');
    let group;
    if (parsed.data.code) {
      const { rows } = await query('SELECT id, is_public FROM groups WHERE code = $1', [parsed.data.code.toUpperCase()]);
      group = rows[0];
    } else {
      const { rows } = await query('SELECT id, is_public FROM groups WHERE id = $1', [parsed.data.groupId]);
      group = rows[0];
      if (group && !group.is_public) throw forbidden('This group is private — join with its code');
    }
    if (!group) throw notFound('Group not found');
    const inserted = await query(
      `INSERT INTO group_members (group_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING 1`,
      [group.id, req.userId],
    );
    if (!inserted.rowCount) throw conflict('Already a member');
    return getGroup(group.id, req.userId!);
  });

  app.post('/:id/leave', { preHandler: [requireAccount] }, async (req) => {
    const { id } = req.params as { id: string };
    const { rows } = await query('SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2', [id, req.userId]);
    if (!rows[0]) throw notFound('Not a member');
    if (rows[0].role === 'owner') {
      const others = await query(
        `SELECT count(*) AS n FROM group_members WHERE group_id = $1 AND user_id <> $2`,
        [id, req.userId],
      );
      if (Number(others.rows[0].n) > 0) throw conflict('Transfer ownership or remove members before leaving');
      await query('DELETE FROM groups WHERE id = $1', [id]);
      return { ok: true, deleted: true };
    }
    await query('DELETE FROM group_members WHERE group_id = $1 AND user_id = $2', [id, req.userId]);
    return { ok: true };
  });

  app.post('/:id/invite', { preHandler: [requireAccount] }, async (req) => {
    const { id } = req.params as { id: string };
    const parsed = z.object({ username: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) throw badRequest('Invalid invite');
    const member = await query(`SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2`, [id, req.userId]);
    if (!member.rowCount) throw forbidden('Not a member of this group');
    const target = await query(
      `SELECT id FROM users WHERE username = $1 AND status = 'active' AND is_guest = false`,
      [parsed.data.username],
    );
    if (!target.rows[0]) throw notFound('User not found');
    await query(
      `INSERT INTO notifications (user_id, kind, title, body, data) VALUES ($1,'group_invite',$2,$3,$4)`,
      [
        target.rows[0].id,
        JSON.stringify({ en: 'Group invitation', ar: 'دعوة مجموعة' }),
        JSON.stringify({ en: 'You were invited to join a group', ar: 'تمت دعوتك للانضمام إلى مجموعة' }),
        JSON.stringify({ groupId: id }),
      ],
    );
    return { ok: true };
  });
}

async function getGroup(id: string, userId: string) {
  const { rows } = await query(
    `SELECT g.*, (SELECT count(*) FROM group_members gm WHERE gm.group_id = g.id) AS member_count
     FROM groups g WHERE g.id = $1`,
    [id],
  );
  const g = rows[0];
  if (!g) throw notFound('Group not found');
  const membership = await query('SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2', [id, userId]);
  const members = await query(
    `SELECT gm.user_id, gm.role, gm.joined_at, u.username, u.display_name, u.avatar, u.level, u.total_points
     FROM group_members gm JOIN users u ON u.id = gm.user_id
     WHERE gm.group_id = $1 ORDER BY u.total_points DESC LIMIT 100`,
    [id],
  );
  return {
    group: {
      id: g.id,
      name: g.name,
      description: g.description,
      code: membership.rowCount ? g.code : null, // join code only for members
      isPublic: g.is_public,
      ownerId: g.owner_id,
      memberCount: Number(g.member_count),
      myRole: membership.rows[0]?.role ?? null,
      createdAt: g.created_at,
    },
    members: members.rows.map((m, i) => ({
      rank: i + 1,
      userId: m.user_id,
      username: m.username,
      displayName: m.display_name,
      avatar: m.avatar,
      level: m.level,
      totalPoints: Number(m.total_points),
      role: m.role,
      joinedAt: m.joined_at,
    })),
  };
}
