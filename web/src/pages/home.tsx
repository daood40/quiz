import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { get } from '../api';
import { EmptyState, Spinner, StatBox, fmtMs } from '../components';
import { useAuth } from '../ctx';
import { useI18n } from '../i18n';

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

export function HomePage() {
  const { t, pick, lang } = useI18n();
  const [showTip, setShowTip] = useState(() => { try { return !localStorage.getItem('tipSeen'); } catch { return false; } });
  const dismissTip = () => { setShowTip(false); try { localStorage.setItem('tipSeen', '1'); } catch { /* ignore */ } };
  const { user } = useAuth();
  const nav = useNavigate();
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [recent, setRecent] = useState<AttemptRow[] | null>(null);
  const [monthly, setMonthly] = useState<{ yearMonth: string; questionCount: number } | null>(null);
  const [progress, setProgress] = useState<{ xp: number; level: number; nextLevelAt: number; progress: number } | null>(null);
  const [daily, setDaily] = useState<{ available: boolean; myAttempt: { status: string; score: number } | null } | null>(null);

  useEffect(() => {
    void get<{ categories: Category[] }>('/categories').then((r) => setCategories(r.categories)).catch(() => setCategories([]));
    void get<{ attempts: AttemptRow[] }>('/quizzes/attempts?limit=5').then((r) => setRecent(r.attempts)).catch(() => setRecent([]));
    void get<{ monthlyChallenge: { yearMonth: string; questionCount: number } }>('/monthly-challenges/current')
      .then((r) => setMonthly(r.monthlyChallenge))
      .catch(() => setMonthly(null));
    void get<{ xp: number; level: number; nextLevelAt: number; progress: number }>('/achievements/progress')
      .then(setProgress)
      .catch(() => undefined);
    void get<{ available: boolean; myAttempt: { status: string; score: number } | null }>('/quizzes/daily')
      .then(setDaily)
      .catch(() => undefined);
  }, []);

  if (!user) return <Spinner />;

  return (
    <div className="stack" style={{ gap: 16 }}>
      {user.isGuest && (
        <div className="banner warn">
          {t('guestBanner')} <Link to="/register">{t('register')}</Link>
        </div>
      )}
      <div className="card hero">
        <div className="row between">
          <div>
            <h1>{t('greeting')}{lang === 'ar' ? '،' : ','} {user.displayName || user.username} 👋</h1>
            <div className="row" style={{ gap: 8 }}>
              <span className="badge primary">{t('level')} {user.level}</span>
              <span className="badge">{user.totalPoints.toLocaleString()} {t('points')}</span>
              <span className="badge warn">🔥 {user.currentStreak} {t('days')}</span>
              {user.streakFreezes > 0 && <span className="badge">🧊 {user.streakFreezes}</span>}
            </div>
          </div>
          <button
            className="btn lg"
            style={{ background: '#fff', color: 'var(--primary-strong)', boxShadow: '0 6px 20px rgb(0 0 0 / 18%)' }}
            onClick={() => nav('/play')}
          >▶ {t('quickQuiz')}</button>
        </div>
        {progress && (
          <div style={{ marginTop: 14 }}>
            <div className="row between muted"><span>{t('xp')}: {progress.xp}</span><span>{t('level')} {progress.level + 1}: {progress.nextLevelAt}</span></div>
            <div className="progress"><div style={{ width: `${progress.progress}%` }} /></div>
          </div>
        )}
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h2>📅 {t('dailyChallenge')}</h2>
          <p className="muted">{t('sameForAll')}</p>
          {daily?.myAttempt?.status === 'submitted' ? (
            <span className="badge success">{t('playedToday')} · {daily.myAttempt.score} {t('points')}</span>
          ) : (
            <button className="btn" onClick={() => nav('/play?mode=daily')}>{t('start')}</button>
          )}
        </div>
        <div className="card">
          <h2>🏆 {t('monthlyChallenge')}</h2>
          {monthly ? (
            <>
              <p className="muted">{monthly.yearMonth} · {monthly.questionCount} {t('questions')}</p>
              <Link className="btn" to="/monthly">{t('start')}</Link>
            </>
          ) : (
            <p className="muted">{t('noData')}</p>
          )}
        </div>
      </div>

      {showTip && (
        <div className="banner info row between" style={{ marginBottom: 16 }}>
          <span>💡 {t('welcomeTip')}</span>
          <button className="btn ghost sm" onClick={dismissTip} aria-label="✕">✕</button>
        </div>
      )}
      <div className="card">
        <h2>{t('categories')}</h2>
        {!categories ? (
          <Spinner />
        ) : (
          <div className="grid cols-3">
            {categories.filter((c) => !c.parentId).map((c, i) => (
              <button key={c.id} className="option cat" style={{ '--cat-hue': (i * 47) % 360 } as React.CSSProperties} onClick={() => nav(`/play?category=${c.id}`)}>
                <span className="cat-ico">{c.icon || '📚'}</span>
                <span style={{ flex: 1 }}>{pick(c.name)}</span>
                <span className="badge">{c.questionCount}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h2>{t('recentResults')}</h2>
        {!recent ? (
          <Spinner />
        ) : recent.length === 0 ? (
          <EmptyState />
        ) : (
          <table className="tbl">
            <thead><tr><th>{t('mode')}</th><th>{t('score')}</th><th>{t('correct')}</th><th>{t('totalTime')}</th><th /></tr></thead>
            <tbody>
              {recent.map((a) => (
                <tr key={a.id}>
                  <td>{a.mode}</td>
                  <td><strong>{a.score}</strong> / {a.max_score}</td>
                  <td>{a.correct_count}</td>
                  <td>{a.server_duration_ms ? fmtMs(a.server_duration_ms) : '—'}</td>
                  <td><Link to={`/review/${a.id}`}>{t('reviewAnswers')}</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
