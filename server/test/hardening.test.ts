import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { query } from '../src/db/pool.js';
import { runJob } from '../src/jobs/scheduler.js';
import { toCsv } from '../src/modules/admin/importExport.js';
import { _resetLoginFailures } from '../src/modules/auth/service.js';
import { invalidateSessionCache } from '../src/plugins/auth.js';
import { api, closeAll, getApp, loginAs, makeAdmin, registerUser, resetDb, seedQuestion } from './helpers.js';

beforeAll(async () => {
  await getApp();
});
afterAll(async () => {
  await closeAll();
});

describe('hardening: information exposure and ownership', () => {
  beforeEach(async () => {
    await resetDb();
    _resetLoginFailures();
    invalidateSessionCache();
  });

  it('public profile never exposes email or plan', async () => {
    await registerUser('publicuser');
    const res = await api('/users/publicuser');
    expect(res.status).toBe(200);
    const user = (res.body as { user: Record<string, unknown> }).user;
    expect(user.username).toBe('publicuser');
    expect(user.email).toBeUndefined();
    expect(user.plan).toBeUndefined();
  });

  it('challenge summary is only visible to creator and participants', async () => {
    await seedQuestion({});
    await seedQuestion({});
    const creator = await registerUser('creator');
    const stranger = await registerUser('stranger');
    const created = await api('/challenges', { method: 'POST', token: creator.token, body: { title: 'x', questionCount: 2 } });
    expect(created.status).toBe(200);
    const id = (created.body as { challenge: { id: string } }).challenge.id ?? (created.body as { id: string }).id;
    expect((await api(`/challenges/${id}`, { token: creator.token })).status).toBe(200);
    expect((await api(`/challenges/${id}`, { token: stranger.token })).status).toBe(404);
    expect((await api('/challenges/not-a-uuid', { token: stranger.token })).status).toBe(404);
  });

  it('private groups and their leaderboards are hidden from non-members', async () => {
    const owner = await registerUser('gowner');
    const other = await registerUser('gother');
    const created = await api('/groups', { method: 'POST', token: owner.token, body: { name: 'Secret', isPublic: false } });
    expect(created.status).toBe(200);
    const id = (created.body as { group: { id: string } }).group?.id ?? (created.body as { id: string }).id;
    expect((await api(`/groups/${id}`, { token: owner.token })).status).toBe(200);
    expect((await api(`/groups/${id}`, { token: other.token })).status).toBe(404);
    expect((await api(`/leaderboards?scope=group&key=${id}`)).status).toBe(401);
    expect((await api(`/leaderboards?scope=group&key=${id}`, { token: other.token })).status).toBe(403);
    expect((await api(`/leaderboards?scope=group&key=${id}`, { token: owner.token })).status).toBe(200);
  });

  it('malformed ids are 400/404, never a database error', async () => {
    const admin = await registerUser('idadmin');
    await makeAdmin(admin.id);
    const token = await loginAs('idadmin');
    expect((await api('/admin/users/not-a-uuid', { token })).status).toBe(400);
    expect((await api('/notifications/read', { method: 'POST', token, body: { ids: ['nope'] } })).status).toBe(400);
    expect((await api('/quizzes/bookmarks/nope', { method: 'DELETE', token })).status).toBe(400);
  });

  it('settings values are shape-checked', async () => {
    const admin = await registerUser('setadmin');
    await makeAdmin(admin.id);
    const token = await loginAs('setadmin');
    expect((await api('/admin/settings', { method: 'PATCH', token, body: { pointsPerDifficulty: 'x' } })).status).toBe(400);
    expect((await api('/admin/settings', { method: 'PATCH', token, body: { defaultQuizSize: -5 } })).status).toBe(400);
    expect((await api('/admin/settings', { method: 'PATCH', token, body: { defaultQuizSize: 12 } })).status).toBe(200);
  });
});

// JWT iat has second precision: a token issued in the same second as an invalidation stays valid
const nextSecond = () => new Promise((r) => setTimeout(r, 1100));

describe('hardening: authentication lifecycle', () => {
  beforeEach(async () => {
    await resetDb();
    _resetLoginFailures();
    invalidateSessionCache();
  });

  it('locks an identifier after repeated failures and audits them', async () => {
    await registerUser('locky');
    for (let i = 0; i < 10; i++) {
      const r = await api('/auth/login', { method: 'POST', body: { identifier: 'locky', password: 'wrong-password' } });
      expect(r.status).toBe(401);
    }
    const locked = await api('/auth/login', { method: 'POST', body: { identifier: 'locky', password: 'Passw0rd123' } });
    expect(locked.status).toBe(429);
    const audits = await query(`SELECT count(*) AS n FROM audit_logs WHERE action = 'auth.login_failed'`);
    expect(Number(audits.rows[0].n)).toBe(10);
    _resetLoginFailures();
    expect((await api('/auth/login', { method: 'POST', body: { identifier: 'locky', password: 'Passw0rd123' } })).status).toBe(200);
  });

  it('a ban rejects live access tokens immediately', async () => {
    const victim = await registerUser('victim2');
    expect((await api('/users/me', { token: victim.token })).status).toBe(200);
    const admin = await registerUser('banadmin');
    await makeAdmin(admin.id);
    const adminToken = await loginAs('banadmin');
    const ban = await api(`/admin/users/${victim.id}/status`, { method: 'POST', token: adminToken, body: { status: 'banned' } });
    expect(ban.status).toBe(200);
    expect((await api('/users/me', { token: victim.token })).status).toBe(401);
    const audit = await query(`SELECT details, ip FROM audit_logs WHERE action = 'admin.user.banned'`);
    expect(audit.rows[0].details.previous).toBe('active');
    expect(audit.rows[0].ip).toBeTruthy();
  });

  it('a role change invalidates tokens issued before it', async () => {
    const target = await registerUser('promoted');
    await nextSecond();
    const admin = await registerUser('roleadmin');
    await makeAdmin(admin.id, 'super_admin');
    const adminToken = await loginAs('roleadmin');
    expect((await api(`/admin/users/${target.id}/role`, { method: 'POST', token: adminToken, body: { role: 'moderator' } })).status).toBe(200);
    expect((await api('/users/me', { token: target.token })).status).toBe(401);
    const fresh = await loginAs('promoted');
    const me = await api('/users/me', { token: fresh });
    expect((me.body as { user: { role: string } }).user.role).toBe('moderator');
  });

  it('password reset tokens are only echoed to the test suite and reset invalidates sessions', async () => {
    const u = await registerUser('resetme');
    await nextSecond();
    const req = await api('/auth/forgot-password', { method: 'POST', body: { email: 'resetme@test.com' } });
    expect(req.status).toBe(200);
    const token = (req.body as { resetToken?: string }).resetToken;
    expect(token).toBeTruthy();
    const reset = await api('/auth/reset-password', { method: 'POST', body: { token, password: 'NewPassw0rd!' } });
    expect(reset.status).toBe(200);
    expect((await api('/users/me', { token: u.token })).status).toBe(401);
  });

  it('enforces the auth rate limiter over HTTP when enabled', async () => {
    process.env.RATE_LIMIT_IN_TEST = '1';
    try {
      let last = 200;
      for (let i = 0; i < 12; i++) {
        last = (await api('/auth/guest', { method: 'POST', body: {} })).status;
        if (last === 429) break;
      }
      expect(last).toBe(429);
    } finally {
      delete process.env.RATE_LIMIT_IN_TEST;
    }
  });
});

describe('hardening: data integrity and operations', () => {
  beforeEach(async () => {
    await resetDb();
    invalidateSessionCache();
  });

  it('deleting an answered question archives it and keeps the answer history', async () => {
    const qid = await seedQuestion({});
    await seedQuestion({});
    const player = await registerUser('archplayer');
    const start = await api('/quizzes/start', { method: 'POST', token: player.token, body: { mode: 'practice', questionCount: 2 } });
    const { attemptId } = start.body as { attemptId: string };
    await api(`/quizzes/attempts/${attemptId}/answers`, { method: 'POST', token: player.token, body: { questionId: qid, answer: 'o1' } });
    const admin = await registerUser('delAdmin');
    await makeAdmin(admin.id);
    const token = await loginAs('delAdmin');
    const res = await api(`/admin/questions/${qid}`, { method: 'DELETE', token });
    expect(res.status).toBe(200);
    expect((res.body as { archived: boolean }).archived).toBe(true);
    const q = await query('SELECT status FROM questions WHERE id = $1', [qid]);
    expect(q.rows[0].status).toBe('archived');
    const answers = await query('SELECT count(*) AS n FROM attempt_answers WHERE question_id = $1', [qid]);
    expect(Number(answers.rows[0].n)).toBe(1);
    const fresh = await seedQuestion({});
    const res2 = await api(`/admin/questions/${fresh}`, { method: 'DELETE', token });
    expect((res2.body as { archived: boolean }).archived).toBe(false);
  });

  it('a small leaderboard request never shrinks the cached board for everyone', async () => {
    const users = await Promise.all(['lb1', 'lb2', 'lb3'].map((n) => registerUser(n)));
    for (const [i, u] of users.entries()) {
      await query(
        `INSERT INTO leaderboard_scores (user_id, scope, scope_key, points, correct, total_time_ms) VALUES ($1,'global','',$2,1,1000)`,
        [u.id, 100 - i * 10],
      );
    }
    const me = await api('/leaderboards/me', { token: users[2].token });
    expect(me.status).toBe(200);
    const board = await api('/leaderboards?scope=global&limit=10', { token: users[0].token });
    expect((board.body as { entries: unknown[] }).entries).toHaveLength(3);
    const two = await api('/leaderboards?scope=global&limit=2', { token: users[0].token });
    expect((two.body as { entries: unknown[] }).entries).toHaveLength(2);
    expect((two.body as { cachedAt: string | null }).cachedAt).toBeTruthy();
  });

  it('readiness reports database and job state', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; db: { ok: boolean; pool: { total: number } } };
    expect(body.ok).toBe(true);
    expect(body.db.ok).toBe(true);
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('runJob takes a cluster lock, records telemetry and skips overlapping runs', async () => {
    let calls = 0;
    const slow = async () => { calls++; await new Promise((r) => setTimeout(r, 150)); };
    const [a, b] = await Promise.all([runJob('test-job', slow), runJob('test-job', slow)]);
    expect([a, b].sort()).toEqual(['ok', 'skipped']);
    expect(calls).toBe(1);
    const failed = await runJob('test-job-fail', async () => { throw new Error('boom'); });
    expect(failed).toBe('error');
    const rows = await query(`SELECT name, last_status, last_error, runs FROM job_runs ORDER BY name`);
    const byName = Object.fromEntries(rows.rows.map((r) => [r.name, r]));
    expect(byName['test-job'].last_status).toBe('ok');
    expect(byName['test-job-fail'].last_status).toBe('error');
    expect(byName['test-job-fail'].last_error).toContain('boom');
  });

  it('CSV export neutralises spreadsheet formulas', () => {
    const csv = toCsv([['=SUM(A1)', '+1', 'plain', '@x']]);
    expect(csv).toContain("'=SUM(A1)");
    expect(csv).toContain("'+1");
    expect(csv).toContain(",plain,");
  });
});
