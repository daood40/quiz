import { z } from 'zod';
import { badRequest } from './errors.js';

const uuid = z.string().uuid();

/** Path parameter guard: a malformed id is a 400, never a PostgreSQL cast error (500). */
export function uuidParam(value: unknown, name = 'id'): string {
  const parsed = uuid.safeParse(value);
  if (!parsed.success) throw badRequest(`Invalid ${name}`);
  return parsed.data;
}
