import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { migrate } from '../src/db/migrate.js';
import { pool, query } from '../src/db/pool.js';

let app: FastifyInstance | null = null;

export async function getApp(): Promise<FastifyInstance> {
  if (!app) {
    await migrate();
    app = await buildApp();
    await app.ready();
  }
  return app;
}

export async function resetDb(): Promise<void> {
  await query(`
    TRUNCATE users, refresh_tokens, password_reset_tokens, email_verification_tokens,
      categories, questions, question_stats, question_reports, quizzes, attempts,
      attempt_answers, suspicious_events, challenges, challenge_participants,
      monthly_challenges, tournaments, tournament_participants, tournament_rounds,
      tournament_matches, groups, group_members, friendships, achievements,
      user_achievements, xp_events, user_stats, daily_activity, leaderboard_scores,
      leaderboard_snapshots, notifications, app_settings, audit_logs, analytics_events
    RESTART IDENTITY CASCADE`);
  const { invalidateSettingsCache } = await import('../src/core/settings.js');
  invalidateSettingsCache();
}

export async function closeAll(): Promise<void> {
  if (app) await app.close();
  app = null;
  await pool.end().catch(() => undefined);
}

interface InjectOpts {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  token?: string;
  body?: unknown;
}

export async function api(url: string, opts: InjectOpts = {}) {
  const a = await getApp();
  const res = await a.inject({
    method: opts.method ?? 'GET',
    url: `/api/v1${url}`,
    headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {},
    payload: opts.body as never,
  });
  let json: unknown = null;
  try {
    json = res.json();
  } catch {
    /* non-JSON */
  }
  return { status: res.statusCode, body: json as never };
}

export async function registerUser(username: string, opts: { country?: string } = {}) {
  const res = await api('/auth/register', {
    method: 'POST',
    body: {
      email: `${username}@test.com`,
      username,
      password: 'Passw0rd123',
      country: opts.country,
    },
  });
  if (res.status !== 200) throw new Error(`register failed: ${JSON.stringify(res.body)}`);
  const body = res.body as { user: { id: string }; accessToken: string; refreshToken: string };
  return { id: body.user.id, token: body.accessToken, refreshToken: body.refreshToken };
}

export async function makeAdmin(userId: string, role = 'super_admin'): Promise<void> {
  await query('UPDATE users SET role = $2 WHERE id = $1', [userId, role]);
}

/** Re-login so the JWT carries the updated role. */
export async function loginAs(username: string) {
  const res = await api('/auth/login', {
    method: 'POST',
    body: { identifier: `${username}@test.com`, password: 'Passw0rd123' },
  });
  const body = res.body as { accessToken: string };
  return body.accessToken;
}

export async function seedCategory(slug = 'science'): Promise<string> {
  const { rows } = await query(
    `INSERT INTO categories (slug, name) VALUES ($1, $2)
     ON CONFLICT (slug) DO UPDATE SET slug = $1 RETURNING id`,
    [slug, JSON.stringify({ en: slug, ar: slug })],
  );
  return rows[0].id;
}

export async function seedQuestion(overrides: Partial<{
  type: string;
  categoryId: string | null;
  difficulty: string;
  content: Record<string, unknown>;
  correct: unknown;
  config: Record<string, unknown>;
  points: number;
  timeLimitSec: number | null;
  status: string;
}> = {}): Promise<string> {
  const content = overrides.content ?? {
    prompt: { en: `Question ${Math.random().toString(36).slice(2)}` },
    options: [
      { id: 'o1', text: 'Right' },
      { id: 'o2', text: 'Wrong A' },
      { id: 'o3', text: 'Wrong B' },
    ],
  };
  const { rows } = await query(
    `INSERT INTO questions (type, category_id, difficulty, language, content, correct_answer, configuration,
       points, time_limit_sec, status, content_hash)
     VALUES ($1,$2,$3,'en',$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [
      overrides.type ?? 'multiple_choice',
      overrides.categoryId ?? null,
      overrides.difficulty ?? 'easy',
      JSON.stringify(content),
      JSON.stringify(overrides.correct ?? 'o1'),
      JSON.stringify(overrides.config ?? {}),
      overrides.points ?? 10,
      overrides.timeLimitSec ?? 30,
      overrides.status ?? 'approved',
      Math.random().toString(36),
    ],
  );
  await query('INSERT INTO question_stats (question_id) VALUES ($1)', [rows[0].id]);
  return rows[0].id;
}
