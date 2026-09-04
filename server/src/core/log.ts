import pino from 'pino';
import { env } from '../config/env.js';

/** Shared structured logger (jobs, audit, boot) — same JSON stream as Fastify's request logger. */
export const log = pino({
  level: env.isTest ? 'silent' : env.isProd ? 'info' : 'debug',
  redact: { paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.token', '*.refreshToken', '*.accessToken'], censor: '[redacted]' },
});
