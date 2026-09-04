import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { env } from './config/env.js';
import { pool, query } from './db/pool.js';
import { reportError } from './core/alerts.js';
import { AppError } from './core/errors.js';
import { errors5xx, registerMetrics } from './core/metrics.js';
import { rateLimit } from './core/rateLimit.js';
import { attachIdentity } from './plugins/auth.js';
import { aiRoutes } from './modules/ai/routes.js';
import { adminRoutes } from './modules/admin/routes.js';
import { authRoutes } from './modules/auth/routes.js';
import { categoryRoutes } from './modules/categories/routes.js';
import { challengeRoutes } from './modules/challenges/routes.js';
import { friendRoutes } from './modules/friends/routes.js';
import { achievementRoutes } from './modules/gamification/routes.js';
import { groupRoutes } from './modules/groups/routes.js';
import { leaderboardRoutes } from './modules/leaderboards/routes.js';
import { monthlyRoutes } from './modules/monthly/service.js';
import { notificationRoutes } from './modules/notifications/routes.js';
import { questionRoutes } from './modules/questions/routes.js';
import { quizRoutes } from './modules/quizzes/routes.js';
import { searchRoutes } from './modules/search/routes.js';
import { statsRoutes } from './modules/stats/routes.js';
import { tournamentRoutes } from './modules/tournaments/service.js';
import { userRoutes } from './modules/users/routes.js';

export async function buildApp(): Promise<FastifyInstance> {
  const options: FastifyServerOptions = {
    logger: env.isTest
      ? false
      : {
          level: env.isProd ? 'info' : 'debug',
          redact: { paths: ['req.headers.authorization', 'req.headers.cookie'], censor: '[redacted]' },
        },
    bodyLimit: 5 * 1024 * 1024,
    trustProxy: env.trustProxy,
    // honour an upstream correlation id (load balancer / gateway), otherwise generate one
    genReqId: (req: IncomingMessage) => {
      const incoming = req.headers['x-request-id'];
      const id = Array.isArray(incoming) ? incoming[0] : incoming;
      return id && /^[A-Za-z0-9._-]{8,128}$/.test(id) ? id : randomUUID();
    },
  };
  const app = Fastify(options);

  await app.register(cors, {
    origin: env.corsOrigin.split(',').map((o) => o.trim()),
    credentials: true,
  });

  app.addHook('onRequest', attachIdentity);
  // global API limiter; static assets / SPA shell are exempt (a page load is several requests)
  const globalLimiter = rateLimit({ keyPrefix: 'global' });
  app.addHook('onRequest', async (req, reply) => {
    if (req.raw.url?.startsWith('/api/')) await globalLimiter(req, reply);
  });

  app.addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', req.id);
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    if (!req.raw.url?.startsWith('/api/')) {
      // SPA shell: scripts only from self; styles/fonts from self + Google Fonts; media may be external https
      reply.header(
        'content-security-policy',
        [
          "default-src 'self'",
          "script-src 'self'",
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
          "font-src 'self' data: https://fonts.gstatic.com",
          "img-src 'self' data: blob: https:",
          "media-src 'self' blob: https:",
          "connect-src 'self'",
          "worker-src 'self'",
          "frame-ancestors 'none'",
          "base-uri 'self'",
          "form-action 'self'",
        ].join('; '),
      );
    }
    if (env.isProd) reply.header('strict-transport-security', 'max-age=31536000; includeSubDomains');
  });

  // uniform error responses — internals are never leaked to clients
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send({
        error: { code: err.code, message: err.message, details: err.details ?? undefined },
      });
    }
    const fastifyErr = err as { statusCode?: number; message?: string };
    if (fastifyErr.statusCode && fastifyErr.statusCode < 500) {
      return reply.status(fastifyErr.statusCode).send({
        error: { code: 'bad_request', message: fastifyErr.message ?? 'Bad request' },
      });
    }
    req.log.error(err);
    errors5xx.inc();
    reportError(err, { kind: 'http_500', requestId: req.id, method: req.method, url: req.raw.url, userId: req.userId ?? null });
    return reply.status(500).send({ error: { code: 'internal_error', message: 'Something went wrong', requestId: req.id } });
  });

  registerMetrics(app);

  // liveness: process is up
  app.get('/health', async () => ({ ok: true, ts: new Date().toISOString() }));
  // readiness: database reachable, pool not exhausted, jobs healthy — point platform health checks here
  app.get('/ready', async (_req, reply) => {
    const started = Date.now();
    try {
      await query('SELECT 1');
    } catch (err) {
      reply.status(503);
      return { ok: false, db: 'unreachable', error: (err as Error).message, ts: new Date().toISOString() };
    }
    const jobs = await query<{ name: string; last_status: string; last_finished_at: string | null; failures: string }>(
      'SELECT name, last_status, last_finished_at, failures FROM job_runs ORDER BY name',
    ).catch(() => ({ rows: [] as Array<{ name: string; last_status: string; last_finished_at: string | null; failures: string }> }));
    const failing = jobs.rows.filter((j) => j.last_status === 'error').map((j) => j.name);
    return {
      ok: true,
      db: { ok: true, latencyMs: Date.now() - started, pool: { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount } },
      jobs: { failing, tracked: jobs.rows.length },
      version: process.env.npm_package_version ?? null,
      ts: new Date().toISOString(),
    };
  });

  await app.register(
    async (api) => {
      await api.register(authRoutes, { prefix: '/auth' });
      await api.register(userRoutes, { prefix: '/users' });
      await api.register(categoryRoutes, { prefix: '/categories' });
      await api.register(questionRoutes, { prefix: '/questions' });
      await api.register(quizRoutes, { prefix: '/quizzes' });
      await api.register(leaderboardRoutes, { prefix: '/leaderboards' });
      await api.register(challengeRoutes, { prefix: '/challenges' });
      await api.register(friendRoutes, { prefix: '/friends' });
      await api.register(monthlyRoutes, { prefix: '/monthly-challenges' });
      await api.register(groupRoutes, { prefix: '/groups' });
      await api.register(tournamentRoutes, { prefix: '/tournaments' });
      await api.register(achievementRoutes, { prefix: '/achievements' });
      await api.register(notificationRoutes, { prefix: '/notifications' });
      await api.register(statsRoutes, { prefix: '/stats' });
      await api.register(searchRoutes, { prefix: '/search' });
      await api.register(adminRoutes, { prefix: '/admin' });
      await api.register(aiRoutes, { prefix: '/admin/ai' });
    },
    { prefix: '/api/v1' },
  );

  // serve the built web app when present (single-server deployment)
  const webDist = join(dirname(fileURLToPath(import.meta.url)), '../../web/dist');
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.raw.url?.startsWith('/api/')) {
        return reply.status(404).send({ error: { code: 'not_found', message: 'Route not found' } });
      }
      return reply.sendFile('index.html'); // SPA fallback
    });
  }

  return app;
}
