import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError, get, post, setTokens, hasSession, storageGet, storageSet } from './api';

export interface User {
  id: string;
  email: string | null;
  username: string;
  displayName: string;
  role: 'user' | 'moderator' | 'editor' | 'admin' | 'super_admin';
  isGuest: boolean;
  avatar: string;
  language: string;
  country: string;
  xp: number;
  level: number;
  totalPoints: number;
  currentStreak: number;
  longestStreak: number;
  streakFreezes: number;
  plan: string;
  emailVerified: boolean;
}

interface AuthCtx {
  user: User | null;
  loading: boolean;
  /** bootstrap failed for a reason other than "not signed in" (network / 5xx / timeout) — the session is kept */
  error: unknown;
  setAuth: (user: User, access: string, refresh: string) => void;
  refreshUser: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthCtx>(null as never);

const BOOT_TIMEOUT_MS = 15_000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  // true once a user has been resolved: later refreshes (after a quiz, a profile save) must not
  // flip the whole app back to the bootstrap skeleton or block it behind an error card
  const bootedRef = useRef(false);

  const refreshUser = useCallback(async () => {
    if (!hasSession()) {
      setUser(null);
      setError(null);
      setLoading(false);
      return;
    }
    const boot = !bootedRef.current;
    if (boot) { setLoading(true); setError(null); }
    let timer: number | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = window.setTimeout(() => reject(new ApiError(0, 'network', 'Timed out')), BOOT_TIMEOUT_MS);
    });
    try {
      const res = await Promise.race([get<{ user: User }>('/users/me'), timeout]);
      bootedRef.current = true;
      setUser(res.user);
      setError(null);
    } catch (err) {
      // 401 = the session is really gone; anything else (offline, 5xx, timeout) keeps the tokens and offers a retry
      if (err instanceof ApiError && err.status === 401) {
        setTokens(null, null);
        bootedRef.current = false;
        setUser(null);
      } else if (boot) {
        setError(err);
      }
    } finally {
      window.clearTimeout(timer);
      if (boot) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshUser();
    const onExpired = () => { bootedRef.current = false; setUser(null); };
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, [refreshUser]);

  const value = useMemo<AuthCtx>(
    () => ({
      user,
      loading,
      error,
      setAuth: (u, access, refresh) => {
        setTokens(access, refresh);
        bootedRef.current = true;
        setUser(u);
        setError(null);
      },
      refreshUser,
      logout: async () => {
        try {
          await post('/auth/logout', {});
        } catch {
          /* best effort */
        }
        setTokens(null, null);
        bootedRef.current = false;
        setUser(null);
        setError(null);
      },
    }),
    [user, loading, error, refreshUser],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

export type Theme = 'light' | 'dark' | 'system';
interface ThemeCtx {
  theme: Theme;
  setTheme: (t: Theme) => void;
}
const ThemeContext = createContext<ThemeCtx>(null as never);

function readTheme(): Theme {
  const saved = storageGet('theme');
  return saved === 'light' || saved === 'dark' ? saved : 'system';
}

/** Explicit choice stamps data-theme; "system" removes it so `prefers-color-scheme` decides. */
export function applyTheme(theme: Theme): void {
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readTheme);
  useEffect(() => { applyTheme(theme); }, [theme]);
  const value = useMemo<ThemeCtx>(() => ({
    theme,
    setTheme: (next) => {
      storageSet('theme', next);
      setThemeState(next);
    },
  }), [theme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
