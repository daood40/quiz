import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { audit } from '../../core/audit.js';
import { log } from '../../core/log.js';
import { mailEnabled, passwordResetMail, sendMail, verifyEmailMail } from '../../core/mail.js';
import { AppError, badRequest, conflict, forbidden, notFound, unauthorized } from '../../core/errors.js';
import { getSettings } from '../../core/settings.js';
import { query, withTransaction } from '../../db/pool.js';
import { generateOpaqueToken, hashToken, signAccessToken, type Role } from './tokens.js';

export const registerSchema = z.object({
  email: z.string().email().max(254),
  username: z
    .string()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9_؀-ۿ]+$/, 'letters, digits and underscore only'),
  password: z.string().min(8).max(128),
  displayName: z.string().max(64).optional(),
  language: z.enum(['ar', 'en']).optional(),
  country: z.string().max(2).optional(),
});

export const loginSchema = z.object({
  identifier: z.string().min(1).max(254), // email or username
  password: z.string().min(1).max(128),
});

export interface PublicUser {
  id: string;
  email: string | null;
  username: string;
  displayName: string;
  role: Role;
  isGuest: boolean;
  avatar: string;
  language: string;
  country: string;
  xp: number;
  level: number;
  totalPoints: number;
  currentStreak: number;
  longestStreak: number;
  streakFreezes: number;
  plan: string;
  emailVerified: boolean;
  createdAt: string;
}

/** Profile view for other users: no email, plan, or verification state. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toProfileUser(row: any) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatar: row.avatar,
    country: row.country,
    level: row.level,
    xp: Number(row.xp),
    totalPoints: Number(row.total_points),
    currentStreak: row.current_streak,
    longestStreak: row.longest_streak,
    createdAt: row.created_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toPublicUser(row: any): PublicUser {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    isGuest: row.is_guest,
    avatar: row.avatar,
    language: row.language,
    country: row.country,
    xp: Number(row.xp),
    level: row.level,
    totalPoints: Number(row.total_points),
    currentStreak: row.current_streak,
    longestStreak: row.longest_streak,
    streakFreezes: row.streak_freezes ?? 0,
    plan: row.plan,
    emailVerified: row.email_verified_at !== null,
    createdAt: row.created_at,
  };
}

interface AuthResult {
  user: PublicUser;
  accessToken: string;
  refreshToken: string;
}

async function issueTokens(userId: string, role: Role, guest: boolean): Promise<{ accessToken: string; refreshToken: string }> {
  const accessToken = signAccessToken({ sub: userId, role, guest });
  const { token, hash } = generateOpaqueToken();
  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + make_interval(secs => $3))`,
    [userId, hash, env.jwtRefreshTtl],
  );
  return { accessToken, refreshToken: token };
}

export async function register(input: z.infer<typeof registerSchema>, ip: string): Promise<AuthResult> {
  const settings = await getSettings();
  if (!settings.registrationEnabled) throw forbidden('Registration is currently disabled');

  const passwordHash = await bcrypt.hash(input.password, env.bcryptRounds);
  const row = await withTransaction(async (client) => {
    const dupe = await client.query(
      'SELECT 1 FROM users WHERE email = $1 OR username = $2 LIMIT 1',
      [input.email, input.username],
    );
    if (dupe.rowCount) throw conflict('Email or username already in use');
    const res = await client.query(
      `INSERT INTO users (email, username, display_name, password_hash, language, country)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        input.email,
        input.username,
        input.displayName ?? input.username,
        passwordHash,
        input.language ?? 'en',
        (input.country ?? '').toUpperCase(),
      ],
    );
    await client.query('INSERT INTO user_stats (user_id) VALUES ($1)', [res.rows[0].id]);
    return res.rows[0];
  });

  // email verification token — delivered by the mail adapter when MAIL_* is configured
  const { token: verifyToken, hash } = generateOpaqueToken();
  await query(
    `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + interval '48 hours')`,
    [row.id, hash],
  );

  if (mailEnabled()) void sendMail(verifyEmailMail(row.email, verifyToken)).catch(() => undefined);
  audit(row.id, 'auth.register', 'user', row.id, {}, ip);
  const tokens = await issueTokens(row.id, row.role, false);
  return { user: toPublicUser(row), ...tokens };
}

// Per-identifier brute-force lockout (in-process; complements the IP limiter which a proxy can blur).
const LOGIN_MAX_FAILURES = 10;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
const loginFailures = new Map<string, { count: number; until: number }>();
function loginKey(identifier: string): string { return identifier.trim().toLowerCase(); }
export function _resetLoginFailures(): void { loginFailures.clear(); }

export async function login(input: z.infer<typeof loginSchema>, ip: string): Promise<AuthResult> {
  const key = loginKey(input.identifier);
  const lock = loginFailures.get(key);
  if (lock && lock.count >= LOGIN_MAX_FAILURES && lock.until > Date.now()) {
    audit(null, 'auth.login_locked', 'user', key, {}, ip);
    throw new AppError(429, 'too_many_attempts', 'Too many failed attempts; try again later');
  }
  const { rows } = await query(
    `SELECT * FROM users WHERE (email = $1 OR username = $1) AND is_guest = false LIMIT 1`,
    [input.identifier],
  );
  const row = rows[0];
  // constant-ish time: hash compare even when user missing
  const hash = row?.password_hash ?? '$2a$10$invalidinvalidinvalidinvalidinvalidinvalu';
  const ok = await bcrypt.compare(input.password, hash);
  if (!row || !ok) {
    const cur = loginFailures.get(key);
    const count = cur && cur.until > Date.now() ? cur.count + 1 : 1;
    loginFailures.set(key, { count, until: Date.now() + LOGIN_LOCK_MS });
    audit(row?.id ?? null, 'auth.login_failed', 'user', row?.id ?? key, { attempt: count }, ip);
    throw unauthorized('Invalid credentials');
  }
  loginFailures.delete(key);
  if (row.status === 'banned') throw forbidden('This account is banned');
  if (row.status === 'suspended') throw forbidden('This account is suspended');
  if (row.status === 'deleted') throw unauthorized('Invalid credentials');

  audit(row.id, 'auth.login', 'user', row.id, {}, ip);
  const tokens = await issueTokens(row.id, row.role, false);
  return { user: toPublicUser(row), ...tokens };
}

export async function createGuest(language: 'ar' | 'en', ip: string): Promise<AuthResult> {
  const settings = await getSettings();
  if (!settings.guestModeEnabled) throw forbidden('Guest mode is disabled');
  const username = `guest_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
  const { rows } = await query(
    `INSERT INTO users (username, display_name, is_guest, language)
     VALUES ($1, $2, true, $3) RETURNING *`,
    [username, 'Guest', language],
  );
  await query('INSERT INTO user_stats (user_id) VALUES ($1)', [rows[0].id]);
  audit(rows[0].id, 'auth.guest_created', 'user', rows[0].id, {}, ip);
  const tokens = await issueTokens(rows[0].id, 'user', true);
  return { user: toPublicUser(rows[0]), ...tokens };
}

export async function refresh(refreshToken: string): Promise<AuthResult> {
  const tokenHash = hashToken(refreshToken);
  const { rows } = await query(
    `SELECT rt.id AS rt_id, rt.expires_at, rt.revoked_at, u.*
     FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id
     WHERE rt.token_hash = $1`,
    [tokenHash],
  );
  const row = rows[0];
  if (!row) throw unauthorized('Invalid refresh token');
  if (row.revoked_at || new Date(row.expires_at).getTime() < Date.now()) {
    throw unauthorized('Refresh token expired');
  }
  if (row.status !== 'active') throw forbidden('Account is not active');
  // rotation: revoke old token, issue new pair
  await query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1', [row.rt_id]);
  const tokens = await issueTokens(row.id, row.role, row.is_guest);
  return { user: toPublicUser(row), ...tokens };
}

export async function logout(refreshToken: string | undefined, userId: string | null): Promise<void> {
  if (refreshToken) {
    await query('UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1', [hashToken(refreshToken)]);
  } else if (userId) {
    await query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
  }
}

export async function forgotPassword(email: string): Promise<{ resetToken?: string }> {
  const { rows } = await query(`SELECT id FROM users WHERE email = $1 AND is_guest = false`, [email]);
  if (!rows[0]) return {}; // do not reveal account existence
  const { token, hash } = generateOpaqueToken();
  await query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + interval '1 hour')`,
    [rows[0].id, hash],
  );
  audit(rows[0].id, 'auth.password_reset_requested', 'user', rows[0].id);
  if (mailEnabled()) await sendMail(passwordResetMail(email, token));
  else log.warn({ userId: rows[0].id }, 'password reset requested but MAIL_PROVIDER is not configured');
  // the plaintext token is only surfaced to the automated test suite (never in production responses)
  return env.isTest && !mailEnabled() ? { resetToken: token } : {};
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  if (newPassword.length < 8) throw badRequest('Password must be at least 8 characters');
  const tokenHash = hashToken(token);
  const { rows } = await query(
    `SELECT * FROM password_reset_tokens WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
    [tokenHash],
  );
  if (!rows[0]) throw badRequest('Invalid or expired reset token');
  const passwordHash = await bcrypt.hash(newPassword, env.bcryptRounds);
  await withTransaction(async (client) => {
    await client.query('UPDATE password_reset_tokens SET used_at = now() WHERE id = $1', [rows[0].id]);
    await client.query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [
      passwordHash,
      rows[0].user_id,
    ]);
    await client.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [
      rows[0].user_id,
    ]);
    await client.query('UPDATE users SET sessions_valid_after = now() WHERE id = $1', [rows[0].user_id]);
  });
  audit(rows[0].user_id, 'auth.password_reset', 'user', rows[0].user_id);
}

export async function changePassword(userId: string, current: string, next: string): Promise<void> {
  if (next.length < 8) throw badRequest('Password must be at least 8 characters');
  const { rows } = await query('SELECT password_hash FROM users WHERE id = $1 AND is_guest = false', [userId]);
  if (!rows[0]) throw notFound('User not found');
  const ok = await bcrypt.compare(current, rows[0].password_hash ?? '');
  if (!ok) throw unauthorized('Current password is incorrect');
  const passwordHash = await bcrypt.hash(next, env.bcryptRounds);
  await query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [passwordHash, userId]);
  audit(userId, 'auth.password_changed', 'user', userId);
}

export async function resendVerification(userId: string): Promise<boolean> {
  const { rows } = await query('SELECT email, email_verified_at FROM users WHERE id = $1 AND is_guest = false', [userId]);
  if (!rows[0] || rows[0].email_verified_at || !mailEnabled()) return false;
  const { token, hash } = generateOpaqueToken();
  await query(`INSERT INTO email_verification_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '48 hours')`, [userId, hash]);
  return sendMail(verifyEmailMail(rows[0].email, token));
}

export async function verifyEmail(token: string): Promise<void> {
  const { rows } = await query(
    `SELECT * FROM email_verification_tokens WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
    [hashToken(token)],
  );
  if (!rows[0]) throw badRequest('Invalid or expired verification token');
  await withTransaction(async (client) => {
    await client.query('UPDATE email_verification_tokens SET used_at = now() WHERE id = $1', [rows[0].id]);
    await client.query('UPDATE users SET email_verified_at = now(), updated_at = now() WHERE id = $1', [
      rows[0].user_id,
    ]);
  });
}

export async function deleteAccount(userId: string, password: string): Promise<void> {
  const { rows } = await query('SELECT password_hash, is_guest FROM users WHERE id = $1', [userId]);
  if (!rows[0]) throw notFound('User not found');
  if (!rows[0].is_guest) {
    const ok = await bcrypt.compare(password, rows[0].password_hash ?? '');
    if (!ok) throw unauthorized('Password is incorrect');
  }
  // soft delete: anonymize personal data, keep aggregate integrity
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE users SET status = 'deleted', email = NULL,
         username = 'deleted_' || left(id::text, 8),
         display_name = 'Deleted User', password_hash = NULL, avatar = '', updated_at = now()
       WHERE id = $1`,
      [userId],
    );
    await client.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1', [userId]);
    await client.query('UPDATE users SET sessions_valid_after = now() WHERE id = $1', [userId]);
  });
  audit(userId, 'auth.account_deleted', 'user', userId);
}
