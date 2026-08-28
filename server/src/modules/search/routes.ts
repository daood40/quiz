import type { FastifyInstance } from 'fastify';
import { badRequest } from '../../core/errors.js';
import { query } from '../../db/pool.js';

/** Cross-entity search: users, categories, challenges, tournaments (paginated). */
export async function searchRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', async (req) => {
    const q = req.query as { q?: string; type?: string; limit?: string; offset?: string };
    const term = (q.q ?? '').trim();
    if (term.length < 2) throw badRequest('Search query must be at least 2 characters');
    const limit = Math.min(Number(q.limit ?? 20), 50);
    const offset = Math.max(Number(q.offset ?? 0), 0);
    const like = `%${term}%`;
    const type = q.type ?? 'all';
    const out: Record<string, unknown> = {};

    if (type === 'all' || type === 'users') {
      const users = await query(
        `SELECT id, username, display_name, avatar, level, total_points FROM users
         WHERE (username ILIKE $1 OR display_name ILIKE $1) AND status = 'active' AND is_guest = false
         ORDER BY total_points DESC LIMIT $2 OFFSET $3`,
        [like, limit, offset],
      );
      out.users = users.rows;
    }
    if (type === 'all' || type === 'categories') {
      const cats = await query(
        `SELECT id, slug, name, icon FROM categories
         WHERE is_active = true AND (slug ILIKE $1 OR name->>'en' ILIKE $1 OR name->>'ar' ILIKE $1)
         ORDER BY sort_order LIMIT $2 OFFSET $3`,
        [like, limit, offset],
      );
      out.categories = cats.rows;
    }
    if (type === 'all' || type === 'tournaments') {
      const tours = await query(
        `SELECT id, title, kind, status FROM tournaments
         WHERE status IN ('registration','running') AND (title->>'en' ILIKE $1 OR title->>'ar' ILIKE $1)
         ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
        [like, limit, offset],
      );
      out.tournaments = tours.rows;
    }
    if (type === 'all' || type === 'groups') {
      const groups = await query(
        `SELECT id, name, description FROM groups WHERE is_public = true AND name ILIKE $1
         ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
        [like, limit, offset],
      );
      out.groups = groups.rows;
    }
    return out;
  });
}
