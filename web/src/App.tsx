import { useEffect, useState, type ReactNode } from 'react';
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { IS_DEMO, get } from './api';
import { ToastProvider } from './components';
import { AuthProvider, ThemeProvider, useAuth, useTheme } from './ctx';
import { I18nProvider, useI18n, type Lang } from './i18n';
import { AdminPage } from './pages/admin';
import { ForgotPage, LoginPage, RegisterPage } from './pages/auth';
import { HomePage } from './pages/home';
import { PlayPage, ReviewPage } from './pages/quiz';
import { AchievementsPage, NotificationsPage, PublicProfilePage, SettingsPage, StatsPage } from './pages/profile';
import {
  ChallengeDetailPage, ChallengesPage, FriendsPage, GroupDetailPage, GroupsPage,
  LeaderboardPage, MonthlyPage, TournamentDetailPage, TournamentsPage,
} from './pages/social';

function TopBar() {
  const { t, lang, setLang } = useI18n();
  const { theme, toggle } = useTheme();
  const { user, logout } = useAuth();
  const [unread, setUnread] = useState(0);
  const location = useLocation();

  useEffect(() => {
    if (!user) return;
    void get<{ unreadCount: number }>('/notifications?limit=1').then((r) => setUnread(r.unreadCount)).catch(() => undefined);
  }, [user, location.pathname]);

  if (!user) return null;
  const links: Array<[string, string]> = IS_DEMO
    ? [
        ['/', t('home')], ['/play', t('play')], ['/leaderboard', t('leaderboard')],
        ['/stats', t('stats')], ['/achievements', t('achievements')],
      ]
    : [
        ['/', t('home')], ['/play', t('play')], ['/leaderboard', t('leaderboard')],
        ['/challenges', t('challenges')], ['/tournaments', t('tournaments')], ['/groups', t('groups')], ['/friends', t('friends')],
        ['/stats', t('stats')], ['/achievements', t('achievements')],
      ];
  return (
    <header className="topbar">
      <Link to="/" className="brand">🧠 <span>{t('appName')}</span></Link>
      <nav aria-label="main">
        {links.map(([to, label]) => (
          <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>{label}</NavLink>
        ))}
        {user.role !== 'user' && !user.isGuest && (
          <NavLink to="/admin" className={({ isActive }) => (isActive ? 'active' : '')}>{t('admin')}</NavLink>
        )}
      </nav>
      <span className="spacer" />
      <NavLink to="/notifications" aria-label={t('notifications')} className="btn ghost sm">
        🔔{unread > 0 && <span className="badge danger">{unread}</span>}
      </NavLink>
      <button className="btn ghost sm" onClick={() => setLang((lang === 'en' ? 'ar' : 'en') as Lang)} aria-label={t('language')}>
        {lang === 'en' ? 'ع' : 'EN'}
      </button>
      <button className="btn ghost sm" onClick={toggle} aria-label={t('theme')}>{theme === 'light' ? '🌙' : '☀️'}</button>
      <NavLink to="/settings" className="btn ghost sm" aria-label={t('settings')}>⚙️</NavLink>
      <button className="btn secondary sm" onClick={() => void logout()}>{t('logout')}</button>
    </header>
  );
}

function Protected({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <span className="spin" />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function Shell() {
  const { user } = useAuth();
  const { t } = useI18n();
  return (
    <div className="app-shell">
      <TopBar />
      {IS_DEMO && user && (
        <div className="banner info" style={{ borderRadius: 0, textAlign: 'center', fontSize: 13 }}>
          🧪 {t('demoBanner')}{' '}
          <a href="https://github.com/daood40/quiz-app" target="_blank" rel="noreferrer">GitHub ↗</a>
        </div>
      )}
      <main className="main">
        <Routes>
          <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/forgot" element={<ForgotPage />} />
          <Route path="/" element={<Protected><HomePage /></Protected>} />
          <Route path="/play" element={<Protected><PlayPage /></Protected>} />
          <Route path="/review/:attemptId" element={<Protected><ReviewPage /></Protected>} />
          <Route path="/leaderboard" element={<Protected><LeaderboardPage /></Protected>} />
          <Route path="/challenges" element={<Protected><ChallengesPage /></Protected>} />
          <Route path="/challenges/:id" element={<Protected><ChallengeDetailPage /></Protected>} />
          <Route path="/monthly" element={<Protected><MonthlyPage /></Protected>} />
          <Route path="/friends" element={<Protected><FriendsPage /></Protected>} />
          <Route path="/groups" element={<Protected><GroupsPage /></Protected>} />
          <Route path="/groups/:id" element={<Protected><GroupDetailPage /></Protected>} />
          <Route path="/tournaments" element={<Protected><TournamentsPage /></Protected>} />
          <Route path="/tournaments/:id" element={<Protected><TournamentDetailPage /></Protected>} />
          <Route path="/stats" element={<Protected><StatsPage /></Protected>} />
          <Route path="/achievements" element={<Protected><AchievementsPage /></Protected>} />
          <Route path="/notifications" element={<Protected><NotificationsPage /></Protected>} />
          <Route path="/settings" element={<Protected><SettingsPage /></Protected>} />
          <Route path="/u/:username" element={<PublicProfilePage />} />
          <Route path="/admin/*" element={<Protected><AdminPage /></Protected>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <BrowserRouter basename={import.meta.env.BASE_URL}>
              <Shell />
            </BrowserRouter>
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </I18nProvider>
  );
}
