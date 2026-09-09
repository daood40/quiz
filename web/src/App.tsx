import { Suspense, lazy, useEffect, useState, type ReactNode } from 'react';
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { IS_DEMO, get } from './api';
import { ErrorBoundary, ErrorState, Skeleton, ToastProvider, OfflineBanner } from './components';
import { AuthProvider, ThemeProvider, useAuth } from './ctx';
import { I18nProvider, useI18n, type Lang, type TKey } from './i18n';
import { ForgotPage, LoginPage, RegisterPage, VerifyEmailPage } from './pages/auth';
import { HomePage } from './pages/home';
import { AchievementsPage, NotificationsPage, PublicProfilePage, SettingsPage, StatsPage } from './pages/profile';
import { AccountDeletionPage, Footer, HelpPage, NotFoundPage, PrivacyPage, TermsPage } from './pages/legal';

// route-level code splitting: staff and social surfaces are not shipped to every visitor
const AdminPage = lazy(() => import('./pages/admin').then((m) => ({ default: m.AdminPage })));
const quiz = () => import('./pages/quiz');
const PlayPage = lazy(() => quiz().then((m) => ({ default: m.PlayPage })));
const ReviewPage = lazy(() => quiz().then((m) => ({ default: m.ReviewPage })));

/** Per-route document metadata: title, canonical URL and robots directive (SPA, so it must be set at runtime). */
const PUBLIC_ROUTES: Record<string, TKey> = { '/': 'home', '/privacy': 'privacy', '/terms': 'terms', '/help': 'help', '/delete-account': 'deleteAccountPage' };
const PRIVATE_ROUTES: Record<string, TKey> = {
  '/login': 'login', '/register': 'register', '/forgot': 'forgotTitle', '/verify': 'verifyEmail',
  '/play': 'play', '/leaderboard': 'leaderboard', '/challenges': 'challenges', '/monthly': 'monthly',
  '/friends': 'friends', '/groups': 'groups', '/tournaments': 'tournaments', '/stats': 'stats',
  '/achievements': 'achievements', '/notifications': 'notifications', '/settings': 'settings', '/admin': 'admin',
  '/review': 'review', '/u': 'profile',
};
function RouteMeta() {
  const { pathname } = useLocation();
  const { t, lang } = useI18n();
  useEffect(() => {
    const first = '/' + pathname.split('/')[1];
    const pub = PUBLIC_ROUTES[pathname];
    const priv = PRIVATE_ROUTES[first];
    const key = pub ?? priv ?? 'notFoundTitle';
    document.title = pathname === '/' ? 'Quiz Platform' : `${t(key)} · Quiz Platform`;
    const base = (import.meta.env.BASE_URL as string) || '/';
    const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    // whichever host serves this build (Pages under /quiz/, or the API origin) is the canonical one
    if (canonical) canonical.href = window.location.origin + base.replace(/\/$/, '') + (pub ? pathname : '/');
    let robots = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (!robots) { robots = document.createElement('meta'); robots.name = 'robots'; document.head.appendChild(robots); }
    robots.content = pub ? 'index,follow' : 'noindex,nofollow';
  }, [pathname, t, lang]);
  return null;
}
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

function TopBar() {
  const { t, lang, setLang } = useI18n();
  const { user, loading, error, logout } = useAuth();
  const [unread, setUnread] = useState(0);
  const location = useLocation();

  useEffect(() => {
    if (!user) return;
    void get<{ unreadCount: number }>('/notifications?limit=1').then((r) => setUnread(r.unreadCount)).catch(() => undefined);
  }, [user, location.pathname]);

  // the shell stays visible while the session resolves (or failed to), so the page never collapses to a lone spinner
  if (!user && !loading && !error) return null;
  // primary destinations (`pri`) live in the bottom tab bar on phones and only show here on wide screens;
  // the top bar itself carries the four social destinations + admin
  const primary: Array<[string, string]> = [
    ['/', t('home')], ['/play', t('play')], ['/leaderboard', t('leaderboard')], ['/stats', t('stats')], ['/achievements', t('achievements')],
  ];
  const secondary: Array<[string, string]> = IS_DEMO
    ? []
    : [['/challenges', t('challenges')], ['/tournaments', t('tournaments')], ['/groups', t('groups')], ['/friends', t('friends')]];
  return (
    <header className="topbar">
      <Link to="/" className="brand">🧠 <span>{t('appName')}</span></Link>
      {user && (
        <nav aria-label={t('mainNav')}>
          {primary.map(([to, label]) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `pri ${isActive ? 'active' : ''}`.trim()}>{label}</NavLink>
          ))}
          {secondary.map(([to, label]) => (
            <NavLink key={to} to={to} className={({ isActive }) => (isActive ? 'active' : '')}>{label}</NavLink>
          ))}
          {user.role !== 'user' && !user.isGuest && (
            <NavLink to="/admin" className={({ isActive }) => (isActive ? 'active' : '')}>{t('admin')}</NavLink>
          )}
        </nav>
      )}
      {user && (
        <NavLink to="/notifications" aria-label={t('notifications')} className="btn ghost sm">
          🔔{unread > 0 && <span className="badge danger">{unread}</span>}
        </NavLink>
      )}
      <button type="button" className="btn ghost sm" onClick={() => setLang((lang === 'en' ? 'ar' : 'en') as Lang)} aria-label={t('language')}>
        {lang === 'en' ? 'ع' : 'EN'}
      </button>
      {user && <NavLink to="/settings" className="btn ghost sm" aria-label={t('settings')}>⚙️</NavLink>}
      {user && <button type="button" className="btn secondary sm" onClick={() => void logout()}>{t('logout')}</button>}
    </header>
  );
}

/** Mobile bottom tab bar (≤640px): app-like primary navigation. */
function TabBar() {
  const { t } = useI18n();
  const { user, loading, error } = useAuth();
  if (!user && !loading && !error) return null;
  const tabs: Array<[string, string, string]> = [
    ['/', '🏠', t('home')],
    ['/play', '🎯', t('play')],
    ['/leaderboard', '🏆', t('leaderboard')],
    ['/stats', '📊', t('stats')],
    ['/achievements', '🏅', t('achievements')],
  ];
  return (
    <nav className="tabbar" aria-label={t('primaryTabs')}>
      {tabs.map(([to, icon, label]) => (
        <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
          <span className="ico" aria-hidden="true">{icon}</span>
          <span className="lbl">{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

/** Skeleton while the session resolves; after 6s tells the user it is still working (slow network, not a hang). */
function AuthPending() {
  const { t } = useI18n();
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setSlow(true), 6_000);
    return () => window.clearTimeout(id);
  }, []);
  return (
    <div className="route-fallback" aria-busy="true">
      <Skeleton />
      <p className="muted center" role="status">{slow ? t('stillLoading') : t('loadingApp')}</p>
    </div>
  );
}

function Protected({ children }: { children: ReactNode }) {
  const { user, loading, error, refreshUser } = useAuth();
  const { t } = useI18n();
  if (loading) return <AuthPending />;
  if (error && !user) {
    // network / server failure: the tokens are kept, the user only needs to retry
    return (
      <div className="card">
        <ErrorState error={error} onRetry={() => void refreshUser()} />
        <p className="muted center">{t('sessionKept')}</p>
      </div>
    );
  }
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
      <button type="button" className="btn sm" onClick={() => window.dispatchEvent(new Event('sw:reload'))}>{t('reload')}</button>
    </div>
  );
}

function Shell() {
  const { user } = useAuth();
  const { t } = useI18n();
  const { pathname } = useLocation();
  return (
    <div className="app-shell">
      <RouteMeta />
      <a href="#main" className="skip-link">{t('skipToContent')}</a>
      <TopBar />
      <OfflineBanner />
      <UpdateBanner />
      {IS_DEMO && user && (
        <div className="banner info demo-banner">
          🧪 {t('demoBanner')}{' '}
          <a href="https://github.com/daood40/quiz" target="_blank" rel="noreferrer">GitHub ↗</a>
        </div>
      )}
      <main className="main" id="main" tabIndex={-1}>
        {/* keyed on the path so a crash on one screen clears when the user navigates away */}
        <ErrorBoundary key={pathname}>
        <Suspense fallback={<div className="route-fallback"><Skeleton /></div>}>
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
          <Route path="/help" element={<HelpPage />} />
          <Route path="/delete-account" element={<AccountDeletionPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
        </Suspense>
        </ErrorBoundary>
      </main>
      <Footer />
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
