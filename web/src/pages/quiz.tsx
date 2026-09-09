import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ApiError, del, get, post } from '../api';
import { ErrorBoundary, ErrorState, Spinner, StatBox, fmtMs, useAction, useOnline, usePageMeta, useToast, useTypeSpecs } from '../components';
import { useAuth } from '../ctx';
import { useI18n, type TKey } from '../i18n';
import { useTx } from '../i18n';
import { nativeShareBlob, nativeShareText } from '../native';
import { QuestionRenderer, type PlayableQuestion } from '../QuestionRenderer';
import { autoAdvanceEnabled, haptic, sfx } from '../sounds';

interface StartResponse {
  attemptId: string;
  deadlineAt: string;
  mode?: string;
  untimed?: boolean;
  powerups?: { fiftyFifty: number; timeExtend: number; audience?: number };
  questions: PlayableQuestion[];
}
interface Feedback {
  correctAnswer: unknown;
  explanation: Record<string, string>;
}
export interface Summary {
  attemptId: string;
  score: number;
  maxScore: number;
  correct: number;
  incorrect: number;
  partial: number;
  timeout: number;
  skipped: number;
  accuracy: number;
  totalTimeMs: number;
  xpAwarded: number;
  level: number;
  leveledUp: boolean;
  streak: number;
  achievements: Array<{ slug: string; name: unknown }>;
  isPerfect: boolean;
}

interface CategoryOpt { id: string; name: unknown }

const MODES = [
  { id: 'practice', icon: '🧘', untimed: true },
  { id: 'timed', icon: '⚡', untimed: false },
  { id: 'daily', icon: '📅', untimed: false },
  { id: 'speed', icon: '🚀', untimed: false },
  { id: 'survival', icon: '💀', untimed: false },
  { id: 'knowledge', icon: '🎓', untimed: false },
  { id: 'review', icon: '🔁', untimed: true },
  { id: 'bookmarks', icon: '🔖', untimed: true },
] as const;
type ModeId = (typeof MODES)[number]['id'];
const MODE_IDS = new Set<string>(MODES.map((m) => m.id));
/** three tiles above the fold; the rest sit behind "other modes" so the start button stays reachable */
const PRIMARY_MODES = new Set<ModeId>(['practice', 'timed', 'daily']);
const DEFAULT_COUNT = 10;

export function PlayPage() {
  const { t, pick, lang } = useI18n();
  const tx = useTx();
  usePageMeta(t('play'), tx('metaDescPlay'));
  // setup lives in the URL: back/forward and shared links restore the same mode / category / count
  const [params, setParams] = useSearchParams();
  const rawMode = params.get('mode') ?? 'practice';
  const mode: ModeId = (MODE_IDS.has(rawMode) ? rawMode : 'practice') as ModeId;
  const categoryId = params.get('category') ?? '';
  const difficulty = params.get('difficulty') ?? '';
  const count = Math.min(30, Math.max(3, Number(params.get('count')) || DEFAULT_COUNT));
  const setParam = useCallback((key: string, value: string, replace = false) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value); else next.delete(key);
      return next;
    }, { replace });
  }, [setParams]);
  const setMode = (m: ModeId) => setParam('mode', m === 'practice' ? '' : m);
  const setCategoryId = (id: string) => setParam('category', id);
  const setDifficulty = (d: string) => setParam('difficulty', d, true);
  const setCount = (c: number) => setParam('count', c === DEFAULT_COUNT ? '' : String(c), true);
  const [showMore, setShowMore] = useState(() => !PRIMARY_MODES.has(mode));
  const [categories, setCategories] = useState<CategoryOpt[]>([]);
  const [session, setSession] = useState<StartResponse | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [spinning, setSpinning] = useState(false);
  // Trivia-Crack-style category roulette: a short spin, then a random category lands
  const spinWheel = () => {
    if (categories.length === 0) return;
    setSpinning(true);
    haptic('tap');
    window.setTimeout(() => {
      setCategoryId(categories[Math.floor(Math.random() * categories.length)].id);
      setSpinning(false);
    }, 1100);
  };

  useEffect(() => {
    void get<{ categories: CategoryOpt[] }>('/categories').then((r) => setCategories(r.categories)).catch(() => undefined);
  }, []);

  const start = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await post<StartResponse>('/quizzes/start', {
        mode,
        language: lang,
        categoryId: mode === 'review' || mode === 'daily' ? undefined : categoryId || undefined,
        difficulty: mode === 'review' || mode === 'daily' ? undefined : difficulty || undefined,
        questionCount: count,
      });
      setSession(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('error'));
    } finally {
      setBusy(false);
    }
  };

  if (session) return <ErrorBoundary><QuizPlayer session={session} /></ErrorBoundary>;

  const modeMeta: Record<ModeId, { name: string; desc: string }> = {
    practice: { name: t('modePractice'), desc: t('modePracticeDesc') },
    timed: { name: t('modeTimed'), desc: t('modeTimedDesc') },
    daily: { name: t('dailyChallenge'), desc: t('sameForAll') },
    review: { name: t('modeReview'), desc: t('modeReviewDesc') },
    speed: { name: t('modeSpeed'), desc: t('modeSpeedDesc') },
    survival: { name: t('modeSurvival'), desc: t('modeSurvivalDesc') },
    knowledge: { name: t('modeKnowledge'), desc: t('modeKnowledgeDesc') },
    bookmarks: { name: t('modeBookmarks'), desc: t('modeBookmarksDesc') },
  };
  const tile = (m: (typeof MODES)[number]) => (
    <button type="button" key={m.id} className={mode === m.id ? 'selected' : ''} aria-pressed={mode === m.id} onClick={() => setMode(m.id)}>
      <div className="mp-icon" aria-hidden="true">{m.icon}</div>
      <div className="mp-name">{modeMeta[m.id].name}</div>
      <div className="mp-desc">{modeMeta[m.id].desc}</div>
    </button>
  );
  const needsSetup = mode !== 'review' && mode !== 'daily' && mode !== 'bookmarks';

  return (
    <div className="card page narrow">
      <h1>{mode === 'daily' ? t('dailyChallenge') : t('startQuiz')}</h1>
      <div className="stack">
        <div className="mode-pick primary" role="group" aria-label={t('mode')}>
          {MODES.filter((m) => PRIMARY_MODES.has(m.id)).map(tile)}
        </div>
        <button type="button" className="btn ghost sm" aria-expanded={showMore} aria-controls="more-modes" onClick={() => setShowMore((v) => !v)}>
          {showMore ? '▴' : '▾'} {t('otherModes')}
        </button>
        {showMore && (
          <div className="mode-pick" id="more-modes" role="group" aria-label={t('otherModes')}>
            {MODES.filter((m) => !PRIMARY_MODES.has(m.id)).map(tile)}
          </div>
        )}
        {needsSetup && (
          <>
            <div>
              <label className="fld" htmlFor="q-category">{t('category')}</label>
              <div className="row nowrap">
                <select id="q-category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                  <option value="">{t('anyCategory')}</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{pick(c.name)}</option>)}
                </select>
                <button
                  type="button"
                  className={`btn secondary wheel-btn ${spinning ? 'spinning' : ''}`}
                  aria-label={t('spinWheel')}
                  title={t('spinWheel')}
                  disabled={spinning || categories.length === 0}
                  onClick={spinWheel}
                >
                  🎡
                </button>
              </div>
            </div>
            <div>
              <label className="fld" htmlFor="q-difficulty">{t('difficulty')}</label>
              <select id="q-difficulty" value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
                <option value="">{t('anyDifficulty')}</option>
                {(['easy', 'medium', 'hard', 'expert'] as const).map((d) => <option key={d} value={d}>{t(d)}</option>)}
              </select>
            </div>
          </>
        )}
        {mode !== 'daily' && (
          <div>
            <label className="fld" htmlFor="q-count">{t('questions')}: {count}</label>
            <input id="q-count" type="range" min={3} max={30} value={count} onChange={(e) => setCount(Number(e.target.value))} />
          </div>
        )}
        {error && <p className="error-text" role="alert">{error}</p>}
        <div className="sticky-cta">
          <button type="button" className="btn lg block" onClick={start} disabled={busy}>{busy ? t('loading') : t('startQuiz')}</button>
        </div>
      </div>
    </div>
  );
}

type OutcomeMark = 'correct' | 'partial' | 'incorrect' | 'timeout' | 'skipped';

/** Shared player — also used by challenges/monthly/tournaments/daily. */
export function QuizPlayer({ session }: { session: StartResponse }) {
  const { t, pick, dir } = useI18n();
  const chev = dir === 'rtl' ? '‹' : '›';
  const nav = useNavigate();
  const { specs, error: specsError, retry: retrySpecs } = useTypeSpecs();
  const online = useOnline();
  const toast = useToast();
  const { refreshUser } = useAuth();
  const [index, setIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [timeLeft, setTimeLeft] = useState(session.questions[0]?.timeLimitSec ?? 30);
  const [feedback, setFeedback] = useState<{ outcome: string; data: Feedback | null } | null>(null);
  const [powerups, setPowerups] = useState({ fiftyFifty: session.powerups?.fiftyFifty ?? 0, timeExtend: session.powerups?.timeExtend ?? 0, audience: session.powerups?.audience ?? 0 });
  const [audience, setAudience] = useState<Record<string, Array<{ optionId: string; percent: number }>>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const askAudience = async () => {
    if (!question || powerups.audience <= 0) return;
    try {
      const res = await post<{ distribution: Array<{ optionId: string; percent: number }>; remaining: number }>(
        `/quizzes/attempts/${session.attemptId}/powerups`,
        { kind: 'audience', questionId: question.id },
      );
      setAudience((m) => ({ ...m, [question.id]: res.distribution }));
      setPowerups((p) => ({ ...p, audience: res.remaining }));
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('error'));
    }
  };
  const toggleBookmark = async () => {
    if (!question) return;
    const on = !saved[question.id];
    try {
      if (on) await post(`/quizzes/bookmarks/${question.id}`, {});
      else await del(`/quizzes/bookmarks/${question.id}`);
      setSaved((m) => ({ ...m, [question.id]: on }));
      toast(on ? `🔖 ${t('bookmarked')}` : '✓');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('error'));
    }
  };
  const [eliminated, setEliminated] = useState<Record<string, string[]>>({});
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const answeredRef = useRef(false);
  const outcomesRef = useRef<OutcomeMark[]>([]);
  const untimed = session.untimed === true;

  const question = session.questions[index];
  const total = session.questions.length;

  // focus mode: hide app chrome while playing
  useEffect(() => {
    if (summary) {
      delete document.body.dataset.focus;
      return;
    }
    document.body.dataset.focus = '1';
    return () => {
      delete document.body.dataset.focus;
    };
  }, [summary]);

  const finish = useCallback(async () => {
    setSubmitting(true);
    try {
      const res = await post<Summary>(`/quizzes/attempts/${session.attemptId}/submit`);
      sfx.finish();
      setSummary(res);
      void refreshUser();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        nav(`/review/${session.attemptId}`);
        return;
      }
      toast(err instanceof ApiError ? err.message : t('error'));
      setSubmitting(false);
    }
  }, [session.attemptId, nav, refreshUser, toast, t]);

  const goNextRef = useRef<() => void>(() => undefined);
  const goNext = useCallback(() => {
    setFeedback(null);
    if (index + 1 >= total) {
      void finish();
    } else {
      answeredRef.current = false;
      setIndex((i) => i + 1);
      setTimeLeft(session.questions[index + 1].timeLimitSec);
    }
  }, [index, total, finish, session.questions]);
  goNextRef.current = goNext;

  const submitAnswer = useCallback(
    async (answer: unknown) => {
      if (answeredRef.current || !question) return;
      answeredRef.current = true;
      setSubmitting(true);
      try {
        const res = await post<{ outcome: OutcomeMark; points: number; feedback?: Feedback }>(
          `/quizzes/attempts/${session.attemptId}/answers`,
          { questionId: question.id, answer },
        );
        outcomesRef.current.push(res.outcome);
        setScore((s) => s + res.points);
        if (res.outcome === 'correct' || res.outcome === 'partial') { sfx.correct(); haptic('correct'); }
        else if (res.outcome === 'incorrect' || res.outcome === 'timeout') { sfx.wrong(); haptic('wrong'); }
        setSubmitting(false);
        if (untimed && answer !== null) {
          // self-paced learning: show the answer + explanation, wait for Next
          setFeedback({ outcome: res.outcome, data: res.feedback ?? null });
          if (autoAdvanceEnabled()) window.setTimeout(() => goNextRef.current(), 2600);
          return;
        }
        // survival: the first miss ends the run (Trivia Royale / QuizUp style)
        if (session.mode === 'survival' && (res.outcome === 'incorrect' || res.outcome === 'timeout')) {
          toast(`💀 ${t('survivalOver')}`);
          void finish();
          return;
        }
        if (!untimed) {
          if (res.outcome === 'correct') toast(`✓ +${res.points}`);
          else if (res.outcome === 'partial') toast(`± +${res.points}`);
          else if (res.outcome === 'timeout') toast(`⏰ ${t('timeout')}`);
          else if (res.outcome === 'incorrect') toast(`✗ ${t('incorrect')}`);
        }
      } catch (err) {
        if (err instanceof ApiError && (err.status === 409 || err.status === 400)) {
          outcomesRef.current.push('skipped');
        } else {
          answeredRef.current = false;
          setSubmitting(false);
          toast(err instanceof ApiError ? err.message : t('error'));
          return;
        }
        setSubmitting(false);
      }
      goNext();
    },
    [question, session.attemptId, session.mode, goNext, finish, toast, t, untimed],
  );

  // countdown (timed modes only; the server stays authoritative)
  useEffect(() => {
    if (summary || !question || untimed || feedback || !online) return; // offline: the clock waits for the connection
    timerRef.current = setInterval(() => {
      setTimeLeft((tl) => {
        if (tl <= 1) {
          clearInterval(timerRef.current!);
          void submitAnswer(null);
          return 0;
        }
        return tl - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current!);
  }, [index, summary, question, submitAnswer, untimed, feedback, online]);

  const useFiftyFifty = async () => {
    if (!question || powerups.fiftyFifty <= 0) return;
    try {
      const res = await post<{ removedOptionIds: string[]; remaining: number }>(
        `/quizzes/attempts/${session.attemptId}/powerups`,
        { kind: 'fifty_fifty', questionId: question.id },
      );
      setEliminated((m) => ({ ...m, [question.id]: res.removedOptionIds }));
      setPowerups((p) => ({ ...p, fiftyFifty: res.remaining }));
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('error'));
    }
  };
  const useTimeExtend = async () => {
    if (!question || powerups.timeExtend <= 0) return;
    try {
      const res = await post<{ addedSec: number; remaining: number }>(
        `/quizzes/attempts/${session.attemptId}/powerups`,
        { kind: 'time_extend', questionId: question.id },
      );
      setTimeLeft((tl) => tl + res.addedSec);
      setPowerups((p) => ({ ...p, timeExtend: res.remaining }));
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('error'));
    }
  };

  // hide 50/50-eliminated options before rendering
  const displayQuestion = useMemo(() => {
    if (!question) return question;
    const removed = eliminated[question.id];
    if (!removed?.length || !Array.isArray(question.content.options)) return question;
    return {
      ...question,
      content: {
        ...question.content,
        options: (question.content.options as Array<{ id: string }>).filter((o) => !removed.includes(o.id)),
      },
    };
  }, [question, eliminated]);

  if (summary) return <ResultView summary={summary} outcomes={outcomesRef.current} mode={session.mode} />;
  if (!specs && specsError) return <div className="card"><ErrorState error={specsError} onRetry={retrySpecs} /></div>;
  if (!specs || !question || !displayQuestion) return <Spinner />;

  const hasOptions = Array.isArray(question.content.options) && (question.content.options as unknown[]).length >= 3;

  return (
    <div className="page">
      <button type="button" className="btn secondary sm focus-exit" onClick={() => finish()} disabled={submitting}>
        ✕ {t('finish')}
      </button>
      {!online && <div className="banner warn mb-2">{t('offline')}</div>}
      <div className="quiz-top">
        <div className="stack tight grow">
          <div className="row between">
            <span className="badge primary">{t('question')} {index + 1} / {total}</span>
            <span className="badge">{t('score')}: {score}</span>
          </div>
          <div className="progress" aria-hidden="true"><div style={{ width: `${((index + 1) / total) * 100}%` }} /></div>
        </div>
        {untimed ? <span className="badge success">🧘 {t('untimed')}</span> : <TimerRing left={timeLeft} total={question.timeLimitSec || 1} />}
      </div>
      {(powerups.fiftyFifty > 0 || powerups.timeExtend > 0 || powerups.audience > 0) && !feedback && (
        <div className="row mb-2">
          {powerups.fiftyFifty > 0 && (
            <button type="button" className="powerup" onClick={useFiftyFifty} disabled={submitting || !hasOptions || !!eliminated[question.id]} aria-label={`${t('fiftyFifty')} (${powerups.fiftyFifty})`} title={t('fiftyFifty')}>
              ½ 50:50 <span className="count" aria-hidden="true">{powerups.fiftyFifty}</span>
            </button>
          )}
          {!untimed && powerups.timeExtend > 0 && (
            <button type="button" className="powerup" onClick={useTimeExtend} disabled={submitting} aria-label={`${t('timeExtend')} (${powerups.timeExtend})`} title={t('timeExtend')}>
              ⏳ +20s <span className="count" aria-hidden="true">{powerups.timeExtend}</span>
            </button>
          )}
          {powerups.audience > 0 && hasOptions && !audience[question.id] && (
            <button type="button" className="powerup" onClick={askAudience} disabled={submitting} aria-label={`${t('askAudience')} (${powerups.audience})`}>
              👥 {t('askAudience')} <span className="count" aria-hidden="true">{powerups.audience}</span>
            </button>
          )}
        </div>
      )}
      {hasOptions && !feedback && <p className="muted kbd-hint">⌨️ {t('keyboardHint')}</p>}
      <div className="card quiz-card">
        {feedback ? (
          <>
            <h1 className="quiz-question">{pick(question.content.prompt)}</h1>
            <div className={`feedback ${feedback.outcome === 'correct' ? 'good' : feedback.outcome === 'partial' ? 'good' : 'bad'}`} role="status">
              <div className="fb-head">
                {feedback.outcome === 'correct' ? `✓ ${t('feedbackCorrect')}` : feedback.outcome === 'partial' ? `± ${t('partial')}` : `✗ ${t('feedbackWrong')}`}
              </div>
              {feedback.data && feedback.outcome !== 'correct' && (
                <p><strong>{t('correctAnswer')}:</strong> {formatAnswer(feedback.data.correctAnswer, question, pick)}</p>
              )}
              {feedback.data && pick(feedback.data.explanation) && <p>{pick(feedback.data.explanation)}</p>}
            </div>
            <div className="row mt-4">
              <button type="button" className="btn" onClick={goNext} autoFocus>
                {index + 1 >= total ? t('finish') : t('next')} {chev}
              </button>
              <button type="button" className="btn ghost sm" onClick={toggleBookmark} aria-pressed={!!saved[question.id]}>
                {saved[question.id] ? `🔖 ${t('bookmarked')}` : `🔖 ${t('bookmark')}`}
              </button>
            </div>
          </>
        ) : (
          <>
            {audience[question.id] && (
              <div className="audience" aria-label={t('audienceSays')}>
                <span className="muted">👥 {t('audienceSays')}</span>
                {audience[question.id].map((d, i) => (
                  <div key={d.optionId} className="audience-row">
                    <span className="audience-key">{['▲', '◆', '●', '■'][i % 4]}</span>
                    <div className="audience-bar"><div style={{ width: `${d.percent}%` }} /></div>
                    <span className="audience-pct">{d.percent}%</span>
                  </div>
                ))}
              </div>
            )}
            <QuestionRenderer key={`${question.id}:${eliminated[question.id]?.length ?? 0}`} question={displayQuestion} specs={specs} onSubmit={submitAnswer} disabled={submitting} />
            <div className="divider" />
            <div className="row between">
              <button type="button" className="btn ghost sm" onClick={() => submitAnswer(null)} disabled={submitting}>{t('skip')} {chev}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function formatAnswer(answer: unknown, question: PlayableQuestion, pick: (v: unknown) => string): string {
  if (answer === null || answer === undefined) return '—';
  const options = Array.isArray(question.content.options)
    ? (question.content.options as Array<{ id: string; text?: unknown }>)
    : [];
  const lookup = (id: unknown) => {
    const o = options.find((x) => x.id === id);
    return o ? pick(o.text) : String(id);
  };
  if (typeof answer === 'string') return options.length ? lookup(answer) : answer;
  if (typeof answer === 'number') return String(answer);
  if (Array.isArray(answer)) return answer.map(lookup).join(', ');
  if (typeof answer === 'object') {
    const o = answer as Record<string, unknown>;
    if (Array.isArray(o.accepted)) return (o.accepted as string[]).join(' / ');
    if ('value' in o) return String(o.value);
    if ('back' in o) return String(o.back);
    return Object.entries(o).map(([k, v]) => `${k} ${document.documentElement.dir === 'rtl' ? '←' : '→'} ${v}`).join(document.documentElement.dir === 'rtl' ? '، ' : ', ');
  }
  return String(answer);
}

function TimerRing({ left, total }: { left: number; total: number }) {
  const r = 25;
  const c = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, left / total));
  return (
    <div className={`timer-wrap ${left <= 5 ? 'low' : ''}`} role="timer" aria-label={`${left}s`}>
      <svg width={58} height={58} aria-hidden="true">
        <circle className="track" cx={29} cy={29} r={r} fill="none" strokeWidth={5} />
        <circle
          className="arc" cx={29} cy={29} r={r} fill="none" strokeWidth={5} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - frac)}
        />
      </svg>
      <span className="num">{left}</span>
    </div>
  );
}

function useCountUp(target: number, ms = 900): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (target <= 0 || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setValue(target);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      setValue(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return value;
}

function AccuracyRing({ pct, label }: { pct: number; label: string }) {
  const r = 50;
  const c = 2 * Math.PI * r;
  const [offset, setOffset] = useState(c);
  useEffect(() => {
    const id = setTimeout(() => setOffset(c * (1 - Math.max(0, Math.min(100, pct)) / 100)), 60);
    return () => clearTimeout(id);
  }, [pct, c]);
  return (
    <div className="accuracy-ring">
      <svg width={118} height={118} aria-hidden="true">
        <circle className="track" cx={59} cy={59} r={r} fill="none" strokeWidth={9} />
        <circle className="arc" cx={59} cy={59} r={r} fill="none" strokeWidth={9} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={offset} />
      </svg>
      <span className="num">{pct}%<small>{label}</small></span>
    </div>
  );
}

const OUTCOME_EMOJI: Record<OutcomeMark, string> = {
  correct: '🟩',
  partial: '🟨',
  incorrect: '🟥',
  timeout: '⏰',
  skipped: '⬜',
};
// on-screen squares carry a glyph too, so the result reads without colour
const OUTCOME_GLYPH: Record<OutcomeMark, string> = { correct: '✓', partial: '±', incorrect: '✕', timeout: '✕', skipped: '–' };

export function ResultView({ summary, outcomes = [], mode }: { summary: Summary; outcomes?: OutcomeMark[]; mode?: string }) {
  const { t, pick } = useI18n();
  const tx = useTx();
  const nav = useNavigate();
  const toast = useToast();
  const shownScore = useCountUp(summary.score);
  const grid = outcomes.map((o) => OUTCOME_EMOJI[o] ?? '⬜').join('');
  const share = async () => {
    // Wordle-style share card: score + emoji outcome grid + a link that lands on the same quiz
    const link = `${window.location.origin}${import.meta.env.BASE_URL}${mode === 'daily' ? 'play?mode=daily' : ''}`;
    const text = `🧠 ${t('appName')}\n${tx('shareResultText', { score: summary.score, max: summary.maxScore })} · ${summary.accuracy}%\n${grid}\n${link}`;
    try {
      if (await nativeShareText(text, t('appName'))) return;
      if (navigator.share) await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(text);
        toast(`✓ ${t('copied')}`);
      }
    } catch {
      /* cancelled */
    }
  };
  const shareImage = async () => {
    // 1080×1080 result card (Wordle/Duolingo-style share card)
    const c = document.createElement('canvas');
    c.width = 1080; c.height = 1080;
    const g = c.getContext('2d');
    if (!g) return;
    const css = getComputedStyle(document.documentElement);
    const grad = g.createLinearGradient(0, 0, 1080, 1080);
    grad.addColorStop(0, css.getPropertyValue('--primary').trim() || '#c2410c'); grad.addColorStop(1, css.getPropertyValue('--success').trim() || '#1f7a4d');
    g.fillStyle = grad; g.fillRect(0, 0, 1080, 1080);
    g.fillStyle = 'rgba(255,255,255,0.12)';
    g.beginPath(); g.arc(900, 140, 260, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.textAlign = 'center';
    g.font = '700 54px Rubik, Segoe UI, sans-serif';
    g.fillText(`🧠 ${t('appName')}`, 540, 150);
    g.font = '900 220px Rubik, Segoe UI, sans-serif';
    g.fillText(String(shownScore), 540, 520);
    g.font = '600 56px Rubik, Segoe UI, sans-serif';
    g.fillText(`/ ${summary.maxScore}`, 540, 600);
    g.font = '700 64px Rubik, Segoe UI, sans-serif';
    g.fillText(`${t('accuracy')} ${summary.accuracy}%`, 540, 740);
    g.font = '60px sans-serif';
    g.fillText(outcomes.map((o: OutcomeMark) => (o === 'correct' ? '🟩' : o === 'partial' ? '🟨' : '⬜')).join(''), 540, 860);
    g.font = '500 40px Rubik, Segoe UI, sans-serif';
    g.fillText(window.location.host + (import.meta.env.BASE_URL === '/' ? '' : import.meta.env.BASE_URL.replace(/\/$/, '')), 540, 990);
    const blob: Blob | null = await new Promise((r) => c.toBlob(r, 'image/png'));
    if (!blob) return;
    const file = new File([blob], 'quiz-result.png', { type: 'image/png' });
    try {
      if (await nativeShareBlob(blob, 'quiz-result.png', t('appName'))) return;
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file] }); return; }
    } catch { /* cancelled */ }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'quiz-result.png'; a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <div className="card center page narrow">
      {summary.isPerfect && (
        <div className="confetti" aria-hidden="true">
          {Array.from({ length: 24 }, (_, i) => <span key={i} style={{ '--i': i } as React.CSSProperties} />)}
        </div>
      )}
      <h1 className="sr-only">{t('resultsHeading')}</h1>
      <div className="result-emoji" aria-hidden="true">{summary.isPerfect ? '🏆' : summary.accuracy >= 60 ? '🎉' : '💪'}</div>
      {summary.isPerfect && <h2>{t('perfect')}</h2>}
      <p className="result-score">{shownScore} <span className="of">/ {summary.maxScore}</span></p>
      <AccuracyRing pct={summary.accuracy} label={t('accuracy')} />
      {outcomes.length > 0 && (
        <div className="outcome-grid mt-2" role="list" aria-label={t('resultsHeading')}>
          {outcomes.map((o, i) => (
            <span key={i} role="listitem" className={`outcome-dot ${o}`} aria-label={`${i + 1}: ${t(o)}`}>{OUTCOME_GLYPH[o] ?? '–'}</span>
          ))}
        </div>
      )}
      <div className="stack mt-4">
        <button type="button" className="btn block" onClick={() => nav(`/review/${summary.attemptId}`)}>{t('reviewAnswers')}</button>
        <button type="button" className="btn secondary block" onClick={() => nav('/play')}>{t('playAgain')}</button>
      </div>
      <div className="grid cols-4 my-4">
        <StatBox value={summary.correct} label={t('correct')} />
        <StatBox value={summary.partial} label={t('partial')} />
        <StatBox value={summary.incorrect} label={t('incorrect')} />
        <StatBox value={summary.timeout + summary.skipped} label={t('skipped')} />
      </div>
      <div className="row centered">
        <span className="badge primary">+{summary.xpAwarded} {t('xp')}</span>
        <span className="badge warn">🔥 {summary.streak}</span>
        <span className="badge">{fmtMs(summary.totalTimeMs)}</span>
        {summary.leveledUp && <span className="badge success">⬆ {t('levelUp')}</span>}
      </div>
      {summary.achievements.length > 0 && (
        <div className="mt-3">
          {summary.achievements.map((a) => (
            <div key={a.slug} className="badge success m-1">🏅 {t('newAchievement')}: {pick(a.name)}</div>
          ))}
        </div>
      )}
      <div className="row centered mt-5">
        <button type="button" className="btn ghost" onClick={share}>{t('share')}</button>
        <button type="button" className="btn ghost" onClick={shareImage}>🖼️ {t('shareImage')}</button>
      </div>
    </div>
  );
}

interface ReviewItem {
  questionId: string;
  type: string;
  content: Record<string, unknown>;
  yourAnswer: unknown;
  correctAnswer: unknown;
  explanation: unknown;
  outcome: string;
  score: number;
  maxScore: number;
  timeTakenMs: number;
}

export function ReviewPage() {
  const { t, pick } = useI18n();
  const { attemptId } = useParams();
  const toast = useToast();
  const [data, setData] = useState<{ attempt: { score: number; maxScore: number }; items: ReviewItem[] } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [reported, setReported] = useState<Set<string>>(new Set());
  const [reporting, setReporting] = useState<string | null>(null);
  const [reason, setReason] = useState('wrong_answer');
  const [details, setDetails] = useState('');

  useEffect(() => {
    void get<{ attempt: { score: number; maxScore: number }; items: ReviewItem[] }>(`/quizzes/attempts/${attemptId}/review`)
      .then(setData)
      .catch((err) => setError(err));
  }, [attemptId, t]);

  const [sendReport, sending] = useAction(async (questionId: string) => {
    await post(`/questions/${questionId}/report`, { reason, details: details.trim() || undefined });
    setReported((s) => new Set(s).add(questionId));
    setReporting(null);
    setDetails('');
    toast(`✓ ${t('sent')}`);
  });
  const REASONS: Array<[string, TKey]> = [
    ['wrong_answer', 'reasonWrongAnswer'], ['wrong_question', 'reasonWrongQuestion'], ['typo', 'reasonTypo'], ['duplicate', 'reasonDuplicate'],
    ['offensive', 'reasonOffensive'], ['technical', 'reasonTechnical'], ['other', 'reasonOther'],
  ];

  const renderAnswer = (item: ReviewItem, answer: unknown): string =>
    formatAnswer(answer, { content: item.content } as PlayableQuestion, pick);

  if (error) return <div className="page"><div className="card"><ErrorState error={error} /></div></div>;
  if (!data) return <Spinner />;

  const badge = (outcome: string) =>
    outcome === 'correct' ? 'success' : outcome === 'partial' ? 'warn' : outcome === 'skipped' ? '' : 'danger';

  return (
    <div className="page wide">
      <div className="row between mb-3">
        <h1>{t('reviewAnswers')}</h1>
        <span className="badge primary">{data.attempt.score} / {data.attempt.maxScore}</span>
      </div>
      <div className="stack">
        {data.items.map((item, i) => (
          <div className="card" key={item.questionId}>
            <div className="row between">
              <strong>{i + 1}. {pick(item.content.prompt)}</strong>
              <span className={`badge ${badge(item.outcome)}`}>{t(item.outcome as never)} · {item.score}/{item.maxScore}</span>
            </div>
            <p><span className="muted">{t('yourAnswer')}:</span> {renderAnswer(item, item.yourAnswer)}</p>
            <p><span className="muted">{t('correctAnswer')}:</span> <strong>{renderAnswer(item, item.correctAnswer)}</strong></p>
            {pick(item.explanation) && <p className="banner info">{pick(item.explanation)}</p>}
            <button type="button" className="btn ghost sm" onClick={() => setReporting(reporting === item.questionId ? null : item.questionId)} disabled={reported.has(item.questionId)} aria-expanded={reporting === item.questionId}>
              {reported.has(item.questionId) ? '✓' : `⚑ ${t('reportQuestion')}`}
            </button>
            {reporting === item.questionId && (
              <form className="report-dialog stack" onSubmit={(e) => { e.preventDefault(); void sendReport(item.questionId); }}>
                <label className="fld" htmlFor={`reason-${item.questionId}`}>{t('reportReason')}</label>
                <select id={`reason-${item.questionId}`} value={reason} onChange={(e) => setReason(e.target.value)}>
                  {REASONS.map(([v, k]) => <option key={v} value={v}>{t(k)}</option>)}
                </select>
                <textarea aria-label={t('details')} placeholder={t('details')} value={details} maxLength={500} rows={2} onChange={(e) => setDetails(e.target.value)} />
                <div className="row tight">
                  <button className="btn sm" type="submit" disabled={sending}>{t('send')}</button>
                  <button className="btn secondary sm" type="button" onClick={() => setReporting(null)}>{t('cancel')}</button>
                </div>
              </form>
            )}
          </div>
        ))}
      </div>
      <div className="center mt-4">
        <Link className="btn" to="/play">{t('playAgain')}</Link>
      </div>
    </div>
  );
}
