import { Component, createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, get } from './api';
import { useI18n, type Lang, type TKey } from './i18n';
import { useTx } from './i18n';

/** Loading state. Defaults to a layout-shaped skeleton (3 rows); `inline` keeps the small spinner for buttons/inline use. */
export const Spinner = ({ rows = 3, inline = false }: { rows?: number; inline?: boolean }) => {
  const { t } = useI18n();
  if (inline) return <span className="spin" role="status" aria-label={t('loading')} />;
  return (
    <div className="skeleton-stack" role="status" aria-label={t('loading')} aria-busy="true">
      {Array.from({ length: rows }, (_, i) => <span key={i} className="skeleton" style={{ width: `${100 - (i % 3) * 14}%` }} />)}
    </div>
  );
};

/** Maps a server error (code from server/src/core/errors.ts + module-specific codes) to a translated key. */
function errorKey(err: ApiError): TKey | null {
  const msg = err.message.toLowerCase();
  switch (err.code) {
    case 'network': return 'networkError';
    case 'demo_unavailable': return 'demoUnavailable';
    case 'unauthorized': return /credential|password/.test(msg) ? 'err_bad_credentials' : 'err_unauthorized';
    case 'forbidden':
      if (/maintenance/.test(msg)) return 'err_maintenance';
      if (/banned|suspended|not active/.test(msg)) return 'err_account_blocked';
      return 'err_forbidden';
    case 'not_found': return 'err_not_found';
    case 'conflict': return 'err_conflict';
    case 'bad_request':
    case 'validation_error': return 'err_validation';
    case 'rate_limited':
    case 'too_many_attempts':
    case 'ai_quota_user':
    case 'ai_quota_platform': return 'err_rate_limited';
    case 'ai_disabled': return 'err_ai_disabled';
    case 'internal_error':
    case 'ai_provider_error': return 'err_server';
  }
  if (err.status >= 500) return 'err_server';
  if (err.status === 429) return 'err_rate_limited';
  if (err.status === 401) return 'err_unauthorized';
  if (err.status === 403) return 'err_forbidden';
  if (err.status === 404) return 'err_not_found';
  return null;
}

/**
 * Human message for any thrown error (network / demo-only / API) in the current language.
 * Raw server messages (English) are only shown in English, and only for 4xx errors whose message is already
 * user-facing; Arabic always gets the translated mapping.
 */
export function errorMessage(err: unknown, t: (k: TKey) => string, lang?: Lang): string {
  if (!(err instanceof ApiError)) return t('error');
  const key = errorKey(err);
  const isArabic = (lang ?? (typeof document !== 'undefined' ? document.documentElement.lang : 'en')) === 'ar';
  const specific = err.message && !/^request failed/i.test(err.message) ? err.message : '';
  if (!isArabic && specific && err.status >= 400 && err.status < 500) return specific;
  return key ? t(key) : t('error');
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

/**
 * Empty state = what this screen will hold + why it is empty + the next action.
 * `label` (legacy single string) and `body` are equivalent; `action.to` renders a link, `action.onClick` a button.
 */
export function EmptyState({ label, title, body, icon, action }: {
  label?: string;
  title?: string;
  body?: string;
  icon?: string;
  action?: { label: string; to?: string; onClick?: () => void };
}) {
  const { t } = useI18n();
  const text = body ?? label ?? (title ? undefined : t('noData'));
  return (
    <div className="empty-state" role="status">
      {icon && <span className="empty-icon" aria-hidden="true">{icon}</span>}
      {title && <p className="empty-title">{title}</p>}
      {text && <p className="empty-body muted">{text}</p>}
      {action && (action.to
        ? <Link className="btn empty-action" to={action.to}>{action.label}</Link>
        : <button type="button" className="btn empty-action" onClick={action.onClick}>{action.label}</button>)}
    </div>
  );
}

/** Route-level loading placeholder: layout-shaped skeleton instead of a lone spinner. */
export const Skeleton = ({ rows = 4 }: { rows?: number }) => <Spinner rows={rows} />;

function BoundaryFallback({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n();
  const tx = useTx();
  return (
    <div className="card error-state" role="alert">
      <p>⚠️ {t('error')}</p>
      <p className="muted">{tx('crashHint')}</p>
      <div className="row">
        <button type="button" className="btn secondary sm" onClick={onRetry}>↻ {t('retry')}</button>
        <button type="button" className="btn sm" onClick={() => window.location.reload()}>{tx('reloadPage')}</button>
      </div>
    </div>
  );
}

/** Catches render crashes below it and shows a retry card instead of a blank screen. */
export class ErrorBoundary extends Component<{ children: ReactNode; fallback?: (retry: () => void) => ReactNode }, { error: unknown }> {
  state = { error: null as unknown };
  static getDerivedStateFromError(error: unknown) { return { error }; }
  componentDidCatch(error: unknown, info: ErrorInfo) { console.error('render crash', error, info.componentStack); }
  retry = () => this.setState({ error: null });
  render() {
    if (this.state.error === null) return this.props.children;
    return this.props.fallback ? this.props.fallback(this.retry) : <BoundaryFallback onRetry={this.retry} />;
  }
}

function setMeta(selector: string, create: () => HTMLMetaElement, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(selector);
  if (!el) { el = create(); document.head.appendChild(el); }
  el.content = content;
}

/** Per-route document title + description / og tags (SPA: set at runtime). */
export function usePageMeta(title: string, description: string): void {
  const { lang } = useI18n();
  useEffect(() => {
    const full = `${title} · Quiz Platform`;
    document.title = full;
    setMeta('meta[name="description"]', () => { const m = document.createElement('meta'); m.name = 'description'; return m; }, description);
    setMeta('meta[property="og:title"]', () => { const m = document.createElement('meta'); m.setAttribute('property', 'og:title'); return m; }, full);
    setMeta('meta[property="og:description"]', () => { const m = document.createElement('meta'); m.setAttribute('property', 'og:description'); return m; }, description);
  }, [title, description, lang]);
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
