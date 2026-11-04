import { io, Socket } from 'socket.io-client';
import { useSyncExternalStore } from 'react';
import type { ClientToServer, ServerToClient, RoomView, Ack } from '../../shared/src/protocol';
import { voice } from './voice';

const store = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string | null) {
    try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ }
  },
};

export const token: string = (() => {
  let t = store.get('dld.token');
  if (!t) {
    t = (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)) as string;
    store.set('dld.token', t);
  }
  return t;
})();

export const savedName = () => store.get('dld.name') ?? '';
export const saveName = (n: string) => store.set('dld.name', n);

export const socket: Socket<ServerToClient, ClientToServer> = io({ transports: ['websocket', 'polling'] });

interface NetState {
  room: RoomView | null;
  connected: boolean;
  toast: { id: number; text: string } | null;
}
let state: NetState = { room: null, connected: false, toast: null };
const subs = new Set<() => void>();
const set = (patch: Partial<NetState>) => {
  state = { ...state, ...patch };
  subs.forEach((f) => f());
};
export const useNet = () =>
  useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => state);

let toastId = 0;
export const toast = (text: string) => {
  const id = ++toastId;
  set({ toast: { id, text } });
  setTimeout(() => { if (state.toast?.id === id) set({ toast: null }); }, 2200);
};

socket.on('connect', () => {
  set({ connected: true });
  // auto-rejoin after reload / network blip
  const code = store.get('dld.room');
  if (code) socket.emit('room:join', { code, name: savedName(), token }, (r) => { if (!r.ok) store.set('dld.room', null); });
});
socket.on('disconnect', () => set({ connected: false }));
socket.on('room:state', (room) => {
  // 语音要在出牌那一刻响：先播，再交给 React 渲染
  voice.preload();
  voice.onState(room.game);
  store.set('dld.room', room.code);
  set({ room });
});
socket.on('toast', (m) => toast(m));

const withAck = (fn: (cb: (r: Ack) => void) => void) =>
  new Promise<Ack>((resolve) => fn(resolve));

export const api = {
  create: (name: string, maxPlayers: 2 | 3 | 4) =>
    withAck((cb) => socket.emit('room:create', { name, token, maxPlayers }, cb)),
  join: (code: string, name: string) =>
    withAck((cb) => socket.emit('room:join', { code, name, token }, cb)),
  leave: () => {
    socket.emit('room:leave');
    store.set('dld.room', null);
    set({ room: null });
  },
  addBot: () => socket.emit('room:addBot'),
  kick: (playerId: string) => socket.emit('room:kick', { playerId }),
  setMax: (maxPlayers: 2 | 3 | 4) => socket.emit('room:setMax', { maxPlayers }),
  start: () => socket.emit('game:start'),
  next: () => socket.emit('game:next'),
  end: () => socket.emit('game:end'),
  newMatch: () => socket.emit('game:newMatch'),
  play: (cards: number[]) => withAck((cb) => socket.emit('game:play', { cards }, cb)),
  pass: () => withAck((cb) => socket.emit('game:pass', cb)),
};
