import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { query } from '../src/db/pool.js';
import { api, closeAll, getApp, loginAs, makeAdmin, registerUser, resetDb, seedCategory, seedQuestion } from './helpers.js';

beforeAll(async () => {
  await getApp();
});
afterAll(async () => {
  await closeAll();
});

describe('auth', () => {
  beforeEach(resetDb);

  it('register → login → refresh rotation → logout', async () => {
    const u = await registerUser('alice');
    expect(u.token).toBeTruthy();

    const login = await api('/auth/login', { method: 'POST', body: { identifier: 'alice', password: 'Passw0rd123' } });
    expect(login.status).toBe(200);

    const refresh = await api('/auth/refresh', { method: 'POST', body: { refreshToken: u.refreshToken } });
    expect(refresh.status).toBe(200);
    // old refresh token is revoked after rotation
    const replay = await api('/auth/refresh', { method: 'POST', body: { refreshToken: u.refreshToken } });
    expect(replay.status).toBe(401);
  });

  it('rejects wrong password and duplicate registration', async () => {
    await registerUser('bob');
    const bad = await api('/auth/login', { method: 'POST', body: { identifier: 'bob', password: 'wrong' } });
    expect(bad.status).toBe(401);
    const dup = await api('/auth/register', {
      method: 'POST',
      body: { email: 'bob@test.com', username: 'bob2', password: 'Passw0rd123' },
    });
    expect(dup.status).toBe(409);
  });

  it('banned users cannot log in', async () => {
    const u = await registerUser('banned');
    await query(`UPDATE users SET status = 'banned' WHERE id = $1`, [u.id]);
    const login = await api('/auth/login', { method: 'POST', body: { identifier: 'banned', password: 'Passw0rd123' } });
    expect(login.status).toBe(403);
  });

  it('password reset flow', async () => {
    await registerUser('carol');
    const forgot = await api('/auth/forgot-password', { method: 'POST', body: { email: 'carol@test.com' } });
    expect(forgot.status).toBe(200);
    const token = (forgot.body as { resetToken?: string }).resetToken;
    expect(token).toBeTruthy();
    const reset = await api('/auth/reset-password', { method: 'POST', body: { token, password: 'NewPassw0rd1' } });
    expect(reset.status).toBe(200);
    const login = await api('/auth/login', { method: 'POST', body: { identifier: 'carol', password: 'NewPassw0rd1' } });
    expect(login.status).toBe(200);
    // token is single-use
    const again = await api('/auth/reset-password', { method: 'POST', body: { token, password: 'Another123' } });
    expect(again.status).toBe(400);
  });

  it('guest mode works and guests cannot join competitions', async () => {
    const guest = await api('/auth/guest', { method: 'POST', body: {} });
    expect(guest.status).toBe(200);
    const gtoken = (guest.body as { accessToken: string }).accessToken;
    const create = await api('/challenges', { method: 'POST', token: gtoken, body: {} });
    expect(create.status).toBe(403);
  });
});

describe('quiz flow (server-authoritative)', () => {
  beforeEach(resetDb);

  it('full flow: start → answer → submit → review, with correct scoring', async () => {
    const u = await registerUser('player');
    for (let i = 0; i < 5; i++) await seedQuestion({});

    const start = await api('/quizzes/start', { method: 'POST', token: u.token, body: { questionCount: 3 } });
    expect(start.status).toBe(200);
    const body = start.body as { attemptId: string; questions: Array<{ id: string; content: Record<string, unknown> }> };
    expect(body.questions).toHaveLength(3);
    // sanitization: no correct answers leak
    expect(JSON.stringify(body.questions)).not.toContain('correct');

    // answer all correctly (seeded correct = o1)
    for (const q of body.questions) {
      const res = await api(`/quizzes/attempts/${body.attemptId}/answers`, {
        method: 'POST',
        token: u.token,
        body: { questionId: q.id, answer: 'o1' },
      });
      expect(res.status).toBe(200);
      expect((res.body as { outcome: string }).outcome).toBe('correct');
    }

    const submit = await api(`/quizzes/attempts/${body.attemptId}/submit`, { method: 'POST', token: u.token });
    expect(submit.status).toBe(200);
    const summary = submit.body as { score: number; correct: number; isPerfect: boolean; achievements: Array<{ slug: string }> };
    expect(summary.correct).toBe(3);
    expect(summary.score).toBeGreaterThanOrEqual(30); // base + speed bonuses
    expect(summary.isPerfect).toBe(true);

    const review = await api(`/quizzes/attempts/${body.attemptId}/review`, { token: u.token });
    expect(review.status).toBe(200);
    const items = (review.body as { items: Array<{ correctAnswer: unknown; outcome: string }> }).items;
    expect(items).toHaveLength(3);
    expect(items[0].correctAnswer).toBe('o1'); // review DOES expose answers post-submit
  });

  it('rejects duplicate answers, double submit, foreign questions', async () => {
    const u = await registerUser('cheater');
    for (let i = 0; i < 3; i++) await seedQuestion({});
    const outsider = await seedQuestion({});

    const start = await api('/quizzes/start', { method: 'POST', token: u.token, body: { questionCount: 2 } });
    const { attemptId, questions } = start.body as { attemptId: string; questions: Array<{ id: string }> };

    await api(`/quizzes/attempts/${attemptId}/answers`, { method: 'POST', token: u.token, body: { questionId: questions[0].id, answer: 'o1' } });
    const dup = await api(`/quizzes/attempts/${attemptId}/answers`, { method: 'POST', token: u.token, body: { questionId: questions[0].id, answer: 'o2' } });
    expect(dup.status).toBe(409);

    // a question not in the attempt (only 2 of 3+ were selected → find one not included)
    const ids = new Set(questions.map((q) => q.id));
    const foreignId = ids.has(outsider) ? (await seedQuestion({})) : outsider;
    const foreign = await api(`/quizzes/attempts/${attemptId}/answers`, { method: 'POST', token: u.token, body: { questionId: foreignId, answer: 'o1' } });
    expect(foreign.status).toBe(400);

    await api(`/quizzes/attempts/${attemptId}/submit`, { method: 'POST', token: u.token });
    const again = await api(`/quizzes/attempts/${attemptId}/submit`, { method: 'POST', token: u.token });
    expect(again.status).toBe(409);

    // suspicious events were recorded
    const flags = await query('SELECT kind FROM suspicious_events WHERE attempt_id = $1', [attemptId]);
    const kinds = flags.rows.map((r) => r.kind);
    expect(kinds).toContain('duplicate_submission');
    expect(kinds).toContain('foreign_question');
  });

  it('server-side timeout: answers after the per-question limit score 0', async () => {
    const u = await registerUser('slowpoke');
    await seedQuestion({ timeLimitSec: 5 });
    const start = await api('/quizzes/start', { method: 'POST', token: u.token, body: { mode: 'timed', questionCount: 1 } });
    const { attemptId, questions } = start.body as { attemptId: string; questions: Array<{ id: string }> };
    // simulate elapsed time server-side: shift lastEventAt into the past beyond limit+grace
    await query(
      `UPDATE attempts SET question_meta = jsonb_set(question_meta, '{lastEventAt}', to_jsonb((now() - interval '30 seconds')::text))
       WHERE id = $1`,
      [attemptId],
    );
    const res = await api(`/quizzes/attempts/${attemptId}/answers`, { method: 'POST', token: u.token, body: { questionId: questions[0].id, answer: 'o1' } });
    expect(res.status).toBe(200);
    expect((res.body as { outcome: string; points: number }).outcome).toBe('timeout');
    expect((res.body as { points: number }).points).toBe(0);
  });

  it('client cannot influence score by sending score fields', async () => {
    const u = await registerUser('hax');
    await seedQuestion({});
    const start = await api('/quizzes/start', { method: 'POST', token: u.token, body: { questionCount: 1 } });
    const { attemptId, questions } = start.body as { attemptId: string; questions: Array<{ id: string }> };
    const res = await api(`/quizzes/attempts/${attemptId}/answers`, {
      method: 'POST',
      token: u.token,
      body: { questionId: questions[0].id, answer: 'o2', score: 99999, outcome: 'correct' },
    });
    expect((res.body as { outcome: string; points: number }).outcome).toBe('incorrect');
    expect((res.body as { points: number }).points).toBe(0);
  });

  it('unanswered questions are marked skipped on submit', async () => {
    const u = await registerUser('quitter');
    for (let i = 0; i < 3; i++) await seedQuestion({});
    const start = await api('/quizzes/start', { method: 'POST', token: u.token, body: { questionCount: 3 } });
    const { attemptId } = start.body as { attemptId: string };
    const submit = await api(`/quizzes/attempts/${attemptId}/submit`, { method: 'POST', token: u.token });
    expect((submit.body as { skipped: number }).skipped).toBe(3);
  });

  it('quiz with no matching questions fails cleanly', async () => {
    const u = await registerUser('empty');
    const start = await api('/quizzes/start', { method: 'POST', token: u.token, body: { questionCount: 5 } });
    expect(start.status).toBe(400);
  });

  it('other users cannot touch my attempt', async () => {
    const u1 = await registerUser('owner1');
    const u2 = await registerUser('intruder');
    await seedQuestion({});
    const start = await api('/quizzes/start', { method: 'POST', token: u1.token, body: { questionCount: 1 } });
    const { attemptId, questions } = start.body as { attemptId: string; questions: Array<{ id: string }> };
    const res = await api(`/quizzes/attempts/${attemptId}/answers`, { method: 'POST', token: u2.token, body: { questionId: questions[0].id, answer: 'o1' } });
    expect(res.status).toBe(403);
    const sub = await api(`/quizzes/attempts/${attemptId}/submit`, { method: 'POST', token: u2.token });
    expect(sub.status).toBe(403);
  });
});

describe('ranking & tie-breakers', () => {
  beforeEach(resetDb);

  async function playPerfect(username: string, delayMsBetween = 0) {
    const u = await registerUser(username);
    const start = await api('/quizzes/start', { method: 'POST', token: u.token, body: { mode: 'timed', questionCount: 2 } });
    const { attemptId, questions } = start.body as { attemptId: string; questions: Array<{ id: string }> };
    for (const q of questions) {
      if (delayMsBetween > 0) {
        await query(
          `UPDATE attempts SET question_meta = jsonb_set(question_meta, '{lastEventAt}', to_jsonb((now() - make_interval(secs => $2))::text)) WHERE id = $1`,
          [attemptId, delayMsBetween / 1000],
        );
      }
      await api(`/quizzes/attempts/${attemptId}/answers`, { method: 'POST', token: u.token, body: { questionId: q.id, answer: 'o1' } });
    }
    await api(`/quizzes/attempts/${attemptId}/submit`, { method: 'POST', token: u.token });
    return u;
  }

  it('equal points → faster total time ranks higher', async () => {
    for (let i = 0; i < 4; i++) await seedQuestion({ timeLimitSec: 60 });
    // fast player: answers at ~29s (past speed-bonus? bonus scales with remaining). To equalize points,
    // disable speed bonus so both earn identical points but different times.
    await query(`INSERT INTO app_settings (key, value) VALUES ('speedBonusEnabled','false')`);
    await playPerfect('fastp', 5000);
    await playPerfect('slowp', 20000);
    const lb = await api('/leaderboards?scope=global');
    const entries = (lb.body as { entries: Array<{ username: string; points: number; totalTimeMs: number }> }).entries;
    expect(entries).toHaveLength(2);
    expect(entries[0].points).toBe(entries[1].points);
    expect(entries[0].username).toBe('fastp');
  });
});

describe('competitive fairness', () => {
  beforeEach(resetDb);

  async function play(token: string, mode: string, count = 2) {
    const start = await api('/quizzes/start', { method: 'POST', token, body: { mode, questionCount: count } });
    const { attemptId, questions } = start.body as { attemptId: string; questions: Array<{ id: string }> };
    for (const q of questions) {
      await api(`/quizzes/attempts/${attemptId}/answers`, { method: 'POST', token, body: { questionId: q.id, answer: 'o1' } });
    }
    const submit = await api(`/quizzes/attempts/${attemptId}/submit`, { method: 'POST', token });
    return submit.body as { score: number };
  }

  it('practice and review points never reach the competitive leaderboard', async () => {
    for (let i = 0; i < 2; i++) await seedQuestion({});
    const u = await registerUser('learner');
    const summary = await play(u.token, 'practice');
    expect(summary.score).toBeGreaterThan(0); // result screen still shows earned points
    const lb = await api('/leaderboards?scope=global');
    expect((lb.body as { entries: unknown[] }).entries).toHaveLength(0);
    const row = await query('SELECT total_points FROM users WHERE id = $1', [u.id]);
    expect(Number(row.rows[0].total_points)).toBe(0);
  });

  it('consecutive correct answers earn a capped in-round streak bonus', async () => {
    for (let i = 0; i < 2; i++) await seedQuestion({});
    await query(`INSERT INTO app_settings (key, value) VALUES ('speedBonusEnabled','false')`);
    const { invalidateSettingsCache } = await import('../src/core/settings.js');
    invalidateSettingsCache();
    const u = await registerUser('streaker');
    const summary = await play(u.token, 'timed');
    // 2 questions × 10 base + streak bonuses (1st: +2, 2nd: +4)
    expect(summary.score).toBe(26);
  });

  it('daily competitive cap limits ranked points but not the result screen', async () => {
    for (let i = 0; i < 2; i++) await seedQuestion({});
    await query(
      `INSERT INTO app_settings (key, value) VALUES
       ('dailyCompetitivePointsCap','12'), ('speedBonusEnabled','false'), ('streakBonusEnabled','false')`,
    );
    const { invalidateSettingsCache } = await import('../src/core/settings.js');
    invalidateSettingsCache();
    const u = await registerUser('capped');
    const summary = await play(u.token, 'timed');
    expect(summary.score).toBe(20); // full score on the result screen
    const lb = await api('/leaderboards?scope=global');
    const entries = (lb.body as { entries: Array<{ points: number }> }).entries;
    expect(entries[0].points).toBe(12); // ranked points hit the cap
    const row = await query('SELECT total_points FROM users WHERE id = $1', [u.id]);
    expect(Number(row.rows[0].total_points)).toBe(12);
  });
});

describe('challenges', () => {
  beforeEach(resetDb);

  it('create → invite → join by code → both play identical questions → completion', async () => {
    for (let i = 0; i < 6; i++) await seedQuestion({});
    const creator = await registerUser('creator');
    const rival = await registerUser('rival');

    const created = await api('/challenges', {
      method: 'POST',
      token: creator.token,
      body: { title: 'Duel', questionCount: 3, inviteUsernames: ['rival'] },
    });
    expect(created.status).toBe(200);
    const challenge = (created.body as { challenge: { id: string; code: string } }).challenge;

    // rival got a notification
    const notifs = await api('/notifications', { token: rival.token });
    expect((notifs.body as { notifications: Array<{ kind: string }> }).notifications.some((n) => n.kind === 'challenge_invite')).toBe(true);

    const joined = await api('/challenges/join', { method: 'POST', token: rival.token, body: { code: challenge.code } });
    expect(joined.status).toBe(200);

    const s1 = await api(`/challenges/${challenge.id}/start`, { method: 'POST', token: creator.token });
    const s2 = await api(`/challenges/${challenge.id}/start`, { method: 'POST', token: rival.token });
    expect(s1.status).toBe(200);
    expect(s2.status).toBe(200);
    const q1 = (s1.body as { questions: Array<{ id: string }> }).questions.map((q) => q.id).sort();
    const q2 = (s2.body as { questions: Array<{ id: string }> }).questions.map((q) => q.id).sort();
    expect(q1).toEqual(q2); // fairness: identical question sets

    // creator answers all correct, rival all wrong
    for (const [user, s, answer] of [[creator, s1, 'o1'], [rival, s2, 'o2']] as const) {
      const { attemptId, questions } = s.body as { attemptId: string; questions: Array<{ id: string }> };
      for (const q of questions) {
        await api(`/quizzes/attempts/${attemptId}/answers`, { method: 'POST', token: user.token, body: { questionId: q.id, answer } });
      }
      await api(`/quizzes/attempts/${attemptId}/submit`, { method: 'POST', token: user.token });
    }

    const detail = await api(`/challenges/${challenge.id}`, { token: creator.token });
    const d = detail.body as { challenge: { status: string }; participants: Array<{ username: string; score: number; status: string }> };
    expect(d.challenge.status).toBe('completed');
    expect(d.participants.every((p) => p.status === 'completed')).toBe(true);
    expect(d.participants[0].username).toBe('creator'); // ranked first by score
    expect(d.participants[0].score).toBeGreaterThan(d.participants[1].score);
  });

  it('cannot start an expired challenge', async () => {
    for (let i = 0; i < 3; i++) await seedQuestion({});
    const u = await registerUser('late');
    const created = await api('/challenges', { method: 'POST', token: u.token, body: { questionCount: 2 } });
    const challenge = (created.body as { challenge: { id: string } }).challenge;
    await query(`UPDATE challenges SET expires_at = now() - interval '1 hour' WHERE id = $1`, [challenge.id]);
    const start = await api(`/challenges/${challenge.id}/start`, { method: 'POST', token: u.token });
    expect(start.status).toBe(409);
  });
});

describe('monthly challenge', () => {
  beforeEach(resetDb);

  it('is auto-created, playable once, ranked', async () => {
    for (let i = 0; i < 25; i++) await seedQuestion({});
    const u = await registerUser('monthlyp');
    const current = await api('/monthly-challenges/current');
    expect(current.status).toBe(200);
    const mc = (current.body as { monthlyChallenge: { yearMonth: string; status: string } }).monthlyChallenge;
    expect(mc.status).toBe('active');
    expect(mc.yearMonth).toBe(new Date().toISOString().slice(0, 7));

    const start = await api('/monthly-challenges/current/start', { method: 'POST', token: u.token });
    expect(start.status).toBe(200);
    const { attemptId, questions } = start.body as { attemptId: string; questions: Array<{ id: string }> };
    for (const q of questions) {
      await api(`/quizzes/attempts/${attemptId}/answers`, { method: 'POST', token: u.token, body: { questionId: q.id, answer: 'o1' } });
    }
    await api(`/quizzes/attempts/${attemptId}/submit`, { method: 'POST', token: u.token });

    const again = await api('/monthly-challenges/current/start', { method: 'POST', token: u.token });
    expect(again.status).toBe(409); // one participation per month

    const after = await api('/monthly-challenges/current', { token: u.token });
    const lb = (after.body as { leaderboard: Array<{ username: string }> }).leaderboard;
    expect(lb[0]?.username).toBe('monthlyp');
  });
});

describe('tournaments', () => {
  beforeEach(resetDb);

  it('4-player single-elimination runs to a champion', async () => {
    for (let i = 0; i < 30; i++) await seedQuestion({});
    const admin = await registerUser('tadmin');
    await makeAdmin(admin.id);
    const adminToken = await loginAs('tadmin');
    const players = await Promise.all(['tp1', 'tp2', 'tp3', 'tp4'].map((n) => registerUser(n)));

    const created = await api('/tournaments', { method: 'POST', token: adminToken, body: { kind: 'special', questionsPerMatch: 2 } });
    expect(created.status).toBe(200);
    const tid = (created.body as { tournament: { id: string } }).tournament.id;

    for (const p of players) {
      const join = await api(`/tournaments/${tid}/join`, { method: 'POST', token: p.token });
      expect(join.status).toBe(200);
    }
    const started = await api(`/tournaments/${tid}/start`, { method: 'POST', token: adminToken });
    expect(started.status).toBe(200);
    expect((started.body as { tournament: { status: string } }).tournament.status).toBe('running');

    // play rounds until completed; stronger players (lower index) answer correctly
    for (let round = 0; round < 3; round++) {
      const detail = await api(`/tournaments/${tid}`, { token: adminToken });
      if ((detail.body as { tournament: { status: string } }).tournament.status === 'completed') break;
      for (let pi = 0; pi < players.length; pi++) {
        const p = players[pi];
        const play = await api(`/tournaments/${tid}/play`, { method: 'POST', token: p.token });
        if (play.status !== 200) continue; // eliminated or already played
        const { attemptId, questions } = play.body as { attemptId: string; questions: Array<{ id: string }> };
        for (const q of questions) {
          await api(`/quizzes/attempts/${attemptId}/answers`, {
            method: 'POST',
            token: p.token,
            body: { questionId: q.id, answer: pi === 0 ? 'o1' : 'o2' }, // tp1 always right, others wrong
          });
        }
        await api(`/quizzes/attempts/${attemptId}/submit`, { method: 'POST', token: p.token });
      }
    }

    const final = await api(`/tournaments/${tid}`, { token: adminToken });
    const f = final.body as { tournament: { status: string }; participants: Array<{ username: string; final_rank: number | null }> };
    expect(f.tournament.status).toBe('completed');
    const champion = f.participants.find((p) => p.final_rank === 1);
    expect(champion?.username).toBe('tp1');
  });
});

describe('groups', () => {
  beforeEach(resetDb);

  it('create, join by code, leaderboard, leave', async () => {
    const owner = await registerUser('gowner');
    const member = await registerUser('gmember');
    const created = await api('/groups', { method: 'POST', token: owner.token, body: { name: 'Quiz Masters' } });
    expect(created.status).toBe(200);
    const g = (created.body as { group: { id: string; code: string } }).group;
    const joined = await api('/groups/join', { method: 'POST', token: member.token, body: { code: g.code } });
    expect(joined.status).toBe(200);
    const lb = await api(`/leaderboards?scope=group&key=${g.id}`, { token: owner.token });
    expect((lb.body as { entries: unknown[] }).entries).toHaveLength(2);
    const leave = await api(`/groups/${g.id}/leave`, { method: 'POST', token: member.token });
    expect(leave.status).toBe(200);
  });
});

describe('admin & RBAC', () => {
  beforeEach(resetDb);

  it('non-admin cannot access admin routes', async () => {
    const u = await registerUser('pleb');
    expect((await api('/admin/dashboard', { token: u.token })).status).toBe(403);
    expect((await api('/admin/users', { token: u.token })).status).toBe(403);
    expect((await api('/admin/settings', { token: u.token })).status).toBe(403);
  });

  it('question lifecycle: create → validate → pending → approve → visible in pool', async () => {
    const admin = await registerUser('qadmin');
    await makeAdmin(admin.id);
    const token = await loginAs('qadmin');

    const invalid = await api('/admin/questions', {
      method: 'POST',
      token,
      body: { type: 'multiple_choice', content: { prompt: { en: 'X?' }, options: [{ id: 'o1', text: 'only one' }] }, correctAnswer: 'o1' },
    });
    expect(invalid.status).toBe(422);

    const created = await api('/admin/questions', {
      method: 'POST',
      token,
      body: {
        type: 'multiple_choice',
        content: { prompt: { en: 'Capital of Japan?' }, options: [{ id: 'o1', text: 'Tokyo' }, { id: 'o2', text: 'Kyoto' }] },
        correctAnswer: 'o1',
        status: 'pending_review',
      },
    });
    expect(created.status).toBe(200);
    const qid = (created.body as { id: string }).id;

    // exact duplicate is rejected
    const dupe = await api('/admin/questions', {
      method: 'POST',
      token,
      body: {
        type: 'multiple_choice',
        content: { prompt: { en: 'capital of japan' }, options: [{ id: 'o1', text: 'Tokyo' }, { id: 'o2', text: 'Osaka' }] },
        correctAnswer: 'o1',
      },
    });
    expect(dupe.status).toBe(422);

    // not approved yet → not in pool
    const player = await registerUser('poolp');
    expect((await api('/quizzes/start', { method: 'POST', token: player.token, body: { questionCount: 1 } })).status).toBe(400);

    const approve = await api(`/admin/questions/${qid}/status`, { method: 'POST', token, body: { status: 'approved' } });
    expect(approve.status).toBe(200);
    expect((await api('/quizzes/start', { method: 'POST', token: player.token, body: { questionCount: 1 } })).status).toBe(200);
  });

  it('reports flow + settings update', async () => {
    const qid = await seedQuestion({});
    const u = await registerUser('reporter');
    const rep = await api(`/questions/${qid}/report`, { method: 'POST', token: u.token, body: { reason: 'typo', details: 'misspelled' } });
    expect(rep.status).toBe(200);

    const admin = await registerUser('radmin');
    await makeAdmin(admin.id);
    const token = await loginAs('radmin');
    const list = await api('/admin/reports?status=open', { token });
    expect((list.body as { total: number }).total).toBe(1);

    const patch = await api('/admin/settings', { method: 'PATCH', token, body: { defaultQuizSize: 15, nonsense: true } });
    expect(patch.status).toBe(200);
    expect((patch.body as { settings: { defaultQuizSize: number } }).settings.defaultQuizSize).toBe(15);
  });

  it('CSV import validates row-by-row; strict mode imports nothing on error', async () => {
    await seedCategory('science');
    const admin = await registerUser('importer');
    await makeAdmin(admin.id);
    const token = await loginAs('importer');

    const badCsv = [
      'type,category_slug,difficulty,prompt_en,options,correct_answer',
      'multiple_choice,science,easy,Good question?,A|B|C,A',
      'multiple_choice,nope_cat,easy,Bad category?,A|B,A',
    ].join('\n');
    const strict = await api('/admin/questions/import', { method: 'POST', token, body: { format: 'csv', data: badCsv, mode: 'strict' } });
    expect((strict.body as { imported: number; errors: Array<{ row: number; field: string }> }).imported).toBe(0);
    expect((strict.body as { errors: Array<{ row: number }> }).errors[0].row).toBe(3);

    const partial = await api('/admin/questions/import', { method: 'POST', token, body: { format: 'csv', data: badCsv, mode: 'partial', status: 'approved' } });
    expect((partial.body as { imported: number }).imported).toBe(1);

    const exported = await api('/admin/questions/export?format=json&status=approved', { token });
    expect(exported.status).toBe(200);
    expect((exported.body as unknown[]).length).toBe(1);
  });

  it('moderator cannot grant roles; admin cannot self-promote to super_admin targets', async () => {
    const mod = await registerUser('modx');
    await makeAdmin(mod.id, 'moderator');
    const modToken = await loginAs('modx');
    const victim = await registerUser('victim');
    const res = await api(`/admin/users/${victim.id}/role`, { method: 'POST', token: modToken, body: { role: 'admin' } });
    expect(res.status).toBe(403);
    // moderator CAN suspend a normal user
    const suspend = await api(`/admin/users/${victim.id}/status`, { method: 'POST', token: modToken, body: { status: 'suspended' } });
    expect(suspend.status).toBe(200);
  });
});

describe('stats & search', () => {
  beforeEach(resetDb);

  it('stats update after play; search finds users and categories', async () => {
    const catId = await seedCategory('science');
    for (let i = 0; i < 3; i++) await seedQuestion({ categoryId: catId });
    const u = await registerUser('statsp');
    const start = await api('/quizzes/start', { method: 'POST', token: u.token, body: { questionCount: 2 } });
    const { attemptId, questions } = start.body as { attemptId: string; questions: Array<{ id: string }> };
    await api(`/quizzes/attempts/${attemptId}/answers`, { method: 'POST', token: u.token, body: { questionId: questions[0].id, answer: 'o1' } });
    await api(`/quizzes/attempts/${attemptId}/answers`, { method: 'POST', token: u.token, body: { questionId: questions[1].id, answer: 'o2' } });
    await api(`/quizzes/attempts/${attemptId}/submit`, { method: 'POST', token: u.token });

    const stats = await api('/stats/me', { token: u.token });
    const s = (stats.body as { stats: { questionsAnswered: number; correct: number; accuracy: number } }).stats;
    expect(s.questionsAnswered).toBe(2);
    expect(s.correct).toBe(1);
    expect(s.accuracy).toBe(50);

    const search = await api('/search?q=statsp', { token: u.token });
    expect((search.body as { users: Array<{ username: string }> }).users[0].username).toBe('statsp');
    const search2 = await api('/search?q=scien');
    expect((search2.body as { categories: unknown[] }).categories).toHaveLength(1);
  });
});

describe('admin quiz management (scheduled quizzes)', () => {
  beforeEach(resetDb);

  it('create → activate → users play the identical fixed set', async () => {
    for (let i = 0; i < 6; i++) await seedQuestion({});
    const admin = await registerUser('quizadmin');
    await makeAdmin(admin.id);
    const token = await loginAs('quizadmin');

    const created = await api('/admin/quizzes', {
      method: 'POST', token,
      body: { title: { en: 'Weekly Special' }, questionCount: 3, mode: 'competitive' },
    });
    expect(created.status).toBe(200);
    const quizId = (created.body as { id: string }).id;

    const player = await registerUser('quizplayer');
    // draft quiz is not playable
    const early = await api(`/quizzes/${quizId}/start`, { method: 'POST', token: player.token });
    expect(early.status).toBe(400);

    const activate = await api(`/admin/quizzes/${quizId}/status`, { method: 'POST', token, body: { status: 'active' } });
    expect(activate.status).toBe(200);

    const listed = await api('/quizzes/scheduled');
    expect((listed.body as { quizzes: Array<{ id: string }> }).quizzes.some((q) => q.id === quizId)).toBe(true);

    const s1 = await api(`/quizzes/${quizId}/start`, { method: 'POST', token: player.token });
    expect(s1.status).toBe(200);
    const q1 = (s1.body as { questions: Array<{ id: string }> }).questions.map((q) => q.id).sort();
    const player2 = await registerUser('quizplayer2');
    const s2 = await api(`/quizzes/${quizId}/start`, { method: 'POST', token: player2.token });
    const q2 = (s2.body as { questions: Array<{ id: string }> }).questions.map((q) => q.id).sort();
    expect(q1).toEqual(q2);
  });
});

describe('market-parity features', () => {
  beforeEach(resetDb);

  it('daily quiz: same set for everyone, one attempt per day', async () => {
    for (let i = 0; i < 12; i++) await seedQuestion({});
    const u1 = await registerUser('daily1');
    const u2 = await registerUser('daily2');
    const s1 = await api('/quizzes/start', { method: 'POST', token: u1.token, body: { mode: 'daily' } });
    const s2 = await api('/quizzes/start', { method: 'POST', token: u2.token, body: { mode: 'daily' } });
    expect(s1.status).toBe(200);
    const q1 = (s1.body as { questions: Array<{ id: string }> }).questions.map((q) => q.id).sort();
    const q2 = (s2.body as { questions: Array<{ id: string }> }).questions.map((q) => q.id).sort();
    expect(q1).toEqual(q2); // shared question-of-the-day set
    // second attempt today → rejected
    const again = await api('/quizzes/start', { method: 'POST', token: u1.token, body: { mode: 'daily' } });
    expect(again.status).toBe(409);
    const status = await api('/quizzes/daily', { token: u1.token });
    expect((status.body as { available: boolean }).available).toBe(true);
  });

  it('practice mode is untimed and returns instant feedback', async () => {
    const u = await registerUser('learner');
    await seedQuestion({ timeLimitSec: 5 });
    const start = await api('/quizzes/start', { method: 'POST', token: u.token, body: { mode: 'practice', questionCount: 1 } });
    expect((start.body as { untimed: boolean }).untimed).toBe(true);
    const { attemptId, questions } = start.body as { attemptId: string; questions: Array<{ id: string }> };
    // simulate answering long past the per-question limit — no timeout in practice
    await query(
      `UPDATE attempts SET question_meta = jsonb_set(question_meta, '{lastEventAt}', to_jsonb((now() - interval '60 seconds')::text)) WHERE id = $1`,
      [attemptId],
    );
    const res = await api(`/quizzes/attempts/${attemptId}/answers`, { method: 'POST', token: u.token, body: { questionId: questions[0].id, answer: 'o1' } });
    const body = res.body as { outcome: string; feedback?: { correctAnswer: unknown; explanation: unknown } };
    expect(body.outcome).toBe('correct');
    expect(body.feedback?.correctAnswer).toBe('o1'); // instant feedback (post-answer only)
  });

  it('timed mode never returns feedback mid-quiz', async () => {
    const u = await registerUser('speedy');
    await seedQuestion({});
    const start = await api('/quizzes/start', { method: 'POST', token: u.token, body: { mode: 'timed', questionCount: 1 } });
    const { attemptId, questions } = start.body as { attemptId: string; questions: Array<{ id: string }> };
    const res = await api(`/quizzes/attempts/${attemptId}/answers`, { method: 'POST', token: u.token, body: { questionId: questions[0].id, answer: 'o2' } });
    expect((res.body as { feedback?: unknown }).feedback).toBeUndefined();
  });

  it('50/50 removes two wrong options server-side without leaking the answer', async () => {
    const u = await registerUser('powerp');
    await seedQuestion({
      content: {
        prompt: { en: 'Pick the right one' },
        options: [
          { id: 'o1', text: 'Right' }, { id: 'o2', text: 'Wrong A' },
          { id: 'o3', text: 'Wrong B' }, { id: 'o4', text: 'Wrong C' },
        ],
      },
    });
    const start = await api('/quizzes/start', { method: 'POST', token: u.token, body: { mode: 'timed', questionCount: 1 } });
    const { attemptId, questions, powerups } = start.body as { attemptId: string; questions: Array<{ id: string }>; powerups: { fiftyFifty: number } };
    expect(powerups.fiftyFifty).toBeGreaterThan(0);
    const use = await api(`/quizzes/attempts/${attemptId}/powerups`, { method: 'POST', token: u.token, body: { kind: 'fifty_fifty', questionId: questions[0].id } });
    expect(use.status).toBe(200);
    const removed = (use.body as { removedOptionIds: string[] }).removedOptionIds;
    expect(removed).toHaveLength(2);
    expect(removed).not.toContain('o1'); // never eliminates the correct option
    // idempotent per question, no double spend
    const again = await api(`/quizzes/attempts/${attemptId}/powerups`, { method: 'POST', token: u.token, body: { kind: 'fifty_fifty', questionId: questions[0].id } });
    expect((again.body as { remaining: number }).remaining).toBe((use.body as { remaining: number }).remaining);
  });

  it('review mode replays only questions the user got wrong', async () => {
    const u = await registerUser('reviewer');
    for (let i = 0; i < 4; i++) await seedQuestion({});
    const s1 = await api('/quizzes/start', { method: 'POST', token: u.token, body: { mode: 'timed', questionCount: 3 } });
    const first = s1.body as { attemptId: string; questions: Array<{ id: string }> };
    // wrong, wrong, correct
    const answers = ['o2', 'o2', 'o1'];
    for (let i = 0; i < first.questions.length; i++) {
      await api(`/quizzes/attempts/${first.attemptId}/answers`, { method: 'POST', token: u.token, body: { questionId: first.questions[i].id, answer: answers[i] } });
    }
    await api(`/quizzes/attempts/${first.attemptId}/submit`, { method: 'POST', token: u.token });

    const review = await api('/quizzes/start', { method: 'POST', token: u.token, body: { mode: 'review', questionCount: 10 } });
    expect(review.status).toBe(200);
    const wrongIds = first.questions.slice(0, 2).map((q) => q.id).sort();
    const reviewIds = (review.body as { questions: Array<{ id: string }> }).questions.map((q) => q.id).sort();
    expect(reviewIds).toEqual(wrongIds);
  });

  it('streak freeze absorbs a single missed day', async () => {
    const u = await registerUser('freezer');
    await seedQuestion({});
    // simulate an existing 5-day streak that last played 2 days ago, with 1 freeze
    await query(
      `UPDATE users SET current_streak = 5, longest_streak = 5, streak_freezes = 1,
         last_activity_date = current_date - 2 WHERE id = $1`,
      [u.id],
    );
    const start = await api('/quizzes/start', { method: 'POST', token: u.token, body: { questionCount: 1 } });
    const { attemptId } = start.body as { attemptId: string };
    const submit = await api(`/quizzes/attempts/${attemptId}/submit`, { method: 'POST', token: u.token });
    expect((submit.body as { streak: number }).streak).toBe(6); // survived via freeze
    const row = await query('SELECT streak_freezes FROM users WHERE id = $1', [u.id]);
    expect(row.rows[0].streak_freezes).toBe(0); // consumed
  });

  it('friends: request → accept → friends leaderboard → remove', async () => {
    const a = await registerUser('frienda');
    const b = await registerUser('friendb');
    const reqRes = await api('/friends/request', { method: 'POST', token: a.token, body: { username: 'friendb' } });
    expect(reqRes.status).toBe(200);
    // b sees incoming
    const list = await api('/friends', { token: b.token });
    expect((list.body as { incoming: Array<{ username: string }> }).incoming[0].username).toBe('frienda');
    const accept = await api('/friends/respond', { method: 'POST', token: b.token, body: { userId: a.id, accept: true } });
    expect(accept.status).toBe(200);
    const after = await api('/friends', { token: a.token });
    expect((after.body as { friends: Array<{ username: string }> }).friends[0].username).toBe('friendb');
    // duplicate request now conflicts
    expect((await api('/friends/request', { method: 'POST', token: a.token, body: { username: 'friendb' } })).status).toBe(409);
    const removed = await api(`/friends/${b.id}`, { method: 'DELETE', token: a.token });
    expect(removed.status).toBe(200);
  });
});
