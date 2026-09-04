import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { query } from '../src/db/pool.js';
import { _resetAiProvider } from '../src/modules/ai/provider.js';
import { isSourceLocked } from '../src/modules/ai/routes.js';
import { api, closeAll, getApp, loginAs, makeAdmin, registerUser, resetDb, seedCategory } from './helpers.js';

beforeAll(async () => {
  await getApp();
});
afterAll(async () => {
  await closeAll();
});

async function editor(name: string): Promise<string> {
  const u = await registerUser(name);
  await makeAdmin(u.id, 'editor');
  return loginAs(name);
}

describe('AI gateway', () => {
  beforeEach(async () => {
    await resetDb();
    delete process.env.AI_PROVIDER;
    _resetAiProvider();
  });

  it('is disabled by default and never reachable by regular users', async () => {
    const cat = await seedCategory('science');
    const user = await registerUser('plainuser');
    expect((await api('/admin/ai/status', { token: user.token })).status).toBe(403);
    const token = await editor('ed1');
    const status = await api('/admin/ai/status', { token });
    expect(status.status).toBe(200);
    expect((status.body as { enabled: boolean; sourceLock: boolean }).enabled).toBe(false);
    const res = await api('/admin/ai/draft-questions', { method: 'POST', token, body: { categoryId: cat, count: 3 } });
    expect(res.status).toBe(503);
  });

  it('SOURCE_LOCK refuses religious categories before touching any provider', async () => {
    process.env.AI_PROVIDER = 'mock';
    _resetAiProvider();
    const token = await editor('ed2');
    const { rows } = await query(
      `INSERT INTO categories (slug, name, icon, sort_order) VALUES ('islamic', '{"en":"Islamic knowledge","ar":"معلومات إسلامية"}', '🕌', 1) RETURNING id`,
    );
    const res = await api('/admin/ai/draft-questions', { method: 'POST', token, body: { categoryId: rows[0].id, count: 2 } });
    expect(res.status).toBe(403);
    expect((res.body as { error: { message: string } }).error.message).toContain('SOURCE_LOCK');
    const blocked = await query(`SELECT status FROM ai_requests`);
    expect(blocked.rows[0].status).toBe('blocked');
    const drafts = await query(`SELECT count(*) AS n FROM questions WHERE source = 'ai'`);
    expect(Number(drafts.rows[0].n)).toBe(0);
    expect(isSourceLocked({ slug: 'general', name: { en: 'General', ar: 'عام' } })).toBe(false);
    expect(isSourceLocked({ slug: 'trivia', name: { en: 'Fiqh basics', ar: 'أساسيات' } })).toBe(true);
  });

  it('files validated drafts into pending_review only, de-duplicates, records usage and enforces quotas', async () => {
    process.env.AI_PROVIDER = 'mock';
    process.env.AI_DAILY_PER_USER = '2';
    _resetAiProvider();
    const cat = await seedCategory('science');
    const token = await editor('ed3');
    const first = await api('/admin/ai/draft-questions', { method: 'POST', token, body: { categoryId: cat, count: 3, language: 'en', difficulty: 'easy' } });
    expect(first.status).toBe(200);
    const body = first.body as { drafted: number; status: string };
    expect(body.drafted).toBe(3);
    expect(body.status).toBe('pending_review');
    const q = await query(`SELECT status, source, tags FROM questions WHERE source = 'ai'`);
    expect(q.rows).toHaveLength(3);
    expect(q.rows.every((r) => r.status === 'pending_review')).toBe(true);
    // identical drafts again → all duplicates, nothing new
    const second = await api('/admin/ai/draft-questions', { method: 'POST', token, body: { categoryId: cat, count: 3, language: 'en', difficulty: 'easy' } });
    expect((second.body as { drafted: number; errors: unknown[] }).drafted).toBe(0);
    expect((second.body as { errors: unknown[] }).errors).toHaveLength(3);
    const ledger = await query(`SELECT count(*) AS n, sum(input_tokens) AS tokens FROM ai_requests WHERE status = 'ok'`);
    expect(Number(ledger.rows[0].n)).toBe(2);
    expect(Number(ledger.rows[0].tokens)).toBeGreaterThan(0);
    // third call today → per-user quota
    const third = await api('/admin/ai/draft-questions', { method: 'POST', token, body: { categoryId: cat, count: 1 } });
    expect(third.status).toBe(429);
    const audits = await query(`SELECT count(*) AS n FROM audit_logs WHERE action = 'ai.draft_questions'`);
    expect(Number(audits.rows[0].n)).toBe(2);
    delete process.env.AI_DAILY_PER_USER;
  });
});
