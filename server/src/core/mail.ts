import { env } from '../config/env.js';
import { log } from './log.js';

/**
 * Transactional mail (password reset, email verification).
 *   MAIL_PROVIDER=resend  + MAIL_API_KEY + MAIL_FROM   → Resend HTTP API
 *   MAIL_PROVIDER=log                                   → printed to the log (development / tests)
 *   unset                                               → disabled; callers accept the request silently
 * Templates are bilingual and plain (no tracking, no external assets).
 */
export interface Mail { to: string; subject: string; text: string; html: string }

const sent: Mail[] = [];
/** Last mails handed to the `log` provider — for tests. */
export function _sentMail(): Mail[] { return sent; }

export function mailEnabled(): boolean {
  const p = process.env.MAIL_PROVIDER ?? '';
  return p === 'log' || (p === 'resend' && !!process.env.MAIL_API_KEY && !!process.env.MAIL_FROM);
}

export function appUrl(path = ''): string {
  const base = (process.env.APP_URL ?? '').replace(/\/$/, '');
  return `${base}${path}`;
}

export async function sendMail(mail: Mail): Promise<boolean> {
  const provider = process.env.MAIL_PROVIDER ?? '';
  if (provider === 'log') {
    sent.push(mail);
    if (sent.length > 50) sent.shift();
    if (!env.isTest) log.info({ to: mail.to, subject: mail.subject }, 'mail (log provider)');
    return true;
  }
  if (provider === 'resend') {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.MAIL_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: process.env.MAIL_FROM, to: [mail.to], subject: mail.subject, text: mail.text, html: mail.html }),
    });
    if (!res.ok) {
      log.error({ status: res.status, body: (await res.text()).slice(0, 300) }, 'mail delivery failed');
      return false;
    }
    return true;
  }
  return false;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

function layout(titleAr: string, titleEn: string, bodyAr: string, bodyEn: string, link: string, ctaAr: string, ctaEn: string): Mail['html'] {
  return `<!doctype html><html><body style="font-family:Segoe UI,Rubik,Arial,sans-serif;background:#f4f6f5;padding:24px">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:14px;padding:28px;color:#1f2a28">
<h1 style="font-size:20px;margin:0 0 8px">🧠 Quiz Platform</h1>
<div dir="rtl" style="text-align:right"><h2 style="font-size:17px">${esc(titleAr)}</h2><p>${esc(bodyAr)}</p>
<p><a href="${esc(link)}" style="display:inline-block;background:#177d6e;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none">${esc(ctaAr)}</a></p></div>
<hr style="border:0;border-top:1px solid #e3e8e6;margin:18px 0">
<div dir="ltr"><h2 style="font-size:17px">${esc(titleEn)}</h2><p>${esc(bodyEn)}</p>
<p><a href="${esc(link)}" style="display:inline-block;background:#177d6e;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none">${esc(ctaEn)}</a></p></div>
<p style="color:#6b7a77;font-size:12px">${esc(link)}</p></div></body></html>`;
}

export function passwordResetMail(to: string, token: string): Mail {
  const link = appUrl(`/forgot?token=${encodeURIComponent(token)}`);
  return {
    to,
    subject: 'إعادة تعيين كلمة المرور · Reset your password',
    text: `لإعادة تعيين كلمة المرور افتح الرابط (صالح لساعة واحدة):\n${link}\n\nTo reset your password open this link (valid for 1 hour):\n${link}`,
    html: layout('إعادة تعيين كلمة المرور', 'Reset your password',
      'طلب أحدهم إعادة تعيين كلمة مرور حسابك. الرابط صالح لساعة واحدة. إن لم تطلب ذلك فتجاهل هذه الرسالة.',
      'Someone asked to reset the password for your account. The link is valid for one hour. If this was not you, ignore this email.',
      link, 'إعادة التعيين', 'Reset password'),
  };
}

export function verifyEmailMail(to: string, token: string): Mail {
  const link = appUrl(`/verify?token=${encodeURIComponent(token)}`);
  return {
    to,
    subject: 'تأكيد بريدك الإلكتروني · Verify your email',
    text: `أكّد بريدك بفتح الرابط (صالح 48 ساعة):\n${link}\n\nConfirm your email by opening this link (valid 48 hours):\n${link}`,
    html: layout('تأكيد البريد الإلكتروني', 'Verify your email',
      'مرحبًا بك! أكّد بريدك لتفعيل استعادة كلمة المرور والإشعارات.',
      'Welcome! Confirm your email to enable password recovery and notifications.',
      link, 'تأكيد البريد', 'Verify email'),
  };
}
