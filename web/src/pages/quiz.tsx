import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ApiError, get, post } from '../api';
import { Spinner, StatBox, fmtMs, useOnline, useToast, useTypeSpecs } from '../components';
import { useAuth } from '../ctx';
import { useI18n } from '../i18n';
import { QuestionRenderer, type PlayableQuestion } from '../QuestionRenderer';
import { haptic, sfx } from '../sounds';

interface StartResponse {
  attemptId: string;
  deadlineAt: string;
  untimed?: boolean;
  powerups?: { fiftyFifty: number; timeExtend: number };
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
  { id: 'review', icon: '🔁', untimed: true },
] as const;

export function PlayPage() {
  const { t, pick } = useI18n();
  const [params] = useSearchParams();
  const [categories, setCategories] = useState<CategoryOpt[]>([]);
  const [categoryId, setCategoryId] = useState(params.get('category') ?? '');
  const [difficulty, setDifficulty] = useState('');
  const [count, setCount] = useState(10);
  const [mode, setMode] = useState<string>(params.get('mode') === 'daily' ? 'daily' : 'practice');
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

  if (session) return <QuizPlayer session={session} />;

  const modeMeta: Record<string, { name: string; desc: string }> = {
    practice: { name: t('modePractice'), desc: t('modePracticeDesc') },
    timed: { name: t('modeTimed'), desc: t('modeTimedDesc') },
    review: { name: t('modeReview'), desc: t('modeReviewDesc') },
  };

  return (
    <div className="card" style={{ maxWidth: 540, margin: '0 auto' }}>
      <h1>{mode === 'daily' ? t('dailyChallenge') : t('startQuiz')}</h1>
      <div className="stack">
        {mode !== 'daily' && (
          <div className="mode-pick">
            {MODES.map((m) => (
              <button key={m.id} className={mode === m.id ? 'selected' : ''} onClick={() => setMode(m.id)}>
                <div className="mp-icon">{m.icon}</div>
                <div className="mp-name">{modeMeta[m.id].name}</div>
                <div className="mp-desc">{modeMeta[m.id].desc}</div>
              </button>
            ))}
          </div>
        )}
        {mode !== 'review' && mode !== 'daily' && (
          <>
            <div>
              <label className="fld">{t('category')}</label>
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
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
              <label className="fld">{t('difficulty')}</label>
              <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
                <option value="">{t('anyDifficulty')}</option>
                {(['easy', 'medium', 'hard', 'expert'] as const).map((d) => <option key={d} value={d}>{t(d)}</option>)}
              </select>
            </div>
          </>
        )}
        {mode !== 'daily' && (
          <div>
            <label className="fld">{t('questions')}: {count}</label>
            <input type="range" min={3} max={30} value={count} onChange={(e) => setCount(Number(e.target.value))} />
          </div>
        )}
        {error && <p className="error-text">{error}</p>}
        <button className="btn lg" onClick={start} disabled={busy}>{busy ? t('loading') : t('startQuiz')}</button>
      </div>
    </div>
  );
}

type OutcomeMark = 'correct' | 'partial' | 'incorrect' | 'timeout' | 'skipped';

/** Shared player — also used by challenges/monthly/tournaments/daily. */
export function QuizPlayer({ session }: { session: StartResponse }) {
  const { t, pick } = useI18n();
  const nav = useNavigate();
  const specs = useTypeSpecs();
  const online = useOnline();
  const toast = useToast();
  const { refreshUser } = useAuth();
  const [index, setIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [timeLeft, setTimeLeft] = useState(session.questions[0]?.timeLimitSec ?? 30);
  const [feedback, setFeedback] = useState<{ outcome: string; data: Feedback | null } | null>(null);
  const [powerups, setPowerups] = useState({ fiftyFifty: session.powerups?.fiftyFifty ?? 0, timeExtend: session.powerups?.timeExtend ?? 0 });
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
    [question, session.attemptId, goNext, toast, t, untimed],
  );

  // countdown (timed modes only; the server stays authoritative)
  useEffect(() => {
    if (summary || !question || untimed || feedback) return;
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
  }, [index, summary, question, submitAnswer, untimed, feedback]);

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

  if (summary) return <ResultView summary={summary} outcomes={outcomesRef.current} />;
  if (!specs || !question || !displayQuestion) return <Spinner />;

  const hasOptions = Array.isArray(question.content.options) && (question.content.options as unknown[]).length >= 3;

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <button className="btn secondary sm focus-exit" onClick={() => finish()} disabled={submitting}>
        ✕ {t('finish')}
      </button>
      {!online && <div className="banner warn" style={{ marginBottom: 10 }}>{t('offline')}</div>}
      <div className="quiz-top">
        <div className="stack" style={{ gap: 6, flex: 1 }}>
          <div className="row between">
            <span className="badge primary">{t('question')} {index + 1} / {total}</span>
            <span className="badge">{t('score')}: {score}</span>
          </div>
          <div className="progress" aria-hidden="true"><div style={{ width: `${((index + 1) / total) * 100}%` }} /></div>
        </div>
        {untimed ? <span className="badge success">🧘 {t('untimed')}</span> : <TimerRing left={timeLeft} total={question.timeLimitSec || 1} />}
      </div>
      {(powerups.fiftyFifty > 0 || powerups.timeExtend > 0) && !feedback && (
        <div className="row" style={{ marginBottom: 10 }}>
          {powerups.fiftyFifty > 0 && (
            <button className="powerup" onClick={useFiftyFifty} disabled={submitting || !hasOptions || !!eliminated[question.id]}>
              ½ 50:50 <span className="count">{powerups.fiftyFifty}</span>
            </button>
          )}
          {!untimed && powerups.timeExtend > 0 && (
            <button className="powerup" onClick={useTimeExtend} disabled={submitting}>
              ⏳ +20s <span className="count">{powerups.timeExtend}</span>
            </button>
          )}
        </div>
      )}
      <div className="card quiz-card">
        {feedback ? (
          <>
            <p className="quiz-question">{pick(question.content.prompt)}</p>
            <div className={`feedback ${feedback.outcome === 'correct' ? 'good' : feedback.outcome === 'partial' ? 'good' : 'bad'}`}>
              <div className="fb-head">
                {feedback.outcome === 'correct' ? `✓ ${t('feedbackCorrect')}` : feedback.outcome === 'partial' ? `± ${t('partial')}` : `✗ ${t('feedbackWrong')}`}
              </div>
              {feedback.data && feedback.outcome !== 'correct' && (
                <p><strong>{t('correctAnswer')}:</strong> {formatAnswer(feedback.data.correctAnswer, question, pick)}</p>
              )}
              {feedback.data && pick(feedback.data.explanation) && <p>{pick(feedback.data.explanation)}</p>}
            </div>
            <button className="btn" style={{ marginTop: 16 }} onClick={goNext} autoFocus>
              {index + 1 >= total ? t('finish') : t('next')} ›
            </button>
          </>
        ) : (
          <>
            <QuestionRenderer key={`${question.id}:${eliminated[question.id]?.length ?? 0}`} question={displayQuestion} specs={specs} onSubmit={submitAnswer} disabled={submitting} />
            <div className="divider" />
            <div className="row between">
              <button className="btn ghost sm" onClick={() => submitAnswer(null)} disabled={submitting}>{t('skip')} ›</button>
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
    return Object.entries(o).map(([k, v]) => `${k} → ${v}`).join('، ');
  }
  return String(answer);
}

function TimerRing({ left, total }: { left: number; total: number }) {
  const r = 25;
  const c = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, left / total));
  return (
    <div className={`timer-wrap ${left <= 5 ? 'low' : ''}`} aria-live="polite" aria-label={`${left}s`}>
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

function AccuracyRing({ pct }: { pct: number }) {
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
      <span className="num">{pct}%<small>accuracy</small></span>
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

export function ResultView({ summary, outcomes = [] }: { summary: Summary; outcomes?: OutcomeMark[] }) {
  const { t, pick } = useI18n();
  const nav = useNavigate();
  const toast = useToast();
  const shownScore = useCountUp(summary.score);
  const grid = outcomes.map((o) => OUTCOME_EMOJI[o] ?? '⬜').join('');
  const share = async () => {
    // Wordle-style share card: score + emoji outcome grid
    const text = `🧠 ${t('appName')}\n${t('score')}: ${summary.score}/${summary.maxScore} · ${summary.accuracy}%\n${grid}`;
    try {
      if (navigator.share) await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(text);
        toast('✓ Copied');
      }
    } catch {
      /* cancelled */
    }
  };
  return (
    <div className="card center" style={{ maxWidth: 560, margin: '0 auto' }}>
      {summary.isPerfect && (
        <div className="confetti" aria-hidden="true">
          {Array.from({ length: 24 }, (_, i) => <span key={i} style={{ '--i': i } as React.CSSProperties} />)}
        </div>
      )}
      <div className="result-emoji">{summary.isPerfect ? '🏆' : summary.accuracy >= 60 ? '🎉' : '💪'}</div>
      {summary.isPerfect && <h2>{t('perfect')}</h2>}
      <p className="result-score">{shownScore} <span className="of">/ {summary.maxScore}</span></p>
      <AccuracyRing pct={summary.accuracy} />
      {grid && <p style={{ fontSize: 20, letterSpacing: 2, margin: '6px 0 0' }}>{grid}</p>}
      <div className="grid cols-4" style={{ margin: '18px 0' }}>
        <StatBox value={summary.correct} label={t('correct')} />
        <StatBox value={summary.partial} label={t('partial')} />
        <StatBox value={summary.incorrect} label={t('incorrect')} />
        <StatBox value={summary.timeout + summary.skipped} label={t('skipped')} />
      </div>
      <div className="row" style={{ justifyContent: 'center' }}>
        <span className="badge primary">+{summary.xpAwarded} {t('xp')}</span>
        <span className="badge warn">🔥 {summary.streak}</span>
        <span className="badge">{fmtMs(summary.totalTimeMs)}</span>
        {summary.leveledUp && <span className="badge success">⬆ {t('levelUp')}</span>}
      </div>
      {summary.achievements.length > 0 && (
        <div style={{ marginTop: 12 }}>
          {summary.achievements.map((a) => (
            <div key={a.slug} className="badge success" style={{ margin: 4 }}>🏅 {t('newAchievement')}: {pick(a.name)}</div>
          ))}
        </div>
      )}
      <div className="row" style={{ justifyContent: 'center', marginTop: 20 }}>
        <button className="btn" onClick={() => nav(`/review/${summary.attemptId}`)}>{t('reviewAnswers')}</button>
        <button className="btn secondary" onClick={() => nav('/play')}>{t('tryAgain')}</button>
        <button className="btn ghost" onClick={share}>{t('share')}</button>
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
  const [error, setError] = useState('');
  const [reported, setReported] = useState<Set<string>>(new Set());

  useEffect(() => {
    void get<{ attempt: { score: number; maxScore: number }; items: ReviewItem[] }>(`/quizzes/attempts/${attemptId}/review`)
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : t('error')));
  }, [attemptId, t]);

  const report = async (questionId: string) => {
    try {
      await post(`/questions/${questionId}/report`, { reason: 'other', details: 'Reported from review screen' });
      setReported((s) => new Set(s).add(questionId));
      toast('✓');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('error'));
    }
  };

  const renderAnswer = (item: ReviewItem, answer: unknown): string =>
    formatAnswer(answer, { content: item.content } as PlayableQuestion, pick);

  if (error) return <p className="error-text center">{error}</p>;
  if (!data) return <Spinner />;

  const badge = (outcome: string) =>
    outcome === 'correct' ? 'success' : outcome === 'partial' ? 'warn' : outcome === 'skipped' ? '' : 'danger';

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <div className="row between" style={{ marginBottom: 14 }}>
        <h1>{t('reviewAnswers')}</h1>
        <span className="badge primary" style={{ fontSize: 15 }}>{data.attempt.score} / {data.attempt.maxScore}</span>
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
            <button className="btn ghost sm" onClick={() => report(item.questionId)} disabled={reported.has(item.questionId)}>
              {reported.has(item.questionId) ? '✓' : `⚑ ${t('reportQuestion')}`}
            </button>
          </div>
        ))}
      </div>
      <div className="center" style={{ marginTop: 18 }}>
        <Link className="btn" to="/play">{t('tryAgain')}</Link>
      </div>
    </div>
  );
}
