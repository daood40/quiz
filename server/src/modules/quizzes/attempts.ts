import type { PoolClient } from 'pg';
import { audit, trackEvent } from '../../core/audit.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../core/errors.js';
import { getSettings, type AppSettings } from '../../core/settings.js';
import { query, withTransaction } from '../../db/pool.js';
import { awardXp, evaluateAchievements, touchStreak, localDate } from '../gamification/service.js';
import { registry } from '../questions/engine/registry.js';
import type { Outcome } from '../questions/engine/types.js';
import { computePoints } from '../scoring/points.js';
import { pickQuestions } from './pool.js';

/**
 * Context hooks — competition modules (challenges, tournaments, monthly)
 * register completion handlers here to avoid circular imports.
 */
type ContextHook = (contextId: string, userId: string, attemptId: string, score: number, timeMs: number) => Promise<void>;
export const contextHooks: Partial<Record<string, ContextHook>> = {};

export interface StartOptions {
  mode: string;
  categoryId?: string | null;
  difficulty?: string | null;
  language?: string | null;
  questionCount?: number;
  types?: string[];
  contextType?: 'solo' | 'challenge' | 'monthly' | 'tournament' | 'group' | 'daily';
  contextId?: string | null;
  fixedQuestionIds?: string[];
  overallTimeLimitSec?: number | null;
}

interface QuestionRow {
  id: string;
  type: string;
  difficulty: string;
  language: string;
  content: Record<string, unknown>;
  correct_answer: unknown;
  configuration: Record<string, unknown>;
  points: number;
  time_limit_sec: number | null;
  explanation: Record<string, unknown>;
  category_id: string | null;
}

async function loadQuestions(ids: string[]): Promise<Map<string, QuestionRow>> {
  const { rows } = await query<QuestionRow>(
    `SELECT id, type, difficulty, language, content, correct_answer, configuration,
            points, time_limit_sec, explanation, category_id
     FROM questions WHERE id = ANY($1::uuid[])`,
    [ids],
  );
  return new Map(rows.map((r) => [r.id, r]));
}

function presentQuestion(q: QuestionRow, timeLimitSec: number): Record<string, unknown> {
  const presented = registry.present(q.type, {
    type: q.type,
    content: q.content,
    correctAnswer: q.correct_answer,
    configuration: q.configuration,
  });
  return {
    id: q.id,
    type: q.type,
    difficulty: q.difficulty,
    points: q.points,
    timeLimitSec,
    content: presented.content,
    configuration: {
      // client only needs rendering hints, never scoring internals
      media: registry.getSpec(q.type).media,
      scored: registry.getSpec(q.type).scored,
    },
  };
}

export async function startAttempt(userId: string, isGuest: boolean, opts: StartOptions) {
  const settings = await getSettings();
  if (settings.maintenanceMode) throw forbidden('Platform is under maintenance');

  let count = Math.min(Math.max(opts.questionCount ?? settings.defaultQuizSize, 1), 100);
  if (isGuest) {
    if (opts.contextType && opts.contextType !== 'solo') throw forbidden('Create an account to join competitions');
    count = Math.min(count, settings.guestMaxQuestions);
  }
  if (settings.dailyQuizLimit > 0) {
    const { rows } = await query(
      `SELECT count(*) AS n FROM attempts WHERE user_id = $1 AND created_at > now() - interval '24 hours'`,
      [userId],
    );
    if (Number(rows[0].n) >= settings.dailyQuizLimit) throw forbidden('Daily quiz limit reached');
  }

  let questionIds: string[];
  if (opts.fixedQuestionIds?.length) {
    questionIds = opts.fixedQuestionIds;
  } else if (opts.mode === 'review') {
    // spaced-repetition style: replay questions this user previously missed
    const { rows } = await query<{ question_id: string }>(
      `SELECT question_id FROM (
         SELECT DISTINCT aa.question_id FROM attempt_answers aa
         JOIN attempts a ON a.id = aa.attempt_id AND a.user_id = $1
         JOIN questions q ON q.id = aa.question_id AND q.status = 'approved'
         WHERE aa.outcome IN ('incorrect','timeout')
           AND NOT EXISTS (
             SELECT 1 FROM attempt_answers ok
             JOIN attempts a2 ON a2.id = ok.attempt_id AND a2.user_id = $1
             WHERE ok.question_id = aa.question_id AND ok.outcome = 'correct'
               AND ok.answered_at > aa.answered_at)
       ) missed ORDER BY random() LIMIT $2`,
      [userId, count],
    );
    questionIds = rows.map((r) => r.question_id);
    if (questionIds.length === 0) throw badRequest('No mistakes to review — well done!');
  } else {
    const picked = await pickQuestions({
      categoryId: opts.categoryId,
      difficulty: opts.difficulty,
      language: opts.language,
      types: opts.types,
      count,
      excludeAnsweredBy: userId,
    });
    questionIds = picked.map((p) => p.id);
  }
  if (questionIds.length === 0) throw badRequest('No questions available for the selected filters');

  const questions = await loadQuestions(questionIds);
  // keep requested order for fixed sets; loadQuestions may reorder
  const ordered = questionIds.filter((id) => questions.has(id));

  const perQuestion: Record<string, { timeLimitSec: number }> = {};
  let totalSec = 0;
  for (const id of ordered) {
    const q = questions.get(id)!;
    const limit = q.time_limit_sec ?? settings.defaultQuestionTimeSec;
    perQuestion[id] = { timeLimitSec: limit };
    totalSec += limit;
  }
  // practice & review are untimed learning modes (self-paced, like Wayground
  // homework mode): no per-question timeout, no speed bonus, instant feedback
  const untimed = opts.mode === 'practice' || opts.mode === 'review';
  const overallSec = untimed ? 6 * 3600 : opts.overallTimeLimitSec ?? totalSec;
  const graceMs = settings.antiCheatGraceMs;
  const powerups = {
    fiftyFifty: settings.powerupFiftyFifty,
    timeExtend: untimed ? 0 : settings.powerupTimeExtend,
    used: {} as Record<string, { fiftyFifty?: string[]; timeExtend?: boolean }>,
  };

  const contextType = opts.contextType ?? 'solo';
  const { rows } = await query(
    `INSERT INTO attempts (user_id, mode, context_type, context_id, question_ids, question_meta, deadline_at, max_score)
     VALUES ($1,$2,$3,$4,$5,$6, now() + make_interval(secs => $7), $8)
     RETURNING id, started_at, deadline_at`,
    [
      userId,
      opts.mode,
      contextType,
      opts.contextId ?? null,
      ordered,
      JSON.stringify({ perQuestion, lastEventAt: new Date().toISOString(), graceMs, untimed, powerups }),
      overallSec + graceMs / 1000,
      ordered.reduce((sum, id) => {
        const q = questions.get(id)!;
        if (!registry.isScored(q.type)) return sum;
        const base = q.points > 0 ? q.points : settings.pointsPerDifficulty[q.difficulty] ?? 10;
        return sum + base;
      }, 0),
    ],
  ).catch((err: { code?: string }) => {
    if (err.code === '23505') throw conflict('You already have an attempt for this competition');
    throw err;
  });

  const attempt = rows[0];
  audit(userId, 'quiz.started', 'attempt', attempt.id, { mode: opts.mode, contextType, count: ordered.length });
  trackEvent(userId, 'quiz_start', { mode: opts.mode, contextType, questions: ordered.length });

  return {
    attemptId: attempt.id,
    startedAt: attempt.started_at,
    deadlineAt: attempt.deadline_at,
    mode: opts.mode,
    untimed,
    powerups: { fiftyFifty: powerups.fiftyFifty, timeExtend: powerups.timeExtend },
    questions: ordered.map((id) => presentQuestion(questions.get(id)!, perQuestion[id].timeLimitSec)),
  };
}

interface AttemptRow {
  id: string;
  user_id: string;
  mode: string;
  context_type: string;
  context_id: string | null;
  question_ids: string[];
  question_meta: {
    perQuestion: Record<string, { timeLimitSec: number }>;
    lastEventAt: string;
    graceMs: number;
    untimed?: boolean;
    powerups?: {
      fiftyFifty: number;
      timeExtend: number;
      used: Record<string, { fiftyFifty?: string[]; timeExtend?: boolean }>;
    };
  };
  status: string;
  started_at: string;
  deadline_at: string | null;
  flags: unknown[];
}

async function getOwnedAttempt(client: PoolClient, attemptId: string, userId: string): Promise<AttemptRow> {
  const { rows } = await client.query(
    `SELECT id, user_id, mode, context_type, context_id, question_ids, question_meta, status,
            started_at, deadline_at, flags
     FROM attempts WHERE id = $1 FOR UPDATE`,
    [attemptId],
  );
  const attempt = rows[0] as AttemptRow | undefined;
  if (!attempt) throw notFound('Attempt not found');
  if (attempt.user_id !== userId) throw forbidden('Not your attempt');
  return attempt;
}

async function flagSuspicious(
  client: PoolClient,
  attempt: AttemptRow,
  kind: string,
  details: Record<string, unknown>,
): Promise<void> {
  await client.query('INSERT INTO suspicious_events (user_id, attempt_id, kind, details) VALUES ($1,$2,$3,$4)', [
    attempt.user_id,
    attempt.id,
    kind,
    JSON.stringify(details),
  ]);
  await client.query(
    `UPDATE attempts SET flags = flags || $2::jsonb,
       suspicion = CASE WHEN jsonb_array_length(flags) + 1 >= 3 THEN 'suspicious' ELSE 'flagged' END
     WHERE id = $1`,
    [attempt.id, JSON.stringify([{ kind, at: new Date().toISOString(), ...details }])],
  );
}

/** Thrown inside the answer transaction; the flag is persisted after rollback. */
class FlaggedRejection extends Error {
  constructor(
    public readonly appError: AppError,
    public readonly attempt: AttemptRow,
    public readonly kind: string,
    public readonly details: Record<string, unknown>,
  ) {
    super(appError.message);
  }
}

/** Persists a flag outside any transaction (used after a rejected request). */
async function persistFlag(attempt: AttemptRow, kind: string, details: Record<string, unknown>): Promise<void> {
  await query('INSERT INTO suspicious_events (user_id, attempt_id, kind, details) VALUES ($1,$2,$3,$4)', [
    attempt.user_id,
    attempt.id,
    kind,
    JSON.stringify(details),
  ]);
  await query(
    `UPDATE attempts SET flags = flags || $2::jsonb,
       suspicion = CASE WHEN jsonb_array_length(flags) + 1 >= 3 THEN 'suspicious' ELSE 'flagged' END
     WHERE id = $1`,
    [attempt.id, JSON.stringify([{ kind, at: new Date().toISOString(), ...details }])],
  );
}

export async function answerQuestion(attemptId: string, userId: string, questionId: string, answer: unknown) {
  const settings = await getSettings();
  try {
    return await answerQuestionTx(attemptId, userId, questionId, answer, settings);
  } catch (err) {
    if (err instanceof FlaggedRejection) {
      // transaction rolled back and locks released — now persist the flag
      await persistFlag(err.attempt, err.kind, err.details).catch(() => undefined);
      throw err.appError;
    }
    throw err;
  }
}

async function answerQuestionTx(
  attemptId: string,
  userId: string,
  questionId: string,
  answer: unknown,
  settings: Awaited<ReturnType<typeof getSettings>>,
) {
  return withTransaction(async (client) => {
    const attempt = await getOwnedAttempt(client, attemptId, userId);
    if (attempt.status !== 'in_progress') throw conflict('Attempt is no longer in progress');
    if (!attempt.question_ids.includes(questionId)) {
      throw new FlaggedRejection(badRequest('Question is not part of this attempt'), attempt, 'foreign_question', { questionId });
    }

    const dup = await client.query('SELECT 1 FROM attempt_answers WHERE attempt_id = $1 AND question_id = $2', [
      attemptId,
      questionId,
    ]);
    if (dup.rowCount) {
      throw new FlaggedRejection(conflict('Answer already submitted for this question'), attempt, 'duplicate_submission', { questionId });
    }

    const now = Date.now();
    const meta = attempt.question_meta;
    const per = meta.perQuestion[questionId];
    if (!per) throw badRequest('Question timing metadata missing');
    const lastEvent = new Date(meta.lastEventAt).getTime();
    const elapsedMs = Math.max(0, now - lastEvent);
    const limitMs = per.timeLimitSec * 1000;
    const graceMs = meta.graceMs ?? settings.antiCheatGraceMs;

    const untimed = meta.untimed === true;
    const overallDeadline = attempt.deadline_at ? new Date(attempt.deadline_at).getTime() : null;
    const pastOverall = overallDeadline !== null && now > overallDeadline;
    const timedOut = untimed ? pastOverall : elapsedMs > limitMs + graceMs || pastOverall;

    const qRows = await client.query(
      `SELECT id, type, difficulty, content, correct_answer, configuration, points, explanation
       FROM questions WHERE id = $1`,
      [questionId],
    );
    const q = qRows.rows[0];
    if (!q) throw notFound('Question not found');

    let outcome: Outcome;
    let ratio = 0;
    let detail: unknown;
    if (timedOut) {
      outcome = 'timeout';
      if (pastOverall) await flagSuspicious(client, attempt, 'late_submit', { questionId, elapsedMs });
    } else {
      const result = registry.score(q.type, {
        type: q.type,
        content: q.content,
        correctAnswer: q.correct_answer,
        configuration: q.configuration,
      }, answer);
      outcome = result.outcome;
      ratio = result.ratio;
      detail = result.detail;
      if (elapsedMs < settings.antiCheatMinAnswerMs && outcome === 'correct') {
        await flagSuspicious(client, attempt, 'fast_answer', { questionId, elapsedMs });
      }
    }

    const scored = registry.isScored(q.type);
    const { points, maxPoints } = computePoints(
      {
        basePoints: q.points,
        difficulty: q.difficulty,
        result: { outcome, ratio, detail },
        // untimed modes earn no speed bonus — learning pace is not penalized or gamed
        timeTakenMs: untimed ? limitMs : Math.min(elapsedMs, limitMs),
        timeLimitMs: limitMs,
        scored,
      },
      settings,
    );

    await client.query(
      `INSERT INTO attempt_answers
         (attempt_id, question_id, answer, outcome, score, max_score, credit_ratio, time_taken_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [attemptId, questionId, JSON.stringify(answer ?? null), outcome, points, maxPoints, ratio, Math.min(elapsedMs, limitMs + graceMs)],
    );
    await client.query(`UPDATE attempts SET question_meta = jsonb_set(question_meta, '{lastEventAt}', to_jsonb($2::text)) WHERE id = $1`, [
      attemptId,
      new Date(now).toISOString(),
    ]);

    // live per-question stats
    await client.query(
      `UPDATE question_stats SET
         attempts = attempts + 1,
         correct = correct + CASE WHEN $2 = 'correct' THEN 1 ELSE 0 END,
         incorrect = incorrect + CASE WHEN $2 = 'incorrect' THEN 1 ELSE 0 END,
         partial = partial + CASE WHEN $2 = 'partial' THEN 1 ELSE 0 END,
         timeouts = timeouts + CASE WHEN $2 = 'timeout' THEN 1 ELSE 0 END,
         skips = skips + CASE WHEN $2 = 'skipped' THEN 1 ELSE 0 END,
         total_time_ms = total_time_ms + $3,
         updated_at = now()
       WHERE question_id = $1`,
      [questionId, outcome, Math.min(elapsedMs, limitMs)],
    );

    // instant feedback in self-paced modes (Wayground/Quizizz-style)
    const feedback = untimed
      ? { correctAnswer: q.correct_answer, explanation: q.explanation }
      : undefined;

    return { questionId, outcome, points, maxPoints, answered: true, feedback };
  });
}

/**
 * Power-ups (Trivia Crack-style), fully server-side so nothing leaks:
 * 50/50 returns wrong option ids to hide; time-extend stretches this
 * question's server deadline. Uses are stored in attempt metadata.
 */
export async function usePowerup(
  attemptId: string,
  userId: string,
  questionId: string,
  kind: 'fifty_fifty' | 'time_extend',
) {
  const settings = await getSettings();
  return withTransaction(async (client) => {
    const attempt = await getOwnedAttempt(client, attemptId, userId);
    if (attempt.status !== 'in_progress') throw conflict('Attempt is no longer in progress');
    if (!attempt.question_ids.includes(questionId)) throw badRequest('Question is not part of this attempt');
    const answered = await client.query('SELECT 1 FROM attempt_answers WHERE attempt_id = $1 AND question_id = $2', [
      attemptId,
      questionId,
    ]);
    if (answered.rowCount) throw conflict('Question already answered');

    const meta = attempt.question_meta;
    const powerups = meta.powerups ?? { fiftyFifty: 0, timeExtend: 0, used: {} };
    const used = powerups.used[questionId] ?? {};

    if (kind === 'fifty_fifty') {
      if (used.fiftyFifty) return { kind, removedOptionIds: used.fiftyFifty, remaining: powerups.fiftyFifty };
      if (powerups.fiftyFifty <= 0) throw conflict('No 50/50 power-ups left');
      const qRows = await client.query('SELECT type, content, correct_answer FROM questions WHERE id = $1', [questionId]);
      const q = qRows.rows[0];
      if (!q) throw notFound('Question not found');
      const options = Array.isArray(q.content?.options) ? (q.content.options as Array<{ id: string }>) : [];
      const correct =
        typeof q.correct_answer === 'string'
          ? q.correct_answer
          : String((q.correct_answer as { optionId?: string })?.optionId ?? '');
      const wrong = options.map((o) => o.id).filter((id) => id !== correct);
      if (options.length < 3 || !correct) throw badRequest('50/50 is not available for this question');
      const removed = wrong.sort(() => Math.random() - 0.5).slice(0, Math.min(2, wrong.length - 1));
      powerups.fiftyFifty -= 1;
      powerups.used[questionId] = { ...used, fiftyFifty: removed };
      await client.query(
        `UPDATE attempts SET question_meta = jsonb_set(question_meta, '{powerups}', $2::jsonb) WHERE id = $1`,
        [attemptId, JSON.stringify(powerups)],
      );
      return { kind, removedOptionIds: removed, remaining: powerups.fiftyFifty };
    }

    // time_extend
    if (used.timeExtend) throw conflict('Time already extended for this question');
    if (powerups.timeExtend <= 0) throw conflict('No time extensions left');
    const addSec = settings.timeExtendSec;
    powerups.timeExtend -= 1;
    powerups.used[questionId] = { ...used, timeExtend: true };
    meta.perQuestion[questionId].timeLimitSec += addSec;
    await client.query(
      `UPDATE attempts SET
         question_meta = jsonb_set(jsonb_set(question_meta, '{powerups}', $2::jsonb), '{perQuestion}', $3::jsonb),
         deadline_at = deadline_at + make_interval(secs => $4)
       WHERE id = $1`,
      [attemptId, JSON.stringify(powerups), JSON.stringify(meta.perQuestion), addSec],
    );
    return { kind, addedSec: addSec, remaining: powerups.timeExtend };
  });
}

export async function submitAttempt(attemptId: string, userId: string) {
  const settings = await getSettings();
  const summary = await withTransaction(async (client) => {
    const attempt = await getOwnedAttempt(client, attemptId, userId);
    if (attempt.status === 'submitted') throw conflict('Attempt already submitted');
    if (attempt.status !== 'in_progress') throw conflict('Attempt cannot be submitted');

    // mark unanswered questions as skipped
    const answered = await client.query('SELECT question_id FROM attempt_answers WHERE attempt_id = $1', [attemptId]);
    const answeredSet = new Set(answered.rows.map((r) => r.question_id));
    for (const qid of attempt.question_ids) {
      if (!answeredSet.has(qid)) {
        const qRow = await client.query('SELECT type, points, difficulty FROM questions WHERE id = $1', [qid]);
        const q = qRow.rows[0];
        const scored = q ? registry.isScored(q.type) : false;
        const base = q && scored ? (q.points > 0 ? q.points : settings.pointsPerDifficulty[q.difficulty] ?? 10) : 0;
        await client.query(
          `INSERT INTO attempt_answers (attempt_id, question_id, answer, outcome, score, max_score, credit_ratio, time_taken_ms)
           VALUES ($1,$2,'null','skipped',0,$3,0,0) ON CONFLICT DO NOTHING`,
          [attemptId, qid, base],
        );
        await client.query(
          `UPDATE question_stats SET attempts = attempts + 1, skips = skips + 1, updated_at = now() WHERE question_id = $1`,
          [qid],
        );
      }
    }

    const totals = await client.query(
      `SELECT COALESCE(sum(score),0) AS score, COALESCE(sum(max_score),0) AS max_score,
              count(*) FILTER (WHERE outcome='correct') AS correct,
              count(*) FILTER (WHERE outcome='incorrect') AS incorrect,
              count(*) FILTER (WHERE outcome='partial') AS partial,
              count(*) FILTER (WHERE outcome='timeout') AS timeouts,
              count(*) FILTER (WHERE outcome='skipped') AS skipped,
              COALESCE(sum(time_taken_ms),0) AS time_ms
       FROM attempt_answers WHERE attempt_id = $1`,
      [attemptId],
    );
    const t = totals.rows[0];
    const score = Number(t.score);
    const durationMs = Date.now() - new Date(attempt.started_at).getTime();

    await client.query(
      `UPDATE attempts SET status='submitted', submitted_at=now(), server_duration_ms=$2,
         score=$3, max_score=$4, correct_count=$5, incorrect_count=$6, partial_count=$7,
         timeout_count=$8, skipped_count=$9
       WHERE id = $1`,
      [attemptId, durationMs, score, Number(t.max_score), Number(t.correct), Number(t.incorrect), Number(t.partial), Number(t.timeouts), Number(t.skipped)],
    );

    // --- gamification ---
    const isPerfect = Number(t.correct) > 0 && Number(t.incorrect) === 0 && Number(t.timeouts) === 0 && Number(t.skipped) === 0 && Number(t.partial) === 0;
    let xp = Number(t.correct) * settings.xpPerCorrect + settings.xpQuizCompletion;
    if (attempt.context_type === 'daily') xp += settings.xpDailyChallenge;
    if (attempt.context_type === 'monthly') xp += settings.xpMonthlyChallenge;
    const xpRes = await awardXp(client, userId, xp, 'quiz_completion', attemptId, settings);
    const streak = await touchStreak(client, userId, settings);

    await client.query(
      `UPDATE users SET total_points = total_points + $2, updated_at = now() WHERE id = $1`,
      [userId, score],
    );
    await client.query(
      `UPDATE attempts SET xp_awarded = $2 WHERE id = $1`,
      [attemptId, xp],
    );

    // aggregate user stats
    await client.query(
      `INSERT INTO user_stats (user_id, quizzes_completed, questions_answered, correct_total, incorrect_total,
         timeout_total, skipped_total, total_time_ms, best_score, perfect_quizzes, updated_at)
       VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9, now())
       ON CONFLICT (user_id) DO UPDATE SET
         quizzes_completed = user_stats.quizzes_completed + 1,
         questions_answered = user_stats.questions_answered + $2,
         correct_total = user_stats.correct_total + $3,
         incorrect_total = user_stats.incorrect_total + $4,
         timeout_total = user_stats.timeout_total + $5,
         skipped_total = user_stats.skipped_total + $6,
         total_time_ms = user_stats.total_time_ms + $7,
         best_score = GREATEST(user_stats.best_score, $8),
         perfect_quizzes = user_stats.perfect_quizzes + $9,
         updated_at = now()`,
      [
        userId,
        attempt.question_ids.length,
        Number(t.correct),
        Number(t.incorrect),
        Number(t.timeouts),
        Number(t.skipped),
        Number(t.time_ms),
        score,
        isPerfect ? 1 : 0,
      ],
    );

    // per-category stats
    const catRows = await client.query(
      `SELECT q.category_id, count(*) AS answered, count(*) FILTER (WHERE aa.outcome IN ('correct','partial')) AS correct,
              COALESCE(sum(aa.time_taken_ms),0) AS time_ms
       FROM attempt_answers aa JOIN questions q ON q.id = aa.question_id
       WHERE aa.attempt_id = $1 AND q.category_id IS NOT NULL GROUP BY q.category_id`,
      [attemptId],
    );
    for (const c of catRows.rows) {
      await client.query(
        `UPDATE user_stats SET per_category = jsonb_set(per_category, ARRAY[$2::text],
           jsonb_build_object(
             'answered', COALESCE((per_category->$2->>'answered')::bigint, 0) + $3,
             'correct', COALESCE((per_category->$2->>'correct')::bigint, 0) + $4,
             'timeMs', COALESCE((per_category->$2->>'timeMs')::bigint, 0) + $5))
         WHERE user_id = $1`,
        [userId, c.category_id, Number(c.answered), Number(c.correct), Number(c.time_ms)],
      );
    }

    // daily activity
    const userRow = await client.query('SELECT timezone, country FROM users WHERE id = $1', [userId]);
    const tz = userRow.rows[0]?.timezone ?? 'UTC';
    const today = localDate(tz);
    await client.query(
      `INSERT INTO daily_activity (user_id, day, quizzes, questions, correct, points, xp)
       VALUES ($1, $2, 1, $3, $4, $5, $6)
       ON CONFLICT (user_id, day) DO UPDATE SET
         quizzes = daily_activity.quizzes + 1, questions = daily_activity.questions + $3,
         correct = daily_activity.correct + $4, points = daily_activity.points + $5,
         xp = daily_activity.xp + $6`,
      [userId, today, attempt.question_ids.length, Number(t.correct), score, xp],
    );

    // leaderboard scopes
    const timeMs = Number(t.time_ms);
    const country = (userRow.rows[0]?.country ?? '') as string;
    const nowD = new Date();
    const isoWeek = getIsoWeekKey(nowD);
    const monthKey = nowD.toISOString().slice(0, 7);
    const dayKey = nowD.toISOString().slice(0, 10);
    const scopes: Array<[string, string]> = [
      ['global', ''],
      ['daily', dayKey],
      ['weekly', isoWeek],
      ['monthly', monthKey],
    ];
    if (country) scopes.push(['country', country]);
    for (const c of catRows.rows) scopes.push(['category', String(c.category_id)]);
    if (attempt.context_type === 'monthly' && attempt.context_id) scopes.push(['monthly_challenge', attempt.context_id]);
    if (attempt.context_type === 'challenge' && attempt.context_id) scopes.push(['challenge', attempt.context_id]);
    if (attempt.context_type === 'tournament' && attempt.context_id) scopes.push(['tournament', attempt.context_id]);
    for (const [scope, key] of scopes) {
      await client.query(
        `INSERT INTO leaderboard_scores (user_id, scope, scope_key, points, correct, total_time_ms, last_scored_at)
         VALUES ($1,$2,$3,$4,$5,$6, now())
         ON CONFLICT (user_id, scope, scope_key) DO UPDATE SET
           points = leaderboard_scores.points + $4,
           correct = leaderboard_scores.correct + $5,
           total_time_ms = leaderboard_scores.total_time_ms + $6,
           last_scored_at = now()`,
        [userId, scope, key, score, Number(t.correct), timeMs],
      );
    }

    // write-through cache invalidation so boards reflect this result immediately
    await client.query(
      `DELETE FROM leaderboard_snapshots WHERE (scope, scope_key) IN
         (SELECT unnest($1::text[]), unnest($2::text[]))`,
      [scopes.map((s) => s[0]), scopes.map((s) => s[1])],
    );

    const achievements = await evaluateAchievements(client, userId, settings);
    for (const a of achievements) {
      await client.query(
        `INSERT INTO notifications (user_id, kind, title, body, data) VALUES ($1,'achievement',$2,$3,$4)`,
        [
          userId,
          JSON.stringify({ en: 'Achievement unlocked!', ar: 'إنجاز جديد!' }),
          JSON.stringify(a.name),
          JSON.stringify({ achievementId: a.id, slug: a.slug }),
        ],
      );
    }
    if (streak.milestone) {
      await client.query(
        `INSERT INTO notifications (user_id, kind, title, body, data) VALUES ($1,'streak',$2,$3,$4)`,
        [
          userId,
          JSON.stringify({ en: `${streak.milestone}-day streak!`, ar: `سلسلة ${streak.milestone} يوم!` }),
          JSON.stringify({ en: 'Keep it going!', ar: 'واصل التقدم!' }),
          JSON.stringify({ streak: streak.milestone }),
        ],
      );
    }

    return {
      attemptId,
      score,
      maxScore: Number(t.max_score),
      correct: Number(t.correct),
      incorrect: Number(t.incorrect),
      partial: Number(t.partial),
      timeout: Number(t.timeouts),
      skipped: Number(t.skipped),
      accuracy:
        attempt.question_ids.length > 0
          ? Math.round((Number(t.correct) / attempt.question_ids.length) * 1000) / 10
          : 0,
      totalTimeMs: Number(t.time_ms),
      durationMs,
      xpAwarded: xp,
      level: xpRes.newLevel,
      leveledUp: xpRes.leveledUp,
      streak: streak.current,
      achievements,
      isPerfect,
      contextType: attempt.context_type,
      contextId: attempt.context_id,
    };
  });

  if (summary.contextType !== 'solo' && summary.contextId) {
    const hook = contextHooks[summary.contextType];
    if (hook) {
      await hook(summary.contextId, userId, attemptId, summary.score, summary.totalTimeMs).catch((err) =>
        console.error(`context hook ${summary.contextType} failed:`, err),
      );
    }
  }
  audit(userId, 'quiz.completed', 'attempt', attemptId, { score: summary.score });
  trackEvent(userId, 'quiz_complete', {
    score: summary.score,
    correct: summary.correct,
    durationMs: summary.durationMs,
  });
  return summary;
}

export function getIsoWeekKey(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Full review: questions with the user's answers, correct answers and explanations. */
export async function getAttemptReview(attemptId: string, userId: string) {
  const { rows: attemptRows } = await query(
    `SELECT * FROM attempts WHERE id = $1 AND user_id = $2`,
    [attemptId, userId],
  );
  const attempt = attemptRows[0];
  if (!attempt) throw notFound('Attempt not found');
  if (attempt.status === 'in_progress') throw forbidden('Submit the attempt before reviewing answers');

  const { rows } = await query(
    `SELECT aa.question_id, aa.answer, aa.outcome, aa.score, aa.max_score, aa.credit_ratio, aa.time_taken_ms,
            q.type, q.content, q.correct_answer, q.explanation, q.difficulty
     FROM attempt_answers aa JOIN questions q ON q.id = aa.question_id
     WHERE aa.attempt_id = $1`,
    [attemptId],
  );
  const byId = new Map(rows.map((r) => [r.question_id, r]));
  const items = (attempt.question_ids as string[]).map((qid: string) => {
    const r = byId.get(qid);
    if (!r) return null;
    return {
      questionId: qid,
      type: r.type,
      difficulty: r.difficulty,
      content: r.content,
      yourAnswer: r.answer,
      correctAnswer: r.correct_answer,
      explanation: r.explanation,
      outcome: r.outcome,
      score: r.score,
      maxScore: r.max_score,
      timeTakenMs: r.time_taken_ms,
    };
  }).filter(Boolean);

  return {
    attempt: {
      id: attempt.id,
      mode: attempt.mode,
      status: attempt.status,
      score: attempt.score,
      maxScore: attempt.max_score,
      correct: attempt.correct_count,
      incorrect: attempt.incorrect_count,
      partial: attempt.partial_count,
      timeout: attempt.timeout_count,
      skipped: attempt.skipped_count,
      startedAt: attempt.started_at,
      submittedAt: attempt.submitted_at,
      durationMs: attempt.server_duration_ms,
    },
    items,
  };
}

/** Expires stale in-progress attempts (background job + on-demand). */
export async function expireStaleAttempts(): Promise<number> {
  const { rowCount } = await query(
    `UPDATE attempts SET status = 'expired'
     WHERE status = 'in_progress' AND deadline_at IS NOT NULL AND deadline_at < now() - interval '5 minutes'`,
  );
  return rowCount ?? 0;
}
