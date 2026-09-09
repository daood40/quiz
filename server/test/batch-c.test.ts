/**
 * Batch C hardening: pagination guards, id validation, case-insensitive usernames, anchored lockout,
 * idempotent solo start, account-deletion scrub, /metrics token gate, refresh-token reuse detection,
 * and the retry-after header on 429s.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { query } from '../src/db/pool.js';
import { _testReset } from '../src/core/rateLimit.js';
import { _resetLoginFailures } from '../src/modules/auth/service.js';
import { invalidateSessionCache } from '../src/plugins/auth.js';
import { api, closeAll, getApp, loginAs, makeAdmin, registerUser, resetDb, seedQuestion } from './helpers.js';

beforeAll(async () => {
  await getApp();
});
afterAll(async () => {
  await closeAll();
});

type Err = { error: { code: string; message: string } };

/** audit() is fire-and-forget: wait (≤ 2s) for a row to land. */
async function waitForAudit(action: string, timeoutMs = 2000): Promise<number> {
  const started = Date.now();
  for (;;) {
    const { rows } = await query<{ n: string }>('SELECT count(*) AS n FROM audit_logs WHERE action = $1', [action]);
    const n = Number(rows[0].n);
    if (n > 0 || Date.now() - started > timeoutMs) return n;
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe('pagination hardening', () => {
  beforeEach(resetDb);

  it('garbage limit/offset never reach SQL', async () => {
    const u = await registerUser('pager');
    const n = await api('/notifications?limit=abc&offset=-1', { token: u.token });
    expect(n.status).toBe(200);
    expect(Array.isArray((n.body as { notifications: unknown[] }).notifications)).toBe(true);
    expect((await api('/leaderboards?limit=NaN')).status).toBe(200);
    expect((await api('/leaderboards?limit=1e9&scope=global')).status).toBe(200);
    expect((await api('/quizzes/attempts?limit=1e9', { token: u.token })).status).toBe(200);
    expect((await api('/quizzes/attempts?limit=0&offset=99999999999999', { token: u.token })).status).toBe(200);
    expect((await api('/quizzes/attempts?limit=5&limit=5', { token: u.token })).status).toBe(200); // array value
  });
});

describe('malformed :id parameters', () => {
  beforeEach(resetDb);

  it('are 400 bad_request on public/owned resources and 404 where enumeration must stay hidden', async () => {
    const u = await registerUser('idguy');
    const t = await api('/tournaments/not-a-uuid');
    expect(t.status).toBe(400);
    expect((t.body as Err).error.code).toBe('bad_request');
    const g = await api('/groups/not-a-uuid', { token: u.token });
    expect(g.status).toBe(400);
    expect((g.body as Err).error.code).toBe('bad_request');
    for (const path of ['/quizzes/attempts/not-a-uuid/submit', '/quizzes/attempts/not-a-uuid/answers', '/quizzes/attempts/not-a-uuid/powerups']) {
      const r = await api(path, { method: 'POST', token: u.token, body: { questionId: 'x', answer: 'o1', type: 'fiftyFifty' } });
      expect(r.status, path).toBe(400);
    }
    expect((await api('/quizzes/attempts/not-a-uuid/review', { token: u.token })).status).toBe(400);
    expect((await api('/quizzes/attempts/not-a-uuid', { token: u.token })).status).toBe(400);
    expect((await api('/tournaments/not-a-uuid/join', { method: 'POST', token: u.token })).status).toBe(400);
    expect((await api('/groups/not-a-uuid/leave', { method: 'POST', token: u.token })).status).toBe(400);
    expect((await api('/friends/not-a-uuid', { method: 'DELETE', token: u.token })).status).toBe(400);
    // deliberate: a challenge id is a shared secret, so a bad one looks exactly like a missing one
    const c = await api('/challenges/not-a-uuid', { token: u.token });
    expect(c.status).toBe(404);
    expect((c.body as Err).error.code).toBe('not_found');
    const admin = await registerUser('idadmin2');
    await makeAdmin(admin.id);
    const token = await loginAs('idadmin2');
    expect((await api('/admin/questions/not-a-uuid', { method: 'DELETE', token })).status).toBe(404);
    expect((await api('/admin/questions/not-a-uuid', { token })).status).toBe(400);
    expect((await api('/admin/questions/not-a-uuid/status', { method: 'POST', token, body: { status: 'approved' } })).status).toBe(400);
    expect((await api('/admin/categories/not-a-uuid', { method: 'DELETE', token })).status).toBe(400);
    // a syntactically valid but unknown id is a clean 404, never 500
    expect((await api('/tournaments/00000000-0000-4000-8000-000000000000')).status).toBe(404);
  });
});

describe('username case-insensitivity', () => {
  beforeEach(resetDb);

  it('rejects a case-variant duplicate, logs in and resolves profiles regardless of case', async () => {
    await registerUser('Ahmed');
    const dupe = await api('/auth/register', {
      method: 'POST',
      body: { email: 'other@test.com', username: 'ahmed', password: 'Passw0rd123' },
    });
    expect(dupe.status).toBe(409);
    const upper = await api('/auth/register', {
      method: 'POST',
      body: { email: 'third@test.com', username: 'AHMED', password: 'Passw0rd123' },
    });
    expect(upper.status).toBe(409);
    const login = await api('/auth/login', { method: 'POST', body: { identifier: 'AHMED', password: 'Passw0rd123' } });
    expect(login.status).toBe(200);
    expect((login.body as { user: { username: string } }).user.username).toBe('Ahmed');
    const profile = await api('/users/AHMED');
    expect(profile.status).toBe(200);
    expect((profile.body as { user: { username: string } }).user.username).toBe('Ahmed');
    // the database index backs the application check (a race between two registrations cannot slip through)
    await expect(query(`INSERT INTO users (username, display_name) VALUES ('aHMed', 'x')`)).rejects.toThrow(/idx_users_username_lower|duplicate key/);
  });
});

describe('login lockout window', () => {
  beforeEach(async () => {
    await resetDb();
    _resetLoginFailures();
  });

  it('locks after 10 failures; the right password and an 11th failure are both refused without extending the lock', async () => {
    await registerUser('anchored');
    for (let i = 0; i < 10; i++) {
      expect((await api('/auth/login', { method: 'POST', body: { identifier: 'anchored', password: 'nope-nope' } })).status).toBe(401);
    }
    const locked = await api('/auth/login', { method: 'POST', body: { identifier: 'anchored', password: 'nope-nope' } });
    expect(locked.status).toBe(429);
    expect((locked.body as Err).error.code).toBe('too_many_attempts');
    const rightPassword = await api('/auth/login', { method: 'POST', body: { identifier: 'anchored', password: 'Passw0rd123' } });
    expect(rightPassword.status).toBe(429);
    expect((rightPassword.body as Err).error.code).toBe('too_many_attempts');
    // the identifier is normalised, so case/whitespace variants share the lock
    expect((await api('/auth/login', { method: 'POST', body: { identifier: '  ANCHORED ', password: 'Passw0rd123' } })).status).toBe(429);
    // "not extended": the failure map is private, so we assert on the only code path that could move the
    // lock — a recorded failure. Attempts during the lock are refused *before* being counted, so the
    // login_failed audit count stays at exactly 10 and login_locked rows appear instead.
    await waitForAudit('auth.login_locked');
    const failed = await query<{ n: string }>(`SELECT count(*) AS n FROM audit_logs WHERE action = 'auth.login_failed'`);
    expect(Number(failed.rows[0].n)).toBe(10);
    const lockedAudits = await query<{ n: string }>(`SELECT count(*) AS n FROM audit_logs WHERE action = 'auth.login_locked'`);
    expect(Number(lockedAudits.rows[0].n)).toBeGreaterThanOrEqual(3);
    // another identifier is unaffected
    await registerUser('bystander');
    expect((await api('/auth/login', { method: 'POST', body: { identifier: 'bystander', password: 'Passw0rd123' } })).status).toBe(200);
  });
});

describe('idempotent solo start', () => {
  beforeEach(resetDb);

  it('re-sending the same start within 20s returns the untouched attempt; answering breaks the idempotency', async () => {
    for (let i = 0; i < 5; i++) await seedQuestion({});
    const u = await registerUser('retrier');
    const body = { mode: 'practice', questionCount: 3 };
    const first = await api('/quizzes/start', { method: 'POST', token: u.token, body });
    expect(first.status).toBe(200);
    const a1 = first.body as { attemptId: string; resumed?: boolean; questions: Array<{ id: string }> };
    expect(a1.resumed).toBeFalsy();
    const second = await api('/quizzes/start', { method: 'POST', token: u.token, body });
    expect(second.status).toBe(200);
    const a2 = second.body as { attemptId: string; resumed?: boolean; questions: Array<{ id: string }> };
    expect(a2.attemptId).toBe(a1.attemptId);
    expect(a2.resumed).toBe(true);
    expect(a2.questions.map((q) => q.id).sort()).toEqual(a1.questions.map((q) => q.id).sort());
    expect(JSON.stringify(a2.questions)).not.toContain('correct');
    const attempts = await query<{ n: string }>('SELECT count(*) AS n FROM attempts WHERE user_id = $1', [u.id]);
    expect(Number(attempts.rows[0].n)).toBe(1);
    // a different mode is a different attempt (never resumes someone's practice as timed)
    const timed = await api('/quizzes/start', { method: 'POST', token: u.token, body: { mode: 'timed', questionCount: 3 } });
    expect((timed.body as { attemptId: string }).attemptId).not.toBe(a1.attemptId);
    // once a question is answered the attempt is "touched": a new start is a new attempt
    const ans = await api(`/quizzes/attempts/${a1.attemptId}/answers`, { method: 'POST', token: u.token, body: { questionId: a1.questions[0].id, answer: 'o1' } });
    expect(ans.status).toBe(200);
    const third = await api('/quizzes/start', { method: 'POST', token: u.token, body });
    expect(third.status).toBe(200);
    const a3 = third.body as { attemptId: string; resumed?: boolean };
    expect(a3.attemptId).not.toBe(a1.attemptId);
    expect(a3.resumed).toBeFalsy();
    // another user never receives my attempt
    const other = await registerUser('retrier2');
    const theirs = await api('/quizzes/start', { method: 'POST', token: other.token, body });
    expect((theirs.body as { attemptId: string }).attemptId).not.toBe(a3.attemptId);
  });
});

describe('account deletion scrub', () => {
  beforeEach(resetDb);

  it('removes personal rows, blanks audit IPs and rewrites cached leaderboard entries', async () => {
    for (let i = 0; i < 3; i++) await seedQuestion({});
    const me = await registerUser('scrubme');
    const friend = await registerUser('scrubfriend');
    const qid = (await query<{ id: string }>('SELECT id FROM questions LIMIT 1')).rows[0].id;
    expect((await api(`/quizzes/bookmarks/${qid}`, { method: 'POST', token: me.token })).status).toBe(200);
    expect((await api('/friends/request', { method: 'POST', token: me.token, body: { username: 'scrubfriend' } })).status).toBe(200);
    expect((await api('/friends/respond', { method: 'POST', token: friend.token, body: { userId: me.id, accept: true } })).status).toBe(200);
    await query(`INSERT INTO notifications (user_id, kind, title) VALUES ($1, 'system', '{"en":"hi"}')`, [me.id]);
    // one competitive round so the user has a leaderboard row, then build the cached snapshot
    const start = await api('/quizzes/start', { method: 'POST', token: me.token, body: { mode: 'timed', questionCount: 2 } });
    const { attemptId, questions } = start.body as { attemptId: string; questions: Array<{ id: string }> };
    for (const q of questions) await api(`/quizzes/attempts/${attemptId}/answers`, { method: 'POST', token: me.token, body: { questionId: q.id, answer: 'o1' } });
    expect((await api(`/quizzes/attempts/${attemptId}/submit`, { method: 'POST', token: me.token })).status).toBe(200);
    const board = await api('/leaderboards?scope=global');
    expect(JSON.stringify(board.body)).toContain('scrubme');
    const snapBefore = await query<{ entries: string }>(`SELECT entries::text AS entries FROM leaderboard_snapshots WHERE scope = 'global'`);
    expect(snapBefore.rows[0].entries).toContain('scrubme');
    await waitForAudit('auth.register');

    // wrong password → nothing happens
    expect((await api('/auth/account', { method: 'DELETE', token: me.token, body: { password: 'wrong' } })).status).toBe(401);
    expect((await query('SELECT status FROM users WHERE id = $1', [me.id])).rows[0].status).toBe('active');
    const del = await api('/auth/account', { method: 'DELETE', token: me.token, body: { password: 'Passw0rd123' } });
    expect(del.status).toBe(200);

    const user = (await query<{ status: string; username: string; email: string | null; password_hash: string | null; display_name: string }>(
      'SELECT status, username, email, password_hash, display_name FROM users WHERE id = $1', [me.id])).rows[0];
    expect(user.status).toBe('deleted');
    expect(user.username.startsWith('deleted_')).toBe(true);
    expect(user.email).toBeNull();
    expect(user.password_hash).toBeNull();
    const count = async (sql: string) => Number((await query<{ n: string }>(sql, [me.id])).rows[0].n);
    expect(await count('SELECT count(*) AS n FROM question_bookmarks WHERE user_id = $1')).toBe(0);
    expect(await count('SELECT count(*) AS n FROM friendships WHERE user_id = $1 OR friend_id = $1')).toBe(0);
    expect(await count('SELECT count(*) AS n FROM notifications WHERE user_id = $1')).toBe(0);
    expect(await count('SELECT count(*) AS n FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL')).toBe(0);
    await waitForAudit('auth.account_deleted');
    expect(await count(`SELECT count(*) AS n FROM audit_logs WHERE actor_id = $1 AND ip <> ''`)).toBe(0);
    expect(await count('SELECT count(*) AS n FROM audit_logs WHERE actor_id = $1')).toBeGreaterThan(0); // history kept, IP gone
    const snapAfter = await query<{ entries: string }>(`SELECT entries::text AS entries FROM leaderboard_snapshots WHERE scope = 'global'`);
    expect(snapAfter.rows[0].entries).not.toContain('scrubme');
    expect(snapAfter.rows[0].entries).toContain('deleted_');
    // attempts stay for aggregate integrity, tied to the anonymised row
    expect(await count('SELECT count(*) AS n FROM attempts WHERE user_id = $1')).toBe(1);
    // the account is gone from every public surface and cannot log in again
    invalidateSessionCache();
    expect((await api('/users/scrubme')).status).toBe(404);
    expect((await api('/users/me', { token: me.token })).status).toBe(401);
    expect((await api('/auth/login', { method: 'POST', body: { identifier: 'scrubme@test.com', password: 'Passw0rd123' } })).status).toBe(401);
    expect((await api('/auth/refresh', { method: 'POST', body: { refreshToken: me.refreshToken } })).status).toBe(401);
    // the friend no longer sees the deleted user
    const friends = await api('/friends', { token: friend.token });
    expect(JSON.stringify(friends.body)).not.toContain('scrubme');
  });
});

describe('/metrics exposure', () => {
  // NODE_ENV is 'test' for the whole suite, so the production fail-closed branch
  // (no METRICS_TOKEN ⇒ 404) is documented here and covered by review, not executed:
  //   if (!token && process.env.NODE_ENV === 'production') → 404 not_found
  it('serves without a token outside production and enforces the token when one is set', async () => {
    const app = await getApp();
    delete process.env.METRICS_TOKEN;
    const open = await app.inject({ method: 'GET', url: '/metrics' });
    expect(open.statusCode).toBe(200);
    expect(open.body).toContain('http_requests_total');
    process.env.METRICS_TOKEN = 'scrape-secret';
    try {
      expect((await app.inject({ method: 'GET', url: '/metrics' })).statusCode).toBe(401);
      expect((await app.inject({ method: 'GET', url: '/metrics', headers: { authorization: 'Bearer wrong' } })).statusCode).toBe(401);
      const ok = await app.inject({ method: 'GET', url: '/metrics', headers: { authorization: 'Bearer scrape-secret' } });
      expect(ok.statusCode).toBe(200);
      expect(ok.body).toContain('db_pool_connections');
    } finally {
      delete process.env.METRICS_TOKEN;
    }
  });
});

describe('refresh-token reuse detection', () => {
  beforeEach(async () => {
    await resetDb();
    invalidateSessionCache();
  });

  it('replaying a rotated token revokes every session of the user and is audited', async () => {
    const u = await registerUser('rotator');
    const r1 = await api('/auth/refresh', { method: 'POST', body: { refreshToken: u.refreshToken } });
    expect(r1.status).toBe(200);
    const pair2 = r1.body as { accessToken: string; refreshToken: string };
    expect(pair2.refreshToken).not.toBe(u.refreshToken);
    // legitimate use of the new token is still fine before any reuse happens
    expect((await api('/users/me', { token: pair2.accessToken })).status).toBe(200);
    await new Promise((r) => setTimeout(r, 1100)); // JWT iat has second precision
    // replay of the OLD (already rotated) token
    const replay = await api('/auth/refresh', { method: 'POST', body: { refreshToken: u.refreshToken } });
    expect(replay.status).toBe(401);
    expect(await waitForAudit('auth.refresh_reuse')).toBe(1);
    // the chain is considered leaked: the NEW token is dead too
    const r2 = await api('/auth/refresh', { method: 'POST', body: { refreshToken: pair2.refreshToken } });
    expect(r2.status).toBe(401);
    const live = await query<{ n: string }>('SELECT count(*) AS n FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL', [u.id]);
    expect(Number(live.rows[0].n)).toBe(0);
    // and access tokens issued before the reuse are rejected as soon as the session cache refreshes
    invalidateSessionCache(u.id);
    expect((await api('/users/me', { token: pair2.accessToken })).status).toBe(401);
    // the dead new token being replayed is itself a reuse: audited again, still 401, no exception
    expect(await waitForAudit('auth.refresh_reuse')).toBe(2);
    // the user can start over with a fresh login
    expect((await api('/auth/login', { method: 'POST', body: { identifier: 'rotator', password: 'Passw0rd123' } })).status).toBe(200);
  });
});

describe('rate limit responses', () => {
  beforeEach(async () => {
    await resetDb();
    _resetLoginFailures();
    _testReset();
  });

  it('carry a numeric retry-after header and the rate_limited error code', async () => {
    const app = await getApp();
    process.env.RATE_LIMIT_IN_TEST = '1';
    try {
      let hit: { statusCode: number; headers: Record<string, unknown>; json: () => unknown } | null = null;
      // distinct identifiers so the per-identifier lockout (10 failures) cannot be what trips first
      for (let i = 0; i < 12; i++) {
        const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { identifier: `ghost${i}`, password: 'whatever1' } });
        if (res.statusCode === 429) { hit = res; break; }
        expect(res.statusCode).toBe(401);
      }
      expect(hit).not.toBeNull();
      const retry = Number(hit!.headers['retry-after']);
      expect(Number.isInteger(retry)).toBe(true);
      expect(retry).toBeGreaterThanOrEqual(1);
      expect(retry).toBeLessThanOrEqual(60);
      expect((hit!.json() as Err).error.code).toBe('rate_limited');
      expect(hit!.headers['cache-control']).toBe('no-store');
    } finally {
      delete process.env.RATE_LIMIT_IN_TEST;
      _testReset();
    }
  });
});
