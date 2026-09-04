import type { FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../config/env.js';
import { rateLimited } from './metrics.js';
import { tooMany } from './errors.js';

/**
 * Sliding-window in-memory rate limiter. For multi-instance deployments swap
 * the store for Redis behind the same interface (see docs/DEPLOYMENT.md).
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
}, 30_000).unref();

export function rateLimit(opts: { max?: number; windowMs?: number; keyPrefix?: string } = {}) {
  const max = opts.max ?? env.rateLimitMax;
  const windowMs = opts.windowMs ?? env.rateLimitWindowMs;
  const prefix = opts.keyPrefix ?? 'general';
  return async (req: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    if (env.isTest && process.env.RATE_LIMIT_IN_TEST !== '1') return; // deterministic tests unless a test opts in
    const key = `${prefix}:${req.userId ?? req.ip}`;
    const now = Date.now();
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return;
    }
    bucket.count++;
    if (bucket.count > max) {
      rateLimited.inc({ limiter: prefix });
      throw tooMany();
    }
  };
}

/** Exported for unit tests. */
export function _testConsume(key: string, max: number, windowMs: number, now: number): boolean {
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  bucket.count++;
  return bucket.count <= max;
}
export function _testReset(): void {
  buckets.clear();
}
