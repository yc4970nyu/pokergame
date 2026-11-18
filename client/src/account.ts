// 登录状态 + 小组接口
import { useSyncExternalStore } from 'react';
import type { GroupSummary, MeView, GroupDetail, ProfileStats, TableSummary } from '../../shared/src/ledger';
import { socket } from './net';

interface AccountState {
  loaded: boolean;
  user: MeView | null;
  groups: GroupSummary[];
  googleClientId: string | null;
}

let state: AccountState = { loaded: false, user: null, groups: [], googleClientId: null };
const subs = new Set<() => void>();
const set = (patch: Partial<AccountState>) => {
  state = { ...state, ...patch };
  subs.forEach((f) => f());
};
export const useAccount = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => state);
export const getAccount = () => state;

export class HttpError extends Error {
  constructor(msg: string, public status: number) { super(msg); }
}

export async function http<T = unknown>(method: string, url: string, body?: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new HttpError('连不上服务器', 0);
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new HttpError(data.error ?? '出错了', r.status);
  return data as T;
}

export async function refreshAccount() {
  try {
    const [me, cfg] = await Promise.all([
      http<{ user: MeView | null; groups: GroupSummary[] }>('GET', '/api/me'),
      state.loaded ? Promise.resolve({ googleClientId: state.googleClientId }) : http<{ googleClientId: string | null }>('GET', '/api/config'),
    ]);
    set({ loaded: true, user: me.user, groups: me.groups, googleClientId: cfg.googleClientId });
    retry = 1000;
  } catch {
    // 服务器在重启 / 休眠唤醒：别当成没登录，过一会再试
    clearTimeout(retryTimer);
    retryTimer = setTimeout(refreshAccount, retry);
    retry = Math.min(retry * 2, 10_000);
  }
}
let retry = 1000;
let retryTimer: ReturnType<typeof setTimeout> | undefined;

/** 登录状态变了：socket 重连一下，服务器才知道你是谁 */
const reconnect = () => { socket.disconnect(); socket.connect(); };

async function signedIn(p: Promise<{ user: MeView }>) {
  const { user } = await p;
  set({ user });
  reconnect();
  await refreshAccount();
  return user;
}

export const account = {
  google: (credential: string) => signedIn(http('POST', '/api/auth/google', { credential })),
  login: (username: string, password: string) => signedIn(http('POST', '/api/auth/login', { username, password })),
  register: (username: string, password: string, name: string) => signedIn(http('POST', '/api/auth/register', { username, password, name })),
  logout: async () => {
    await http('POST', '/api/auth/logout');
    try { (window as unknown as { google?: { accounts: { id: { disableAutoSelect(): void } } } }).google?.accounts.id.disableAutoSelect(); } catch { /* ignore */ }
    set({ user: null, groups: [] });
    reconnect();
  },
  updateMe: async (patch: { name?: string; avatar?: string | null }) => {
    const { user } = await http<{ user: MeView }>('PATCH', '/api/me', patch);
    set({ user });
  },
  stats: () => http<ProfileStats>('GET', '/api/me/stats'),
};

export type GroupFull = GroupDetail & { tables: TableSummary[] };

export const groupsApi = {
  create: (name: string, icon: string) => http<{ id: string }>('POST', '/api/groups', { name, icon }),
  get: (id: string) => http<GroupFull>('GET', `/api/groups/${id}`),
  update: (id: string, patch: { name?: string; icon?: string }) => http('PATCH', `/api/groups/${id}`, patch),
  rotateInvite: (id: string) => http('POST', `/api/groups/${id}/invite`),
  setRole: (id: string, uid: string, role: 'admin' | 'member') => http('POST', `/api/groups/${id}/members/${uid}/role`, { role }),
  remove: (id: string, uid: string) => http('DELETE', `/api/groups/${id}/members/${uid}`),
  payment: (id: string, from: string, to: string, amount: number, note?: string) => http('POST', `/api/groups/${id}/payments`, { from, to, amount, note }),
  adjust: (id: string, debtor: string, creditor: string, amount: number, note?: string) => http('POST', `/api/groups/${id}/adjust`, { debtor, creditor, amount, note }),
  reset: (id: string) => http('POST', `/api/groups/${id}/reset`),
  reverse: (id: string, entry: number) => http('POST', `/api/groups/${id}/ledger/${entry}/reverse`),
  invite: (code: string) => http<{ id: string; name: string; icon: string; members: number }>('GET', `/api/invite/${code}`),
  join: (code: string) => http<{ id: string }>('POST', `/api/invite/${code}/join`),
};

refreshAccount();
// 断线重连（服务器重启、手机切回来）后顺便刷新一下登录状态和小组余额
let firstConnect = true;
socket.on('connect', () => { if (firstConnect) firstConnect = false; else refreshAccount(); });
