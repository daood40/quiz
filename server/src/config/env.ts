import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Loads .env from repo root (if present) without external deps.
 * Real environment variables always win over file values.
 */
function loadDotEnv(): void {
  for (const candidate of ['.env', '../.env', '../../.env']) {
    const path = resolve(process.cwd(), candidate);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (!(key in process.env)) process.env[key] = value;
    }
    break;
  }
}
loadDotEnv();

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Invalid numeric env var ${name}=${v}`);
  return n;
}

import { randomBytes } from 'node:crypto';

const nodeEnv = process.env.NODE_ENV ?? 'development';
const isTest = nodeEnv === 'test';
const isProd = nodeEnv === 'production';

const devDefaultDb = 'postgres://quiz:quiz_dev_password@localhost:5432/quiz_platform';
const devDefaultTestDb = 'postgres://quiz:quiz_dev_password@localhost:5432/quiz_platform_test';

// Never fall back to a well-known secret: production must set JWT_SECRET, development gets a
// random per-boot secret (sessions reset on restart), tests use a fixed value for determinism.
const jwtSecret =
  process.env.JWT_SECRET ??
  (isTest ? 'test-only-secret-0123456789abcdef0123456789abcdef' : isProd ? undefined : randomBytes(48).toString('hex'));
if (!jwtSecret) throw new Error('JWT_SECRET is required in production');
if (jwtSecret.length < 32) throw new Error('JWT_SECRET must be at least 32 chars');
if (!process.env.JWT_SECRET && !isTest) console.warn('JWT_SECRET not set: using a random per-boot secret (development only)');
// Behind a reverse proxy/PaaS set TRUST_PROXY to the number of trusted hops (usually 1) so
// req.ip is the real client for rate limiting. Leave unset when the API is exposed directly.
const trustProxyRaw = process.env.TRUST_PROXY;
const trustProxyHops = Number(trustProxyRaw);
const trustProxy: boolean | ((address: string, hop: number) => boolean) =
  trustProxyRaw === undefined || trustProxyRaw === '' || trustProxyRaw === 'false' ? false
  : trustProxyRaw === 'true' ? true
  : Number.isFinite(trustProxyHops) && trustProxyHops > 0 ? (_address, hop) => hop < trustProxyHops
  : false;

export const env = {
  nodeEnv,
  isProd,
  trustProxy,
  isTest,
  port: num('PORT', 3001),
  host: process.env.HOST ?? '0.0.0.0',
  databaseUrl: isTest
    ? req('DATABASE_URL_TEST', devDefaultTestDb)
    : req('DATABASE_URL', isProd ? undefined : devDefaultDb),
  pgPoolMax: num('PG_POOL_MAX', 10),
  jwtSecret,
  jwtAccessTtl: num('JWT_ACCESS_TTL', 900),
  jwtRefreshTtl: num('JWT_REFRESH_TTL', 60 * 60 * 24 * 30),
  bcryptRounds: num('BCRYPT_ROUNDS', isTest ? 4 : 12),
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  rateLimitWindowMs: num('RATE_LIMIT_WINDOW_MS', 60_000),
  rateLimitMax: num('RATE_LIMIT_MAX', 120),
  rateLimitAuthMax: num('RATE_LIMIT_AUTH_MAX', 10),
  guestModeEnabled: (process.env.GUEST_MODE_ENABLED ?? 'true') === 'true',
  guestMaxQuestions: num('GUEST_MAX_QUESTIONS', 10),
  jobsEnabled: (process.env.JOBS_ENABLED ?? (isTest ? 'false' : 'true')) === 'true',
};
