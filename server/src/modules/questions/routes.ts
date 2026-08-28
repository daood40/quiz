import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { badRequest } from '../../core/errors.js';
import { rateLimit } from '../../core/rateLimit.js';
import { requireAuth } from '../../plugins/auth.js';
import { reportQuestion } from './service.js';

/** Public question endpoints — reporting only. Content is served via attempts. */
export async function questionRoutes(app: FastifyInstance): Promise<void> {
  const reportLimiter = rateLimit({ max: 10, keyPrefix: 'question-report' });

  app.post('/:id/report', { preHandler: [requireAuth, reportLimiter] }, async (req) => {
    const { id } = req.params as { id: string };
    const parsed = z
      .object({
        reason: z.enum(['wrong_answer', 'wrong_question', 'typo', 'duplicate', 'offensive', 'technical', 'other']),
        details: z.string().max(2000).default(''),
      })
      .safeParse(req.body);
    if (!parsed.success) throw badRequest('Invalid report', parsed.error.issues);
    const reportId = await reportQuestion(id, req.userId, parsed.data.reason, parsed.data.details);
    return { ok: true, reportId };
  });
}
