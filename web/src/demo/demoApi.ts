/**
 * DEMO MODE — an in-browser backend for the GitHub Pages build.
 * Runs the REAL Universal Question Engine (same TypeScript families/registry
 * as the server) against the bundled question bank; progress lives in
 * localStorage. Social/competitive features need the real server and are
 * hidden in this build.
 */
import data from './data.json';
import { registry } from './engine/registry';

interface DemoQuestion {
  id: string;
  type: string;
  categoryId: string | null;
  difficulty: string;
  language: string;
  content: Record<string, unknown>;
  correctAnswer: unknown;
  configuration: Record<string, unknown>;
  points: number;
  timeLimitSec: number | null;
  explanation: Record<string, string>;
  tags: string[];
}
const QUESTIONS = data.questions as unknown as DemoQuestion[];
const CATEGORIES = data.categories as Array<{ id: string; slug: string; name: unknown; icon: string; sortOrder: number }>;
const QBY = new Map(QUESTIONS.map((q) => [q.id, q]));

const DEFAULT_TIME = 30;
const POINTS: Record<string, number> = { easy: 10, medium: 15, hard: 20, expert: 30 };
const XP_PER_LEVEL = 250;

// ---------------- persistent state ----------------
interface DemoUser {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
  language: string;
  xp: number;
  level: number;
  totalPoints: number;
  currentStreak: number;
  longestStreak: number;
  streakFreezes: number;
  lastActivityDate: string | null;
}
interface AnswerRec {
  questionId: string;
  answer: unknown;
  outcome: string;
  score: number;
  maxScore: number;
  timeTakenMs: number;
}
interface Attempt {
  id: string;
  mode: string;
  status: 'in_progress' | 'submitted';
  questionIds: string[];
  answers: AnswerRec[];
  startedAt: number;
  lastEventAt: number;
  untimed: boolean;
  powerups: { fiftyFifty: number; timeExtend: number; audience?: number; used: Record<string, string[]> };
  perQuestion: Record<string, number>;
  score: number;
  maxScore: number;
  submittedAt?: number;
  roundStreak?: number;
  speedBonus?: number; // multiplier: 0 (knowledge) · 1 · 2 (speed)
}
interface DemoState {
  bookmarks?: string[];
  user: DemoUser;
  attempts: Attempt[];
  wrongPool: string[]; // question ids missed and not yet redeemed
  earned: string[]; // achievement slugs
  stats: { quizzes: number; answered: number; correct: number; incorrect: number; timeouts: number; skipped: number; timeMs: number; best: number; perfect: number };
  dailyDone: string | null; // date of last daily play
}

function load(): DemoState {
  try {
    const raw = localStorage.getItem('demoState');
    if (raw) return JSON.parse(raw);
  } catch { /* fresh */ }
  return {
    user: {
      id: 'demo-user',
      username: 'guest',
      displayName: 'Guest',
      avatar: '🦊',
      language: 'en',
      xp: 0, level: 1, totalPoints: 0,
      currentStreak: 0, longestStreak: 0, streakFreezes: 1, lastActivityDate: null,
    },
    attempts: [],
    wrongPool: [],
    earned: [],
    stats: { quizzes: 0, answered: 0, correct: 0, incorrect: 0, timeouts: 0, skipped: 0, timeMs: 0, best: 0, perfect: 0 },
    dailyDone: null,
  };
}
let state = load();
function save(): void {
  try {
    state.attempts = state.attempts.slice(-20);
    localStorage.setItem('demoState', JSON.stringify(state));
  } catch { /* storage full/unavailable */ }
}

const uid = () => `d${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const today = () => new Date().toISOString().slice(0, 10);

function publicUser() {
  const u = state.user;
  return {
    id: u.id, email: null, username: u.username, displayName: u.displayName, role: 'user',
    isGuest: true, avatar: u.avatar, language: u.language, country: '', xp: u.xp, level: u.level,
    totalPoints: u.totalPoints, currentStreak: u.currentStreak, longestStreak: u.longestStreak,
    streakFreezes: u.streakFreezes, plan: 'free', emailVerified: false, createdAt: new Date().toISOString(),
  };
}

class DemoError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

function levelFromXp(xp: number): number {
  let level = 1;
  while (xp >= XP_PER_LEVEL * ((level * (level + 1)) / 2)) level++;
  return level;
}

function present(q: DemoQuestion, timeLimitSec: number) {
  const p = registry.present(q.type, {
    type: q.type, content: q.content, correctAnswer: q.correctAnswer, configuration: q.configuration,
  });
  const spec = registry.getSpec(q.type);
  return {
    id: q.id, type: q.type, difficulty: q.difficulty, points: q.points, timeLimitSec,
    content: p.content, configuration: { media: spec.media, scored: spec.scored },
  };
}

function pickPool(opts: { categoryId?: string; difficulty?: string; difficulties?: string[]; language?: string; count: number; ids?: string[] }): DemoQuestion[] {
  if (opts.ids) return opts.ids.map((id) => QBY.get(id)!).filter(Boolean);
  let pool = QUESTIONS;
  if (opts.categoryId) pool = pool.filter((q) => q.categoryId === opts.categoryId);
  if (opts.difficulty) pool = pool.filter((q) => q.difficulty === opts.difficulty);
  if (opts.difficulties) pool = pool.filter((q) => opts.difficulties!.includes(q.difficulty));
  // prefer the player's UI language; fall back to the mixed bank when thin
  if (opts.language) {
    const same = pool.filter((q) => q.language === opts.language);
    if (same.length >= opts.count) pool = same;
  }
  return [...pool].sort(() => Math.random() - 0.5).slice(0, opts.count);
}

/** deterministic per-date selection for the shared daily quiz */
function dailyIds(): string[] {
  const seedStr = today();
  let seed = 0;
  for (const ch of seedStr) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const rng = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const idx = QUESTIONS.map((_, i) => i).sort(() => rng() - 0.5).slice(0, 10);
  return idx.map((i) => QUESTIONS[i].id);
}

function startAttempt(opts: { mode: string; categoryId?: string; difficulty?: string; language?: string; count: number; ids?: string[] }) {
  const untimed = opts.mode === 'practice' || opts.mode === 'review';
  const knowledge = opts.mode === 'knowledge';
  const picked = pickPool({
    categoryId: opts.categoryId,
    difficulty: opts.difficulty,
    difficulties: knowledge && !opts.difficulty ? ['hard', 'expert', 'medium'] : undefined,
    language: opts.language,
    count: opts.count,
    ids: opts.ids,
  });
  if (picked.length === 0) throw new DemoError(400, 'bad_request', 'No questions available for the selected filters');
  const perQuestion: Record<string, number> = {};
  // mode presets: speed = 10s, knowledge = 60s, otherwise the question's own limit
  for (const q of picked) perQuestion[q.id] = opts.mode === 'speed' ? 10 : knowledge ? 60 : q.timeLimitSec ?? DEFAULT_TIME;
  const attempt: Attempt = {
    id: uid(), mode: opts.mode, status: 'in_progress',
    questionIds: picked.map((q) => q.id), answers: [],
    startedAt: Date.now(), lastEventAt: Date.now(), untimed,
    powerups: { fiftyFifty: 2, timeExtend: untimed ? 0 : 1, audience: 1, used: {} },
    perQuestion,
    speedBonus: opts.mode === 'speed' ? 2 : knowledge ? 0 : 1,
    score: 0,
    maxScore: picked.reduce((s, q) => (registry.isScored(q.type) ? s + (q.points > 0 ? q.points : POINTS[q.difficulty] ?? 10) : s), 0),
  };
  state.attempts.push(attempt);
  save();
  return {
    attemptId: attempt.id,
    startedAt: new Date(attempt.startedAt).toISOString(),
    deadlineAt: null,
    mode: opts.mode,
    untimed,
    powerups: { fiftyFifty: attempt.powerups.fiftyFifty, timeExtend: attempt.powerups.timeExtend, audience: attempt.powerups.audience ?? 1 },
    questions: picked.map((q) => present(q, perQuestion[q.id])),
  };
}

function getAttempt(id: string): Attempt {
  const a = state.attempts.find((x) => x.id === id);
  if (!a) throw new DemoError(404, 'not_found', 'Attempt not found');
  return a;
}

function answerQuestion(attemptId: string, questionId: string, answer: unknown) {
  const a = getAttempt(attemptId);
  if (a.status !== 'in_progress') throw new DemoError(409, 'conflict', 'Attempt is no longer in progress');
  if (!a.questionIds.includes(questionId)) throw new DemoError(400, 'bad_request', 'Question is not part of this attempt');
  if (a.answers.some((x) => x.questionId === questionId)) throw new DemoError(409, 'conflict', 'Answer already submitted');
  const q = QBY.get(questionId)!;
  const now = Date.now();
  const elapsed = Math.max(0, now - a.lastEventAt);
  const limitMs = a.perQuestion[questionId] * 1000;
  const timedOut = !a.untimed && elapsed > limitMs + 3000;

  let outcome: string; let ratio = 0;
  if (timedOut) outcome = 'timeout';
  else {
    const r = registry.score(q.type, { type: q.type, content: q.content, correctAnswer: q.correctAnswer, configuration: q.configuration }, answer);
    outcome = r.outcome; ratio = r.ratio;
  }
  const scored = registry.isScored(q.type);
  const base = scored ? (q.points > 0 ? q.points : POINTS[q.difficulty] ?? 10) : 0;
  let points = 0;
  if (scored && (outcome === 'correct' || outcome === 'partial')) {
    points = base * ratio;
    if (!a.untimed && outcome === 'correct' && limitMs > 0) {
      points += (a.speedBonus ?? 1) * base * 0.5 * Math.max(0, 1 - Math.min(elapsed, limitMs) / limitMs);
    }
    // in-round streak bonus, same rule as the server: min(streak, 5) × 2
    if (outcome === 'correct') points += Math.min((a.roundStreak ?? 0) + 1, 5) * 2;
    points = Math.round(points);
  }
  a.roundStreak = outcome === 'correct' ? (a.roundStreak ?? 0) + 1 : 0;
  a.answers.push({ questionId, answer, outcome, score: points, maxScore: base, timeTakenMs: Math.min(elapsed, limitMs) });
  a.lastEventAt = now;
  a.score += points;
  if (outcome === 'incorrect' || outcome === 'timeout') {
    if (!state.wrongPool.includes(questionId)) state.wrongPool.push(questionId);
  } else if (outcome === 'correct') {
    state.wrongPool = state.wrongPool.filter((x) => x !== questionId);
  }
  save();
  const feedback = a.untimed ? { correctAnswer: q.correctAnswer, explanation: q.explanation } : undefined;
  return { questionId, outcome, points, maxPoints: base, answered: true, feedback };
}

const ACHIEVEMENTS = [
  { slug: 'first-quiz', name: { en: 'First Quiz', ar: 'أول اختبار' }, icon: '🎉', metric: 'quizzes', gte: 1, xp: 25 },
  { slug: 'ten-quizzes', name: { en: '10 Quizzes', ar: '10 اختبارات' }, icon: '🔟', metric: 'quizzes', gte: 10, xp: 50 },
  { slug: 'hundred-correct', name: { en: '100 Correct', ar: '100 إجابة صحيحة' }, icon: '💯', metric: 'correct', gte: 100, xp: 100 },
  { slug: 'perfect-quiz', name: { en: 'Perfect Quiz', ar: 'اختبار مثالي' }, icon: '🏆', metric: 'perfect', gte: 1, xp: 75 },
  { slug: 'week-streak', name: { en: '7-Day Streak', ar: 'سلسلة 7 أيام' }, icon: '🔥', metric: 'streak', gte: 7, xp: 100 },
];

function submitAttempt(attemptId: string) {
  const a = getAttempt(attemptId);
  if (a.status === 'submitted') throw new DemoError(409, 'conflict', 'Attempt already submitted');
  for (const qid of a.questionIds) {
    if (!a.answers.some((x) => x.questionId === qid)) {
      const q = QBY.get(qid)!;
      const base = registry.isScored(q.type) ? (q.points > 0 ? q.points : POINTS[q.difficulty] ?? 10) : 0;
      a.answers.push({ questionId: qid, answer: null, outcome: 'skipped', score: 0, maxScore: base, timeTakenMs: 0 });
    }
  }
  a.status = 'submitted';
  a.submittedAt = Date.now();
  const c = (o: string) => a.answers.filter((x) => x.outcome === o).length;
  const correct = c('correct'); const incorrect = c('incorrect'); const partial = c('partial');
  const timeout = c('timeout'); const skipped = c('skipped');
  const timeMs = a.answers.reduce((s, x) => s + x.timeTakenMs, 0);
  const isPerfect = correct > 0 && incorrect + partial + timeout + skipped === 0;

  const u = state.user;
  const xp = correct * 5 + 20;
  u.xp += xp;
  const newLevel = levelFromXp(u.xp);
  const leveledUp = newLevel > u.level;
  u.level = newLevel;
  u.totalPoints += a.score;

  // streak (freeze absorbs one missed day)
  const t = today();
  if (u.lastActivityDate !== t) {
    const d1 = new Date(); d1.setDate(d1.getDate() - 1);
    const d2 = new Date(); d2.setDate(d2.getDate() - 2);
    const y1 = d1.toISOString().slice(0, 10); const y2 = d2.toISOString().slice(0, 10);
    if (u.lastActivityDate === y1) u.currentStreak += 1;
    else if (u.lastActivityDate === y2 && u.streakFreezes > 0) { u.streakFreezes -= 1; u.currentStreak += 1; }
    else u.currentStreak = 1;
    u.longestStreak = Math.max(u.longestStreak, u.currentStreak);
    u.lastActivityDate = t;
  }
  if (a.mode === 'daily') state.dailyDone = t;

  const s = state.stats;
  s.quizzes += 1; s.answered += a.questionIds.length; s.correct += correct; s.incorrect += incorrect;
  s.timeouts += timeout; s.skipped += skipped; s.timeMs += timeMs;
  s.best = Math.max(s.best, a.score); if (isPerfect) s.perfect += 1;

  const metrics: Record<string, number> = { quizzes: s.quizzes, correct: s.correct, perfect: s.perfect, streak: u.currentStreak };
  const newly = ACHIEVEMENTS.filter((ach) => !state.earned.includes(ach.slug) && metrics[ach.metric] >= ach.gte);
  for (const ach of newly) { state.earned.push(ach.slug); u.xp += ach.xp; }
  u.level = levelFromXp(u.xp);
  save();

  return {
    attemptId, score: a.score, maxScore: a.maxScore, correct, incorrect, partial, timeout, skipped,
    accuracy: a.questionIds.length ? Math.round((correct / a.questionIds.length) * 1000) / 10 : 0,
    totalTimeMs: timeMs, durationMs: a.submittedAt - a.startedAt, xpAwarded: xp,
    level: u.level, leveledUp, streak: u.currentStreak,
    achievements: newly.map((x) => ({ slug: x.slug, name: x.name })),
    isPerfect, contextType: 'solo', contextId: null,
  };
}

const BOTS = [
  { userId: 'bot1', username: 'salem_ace', displayName: 'Salem', avatar: '🦉', level: 4, points: 1420, correct: 96, totalTimeMs: 812000 },
  { userId: 'bot2', username: 'reem_star', displayName: 'Reem', avatar: '🌟', level: 3, points: 1210, correct: 84, totalTimeMs: 793000 },
  { userId: 'bot3', username: 'yousef_k', displayName: 'Yousef', avatar: '🚀', level: 3, points: 990, correct: 71, totalTimeMs: 901000 },
  { userId: 'bot4', username: 'maha_quiz', displayName: 'Maha', avatar: '🦋', level: 2, points: 640, correct: 45, totalTimeMs: 512000 },
];

// ---------------- router ----------------
export async function demoApi(path: string, opts: { method?: string; body?: unknown } = {}): Promise<unknown> {
  const method = opts.method ?? 'GET';
  const body = (opts.body ?? {}) as Record<string, unknown>;
  const [route, queryStr] = path.split('?');
  const qs = new URLSearchParams(queryStr ?? '');
  await new Promise((r) => setTimeout(r, 60)); // tiny latency for realistic UX

  // auth — everything maps onto the local guest profile
  if (route.startsWith('/auth/')) {
    if (route === '/auth/logout') return { ok: true };
    if (method === 'POST') {
      if (typeof body.username === 'string' && body.username) {
        state.user.username = body.username;
        state.user.displayName = (body.displayName as string) || body.username;
        save();
      }
      return { user: publicUser(), accessToken: 'demo-token', refreshToken: 'demo-refresh' };
    }
  }
  if (route === '/users/me' && method === 'GET') return { user: publicUser() };
  if (route === '/users/me' && method === 'PATCH') {
    if (typeof body.displayName === 'string') state.user.displayName = body.displayName;
    if (typeof body.avatar === 'string') state.user.avatar = body.avatar;
    if (typeof body.language === 'string') state.user.language = body.language;
    save();
    return { user: publicUser() };
  }

  if (route === '/categories') {
    return {
      categories: CATEGORIES.map((cat) => {
        const qsIn = QUESTIONS.filter((q) => q.categoryId === cat.id);
        const by: Record<string, number> = {};
        for (const q of qsIn) by[q.difficulty] = (by[q.difficulty] ?? 0) + 1;
        return { ...cat, description: {}, parentId: null, color: '', questionCount: qsIn.length, byDifficulty: by };
      }),
    };
  }

  if (route === '/quizzes/question-types') {
    return { types: registry.listTypes().map((t) => ({ id: t.id, family: t.family, scored: t.scored, manualReview: t.manualReview, media: t.media })) };
  }
  if (route === '/quizzes/daily' && method === 'GET') {
    return { available: true, day: today(), questionCount: 10, myAttempt: state.dailyDone === today() ? { status: 'submitted', score: 0 } : null };
  }
  if (route === '/quizzes/start' && method === 'POST' && body.mode === 'bookmarks') {
    const ids = state.bookmarks ?? [];
    if (ids.length === 0) throw new DemoError(400, 'bad_request', 'No bookmarked questions yet');
    return startAttempt({ mode: 'practice', count: ids.length, ids });
  }
  if (route === '/quizzes/start' && method === 'POST') {
    const mode = (body.mode as string) ?? 'practice';
    if (mode === 'daily') {
      if (state.dailyDone === today()) throw new DemoError(409, 'conflict', 'You already played today');
      return startAttempt({ mode: 'daily', count: 10, ids: dailyIds() });
    }
    if (mode === 'review') {
      if (state.wrongPool.length === 0) throw new DemoError(400, 'bad_request', 'No mistakes to review — well done!');
      const ids = [...state.wrongPool].sort(() => Math.random() - 0.5).slice(0, (body.questionCount as number) ?? 10);
      return startAttempt({ mode, count: ids.length, ids });
    }
    return startAttempt({
      mode,
      categoryId: body.categoryId as string | undefined,
      difficulty: body.difficulty as string | undefined,
      language: (body.language as string | undefined) ?? state.user.language,
      count: (body.questionCount as number) ?? 10,
    });
  }

  const answerMatch = route.match(/^\/quizzes\/attempts\/([^/]+)\/answers$/);
  if (answerMatch && method === 'POST') return answerQuestion(answerMatch[1], body.questionId as string, body.answer);

  // bookmarks (Quizlet-style save-to-study), persisted with the rest of the demo state
  if (route === '/quizzes/bookmarks' && method === 'GET') {
    const ids = state.bookmarks ?? [];
    return { bookmarks: ids.map((id) => QBY.get(id)).filter(Boolean).map((q) => ({ id: q!.id, type: q!.type, difficulty: q!.difficulty, prompt: q!.content.prompt })) };
  }
  const bmMatch = route.match(/^\/quizzes\/bookmarks\/([^/]+)$/);
  if (bmMatch && (method === 'POST' || method === 'DELETE')) {
    const id = bmMatch[1];
    const set = new Set(state.bookmarks ?? []);
    if (method === 'POST') set.add(id); else set.delete(id);
    state.bookmarks = [...set];
    save();
    return { ok: true, bookmarked: method === 'POST' };
  }

  const powerupMatch = route.match(/^\/quizzes\/attempts\/([^/]+)\/powerups$/);
  if (powerupMatch && method === 'POST') {
    const a = getAttempt(powerupMatch[1]);
    const qid = body.questionId as string;
    const q = QBY.get(qid);
    if (!q) throw new DemoError(404, 'not_found', 'Question not found');
    if (body.kind === 'audience') {
      if ((a.powerups.audience ?? 1) <= 0) throw new DemoError(409, 'conflict', 'No audience power-ups left');
      const options = Array.isArray(q.content.options) ? (q.content.options as Array<{ id: string }>) : [];
      if (options.length < 2) throw new DemoError(400, 'bad_request', 'Audience is not available for this question');
      const correct = typeof q.correctAnswer === 'string' ? q.correctAnswer : '';
      // simulated crowd: correct-leaning with noise (no other players in the demo)
      const raw = options.map((o) => (o.id === correct ? 45 + Math.random() * 30 : 5 + Math.random() * 25));
      const sum = raw.reduce((x, y) => x + y, 0);
      a.powerups.audience = (a.powerups.audience ?? 1) - 1;
      save();
      return { kind: 'audience', distribution: options.map((o, i) => ({ optionId: o.id, percent: Math.round((raw[i] / sum) * 100) })), sample: 0, remaining: a.powerups.audience };
    }
    if (body.kind === 'fifty_fifty') {
      if (a.powerups.used[qid]) return { kind: 'fifty_fifty', removedOptionIds: a.powerups.used[qid], remaining: a.powerups.fiftyFifty };
      if (a.powerups.fiftyFifty <= 0) throw new DemoError(409, 'conflict', 'No 50/50 power-ups left');
      const options = Array.isArray(q.content.options) ? (q.content.options as Array<{ id: string }>) : [];
      const correct = typeof q.correctAnswer === 'string' ? q.correctAnswer : '';
      const wrong = options.map((o) => o.id).filter((id) => id !== correct);
      if (options.length < 3 || !correct) throw new DemoError(400, 'bad_request', '50/50 is not available for this question');
      const removed = wrong.sort(() => Math.random() - 0.5).slice(0, Math.min(2, wrong.length - 1));
      a.powerups.fiftyFifty -= 1;
      a.powerups.used[qid] = removed;
      save();
      return { kind: 'fifty_fifty', removedOptionIds: removed, remaining: a.powerups.fiftyFifty };
    }
    if (a.powerups.timeExtend <= 0) throw new DemoError(409, 'conflict', 'No time extensions left');
    a.powerups.timeExtend -= 1;
    a.perQuestion[qid] += 20;
    save();
    return { kind: 'time_extend', addedSec: 20, remaining: a.powerups.timeExtend };
  }

  const submitMatch = route.match(/^\/quizzes\/attempts\/([^/]+)\/submit$/);
  if (submitMatch && method === 'POST') return submitAttempt(submitMatch[1]);

  const reviewMatch = route.match(/^\/quizzes\/attempts\/([^/]+)\/review$/);
  if (reviewMatch) {
    const a = getAttempt(reviewMatch[1]);
    if (a.status === 'in_progress') throw new DemoError(403, 'forbidden', 'Submit the attempt before reviewing');
    return {
      attempt: {
        id: a.id, mode: a.mode, status: a.status, score: a.score, maxScore: a.maxScore,
        correct: a.answers.filter((x) => x.outcome === 'correct').length,
        startedAt: new Date(a.startedAt).toISOString(), submittedAt: new Date(a.submittedAt!).toISOString(),
        durationMs: (a.submittedAt ?? a.startedAt) - a.startedAt,
      },
      items: a.questionIds.map((qid) => {
        const q = QBY.get(qid)!;
        const ans = a.answers.find((x) => x.questionId === qid)!;
        return {
          questionId: qid, type: q.type, difficulty: q.difficulty, content: q.content,
          yourAnswer: ans.answer, correctAnswer: q.correctAnswer, explanation: q.explanation,
          outcome: ans.outcome, score: ans.score, maxScore: ans.maxScore, timeTakenMs: ans.timeTakenMs,
        };
      }),
    };
  }

  if (route === '/quizzes/attempts') {
    const done = state.attempts.filter((a) => a.status === 'submitted').reverse();
    return {
      attempts: done.slice(0, Number(qs.get('limit') ?? 20)).map((a) => ({
        id: a.id, mode: a.mode, context_type: 'solo', status: a.status, score: a.score, max_score: a.maxScore,
        correct_count: a.answers.filter((x) => x.outcome === 'correct').length,
        incorrect_count: a.answers.filter((x) => x.outcome === 'incorrect').length,
        timeout_count: a.answers.filter((x) => x.outcome === 'timeout').length,
        skipped_count: a.answers.filter((x) => x.outcome === 'skipped').length,
        started_at: new Date(a.startedAt).toISOString(), submitted_at: new Date(a.submittedAt!).toISOString(),
        server_duration_ms: (a.submittedAt ?? a.startedAt) - a.startedAt,
      })),
    };
  }

  if (route === '/leaderboards') {
    const me = {
      userId: state.user.id, username: state.user.username, displayName: state.user.displayName,
      avatar: state.user.avatar, level: state.user.level, points: state.user.totalPoints,
      correct: state.stats.correct, totalTimeMs: state.stats.timeMs,
    };
    const entries = [...BOTS, me]
      .sort((a, b) => b.points - a.points || a.totalTimeMs - b.totalTimeMs)
      .map((e, i) => ({ rank: i + 1, ...e }));
    return { scope: qs.get('scope') ?? 'global', key: '', entries, me: entries.find((e) => e.userId === me.userId) ?? null };
  }

  if (route === '/achievements/progress') {
    const u = state.user;
    const floor = u.level > 1 ? XP_PER_LEVEL * (((u.level - 1) * u.level) / 2) : 0;
    const next = XP_PER_LEVEL * ((u.level * (u.level + 1)) / 2);
    return { xp: u.xp, level: u.level, nextLevelAt: next, progress: next > floor ? Math.round(((u.xp - floor) / (next - floor)) * 100) : 0 };
  }
  if (route === '/achievements') {
    return {
      achievements: ACHIEVEMENTS.map((a) => ({
        id: a.slug, slug: a.slug, name: a.name, description: a.name, icon: a.icon,
        xpReward: a.xp, earned: state.earned.includes(a.slug),
      })),
    };
  }

  if (route === '/stats/me') {
    const s = state.stats;
    const perCat = CATEGORIES.map((cat) => {
      const answered = state.attempts.flatMap((a) => a.answers).filter((x) => QBY.get(x.questionId)?.categoryId === cat.id);
      const cor = answered.filter((x) => x.outcome === 'correct').length;
      return { id: cat.id, name: cat.name, answered: answered.length, correct: cor, accuracy: answered.length ? Math.round((cor / answered.length) * 1000) / 10 : 0 };
    }).filter((c) => c.answered > 0).sort((a, b) => b.accuracy - a.accuracy);
    return {
      stats: {
        quizzesCompleted: s.quizzes, questionsAnswered: s.answered, correct: s.correct, incorrect: s.incorrect,
        timeouts: s.timeouts, skipped: s.skipped,
        accuracy: s.answered ? Math.round((s.correct / s.answered) * 1000) / 10 : 0,
        averageTimeMs: s.answered ? Math.round(s.timeMs / s.answered) : 0,
        bestScore: s.best, perfectQuizzes: s.perfect, xp: state.user.xp, level: state.user.level,
        totalPoints: state.user.totalPoints, currentStreak: state.user.currentStreak, longestStreak: state.user.longestStreak,
        bestCategory: perCat[0] ?? null, weakestCategory: perCat.length > 1 ? perCat[perCat.length - 1] : null,
        categories: perCat,
      },
      activity: [],
    };
  }

  if (route === '/notifications' && method === 'GET') return { notifications: [], unreadCount: 0 };
  if (route === '/notifications/read') return { ok: true };
  if (route === '/monthly-challenges/current') throw new DemoError(404, 'not_found', 'Not available in the demo');

  // anything else (challenges/tournaments/groups/friends/admin/search) needs the real server
  throw new DemoError(501, 'demo_unavailable', 'This feature needs the full server — see the repository README');
}

export { DemoError };
