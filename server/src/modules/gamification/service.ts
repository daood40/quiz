import type { PoolClient } from 'pg';
import type { AppSettings } from '../../core/settings.js';

/** XP → level curve: cumulative XP needed for level L is xpPerLevel * T(L-1). */
export function levelFromXp(xp: number, xpPerLevel: number): number {
  let level = 1;
  while (xp >= xpPerLevel * ((level * (level + 1)) / 2)) level++;
  return level;
}

export function xpForNextLevel(level: number, xpPerLevel: number): number {
  return xpPerLevel * ((level * (level + 1)) / 2);
}

export async function awardXp(
  client: PoolClient,
  userId: string,
  amount: number,
  reason: string,
  refId: string | null,
  settings: AppSettings,
): Promise<{ newXp: number; newLevel: number; leveledUp: boolean }> {
  if (amount <= 0) {
    const cur = await client.query('SELECT xp, level FROM users WHERE id = $1', [userId]);
    return { newXp: Number(cur.rows[0]?.xp ?? 0), newLevel: cur.rows[0]?.level ?? 1, leveledUp: false };
  }
  await client.query('INSERT INTO xp_events (user_id, amount, reason, ref_id) VALUES ($1,$2,$3,$4)', [
    userId,
    amount,
    reason,
    refId,
  ]);
  const { rows } = await client.query(
    'UPDATE users SET xp = xp + $2, updated_at = now() WHERE id = $1 RETURNING xp, level',
    [userId, amount],
  );
  const newXp = Number(rows[0].xp);
  const newLevel = levelFromXp(newXp, settings.xpPerLevel);
  const leveledUp = newLevel > rows[0].level;
  if (leveledUp) await client.query('UPDATE users SET level = $2 WHERE id = $1', [userId, newLevel]);
  return { newXp, newLevel, leveledUp };
}

/** Returns today's date string in the user's timezone (falls back to UTC). */
export function localDate(tz: string, at: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'UTC' }).format(at); // YYYY-MM-DD
  } catch {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(at);
  }
}

/**
 * Timezone-aware daily streak update. Same day → unchanged; consecutive day →
 * +1; exactly one missed day with a banked streak freeze → freeze consumed and
 * the streak survives (Duolingo-style); otherwise reset to 1. Milestones bank
 * an extra freeze (capped) and are returned for notifications.
 */
export async function touchStreak(
  client: PoolClient,
  userId: string,
  settings: AppSettings,
): Promise<{ current: number; longest: number; milestone: number | null; freezeUsed: boolean }> {
  const { rows } = await client.query(
    `SELECT current_streak, longest_streak, timezone, streak_freezes,
            to_char(last_activity_date, 'YYYY-MM-DD') AS last_date
     FROM users WHERE id = $1 FOR UPDATE`,
    [userId],
  );
  const u = rows[0];
  const today = localDate(u.timezone);
  const last: string | null = u.last_date;
  let current: number = u.current_streak;
  if (last === today) {
    return { current, longest: u.longest_streak, milestone: null, freezeUsed: false };
  }
  const dayBefore = (iso: string, days: number): string => {
    const d = new Date(`${iso}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().slice(0, 10);
  };
  let freezeUsed = false;
  let freezes: number = u.streak_freezes;
  if (last === dayBefore(today, 1)) {
    current = current + 1;
  } else if (last === dayBefore(today, 2) && freezes > 0) {
    freezes -= 1;
    freezeUsed = true;
    current = current + 1; // the missed day is absorbed by the freeze
  } else {
    current = 1;
  }
  const longest = Math.max(current, u.longest_streak);
  const milestone = settings.streakMilestones.includes(current) ? current : null;
  if (milestone && milestone >= 3) freezes = Math.min(settings.streakFreezeCap, freezes + 1);
  await client.query(
    `UPDATE users SET current_streak = $2, longest_streak = $3, last_activity_date = $4,
       streak_freezes = $5, updated_at = now() WHERE id = $1`,
    [userId, current, longest, today, freezes],
  );
  return { current, longest, milestone, freezeUsed };
}

/**
 * Evaluates criteria-driven achievements against the user's aggregates and
 * grants the ones newly earned. Criteria: {"metric": "...", "gte": N}.
 */
export async function evaluateAchievements(
  client: PoolClient,
  userId: string,
  settings: AppSettings,
): Promise<Array<{ id: string; slug: string; name: unknown; xpReward: number }>> {
  const { rows: metricRows } = await client.query(
    `SELECT u.current_streak, u.longest_streak, u.level, u.total_points,
            s.quizzes_completed, s.correct_total, s.perfect_quizzes, s.questions_answered
     FROM users u JOIN user_stats s ON s.user_id = u.id WHERE u.id = $1`,
    [userId],
  );
  if (!metricRows[0]) return [];
  const m = metricRows[0];
  const metrics: Record<string, number> = {
    quizzes_completed: Number(m.quizzes_completed),
    correct_total: Number(m.correct_total),
    questions_answered: Number(m.questions_answered),
    perfect_quizzes: Number(m.perfect_quizzes),
    current_streak: Number(m.current_streak),
    longest_streak: Number(m.longest_streak),
    level: Number(m.level),
    total_points: Number(m.total_points),
  };
  const { rows: candidates } = await client.query(
    `SELECT a.id, a.slug, a.name, a.criteria, a.xp_reward FROM achievements a
     WHERE a.is_active = true
       AND NOT EXISTS (SELECT 1 FROM user_achievements ua WHERE ua.user_id = $1 AND ua.achievement_id = a.id)`,
    [userId],
  );
  const earned: Array<{ id: string; slug: string; name: unknown; xpReward: number }> = [];
  for (const a of candidates) {
    const c = a.criteria as { metric?: string; gte?: number };
    if (!c?.metric || typeof c.gte !== 'number') continue;
    const value = metrics[c.metric];
    if (value !== undefined && value >= c.gte) {
      const inserted = await client.query(
        'INSERT INTO user_achievements (user_id, achievement_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING 1',
        [userId, a.id],
      );
      if (inserted.rowCount) {
        earned.push({ id: a.id, slug: a.slug, name: a.name, xpReward: a.xp_reward });
        if (a.xp_reward > 0) await awardXp(client, userId, a.xp_reward, 'achievement', a.id, settings);
      }
    }
  }
  return earned;
}
