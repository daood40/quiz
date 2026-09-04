import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { _sentMail } from '../src/core/mail.js';
import { query } from '../src/db/pool.js';
import { api, closeAll, getApp, registerUser, resetDb } from './helpers.js';

beforeAll(async () => { process.env.MAIL_PROVIDER = 'log'; process.env.APP_URL = 'https://quiz.example.com'; await getApp(); });
afterAll(async () => { delete process.env.MAIL_PROVIDER; await closeAll(); });

describe('transactional mail (log provider)', () => {
  beforeEach(resetDb);

  it('registration sends a verification link that verifies the account', async () => {
    const u = await registerUser('mailer');
    const mail = _sentMail().find((m) => m.to === 'mailer@test.com' && m.subject.includes('Verify'));
    expect(mail).toBeTruthy();
    const token = decodeURIComponent(mail!.text.match(/\/verify\?token=([^\s]+)/)![1]);
    const res = await api('/auth/verify-email', { method: 'POST', body: { token } });
    expect(res.status).toBe(200);
    const row = await query('SELECT email_verified_at FROM users WHERE id = $1', [u.id]);
    expect(row.rows[0].email_verified_at).not.toBeNull();
    // second use is rejected
    expect((await api('/auth/verify-email', { method: 'POST', body: { token } })).status).toBe(400);
  });

  it('forgot-password emails a reset link and never returns the token', async () => {
    await registerUser('resetter');
    const res = await api('/auth/forgot-password', { method: 'POST', body: { email: 'resetter@test.com' } });
    expect(res.status).toBe(200);
    expect((res.body as { resetToken?: string }).resetToken).toBeUndefined();
    const mail = _sentMail().find((m) => m.to === 'resetter@test.com' && m.subject.includes('Reset'));
    expect(mail).toBeTruthy();
    expect(mail!.text).toContain('https://quiz.example.com/forgot?token=');
    const token = decodeURIComponent(mail!.text.match(/\/forgot\?token=([^\s]+)/)![1]);
    const reset = await api('/auth/reset-password', { method: 'POST', body: { token, password: 'NewPassw0rd!' } });
    expect(reset.status).toBe(200);
    const login = await api('/auth/login', { method: 'POST', body: { identifier: 'resetter', password: 'NewPassw0rd!' } });
    expect(login.status).toBe(200);
  });

  it('unknown email is accepted silently and sends nothing', async () => {
    const before = _sentMail().length;
    const res = await api('/auth/forgot-password', { method: 'POST', body: { email: 'nobody@test.com' } });
    expect(res.status).toBe(200);
    expect(_sentMail().length).toBe(before);
  });
});
