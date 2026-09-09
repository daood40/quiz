import { z } from 'zod';
import { badRequest } from './errors.js';

const uuid = z.string().uuid();

export function isUuid(value: unknown): value is string {
  return uuid.safeParse(value).success;
}

/** Path parameter guard: a malformed id is a 400, never a PostgreSQL cast error (500). */
export function uuidParam(value: unknown, name = 'id'): string {
  const parsed = uuid.safeParse(value);
  if (!parsed.success) throw badRequest(`Invalid ${name}`);
  return parsed.data;
}

/** Query-string integer with bounds: "abc", "-5", "1e9" and NaN all collapse to a sane value instead of leaking into SQL. */
export function intQuery(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'string' && /^-?\d{1,9}$/.test(value.trim()) ? Number(value) : typeof value === 'number' ? value : fallback;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}
