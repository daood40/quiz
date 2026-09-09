import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { get, storageGet, storageSet } from '../api';
import { EmptyState, ErrorState, Spinner, fmtMs, useAsync, usePageMeta, useStatusLabel } from '../components';
import { useAuth } from '../ctx';
import { useI18n } from '../i18n';
import { useTx } from '../i18n';

interface Category {
  id: string;
  slug: string;
  name: unknown;
  icon: string;
  questionCount: number;
  parentId: string | null;
}
interface AttemptRow {
  id: string;
  mode: string;
  score: number;
  max_score: number;
  correct_count: number;
  submitted_at: string;
  server_duration_ms: number;
}
interface MonthlyInfo { yearMonth: string; questionCount: number }
interface Progress { xp: number; level: number; nextLevelAt: number; progress: number }
interface DailyInfo { available: boolean; myAttempt: { status: string; score: number } | null }

export function HomePage() {
  const { t, n, pick, lang } = useI18n();
  const tx = useTx();
  usePageMeta(t('home'), tx('metaDescHome'));
  const [showTip, setShowTip] = useState(() => !storageGet('tipSeen'));
  const dismissTip = () => { setShowTip(false); storageSet('tipSeen', '1'); };
  const { user } = useAuth();
  const nav = useNavigate();
  const statusLabel = useStatusLabel();
  const cats = useAsync(() => get<{ categories: Category[] }>('/categories').then((r) => r.categories), []);
  const recentQ = useAsync(() => get<{ attempts: AttemptRow[] }>('/quizzes/attempts?limit=5').then((r) => r.attempts), []);
  // secondary widgets: a 404 (demo / not created yet) is a valid "empty" state, anything else is an error with retry
  const monthly = useAsync<MonthlyInfo | null>(
    () => get<{ monthlyChallenge: MonthlyInfo }>('/monthly-challenges/current').then((r) => r.monthlyChallenge).catch((e) => { if (isMissing(e)) return null; throw e; }),
    [],
  );
  const progress = useAsync<Progress | null>(() => get<Progress>('/achievements/progress').catch(() => null), []);
  const daily = useAsync<DailyInfo | null>(
    () => get<DailyInfo>('/quizzes/daily').catch((e) => { if (isMissing(e)) return null; throw e; }),
    [],
  );
  const categories = cats.data;
  const recent = recentQ.data;

  if (!user) return <Spinner />;

  return (
    <div className="stack">
      {user.isGuest && (
        <div className="banner warn">
          {t('guestBanner')} <Link to="/register">{t('register')}</Link>
        </div>
      )}
      <div className="card hero">
        <div className="row between">
          <div>
            <h1>{t('greeting')}{lang === 'ar' ? '،' : ','} {user.displayName || user.username} 👋</h1>
            <div className="row tight">
              <span className="badge primary">{t('level')} {user.level}</span>
              <span className="badge">{n('points', user.totalPoints)}</span>
              <span className="badge warn">🔥 {n('streakDays', user.currentStreak)}</span>
              {user.streakFreezes > 0 && <span className="badge">🧊 {user.streakFreezes}</span>}
            </div>
          </div>
          <button type="button" className="btn lg on-hero" onClick={() => nav('/play')}>▶ {t('quickQuiz')}</button>
        </div>
        {progress.data && (
          <div className="mt-3">
            <div className="row between muted"><span>{t('xp')}: {progress.data.xp}</span><span>{t('level')} {progress.data.level + 1}: {progress.data.nextLevelAt}</span></div>
            <div className="progress"><div style={{ width: `${progress.data.progress}%` }} /></div>
          </div>
        )}
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h2>📅 {t('dailyChallenge')}</h2>
          <p className="muted">{t('sameForAll')}</p>
          {daily.loading ? <Spinner rows={1} /> : daily.error ? <ErrorState error={daily.error} onRetry={daily.reload} />
            : daily.data?.myAttempt?.status === 'submitted' ? (
              <span className="badge success">{t('playedToday')} · {n('points', daily.data.myAttempt.score)}</span>
            ) : (
              <button type="button" className="btn secondary" onClick={() => nav('/play?mode=daily')}>{t('playDailyChallenge')}</button>
            )}
        </div>
        <div className="card">
          <h2>🏆 {t('monthlyChallenge')}</h2>
          {monthly.loading ? <Spinner rows={1} /> : monthly.error ? <ErrorState error={monthly.error} onRetry={monthly.reload} />
            : monthly.data ? (
              <>
                <p className="muted"><bdi className="ltr-id">{monthly.data.yearMonth}</bdi> · {n('questions', monthly.data.questionCount)}</p>
                <Link className="btn secondary" to="/monthly">{t('playMonthlyChallenge')}</Link>
              </>
            ) : (
              <EmptyState />
            )}
        </div>
      </div>

      {showTip && (
        <div className="banner info row between">
          <span>💡 {t('welcomeTip')}</span>
          <button type="button" className="btn ghost sm" onClick={dismissTip} aria-label={t('dismiss')}>✕</button>
        </div>
      )}
      <div className="card">
        <h2>{t('categories')}</h2>
        {cats.error ? <ErrorState error={cats.error} onRetry={cats.reload} /> : !categories ? (
          <Spinner />
        ) : categories.length === 0 ? <EmptyState body={t('noCategories')} /> : (
          <div className="grid cols-3">
            {categories.filter((c) => !c.parentId).map((c, i) => (
              <button type="button" key={c.id} className="option cat" style={{ '--cat-hue': (i * 47) % 360 } as React.CSSProperties} onClick={() => nav(`/play?category=${c.id}`)}>
                <span className="cat-ico">{c.icon || '📚'}</span>
                <span className="grow">{pick(c.name)}</span>
                <span className="badge">{c.questionCount}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h2>{t('recentResults')}</h2>
        {recentQ.error ? <ErrorState error={recentQ.error} onRetry={recentQ.reload} /> : !recent ? (
          <Spinner />
        ) : recent.length === 0 ? (
          <EmptyState icon="🎯" title={t('noResultsYet')} body={t('noResultsHint')} action={{ label: t('startFirstQuiz'), to: '/play' }} />
        ) : (
          <div className="tbl-wrap"><table className="tbl">
            <caption className="sr-only">{t('recentResults')}</caption>
            <thead><tr><th scope="col">{t('mode')}</th><th scope="col">{t('score')}</th><th scope="col">{t('correct')}</th><th scope="col" className="col-optional">{t('totalTime')}</th><th scope="col"><span className="sr-only">{t('reviewAnswers')}</span></th></tr></thead>
            <tbody>
              {recent.map((a) => (
                <tr key={a.id}>
                  <td>{statusLabel(a.mode)}</td>
                  <td><strong>{a.score}</strong> / {a.max_score}</td>
                  <td>{a.correct_count}</td>
                  <td className="col-optional">{a.server_duration_ms ? fmtMs(a.server_duration_ms) : '—'}</td>
                  <td><Link to={`/review/${a.id}`}>{t('reviewAnswers')}</Link></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}

/** 404 / demo-unavailable: the widget simply has nothing to show. */
function isMissing(e: unknown): boolean {
  return typeof e === 'object' && e !== null && 'status' in e && ((e as { status: number }).status === 404 || (e as { code?: string }).code === 'demo_unavailable');
}
