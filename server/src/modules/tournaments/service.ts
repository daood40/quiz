import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { audit } from '../../core/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../../core/errors.js';
import { getSettings } from '../../core/settings.js';
import { query, withTransaction } from '../../db/pool.js';
import { requireAccount, requireRole } from '../../plugins/auth.js';
import { contextHooks, startAttempt } from '../quizzes/attempts.js';
import { pickQuestions } from '../quizzes/pool.js';

/**
 * Tournament Engine — single-elimination brackets.
 * Tournament → Rounds → Matches → (fixed question sets) → Attempts → Results.
 * Both players in a match answer identical questions; winner = higher score,
 * tie broken by lower total time, then earlier submission.
 */

async function createMatchQuestions(count: number, categoryId: string | null, difficulty: string | null): Promise<string[]> {
  const picked = await pickQuestions({ count, categoryId, difficulty });
  return picked.map((p) => p.id);
}

export async function startTournament(tournamentId: string, actor: string | null): Promise<void> {
  await withTransaction(async (client) => {
    const { rows } = await client.query('SELECT * FROM tournaments WHERE id = $1 FOR UPDATE', [tournamentId]);
    const t = rows[0];
    if (!t) throw notFound('Tournament not found');
    if (t.status !== 'registration') throw conflict('Tournament is not in registration');

    const participants = await client.query(
      `SELECT tp.user_id FROM tournament_participants tp
       JOIN users u ON u.id = tp.user_id
       WHERE tp.tournament_id = $1 ORDER BY u.total_points DESC`,
      [tournamentId],
    );
    if (participants.rows.length < 2) throw conflict('At least 2 participants are required');

    // seed by ranking
    const seeds: string[] = participants.rows.map((r) => r.user_id);
    for (let i = 0; i < seeds.length; i++) {
      await client.query(
        'UPDATE tournament_participants SET seed = $3 WHERE tournament_id = $1 AND user_id = $2',
        [tournamentId, seeds[i], i + 1],
      );
    }

    const round = await client.query(
      `INSERT INTO tournament_rounds (tournament_id, round_number, status, starts_at)
       VALUES ($1, 1, 'running', now()) RETURNING id`,
      [tournamentId],
    );
    await buildMatches(client, round.rows[0].id, seeds, t);
    await client.query(`UPDATE tournaments SET status = 'running', starts_at = COALESCE(starts_at, now()) WHERE id = $1`, [
      tournamentId,
    ]);
  });
  audit(actor, 'tournament.started', 'tournament', tournamentId);
}

async function buildMatches(
  client: PoolClient,
  roundId: string,
  players: string[],
  t: { questions_per_match: number; category_id: string | null; difficulty: string | null },
): Promise<void> {
  // standard seeding: 1 vs last, 2 vs second-last...
  let matchNumber = 1;
  const n = players.length;
  const half = Math.floor(n / 2);
  for (let i = 0; i < half; i++) {
    const p1 = players[i];
    const p2 = players[n - 1 - i];
    const questionIds = await createMatchQuestions(t.questions_per_match, t.category_id, t.difficulty);
    await client.query(
      `INSERT INTO tournament_matches (round_id, match_number, player1_id, player2_id, question_ids, status)
       VALUES ($1,$2,$3,$4,$5,'running')`,
      [roundId, matchNumber++, p1, p2, questionIds],
    );
  }
  if (n % 2 === 1) {
    // odd player gets a bye (walkover to next round)
    await client.query(
      `INSERT INTO tournament_matches (round_id, match_number, player1_id, player2_id, winner_id, status)
       VALUES ($1,$2,$3,NULL,$3,'walkover')`,
      [roundId, matchNumber, players[half]],
    );
  }
}

/** Context hook: an attempt for a tournament match was submitted. */
async function onMatchAttemptSubmitted(matchId: string, userId: string, attemptId: string): Promise<void> {
  await withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT m.*, r.tournament_id, r.round_number FROM tournament_matches m
       JOIN tournament_rounds r ON r.id = m.round_id
       WHERE m.id = $1 FOR UPDATE`,
      [matchId],
    );
    const m = rows[0];
    if (!m || m.status === 'completed') return;
    const col = m.player1_id === userId ? 'player1_attempt_id' : m.player2_id === userId ? 'player2_attempt_id' : null;
    if (!col) return;
    await client.query(`UPDATE tournament_matches SET ${col} = $2 WHERE id = $1`, [matchId, attemptId]);

    const fresh = await client.query('SELECT * FROM tournament_matches WHERE id = $1', [matchId]);
    const match = fresh.rows[0];
    if (!match.player1_attempt_id || !match.player2_attempt_id) return;

    const attempts = await client.query(
      `SELECT id, user_id, score, server_duration_ms, submitted_at FROM attempts WHERE id = ANY($1::uuid[])`,
      [[match.player1_attempt_id, match.player2_attempt_id]],
    );
    const a1 = attempts.rows.find((a) => a.id === match.player1_attempt_id);
    const a2 = attempts.rows.find((a) => a.id === match.player2_attempt_id);
    if (!a1 || !a2) return;
    let winner: string;
    if (a1.score !== a2.score) winner = a1.score > a2.score ? a1.user_id : a2.user_id;
    else if (a1.server_duration_ms !== a2.server_duration_ms)
      winner = Number(a1.server_duration_ms) < Number(a2.server_duration_ms) ? a1.user_id : a2.user_id;
    else winner = new Date(a1.submitted_at) <= new Date(a2.submitted_at) ? a1.user_id : a2.user_id;

    await client.query(`UPDATE tournament_matches SET winner_id = $2, status = 'completed' WHERE id = $1`, [
      matchId,
      winner,
    ]);
    const loser = winner === a1.user_id ? a2.user_id : a1.user_id;
    await client.query(
      `UPDATE tournament_participants SET eliminated_in_round = $3
       WHERE tournament_id = $1 AND user_id = $2`,
      [m.tournament_id, loser, m.round_number],
    );
    await advanceRoundIfComplete(client, m.round_id, m.tournament_id, m.round_number);
  });
}
contextHooks.tournament = (contextId, userId, attemptId) => onMatchAttemptSubmitted(contextId, userId, attemptId);

async function advanceRoundIfComplete(
  client: PoolClient,
  roundId: string,
  tournamentId: string,
  roundNumber: number,
): Promise<void> {
  const pending = await client.query(
    `SELECT count(*) AS n FROM tournament_matches WHERE round_id = $1 AND status IN ('pending','running')`,
    [roundId],
  );
  if (Number(pending.rows[0].n) > 0) return;
  await client.query(`UPDATE tournament_rounds SET status = 'completed', ends_at = now() WHERE id = $1`, [roundId]);

  const winners = await client.query(
    `SELECT winner_id FROM tournament_matches WHERE round_id = $1 AND winner_id IS NOT NULL ORDER BY match_number`,
    [roundId],
  );
  const advancing = winners.rows.map((w) => w.winner_id);
  if (advancing.length <= 1) {
    // champion decided
    await client.query(`UPDATE tournaments SET status = 'completed', ends_at = now() WHERE id = $1`, [tournamentId]);
    if (advancing[0]) {
      await client.query(
        `UPDATE tournament_participants SET final_rank = 1 WHERE tournament_id = $1 AND user_id = $2`,
        [tournamentId, advancing[0]],
      );
      // rank everyone else by elimination round (later = better)
      await client.query(
        `UPDATE tournament_participants tp SET final_rank = sub.rnk
         FROM (
           SELECT user_id, row_number() OVER (ORDER BY eliminated_in_round DESC NULLS FIRST) + 1 AS rnk
           FROM tournament_participants
           WHERE tournament_id = $1 AND user_id <> $2
         ) sub
         WHERE tp.tournament_id = $1 AND tp.user_id = sub.user_id`,
        [tournamentId, advancing[0]],
      );
      const settings = await getSettings();
      await client.query('UPDATE users SET xp = xp + $2 WHERE id = $1', [advancing[0], settings.xpTournamentWin]);
      await client.query(
        `INSERT INTO notifications (user_id, kind, title, body, data) VALUES ($1,'tournament',$2,$3,$4)`,
        [
          advancing[0],
          JSON.stringify({ en: 'Tournament champion!', ar: 'بطل البطولة!' }),
          JSON.stringify({ en: 'You won the tournament!', ar: 'لقد فزت بالبطولة!' }),
          JSON.stringify({ tournamentId }),
        ],
      );
    }
    return;
  }

  const t = await client.query('SELECT * FROM tournaments WHERE id = $1', [tournamentId]);
  const round = await client.query(
    `INSERT INTO tournament_rounds (tournament_id, round_number, status, starts_at)
     VALUES ($1, $2, 'running', now()) RETURNING id`,
    [tournamentId, roundNumber + 1],
  );
  await buildMatches(client, round.rows[0].id, advancing, t.rows[0]);
}

async function tournamentDetail(id: string, userId: string | null) {
  const { rows } = await query('SELECT * FROM tournaments WHERE id = $1', [id]);
  const t = rows[0];
  if (!t) throw notFound('Tournament not found');
  const participants = await query(
    `SELECT tp.user_id, tp.seed, tp.final_rank, tp.eliminated_in_round, u.username, u.display_name, u.avatar
     FROM tournament_participants tp JOIN users u ON u.id = tp.user_id
     WHERE tp.tournament_id = $1 ORDER BY COALESCE(tp.final_rank, 9999), tp.seed NULLS LAST`,
    [id],
  );
  const rounds = await query(
    `SELECT r.id, r.round_number, r.status,
            COALESCE(json_agg(json_build_object(
              'id', m.id, 'matchNumber', m.match_number, 'status', m.status,
              'player1Id', m.player1_id, 'player2Id', m.player2_id, 'winnerId', m.winner_id,
              'player1Score', a1.score, 'player2Score', a2.score
            ) ORDER BY m.match_number) FILTER (WHERE m.id IS NOT NULL), '[]') AS matches
     FROM tournament_rounds r
     LEFT JOIN tournament_matches m ON m.round_id = r.id
     LEFT JOIN attempts a1 ON a1.id = m.player1_attempt_id
     LEFT JOIN attempts a2 ON a2.id = m.player2_attempt_id
     WHERE r.tournament_id = $1 GROUP BY r.id ORDER BY r.round_number`,
    [id],
  );
  let myMatch = null;
  if (userId && t.status === 'running') {
    const mm = await query(
      `SELECT m.id, m.status, m.player1_id, m.player2_id, m.player1_attempt_id, m.player2_attempt_id
       FROM tournament_matches m JOIN tournament_rounds r ON r.id = m.round_id
       WHERE r.tournament_id = $1 AND m.status = 'running' AND (m.player1_id = $2 OR m.player2_id = $2)`,
      [id, userId],
    );
    if (mm.rows[0]) {
      const m = mm.rows[0];
      const myAttempt = m.player1_id === userId ? m.player1_attempt_id : m.player2_attempt_id;
      myMatch = { id: m.id, played: myAttempt !== null };
    }
  }
  return {
    tournament: {
      id: t.id,
      title: t.title,
      kind: t.kind,
      status: t.status,
      maxPlayers: t.max_players,
      questionsPerMatch: t.questions_per_match,
      categoryId: t.category_id,
      difficulty: t.difficulty,
      startsAt: t.starts_at,
      endsAt: t.ends_at,
      participantCount: participants.rows.length,
    },
    participants: participants.rows,
    rounds: rounds.rows,
    myMatch,
    joined: userId ? participants.rows.some((p) => p.user_id === userId) : false,
  };
}

export async function tournamentRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', async (req) => {
    const { rows } = await query(
      `SELECT t.id, t.title, t.kind, t.status, t.max_players, t.starts_at, t.ends_at,
              (SELECT count(*) FROM tournament_participants tp WHERE tp.tournament_id = t.id) AS participant_count
       FROM tournaments t WHERE t.status IN ('registration','running','completed')
       ORDER BY CASE t.status WHEN 'registration' THEN 0 WHEN 'running' THEN 1 ELSE 2 END, t.created_at DESC
       LIMIT 50`,
    );
    return { tournaments: rows };
  });

  app.get('/:id', async (req) => {
    const { id } = req.params as { id: string };
    return tournamentDetail(id, req.userId);
  });

  app.post('/', { preHandler: [requireRole('admin')] }, async (req) => {
    const settings = await getSettings();
    const parsed = z
      .object({
        title: z.record(z.string()).default({}),
        kind: z.enum(['daily', 'weekly', 'monthly', 'special']).default('special'),
        categoryId: z.string().uuid().nullish(),
        difficulty: z.enum(['easy', 'medium', 'hard', 'expert']).nullish(),
        maxPlayers: z.number().int().min(2).max(1024).default(64),
        questionsPerMatch: z.number().int().min(1).max(50).optional(),
      })
      .safeParse(req.body ?? {});
    if (!parsed.success) throw badRequest('Invalid tournament', parsed.error.issues);
    const input = parsed.data;
    const { rows } = await query(
      `INSERT INTO tournaments (title, kind, category_id, difficulty, max_players, questions_per_match, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [
        JSON.stringify(input.title),
        input.kind,
        input.categoryId ?? null,
        input.difficulty ?? null,
        input.maxPlayers,
        input.questionsPerMatch ?? settings.tournamentDefaultQuestions,
        req.userId,
      ],
    );
    audit(req.userId, 'tournament.created', 'tournament', rows[0].id);
    return tournamentDetail(rows[0].id, req.userId);
  });

  app.post('/:id/join', { preHandler: [requireAccount] }, async (req) => {
    const { id } = req.params as { id: string };
    const { rows } = await query('SELECT status, max_players FROM tournaments WHERE id = $1', [id]);
    const t = rows[0];
    if (!t) throw notFound('Tournament not found');
    if (t.status !== 'registration') throw conflict('Registration is closed');
    const count = await query('SELECT count(*) AS n FROM tournament_participants WHERE tournament_id = $1', [id]);
    if (Number(count.rows[0].n) >= t.max_players) throw conflict('Tournament is full');
    await query(
      `INSERT INTO tournament_participants (tournament_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [id, req.userId],
    );
    return tournamentDetail(id, req.userId);
  });

  app.post('/:id/start', { preHandler: [requireRole('admin')] }, async (req) => {
    const { id } = req.params as { id: string };
    await startTournament(id, req.userId);
    return tournamentDetail(id, req.userId);
  });

  /** Play my current match. */
  app.post('/:id/play', { preHandler: [requireAccount] }, async (req) => {
    const { id } = req.params as { id: string };
    const mm = await query(
      `SELECT m.* FROM tournament_matches m JOIN tournament_rounds r ON r.id = m.round_id
       WHERE r.tournament_id = $1 AND m.status = 'running' AND (m.player1_id = $2 OR m.player2_id = $2)`,
      [id, req.userId],
    );
    const m = mm.rows[0];
    if (!m) throw notFound('No active match for you in this tournament');
    const myAttempt = m.player1_id === req.userId ? m.player1_attempt_id : m.player2_attempt_id;
    if (myAttempt) throw conflict('You already played this match');
    if (!m.question_ids?.length) throw forbidden('Match has no questions configured');
    return startAttempt(req.userId!, false, {
      mode: 'tournament',
      contextType: 'tournament',
      contextId: m.id,
      fixedQuestionIds: m.question_ids,
    });
  });
}
