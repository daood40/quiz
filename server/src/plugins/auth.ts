import type { FastifyReply, FastifyRequest } from 'fastify';
import { forbidden, unauthorized } from '../core/errors.js';
import { roleAtLeast } from '../modules/auth/rbac.js';
import type { Role } from '../modules/auth/tokens.js';
import { query } from '../db/pool.js';
import { verifyAccessToken } from '../modules/auth/tokens.js';

declare module 'fastify' {
  interface FastifyRequest {
    userId: string | null;
    userRole: Role;
    isGuest: boolean;
  }
}

/**
 * Bans, role changes and password resets bump users.sessions_valid_after; any access token issued
 * before that instant is rejected. Cached briefly per user so it costs ~1 query / user / 30s.
 */
const VALID_AFTER_TTL_MS = 30_000;
const validAfterCache = new Map<string, { validAfter: number; fetchedAt: number }>();
export function invalidateSessionCache(userId?: string): void {
  if (userId) validAfterCache.delete(userId);
  else validAfterCache.clear();
}
async function sessionInvalidated(userId: string, iat?: number): Promise<boolean> {
  if (iat === undefined) return false;
  const now = Date.now();
  let entry = validAfterCache.get(userId);
  if (!entry || now - entry.fetchedAt > VALID_AFTER_TTL_MS) {
    const { rows } = await query<{ sessions_valid_after: string; status: string }>(
      'SELECT sessions_valid_after, status FROM users WHERE id = $1',
      [userId],
    );
    const row = rows[0];
    const validAfter = !row || row.status === 'banned' || row.status === 'deleted'
      ? Number.MAX_SAFE_INTEGER
      : new Date(row.sessions_valid_after).getTime();
    entry = { validAfter, fetchedAt: now };
    validAfterCache.set(userId, entry);
  }
  // JWT iat has second precision: a token issued in the same second as the bump stays valid
  return iat < Math.floor(entry.validAfter / 1000);
}

/** Decorates every request with identity from the Bearer token (if any). */
export async function attachIdentity(req: FastifyRequest): Promise<void> {
  req.userId = null;
  req.userRole = 'user';
  req.isGuest = false;
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return;
  const payload = verifyAccessToken(header.slice(7));
  if (!payload) return;
  if (await sessionInvalidated(payload.sub, payload.iat)) return;
  req.userId = payload.sub;
  req.userRole = payload.role;
  req.isGuest = payload.guest;
}

/** preHandler: requires a valid authenticated (possibly guest) user. */
export async function requireAuth(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  if (!req.userId) throw unauthorized();
}

/** preHandler: requires a full (non-guest) account. */
export async function requireAccount(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  if (!req.userId) throw unauthorized();
  if (req.isGuest) throw forbidden('A full account is required for this action');
}

/** preHandler factory: requires at least the given role. */
export function requireRole(required: Role) {
  return async (req: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    if (!req.userId) throw unauthorized();
    if (req.isGuest || !roleAtLeast(req.userRole, required)) throw forbidden();
  };
}
