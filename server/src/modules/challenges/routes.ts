import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../../core/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../../core/errors.js';
import { getSettings } from '../../core/settings.js';
import { query, withTransaction } from '../../db/pool.js';
import { requireAccount } from '../../plugins/auth.js';
import { contextHooks, startAttempt } from '../quizzes/attempts.js';
import { pickQuestions } from '../quizzes/pool.js';

function makeCode(): string {
  return randomBytes(4).toString('hex').toUpperCase();
}

const createSchema = z.object({
  title: z.string().max(120).default(''),
  categoryId: z.string().uuid().nullish(),
  difficulty: z.enum(['easy', 'medium', 'hard', 'expert']).nullish(),
  questionCount: z.number().int().min(1).max(50).default(10),
  timeLimitSec: z.number().int().min(30).max(7200).nullish(),
  expiresInHours: z.number().int().min(1).max(24 * 14).optional(),
  groupId: z.string().uuid().nullish(),
  inviteUsernames: z.array(z.string()).max(50).default([]),
});

async function challengeSummary(id: string) {
  const { rows } = await query(
    `SELECT c.*, u.username AS creator_username, u.display_name AS creator_name
     FROM challenges c JOIN users u ON u.id = c.creator_id WHERE c.id = $1`,
    [id],
  );
  const c = rows[0];
  if (!c) throw notFound('Challenge not found');
  const participants = await query(
    `SELECT cp.user_id, cp.status, cp.completed_at, u.username, u.display_name, u.avatar,
            a.score, a.server_duration_ms, a.correct_count
     FROM challenge_participants cp
     JOIN users u ON u.id = cp.user_id
     LEFT JOIN attempts a ON a.id = cp.attempt_id AND a.status = 'submitted'
     WHERE cp.challenge_id = $1
     ORDER BY a.score DESC NULLS LAST, a.server_duration_ms ASC NULLS LAST`,
    [id],
  );
  return {
    challenge: {
      id: c.id,
      code: c.code,
      title: c.title,
      creator: { username: c.creator_username, displayName: c.creator_name },
      categoryId: c.category_id,
      difficulty: c.difficulty,
      questionCount: c.question_count,
      timeLimitSec: c.time_limit_sec,
      status: c.status,
      startsAt: c.starts_at,
      expiresAt: c.expires_at,
      groupId: c.group_id,
      createdAt: c.created_at,
    },
    participants: participants.rows.map((p, i) => ({
      rank: p.score !== null ? i + 1 : null,
      userId: p.user_id,
      username: p.username,
      displayName: p.display_name,
      avatar: p.avatar,
      status: p.status,
      score: p.score,
      correct: p.correct_count,
      durationMs: p.server_duration_ms,
      completedAt: p.completed_at,
    })),
  };
}

export async function challengeRoutes(app: FastifyInstance): Promise<void> {
  app.post('/', { preHandler: [requireAccount] }, async (req) => {
    const settings = await getSettings();
    const parsed = createSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw badRequest('Invalid challenge options', parsed.error.issues);
    const input = parsed.data;
    if (input.questionCount > settings.challengeMaxQuestions) {
      throw badRequest(`Challenges are limited to ${settings.challengeMaxQuestions} questions`);
    }

    if (input.groupId) {
      const member = await query('SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2', [
        input.groupId,
        req.userId,
      ]);
      if (!member.rowCount) throw forbidden('You are not a member of this group');
    }

    // fixed question set → every participant answers identical questions
    const picked = await pickQuestions({
      categoryId: input.categoryId,
      difficulty: input.difficulty,
      count: input.questionCount,
    });
    if (picked.length < Math.min(input.questionCount, 1)) throw badRequest('Not enough questions for these filters');

    const expiresHours = input.expiresInHours ?? settings.challengeDefaultExpiryHours;
    const id = await withTransaction(async (client) => {
      const res = await client.query(
        `INSERT INTO challenges (code, title, creator_id, group_id, category_id, difficulty,
           question_ids, question_count, time_limit_sec, status, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'open', now() + make_interval(hours => $10))
         RETURNING id`,
        [
          makeCode(),
          input.title,
          req.userId,
          input.groupId ?? null,
          input.categoryId ?? null,
          input.difficulty ?? null,
          picked.map((p) => p.id),
          picked.length,
          input.timeLimitSec ?? null,
          expiresHours,
        ],
      );
      const challengeId = res.rows[0].id;
      await client.query(
        `INSERT INTO challenge_participants (challenge_id, user_id, status, joined_at) VALUES ($1,$2,'joined',now())`,
        [challengeId, req.userId],
      );
      for (const username of input.inviteUsernames) {
        const target = await client.query(
          `SELECT id FROM users WHERE username = $1 AND status = 'active' AND is_guest = false`,
          [username],
        );
        if (!target.rows[0] || target.rows[0].id === req.userId) continue;
        await client.query(
          `INSERT INTO challenge_participants (challenge_id, user_id, invited_by) VALUES ($1,$2,$3)
           ON CONFLICT DO NOTHING`,
          [challengeId, target.rows[0].id, req.userId],
        );
        await client.query(
          `INSERT INTO notifications (user_id, kind, title, body, data) VALUES ($1,'challenge_invite',$2,$3,$4)`,
          [
            target.rows[0].id,
            JSON.stringify({ en: 'Challenge invitation', ar: 'دعوة تحدي' }),
            JSON.stringify({ en: 'You were invited to a challenge!', ar: 'تمت دعوتك إلى تحدٍّ!' }),
            JSON.stringify({ challengeId }),
          ],
        );
      }
      return challengeId as string;
    });
    audit(req.userId, 'challenge.created', 'challenge', id);
    return challengeSummary(id);
  });

  app.get('/', { preHandler: [requireAccount] }, async (req) => {
    const { rows } = await query(
      `SELECT c.id, c.code, c.title, c.status, c.question_count, c.expires_at, c.created_at,
              cp.status AS my_status, u.username AS creator_username
       FROM challenge_participants cp
       JOIN challenges c ON c.id = cp.challenge_id
       JOIN users u ON u.id = c.creator_id
       WHERE cp.user_id = $1
       ORDER BY c.created_at DESC LIMIT 50`,
      [req.userId],
    );
    return { challenges: rows };
  });

  app.get('/:id', { preHandler: [requireAccount] }, async (req) => {
    const { id } = req.params as { id: string };
    if (!z.string().uuid().safeParse(id).success) throw notFound('Challenge not found');
    const access = await query(
      `SELECT 1 FROM challenges c
       WHERE c.id = $1 AND (c.creator_id = $2 OR EXISTS (
         SELECT 1 FROM challenge_participants p WHERE p.challenge_id = c.id AND p.user_id = $2))`,
      [id, req.userId],
    );
    if (!access.rowCount) throw notFound('Challenge not found');
    return challengeSummary(id);
  });

  /** Join by shareable code. */
  app.post('/join', { preHandler: [requireAccount] }, async (req) => {
    const parsed = z.object({ code: z.string().min(4).max(16) }).safeParse(req.body);
    if (!parsed.success) throw badRequest('Invalid code');
    const { rows } = await query(`SELECT id, status, expires_at FROM challenges WHERE code = $1`, [
      parsed.data.code.toUpperCase(),
    ]);
    const c = rows[0];
    if (!c) throw notFound('Challenge not found');
    if (c.status !== 'open' && c.status !== 'active') throw conflict('Challenge is no longer open');
    if (c.expires_at && new Date(c.expires_at).getTime() < Date.now()) throw conflict('Challenge has expired');
    await query(
      `INSERT INTO challenge_participants (challenge_id, user_id, status, joined_at)
       VALUES ($1,$2,'joined',now())
       ON CONFLICT (challenge_id, user_id) DO UPDATE SET status = 'joined', joined_at = COALESCE(challenge_participants.joined_at, now())`,
      [c.id, req.userId],
    );
    return challengeSummary(c.id);
  });

  /** Start playing a challenge (creates the attempt with the fixed question set). */
  app.post('/:id/start', { preHandler: [requireAccount] }, async (req) => {
    const { id } = req.params as { id: string };
    const { rows } = await query(`SELECT * FROM challenges WHERE id = $1`, [id]);
    const c = rows[0];
    if (!c) throw notFound('Challenge not found');
    if (c.expires_at && new Date(c.expires_at).getTime() < Date.now()) throw conflict('Challenge has expired');
    if (!['open', 'active'].includes(c.status)) throw conflict('Challenge is not accepting attempts');
    const membership = await query(
      `SELECT status FROM challenge_participants WHERE challenge_id = $1 AND user_id = $2`,
      [id, req.userId],
    );
    if (!membership.rowCount) throw forbidden('Join the challenge first');
    if (membership.rows[0].status === 'completed') throw conflict('You already completed this challenge');

    await query(`UPDATE challenges SET status = 'active' WHERE id = $1 AND status = 'open'`, [id]);
    const started = await startAttempt(req.userId!, false, {
      mode: 'challenge',
      contextType: 'challenge',
      contextId: id,
      fixedQuestionIds: c.question_ids,
      overallTimeLimitSec: c.time_limit_sec,
    });
    await query(
      `UPDATE challenge_participants SET attempt_id = $3, status = 'joined' WHERE challenge_id = $1 AND user_id = $2`,
      [id, req.userId, started.attemptId],
    );
    return started;
  });
}

contextHooks.challenge = (contextId, userId, attemptId) =>
  onChallengeAttemptSubmitted(contextId, userId, attemptId);

/** Called from attempt submission flow (via context hook) to close out participation. */
export async function onChallengeAttemptSubmitted(challengeId: string, userId: string, attemptId: string): Promise<void> {
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE challenge_participants SET status = 'completed', completed_at = now(), attempt_id = $3
       WHERE challenge_id = $1 AND user_id = $2`,
      [challengeId, userId, attemptId],
    );
    const remaining = await client.query(
      `SELECT count(*) AS n FROM challenge_participants WHERE challenge_id = $1 AND status IN ('invited','joined')`,
      [challengeId],
    );
    if (Number(remaining.rows[0].n) === 0) {
      await client.query(`UPDATE challenges SET status = 'completed' WHERE id = $1 AND status IN ('open','active')`, [
        challengeId,
      ]);
    }
  });
}
