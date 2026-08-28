import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { env } from './config/env.js';
import { AppError } from './core/errors.js';
import { rateLimit } from './core/rateLimit.js';
import { attachIdentity } from './plugins/auth.js';
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
  const app = Fastify({
    logger: env.isTest ? false : { level: env.isProd ? 'info' : 'debug' },
    bodyLimit: 5 * 1024 * 1024,
    trustProxy: true,
  });

  await app.register(cors, {
    origin: env.corsOrigin.split(',').map((o) => o.trim()),
    credentials: true,
  });

  app.addHook('onRequest', attachIdentity);
  app.addHook('onRequest', rateLimit({ keyPrefix: 'global' }));

  app.addHook('onSend', async (_req, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'no-referrer');
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
    return reply.status(500).send({ error: { code: 'internal_error', message: 'Something went wrong' } });
  });

  app.get('/health', async () => ({ ok: true, ts: new Date().toISOString() }));

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
