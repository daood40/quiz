import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { get } from './api';
import { useI18n } from './i18n';

export const Spinner = () => <span className="spin" role="status" aria-label="loading" />;

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

export function useTypeSpecs(): Map<string, TypeSpec> | null {
  const [specs, setSpecs] = useState<Map<string, TypeSpec> | null>(typeCache);
  useEffect(() => {
    if (typeCache) return;
    void get<{ types: TypeSpec[] }>('/quizzes/question-types').then((res) => {
      typeCache = new Map(res.types.map((t) => [t.id, t]));
      setSpecs(typeCache);
    }).catch(() => setSpecs(new Map()));
  }, []);
  return specs;
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
