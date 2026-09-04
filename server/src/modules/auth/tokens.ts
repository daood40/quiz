import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';

export type Role = 'user' | 'moderator' | 'editor' | 'admin' | 'super_admin';

export interface AccessTokenPayload {
  sub: string;
  role: Role;
  guest: boolean;
  /** issued-at (seconds); compared with users.sessions_valid_after */
  iat?: number;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  const { iat: _iat, ...claims } = payload;
  return jwt.sign(claims, env.jwtSecret, { expiresIn: env.jwtAccessTtl, issuer: 'quiz-platform' });
}

export function verifyAccessToken(token: string): AccessTokenPayload | null {
  try {
    const decoded = jwt.verify(token, env.jwtSecret, { issuer: 'quiz-platform' }) as jwt.JwtPayload;
    if (typeof decoded.sub !== 'string' || typeof decoded.role !== 'string') return null;
    return { sub: decoded.sub, role: decoded.role as Role, guest: decoded.guest === true, iat: typeof decoded.iat === 'number' ? decoded.iat : undefined };
  } catch {
    return null;
  }
}

/** Opaque refresh token — only its SHA-256 hash is stored. */
export function generateOpaqueToken(): { token: string; hash: string } {
  const token = randomBytes(48).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
