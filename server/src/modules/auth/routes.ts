import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { badRequest } from '../../core/errors.js';
import { rateLimit } from '../../core/rateLimit.js';
import { requireAccount, requireAuth } from '../../plugins/auth.js';
import * as svc from './service.js';

function parse<S extends z.ZodTypeAny>(schema: S, body: unknown): z.infer<S> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw badRequest('Invalid request body', result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  return result.data;
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const authLimiter = rateLimit({ max: env.rateLimitAuthMax, windowMs: env.rateLimitWindowMs, keyPrefix: 'auth' });

  app.post('/register', { preHandler: [authLimiter] }, async (req) => {
    const input = parse(svc.registerSchema, req.body);
    return svc.register(input, req.ip);
  });

  app.post('/login', { preHandler: [authLimiter] }, async (req) => {
    const input = parse(svc.loginSchema, req.body);
    return svc.login(input, req.ip);
  });

  app.post('/guest', { preHandler: [authLimiter] }, async (req) => {
    const body = parse(z.object({ language: z.enum(['ar', 'en']).default('en') }), req.body ?? {});
    return svc.createGuest(body.language, req.ip);
  });

  app.post('/refresh', async (req) => {
    const body = parse(z.object({ refreshToken: z.string().min(10) }), req.body);
    return svc.refresh(body.refreshToken);
  });

  app.post('/logout', { preHandler: [requireAuth] }, async (req) => {
    const body = z.object({ refreshToken: z.string().optional() }).safeParse(req.body ?? {});
    await svc.logout(body.success ? body.data.refreshToken : undefined, req.userId);
    return { ok: true };
  });

  app.post('/forgot-password', { preHandler: [authLimiter] }, async (req) => {
    const body = parse(z.object({ email: z.string().email() }), req.body);
    const result = await svc.forgotPassword(body.email);
    return { ok: true, ...result };
  });

  app.post('/reset-password', { preHandler: [authLimiter] }, async (req) => {
    const body = parse(z.object({ token: z.string().min(10), password: z.string().min(8).max(128) }), req.body);
    await svc.resetPassword(body.token, body.password);
    return { ok: true };
  });

  app.post('/verify-email', async (req) => {
    const body = parse(z.object({ token: z.string().min(10) }), req.body);
    await svc.verifyEmail(body.token);
    return { ok: true };
  });

  app.post('/change-password', { preHandler: [requireAccount] }, async (req) => {
    const body = parse(
      z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8).max(128) }),
      req.body,
    );
    await svc.changePassword(req.userId!, body.currentPassword, body.newPassword);
    return { ok: true };
  });

  app.delete('/account', { preHandler: [requireAuth] }, async (req) => {
    const body = parse(z.object({ password: z.string().default('') }), req.body ?? {});
    await svc.deleteAccount(req.userId!, body.password);
    return { ok: true };
  });
}
