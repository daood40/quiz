import { Suspense, lazy, useEffect, useState, type ReactNode } from 'react';
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { IS_DEMO, get } from './api';
import { OfflineBanner, Spinner, ToastProvider } from './components';
import { AuthProvider, ThemeProvider, useAuth, useTheme } from './ctx';
import { I18nProvider, useI18n, type Lang } from './i18n';
import { ForgotPage, LoginPage, RegisterPage, VerifyEmailPage } from './pages/auth';
import { HomePage } from './pages/home';
import { PlayPage, ReviewPage } from './pages/quiz';
import { AchievementsPage, NotificationsPage, PublicProfilePage, SettingsPage, StatsPage } from './pages/profile';
import { Footer, NotFoundPage, PrivacyPage, TermsPage } from './pages/legal';

// route-level code splitting: staff and social surfaces are not shipped to every visitor
const AdminPage = lazy(() => import('./pages/admin').then((m) => ({ default: m.AdminPage })));
const social = () => import('./pages/social');
const LeaderboardPage = lazy(() => social().then((m) => ({ default: m.LeaderboardPage })));
const ChallengesPage = lazy(() => social().then((m) => ({ default: m.ChallengesPage })));
const ChallengeDetailPage = lazy(() => social().then((m) => ({ default: m.ChallengeDetailPage })));
const MonthlyPage = lazy(() => social().then((m) => ({ default: m.MonthlyPage })));
const FriendsPage = lazy(() => social().then((m) => ({ default: m.FriendsPage })));
const GroupsPage = lazy(() => social().then((m) => ({ default: m.GroupsPage })));
const GroupDetailPage = lazy(() => social().then((m) => ({ default: m.GroupDetailPage })));
const TournamentsPage = lazy(() => social().then((m) => ({ default: m.TournamentsPage })));
const TournamentDetailPage = lazy(() => social().then((m) => ({ default: m.TournamentDetailPage })));

const PRIMARY_TABS = new Set(['/', '/play', '/leaderboard', '/stats', '/achievements']);

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
      <nav aria-label={t('home')}>
        {links.map(([to, label]) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            // primary destinations move to the bottom tab bar on phones
            className={({ isActive }) => `${PRIMARY_TABS.has(to) ? 'pri' : ''} ${isActive ? 'active' : ''}`.trim()}
          >
            {label}
          </NavLink>
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

/** Mobile bottom tab bar (≤640px): app-like primary navigation. */
function TabBar() {
  const { t } = useI18n();
  const { user } = useAuth();
  if (!user) return null;
  const tabs: Array<[string, string, string]> = [
    ['/', '🏠', t('home')],
    ['/play', '🎯', t('play')],
    ['/leaderboard', '🏆', t('leaderboard')],
    ['/stats', '📊', t('stats')],
    ['/achievements', '🏅', t('achievements')],
  ];
  return (
    <nav className="tabbar" aria-label={t('play')}>
      {tabs.map(([to, icon, label]) => (
        <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
          <span className="ico" aria-hidden="true">{icon}</span>
          <span className="lbl">{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

function Protected({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <span className="spin" />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/** Service-worker update prompt (main.tsx dispatches `sw:update` when a new build is waiting). */
function UpdateBanner() {
  const { t } = useI18n();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const on = () => setReady(true);
    window.addEventListener('sw:update', on);
    return () => window.removeEventListener('sw:update', on);
  }, []);
  if (!ready) return null;
  return (
    <div className="banner info update-banner" role="status">
      <span>🆕 {t('updateAvailable')}</span>
      <button className="btn sm" onClick={() => window.dispatchEvent(new Event('sw:reload'))}>{t('reload')}</button>
    </div>
  );
}

function Shell() {
  const { user } = useAuth();
  const { t } = useI18n();
  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">{t('skipToContent')}</a>
      <TopBar />
      <OfflineBanner />
      <UpdateBanner />
      {IS_DEMO && user && (
        <div className="banner info" style={{ borderRadius: 0, textAlign: 'center', fontSize: 13 }}>
          🧪 {t('demoBanner')}{' '}
          <a href="https://github.com/daood40/quiz" target="_blank" rel="noreferrer">GitHub ↗</a>
        </div>
      )}
      <main className="main" id="main">
        <Suspense fallback={<div className="center" style={{ padding: 40 }}><Spinner /></div>}>
        <Routes>
          <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/forgot" element={<ForgotPage />} />
          <Route path="/verify" element={<VerifyEmailPage />} />
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
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
        </Suspense>
        <Footer />
      </main>
      <TabBar />
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
