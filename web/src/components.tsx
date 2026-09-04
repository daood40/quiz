import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ApiError, get } from './api';
import { useI18n, type TKey } from './i18n';

export const Spinner = () => {
  const { t } = useI18n();
  return <span className="spin" role="status" aria-label={t('loading')} />;
};

/** Human message for any thrown error (network / demo-only / API) in the current language. */
export function errorMessage(err: unknown, t: (k: TKey) => string): string {
  if (err instanceof ApiError) {
    if (err.code === 'network') return t('networkError');
    if (err.code === 'demo_unavailable') return t('demoUnavailable');
    return err.message;
  }
  return t('error');
}

/** Error card with retry — every data view must use this instead of swallowing failures. */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useI18n();
  return (
    <div className="error-state" role="alert">
      <p>⚠️ {errorMessage(error, t)}</p>
      {onRetry && <button type="button" className="btn secondary sm" onClick={onRetry}>↻ {t('retry')}</button>}
    </div>
  );
}

/** Loads data with explicit loading / error / retry state. `deps` re-run the loader. */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[]): { data: T | null; error: unknown; loading: boolean; reload: () => void; setData: (d: T) => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    loaderRef.current().then((d) => { if (alive) { setData(d); setLoading(false); } })
      .catch((e) => { if (alive) { setError(e); setLoading(false); } });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  const reload = useCallback(() => setTick((x) => x + 1), []);
  return { data, error, loading, reload, setData };
}

/** Wraps an async mutation: disables the trigger while running and reports failures as a toast. */
export function useAction<A extends unknown[]>(fn: (...args: A) => Promise<unknown>): [(...args: A) => Promise<void>, boolean] {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const { t } = useI18n();
  const busyRef = useRef(false);
  const run = useCallback(async (...args: A) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await fn(...args);
    } catch (err) {
      toast(errorMessage(err, t));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [fn, toast, t]);
  return [run, busy];
}

/** Labelled form field: generates the id so the label is programmatically associated. */
export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: (id: string, describedBy?: string) => ReactNode }) {
  const id = useId();
  const hintId = hint || error ? `${id}-hint` : undefined;
  return (
    <div className="fld-group">
      <label className="fld" htmlFor={id}>{label}</label>
      {children(id, hintId)}
      {(error || hint) && <p id={hintId} className={error ? 'error-text field-hint' : 'muted field-hint'} aria-live="polite">{error || hint}</p>}
    </div>
  );
}

export function ToggleChip({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className={`chip toggle ${checked ? 'selected' : ''}`}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}

const STATUS_KEYS = new Set<string>(['open', 'active', 'expired', 'completed', 'pending_review', 'draft', 'approved', 'rejected', 'archived',
  'registration', 'running', 'walkover', 'cancelled', 'scheduled', 'submitted', 'in_progress', 'invited', 'member', 'owner', 'admin', 'moderator',
  'pending', 'suspended', 'banned', 'practice', 'timed', 'speed', 'survival', 'knowledge', 'review', 'daily', 'monthly', 'challenge', 'tournament', 'bookmarks']);
/** Translates a server enum (status / role / mode) when a label exists, otherwise returns it as-is. */
export function useStatusLabel(): (value: string | null | undefined) => string {
  const { t } = useI18n();
  return (value) => (value && STATUS_KEYS.has(value) ? t(value as TKey) : value ?? '');
}

export function OfflineBanner() {
  const online = useOnline();
  const { t } = useI18n();
  if (online) return null;
  return <div className="banner warn offline-banner" role="status">📡 {t('offline')}</div>;
}

export function EmptyState({ label }: { label?: string }) {
  const { t } = useI18n();
  return <p className="muted center" style={{ padding: 24 }}>{label ?? t('noData')}</p>;
}

export function Avatar({ name, avatar, size }: { name: string; avatar?: string; size?: 'lg' }) {
  // short avatar strings are emoji picks; anything else falls back to initials
  const emoji = avatar && avatar.length <= 8 ? avatar : '';
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  return <span className={`avatar ${size ?? ''}`}>{emoji || initial}</span>;
}

export function StatBox({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="stat">
      <div className="v">{value}</div>
      <div className="l">{label}</div>
    </div>
  );
}

export function fmtMs(ms: number): string {
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}:${String(s % 60).padStart(2, '0')}` : `${s}s`;
}

// ---- toasts ----
interface Toast { id: number; text: string }
const ToastContext = createContext<(text: string) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text }].slice(-2)); // keep the stack short
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toast-wrap" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast">{t.text}</div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
export const useToast = () => useContext(ToastContext);

// ---- question type registry mirror (id → family/flags) ----
export interface TypeSpec { id: string; family: string; scored: boolean; media: string }
let typeCache: Map<string, TypeSpec> | null = null;

// A failed registry load must never degrade every question to a plain choice list:
// keep retrying with backoff and surface the error so the player can retry explicitly.
export function useTypeSpecs(): { specs: Map<string, TypeSpec> | null; error: unknown; retry: () => void } {
  const [specs, setSpecs] = useState<Map<string, TypeSpec> | null>(typeCache);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (typeCache) return;
    let alive = true;
    let timer: number | undefined;
    void get<{ types: TypeSpec[] }>('/quizzes/question-types').then((res) => {
      typeCache = new Map(res.types.map((t) => [t.id, t]));
      if (alive) { setSpecs(typeCache); setError(null); }
    }).catch((e) => {
      if (!alive) return;
      setError(e);
      timer = window.setTimeout(() => setAttempt((a) => a + 1), Math.min(30_000, 2_000 * 2 ** attempt));
    });
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [attempt]);
  return { specs, error, retry: () => setAttempt((a) => a + 1) };
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}
