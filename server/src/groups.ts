// 小组、账本、战绩
import crypto from 'node:crypto';
import type { Db, Q } from './db';
import type { RoundRecord } from '../../shared/src/game';
import type { ActivityItem, GroupDetail, GroupSummary, MemberView, ProfileStats, Role } from '../../shared/src/ledger';
import { EMOJI_ICONS } from '../../shared/src/ledger';
import { AuthError, cleanName } from './auth';

const INVITE_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';
const newInvite = () => Array.from(crypto.randomBytes(8), (b) => INVITE_CHARS[b % INVITE_CHARS.length]).join('');
const groupName = (n: unknown) => String(n ?? '').trim().replace(/\s+/g, ' ').slice(0, 20);
const icon = (i: unknown) => {
  const s = String(i ?? '').trim();
  return s && [...s].length <= 2 && s.length <= 8 ? s : EMOJI_ICONS[0];
};
const amountOf = (a: unknown) => {
  const n = Number(a);
  if (!Number.isInteger(n) || n <= 0 || n > 1_000_000) throw new AuthError('金额要是正整数');
  return n;
};

export interface RoundInput {
  matchId: string;
  groupId: string | null;
  /** 按座位顺序；没登录的人 userId 为 null */
  players: { userId: string | null; name: string }[];
  record: RoundRecord;
}

export class Groups {
  constructor(private db: Db, private liveMatch: (matchId: string) => boolean = () => false, private tableCount: (groupId: string) => number = () => 0) {}

  async member(groupId: string, userId: string, q: Q = this.db) {
    const [m] = await q.query<{ role: Role; balance: number }>('select role, balance from group_members where group_id = $1 and user_id = $2', [groupId, userId]);
    return m ?? null;
  }
  private async requireMember(groupId: string, userId: string, q: Q = this.db) {
    const m = await this.member(groupId, userId, q);
    if (!m) throw new AuthError('你不在这个小组里', 403);
    return m;
  }
  private async requireAdmin(groupId: string, userId: string, q: Q = this.db) {
    const m = await this.requireMember(groupId, userId, q);
    if (m.role !== 'admin') throw new AuthError('只有管理员可以这样做', 403);
    return m;
  }

  async listFor(userId: string): Promise<GroupSummary[]> {
    const rows = await this.db.query<Omit<GroupSummary, 'tables'>>(
      `select g.id, g.name, g.icon, m.role, m.balance,
              (select count(*)::int from group_members x where x.group_id = g.id) as members
         from group_members m join groups g on g.id = m.group_id
        where m.user_id = $1 order by m.joined_at`, [userId]);
    return rows.map((r) => ({ ...r, tables: this.tableCount(r.id) }));
  }

  async create(userId: string, name: unknown, ic: unknown): Promise<string> {
    const n = groupName(name);
    if (!n) throw new AuthError('给小组起个名字');
    const id = crypto.randomUUID();
    await this.db.tx(async (q) => {
      await q.query('insert into groups (id, name, icon, invite_code, created_by) values ($1, $2, $3, $4, $5)', [id, n, icon(ic), newInvite(), userId]);
      await q.query(`insert into group_members (group_id, user_id, role) values ($1, $2, 'admin')`, [id, userId]);
    });
    return id;
  }

  async detail(groupId: string, userId: string): Promise<GroupDetail> {
    const me = await this.requireMember(groupId, userId);
    const [g] = await this.db.query<{ id: string; name: string; icon: string; invite_code: string }>('select id, name, icon, invite_code from groups where id = $1', [groupId]);
    const members = await this.db.query<MemberView>(
      `select u.id, u.name, u.avatar, u.picture, m.role, m.balance,
              (select count(*)::int from round_results r where r.group_id = m.group_id and r.user_id = u.id) as rounds,
              (select count(*)::int from round_results r where r.group_id = m.group_id and r.user_id = u.id and r.won) as wins
         from group_members m join users u on u.id = m.user_id
        where m.group_id = $1 order by m.balance desc, m.joined_at`, [groupId]);
    return { id: g.id, name: g.name, icon: g.icon, inviteCode: g.invite_code, you: userId, role: me.role, members, activity: await this.activity(groupId) };
  }

  async activity(groupId: string): Promise<ActivityItem[]> {
    const ledger = await this.db.query<{ id: string; kind: ActivityItem['kind']; actor_id: string; gainer_id: string; loser_id: string; amount: number; note: string | null; reversed_by: string | null; created_at: Date }>(
      'select id, kind, actor_id, gainer_id, loser_id, amount, note, reversed_by, created_at from ledger where group_id = $1 order by created_at desc limit 40', [groupId]);
    const matches = await this.db.query<{ id: string; rounds: number; deltas: Record<string, number>; updated_at: Date; ended_at: Date | null }>(
      'select id, rounds, deltas, updated_at, ended_at from matches where group_id = $1 and rounds > 0 order by updated_at desc limit 25', [groupId]);
    const joins = await this.db.query<{ user_id: string; joined_at: Date }>(
      'select user_id, joined_at from group_members where group_id = $1 order by joined_at desc limit 15', [groupId]);
    const items: ActivityItem[] = [
      ...ledger.map((l) => ({
        id: `l${l.id}`, at: new Date(l.created_at).toISOString(), kind: l.kind, actor: l.actor_id, gainer: l.gainer_id, loser: l.loser_id,
        amount: l.amount, note: l.note, entryId: Number(l.id), reversed: l.reversed_by !== null,
      })),
      ...matches.map((m) => ({
        id: `m${m.id}`, at: new Date(m.updated_at).toISOString(), kind: 'match' as const, actor: null, rounds: m.rounds, deltas: m.deltas,
        live: !m.ended_at && this.liveMatch(m.id),
      })),
      ...joins.map((j) => ({ id: `j${j.user_id}`, at: new Date(j.joined_at).toISOString(), kind: 'join' as const, actor: j.user_id })),
    ];
    return items.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 50);
  }

  async update(groupId: string, userId: string, patch: { name?: unknown; icon?: unknown }) {
    await this.requireAdmin(groupId, userId);
    if (patch.name !== undefined) {
      const n = groupName(patch.name);
      if (!n) throw new AuthError('名字不能为空');
      await this.db.query('update groups set name = $2 where id = $1', [groupId, n]);
    }
    if (patch.icon !== undefined) await this.db.query('update groups set icon = $2 where id = $1', [groupId, icon(patch.icon)]);
  }

  async rotateInvite(groupId: string, userId: string) {
    await this.requireAdmin(groupId, userId);
    await this.db.query('update groups set invite_code = $2 where id = $1', [groupId, newInvite()]);
  }

  async invitePreview(code: string) {
    const [g] = await this.db.query<{ id: string; name: string; icon: string; members: number }>(
      `select g.id, g.name, g.icon, (select count(*)::int from group_members m where m.group_id = g.id) as members
         from groups g where g.invite_code = $1`, [String(code).toLowerCase()]);
    if (!g) throw new AuthError('邀请链接失效了，找管理员要个新的', 404);
    return g;
  }

  async join(code: string, userId: string): Promise<string> {
    const g = await this.invitePreview(code);
    await this.db.query('insert into group_members (group_id, user_id) values ($1, $2) on conflict do nothing', [g.id, userId]);
    return g.id;
  }

  async setRole(groupId: string, actor: string, target: string, role: unknown) {
    await this.requireAdmin(groupId, actor);
    if (role !== 'admin' && role !== 'member') throw new AuthError('角色不对');
    await this.requireMember(groupId, target);
    if (role === 'member') {
      const [{ n }] = await this.db.query<{ n: number }>(`select count(*)::int as n from group_members where group_id = $1 and role = 'admin'`, [groupId]);
      const t = await this.member(groupId, target);
      if (t?.role === 'admin' && n <= 1) throw new AuthError('小组至少要有一个管理员');
    }
    await this.db.query('update group_members set role = $3 where group_id = $1 and user_id = $2', [groupId, target, role]);
  }

  /** 管理员移出别人，或者自己退出。账没结清（余额不为 0）不能走。 */
  async removeMember(groupId: string, actor: string, target: string) {
    if (actor !== target) await this.requireAdmin(groupId, actor);
    const t = await this.requireMember(groupId, target);
    if (t.balance !== 0) throw new AuthError(actor === target ? '你的账还没结清，结清了才能退出' : '这个人的账还没结清（余额要为 0）');
    if (t.role === 'admin') {
      const [{ n }] = await this.db.query<{ n: number }>(`select count(*)::int as n from group_members where group_id = $1 and role = 'admin'`, [groupId]);
      const [{ total }] = await this.db.query<{ total: number }>('select count(*)::int as total from group_members where group_id = $1', [groupId]);
      if (n <= 1 && total > 1) throw new AuthError('你是唯一的管理员，先把管理员给别人');
    }
    await this.db.query('delete from group_members where group_id = $1 and user_id = $2', [groupId, target]);
    const [{ total }] = await this.db.query<{ total: number }>('select count(*)::int as total from group_members where group_id = $1', [groupId]);
    if (total === 0) await this.db.query('delete from groups where id = $1', [groupId]);
  }

  private async move(q: Q, groupId: string, kind: string, actor: string, gainer: string, loser: string, amount: number, note: string | null, reverses: number | null = null) {
    await q.query('update group_members set balance = balance + $3 where group_id = $1 and user_id = $2', [groupId, gainer, amount]);
    await q.query('update group_members set balance = balance - $3 where group_id = $1 and user_id = $2', [groupId, loser, amount]);
    const [row] = await q.query<{ id: string }>(
      'insert into ledger (group_id, kind, actor_id, gainer_id, loser_id, amount, note, reverses) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id',
      [groupId, kind, actor, gainer, loser, amount, note, reverses]);
    return Number(row.id);
  }

  /** 还钱：from 付了 to 多少钱。from 的余额变多，to 的变少。自己是其中一方就能记；管理员可以替任何人记。 */
  async payment(groupId: string, actor: string, from: string, to: string, amt: unknown, note?: unknown) {
    const amount = amountOf(amt);
    if (from === to) throw new AuthError('要选两个不同的人');
    return this.db.tx(async (q) => {
      const a = await this.requireMember(groupId, actor, q);
      if (a.role !== 'admin' && actor !== from && actor !== to) throw new AuthError('只能记和自己有关的还款', 403);
      await this.requireMember(groupId, from, q);
      await this.requireMember(groupId, to, q);
      return this.move(q, groupId, 'payment', actor, from, to, amount, cleanNote(note));
    });
  }

  /** 管理员调账：debtor 欠 creditor 多少（比如补记以前的输赢）。管理员也可以调和自己有关的账。 */
  async adjust(groupId: string, actor: string, debtor: string, creditor: string, amt: unknown, note?: unknown) {
    const amount = amountOf(amt);
    if (debtor === creditor) throw new AuthError('要选两个不同的人');
    return this.db.tx(async (q) => {
      await this.requireAdmin(groupId, actor, q);
      await this.requireMember(groupId, debtor, q);
      await this.requireMember(groupId, creditor, q);
      return this.move(q, groupId, 'adjust', actor, creditor, debtor, amount, cleanNote(note));
    });
  }

  /** 撤销一笔还款或调账：还款的双方或管理员可以撤销；调账只有管理员可以撤销 */
  async reverse(groupId: string, actor: string, entryId: unknown) {
    return this.db.tx(async (q) => {
      const a = await this.requireMember(groupId, actor, q);
      const [e] = await q.query<{ id: string; kind: string; gainer_id: string; loser_id: string; amount: number; reversed_by: string | null }>(
        'select id, kind, gainer_id, loser_id, amount, reversed_by from ledger where id = $1 and group_id = $2', [Number(entryId), groupId]);
      if (!e || (e.kind !== 'payment' && e.kind !== 'adjust')) throw new AuthError('这一笔不能撤销');
      if (e.reversed_by !== null) throw new AuthError('已经撤销过了');
      const involved = actor === e.gainer_id || actor === e.loser_id;
      const ok = e.kind === 'payment' ? involved || a.role === 'admin' : a.role === 'admin';
      if (!ok) throw new AuthError('你不能撤销这一笔', 403);
      const id = await this.move(q, groupId, 'reverse', actor, e.loser_id, e.gainer_id, e.amount, null, Number(e.id));
      await q.query('update ledger set reversed_by = $2 where id = $1', [Number(e.id), id]);
    });
  }

  /** 管理员：所有人清零（大家都结清了） */
  async reset(groupId: string, actor: string) {
    await this.db.tx(async (q) => {
      await this.requireAdmin(groupId, actor, q);
      const rows = await q.query<{ user_id: string; balance: number }>('select user_id, balance from group_members where group_id = $1 and balance <> 0', [groupId]);
      if (!rows.length) return;
      await q.query('update group_members set balance = 0 where group_id = $1', [groupId]);
      await q.query(`insert into ledger (group_id, kind, actor_id, amount, data) values ($1, 'reset', $2, 0, $3)`,
        [groupId, actor, JSON.stringify(Object.fromEntries(rows.map((r) => [r.user_id, r.balance])))]);
    });
  }

  /** 一局打完：存战绩；小组局同时把输赢记进小组账本 */
  async recordRound(r: RoundInput) {
    const uids = r.players.map((p) => p.userId);
    if (!uids.some(Boolean)) return;
    await this.db.tx(async (q) => {
      await q.query(
        'insert into matches (id, group_id, players) values ($1, $2, $3) on conflict (id) do nothing',
        [r.matchId, r.groupId, JSON.stringify(r.players)]);
      const [m] = await q.query<{ deltas: Record<string, number> }>('select deltas from matches where id = $1 for update', [r.matchId]);
      const deltas = { ...(m?.deltas ?? {}) };
      r.record.seats.forEach((s, i) => {
        const u = uids[i];
        if (u) deltas[u] = (deltas[u] ?? 0) + s.amount;
      });
      await q.query('update matches set rounds = rounds + 1, deltas = $2, updated_at = now() where id = $1', [r.matchId, JSON.stringify(deltas)]);
      for (const [i, s] of r.record.seats.entries()) {
        const u = uids[i];
        if (!u) continue;
        await q.query(
          `insert into round_results (match_id, group_id, user_id, round, players, won, amount, cards_left, twos_left, tricks_won)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [r.matchId, r.groupId, u, r.record.round, r.players.length, i === r.record.winner, s.amount, s.cardsLeft, s.twosLeft, s.tricksWon]);
        if (r.groupId) await q.query('update group_members set balance = balance + $3 where group_id = $1 and user_id = $2', [r.groupId, u, s.amount]);
      }
    });
  }

  async endMatch(matchId: string) {
    await this.db.query('update matches set ended_at = now() where id = $1 and ended_at is null', [matchId]);
  }

  async profile(userId: string): Promise<ProfileStats> {
    const [s] = await this.db.query<{ rounds: number; wins: number; net: number; best: number | null; worst: number | null; left: number | null; tricks: number | null; matches: number }>(
      `select count(*)::int as rounds,
              count(*) filter (where won)::int as wins,
              coalesce(sum(amount) filter (where group_id is not null), 0)::int as net,
              max(amount) as best, min(amount) as worst,
              avg(cards_left) filter (where not won)::float as left,
              avg(tricks_won)::float as tricks,
              count(distinct match_id)::int as matches
         from round_results where user_id = $1`, [userId]);
    const recent = await this.db.query<{ id: string; updated_at: Date; rounds: number; deltas: Record<string, number>; players: { userId: string | null; name: string }[]; gid: string | null; gname: string | null; gicon: string | null }>(
      `select m.id, m.updated_at, m.rounds, m.deltas, m.players, g.id as gid, g.name as gname, g.icon as gicon
         from matches m left join groups g on g.id = m.group_id
        where m.id in (select match_id from round_results where user_id = $1)
        order by m.updated_at desc limit 15`, [userId]);
    const trendRows = await this.db.query<{ amount: number }>(
      'select amount from round_results where user_id = $1 and group_id is not null order by created_at desc limit 30', [userId]);
    let acc = 0;
    const trend = trendRows.reverse().map((r) => (acc += r.amount));
    return {
      rounds: s.rounds, wins: s.wins, net: s.net, best: s.best ?? 0, worst: s.worst ?? 0,
      avgLeftWhenLosing: s.left === null ? null : Math.round(s.left * 10) / 10,
      tricksPerRound: s.tricks === null ? 0 : Math.round(s.tricks * 10) / 10,
      matches: s.matches,
      recent: recent.map((m) => ({
        id: m.id, at: new Date(m.updated_at).toISOString(), rounds: m.rounds, amount: m.deltas[userId] ?? 0,
        group: m.gid ? { id: m.gid, name: m.gname!, icon: m.gicon! } : null,
        players: m.players.filter((p) => p.userId !== userId).map((p) => p.name),
      })),
      trend,
    };
  }
}

const cleanNote = (n: unknown) => {
  const s = String(n ?? '').trim().slice(0, 60);
  return s || null;
};
