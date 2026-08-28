import type { FastifyInstance } from 'fastify';
import { badRequest } from '../../core/errors.js';
import { getSettings } from '../../core/settings.js';
import { query } from '../../db/pool.js';
import { requireAuth } from '../../plugins/auth.js';
import { getIsoWeekKey } from '../quizzes/attempts.js';

const VALID_SCOPES = new Set([
  'global', 'country', 'category', 'group', 'daily', 'weekly', 'monthly',
  'friends', 'tournament', 'monthly_challenge', 'challenge',
]);

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  displayName: string;
  avatar: string;
  level: number;
  points: number;
  correct: number;
  totalTimeMs: number;
}

/**
 * Ranking engine ordering: points DESC, total time ASC, correct DESC,
 * earliest last-scored first (completion timestamp as the final tie-breaker).
 */
const RANK_ORDER = 'ls.points DESC, ls.total_time_ms ASC, ls.correct DESC, ls.last_scored_at ASC';

export async function fetchLeaderboard(
  scope: string,
  scopeKey: string,
  limit: number,
  forUserId?: string | null,
): Promise<{ entries: LeaderboardEntry[]; me: LeaderboardEntry | null; cachedAt: string | null }> {
  const settings = await getSettings();

  // serve from snapshot cache when fresh
  const snap = await query(
    `SELECT entries, computed_at FROM leaderboard_snapshots
     WHERE scope = $1 AND scope_key = $2 AND computed_at > now() - make_interval(secs => $3)`,
    [scope, scopeKey, settings.leaderboardCacheTtlSec],
  );
  let entries: LeaderboardEntry[];
  let cachedAt: string | null = null;
  if (snap.rows[0]) {
    entries = snap.rows[0].entries as LeaderboardEntry[];
    cachedAt = snap.rows[0].computed_at;
  } else {
    entries = await computeLeaderboard(scope, scopeKey, limit);
    await query(
      `INSERT INTO leaderboard_snapshots (scope, scope_key, entries) VALUES ($1,$2,$3)
       ON CONFLICT (scope, scope_key) DO UPDATE SET entries = $3, computed_at = now()`,
      [scope, scopeKey, JSON.stringify(entries)],
    );
  }

  let me: LeaderboardEntry | null = null;
  if (forUserId) {
    me = entries.find((e) => e.userId === forUserId) ?? null;
    if (!me) {
      const { rows } = await query(
        `SELECT ls.user_id, ls.points, ls.correct, ls.total_time_ms, u.username, u.display_name, u.avatar, u.level,
                (SELECT count(*) + 1 FROM leaderboard_scores l2
                  JOIN users u2 ON u2.id = l2.user_id AND u2.status = 'active' AND u2.is_guest = false
                  WHERE l2.scope = ls.scope AND l2.scope_key = ls.scope_key
                   AND (l2.points > ls.points
                     OR (l2.points = ls.points AND l2.total_time_ms < ls.total_time_ms)
                     OR (l2.points = ls.points AND l2.total_time_ms = ls.total_time_ms AND l2.correct > ls.correct))) AS rank
         FROM leaderboard_scores ls JOIN users u ON u.id = ls.user_id
         WHERE ls.scope = $1 AND ls.scope_key = $2 AND ls.user_id = $3`,
        [scope, scopeKey, forUserId],
      );
      if (rows[0]) {
        me = {
          rank: Number(rows[0].rank),
          userId: rows[0].user_id,
          username: rows[0].username,
          displayName: rows[0].display_name,
          avatar: rows[0].avatar,
          level: rows[0].level,
          points: Number(rows[0].points),
          correct: Number(rows[0].correct),
          totalTimeMs: Number(rows[0].total_time_ms),
        };
      }
    }
  }
  return { entries, me, cachedAt };
}

async function computeLeaderboard(scope: string, scopeKey: string, limit: number): Promise<LeaderboardEntry[]> {
  const { rows } = await query(
    `SELECT ls.user_id, ls.points, ls.correct, ls.total_time_ms,
            u.username, u.display_name, u.avatar, u.level
     FROM leaderboard_scores ls
     JOIN users u ON u.id = ls.user_id AND u.status = 'active' AND u.is_guest = false
     WHERE ls.scope = $1 AND ls.scope_key = $2
     ORDER BY ${RANK_ORDER} LIMIT $3`,
    [scope, scopeKey, limit],
  );
  return rows.map((r, i) => ({
    rank: i + 1,
    userId: r.user_id,
    username: r.username,
    displayName: r.display_name,
    avatar: r.avatar,
    level: r.level,
    points: Number(r.points),
    correct: Number(r.correct),
    totalTimeMs: Number(r.total_time_ms),
  }));
}

export async function leaderboardRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', async (req) => {
    const settings = await getSettings();
    const q = req.query as { scope?: string; key?: string; limit?: string };
    const scope = q.scope ?? 'global';
    if (!VALID_SCOPES.has(scope)) throw badRequest('Invalid leaderboard scope');
    const limit = Math.min(Number(q.limit ?? settings.leaderboardSize), 500);

    let key = q.key ?? '';
    const now = new Date();
    if (scope === 'daily' && !key) key = now.toISOString().slice(0, 10);
    if (scope === 'weekly' && !key) key = getIsoWeekKey(now);
    if (scope === 'monthly' && !key) key = now.toISOString().slice(0, 7);

    if (scope === 'friends') {
      if (!req.userId) throw badRequest('Authentication required for friends leaderboard');
      const { rows } = await query(
        `SELECT ls.user_id, ls.points, ls.correct, ls.total_time_ms, u.username, u.display_name, u.avatar, u.level
         FROM leaderboard_scores ls
         JOIN users u ON u.id = ls.user_id AND u.status = 'active'
         WHERE ls.scope = 'global' AND ls.scope_key = ''
           AND (ls.user_id = $1 OR ls.user_id IN (
             SELECT CASE WHEN f.user_id = $1 THEN f.friend_id ELSE f.user_id END
             FROM friendships f
             WHERE (f.user_id = $1 OR f.friend_id = $1) AND f.status = 'accepted'))
         ORDER BY ls.points DESC, ls.total_time_ms ASC, ls.correct DESC LIMIT $2`,
        [req.userId, limit],
      );
      return {
        scope,
        key: '',
        entries: rows.map((r, i) => ({
          rank: i + 1,
          userId: r.user_id,
          username: r.username,
          displayName: r.display_name,
          avatar: r.avatar,
          level: r.level,
          points: Number(r.points),
          correct: Number(r.correct),
          totalTimeMs: Number(r.total_time_ms),
        })),
        me: null,
      };
    }

    if (scope === 'group') {
      if (!key) throw badRequest('Group leaderboard requires key=<groupId>');
      const { rows } = await query(
        `SELECT gm.user_id, COALESCE(ls.points, 0) AS points, COALESCE(ls.correct, 0) AS correct,
                COALESCE(ls.total_time_ms, 0) AS total_time_ms,
                u.username, u.display_name, u.avatar, u.level
         FROM group_members gm
         JOIN users u ON u.id = gm.user_id AND u.status = 'active'
         LEFT JOIN leaderboard_scores ls ON ls.user_id = gm.user_id AND ls.scope = 'global' AND ls.scope_key = ''
         WHERE gm.group_id = $1
         ORDER BY COALESCE(ls.points, 0) DESC, COALESCE(ls.total_time_ms, 0) ASC LIMIT $2`,
        [key, limit],
      );
      return {
        scope,
        key,
        entries: rows.map((r, i) => ({
          rank: i + 1,
          userId: r.user_id,
          username: r.username,
          displayName: r.display_name,
          avatar: r.avatar,
          level: r.level,
          points: Number(r.points),
          correct: Number(r.correct),
          totalTimeMs: Number(r.total_time_ms),
        })),
        me: null,
      };
    }

    const { entries, me, cachedAt } = await fetchLeaderboard(scope, key, limit, req.userId);
    return { scope, key, entries, me, cachedAt };
  });

  /** current user's ranks across common scopes */
  app.get('/me', { preHandler: [requireAuth] }, async (req) => {
    const now = new Date();
    const scopes: Array<[string, string]> = [
      ['global', ''],
      ['daily', now.toISOString().slice(0, 10)],
      ['weekly', getIsoWeekKey(now)],
      ['monthly', now.toISOString().slice(0, 7)],
    ];
    const result: Record<string, unknown> = {};
    for (const [scope, key] of scopes) {
      const { me } = await fetchLeaderboard(scope, key, 1, req.userId);
      result[scope] = me;
    }
    return { ranks: result };
  });
}
