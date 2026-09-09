import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { del, get, post } from '../api';
import { Avatar, EmptyState, ErrorState, Field, Spinner, fmtMs, useAction, useAsync, usePageMeta, useStatusLabel, useToast } from '../components';
import { useAuth } from '../ctx';
import { useI18n } from '../i18n';
import { useTx } from '../i18n';
import { QuizPlayer } from './quiz';

interface Entry { rank: number; userId: string; username: string; displayName: string; level: number; points: number; correct: number; totalTimeMs: number }

const SCOPES = new Set(['global', 'daily', 'weekly', 'monthly', 'country', 'friends']);

export function LeaderboardPage() {
  const { t, n } = useI18n();
  const tx = useTx();
  usePageMeta(t('leaderboard'), tx('metaDescLeaderboard'));
  const { user } = useAuth();
  // scope lives in the URL so back/forward and shared links keep it
  const [params, setParams] = useSearchParams();
  const rawScope = params.get('scope') ?? 'global';
  const scope = SCOPES.has(rawScope) ? rawScope : 'global';
  const setScope = (next: string) => setParams((prev) => { const p = new URLSearchParams(prev); if (next === 'global') p.delete('scope'); else p.set('scope', next); return p; });
  const { data, error, reload } = useAsync(() => get<{ entries: Entry[]; me: Entry | null }>(`/leaderboards?scope=${scope}&limit=100`), [scope]);

  const scopes = [
    ['global', t('global')], ['daily', t('daily')], ['weekly', t('weekly')], ['monthly', t('monthly')],
    ...(user?.country ? [['country', t('country')]] : []),
    ['friends', t('friends')],
  ] as Array<[string, string]>;

  return (
    <div className="page">
      <h1>🏆 {t('leaderboard')}</h1>
      <div className="row mb-3" role="group" aria-label={t('leaderboard')}>
        {scopes.map(([s, label]) => (
          <button type="button" key={s} className={`chip ${scope === s ? 'selected' : ''}`} aria-pressed={scope === s} onClick={() => setScope(s)}>{label}</button>
        ))}
      </div>
      <div className="card">
        {error ? <ErrorState error={error} onRetry={reload} /> : !data ? <Spinner /> : data.entries.length === 0 ? <EmptyState /> : (
          <>
          {data.entries.length >= 3 && (
            <div className="podium">
              {[[1, 'second', '🥈'], [0, 'first', '🥇'], [2, 'third', '🥉']].map(([idx, cls, medal]) => {
                const e = data.entries[idx as number];
                return (
                  <div key={e.userId} className={`spot ${cls}`}>
                    <span className="medal">{medal}</span>
                    <Avatar name={e.displayName || e.username} />
                    <span className="who"><bdi className="ltr-id">{e.displayName || e.username}</bdi></span>
                    <span className="pts">{e.points.toLocaleString()}</span>
                  </div>
                );
              })}
            </div>
          )}
          <div className="tbl-wrap"><table className="tbl">
            <caption className="sr-only">{t('leaderboard')}</caption>
            <thead><tr><th scope="col">#</th><th scope="col">{t('username')}</th><th scope="col">{t('level')}</th><th scope="col">{t('points')}</th><th scope="col" className="col-optional">{t('totalTime')}</th></tr></thead>
            <tbody>
              {data.entries.map((e) => (
                <tr key={e.userId} className={e.userId === user?.id ? 'me' : ''} aria-current={e.userId === user?.id ? 'true' : undefined}>
                  <td>{e.rank <= 3 ? ['🥇', '🥈', '🥉'][e.rank - 1] : e.rank}{e.userId === user?.id && <span className="badge primary you">{t('you')}</span>}</td>
                  <td><div className="row"><Avatar name={e.displayName || e.username} /><Link to={`/u/${e.username}`}><bdi className="ltr-id">{e.displayName || e.username}</bdi></Link></div></td>
                  <td>{e.level}</td>
                  <td><strong>{e.points.toLocaleString()}</strong></td>
                  <td className="muted col-optional">{fmtMs(e.totalTimeMs)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
          </>
        )}
        {data?.me && !data.entries.some((e) => e.userId === user?.id) && (
          <p className="banner info mt-2">{t('rank')}: #{data.me.rank} · {n('points', data.me.points)}</p>
        )}
      </div>
    </div>
  );
}

interface ChallengeRow { id: string; code: string; title: string; status: string; question_count: number; my_status: string; creator_username: string }

export function ChallengesPage() {
  const { t, n, pick } = useI18n();
  const tx = useTx();
  const nav = useNavigate();
  const titleRef = useRef<HTMLInputElement>(null);

  const statusLabel = useStatusLabel();
  const { data: list, error: listError, reload: load } = useAsync(() => get<{ challenges: ChallengeRow[] }>('/challenges').then((r) => r.challenges), []);
  const [showCreate, setShowCreate] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [categories, setCategories] = useState<Array<{ id: string; name: unknown }>>([]);
  const [form, setForm] = useState({ title: '', categoryId: '', difficulty: '', questionCount: 5, inviteUsernames: '' });

  useEffect(() => {
    void get<{ categories: Array<{ id: string; name: unknown }> }>('/categories').then((r) => setCategories(r.categories)).catch(() => setCategories([]));
  }, []);

  const [create, creating] = useAction(async () => {
    const res = await post<{ challenge: { id: string } }>('/challenges', {
      title: form.title.trim() || undefined,
      categoryId: form.categoryId || undefined,
      difficulty: form.difficulty || undefined,
      questionCount: form.questionCount,
      inviteUsernames: form.inviteUsernames.split(/[,\s]+/).filter(Boolean),
    });
    nav(`/challenges/${res.challenge.id}`);
  });
  const [join, joining] = useAction(async () => {
    const res = await post<{ challenge: { id: string } }>('/challenges/join', { code: joinCode.trim() });
    nav(`/challenges/${res.challenge.id}`);
  });

  return (
    <div className="page">
      <div className="row between"><h1>⚔️ {t('challenges')}</h1>
        <button type="button" className="btn" aria-expanded={showCreate} onClick={() => setShowCreate((s) => !s)}>{t('createChallenge')}</button>
      </div>
      <div className="card">
        <form className="row" onSubmit={(e) => { e.preventDefault(); void join(); }}>
          <div className="grow">
            <label className="fld" htmlFor="join-code">{t('joinByCode')}</label>
            <input id="join-code" placeholder={tx('codeExample')} value={joinCode} onChange={(e) => setJoinCode(e.target.value)} maxLength={16} autoComplete="off" autoCapitalize="characters" style={{ maxWidth: 180 }} />
          </div>
          <button type="submit" className="btn secondary" disabled={joining || joinCode.trim().length < 4}>{t('join')}</button>
        </form>
      </div>
      {showCreate && (
        <div className="card">
          <h2>{t('createChallenge')}</h2>
          <div className="stack">
            <input ref={titleRef} aria-label={t('name')} placeholder={t('name')} value={form.title} maxLength={80} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
            <div className="row">
              <select aria-label={t('category')} value={form.categoryId} onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}>
                <option value="">{t('anyCategory')}</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{pick(c.name)}</option>)}
              </select>
              <select aria-label={t('difficulty')} value={form.difficulty} onChange={(e) => setForm((f) => ({ ...f, difficulty: e.target.value }))}>
                <option value="">{t('anyDifficulty')}</option>
                {(['easy', 'medium', 'hard', 'expert'] as const).map((d) => <option key={d} value={d}>{t(d)}</option>)}
              </select>
            </div>
            <Field label={`${t('questions')}: ${form.questionCount}`}>
              {(id) => <input id={id} type="range" min={3} max={20} value={form.questionCount} onChange={(e) => setForm((f) => ({ ...f, questionCount: Number(e.target.value) }))} />}
            </Field>
            <input aria-label={t('invite')} placeholder={`${t('invite')} (user1, user2…)`} value={form.inviteUsernames} onChange={(e) => setForm((f) => ({ ...f, inviteUsernames: e.target.value }))} />
            <button type="button" className="btn" onClick={() => void create()} disabled={creating}>{t('createChallenge')}</button>
          </div>
        </div>
      )}
      <div className="card">
        {listError ? <ErrorState error={listError} onRetry={load} /> : !list ? <Spinner /> : list.length === 0 ? (
          <EmptyState
            icon="⚔️"
            title={t('noChallengesYet')}
            body={t('noChallengesHint')}
            action={{ label: t('createChallenge'), onClick: () => { setShowCreate(true); window.setTimeout(() => titleRef.current?.focus(), 0); } }}
          />
        ) : (
          <div className="tbl-wrap"><table className="tbl">
            <caption className="sr-only">{t('challenges')}</caption>
            <thead><tr><th scope="col">{t('name')}</th><th scope="col">{t('code')}</th><th scope="col">{t('status')}</th><th scope="col"><span className="sr-only">{t('actions')}</span></th></tr></thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id}>
                  <td>{c.title || <><bdi className="ltr-id">{c.creator_username}</bdi> · {n('questions', c.question_count)}</>}</td>
                  <td><code className="ltr-id">{c.code}</code></td>
                  <td><span className={`badge ${c.status === 'completed' ? 'success' : c.status === 'expired' ? 'danger' : 'primary'}`}>{statusLabel(c.status)}</span></td>
                  <td><Link to={`/challenges/${c.id}`} aria-label={`${t('openChallenge')}: ${c.title || c.code}`}>→</Link></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}

interface ChallengeDetail {
  challenge: { id: string; code: string; title: string; status: string; questionCount: number; expiresAt: string | null; creator: { username: string } };
  participants: Array<{ userId: string; username: string; displayName: string; status: string; score: number | null; durationMs: number | null }>;
}

export function ChallengeDetailPage() {
  const { t, n } = useI18n();
  const { id } = useParams();

  const { user } = useAuth();
  const statusLabel = useStatusLabel();
  const { data, error, reload: load } = useAsync(() => get<ChallengeDetail>(`/challenges/${id}`), [id]);
  const [session, setSession] = useState<{ attemptId: string; deadlineAt: string; questions: never[] } | null>(null);
  const [start, starting] = useAction(async () => {
    try {
      const res = await post<{ attemptId: string; deadlineAt: string; questions: never[] }>(`/challenges/${id}/start`);
      setSession(res);
    } catch (err) {
      load();
      throw err;
    }
  });

  if (session) return <QuizPlayer session={session} />;
  if (error) return <div className="page"><div className="card"><ErrorState error={error} onRetry={load} /></div></div>;
  if (!data) return <Spinner />;

  const me = data.participants.find((p) => p.userId === user?.id);
  const canPlay = me && me.status !== 'completed' && ['open', 'active'].includes(data.challenge.status);

  return (
    <div className="page narrow">
      <div className="card">
        <div className="row between">
          <div>
            <h1>{data.challenge.title || t('challenges')}</h1>
            <p className="muted">{t('code')}: <code className="ltr-id">{data.challenge.code}</code> · {n('questions', data.challenge.questionCount)} · <span className="badge primary">{statusLabel(data.challenge.status)}</span></p>
          </div>
          {canPlay && <button type="button" className="btn lg" onClick={() => void start()} disabled={starting}>▶ {t('start')}</button>}
        </div>
      </div>
      <div className="card">
        <h2>{t('participants')}</h2>
        {data.participants.length === 0 ? <EmptyState label={t('noParticipants')} /> : (
        <div className="tbl-wrap"><table className="tbl">
          <caption className="sr-only">{t('participants')}</caption>
          <thead><tr><th scope="col">#</th><th scope="col">{t('username')}</th><th scope="col">{t('status')}</th><th scope="col">{t('score')}</th><th scope="col" className="col-optional">{t('totalTime')}</th></tr></thead>
          <tbody>
            {data.participants.map((p, i) => (
              <tr key={p.userId} className={p.userId === user?.id ? 'me' : ''} aria-current={p.userId === user?.id ? 'true' : undefined}>
                <td>{p.score !== null ? i + 1 : '—'}</td>
                <td><bdi className="ltr-id">{p.displayName || p.username}</bdi></td>
                <td><span className={`badge ${p.status === 'completed' ? 'success' : ''}`}>{statusLabel(p.status)}</span></td>
                <td>{p.score ?? '—'}</td>
                <td className="muted col-optional">{p.durationMs ? fmtMs(p.durationMs) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
        )}
      </div>
    </div>
  );
}

export function MonthlyPage() {
  const { t, n, pick } = useI18n();

  const { user } = useAuth();
  const statusLabel = useStatusLabel();
  type Monthly = {
    monthlyChallenge: { id: string; yearMonth: string; title: unknown; questionCount: number; endsAt: string; status: string };
    leaderboard: Entry[];
    me: Entry | null;
    myStatus: string | null;
  };
  const { data, error, reload } = useAsync(() => get<Monthly>('/monthly-challenges/current'), []);
  const [session, setSession] = useState<{ attemptId: string; deadlineAt: string; questions: never[] } | null>(null);
  const [start, starting] = useAction(async () => {
    const res = await post<{ attemptId: string; deadlineAt: string; questions: never[] }>('/monthly-challenges/current/start');
    setSession(res);
  });

  if (session) return <QuizPlayer session={session} />;
  if (error) return <div className="page"><div className="card"><ErrorState error={error} onRetry={reload} /></div></div>;
  if (!data) return <Spinner />;

  return (
    <div className="page narrow">
      <div className="card">
        <div className="row between">
          <div>
            <h1>🏆 {pick(data.monthlyChallenge.title) || t('monthlyChallenge')}</h1>
            <p className="muted">{n('questions', data.monthlyChallenge.questionCount)} · {t('status')}: {statusLabel(data.monthlyChallenge.status)}</p>
          </div>
          {data.myStatus === 'submitted' ? <span className="badge success">✓ {t('completed')}</span>
            : <button type="button" className="btn lg" onClick={() => void start()} disabled={starting || data.monthlyChallenge.status !== 'active'}>▶ {t('start')}</button>}
        </div>
      </div>
      <div className="card">
        <h2>{t('leaderboard')}</h2>
        {data.leaderboard.length === 0 ? <EmptyState /> : (
          <div className="tbl-wrap"><table className="tbl">
            <caption className="sr-only">{t('leaderboard')}</caption>
            <thead><tr><th scope="col">#</th><th scope="col">{t('username')}</th><th scope="col">{t('points')}</th><th scope="col" className="col-optional">{t('totalTime')}</th></tr></thead>
            <tbody>
              {data.leaderboard.map((e) => (
                <tr key={e.userId} className={e.userId === user?.id ? 'me' : ''} aria-current={e.userId === user?.id ? 'true' : undefined}>
                  <td>{e.rank}</td><td><bdi className="ltr-id">{e.displayName || e.username}</bdi></td>
                  <td><strong>{e.points}</strong></td><td className="muted col-optional">{fmtMs(e.totalTimeMs)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}

interface GroupRow { id: string; name: string; description: string; code?: string; role?: string; member_count: number }

export function GroupsPage() {
  const { t, n } = useI18n();
  const nav = useNavigate();
  const { data, error, reload } = useAsync(() => get<{ myGroups: GroupRow[]; discover: GroupRow[] }>('/groups'), []);
  const [name, setName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [create, creating] = useAction(async () => {
    const res = await post<{ group: { id: string } }>('/groups', { name: name.trim() });
    nav(`/groups/${res.group.id}`);
  });
  const [join, joining] = useAction(async (body: { code?: string; groupId?: string }) => {
    const res = await post<{ group: { id: string } }>('/groups/join', body);
    nav(`/groups/${res.group.id}`);
  });

  if (error) return <div className="page"><div className="card"><ErrorState error={error} onRetry={reload} /></div></div>;
  if (!data) return <Spinner />;
  return (
    <div className="page">
      <h1>👥 {t('groups')}</h1>
      <div className="card">
        <div className="row">
          <input aria-label={t('name')} placeholder={t('name')} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} style={{ maxWidth: 220 }} />
          <button type="button" className="btn" onClick={() => void create()} disabled={creating || name.trim().length < 2}>{t('createGroup')}</button>
          <span className="divider vertical" />
          <input aria-label={t('code')} placeholder={t('code')} value={joinCode} maxLength={16} onChange={(e) => setJoinCode(e.target.value)} style={{ maxWidth: 140 }} />
          <button type="button" className="btn secondary" onClick={() => void join({ code: joinCode.trim() })} disabled={joining || joinCode.trim().length < 4}>{t('join')}</button>
        </div>
      </div>
      <div className="card">
        <h2>{t('groups')}</h2>
        {data.myGroups.length === 0 ? <EmptyState /> : (
          <div className="stack">
            {data.myGroups.map((g) => (
              <Link key={g.id} to={`/groups/${g.id}`} className="option">
                <span className="grow">{g.name}</span>
                <span className="badge">{n('members', g.member_count)}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
      {data.discover.length > 0 && (
        <div className="card">
          <h2>{t('search')}</h2>
          <div className="stack">
            {data.discover.map((g) => (
              <div key={g.id} className="row between">
                <span>{g.name} <span className="muted">· {n('members', g.member_count)}</span></span>
                <button type="button" className="btn sm" onClick={() => void join({ groupId: g.id })} disabled={joining}>{t('join')}</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function GroupDetailPage() {
  const { t } = useI18n();
  const tx = useTx();
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const statusLabel = useStatusLabel();
  type GroupDetail = {
    group: { id: string; name: string; description: string; code: string | null; myRole: string | null; memberCount: number };
    members: Array<{ rank: number; userId: string; username: string; displayName: string; level: number; totalPoints: number; role: string }>;
  };
  const { data, error, reload } = useAsync(() => get<GroupDetail>(`/groups/${id}`), [id]);
  const [inviteName, setInviteName] = useState('');
  const [invite, inviting] = useAction(async () => {
    await post(`/groups/${id}/invite`, { username: inviteName.trim() });
    toast(`✓ ${t('invite')}`);
    setInviteName('');
  });
  const [leave, leaving] = useAction(async () => {
    await post(`/groups/${id}/leave`);
    nav('/groups');
  });

  if (error) return <div className="page"><div className="card"><ErrorState error={error} onRetry={reload} /></div></div>;
  if (!data) return <Spinner />;

  return (
    <div className="page narrow">
      <div className="card">
        <div className="row between">
          <div>
            <h1>{data.group.name}</h1>
            <p className="muted">{data.group.description} {data.group.code && <>· {t('code')}: <code>{data.group.code}</code></>}</p>
          </div>
          {data.group.myRole && <button type="button" className="btn danger sm" onClick={() => void leave()} disabled={leaving}>{t('leave')}</button>}
        </div>
        {data.group.myRole && (
          <div className="row mt-2">
            <input aria-label={t('username')} placeholder={tx('usernameExample')} value={inviteName} onChange={(e) => setInviteName(e.target.value)} style={{ maxWidth: 200 }} />
            <button type="button" className="btn secondary sm" onClick={() => void invite()} disabled={inviting || !inviteName.trim()}>{t('invite')}</button>
          </div>
        )}
      </div>
      <div className="card">
        <h2>{t('leaderboard')}</h2>
        {data.members.length === 0 ? <EmptyState label={t('noParticipants')} /> : (
        <div className="tbl-wrap"><table className="tbl">
          <caption className="sr-only">{t('members')}</caption>
          <thead><tr><th scope="col">#</th><th scope="col">{t('username')}</th><th scope="col">{t('level')}</th><th scope="col">{t('points')}</th></tr></thead>
          <tbody>
            {data.members.map((m) => (
              <tr key={m.userId} className={m.userId === user?.id ? 'me' : ''} aria-current={m.userId === user?.id ? 'true' : undefined}>
                <td>{m.rank}</td><td><bdi className="ltr-id">{m.displayName || m.username}</bdi> {m.role !== 'member' && <span className="badge">{statusLabel(m.role)}</span>}</td>
                <td>{m.level}</td><td><strong>{m.totalPoints.toLocaleString()}</strong></td>
              </tr>
            ))}
          </tbody>
        </table></div>
        )}
      </div>
    </div>
  );
}

interface TournamentRow { id: string; title: unknown; kind: string; status: string; participant_count: number; max_players: number }

export function TournamentsPage() {
  const { t, pick } = useI18n();
  const { data: list, error, reload } = useAsync(() => get<{ tournaments: TournamentRow[] }>('/tournaments').then((r) => r.tournaments), []);
  return (
    <div className="page">
      <h1>🏟️ {t('tournaments')}</h1>
      <div className="card">
        {error ? <ErrorState error={error} onRetry={reload} /> : !list ? <Spinner /> : list.length === 0 ? <EmptyState /> : (
          <div className="stack">
            {list.map((tr) => (
              <Link key={tr.id} to={`/tournaments/${tr.id}`} className="option">
                <span className="grow">{pick(tr.title) || tr.kind}</span>
                <span className="badge">{tr.participant_count}/{tr.max_players}</span>
                <span className={`badge ${tr.status === 'registration' ? 'primary' : tr.status === 'running' ? 'warn' : 'success'}`}>
                  {tr.status === 'registration' ? t('registration') : tr.status === 'running' ? t('running') : t('completed')}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface TournamentDetail {
  tournament: { id: string; title: unknown; status: string; participantCount: number; maxPlayers: number };
  participants: Array<{ user_id: string; username: string; display_name: string; seed: number | null; final_rank: number | null }>;
  rounds: Array<{ round_number: number; status: string; matches: Array<{ id: string; matchNumber: number; status: string; player1Id: string | null; player2Id: string | null; winnerId: string | null; player1Score: number | null; player2Score: number | null }> }>;
  myMatch: { id: string; played: boolean } | null;
  joined: boolean;
}

export function TournamentDetailPage() {
  const { t, pick } = useI18n();
  const { id } = useParams();
  const statusLabel = useStatusLabel();
  const { data, error, reload: load } = useAsync(() => get<TournamentDetail>(`/tournaments/${id}`), [id]);
  const [session, setSession] = useState<{ attemptId: string; deadlineAt: string; questions: never[] } | null>(null);
  const [join, joining] = useAction(async () => {
    await post(`/tournaments/${id}/join`);
    load();
  });
  const [play, playing] = useAction(async () => {
    try {
      const res = await post<{ attemptId: string; deadlineAt: string; questions: never[] }>(`/tournaments/${id}/play`);
      setSession(res);
    } catch (err) {
      load();
      throw err;
    }
  });

  if (session) return <QuizPlayer session={session} />;
  if (error) return <div className="page"><div className="card"><ErrorState error={error} onRetry={load} /></div></div>;
  if (!data) return <Spinner />;

  const nameOf = (uid: string | null) => data.participants.find((p) => p.user_id === uid)?.username ?? '—';
  const champion = data.participants.find((p) => p.final_rank === 1);

  return (
    <div className="page">
      <div className="card">
        <div className="row between">
          <div>
            <h1>{pick(data.tournament.title) || t('tournaments')}</h1>
            <p className="muted">{data.tournament.participantCount}/{data.tournament.maxPlayers} · {statusLabel(data.tournament.status)}</p>
            {champion && <p>🏆 {t('champion')}: <strong>{champion.username}</strong></p>}
          </div>
          {data.tournament.status === 'registration' && !data.joined && <button type="button" className="btn lg" onClick={() => void join()} disabled={joining}>{t('join')}</button>}
          {data.myMatch && !data.myMatch.played && <button type="button" className="btn lg" onClick={() => void play()} disabled={playing}>▶ {t('playMatch')}</button>}
        </div>
      </div>
      {data.rounds.length === 0 && <div className="card"><EmptyState label={t('waitingForPlayers')} /></div>}
      {data.rounds.map((r) => (
        <div className="card" key={r.round_number}>
          <h2>{t('round')} {r.round_number} <span className="badge">{statusLabel(r.status)}</span></h2>
          <div className="stack">
            {r.matches.map((m) => (
              <div key={m.id} className="list-row">
                <span style={{ fontWeight: m.winnerId === m.player1Id ? 800 : 400 }}>
                  {m.winnerId === m.player1Id && m.winnerId && '🏆 '}{nameOf(m.player1Id)} {m.player1Score !== null && <span className="badge">{m.player1Score}</span>}
                </span>
                <span className="muted">{t('vs')}</span>
                <span style={{ fontWeight: m.winnerId === m.player2Id ? 800 : 400 }}>
                  {m.winnerId === m.player2Id && m.winnerId && '🏆 '}{m.player2Id ? nameOf(m.player2Id) : `(${t('bye')})`} {m.player2Score !== null && <span className="badge">{m.player2Score}</span>}
                </span>
                <span className={`badge ${m.status === 'completed' ? 'success' : m.status === 'walkover' ? '' : 'warn'}`}>{statusLabel(m.status)}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

interface FriendItem {
  userId: string;
  username: string;
  displayName: string;
  avatar: string;
  level: number;
  totalPoints: number;
  currentStreak: number;
}

export function FriendsPage() {
  const { t, n, lang } = useI18n();
  const tx = useTx();
  const toast = useToast();
  const addRef = useRef<HTMLInputElement>(null);
  type Friends = { friends: FriendItem[]; incoming: FriendItem[]; outgoing: FriendItem[] };
  const { data, error, reload: load } = useAsync(() => get<Friends>('/friends'), []);
  const [name, setName] = useState('');
  const [request, requesting] = useAction(async () => {
    await post('/friends/request', { username: name.trim() });
    setName('');
    toast(`✓ ${t('addFriend')}`);
    load();
  });
  const [respond, responding] = useAction(async (userId: string, accept: boolean) => {
    await post('/friends/respond', { userId, accept });
    load();
  });
  const [remove, removing] = useAction(async (userId: string) => {
    await del(`/friends/${userId}`);
    load();
  });

  if (error) return <div className="page"><div className="card"><ErrorState error={error} onRetry={load} /></div></div>;
  if (!data) return <Spinner />;
  const Row = ({ f, actions }: { f: FriendItem; actions: React.ReactNode }) => (
    <div className="list-row">
      <div className="row">
        <Avatar name={f.displayName || f.username} avatar={f.avatar} />
        <div>
          <strong><bdi className="ltr-id">{f.displayName || f.username}</bdi></strong>
          <p className="muted m-0">
            {t('level')} {f.level} · {n('points', f.totalPoints)} · 🔥 {f.currentStreak}
          </p>
        </div>
      </div>
      <div className="row tight">{actions}</div>
    </div>
  );

  return (
    <div className="page narrow">
      <h1>🤝 {t('friends')}</h1>
      <div className="card">
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (name.trim()) void request(); }}>
          <div className="grow">
            <label className="fld" htmlFor="friend-username">{t('username')}</label>
            <input id="friend-username" ref={addRef} placeholder={tx('usernameExample')} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" autoCapitalize="none" style={{ maxWidth: 240 }} />
          </div>
          <button type="submit" className="btn" disabled={requesting || !name.trim()}>{t('addFriend')}</button>
        </form>
      </div>
      {data.incoming.length > 0 && (
        <div className="card">
          <h2>{t('friendRequests')}</h2>
          {data.incoming.map((f) => (
            <Row key={f.userId} f={f} actions={<>
              <button type="button" className="btn sm" onClick={() => void respond(f.userId, true)} disabled={responding}>{t('accept')}</button>
              <button type="button" className="btn secondary sm" onClick={() => void respond(f.userId, false)} disabled={responding}>{t('decline')}</button>
            </>} />
          ))}
        </div>
      )}
      <div className="card">
        <h2>{n('friends', data.friends.length)}</h2>
        {data.friends.length === 0 ? (
          <EmptyState icon="🤝" title={t('noFriendsYet')} body={t('noFriendsHint')} action={{ label: t('addFriend'), onClick: () => addRef.current?.focus() }} />
        ) : data.friends.map((f) => (
          <Row key={f.userId} f={f} actions={<>
            <Link className="btn ghost sm" to={`/u/${f.username}`}>{t('profile')}</Link>
            <button type="button" className="btn secondary sm" onClick={() => void remove(f.userId)} disabled={removing}>{t('remove')}</button>
          </>} />
        ))}
        {data.outgoing.length > 0 && (
          <p className="muted mt-2">
            ⏳ <bdi className="ltr-id">{data.outgoing.map((f) => f.username).join(lang === 'ar' ? '، ' : ', ')}</bdi>
          </p>
        )}
      </div>
    </div>
  );
}
