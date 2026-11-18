// 小组账本相关的共用类型和算法（前后端都用）

export interface UserView {
  id: string;
  name: string;
  /** 自己选的 emoji 头像；没有就用 picture 或名字首字 */
  avatar: string | null;
  picture: string | null;
}

export interface MeView extends UserView {
  email: string | null;
  username: string | null;
  hasGoogle: boolean;
}

export type Role = 'admin' | 'member';

export interface GroupSummary {
  id: string;
  name: string;
  icon: string;
  role: Role;
  balance: number;
  members: number;
  /** 现在开着的桌数 */
  tables: number;
}

export interface MemberView extends UserView {
  role: Role;
  balance: number;
  rounds: number;
  wins: number;
}

export type LedgerKind = 'payment' | 'adjust' | 'reset' | 'reverse';

export interface ActivityItem {
  id: string;
  at: string;
  kind: LedgerKind | 'match' | 'join';
  actor: string | null;
  /** 收钱（余额变多）的人 */
  gainer?: string | null;
  /** 付钱（余额变少）的人 */
  loser?: string | null;
  amount?: number;
  note?: string | null;
  /** 记账条目的 id（可以撤销的那些） */
  entryId?: number;
  reversed?: boolean;
  /** 比赛：局数和每个人的输赢 */
  rounds?: number;
  deltas?: Record<string, number>;
  live?: boolean;
}

export interface TableSummary {
  code: string;
  maxPlayers: 2 | 3 | 4;
  phase: 'lobby' | 'playing' | 'over';
  round: number;
  players: { userId: string; name: string; connected: boolean }[];
}

export interface GroupDetail {
  id: string;
  name: string;
  icon: string;
  inviteCode: string;
  you: string;
  role: Role;
  members: MemberView[];
  activity: ActivityItem[];
}

export interface Transfer { from: string; to: string; amount: number }

/**
 * 怎么结清：输的人（余额为负）付给赢的人（余额为正），笔数尽量少。
 * 每次让欠得最多的人付给被欠得最多的人。
 */
export function settleUp(balances: { id: string; balance: number }[]): Transfer[] {
  const debt = balances.filter((b) => b.balance < 0).map((b) => ({ id: b.id, v: -b.balance }));
  const cred = balances.filter((b) => b.balance > 0).map((b) => ({ id: b.id, v: b.balance }));
  const out: Transfer[] = [];
  for (;;) {
    debt.sort((a, b) => b.v - a.v);
    cred.sort((a, b) => b.v - a.v);
    const d = debt[0];
    const c = cred[0];
    if (!d || !c || d.v <= 0 || c.v <= 0) break;
    const amt = Math.min(d.v, c.v);
    out.push({ from: d.id, to: c.id, amount: amt });
    d.v -= amt;
    c.v -= amt;
    if (d.v === 0) debt.shift();
    if (c.v === 0) cred.shift();
  }
  return out;
}

export interface ProfileStats {
  rounds: number;
  wins: number;
  /** 小组局的总输赢 */
  net: number;
  best: number;
  worst: number;
  avgLeftWhenLosing: number | null;
  tricksPerRound: number;
  matches: number;
  recent: { id: string; at: string; group: { id: string; name: string; icon: string } | null; rounds: number; amount: number; players: string[] }[];
  /** 最近 30 局的累计输赢（小组局） */
  trend: number[];
}

export const EMOJI_ICONS = ['🃏', '♠️', '♥️', '♦️', '♣️', '🀄', '🎲', '🍻', '🍜', '🏠', '🌙', '🔥', '🐉', '🐯', '🦊', '🐼', '🍀', '💰', '👑', '⭐'];
