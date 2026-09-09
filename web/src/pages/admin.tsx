import { useEffect, useState } from 'react';
import { NavLink, Route, Routes, useSearchParams } from 'react-router-dom';
import { api, get, patch, post } from '../api';
import { EmptyState, ErrorState, Field, Spinner, StatBox, ToggleChip, useAction, useAsync, useStatusLabel, useToast } from '../components';
import { useAuth } from '../ctx';
import { useI18n, type TKey } from '../i18n';

/** Debounced value for search boxes: one request per pause, not per keystroke. */
function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

function Pager({ offset, limit, total, onChange }: { offset: number; limit: number; total: number; onChange: (o: number) => void }) {
  const { t, dir } = useI18n();
  const [prev, next] = dir === 'rtl' ? ['›', '‹'] : ['‹', '›'];
  if (total <= limit) return null;
  return (
    <div className="row mt-2">
      <button type="button" className="btn secondary sm" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))} aria-label={t('prevPage')}>{prev}</button>
      <span className="muted">{offset + 1}–{Math.min(offset + limit, total)} / {total}</span>
      <button type="button" className="btn secondary sm" disabled={offset + limit >= total} onClick={() => onChange(offset + limit)} aria-label={t('nextPage')}>{next}</button>
    </div>
  );
}

function Dashboard() {
  const { t } = useI18n();
  const statusLabel = useStatusLabel();
  const { data: d, error, reload } = useAsync(() => get<Record<string, number | Record<string, number>>>('/admin/dashboard'), []);
  if (error) return <div className="card"><ErrorState error={error} onRetry={reload} /></div>;
  if (!d) return <Spinner />;
  const n = (k: string) => (d[k] as number) ?? 0;
  const boxes: Array<[string, TKey]> = [
    ['users', 'adminUsers'], ['activeUsers24h', 'adminActive24h'], ['dau', 'adminDau' as TKey], ['mau', 'adminMau' as TKey],
    ['questions', 'adminQuestions'], ['attempts', 'adminAttempts'], ['attemptsToday', 'adminAttemptsToday'], ['challenges', 'challenges'],
    ['tournaments', 'tournaments'], ['openReports', 'adminOpenReports'], ['suspiciousAttempts', 'adminSuspicious'],
  ];
  return (
    <div className="stack">
      <div className="grid cols-4">
        {boxes.map(([k, label]) => <StatBox key={k} value={n(k)} label={label === ('adminDau' as TKey) ? 'DAU' : label === ('adminMau' as TKey) ? 'MAU' : t(label)} />)}
      </div>
      <div className="card">
        <h2>{t('adminByStatus')}</h2>
        <div className="row">
          {Object.entries((d.questionsByStatus as Record<string, number>) ?? {}).map(([k, v]) => (
            <span key={k} className="badge primary">{statusLabel(k)}: {v}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

interface AdminQuestion {
  id: string; type: string; difficulty: string; language: string; status: string;
  content: Record<string, unknown>; qualityScore: number; createdAt: string;
}

/** List filters live in the URL (status / search / offset) so reloads, back and shared links keep them. */
function useListParams(defaults: Record<string, string>) {
  const [params, setParams] = useSearchParams();
  const read = (k: string) => params.get(k) ?? defaults[k] ?? '';
  const write = (patch: Record<string, string | number>, resetOffset = true) => setParams((prev) => {
    const next = new URLSearchParams(prev);
    for (const [k, v] of Object.entries(patch)) {
      const val = String(v);
      if (val === '' || val === (defaults[k] ?? '')) next.delete(k); else next.set(k, val);
    }
    if (resetOffset) next.delete('offset');
    return next;
  }, { replace: true });
  return { read, write, offset: Math.max(0, Number(params.get('offset')) || 0) };
}

function Questions() {
  const { t, pick } = useI18n();
  const statusLabel = useStatusLabel();
  const { read, write, offset } = useListParams({ status: 'pending_review' });
  const status = read('status');
  const searchInput = read('search');
  const search = useDebounced(searchInput);
  const setOffset = (o: number) => write({ offset: o }, false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const limit = 25;
  const { data, error, reload } = useAsync(() => {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (status && status !== 'all') params.set('status', status);
    if (search) params.set('search', search);
    return get<{ total: number; questions: AdminQuestion[] }>(`/admin/questions?${params}`);
  }, [status, search, offset]);
  // a new page of results invalidates the bulk selection
  useEffect(() => { setSelected(new Set()); }, [data]);

  const [act, acting] = useAction(async (id: string, newStatus: string) => {
    await post(`/admin/questions/${id}/status`, { status: newStatus });
    reload();
  });
  const [bulk, bulking] = useAction(async (newStatus: string) => {
    await post('/admin/questions/bulk-status', { ids: [...selected], status: newStatus });
    reload();
  });
  const busy = acting || bulking;

  return (
    <div className="stack">
      <div className="row">
        <select aria-label={t('status')} value={status} onChange={(e) => write({ status: e.target.value === '' ? 'all' : e.target.value })} style={{ maxWidth: 180 }}>
          <option value="all">{t('allStatuses')}</option>
          {['draft', 'pending_review', 'approved', 'rejected', 'archived'].map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
        </select>
        <input type="search" aria-label={t('search')} placeholder={t('searchPlaceholder')} value={searchInput} onChange={(e) => write({ search: e.target.value })} style={{ maxWidth: 240 }} />
        {selected.size > 0 && (
          <>
            <button type="button" className="btn sm" onClick={() => void bulk('approved')} disabled={busy}>{t('approve')} {selected.size}</button>
            <button type="button" className="btn danger sm" onClick={() => void bulk('rejected')} disabled={busy}>{t('reject')} {selected.size}</button>
          </>
        )}
      </div>
      <div className="card">
        {error ? <ErrorState error={error} onRetry={reload} /> : !data ? <Spinner /> : data.questions.length === 0 ? <EmptyState label={t('noResults')} /> : (
          <div className="tbl-wrap"><table className="tbl">
            <caption className="sr-only">{t('adminQuestions')}</caption>
            <thead><tr><th scope="col"><span className="sr-only">{t('actions')}</span></th><th scope="col">{t('prompt')}</th><th scope="col">{t('type')}</th><th scope="col">{t('difficulty')}</th><th scope="col">{t('language')}</th><th scope="col">{t('quality')}</th><th scope="col">{t('status')}</th><th scope="col">{t('actions')}</th></tr></thead>
            <tbody>
              {data.questions.map((q) => (
                <tr key={q.id}>
                  <td><input type="checkbox" aria-label={pick(q.content.prompt)} checked={selected.has(q.id)} onChange={(e) => setSelected((s) => { const n = new Set(s); if (e.target.checked) n.add(q.id); else n.delete(q.id); return n; })} style={{ width: 16 }} /></td>
                  <td style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pick(q.content.prompt)}</td>
                  <td><code>{q.type}</code></td>
                  <td>{t(q.difficulty as TKey)}</td>
                  <td>{q.language}</td>
                  <td>{Math.round(q.qualityScore)}</td>
                  <td><span className={`badge ${q.status === 'approved' ? 'success' : q.status === 'rejected' ? 'danger' : 'warn'}`}>{statusLabel(q.status)}</span></td>
                  <td>
                    <div className="row tight">
                      {q.status !== 'approved' && <button type="button" className="btn sm" onClick={() => void act(q.id, 'approved')} disabled={busy} aria-label={t('approve')} title={t('approve')}>✓</button>}
                      {q.status !== 'rejected' && <button type="button" className="btn danger sm" onClick={() => void act(q.id, 'rejected')} disabled={busy} aria-label={t('reject')} title={t('reject')}>✗</button>}
                      {q.status !== 'archived' && <button type="button" className="btn secondary sm" onClick={() => void act(q.id, 'archived')} disabled={busy} aria-label={t('archive')} title={t('archive')}>🗄</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
        {data && <Pager offset={offset} limit={limit} total={data.total} onChange={setOffset} />}
      </div>
    </div>
  );
}

function ImportExport() {
  const { t } = useI18n();
  const toast = useToast();
  const [format, setFormat] = useState<'json' | 'csv'>('csv');
  const [mode, setMode] = useState<'strict' | 'partial'>('strict');
  const [text, setText] = useState('');
  const [result, setResult] = useState<{ imported: number; duplicates?: number; totalErrors: number; errors: Array<{ row: number; field: string; error: string }> } | null>(null);
  const [doImport, importing] = useAction(async () => {
    setResult(null);
    const res = await post<NonNullable<typeof result>>('/admin/questions/import', { format, data: text, mode, status: 'pending_review' });
    setResult(res);
  });
  const [doExport, exporting] = useAction(async (f: 'json' | 'csv') => {
    const blob = await api<Blob>(`/admin/questions/export?format=${f}&status=approved`, { raw: true });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `questions.${f}`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  const MAX_FILE = 50 * 1024 * 1024;

  return (
    <div className="stack">
      <div className="card">
        <h2>{t('importQuestions')}</h2>
        <div className="row">
          <select aria-label={t('type')} value={format} onChange={(e) => setFormat(e.target.value as 'json' | 'csv')} style={{ maxWidth: 120 }}>
            <option value="csv">CSV</option><option value="json">JSON</option>
          </select>
          <select aria-label={t('mode')} value={mode} onChange={(e) => setMode(e.target.value as 'strict' | 'partial')} style={{ maxWidth: 220 }}>
            <option value="strict">{t('strictMode')}</option>
            <option value="partial">{t('partialMode')}</option>
          </select>
          <label className="btn secondary sm">
            📂 {t('file')}
            <input type="file" accept=".csv,.json,.txt" className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                if (f.size > MAX_FILE) { toast(t('error')); return; }
                void f.text().then(setText);
              }} />
          </label>
        </div>
        <textarea aria-label={t('importQuestions')} rows={8} className="mono mt-2"
          placeholder={format === 'csv' ? 'type,category_slug,difficulty,prompt_en,options,correct_answer\nmultiple_choice,science,easy,Question?,A|B|C,A' : '[{"type":"multiple_choice", ...}]'}
          value={text} onChange={(e) => setText(e.target.value)} />
        <button type="button" className="btn mt-2" onClick={() => void doImport()} disabled={importing || !text.trim()}>{t('validateImport')}</button>
        {result && (
          <div className="mt-2" role="status">
            <p><span className="badge success">{t('imported')}: {result.imported}</span> <span className="badge">{t('duplicates')}: {result.duplicates ?? 0}</span> <span className="badge danger">{t('errors')}: {result.totalErrors}</span></p>
            {result.errors.length > 0 && (
              <div className="tbl-wrap"><table className="tbl">
                <caption className="sr-only">{t('errors')}</caption>
                <thead><tr><th scope="col">{t('row')}</th><th scope="col">{t('field')}</th><th scope="col">{t('error')}</th></tr></thead>
                <tbody>{result.errors.slice(0, 30).map((e, i) => <tr key={i}><td>{e.row}</td><td>{e.field}</td><td>{e.error}</td></tr>)}</tbody>
              </table></div>
            )}
          </div>
        )}
      </div>
      <div className="card">
        <h2>{t('export')}</h2>
        <div className="row">
          {(['json', 'csv'] as const).map((f) => (
            <button type="button" key={f} className="btn secondary" onClick={() => void doExport(f)} disabled={exporting}>⬇ {f.toUpperCase()}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

interface AdminUser { id: string; username: string; email: string; role: string; status: string; level: number; total_points: string; attempt_count: string }

function Users() {
  const { t } = useI18n();
  const statusLabel = useStatusLabel();
  const { read, write, offset } = useListParams({});
  const searchInput = read('search');
  const search = useDebounced(searchInput);
  const setOffset = (o: number) => write({ offset: o }, false);
  const limit = 25;
  const { data, error, reload } = useAsync(() => {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (search) params.set('search', search);
    return get<{ total: number; users: AdminUser[] }>(`/admin/users?${params}`);
  }, [search, offset]);
  const [setStatus, settingStatus] = useAction(async (id: string, status: string) => {
    await post(`/admin/users/${id}/status`, { status });
    reload();
  });
  const [setRole, settingRole] = useAction(async (id: string, role: string) => {
    await post(`/admin/users/${id}/role`, { role });
    reload();
  });
  const busy = settingStatus || settingRole;

  return (
    <div className="card">
      <input type="search" aria-label={t('searchUsers')} placeholder={t('searchUsers')} value={searchInput} onChange={(e) => write({ search: e.target.value })} className="mb-2" style={{ maxWidth: 260 }} />
      {error ? <ErrorState error={error} onRetry={reload} /> : !data ? <Spinner /> : data.users.length === 0 ? <EmptyState label={t('noResults')} /> : (
        <div className="tbl-wrap"><table className="tbl">
          <caption className="sr-only">{t('adminUsers')}</caption>
          <thead><tr><th scope="col">{t('user')}</th><th scope="col">{t('email')}</th><th scope="col">{t('role')}</th><th scope="col">{t('status')}</th><th scope="col">{t('level')}</th><th scope="col">{t('points')}</th><th scope="col">{t('attempts')}</th><th scope="col">{t('actions')}</th></tr></thead>
          <tbody>
            {data.users.map((u) => (
              <tr key={u.id}>
                <td><strong><bdi className="ltr-id">{u.username}</bdi></strong></td>
                <td className="muted"><bdi className="ltr-id">{u.email}</bdi></td>
                <td>
                  <select aria-label={`${t('role')}: ${u.username}`} value={u.role} onChange={(e) => void setRole(u.id, e.target.value)} disabled={busy} className="select-sm">
                    {['user', 'moderator', 'editor', 'admin', 'super_admin'].map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </td>
                <td><span className={`badge ${u.status === 'active' ? 'success' : 'danger'}`}>{statusLabel(u.status)}</span></td>
                <td>{u.level}</td>
                <td>{Number(u.total_points).toLocaleString()}</td>
                <td>{u.attempt_count}</td>
                <td>
                  <div className="row tight">
                    {u.status === 'active'
                      ? <>
                          <button type="button" className="btn secondary sm" onClick={() => void setStatus(u.id, 'suspended')} disabled={busy}>{t('suspend')}</button>
                          <button type="button" className="btn danger sm" onClick={() => void setStatus(u.id, 'banned')} disabled={busy}>{t('ban')}</button>
                        </>
                      : <button type="button" className="btn sm" onClick={() => void setStatus(u.id, 'active')} disabled={busy}>{t('unban')}</button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      {data && <Pager offset={offset} limit={limit} total={data.total} onChange={setOffset} />}
    </div>
  );
}

function Reports() {
  const { t, pick } = useI18n();
  type Report = { id: string; reason: string; details: string; reporter: string; prompt: unknown; question_id: string; created_at: string };
  const { data, error, reload } = useAsync(() => get<{ reports: Report[] }>('/admin/reports?status=open'), []);
  const [resolve, resolving] = useAction(async (id: string, status: string) => {
    await post(`/admin/reports/${id}/resolve`, { status });
    reload();
  });
  const reasonKey: Record<string, TKey> = {
    wrong_answer: 'reasonWrongAnswer', wrong_question: 'reasonWrongQuestion', typo: 'reasonTypo', duplicate: 'reasonDuplicate',
    offensive: 'reasonOffensive', technical: 'reasonTechnical', other: 'reasonOther',
  };

  if (error) return <div className="card"><ErrorState error={error} onRetry={reload} /></div>;
  if (!data) return <Spinner />;
  return (
    <div className="card">
      {data.reports.length === 0 ? <EmptyState label={t('noOpenReports')} /> : (
        <div className="stack">
          {data.reports.map((r) => (
            <div key={r.id} className="list-row">
              <div>
                <strong>{pick(r.prompt)}</strong>
                <p className="muted m-0">⚑ {reasonKey[r.reason] ? t(reasonKey[r.reason]) : r.reason} — {r.details || t('noDetails')} · {t('by')} {r.reporter ?? t('anonymous')}</p>
              </div>
              <div className="row tight">
                <button type="button" className="btn sm" onClick={() => void resolve(r.id, 'resolved')} disabled={resolving}>{t('resolve')}</button>
                <button type="button" className="btn secondary sm" onClick={() => void resolve(r.id, 'dismissed')} disabled={resolving}>{t('dismissReport')}</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Suspicious() {
  const { t } = useI18n();
  const statusLabel = useStatusLabel();
  type Flagged = { id: string; username: string; mode: string; score: number; max_score: number; suspicion: string; flags: Array<{ kind: string }>; created_at: string };
  const { data, error, reload } = useAsync(() => get<{ attempts: Flagged[] }>('/admin/suspicious'), []);
  const [act, acting] = useAction(async (id: string, suspicion: string) => {
    await post(`/admin/suspicious/${id}`, { suspicion });
    reload();
  });
  if (error) return <div className="card"><ErrorState error={error} onRetry={reload} /></div>;
  if (!data) return <Spinner />;
  return (
    <div className="card">
      {data.attempts.length === 0 ? <EmptyState label={t('noFlagged')} /> : (
        <div className="tbl-wrap"><table className="tbl">
          <caption className="sr-only">{t('antiCheat')}</caption>
          <thead><tr><th scope="col">{t('user')}</th><th scope="col">{t('mode')}</th><th scope="col">{t('score')}</th><th scope="col">{t('flags')}</th><th scope="col">{t('suspicion')}</th><th scope="col">{t('actions')}</th></tr></thead>
          <tbody>
            {data.attempts.map((a) => (
              <tr key={a.id}>
                <td><bdi className="ltr-id">{a.username}</bdi></td><td>{statusLabel(a.mode)}</td><td>{a.score}/{a.max_score}</td>
                <td>{(a.flags ?? []).map((f, i) => <span key={i} className="badge danger m-1">{f.kind}</span>)}</td>
                <td><span className="badge warn">{a.suspicion}</span></td>
                <td>
                  <div className="row tight">
                    <button type="button" className="btn sm" onClick={() => void act(a.id, 'cleared')} disabled={acting}>{t('clear')}</button>
                    <button type="button" className="btn secondary sm" onClick={() => void act(a.id, 'under_review')} disabled={acting}>{t('reviewAction')}</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </div>
  );
}

const NUM_KEYS = ['defaultQuestionTimeSec', 'defaultQuizSize', 'xpPerCorrect', 'xpQuizCompletion', 'xpPerLevel', 'dailyQuizLimit', 'guestMaxQuestions', 'leaderboardCacheTtlSec', 'antiCheatMinAnswerMs', 'speedBonusMaxPercent'] as const;
const BOOL_KEYS = ['speedBonusEnabled', 'guestModeEnabled', 'registrationEnabled', 'maintenanceMode', 'aiEnabled'] as const;
const LIMITS: Record<string, [number, number]> = {
  defaultQuestionTimeSec: [5, 600], defaultQuizSize: [1, 100], xpPerCorrect: [0, 1000], xpQuizCompletion: [0, 5000], xpPerLevel: [10, 100000],
  dailyQuizLimit: [0, 1000], guestMaxQuestions: [1, 100], leaderboardCacheTtlSec: [0, 3600], antiCheatMinAnswerMs: [0, 60000], speedBonusMaxPercent: [0, 200],
};

function AdminSettings() {
  const { t } = useI18n();
  const toast = useToast();
  const { data, error, reload } = useAsync(() => get<{ settings: Record<string, unknown> }>('/admin/settings').then((r) => r.settings), []);
  const [settings, setSettings] = useState<Record<string, unknown> | null>(null);
  useEffect(() => { if (data) setSettings(data); }, [data]);
  const [save, saving] = useAction(async () => {
    if (!settings) return;
    await patch('/admin/settings', settings);
    toast(`✓ ${t('saved')}`);
  });
  if (error) return <div className="card"><ErrorState error={error} onRetry={reload} /></div>;
  if (!settings) return <Spinner />;
  const invalid = NUM_KEYS.some((k) => { const v = Number(settings[k]); const [min, max] = LIMITS[k]; return !Number.isFinite(v) || v < min || v > max; });
  return (
    <form className="card" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <div className="grid cols-2">
        {NUM_KEYS.map((k) => {
          const [min, max] = LIMITS[k];
          return (
            <Field key={k} label={t(`s_${k}` as TKey)} hint={`${min}–${max}`}>
              {(id, describedBy) => <input id={id} aria-describedby={describedBy} type="number" min={min} max={max} step={1} required value={Number(settings[k] ?? 0)} onChange={(e) => setSettings((s) => ({ ...s!, [k]: Number(e.target.value) }))} />}
            </Field>
          );
        })}
      </div>
      <div className="row mt-3">
        {BOOL_KEYS.map((k) => (
          <ToggleChip key={k} checked={Boolean(settings[k])} onChange={(v) => setSettings((s) => ({ ...s!, [k]: v }))}>{t(`s_${k}` as TKey)}</ToggleChip>
        ))}
      </div>
      <button className="btn mt-3" type="submit" disabled={saving || invalid}>{t('saveSettings')}</button>
    </form>
  );
}

function AiDrafts() {
  const { t, pick } = useI18n();
  const toast = useToast();
  const status = useAsync(() => get<{ enabled: boolean; provider: string | null; model: string | null; quota: { dailyPerUser: number; dailyPlatform: number; usedByMe: number; usedByPlatform: number } }>('/admin/ai/status'), []);
  const cats = useAsync(() => get<{ categories: Array<{ id: string; name: unknown }> }>('/categories').then((r) => r.categories), []);
  const [form, setForm] = useState({ categoryId: '', difficulty: 'medium', language: 'ar', count: 5, topic: '' });
  const [result, setResult] = useState<{ drafted: number; produced: number; errors: Array<{ index: number; error: string }> } | null>(null);
  const [generate, generating] = useAction(async () => {
    const res = await post<NonNullable<typeof result>>('/admin/ai/draft-questions', { ...form, topic: form.topic.trim() || undefined });
    setResult(res);
    status.reload();
    toast(`✓ ${t('aiDrafted')}: ${res.drafted}`);
  });
  if (status.error) return <div className="card"><ErrorState error={status.error} onRetry={status.reload} /></div>;
  if (!status.data || !cats.data) return <Spinner />;
  const s = status.data;
  return (
    <div className="stack">
      <div className="card">
        <h2>🤖 {t('aiTab')}</h2>
        <p className="muted">{t('aiIntro')}</p>
        {!s.enabled ? <p className="banner warn">{t('aiDisabled')}</p> : (
          <p className="muted">{t('aiModel')}: <code>{s.model}</code> · {t('aiQuota')}: {s.quota.usedByMe}/{s.quota.dailyPerUser}</p>
        )}
        <form className="stack" onSubmit={(e) => { e.preventDefault(); void generate(); }}>
          <Field label={t('category')}>
            {(id) => (
              <select id={id} value={form.categoryId} required onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}>
                <option value="">—</option>
                {cats.data!.map((c) => <option key={c.id} value={c.id}>{pick(c.name)}</option>)}
              </select>
            )}
          </Field>
          <div className="row">
            <select aria-label={t('difficulty')} value={form.difficulty} onChange={(e) => setForm((f) => ({ ...f, difficulty: e.target.value }))}>
              {(['easy', 'medium', 'hard', 'expert'] as const).map((d) => <option key={d} value={d}>{t(d)}</option>)}
            </select>
            <select aria-label={t('language')} value={form.language} onChange={(e) => setForm((f) => ({ ...f, language: e.target.value }))}>
              <option value="ar">العربية</option><option value="en">English</option>
            </select>
            <input aria-label={t('aiCount')} type="number" min={1} max={20} value={form.count} onChange={(e) => setForm((f) => ({ ...f, count: Number(e.target.value) }))} style={{ maxWidth: 90 }} />
          </div>
          <Field label={t('aiTopic')}>{(id) => <input id={id} value={form.topic} maxLength={120} onChange={(e) => setForm((f) => ({ ...f, topic: e.target.value }))} />}</Field>
          <button className="btn" type="submit" disabled={generating || !s.enabled || !form.categoryId}>{t('aiGenerate')}</button>
        </form>
        {result && (
          <p role="status" className="mt-2">
            <span className="badge success">{t('aiDrafted')}: {result.drafted}</span> <span className="badge">{t('errors')}: {result.errors.length}</span>
          </p>
        )}
      </div>
    </div>
  );
}

export function AdminPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  if (!user || user.role === 'user') return <div className="card"><EmptyState label={t('forbidden')} /></div>;
  const tabs: Array<[string, TKey]> = [
    ['', 'adminDashboard'], ['questions', 'adminQuestions'], ['import', 'importExport'], ['users', 'adminUsers'],
    ['reports', 'reports'], ['suspicious', 'antiCheat'], ['ai', 'aiTab'], ['settings', 'settings'],
  ];
  return (
    <div>
      <h1>🛠 {t('admin')}</h1>
      <nav className="row mb-3" aria-label={t('admin')}>
        {tabs.map(([path, label]) => (
          <NavLink key={path} to={`/admin/${path}`} end className={({ isActive }) => `chip ${isActive ? 'selected' : ''}`}>{t(label)}</NavLink>
        ))}
      </nav>
      <Routes>
        <Route index element={<Dashboard />} />
        <Route path="questions" element={<Questions />} />
        <Route path="import" element={<ImportExport />} />
        <Route path="users" element={<Users />} />
        <Route path="reports" element={<Reports />} />
        <Route path="suspicious" element={<Suspicious />} />
        <Route path="ai" element={<AiDrafts />} />
        <Route path="settings" element={<AdminSettings />} />
      </Routes>
    </div>
  );
}
