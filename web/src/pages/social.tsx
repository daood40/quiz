import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, del, get, post } from '../api';
import { Avatar, EmptyState, Spinner, fmtMs, useToast } from '../components';
import { useAuth } from '../ctx';
import { useI18n } from '../i18n';
import { QuizPlayer } from './quiz';

interface Entry { rank: number; userId: string; username: string; displayName: string; level: number; points: number; correct: number; totalTimeMs: number }

export function LeaderboardPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const [scope, setScope] = useState('global');
  const [data, setData] = useState<{ entries: Entry[]; me: Entry | null } | null>(null);

  useEffect(() => {
    setData(null);
    void get<{ entries: Entry[]; me: Entry | null }>(`/leaderboards?scope=${scope}`).then(setData).catch(() => setData({ entries: [], me: null }));
  }, [scope]);

  const scopes = [
    ['global', t('global')], ['daily', t('daily')], ['weekly', t('weekly')], ['monthly', t('monthly')],
    ...(user?.country ? [['country', t('country')]] : []),
    ['friends', t('friends')],
  ] as Array<[string, string]>;

  return (
    <div style={{ maxWidth: 680, margin: '0 auto' }}>
      <h1>🏆 {t('leaderboard')}</h1>
      <div className="row" style={{ marginBottom: 14 }}>
        {scopes.map(([s, label]) => (
          <button key={s} className={`chip ${scope === s ? 'selected' : ''}`} onClick={() => setScope(s)}>{label}</button>
        ))}
      </div>
      <div className="card">
        {!data ? <Spinner /> : data.entries.length === 0 ? <EmptyState /> : (
          <>
          {data.entries.length >= 3 && (
            <div className="podium">
              {[[1, 'second', '🥈'], [0, 'first', '🥇'], [2, 'third', '🥉']].map(([idx, cls, medal]) => {
                const e = data.entries[idx as number];
                return (
                  <div key={e.userId} className={`spot ${cls}`}>
                    <span className="medal">{medal}</span>
                    <Avatar name={e.displayName || e.username} />
                    <span className="who">{e.displayName || e.username}</span>
                    <span className="pts">{e.points.toLocaleString()}</span>
                  </div>
                );
              })}
            </div>
          )}
          <table className="tbl">
            <thead><tr><th>#</th><th>{t('username')}</th><th>{t('level')}</th><th>{t('points')}</th><th>{t('totalTime')}</th></tr></thead>
            <tbody>
              {data.entries.map((e) => (
                <tr key={e.userId} className={e.userId === user?.id ? 'me' : ''}>
                  <td>{e.rank <= 3 ? ['🥇', '🥈', '🥉'][e.rank - 1] : e.rank}</td>
                  <td><div className="row"><Avatar name={e.displayName || e.username} /><Link to={`/u/${e.username}`}>{e.displayName || e.username}</Link></div></td>
                  <td>{e.level}</td>
                  <td><strong>{e.points.toLocaleString()}</strong></td>
                  <td className="muted">{fmtMs(e.totalTimeMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </>
        )}
        {data?.me && !data.entries.some((e) => e.userId === user?.id) && (
          <p className="banner info" style={{ marginTop: 10 }}>{t('rank')}: #{data.me.rank} · {data.me.points.toLocaleString()} {t('points')}</p>
        )}
      </div>
    </div>
  );
}

interface ChallengeRow { id: string; code: string; title: string; status: string; question_count: number; my_status: string; creator_username: string }

export function ChallengesPage() {
  const { t, pick } = useI18n();
  const nav = useNavigate();
  const toast = useToast();
  const [list, setList] = useState<ChallengeRow[] | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [categories, setCategories] = useState<Array<{ id: string; name: unknown }>>([]);
  const [form, setForm] = useState({ title: '', categoryId: '', difficulty: '', questionCount: 5, inviteUsernames: '' });

  const load = useCallback(() => {
    void get<{ challenges: ChallengeRow[] }>('/challenges').then((r) => setList(r.challenges)).catch(() => setList([]));
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    void get<{ categories: Array<{ id: string; name: unknown }> }>('/categories').then((r) => setCategories(r.categories)).catch(() => undefined);
  }, []);

  const create = async () => {
    try {
      const res = await post<{ challenge: { id: string } }>('/challenges', {
        title: form.title,
        categoryId: form.categoryId || undefined,
        difficulty: form.difficulty || undefined,
        questionCount: form.questionCount,
        inviteUsernames: form.inviteUsernames.split(/[,\s]+/).filter(Boolean),
      });
      nav(`/challenges/${res.challenge.id}`);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('error'));
    }
  };
  const join = async () => {
    try {
      const res = await post<{ challenge: { id: string } }>('/challenges/join', { code: joinCode.trim() });
      nav(`/challenges/${res.challenge.id}`);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('error'));
    }
  };

  return (
    <div style={{ maxWidth: 680, margin: '0 auto' }}>
      <div className="row between"><h1>⚔️ {t('challenges')}</h1>
        <button className="btn" onClick={() => setShowCreate((s) => !s)}>{t('createChallenge')}</button>
      </div>
      <div className="card">
        <div className="row">
          <input placeholder={t('code')} value={joinCode} onChange={(e) => setJoinCode(e.target.value)} style={{ maxWidth: 180 }} />
          <button className="btn secondary" onClick={join} disabled={joinCode.trim().length < 4}>{t('joinByCode')}</button>
        </div>
      </div>
      {showCreate && (
        <div className="card">
          <h2>{t('createChallenge')}</h2>
          <div className="stack">
            <input placeholder={t('name')} value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
            <div className="row">
              <select value={form.categoryId} onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}>
                <option value="">{t('anyCategory')}</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{pick(c.name)}</option>)}
              </select>
              <select value={form.difficulty} onChange={(e) => setForm((f) => ({ ...f, difficulty: e.target.value }))}>
                <option value="">{t('anyDifficulty')}</option>
                {(['easy', 'medium', 'hard', 'expert'] as const).map((d) => <option key={d} value={d}>{t(d)}</option>)}
              </select>
            </div>
            <div><label className="fld">{t('questions')}: {form.questionCount}</label>
              <input type="range" min={3} max={20} value={form.questionCount} onChange={(e) => setForm((f) => ({ ...f, questionCount: Number(e.target.value) }))} /></div>
            <input placeholder={`${t('invite')} (user1, user2…)`} value={form.inviteUsernames} onChange={(e) => setForm((f) => ({ ...f, inviteUsernames: e.target.value }))} />
            <button className="btn" onClick={create}>{t('createChallenge')}</button>
          </div>
        </div>
      )}
      <div className="card">
        {!list ? <Spinner /> : list.length === 0 ? <EmptyState /> : (
          <table className="tbl">
            <thead><tr><th>{t('name')}</th><th>{t('code')}</th><th>{t('status')}</th><th /></tr></thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id}>
                  <td>{c.title || `${c.creator_username} · ${c.question_count}Q`}</td>
                  <td><code>{c.code}</code></td>
                  <td><span className={`badge ${c.status === 'completed' ? 'success' : c.status === 'expired' ? 'danger' : 'primary'}`}>{c.status}</span></td>
                  <td><Link to={`/challenges/${c.id}`}>→</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
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
  const { t } = useI18n();
  const { id } = useParams();
  const toast = useToast();
  const { user } = useAuth();
  const [data, setData] = useState<ChallengeDetail | null>(null);
  const [session, setSession] = useState<{ attemptId: string; deadlineAt: string; questions: never[] } | null>(null);

  const load = useCallback(() => {
    void get<ChallengeDetail>(`/challenges/${id}`).then(setData).catch(() => undefined);
  }, [id]);
  useEffect(load, [load]);

  if (session) return <QuizPlayer session={session} />;
  if (!data) return <Spinner />;

  const me = data.participants.find((p) => p.userId === user?.id);
  const canPlay = me && me.status !== 'completed' && ['open', 'active'].includes(data.challenge.status);

  const start = async () => {
    try {
      const res = await post<{ attemptId: string; deadlineAt: string; questions: never[] }>(`/challenges/${id}/start`);
      setSession(res);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('error'));
      load();
    }
  };

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <div className="card">
        <div className="row between">
          <div>
            <h1>{data.challenge.title || t('challenges')}</h1>
            <p className="muted">{t('code')}: <code>{data.challenge.code}</code> · {data.challenge.questionCount} {t('questions')} · <span className="badge primary">{data.challenge.status}</span></p>
          </div>
          {canPlay && <button className="btn lg" onClick={start}>▶ {t('start')}</button>}
        </div>
      </div>
      <div className="card">
        <h2>{t('participants')}</h2>
        <table className="tbl">
          <thead><tr><th>#</th><th>{t('username')}</th><th>{t('status')}</th><th>{t('score')}</th><th>{t('totalTime')}</th></tr></thead>
          <tbody>
            {data.participants.map((p, i) => (
              <tr key={p.userId} className={p.userId === user?.id ? 'me' : ''}>
                <td>{p.score !== null ? i + 1 : '—'}</td>
                <td>{p.displayName || p.username}</td>
                <td><span className={`badge ${p.status === 'completed' ? 'success' : ''}`}>{p.status}</span></td>
                <td>{p.score ?? '—'}</td>
                <td className="muted">{p.durationMs ? fmtMs(p.durationMs) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function MonthlyPage() {
  const { t, pick } = useI18n();
  const toast = useToast();
  const { user } = useAuth();
  const [data, setData] = useState<{
    monthlyChallenge: { id: string; yearMonth: string; title: unknown; questionCount: number; endsAt: string; status: string };
    leaderboard: Entry[];
    me: Entry | null;
    myStatus: string | null;
  } | null>(null);
  const [session, setSession] = useState<{ attemptId: string; deadlineAt: string; questions: never[] } | null>(null);

  useEffect(() => {
    void get<NonNullable<typeof data>>('/monthly-challenges/current').then(setData).catch(() => undefined);
  }, []);

  if (session) return <QuizPlayer session={session} />;
  if (!data) return <Spinner />;

  const start = async () => {
    try {
      const res = await post<{ attemptId: string; deadlineAt: string; questions: never[] }>('/monthly-challenges/current/start');
      setSession(res);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('error'));
    }
  };

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <div className="card">
        <div className="row between">
          <div>
            <h1>🏆 {pick(data.monthlyChallenge.title) || t('monthlyChallenge')}</h1>
            <p className="muted">{data.monthlyChallenge.questionCount} {t('questions')} · {t('status')}: {data.monthlyChallenge.status}</p>
          </div>
          {data.myStatus === 'submitted' ? <span className="badge success">✓ {t('completed')}</span>
            : <button className="btn lg" onClick={start} disabled={data.monthlyChallenge.status !== 'active'}>▶ {t('start')}</button>}
        </div>
      </div>
      <div className="card">
        <h2>{t('leaderboard')}</h2>
        {data.leaderboard.length === 0 ? <EmptyState /> : (
          <table className="tbl">
            <thead><tr><th>#</th><th>{t('username')}</th><th>{t('points')}</th><th>{t('totalTime')}</th></tr></thead>
            <tbody>
              {data.leaderboard.map((e) => (
                <tr key={e.userId} className={e.userId === user?.id ? 'me' : ''}>
                  <td>{e.rank}</td><td>{e.displayName || e.username}</td>
                  <td><strong>{e.points}</strong></td><td className="muted">{fmtMs(e.totalTimeMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

interface GroupRow { id: string; name: string; description: string; code?: string; role?: string; member_count: number }

export function GroupsPage() {
  const { t } = useI18n();
  const nav = useNavigate();
  const toast = useToast();
  const [data, setData] = useState<{ myGroups: GroupRow[]; discover: GroupRow[] } | null>(null);
  const [name, setName] = useState('');
  const [joinCode, setJoinCode] = useState('');

  const load = useCallback(() => {
    void get<{ myGroups: GroupRow[]; discover: GroupRow[] }>('/groups').then(setData).catch(() => setData({ myGroups: [], discover: [] }));
  }, []);
  useEffect(load, [load]);

  const create = async () => {
    try {
      const res = await post<{ group: { id: string } }>('/groups', { name });
      nav(`/groups/${res.group.id}`);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('error'));
    }
  };
  const join = async (body: { code?: string; groupId?: string }) => {
    try {
      const res = await post<{ group: { id: string } }>('/groups/join', body);
      nav(`/groups/${res.group.id}`);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('error'));
    }
  };

  if (!data) return <Spinner />;
  return (
    <div style={{ maxWidth: 680, margin: '0 auto' }}>
      <h1>👥 {t('groups')}</h1>
      <div className="card">
        <div className="row">
          <input placeholder={t('name')} value={name} onChange={(e) => setName(e.target.value)} style={{ maxWidth: 220 }} />
          <button className="btn" onClick={create} disabled={name.trim().length < 2}>{t('createGroup')}</button>
          <span className="divider" style={{ width: 1, height: 30 }} />
          <input placeholder={t('code')} value={joinCode} onChange={(e) => setJoinCode(e.target.value)} style={{ maxWidth: 140 }} />
          <button className="btn secondary" onClick={() => join({ code: joinCode })} disabled={joinCode.trim().length < 4}>{t('join')}</button>
        </div>
      </div>
      <div className="card">
        <h2>{t('groups')}</h2>
        {data.myGroups.length === 0 ? <EmptyState /> : (
          <div className="stack">
            {data.myGroups.map((g) => (
              <Link key={g.id} to={`/groups/${g.id}`} className="option">
                <span style={{ flex: 1 }}>{g.name}</span>
                <span className="badge">{g.member_count} {t('members')}</span>
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
                <span>{g.name} <span className="muted">· {g.member_count} {t('members')}</span></span>
                <button className="btn sm" onClick={() => join({ groupId: g.id })}>{t('join')}</button>
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
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const [data, setData] = useState<{
    group: { id: string; name: string; description: string; code: string | null; myRole: string | null; memberCount: number };
    members: Array<{ rank: number; userId: string; username: string; displayName: string; level: number; totalPoints: number; role: string }>;
  } | null>(null);
  const [inviteName, setInviteName] = useState('');

  useEffect(() => {
    void get<NonNullable<typeof data>>(`/groups/${id}`).then(setData).catch(() => undefined);
  }, [id]);

  if (!data) return <Spinner />;
  const invite = async () => {
    try {
      await post(`/groups/${id}/invite`, { username: inviteName.trim() });
      toast('✓');
      setInviteName('');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('error'));
    }
  };
  const leave = async () => {
    try {
      await post(`/groups/${id}/leave`);
      nav('/groups');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('error'));
    }
  };

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <div className="card">
        <div className="row between">
          <div>
            <h1>{data.group.name}</h1>
            <p className="muted">{data.group.description} {data.group.code && <>· {t('code')}: <code>{data.group.code}</code></>}</p>
          </div>
          {data.group.myRole && <button className="btn danger sm" onClick={leave}>{t('leave')}</button>}
        </div>
        {data.group.myRole && (
          <div className="row" style={{ marginTop: 10 }}>
            <input placeholder={t('username')} value={inviteName} onChange={(e) => setInviteName(e.target.value)} style={{ maxWidth: 200 }} />
            <button className="btn secondary sm" onClick={invite} disabled={!inviteName.trim()}>{t('invite')}</button>
          </div>
        )}
      </div>
      <div className="card">
        <h2>{t('leaderboard')}</h2>
        <table className="tbl">
          <thead><tr><th>#</th><th>{t('username')}</th><th>{t('level')}</th><th>{t('points')}</th></tr></thead>
          <tbody>
            {data.members.map((m) => (
              <tr key={m.userId} className={m.userId === user?.id ? 'me' : ''}>
                <td>{m.rank}</td><td>{m.displayName || m.username} {m.role !== 'member' && <span className="badge">{m.role}</span>}</td>
                <td>{m.level}</td><td><strong>{m.totalPoints.toLocaleString()}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface TournamentRow { id: string; title: unknown; kind: string; status: string; participant_count: number; max_players: number }

export function TournamentsPage() {
  const { t, pick } = useI18n();
  const [list, setList] = useState<TournamentRow[] | null>(null);
  useEffect(() => {
    void get<{ tournaments: TournamentRow[] }>('/tournaments').then((r) => setList(r.tournaments)).catch(() => setList([]));
  }, []);
  return (
    <div style={{ maxWidth: 680, margin: '0 auto' }}>
      <h1>🏟️ {t('tournaments')}</h1>
      <div className="card">
        {!list ? <Spinner /> : list.length === 0 ? <EmptyState /> : (
          <div className="stack">
            {list.map((tr) => (
              <Link key={tr.id} to={`/tournaments/${tr.id}`} className="option">
                <span style={{ flex: 1 }}>{pick(tr.title) || tr.kind}</span>
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
  const toast = useToast();
  const [data, setData] = useState<TournamentDetail | null>(null);
  const [session, setSession] = useState<{ attemptId: string; deadlineAt: string; questions: never[] } | null>(null);

  const load = useCallback(() => {
    void get<TournamentDetail>(`/tournaments/${id}`).then(setData).catch(() => undefined);
  }, [id]);
  useEffect(load, [load]);

  if (session) return <QuizPlayer session={session} />;
  if (!data) return <Spinner />;

  const nameOf = (uid: string | null) => data.participants.find((p) => p.user_id === uid)?.username ?? '—';
  const join = async () => {
    try {
      await post(`/tournaments/${id}/join`);
      load();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('error'));
    }
  };
  const play = async () => {
    try {
      const res = await post<{ attemptId: string; deadlineAt: string; questions: never[] }>(`/tournaments/${id}/play`);
      setSession(res);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('error'));
      load();
    }
  };

  const champion = data.participants.find((p) => p.final_rank === 1);

  return (
    <div style={{ maxWidth: 680, margin: '0 auto' }}>
      <div className="card">
        <div className="row between">
          <div>
            <h1>{pick(data.tournament.title) || t('tournaments')}</h1>
            <p className="muted">{data.tournament.participantCount}/{data.tournament.maxPlayers} · {data.tournament.status}</p>
            {champion && <p>🏆 {t('champion')}: <strong>{champion.username}</strong></p>}
          </div>
          {data.tournament.status === 'registration' && !data.joined && <button className="btn lg" onClick={join}>{t('join')}</button>}
          {data.myMatch && !data.myMatch.played && <button className="btn lg" onClick={play}>▶ {t('playMatch')}</button>}
        </div>
      </div>
      {data.rounds.map((r) => (
        <div className="card" key={r.round_number}>
          <h2>{t('round')} {r.round_number} <span className="badge">{r.status}</span></h2>
          <div className="stack">
            {r.matches.map((m) => (
              <div key={m.id} className="row between" style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontWeight: m.winnerId === m.player1Id ? 800 : 400 }}>
                  {nameOf(m.player1Id)} {m.player1Score !== null && <span className="badge">{m.player1Score}</span>}
                </span>
                <span className="muted">vs</span>
                <span style={{ fontWeight: m.winnerId === m.player2Id ? 800 : 400 }}>
                  {m.player2Id ? nameOf(m.player2Id) : '(bye)'} {m.player2Score !== null && <span className="badge">{m.player2Score}</span>}
                </span>
                <span className={`badge ${m.status === 'completed' ? 'success' : m.status === 'walkover' ? '' : 'warn'}`}>{m.status}</span>
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
  const { t } = useI18n();
  const toast = useToast();
  const [data, setData] = useState<{ friends: FriendItem[]; incoming: FriendItem[]; outgoing: FriendItem[] } | null>(null);
  const [name, setName] = useState('');

  const load = useCallback(() => {
    void get<NonNullable<typeof data>>('/friends').then(setData).catch(() => setData({ friends: [], incoming: [], outgoing: [] }));
  }, []);
  useEffect(load, [load]);

  const request = async () => {
    try {
      await post('/friends/request', { username: name.trim() });
      setName('');
      toast('✓');
      load();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('error'));
    }
  };
  const respond = async (userId: string, accept: boolean) => {
    try {
      await post('/friends/respond', { userId, accept });
      load();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('error'));
    }
  };
  const remove = async (userId: string) => {
    try {
      await del(`/friends/${userId}`);
      load();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('error'));
    }
  };

  if (!data) return <Spinner />;
  const Row = ({ f, actions }: { f: FriendItem; actions: React.ReactNode }) => (
    <div className="row between" style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
      <div className="row">
        <Avatar name={f.displayName || f.username} avatar={f.avatar} />
        <div>
          <strong>{f.displayName || f.username}</strong>
          <p className="muted" style={{ margin: 0 }}>
            {t('level')} {f.level} · {f.totalPoints.toLocaleString()} {t('points')} · 🔥 {f.currentStreak}
          </p>
        </div>
      </div>
      <div className="row" style={{ gap: 6 }}>{actions}</div>
    </div>
  );

  return (
    <div style={{ maxWidth: 620, margin: '0 auto' }}>
      <h1>🤝 {t('friends')}</h1>
      <div className="card">
        <div className="row">
          <input placeholder={t('username')} value={name} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && name.trim() && request()} style={{ maxWidth: 240 }} />
          <button className="btn" onClick={request} disabled={!name.trim()}>{t('addFriend')}</button>
        </div>
      </div>
      {data.incoming.length > 0 && (
        <div className="card">
          <h2>{t('friendRequests')}</h2>
          {data.incoming.map((f) => (
            <Row key={f.userId} f={f} actions={<>
              <button className="btn sm" onClick={() => respond(f.userId, true)}>{t('accept')}</button>
              <button className="btn secondary sm" onClick={() => respond(f.userId, false)}>{t('decline')}</button>
            </>} />
          ))}
        </div>
      )}
      <div className="card">
        <h2>{t('friends')} ({data.friends.length})</h2>
        {data.friends.length === 0 ? <EmptyState /> : data.friends.map((f) => (
          <Row key={f.userId} f={f} actions={<>
            <Link className="btn ghost sm" to={`/u/${f.username}`}>{t('profile')}</Link>
            <button className="btn secondary sm" onClick={() => remove(f.userId)}>{t('remove')}</button>
          </>} />
        ))}
        {data.outgoing.length > 0 && (
          <p className="muted" style={{ marginTop: 10 }}>
            ⏳ {data.outgoing.map((f) => f.username).join('، ')}
          </p>
        )}
      </div>
    </div>
  );
}
