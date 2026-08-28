import type { FastifyInstance } from 'fastify';
import { getSettings } from '../../core/settings.js';
import { query } from '../../db/pool.js';
import { requireAuth } from '../../plugins/auth.js';
import { xpForNextLevel } from './service.js';

export async function achievementRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', async (req) => {
    const { rows } = await query(
      `SELECT id, slug, name, description, icon, xp_reward, sort_order FROM achievements
       WHERE is_active = true ORDER BY sort_order, slug`,
    );
    let earned = new Set<string>();
    if (req.userId) {
      const mine = await query('SELECT achievement_id FROM user_achievements WHERE user_id = $1', [req.userId]);
      earned = new Set(mine.rows.map((r) => r.achievement_id));
    }
    return {
      achievements: rows.map((a) => ({
        id: a.id,
        slug: a.slug,
        name: a.name,
        description: a.description,
        icon: a.icon,
        xpReward: a.xp_reward,
        earned: earned.has(a.id),
      })),
    };
  });

  app.get('/progress', { preHandler: [requireAuth] }, async (req) => {
    const settings = await getSettings();
    const { rows } = await query('SELECT xp, level FROM users WHERE id = $1', [req.userId]);
    const xp = Number(rows[0]?.xp ?? 0);
    const level = rows[0]?.level ?? 1;
    const currentLevelFloor = level > 1 ? xpForNextLevel(level - 1, settings.xpPerLevel) : 0;
    const nextLevelAt = xpForNextLevel(level, settings.xpPerLevel);
    return {
      xp,
      level,
      nextLevelAt,
      progress: nextLevelAt > currentLevelFloor ? Math.round(((xp - currentLevelFloor) / (nextLevelAt - currentLevelFloor)) * 100) : 0,
    };
  });
}
