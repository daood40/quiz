import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { get, post, setTokens, hasSession } from './api';

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
  setAuth: (user: User, access: string, refresh: string) => void;
  refreshUser: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthCtx>(null as never);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    if (!hasSession()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const res = await get<{ user: User }>('/users/me');
      setUser(res.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshUser();
    const onExpired = () => setUser(null);
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, [refreshUser]);

  const value = useMemo<AuthCtx>(
    () => ({
      user,
      loading,
      setAuth: (u, access, refresh) => {
        setTokens(access, refresh);
        setUser(u);
      },
      refreshUser,
      logout: async () => {
        try {
          await post('/auth/logout', {});
        } catch {
          /* best effort */
        }
        setTokens(null, null);
        setUser(null);
      },
    }),
    [user, loading, refreshUser],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

type Theme = 'light' | 'dark';
interface ThemeCtx {
  theme: Theme;
  toggle: () => void;
}
const ThemeContext = createContext<ThemeCtx>(null as never);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem('theme') as Theme | null;
    if (saved) return saved;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('theme', theme);
  }, [theme]);
  const value = useMemo(() => ({ theme, toggle: () => setTheme((t) => (t === 'light' ? 'dark' : 'light')) }), [theme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
