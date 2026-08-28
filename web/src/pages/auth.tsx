import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError, post } from '../api';
import { useAuth, type User } from '../ctx';
import { useI18n } from '../i18n';

interface AuthResponse { user: User; accessToken: string; refreshToken: string }

function AuthShell({ title, children }: { title: string; children: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="auth-wrap">
      <div className="brand-big">🧠 {t('appName')}</div>
      <div className="card">
        <h2>{title}</h2>
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
      setError(err instanceof ApiError ? err.message : t('error'));
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
      setError(err instanceof ApiError ? err.message : t('error'));
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
        {error && <p className="error-text">{error}</p>}
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
  const [form, setForm] = useState({ email: '', username: '', password: '', displayName: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await post<AuthResponse>('/auth/register', { ...form, displayName: form.displayName || undefined, language: lang });
      setAuth(res.user, res.accessToken, res.refreshToken);
      nav('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('error'));
    } finally {
      setBusy(false);
    }
  };

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <AuthShell title={t('register')}>
      <form onSubmit={submit}>
        <div className="fld-group"><label className="fld">{t('email')}</label><input type="email" value={form.email} onChange={set('email')} required /></div>
        <div className="fld-group"><label className="fld">{t('username')}</label><input value={form.username} onChange={set('username')} required minLength={3} maxLength={32} /></div>
        <div className="fld-group"><label className="fld">{t('displayName')}</label><input value={form.displayName} onChange={set('displayName')} /></div>
        <div className="fld-group"><label className="fld">{t('password')}</label><input type="password" value={form.password} onChange={set('password')} required minLength={8} /></div>
        {error && <p className="error-text">{error}</p>}
        <button className="btn" style={{ width: '100%' }} disabled={busy}>{t('register')}</button>
      </form>
      <div className="divider" />
      <Link to="/login">{t('login')}</Link>
    </AuthShell>
  );
}

export function ForgotPage() {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const request = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const res = await post<{ resetToken?: string }>('/auth/forgot-password', { email });
      if (res.resetToken) setToken(res.resetToken); // dev convenience — emailed in production
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('error'));
    }
  };
  const reset = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await post('/auth/reset-password', { token, password });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('error'));
    }
  };

  return (
    <AuthShell title={t('resetPassword')}>
      {done ? (
        <p>✓ <Link to="/login">{t('login')}</Link></p>
      ) : !sent ? (
        <form onSubmit={request}>
          <div className="fld-group"><label className="fld">{t('email')}</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
          {error && <p className="error-text">{error}</p>}
          <button className="btn" style={{ width: '100%' }}>{t('submit')}</button>
        </form>
      ) : (
        <form onSubmit={reset}>
          <p className="muted">Check your email for the reset token.</p>
          <div className="fld-group"><label className="fld">Token</label><input value={token} onChange={(e) => setToken(e.target.value)} required /></div>
          <div className="fld-group"><label className="fld">{t('password')}</label><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} /></div>
          {error && <p className="error-text">{error}</p>}
          <button className="btn" style={{ width: '100%' }}>{t('resetPassword')}</button>
        </form>
      )}
    </AuthShell>
  );
}
