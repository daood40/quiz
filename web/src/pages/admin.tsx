import { useCallback, useEffect, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { ApiError, get, patch, post } from '../api';
import { EmptyState, Spinner, StatBox, useToast } from '../components';
import { useAuth } from '../ctx';
import { useI18n } from '../i18n';

function Dashboard() {
  const [d, setD] = useState<Record<string, number | Record<string, number>> | null>(null);
  useEffect(() => {
    void get<NonNullable<typeof d>>('/admin/dashboard').then(setD).catch(() => undefined);
  }, []);
  if (!d) return <Spinner />;
  const n = (k: string) => (d[k] as number) ?? 0;
  return (
    <div className="stack">
      <div className="grid cols-4">
        <StatBox value={n('users')} label="Users" />
        <StatBox value={n('activeUsers24h')} label="Active 24h" />
        <StatBox value={n('dau')} label="DAU" />
        <StatBox value={n('mau')} label="MAU" />
        <StatBox value={n('questions')} label="Questions" />
        <StatBox value={n('attempts')} label="Attempts" />
        <StatBox value={n('attemptsToday')} label="Attempts today" />
        <StatBox value={n('challenges')} label="Challenges" />
        <StatBox value={n('tournaments')} label="Tournaments" />
        <StatBox value={n('openReports')} label="Open reports" />
        <StatBox value={n('suspiciousAttempts')} label="Suspicious" />
      </div>
      <div className="card">
        <h3>Questions by status</h3>
        <div className="row">
          {Object.entries((d.questionsByStatus as Record<string, number>) ?? {}).map(([k, v]) => (
            <span key={k} className="badge primary">{k}: {v}</span>
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

function Questions() {
  const { pick } = useI18n();
  const toast = useToast();
  const [status, setStatus] = useState('pending_review');
  const [search, setSearch] = useState('');
  const [data, setData] = useState<{ total: number; questions: AdminQuestion[] } | null>(null);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const limit = 25;

  const load = useCallback(() => {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (status) params.set('status', status);
    if (search) params.set('search', search);
    void get<NonNullable<typeof data>>(`/admin/questions?${params}`).then((d) => {
      setData(d);
      setSelected(new Set());
    }).catch(() => setData({ total: 0, questions: [] }));
  }, [status, search, offset]);
  useEffect(load, [load]);

  const act = async (id: string, newStatus: string) => {
    try {
      await post(`/admin/questions/${id}/status`, { status: newStatus });
      load();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'error');
    }
  };
  const bulk = async (newStatus: string) => {
    try {
      await post('/admin/questions/bulk-status', { ids: [...selected], status: newStatus });
      load();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'error');
    }
  };

  return (
    <div className="stack">
      <div className="row">
        <select value={status} onChange={(e) => { setStatus(e.target.value); setOffset(0); }} style={{ maxWidth: 180 }}>
          <option value="">All statuses</option>
          {['draft', 'pending_review', 'approved', 'rejected', 'archived'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input placeholder="Search…" value={search} onChange={(e) => { setSearch(e.target.value); setOffset(0); }} style={{ maxWidth: 240 }} />
        {selected.size > 0 && (
          <>
            <button className="btn sm" onClick={() => bulk('approved')}>Approve {selected.size}</button>
            <button className="btn danger sm" onClick={() => bulk('rejected')}>Reject {selected.size}</button>
          </>
        )}
      </div>
      <div className="card">
        {!data ? <Spinner /> : data.questions.length === 0 ? <EmptyState /> : (
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th /><th>Prompt</th><th>Type</th><th>Diff</th><th>Lang</th><th>Q</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {data.questions.map((q) => (
                <tr key={q.id}>
                  <td><input type="checkbox" checked={selected.has(q.id)} onChange={(e) => setSelected((s) => { const n = new Set(s); if (e.target.checked) n.add(q.id); else n.delete(q.id); return n; })} style={{ width: 16 }} /></td>
                  <td style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pick(q.content.prompt)}</td>
                  <td><code>{q.type}</code></td>
                  <td>{q.difficulty}</td>
                  <td>{q.language}</td>
                  <td>{Math.round(q.qualityScore)}</td>
                  <td><span className={`badge ${q.status === 'approved' ? 'success' : q.status === 'rejected' ? 'danger' : 'warn'}`}>{q.status}</span></td>
                  <td>
                    <div className="row" style={{ gap: 4 }}>
                      {q.status !== 'approved' && <button className="btn sm" onClick={() => act(q.id, 'approved')}>✓</button>}
                      {q.status !== 'rejected' && <button className="btn danger sm" onClick={() => act(q.id, 'rejected')}>✗</button>}
                      {q.status !== 'archived' && <button className="btn secondary sm" onClick={() => act(q.id, 'archived')}>🗄</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
        {data && data.total > limit && (
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn secondary sm" disabled={offset === 0} onClick={() => setOffset((o) => Math.max(0, o - limit))}>‹</button>
            <span className="muted">{offset + 1}–{Math.min(offset + limit, data.total)} / {data.total}</span>
            <button className="btn secondary sm" disabled={offset + limit >= data.total} onClick={() => setOffset((o) => o + limit)}>›</button>
          </div>
        )}
      </div>
    </div>
  );
}

function ImportExport() {
  const toast = useToast();
  const [format, setFormat] = useState<'json' | 'csv'>('csv');
  const [mode, setMode] = useState<'strict' | 'partial'>('strict');
  const [text, setText] = useState('');
  const [result, setResult] = useState<{ imported: number; duplicates?: number; totalErrors: number; errors: Array<{ row: number; field: string; error: string }> } | null>(null);
  const [busy, setBusy] = useState(false);

  const doImport = async () => {
    setBusy(true);
    setResult(null);
    try {
      const res = await post<NonNullable<typeof result>>('/admin/questions/import', { format, data: text, mode, status: 'pending_review' });
      setResult(res);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <div className="card">
        <h3>Import questions</h3>
        <div className="row">
          <select value={format} onChange={(e) => setFormat(e.target.value as 'json' | 'csv')} style={{ maxWidth: 120 }}>
            <option value="csv">CSV</option><option value="json">JSON</option>
          </select>
          <select value={mode} onChange={(e) => setMode(e.target.value as 'strict' | 'partial')} style={{ maxWidth: 200 }}>
            <option value="strict">Strict (all-or-nothing)</option>
            <option value="partial">Partial (skip bad rows)</option>
          </select>
          <label className="btn secondary sm">
            📂 File
            <input type="file" accept=".csv,.json,.txt" style={{ display: 'none' }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void f.text().then(setText); }} />
          </label>
        </div>
        <textarea rows={8} style={{ marginTop: 10, fontFamily: 'monospace', fontSize: 12 }}
          placeholder={format === 'csv' ? 'type,category_slug,difficulty,prompt_en,options,correct_answer\nmultiple_choice,science,easy,Question?,A|B|C,A' : '[{"type":"multiple_choice", ...}]'}
          value={text} onChange={(e) => setText(e.target.value)} />
        <button className="btn" style={{ marginTop: 8 }} onClick={doImport} disabled={busy || !text.trim()}>Validate & Import</button>
        {result && (
          <div style={{ marginTop: 10 }}>
            <p><span className="badge success">Imported: {result.imported}</span> <span className="badge">Duplicates: {result.duplicates ?? 0}</span> <span className="badge danger">Errors: {result.totalErrors}</span></p>
            {result.errors.length > 0 && (
              <div className="tbl-wrap"><table className="tbl">
                <thead><tr><th>Row</th><th>Field</th><th>Error</th></tr></thead>
                <tbody>{result.errors.slice(0, 30).map((e, i) => <tr key={i}><td>{e.row}</td><td>{e.field}</td><td>{e.error}</td></tr>)}</tbody>
              </table></div>
            )}
          </div>
        )}
      </div>
      <div className="card">
        <h3>Export</h3>
        <div className="row">
          {(['json', 'csv'] as const).map((f) => (
            <button key={f} className="btn secondary" onClick={async () => {
              try {
                const token = localStorage.getItem('accessToken');
                const res = await fetch(`/api/v1/admin/questions/export?format=${f}&status=approved`, { headers: { authorization: `Bearer ${token}` } });
                const blob = await res.blob();
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `questions.${f}`;
                a.click();
              } catch {
                toast('error');
              }
            }}>⬇ {f.toUpperCase()}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Users() {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [data, setData] = useState<{ total: number; users: Array<{ id: string; username: string; email: string; role: string; status: string; level: number; total_points: string; attempt_count: string }> } | null>(null);

  const load = useCallback(() => {
    const params = new URLSearchParams({ limit: '25' });
    if (search) params.set('search', search);
    void get<NonNullable<typeof data>>(`/admin/users?${params}`).then(setData).catch(() => setData({ total: 0, users: [] }));
  }, [search]);
  useEffect(load, [load]);

  const setStatus = async (id: string, status: string) => {
    try {
      await post(`/admin/users/${id}/status`, { status });
      load();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'error');
    }
  };
  const setRole = async (id: string, role: string) => {
    try {
      await post(`/admin/users/${id}/role`, { role });
      load();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'error');
    }
  };

  return (
    <div className="card">
      <input placeholder="Search users…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 260, marginBottom: 10 }} />
      {!data ? <Spinner /> : (
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>User</th><th>Email</th><th>Role</th><th>Status</th><th>Lvl</th><th>Points</th><th>Attempts</th><th>Actions</th></tr></thead>
          <tbody>
            {data.users.map((u) => (
              <tr key={u.id}>
                <td><strong>{u.username}</strong></td>
                <td className="muted">{u.email}</td>
                <td>
                  <select value={u.role} onChange={(e) => setRole(u.id, e.target.value)} style={{ padding: '4px 6px', fontSize: 13 }}>
                    {['user', 'moderator', 'editor', 'admin', 'super_admin'].map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </td>
                <td><span className={`badge ${u.status === 'active' ? 'success' : 'danger'}`}>{u.status}</span></td>
                <td>{u.level}</td>
                <td>{Number(u.total_points).toLocaleString()}</td>
                <td>{u.attempt_count}</td>
                <td>
                  <div className="row" style={{ gap: 4 }}>
                    {u.status === 'active'
                      ? <>
                          <button className="btn secondary sm" onClick={() => setStatus(u.id, 'suspended')}>Suspend</button>
                          <button className="btn danger sm" onClick={() => setStatus(u.id, 'banned')}>Ban</button>
                        </>
                      : <button className="btn sm" onClick={() => setStatus(u.id, 'active')}>Unban</button>}
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

function Reports() {
  const { pick } = useI18n();
  const toast = useToast();
  const [data, setData] = useState<{ reports: Array<{ id: string; reason: string; details: string; reporter: string; prompt: unknown; question_id: string; created_at: string }> } | null>(null);
  const load = useCallback(() => {
    void get<NonNullable<typeof data>>('/admin/reports?status=open').then(setData).catch(() => setData({ reports: [] }));
  }, []);
  useEffect(load, [load]);

  const resolve = async (id: string, status: string) => {
    try {
      await post(`/admin/reports/${id}/resolve`, { status });
      load();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'error');
    }
  };

  if (!data) return <Spinner />;
  return (
    <div className="card">
      {data.reports.length === 0 ? <EmptyState label="No open reports" /> : (
        <div className="stack">
          {data.reports.map((r) => (
            <div key={r.id} className="row between" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
              <div>
                <strong>{pick(r.prompt)}</strong>
                <p className="muted" style={{ margin: 0 }}>⚑ {r.reason} — {r.details || '(no details)'} · by {r.reporter ?? 'anon'}</p>
              </div>
              <div className="row" style={{ gap: 4 }}>
                <button className="btn sm" onClick={() => resolve(r.id, 'resolved')}>Resolve</button>
                <button className="btn secondary sm" onClick={() => resolve(r.id, 'dismissed')}>Dismiss</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Suspicious() {
  const toast = useToast();
  const [data, setData] = useState<{ attempts: Array<{ id: string; username: string; mode: string; score: number; max_score: number; suspicion: string; flags: Array<{ kind: string }>; created_at: string }> } | null>(null);
  const load = useCallback(() => {
    void get<NonNullable<typeof data>>('/admin/suspicious').then(setData).catch(() => setData({ attempts: [] }));
  }, []);
  useEffect(load, [load]);
  const act = async (id: string, suspicion: string) => {
    try {
      await post(`/admin/suspicious/${id}`, { suspicion });
      load();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'error');
    }
  };
  if (!data) return <Spinner />;
  return (
    <div className="card">
      {data.attempts.length === 0 ? <EmptyState label="No flagged attempts" /> : (
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>User</th><th>Mode</th><th>Score</th><th>Flags</th><th>Suspicion</th><th>Actions</th></tr></thead>
          <tbody>
            {data.attempts.map((a) => (
              <tr key={a.id}>
                <td>{a.username}</td><td>{a.mode}</td><td>{a.score}/{a.max_score}</td>
                <td>{(a.flags ?? []).map((f, i) => <span key={i} className="badge danger" style={{ margin: 2 }}>{f.kind}</span>)}</td>
                <td><span className="badge warn">{a.suspicion}</span></td>
                <td>
                  <div className="row" style={{ gap: 4 }}>
                    <button className="btn sm" onClick={() => act(a.id, 'cleared')}>Clear</button>
                    <button className="btn secondary sm" onClick={() => act(a.id, 'under_review')}>Review</button>
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

function AdminSettings() {
  const toast = useToast();
  const [settings, setSettings] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    void get<{ settings: Record<string, unknown> }>('/admin/settings').then((r) => setSettings(r.settings)).catch(() => undefined);
  }, []);
  if (!settings) return <Spinner />;
  const save = async () => {
    try {
      await patch('/admin/settings', settings);
      toast('✓ Saved');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'error');
    }
  };
  const numKeys = ['defaultQuestionTimeSec', 'defaultQuizSize', 'xpPerCorrect', 'xpQuizCompletion', 'xpPerLevel', 'dailyQuizLimit', 'guestMaxQuestions', 'leaderboardCacheTtlSec', 'antiCheatMinAnswerMs', 'speedBonusMaxPercent'];
  const boolKeys = ['speedBonusEnabled', 'guestModeEnabled', 'registrationEnabled', 'maintenanceMode'];
  return (
    <div className="card">
      <div className="grid cols-2">
        {numKeys.map((k) => (
          <div key={k}>
            <label className="fld">{k}</label>
            <input type="number" value={Number(settings[k] ?? 0)} onChange={(e) => setSettings((s) => ({ ...s!, [k]: Number(e.target.value) }))} />
          </div>
        ))}
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        {boolKeys.map((k) => (
          <label key={k} className={`chip ${settings[k] ? 'selected' : ''}`} style={{ userSelect: 'none' }}>
            <input type="checkbox" checked={Boolean(settings[k])} onChange={(e) => setSettings((s) => ({ ...s!, [k]: e.target.checked }))} style={{ width: 16, marginInlineEnd: 6 }} />
            {k}
          </label>
        ))}
      </div>
      <button className="btn" style={{ marginTop: 14 }} onClick={save}>Save settings</button>
    </div>
  );
}

export function AdminPage() {
  const { user } = useAuth();
  if (!user || user.role === 'user') return <p className="error-text center">403</p>;
  const tabs = [
    ['', 'Dashboard'], ['questions', 'Questions'], ['import', 'Import/Export'], ['users', 'Users'],
    ['reports', 'Reports'], ['suspicious', 'Anti-Cheat'], ['settings', 'Settings'],
  ];
  return (
    <div>
      <h1>🛠 Admin</h1>
      <div className="row" style={{ marginBottom: 14 }}>
        {tabs.map(([path, label]) => (
          <NavLink key={path} to={`/admin/${path}`} end className={({ isActive }) => `chip ${isActive ? 'selected' : ''}`}>{label}</NavLink>
        ))}
      </div>
      <Routes>
        <Route index element={<Dashboard />} />
        <Route path="questions" element={<Questions />} />
        <Route path="import" element={<ImportExport />} />
        <Route path="users" element={<Users />} />
        <Route path="reports" element={<Reports />} />
        <Route path="suspicious" element={<Suspicious />} />
        <Route path="settings" element={<AdminSettings />} />
      </Routes>
    </div>
  );
}
