import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { del, get, patch, post } from '../api';
import { Avatar, EmptyState, ErrorState, Field, Spinner, StatBox, ToggleChip, fmtMs, useAction, useAsync, useToast } from '../components';
import { useAuth } from '../ctx';
import { useI18n, type Lang } from '../i18n';
import { useTheme } from '../ctx';
import { autoAdvanceEnabled, largeTextEnabled, setAutoAdvance, setLargeText, setSoundsEnabled, soundsEnabled } from '../sounds';

export function PublicProfilePage() {
  const { t } = useI18n();
  const { username } = useParams();
  type Profile = {
    user: { username: string; displayName: string; level: number; xp: number; totalPoints: number; currentStreak: number; longestStreak: number };
    stats: { quizzesCompleted: number; questionsAnswered: number; correct: number; accuracy: number; bestScore: number; globalRank: number };
    achievements: Array<{ slug: string; name: unknown; icon: string; earned_at: string }>;
  };
  const { data, error, reload } = useAsync(() => get<Profile>(`/users/${username}`), [username]);
  const { pick } = useI18n();

  if (error) return <div className="page narrow"><div className="card"><ErrorState error={error} onRetry={reload} /></div></div>;
  if (!data) return <Spinner />;
  return (
    <div className="page narrow">
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
  type Stats = {
    stats: {
      quizzesCompleted: number; questionsAnswered: number; correct: number; incorrect: number; timeouts: number;
      skipped: number; accuracy: number; averageTimeMs: number; bestScore: number; perfectQuizzes: number;
      bestCategory: { name: unknown; accuracy: number } | null; weakestCategory: { name: unknown; accuracy: number } | null;
      categories: Array<{ id: string; name: unknown; answered: number; correct: number; accuracy: number }>;
    } | null;
    activity: Array<{ day: string; quizzes: number; questions: number; correct: number; points: number }>;
  };
  const { data, error, reload } = useAsync(() => get<Stats>('/stats/me'), []);

  if (error) return <div className="page wide"><h1>📊 {t('stats')}</h1><div className="card"><ErrorState error={error} onRetry={reload} /></div></div>;
  if (!data) return <Spinner />;
  if (!data.stats) return <div className="page wide"><h1>📊 {t('stats')}</h1><div className="card"><EmptyState /></div></div>;
  const s = data.stats;
  const maxQ = Math.max(...data.activity.map((a) => a.questions), 1);

  return (
    <div className="page wide">
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
          <div className="sparkbars" role="img" aria-label={data.activity.map((a) => `${a.day}: ${a.questions}`).join(', ')}>
            {data.activity.map((a) => (
              <span key={a.day} title={`${a.day}: ${a.questions} ${t('questions')}, ${a.points} ${t('points')}`} style={{ height: `${(a.questions / maxQ) * 100}%` }} />
            ))}
          </div>
        </div>
      )}
      {s.categories.length > 0 && (
        <div className="card">
          <h2>{t('categories')}</h2>
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>{t('category')}</th><th>{t('answered')}</th><th>{t('correct')}</th><th>{t('accuracy')}</th></tr></thead>
            <tbody>
              {s.categories.map((c) => (
                <tr key={c.id}><td>{pick(c.name)}</td><td>{c.answered}</td><td>{c.correct}</td><td><strong>{c.accuracy}%</strong></td></tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}
    </div>
  );
}

export function AchievementsPage() {
  const { t, pick } = useI18n();
  type Achievement = { id: string; slug: string; name: unknown; description: unknown; icon: string; xpReward: number; earned: boolean };
  const { data: list, error, reload } = useAsync(() => get<{ achievements: Achievement[] }>('/achievements').then((r) => r.achievements), []);
  if (error) return <div className="page"><h1>🏅 {t('achievements')}</h1><div className="card"><ErrorState error={error} onRetry={reload} /></div></div>;
  if (!list) return <Spinner />;
  return (
    <div className="page">
      <h1>🏅 {t('achievements')}</h1>
      {list.length === 0 ? <div className="card"><EmptyState /></div> : (
      <div className="grid cols-3">
        {list.map((a) => (
          <div key={a.id} className="card center" style={{ opacity: a.earned ? 1 : 0.55 }}>
            <div style={{ fontSize: 34 }} aria-hidden="true">{a.earned ? a.icon || '🏅' : '🔒'}</div>
            <h3>{pick(a.name)}</h3>
            <p className="muted" style={{ margin: '2px 0 6px' }}>{pick(a.description)}</p>
            <span className={`badge ${a.earned ? 'success' : ''}`}>{a.earned ? `✓ ${t('completed')}` : `+${a.xpReward} XP`}</span>
          </div>
        ))}
      </div>
      )}
    </div>
  );
}

export function NotificationsPage() {
  const { t, pick } = useI18n();
  type Notifications = { notifications: Array<{ id: string; kind: string; title: unknown; body: unknown; read_at: string | null; created_at: string }>; unreadCount: number };
  const { data, error, reload } = useAsync(async () => {
    const d = await get<Notifications>('/notifications?limit=50');
    if (d.unreadCount > 0) await post('/notifications/read', {}).catch(() => undefined);
    return d;
  }, []);
  if (error) return <div className="page narrow"><h1>🔔 {t('notifications')}</h1><div className="card"><ErrorState error={error} onRetry={reload} /></div></div>;
  if (!data) return <Spinner />;
  return (
    <div className="page narrow">
      <h1>🔔 {t('notifications')}</h1>
      <div className="card">
        {data.notifications.length === 0 ? <EmptyState /> : (
          <div className="stack">
            {data.notifications.map((n) => (
              <div key={n.id} className="list-row" style={{ display: 'block', opacity: n.read_at ? 0.7 : 1 }}>
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
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [delPw, setDelPw] = useState('');
  const [saveProfile, savingProfile] = useAction(async () => {
    await patch('/users/me', { displayName: displayName.trim(), country: country.toUpperCase() || '', language: lang, avatar });
    await refreshUser();
    toast(`✓ ${t('saved')}`);
  });
  const [changePw, changingPw] = useAction(async () => {
    await post('/auth/change-password', { currentPassword: pw.current, newPassword: pw.next });
    setPw({ current: '', next: '', confirm: '' });
    toast(`✓ ${t('saved')}`);
  });
  const [deleteAccount, deleting] = useAction(async () => {
    if (!window.confirm(`${t('deleteAccount')}?`)) return;
    await del('/auth/account', { password: delPw });
    await logout();
    nav('/login');
  });

  if (!user) return <Spinner />;
  const countryOk = country === '' || /^[A-Za-z]{2}$/.test(country);
  const pwMismatch = pw.confirm.length > 0 && pw.confirm !== pw.next;

  return (
    <div className="page narrow">
      <h1>⚙️ {t('settings')}</h1>
      <div className="card">
        <h2>{t('profile')}</h2>
        <form className="stack" onSubmit={(e) => { e.preventDefault(); void saveProfile(); }}>
          <Field label={t('displayName')}>{(id) => <input id={id} value={displayName} maxLength={60} onChange={(e) => setDisplayName(e.target.value)} />}</Field>
          <Field label={t('country')} hint={t('countryHint')} error={countryOk ? undefined : t('countryHint')}>
            {(id, describedBy) => <input id={id} aria-describedby={describedBy} value={country} onChange={(e) => setCountry(e.target.value)} maxLength={2} pattern="[A-Za-z]{2}" placeholder="SA" style={{ maxWidth: 120 }} />}
          </Field>
          <div role="radiogroup" aria-label={t('avatarPick')}>
            <span className="fld" style={{ display: 'block' }}>{t('avatarPick')}</span>
            <div className="emoji-grid">
              {AVATAR_EMOJIS.map((e) => (
                <button key={e} type="button" role="radio" aria-checked={avatar === e} className={avatar === e ? 'selected' : ''} onClick={() => setAvatar(avatar === e ? '' : e)} aria-label={`${t('avatarPick')} ${e}`}>
                  {e}
                </button>
              ))}
            </div>
          </div>
          <button className="btn" type="submit" disabled={savingProfile || !countryOk}>{t('save')}</button>
        </form>
      </div>
      <div className="card">
        <h2>{t('language')} / {t('theme')}</h2>
        <div className="row">
          <select aria-label={t('language')} value={lang} onChange={(e) => setLang(e.target.value as Lang)} style={{ maxWidth: 160 }}>
            <option value="en">English</option>
            <option value="ar">العربية</option>
          </select>
          <button className="btn secondary" onClick={toggle}>{theme === 'light' ? `🌙 ${t('dark')}` : `☀️ ${t('light')}`}</button>
          <ToggleChip checked={sounds} onChange={(v) => { setSounds(v); setSoundsEnabled(v); }}>🔔 {t('sound')}</ToggleChip>
          <ToggleChip checked={largeText} onChange={(v) => { setLargeTextState(v); setLargeText(v); }}>🔍 {t('largeText')}</ToggleChip>
          <ToggleChip checked={autoAdv} onChange={(v) => { setAutoAdv(v); setAutoAdvance(v); }}>⏭️ {t('autoAdvance')}</ToggleChip>
        </div>
      </div>
      {!user.isGuest && (
        <div className="card">
          <h2>{t('changePassword')}</h2>
          <form className="stack" onSubmit={(e) => { e.preventDefault(); void changePw(); }}>
            <Field label={t('currentPassword')}>{(id) => <input id={id} type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw((p) => ({ ...p, current: e.target.value }))} required />}</Field>
            <Field label={t('newPassword')} hint={t('passwordHint')}>
              {(id, describedBy) => <PasswordInput id={id} describedBy={describedBy} value={pw.next} onChange={(v) => setPw((p) => ({ ...p, next: v }))} autoComplete="new-password" withMeter />}
            </Field>
            <Field label={t('confirmPassword')} error={pwMismatch ? t('passwordsMismatch') : undefined}>
              {(id, describedBy) => <input id={id} aria-describedby={describedBy} type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw((p) => ({ ...p, confirm: e.target.value }))} required minLength={8} />}
            </Field>
            <button className="btn" type="submit" disabled={changingPw || !pw.current || pw.next.length < 8 || pw.next !== pw.confirm}>{t('changePassword')}</button>
          </form>
        </div>
      )}
      <div className="card">
        <h2 className="error-text">{t('deleteAccount')}</h2>
        <form className="stack" onSubmit={(e) => { e.preventDefault(); void deleteAccount(); }}>
          {!user.isGuest && <Field label={t('password')}>{(id) => <input id={id} type="password" autoComplete="current-password" value={delPw} onChange={(e) => setDelPw(e.target.value)} required />}</Field>}
          <button className="btn danger" type="submit" disabled={deleting || (!user.isGuest && !delPw)}>{t('deleteAccount')}</button>
        </form>
      </div>
    </div>
  );
}


/** Password input with show/hide toggle and an optional strength meter (length + character classes). */
export function passwordStrength(pw: string): 'weak' | 'fair' | 'strong' {
  if (pw.length < 8) return 'weak';
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^\w\s]/].filter((r) => r.test(pw)).length;
  if (pw.length >= 12 && classes >= 3) return 'strong';
  return classes >= 2 ? 'fair' : 'weak';
}

export function PasswordInput({ id, describedBy, value, onChange, autoComplete, withMeter, required = true }: {
  id: string; describedBy?: string; value: string; onChange: (v: string) => void; autoComplete: string; withMeter?: boolean; required?: boolean;
}) {
  const { t } = useI18n();
  const [show, setShow] = useState(false);
  const strength = passwordStrength(value);
  return (
    <div>
      <div className="pw-field">
        <input id={id} aria-describedby={describedBy} type={show ? 'text' : 'password'} autoComplete={autoComplete} value={value} onChange={(e) => onChange(e.target.value)} required={required} minLength={8} />
        <button type="button" className="btn ghost sm eye" onClick={() => setShow((v) => !v)} aria-label={show ? t('hidePassword') : t('showPassword')} aria-pressed={show}>{show ? '🙈' : '👁'}</button>
      </div>
      {withMeter && value.length > 0 && (
        <div className={`pw-meter ${strength}`} role="meter" aria-valuemin={0} aria-valuemax={3} aria-valuenow={strength === 'weak' ? 1 : strength === 'fair' ? 2 : 3} aria-label={`${t('passwordStrength')}: ${t(strength)}`}>
          <span />
        </div>
      )}
    </div>
  );
}
