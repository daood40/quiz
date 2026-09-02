import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ApiError, del, get, patch, post } from '../api';
import { Avatar, EmptyState, Spinner, StatBox, fmtMs, useToast } from '../components';
import { useAuth } from '../ctx';
import { useI18n, type Lang } from '../i18n';
import { useTheme } from '../ctx';
import { autoAdvanceEnabled, largeTextEnabled, setAutoAdvance, setLargeText, setSoundsEnabled, soundsEnabled } from '../sounds';

export function PublicProfilePage() {
  const { t } = useI18n();
  const { username } = useParams();
  const [data, setData] = useState<{
    user: { username: string; displayName: string; level: number; xp: number; totalPoints: number; currentStreak: number; longestStreak: number };
    stats: { quizzesCompleted: number; questionsAnswered: number; correct: number; accuracy: number; bestScore: number; globalRank: number };
    achievements: Array<{ slug: string; name: unknown; icon: string; earned_at: string }>;
  } | null>(null);
  const [error, setError] = useState('');
  const { pick } = useI18n();

  useEffect(() => {
    void get<NonNullable<typeof data>>(`/users/${username}`).then(setData).catch((e) => setError(e instanceof ApiError ? e.message : t('error')));
  }, [username, t]);

  if (error) return <p className="error-text center">{error}</p>;
  if (!data) return <Spinner />;
  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <div className="card center">
        <Avatar name={data.user.displayName || data.user.username} size="lg" />
        <h1>{data.user.displayName || data.user.username}</h1>
        <p className="muted">@{data.user.username}</p>
        <div className="row" style={{ justifyContent: 'center' }}>
          <span className="badge primary">{t('level')} {data.user.level}</span>
          <span className="badge">#{data.stats.globalRank}</span>
          <span className="badge warn">🔥 {data.user.currentStreak}</span>
        </div>
      </div>
      <div className="card">
        <div className="grid cols-4">
          <StatBox value={data.user.totalPoints.toLocaleString()} label={t('points')} />
          <StatBox value={data.stats.quizzesCompleted} label={t('quizzes')} />
          <StatBox value={`${data.stats.accuracy}%`} label={t('accuracy')} />
          <StatBox value={data.stats.bestScore} label={t('best')} />
        </div>
      </div>
      <div className="card">
        <h2>🏅 {t('achievements')}</h2>
        {data.achievements.length === 0 ? <EmptyState /> : (
          <div className="row">
            {data.achievements.map((a) => (
              <span key={a.slug} className="badge success" style={{ fontSize: 13, padding: '6px 12px' }}>{a.icon || '🏅'} {pick(a.name)}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function StatsPage() {
  const { t, pick } = useI18n();
  const [data, setData] = useState<{
    stats: {
      quizzesCompleted: number; questionsAnswered: number; correct: number; incorrect: number; timeouts: number;
      skipped: number; accuracy: number; averageTimeMs: number; bestScore: number; perfectQuizzes: number;
      bestCategory: { name: unknown; accuracy: number } | null; weakestCategory: { name: unknown; accuracy: number } | null;
      categories: Array<{ id: string; name: unknown; answered: number; correct: number; accuracy: number }>;
    } | null;
    activity: Array<{ day: string; quizzes: number; questions: number; correct: number; points: number }>;
  } | null>(null);

  useEffect(() => {
    void get<NonNullable<typeof data>>('/stats/me').then(setData).catch(() => undefined);
  }, []);

  if (!data) return <Spinner />;
  if (!data.stats) return <EmptyState />;
  const s = data.stats;
  const maxQ = Math.max(...data.activity.map((a) => a.questions), 1);

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <h1>📊 {t('stats')}</h1>
      <div className="card">
        <div className="grid cols-4">
          <StatBox value={s.quizzesCompleted} label={t('quizzes')} />
          <StatBox value={s.questionsAnswered} label={t('answered')} />
          <StatBox value={s.correct} label={t('correct')} />
          <StatBox value={`${s.accuracy}%`} label={t('accuracy')} />
          <StatBox value={fmtMs(s.averageTimeMs)} label={t('avgTime')} />
          <StatBox value={s.bestScore} label={t('best')} />
          <StatBox value={s.perfectQuizzes} label={t('perfect')} />
          <StatBox value={s.incorrect} label={t('incorrect')} />
        </div>
      </div>
      <div className="grid cols-2">
        {s.bestCategory && (
          <div className="card"><h3>💪 {t('bestCategory')}</h3><p>{pick(s.bestCategory.name)} — <strong>{s.bestCategory.accuracy}%</strong></p></div>
        )}
        {s.weakestCategory && (
          <div className="card"><h3>🎯 {t('weakestCategory')}</h3><p>{pick(s.weakestCategory.name)} — <strong>{s.weakestCategory.accuracy}%</strong></p></div>
        )}
      </div>
      {data.activity.length > 0 && (
        <div className="card">
          <h2>{t('activity')} (90d)</h2>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 110, overflowX: 'auto' }}>
            {data.activity.map((a) => (
              <div key={a.day} title={`${a.day}: ${a.questions} ${t('questions')}, ${a.points} ${t('points')}`}
                style={{ width: 10, minWidth: 6, flex: 1, height: `${(a.questions / maxQ) * 100}%`, background: 'var(--primary)', borderRadius: 3 }} />
            ))}
          </div>
        </div>
      )}
      {s.categories.length > 0 && (
        <div className="card">
          <h2>{t('categories')}</h2>
          <table className="tbl">
            <thead><tr><th>{t('category')}</th><th>{t('answered')}</th><th>{t('correct')}</th><th>{t('accuracy')}</th></tr></thead>
            <tbody>
              {s.categories.map((c) => (
                <tr key={c.id}><td>{pick(c.name)}</td><td>{c.answered}</td><td>{c.correct}</td><td><strong>{c.accuracy}%</strong></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function AchievementsPage() {
  const { t, pick } = useI18n();
  const [list, setList] = useState<Array<{ id: string; slug: string; name: unknown; description: unknown; icon: string; xpReward: number; earned: boolean }> | null>(null);
  useEffect(() => {
    void get<{ achievements: NonNullable<typeof list> }>('/achievements').then((r) => setList(r.achievements)).catch(() => setList([]));
  }, []);
  if (!list) return <Spinner />;
  return (
    <div style={{ maxWidth: 680, margin: '0 auto' }}>
      <h1>🏅 {t('achievements')}</h1>
      <div className="grid cols-3">
        {list.map((a) => (
          <div key={a.id} className="card center" style={{ opacity: a.earned ? 1 : 0.45 }}>
            <div style={{ fontSize: 34 }}>{a.icon || '🏅'}</div>
            <h3>{pick(a.name)}</h3>
            <span className={`badge ${a.earned ? 'success' : ''}`}>{a.earned ? '✓' : `+${a.xpReward} XP`}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function NotificationsPage() {
  const { t, pick } = useI18n();
  const [data, setData] = useState<{ notifications: Array<{ id: string; kind: string; title: unknown; body: unknown; read_at: string | null; created_at: string }>; unreadCount: number } | null>(null);
  useEffect(() => {
    void get<NonNullable<typeof data>>('/notifications').then(async (d) => {
      setData(d);
      if (d.unreadCount > 0) await post('/notifications/read', {});
    }).catch(() => undefined);
  }, []);
  if (!data) return <Spinner />;
  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      <h1>🔔 {t('notifications')}</h1>
      <div className="card">
        {data.notifications.length === 0 ? <EmptyState /> : (
          <div className="stack">
            {data.notifications.map((n) => (
              <div key={n.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)', opacity: n.read_at ? 0.7 : 1 }}>
                <strong>{pick(n.title)}</strong>
                <p className="muted" style={{ margin: '2px 0 0' }}>{pick(n.body)} · {new Date(n.created_at).toLocaleString()}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const AVATAR_EMOJIS = ['🦊', '🐼', '🦁', '🐸', '🦉', '🐙', '🦋', '🐢', '🐬', '🌟', '🚀', '🎯', '🧠', '⚡', '🌙', '🔥', '🍀', '🎨', '🎮', '🏆'];

export function SettingsPage() {
  const { t, lang, setLang } = useI18n();
  const { theme, toggle } = useTheme();
  const { user, refreshUser, logout } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [country, setCountry] = useState(user?.country ?? '');
  const [avatar, setAvatar] = useState(user?.avatar ?? '');
  const [sounds, setSounds] = useState(soundsEnabled());
  const [largeText, setLargeTextState] = useState(largeTextEnabled());
  const [autoAdv, setAutoAdv] = useState(autoAdvanceEnabled());
  const [pw, setPw] = useState({ current: '', next: '' });
  const [delPw, setDelPw] = useState('');

  if (!user) return <Spinner />;

  const saveProfile = async () => {
    try {
      await patch('/users/me', { displayName, country: country.toUpperCase() || '', language: lang, avatar });
      await refreshUser();
      toast('✓');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('error'));
    }
  };
  const changePw = async () => {
    try {
      await post('/auth/change-password', { currentPassword: pw.current, newPassword: pw.next });
      setPw({ current: '', next: '' });
      toast('✓');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('error'));
    }
  };
  const deleteAccount = async () => {
    if (!window.confirm(`${t('deleteAccount')}?`)) return;
    try {
      await del('/auth/account', { password: delPw });
      await logout();
      nav('/login');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('error'));
    }
  };

  return (
    <div style={{ maxWidth: 520, margin: '0 auto' }}>
      <h1>⚙️ {t('settings')}</h1>
      <div className="card">
        <h2>{t('profile')}</h2>
        <div className="stack">
          <div><label className="fld">{t('displayName')}</label><input value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></div>
          <div><label className="fld">{t('country')} (ISO-2)</label><input value={country} onChange={(e) => setCountry(e.target.value)} maxLength={2} placeholder="SA" /></div>
          <div>
            <label className="fld">{t('avatarPick')}</label>
            <div className="emoji-grid">
              {AVATAR_EMOJIS.map((e) => (
                <button key={e} type="button" className={avatar === e ? 'selected' : ''} onClick={() => setAvatar(avatar === e ? '' : e)} aria-label={e}>
                  {e}
                </button>
              ))}
            </div>
          </div>
          <button className="btn" onClick={saveProfile}>{t('save')}</button>
        </div>
      </div>
      <div className="card">
        <h2>{t('language')} / {t('theme')}</h2>
        <div className="row">
          <select value={lang} onChange={(e) => setLang(e.target.value as Lang)} style={{ maxWidth: 160 }}>
            <option value="en">English</option>
            <option value="ar">العربية</option>
          </select>
          <button className="btn secondary" onClick={toggle}>{theme === 'light' ? `🌙 ${t('dark')}` : `☀️ ${t('light')}`}</button>
          <label className={`chip ${sounds ? 'selected' : ''}`} style={{ userSelect: 'none' }}>
            <input
              type="checkbox"
              checked={sounds}
              onChange={(e) => {
                setSounds(e.target.checked);
                setSoundsEnabled(e.target.checked);
              }}
              style={{ width: 16, marginInlineEnd: 6 }}
            />
            🔔 {t('sound')}
          </label>
          <label className={`chip ${largeText ? 'selected' : ''}`} style={{ userSelect: 'none' }}>
            <input
              type="checkbox"
              checked={largeText}
              onChange={(e) => { setLargeTextState(e.target.checked); setLargeText(e.target.checked); }}
              style={{ width: 16, marginInlineEnd: 6 }}
            />
            🔍 {t('largeText')}
          </label>
          <label className={`chip ${autoAdv ? 'selected' : ''}`} style={{ userSelect: 'none' }}>
            <input
              type="checkbox"
              checked={autoAdv}
              onChange={(e) => { setAutoAdv(e.target.checked); setAutoAdvance(e.target.checked); }}
              style={{ width: 16, marginInlineEnd: 6 }}
            />
            ⏭️ {t('autoAdvance')}
          </label>
        </div>
      </div>
      {!user.isGuest && (
        <div className="card">
          <h2>{t('changePassword')}</h2>
          <div className="stack">
            <input type="password" placeholder={t('password')} value={pw.current} onChange={(e) => setPw((p) => ({ ...p, current: e.target.value }))} />
            <input type="password" placeholder="New password" value={pw.next} onChange={(e) => setPw((p) => ({ ...p, next: e.target.value }))} minLength={8} />
            <button className="btn" onClick={changePw} disabled={!pw.current || pw.next.length < 8}>{t('changePassword')}</button>
          </div>
        </div>
      )}
      <div className="card">
        <h2 className="error-text">{t('deleteAccount')}</h2>
        <div className="stack">
          {!user.isGuest && <input type="password" placeholder={t('password')} value={delPw} onChange={(e) => setDelPw(e.target.value)} />}
          <button className="btn danger" onClick={deleteAccount}>{t('deleteAccount')}</button>
        </div>
      </div>
    </div>
  );
}
