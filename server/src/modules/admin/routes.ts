import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../../core/audit.js';
import { badRequest, forbidden, notFound } from '../../core/errors.js';
import { DEFAULT_SETTINGS, getSettings, updateSettings } from '../../core/settings.js';
import { query } from '../../db/pool.js';
import { requireRole } from '../../plugins/auth.js';
import { roleAtLeast } from '../auth/rbac.js';
import type { Role } from '../auth/tokens.js';
import { adminQuestionRoutes } from './questions.js';
import { adminQuizRoutes } from './quizzes.js';
import { importExportRoutes } from './importExport.js';

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  const moderator = requireRole('moderator');
  const admin = requireRole('admin');

  await app.register(adminQuestionRoutes, { prefix: '/questions' });
  await app.register(importExportRoutes, { prefix: '/questions' });
  await app.register(adminQuizRoutes, { prefix: '/quizzes' });

  // ---------- dashboard ----------
  app.get('/dashboard', { preHandler: [moderator] }, async () => {
    const [users, activeToday, questions, byStatus, attempts, challenges, tournaments, reports, suspicious] =
      await Promise.all([
        query(`SELECT count(*) AS n FROM users WHERE is_guest = false AND status <> 'deleted'`),
        query(`SELECT count(DISTINCT user_id) AS n FROM attempts WHERE created_at > now() - interval '24 hours'`),
        query(`SELECT count(*) AS n FROM questions`),
        query(`SELECT status, count(*) AS n FROM questions GROUP BY status`),
        query(`SELECT count(*) AS n, count(*) FILTER (WHERE created_at > now() - interval '24 hours') AS today FROM attempts`),
        query(`SELECT count(*) AS n FROM challenges`),
        query(`SELECT count(*) AS n FROM tournaments`),
        query(`SELECT count(*) AS n FROM question_reports WHERE status IN ('open','reviewing')`),
        query(`SELECT count(*) AS n FROM attempts WHERE suspicion IN ('suspicious','under_review')`),
      ]);
    const dau = await query(
      `SELECT count(DISTINCT user_id) AS n FROM analytics_events WHERE created_at > now() - interval '1 day'`,
    );
    const mau = await query(
      `SELECT count(DISTINCT user_id) AS n FROM analytics_events WHERE created_at > now() - interval '30 days'`,
    );
    return {
      users: Number(users.rows[0].n),
      activeUsers24h: Number(activeToday.rows[0].n),
      dau: Number(dau.rows[0].n),
      mau: Number(mau.rows[0].n),
      questions: Number(questions.rows[0].n),
      questionsByStatus: Object.fromEntries(byStatus.rows.map((r) => [r.status, Number(r.n)])),
      attempts: Number(attempts.rows[0].n),
      attemptsToday: Number(attempts.rows[0].today),
      challenges: Number(challenges.rows[0].n),
      tournaments: Number(tournaments.rows[0].n),
      openReports: Number(reports.rows[0].n),
      suspiciousAttempts: Number(suspicious.rows[0].n),
    };
  });

  // ---------- analytics ----------
  app.get('/analytics', { preHandler: [moderator] }, async () => {
    const starts = await query(
      `SELECT date_trunc('day', created_at)::date AS day, count(*) AS n
       FROM analytics_events WHERE kind = 'quiz_start' AND created_at > now() - interval '30 days'
       GROUP BY 1 ORDER BY 1`,
    );
    const completes = await query(
      `SELECT date_trunc('day', created_at)::date AS day, count(*) AS n,
              avg((properties->>'score')::numeric) AS avg_score,
              avg((properties->>'durationMs')::numeric) AS avg_duration
       FROM analytics_events WHERE kind = 'quiz_complete' AND created_at > now() - interval '30 days'
       GROUP BY 1 ORDER BY 1`,
    );
    const popular = await query(
      `SELECT c.slug, c.name, count(*) AS attempts
       FROM attempt_answers aa
       JOIN questions q ON q.id = aa.question_id
       JOIN categories c ON c.id = q.category_id
       WHERE aa.answered_at > now() - interval '30 days'
       GROUP BY c.id ORDER BY attempts DESC LIMIT 10`,
    );
    const hardest = await query(
      `SELECT q.id, q.content->'prompt' AS prompt, s.attempts, s.correct,
              round((s.correct::numeric / NULLIF(s.attempts,0)) * 100, 1) AS correct_rate
       FROM question_stats s JOIN questions q ON q.id = s.question_id
       WHERE s.attempts >= 5 ORDER BY (s.correct::numeric / NULLIF(s.attempts,0)) ASC NULLS LAST LIMIT 10`,
    );
    return {
      quizStartsByDay: starts.rows,
      quizCompletionsByDay: completes.rows,
      popularCategories: popular.rows,
      hardestQuestions: hardest.rows,
    };
  });

  // ---------- users ----------
  app.get('/users', { preHandler: [moderator] }, async (req) => {
    const q = req.query as Record<string, string>;
    const params: unknown[] = [];
    const where: string[] = [`is_guest = false`];
    const add = (v: unknown): string => {
      params.push(v);
      return `$${params.length}`;
    };
    if (q.search) where.push(`(username ILIKE ${add(`%${q.search}%`)} OR email ILIKE $${params.length} OR display_name ILIKE $${params.length})`);
    if (q.role) where.push(`role = ${add(q.role)}`);
    if (q.status) where.push(`status = ${add(q.status)}`);
    const limit = Math.min(Number(q.limit ?? 25), 100);
    const offset = Math.max(Number(q.offset ?? 0), 0);
    const total = await query(`SELECT count(*) AS n FROM users WHERE ${where.join(' AND ')}`, params);
    const { rows } = await query(
      `SELECT id, email, username, display_name, role, status, level, xp, total_points, country,
              current_streak, created_at,
              (SELECT count(*) FROM attempts a WHERE a.user_id = users.id) AS attempt_count
       FROM users WHERE ${where.join(' AND ')}
       ORDER BY created_at DESC LIMIT ${add(limit)} OFFSET ${add(offset)}`,
      params,
    );
    return { total: Number(total.rows[0].n), users: rows };
  });

  app.get('/users/:id', { preHandler: [moderator] }, async (req) => {
    const { id } = req.params as { id: string };
    const { rows } = await query('SELECT * FROM users WHERE id = $1', [id]);
    if (!rows[0]) throw notFound('User not found');
    const stats = await query('SELECT * FROM user_stats WHERE user_id = $1', [id]);
    const recent = await query(
      `SELECT id, mode, status, score, max_score, suspicion, created_at FROM attempts
       WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [id],
    );
    const flags = await query(
      `SELECT kind, details, created_at FROM suspicious_events WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [id],
    );
    const activity = await query(
      `SELECT action, entity, created_at FROM audit_logs WHERE actor_id = $1 ORDER BY created_at DESC LIMIT 30`,
      [id],
    );
    const u = rows[0];
    return {
      user: {
        id: u.id, email: u.email, username: u.username, displayName: u.display_name, role: u.role,
        status: u.status, level: u.level, xp: Number(u.xp), totalPoints: Number(u.total_points),
        country: u.country, language: u.language, plan: u.plan, createdAt: u.created_at,
        emailVerified: u.email_verified_at !== null,
      },
      stats: stats.rows[0] ?? null,
      recentAttempts: recent.rows,
      suspiciousEvents: flags.rows,
      activity: activity.rows,
    };
  });

  app.post('/users/:id/status', { preHandler: [moderator] }, async (req) => {
    const { id } = req.params as { id: string };
    const parsed = z.object({ status: z.enum(['active', 'suspended', 'banned']) }).safeParse(req.body);
    if (!parsed.success) throw badRequest('Invalid status');
    const target = await query('SELECT role FROM users WHERE id = $1', [id]);
    if (!target.rows[0]) throw notFound('User not found');
    // moderators cannot act on staff accounts
    if (roleAtLeast(target.rows[0].role as Role, 'moderator') && !roleAtLeast(req.userRole, 'admin')) {
      throw forbidden('Insufficient permissions for staff accounts');
    }
    await query('UPDATE users SET status = $2, updated_at = now() WHERE id = $1', [id, parsed.data.status]);
    if (parsed.data.status !== 'active') {
      await query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [id]);
    }
    audit(req.userId, `admin.user.${parsed.data.status}`, 'user', id);
    return { ok: true };
  });

  app.post('/users/:id/role', { preHandler: [admin] }, async (req) => {
    const { id } = req.params as { id: string };
    const parsed = z.object({ role: z.enum(['user', 'moderator', 'editor', 'admin', 'super_admin']) }).safeParse(req.body);
    if (!parsed.success) throw badRequest('Invalid role');
    // only super_admin can grant admin or super_admin
    if (roleAtLeast(parsed.data.role, 'admin') && req.userRole !== 'super_admin') {
      throw forbidden('Only super admins can grant admin roles');
    }
    if (id === req.userId) throw badRequest('You cannot change your own role');
    const { rowCount } = await query('UPDATE users SET role = $2, updated_at = now() WHERE id = $1', [id, parsed.data.role]);
    if (!rowCount) throw notFound('User not found');
    audit(req.userId, 'admin.user.role_changed', 'user', id, { role: parsed.data.role });
    return { ok: true };
  });

  // ---------- reports ----------
  app.get('/reports', { preHandler: [moderator] }, async (req) => {
    const q = req.query as Record<string, string>;
    const status = q.status ?? 'open';
    const limit = Math.min(Number(q.limit ?? 25), 100);
    const offset = Math.max(Number(q.offset ?? 0), 0);
    const { rows } = await query(
      `SELECT r.*, u.username AS reporter, q.content->'prompt' AS prompt, q.type, q.status AS question_status
       FROM question_reports r
       LEFT JOIN users u ON u.id = r.user_id
       JOIN questions q ON q.id = r.question_id
       WHERE r.status = $1 ORDER BY r.created_at DESC LIMIT $2 OFFSET $3`,
      [status, limit, offset],
    );
    const total = await query('SELECT count(*) AS n FROM question_reports WHERE status = $1', [status]);
    return { total: Number(total.rows[0].n), reports: rows };
  });

  app.post('/reports/:id/resolve', { preHandler: [moderator] }, async (req) => {
    const { id } = req.params as { id: string };
    const parsed = z
      .object({ status: z.enum(['resolved', 'dismissed', 'reviewing']), resolution: z.string().max(1000).default('') })
      .safeParse(req.body);
    if (!parsed.success) throw badRequest('Invalid resolution');
    const { rowCount } = await query(
      `UPDATE question_reports SET status = $2, resolution = $3, resolved_by = $4,
         resolved_at = CASE WHEN $2 IN ('resolved','dismissed') THEN now() ELSE NULL END
       WHERE id = $1`,
      [id, parsed.data.status, parsed.data.resolution, req.userId],
    );
    if (!rowCount) throw notFound('Report not found');
    audit(req.userId, 'admin.report.' + parsed.data.status, 'question_report', id);
    return { ok: true };
  });

  // ---------- anti-cheat review ----------
  app.get('/suspicious', { preHandler: [moderator] }, async (req) => {
    const q = req.query as Record<string, string>;
    const limit = Math.min(Number(q.limit ?? 25), 100);
    const { rows } = await query(
      `SELECT a.id, a.user_id, u.username, a.mode, a.score, a.max_score, a.suspicion, a.flags,
              a.server_duration_ms, a.created_at
       FROM attempts a JOIN users u ON u.id = a.user_id
       WHERE a.suspicion IN ('flagged','suspicious','under_review')
       ORDER BY a.created_at DESC LIMIT $1`,
      [limit],
    );
    return { attempts: rows };
  });

  app.post('/suspicious/:attemptId', { preHandler: [moderator] }, async (req) => {
    const { attemptId } = req.params as { attemptId: string };
    const parsed = z.object({ suspicion: z.enum(['cleared', 'under_review', 'suspicious']) }).safeParse(req.body);
    if (!parsed.success) throw badRequest('Invalid suspicion status');
    const { rowCount } = await query('UPDATE attempts SET suspicion = $2 WHERE id = $1', [attemptId, parsed.data.suspicion]);
    if (!rowCount) throw notFound('Attempt not found');
    audit(req.userId, 'admin.suspicion.' + parsed.data.suspicion, 'attempt', attemptId);
    return { ok: true };
  });

  // ---------- settings ----------
  app.get('/settings', { preHandler: [admin] }, async () => {
    return { settings: await getSettings(), defaults: DEFAULT_SETTINGS };
  });

  app.patch('/settings', { preHandler: [admin] }, async (req) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    for (const key of Object.keys(body)) {
      if (key in DEFAULT_SETTINGS) patch[key] = body[key];
    }
    if (Object.keys(patch).length === 0) throw badRequest('No recognized settings in payload');
    const settings = await updateSettings(patch, req.userId);
    audit(req.userId, 'admin.settings.updated', 'settings', '', { keys: Object.keys(patch) });
    return { settings };
  });

  // ---------- categories ----------
  app.post('/categories', { preHandler: [admin] }, async (req) => {
    const parsed = z
      .object({
        slug: z.string().min(2).max(64).regex(/^[a-z0-9-]+$/),
        name: z.record(z.string()),
        description: z.record(z.string()).default({}),
        parentId: z.string().uuid().nullish(),
        icon: z.string().max(100).default(''),
        color: z.string().max(20).default(''),
        sortOrder: z.number().int().default(0),
      })
      .safeParse(req.body);
    if (!parsed.success) throw badRequest('Invalid category', parsed.error.issues);
    const c = parsed.data;
    const { rows } = await query(
      `INSERT INTO categories (slug, name, description, parent_id, icon, color, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [c.slug, JSON.stringify(c.name), JSON.stringify(c.description), c.parentId ?? null, c.icon, c.color, c.sortOrder],
    );
    audit(req.userId, 'admin.category.created', 'category', rows[0].id);
    return { id: rows[0].id };
  });

  app.patch('/categories/:id', { preHandler: [admin] }, async (req) => {
    const { id } = req.params as { id: string };
    const parsed = z
      .object({
        name: z.record(z.string()).optional(),
        description: z.record(z.string()).optional(),
        icon: z.string().max(100).optional(),
        color: z.string().max(20).optional(),
        sortOrder: z.number().int().optional(),
        isActive: z.boolean().optional(),
        parentId: z.string().uuid().nullable().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) throw badRequest('Invalid category update');
    const c = parsed.data;
    const { rowCount } = await query(
      `UPDATE categories SET
         name = COALESCE($2, name), description = COALESCE($3, description),
         icon = COALESCE($4, icon), color = COALESCE($5, color),
         sort_order = COALESCE($6, sort_order), is_active = COALESCE($7, is_active),
         parent_id = CASE WHEN $8 THEN $9::uuid ELSE parent_id END,
         updated_at = now()
       WHERE id = $1`,
      [
        id,
        c.name ? JSON.stringify(c.name) : null,
        c.description ? JSON.stringify(c.description) : null,
        c.icon ?? null,
        c.color ?? null,
        c.sortOrder ?? null,
        c.isActive ?? null,
        c.parentId !== undefined,
        c.parentId ?? null,
      ],
    );
    if (!rowCount) throw notFound('Category not found');
    audit(req.userId, 'admin.category.updated', 'category', id);
    return { ok: true };
  });

  app.delete('/categories/:id', { preHandler: [admin] }, async (req) => {
    const { id } = req.params as { id: string };
    const inUse = await query('SELECT 1 FROM questions WHERE category_id = $1 OR subcategory_id = $1 LIMIT 1', [id]);
    if (inUse.rowCount) {
      await query('UPDATE categories SET is_active = false, updated_at = now() WHERE id = $1', [id]);
      audit(req.userId, 'admin.category.disabled', 'category', id);
      return { ok: true, disabled: true };
    }
    const { rowCount } = await query('DELETE FROM categories WHERE id = $1', [id]);
    if (!rowCount) throw notFound('Category not found');
    audit(req.userId, 'admin.category.deleted', 'category', id);
    return { ok: true };
  });

  // ---------- achievements ----------
  app.post('/achievements', { preHandler: [admin] }, async (req) => {
    const parsed = z
      .object({
        slug: z.string().min(2).max(64).regex(/^[a-z0-9_-]+$/),
        name: z.record(z.string()),
        description: z.record(z.string()).default({}),
        icon: z.string().max(100).default(''),
        criteria: z.object({ metric: z.string(), gte: z.number() }),
        xpReward: z.number().int().min(0).max(100000).default(0),
      })
      .safeParse(req.body);
    if (!parsed.success) throw badRequest('Invalid achievement', parsed.error.issues);
    const a = parsed.data;
    const { rows } = await query(
      `INSERT INTO achievements (slug, name, description, icon, criteria, xp_reward)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [a.slug, JSON.stringify(a.name), JSON.stringify(a.description), a.icon, JSON.stringify(a.criteria), a.xpReward],
    );
    audit(req.userId, 'admin.achievement.created', 'achievement', rows[0].id);
    return { id: rows[0].id };
  });

  // ---------- audit log ----------
  app.get('/audit', { preHandler: [admin] }, async (req) => {
    const q = req.query as Record<string, string>;
    const limit = Math.min(Number(q.limit ?? 50), 200);
    const offset = Math.max(Number(q.offset ?? 0), 0);
    const params: unknown[] = [];
    const where: string[] = ['1=1'];
    if (q.action) {
      params.push(`${q.action}%`);
      where.push(`action LIKE $${params.length}`);
    }
    const { rows } = await query(
      `SELECT l.*, u.username AS actor FROM audit_logs l LEFT JOIN users u ON u.id = l.actor_id
       WHERE ${where.join(' AND ')} ORDER BY l.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    return { logs: rows };
  });
}
