import type { FastifyReply, FastifyRequest } from 'fastify';
import { forbidden, unauthorized } from '../core/errors.js';
import { roleAtLeast } from '../modules/auth/rbac.js';
import type { Role } from '../modules/auth/tokens.js';
import { verifyAccessToken } from '../modules/auth/tokens.js';

declare module 'fastify' {
  interface FastifyRequest {
    userId: string | null;
    userRole: Role;
    isGuest: boolean;
  }
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
