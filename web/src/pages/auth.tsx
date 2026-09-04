import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { post } from '../api';
import { Field, errorMessage, useAction } from '../components';
import { PasswordInput } from './profile';
import { useAuth, type User } from '../ctx';
import { useI18n } from '../i18n';

interface AuthResponse { user: User; accessToken: string; refreshToken: string }

function AuthShell({ title, children }: { title: string; children: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="auth-wrap">
      <div className="brand-big">🧠 {t('appName')}</div>
      <div className="card">
        <h1 style={{ fontSize: 22 }}>{title}</h1>
        {children}
      </div>
    </div>
  );
}

export function LoginPage() {
  const { t } = useI18n();
  const { setAuth } = useAuth();
  const nav = useNavigate();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await post<AuthResponse>('/auth/login', { identifier, password });
      setAuth(res.user, res.accessToken, res.refreshToken);
      nav('/');
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const guest = async () => {
    setBusy(true);
    try {
      const res = await post<AuthResponse>('/auth/guest', {});
      setAuth(res.user, res.accessToken, res.refreshToken);
      nav('/');
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title={t('login')}>
      <form onSubmit={submit}>
        <div className="fld-group">
          <label className="fld" htmlFor="ident">{t('emailOrUsername')}</label>
          <input id="ident" value={identifier} onChange={(e) => setIdentifier(e.target.value)} required autoFocus />
        </div>
        <div className="fld-group">
          <label className="fld" htmlFor="pw">{t('password')}</label>
          <input id="pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {error && <p className="error-text" role="alert">{error}</p>}
        <div className="stack">
          <button className="btn" disabled={busy}>{t('login')}</button>
          <button type="button" className="btn secondary" onClick={guest} disabled={busy}>{t('guest')}</button>
        </div>
      </form>
      <div className="divider" />
      <div className="row between">
        <Link to="/register">{t('register')}</Link>
        <Link to="/forgot">{t('forgotPassword')}</Link>
      </div>
    </AuthShell>
  );
}

export function RegisterPage() {
  const { t, lang } = useI18n();
  const { setAuth } = useAuth();
  const nav = useNavigate();
  const [form, setForm] = useState({ email: '', username: '', password: '', confirm: '', displayName: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const mismatch = form.confirm.length > 0 && form.confirm !== form.password;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (mismatch) return;
    setBusy(true);
    setError('');
    try {
      const { confirm: _confirm, ...payload } = form;
      const res = await post<AuthResponse>('/auth/register', { ...payload, displayName: form.displayName.trim() || undefined, language: lang });
      setAuth(res.user, res.accessToken, res.refreshToken);
      nav('/');
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <AuthShell title={t('register')}>
      <form onSubmit={submit}>
        <Field label={t('email')}>{(id) => <input id={id} type="email" autoComplete="email" value={form.email} onChange={set('email')} required />}</Field>
        <Field label={t('username')}>{(id) => <input id={id} autoComplete="username" value={form.username} onChange={set('username')} required minLength={3} maxLength={32} pattern="[A-Za-z0-9_.\-]+" />}</Field>
        <Field label={t('displayName')}>{(id) => <input id={id} autoComplete="nickname" value={form.displayName} onChange={set('displayName')} maxLength={60} />}</Field>
        <Field label={t('password')} hint={t('passwordHint')}>
          {(id, describedBy) => <PasswordInput id={id} describedBy={describedBy} value={form.password} onChange={(v) => setForm((f) => ({ ...f, password: v }))} autoComplete="new-password" withMeter />}
        </Field>
        <Field label={t('confirmPassword')} error={mismatch ? t('passwordsMismatch') : undefined}>
          {(id, describedBy) => <input id={id} aria-describedby={describedBy} aria-invalid={mismatch} type="password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} required minLength={8} />}
        </Field>
        {error && <p className="error-text" role="alert">{error}</p>}
        <button className="btn" style={{ width: '100%' }} disabled={busy || mismatch}>{t('register')}</button>
      </form>
      <div className="divider" />
      <Link to="/login">{t('login')}</Link>
    </AuthShell>
  );
}

export function ForgotPage() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const linkToken = params.get('token') ?? '';
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(!!linkToken); // arriving from the email link jumps straight to the reset step
  const [token, setToken] = useState(linkToken);
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const [request, requesting] = useAction(async () => {
    const res = await post<{ resetToken?: string }>('/auth/forgot-password', { email });
    if (res.resetToken) setToken(res.resetToken); // only the automated test environment echoes the token
    setSent(true);
  });
  const [reset, resetting] = useAction(async () => {
    await post('/auth/reset-password', { token: token.trim(), password });
    setDone(true);
  });

  return (
    <AuthShell title={t('resetPassword')}>
      {done ? (
        <p>✓ <Link to="/login">{t('login')}</Link></p>
      ) : !sent ? (
        <form onSubmit={(e) => { e.preventDefault(); void request(); }}>
          <Field label={t('email')}>{(id) => <input id={id} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />}</Field>
          <button className="btn" style={{ width: '100%' }} disabled={requesting}>{t('submit')}</button>
        </form>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); void reset(); }}>
          <p className="muted" role="status">{t('resetSent')}</p>
          <Field label={t('token')}>{(id) => <input id={id} value={token} onChange={(e) => setToken(e.target.value)} required minLength={20} autoComplete="one-time-code" />}</Field>
          <Field label={t('newPassword')} hint={t('passwordHint')}>
            {(id, describedBy) => <PasswordInput id={id} describedBy={describedBy} value={password} onChange={setPassword} autoComplete="new-password" withMeter />}
          </Field>
          <button className="btn" style={{ width: '100%' }} disabled={resetting || password.length < 8 || token.trim().length < 20}>{t('resetPassword')}</button>
        </form>
      )}
    </AuthShell>
  );
}


/** Landing page for the verification link in the welcome email (/verify?token=…). */
export function VerifyEmailPage() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [state, setState] = useState<'pending' | 'ok' | 'error'>('pending');
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (!token) { setState('error'); setMessage(t('verifyInvalid')); return; }
    post('/auth/verify-email', { token }).then(() => setState('ok')).catch((err) => { setState('error'); setMessage(errorMessage(err, t)); });
  }, [token, t]);
  return (
    <AuthShell title={t('verifyEmail')}>
      {state === 'pending' && <p className="muted" role="status">{t('loading')}</p>}
      {state === 'ok' && <p role="status">✓ {t('verified')} <Link to="/login">{t('login')}</Link></p>}
      {state === 'error' && <p className="error-text" role="alert">{message}</p>}
    </AuthShell>
  );
}
