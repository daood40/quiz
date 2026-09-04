import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { query } from '../src/db/pool.js';
import { api, closeAll, getApp, loginAs, makeAdmin, registerUser, resetDb, seedQuestion } from './helpers.js';

beforeAll(async () => { await getApp(); });
afterAll(async () => { await closeAll(); });

describe('RBAC tiers and guests', () => {
  beforeEach(resetDb);

  it('guests can play but cannot use account-only social features', async () => {
    const guest = await api('/auth/guest', { method: 'POST', body: {} });
    expect(guest.status).toBe(200);
    const token = (guest.body as { accessToken: string }).accessToken;
    expect((await api('/friends', { token })).status).toBe(403);
    expect((await api('/groups', { method: 'POST', token, body: { name: 'x' } })).status).toBe(403);
    expect((await api('/users/me', { token })).status).toBe(200);
  });

  it('moderator < editor < admin boundaries hold on staff routes', async () => {
    const mod = await registerUser('modx'); await makeAdmin(mod.id, 'moderator');
    const ed = await registerUser('edx'); await makeAdmin(ed.id, 'editor');
    const modToken = await loginAs('modx');
    const edToken = await loginAs('edx');
    // editor-only: AI status + question authoring
    expect((await api('/admin/ai/status', { token: modToken })).status).toBe(403);
    expect((await api('/admin/ai/status', { token: edToken })).status).toBe(200);
    expect((await api('/admin/questions/validate', { method: 'POST', token: modToken, body: {} })).status).toBe(403);
    // admin-only: settings + role changes, even for editors
    expect((await api('/admin/settings', { token: edToken })).status).toBe(403);
    expect((await api(`/admin/users/${mod.id}/role`, { method: 'POST', token: edToken, body: { role: 'user' } })).status).toBe(403);
    // moderator can read the review queue
    expect((await api('/admin/questions?limit=5', { token: modToken })).status).toBe(200);
    // forbidden bodies keep the uniform error shape
    const res = await api('/admin/settings', { token: edToken });
    expect((res.body as { error: { code: string } }).error.code).toBe('forbidden');
  });
});

describe('time extension power-up', () => {
  beforeEach(resetDb);

  it('extends the server deadline once per question and decrements the quota', async () => {
    for (let i = 0; i < 3; i++) await seedQuestion({});
    const u = await registerUser('extender');
    const start = await api('/quizzes/start', { method: 'POST', token: u.token, body: { mode: 'timed', questionCount: 3 } });
    const { attemptId, questions, powerups } = start.body as { attemptId: string; questions: Array<{ id: string }>; powerups: { timeExtend: number } };
    expect(powerups.timeExtend).toBeGreaterThan(0);
    const before = await query('SELECT deadline_at FROM attempts WHERE id = $1', [attemptId]);
    const res = await api(`/quizzes/attempts/${attemptId}/powerups`, { method: 'POST', token: u.token, body: { kind: 'time_extend', questionId: questions[0].id } });
    expect(res.status).toBe(200);
    const body = res.body as { addedSec: number; remaining: number };
    expect(body.addedSec).toBeGreaterThan(0);
    expect(body.remaining).toBe(powerups.timeExtend - 1);
    const after = await query('SELECT deadline_at FROM attempts WHERE id = $1', [attemptId]);
    const delta = (new Date(after.rows[0].deadline_at).getTime() - new Date(before.rows[0].deadline_at).getTime()) / 1000;
    expect(Math.round(delta)).toBe(body.addedSec);
    // same question again → conflict; quota unchanged
    const again = await api(`/quizzes/attempts/${attemptId}/powerups`, { method: 'POST', token: u.token, body: { kind: 'time_extend', questionId: questions[0].id } });
    expect(again.status).toBe(409);
    // another player cannot touch this attempt
    const other = await registerUser('other');
    expect((await api(`/quizzes/attempts/${attemptId}/powerups`, { method: 'POST', token: other.token, body: { kind: 'time_extend', questionId: questions[1].id } })).status).toBe(403);
  });
});
