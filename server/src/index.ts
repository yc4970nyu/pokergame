import express, { type Request, type Response, type NextFunction } from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ClientToServer, ServerToClient, Ack } from '../../shared/src/protocol';
import { RoomManager, Room } from './rooms';
import { openDb } from './db';
import { Auth, AuthError, COOKIE, User, parseCookies, setSessionCookie, clearSessionCookie, verifyGoogle, rateLimit } from './auth';
import { Groups } from './groups';

try { process.loadEnvFile('.env'); } catch { /* 没有 .env 就算了 */ }

// 开发时 Vite 占着 5173 并把 /api、/socket.io 转到 3001，所以开发模式固定用 3001
const PORT = Number(process.env.NODE_ENV === 'production' ? process.env.PORT ?? 3001 : 3001);
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? '';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, '../../client/dist');

const db = await openDb();
const auth = new Auth(db);

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '20kb' }));
const http = createServer(app);
const io = new Server<ClientToServer, ServerToClient, object, { playerId?: string; userId?: string }>(http, {
  cors: { origin: true, credentials: true },
  pingInterval: 10_000,
  pingTimeout: 15_000,
});

const lastTables = new Map<string, string>();
const rooms = new RoomManager(broadcast, {
  onRoundOver: (room) => {
    const g = room.game!;
    const record = g.history[g.history.length - 1];
    if (!room.matchId || !record || room.players.some((p) => p.isBot)) return; // 有机器人的局不进战绩
    groups
      .recordRound({ matchId: room.matchId, groupId: room.group?.id ?? null, players: room.players.map((p) => ({ userId: p.userId, name: p.name })), record })
      .then(() => { if (room.group) groupChanged(room.group.id); })
      .catch((e) => console.error('recordRound failed', e));
  },
  onMatchEnd: (matchId) => { groups.endMatch(matchId).catch((e) => console.error('endMatch failed', e)); },
  onTables: (groupId) => {
    const tables = rooms.tablesFor(groupId);
    const json = JSON.stringify(tables);
    if (lastTables.get(groupId) === json) return;
    lastTables.set(groupId, json);
    io.to(`g:${groupId}`).emit('group:tables', { groupId, tables });
  },
});
const groups = new Groups(db, (id) => rooms.isLiveMatch(id), (id) => rooms.tablesFor(id).filter((t) => t.phase !== 'over').length);
const groupChanged = (groupId: string) => io.to(`g:${groupId}`).emit('group:changed', { groupId });

function broadcast(room: Room) {
  for (const p of room.players) {
    if (!p.socketId) continue;
    io.to(p.socketId).emit('room:state', rooms.view(room, p.id));
  }
}

const fail = (e: unknown): Ack => ({ ok: false, error: e instanceof Error ? e.message : '出错了' });
const avatarOf = (u: User) => u.avatar ?? u.picture ?? null;
const playerIdOf = (userId: string) => `u:${userId}`;

// ---------------- HTTP API ----------------

type Authed = Request & { user?: User };
const api = (fn: (req: Authed, res: Response) => Promise<unknown>, needUser = true) =>
  async (req: Authed, res: Response, _next: NextFunction) => {
    try {
      const token = parseCookies(req.headers.cookie)[COOKIE];
      const s = await auth.fromToken(token);
      if (s) {
        req.user = s.user;
        if (s.renew) setSessionCookie(req, res, token);
      }
      if (needUser && !req.user) throw new AuthError('请先登录', 401);
      const out = await fn(req, res);
      if (!res.headersSent) res.json(out ?? { ok: true });
    } catch (e) {
      const status = e instanceof AuthError ? e.status : 500;
      if (status === 500) console.error(e);
      res.status(status).json({ error: e instanceof Error && status !== 500 ? e.message : '服务器出错了' });
    }
  };
const signIn = async (req: Request, res: Response, user: User) => {
  setSessionCookie(req, res, await auth.createSession(user.id));
  return { user };
};
const ip = (req: Request) => req.ip ?? 'x';

app.get('/api/config', (_req, res) => res.json({ googleClientId: GOOGLE_CLIENT_ID || null }));
app.get('/api/me', api(async (req) => ({ user: req.user ?? null, groups: req.user ? await groups.listFor(req.user.id) : [] }), false));
app.post('/api/auth/google', api(async (req, res) => {
  if (!GOOGLE_CLIENT_ID) throw new AuthError('服务器还没配置 Google 登录');
  rateLimit(ip(req));
  return signIn(req, res, await auth.googleLogin(await verifyGoogle(req.body?.credential, GOOGLE_CLIENT_ID)));
}, false));
app.post('/api/auth/register', api(async (req, res) => {
  rateLimit(ip(req));
  return signIn(req, res, await auth.register(req.body?.username, req.body?.password, req.body?.name));
}, false));
app.post('/api/auth/login', api(async (req, res) => {
  rateLimit(ip(req));
  return signIn(req, res, await auth.passwordLogin(req.body?.username, req.body?.password));
}, false));
app.post('/api/auth/logout', api(async (req, res) => {
  await auth.logout(parseCookies(req.headers.cookie)[COOKIE]);
  clearSessionCookie(res);
}, false));
app.patch('/api/me', api(async (req) => {
  const user = await auth.updateProfile(req.user!.id, req.body ?? {});
  // 改了名字 / 头像：还没开打的牌桌上也跟着变
  const room = rooms.roomOf(playerIdOf(user.id));
  const p = room?.players.find((x) => x.userId === user.id);
  if (room && p && !room.game) { p.name = user.name; p.avatar = avatarOf(user); rooms.touch(room); }
  return { user };
}));
app.get('/api/me/stats', api(async (req) => groups.profile(req.user!.id)));

app.post('/api/groups', api(async (req) => ({ id: await groups.create(req.user!.id, req.body?.name, req.body?.icon) })));
app.get('/api/groups/:id', api(async (req) => ({
  ...(await groups.detail(String(req.params.id), req.user!.id)),
  tables: rooms.tablesFor(String(req.params.id)),
})));
const mutate = (fn: (req: Authed, gid: string, uid: string) => Promise<unknown>) =>
  api(async (req) => {
    const gid = String(req.params.id);
    await fn(req, gid, req.user!.id);
    groupChanged(gid);
    return { ok: true };
  });
app.patch('/api/groups/:id', mutate((req, gid, uid) => groups.update(gid, uid, req.body ?? {}).then(() => syncGroupRef(gid))));
app.post('/api/groups/:id/invite', mutate((_req, gid, uid) => groups.rotateInvite(gid, uid)));
app.post('/api/groups/:id/members/:uid/role', mutate((req, gid, uid) => groups.setRole(gid, uid, String(req.params.uid), req.body?.role)));
app.delete('/api/groups/:id/members/:uid', mutate((req, gid, uid) => groups.removeMember(gid, uid, String(req.params.uid))));
app.post('/api/groups/:id/payments', mutate((req, gid, uid) => groups.payment(gid, uid, String(req.body?.from), String(req.body?.to), req.body?.amount, req.body?.note)));
app.post('/api/groups/:id/adjust', mutate((req, gid, uid) => groups.adjust(gid, uid, String(req.body?.debtor), String(req.body?.creditor), req.body?.amount, req.body?.note)));
app.post('/api/groups/:id/reset', mutate((_req, gid, uid) => groups.reset(gid, uid)));
app.post('/api/groups/:id/ledger/:entry/reverse', mutate((req, gid, uid) => groups.reverse(gid, uid, req.params.entry)));
app.get('/api/invite/:code', api(async (req) => groups.invitePreview(String(req.params.code)), false));
app.post('/api/invite/:code/join', api(async (req) => {
  const id = await groups.join(String(req.params.code), req.user!.id);
  groupChanged(id);
  return { id };
}));

/** 改了小组名字 / 图标，开着的牌桌也跟着改 */
async function syncGroupRef(groupId: string) {
  const [g] = await db.query<{ name: string; icon: string }>('select name, icon from groups where id = $1', [groupId]);
  if (!g) return;
  for (const r of rooms.rooms.values()) if (r.group?.id === groupId) { r.group = { id: groupId, ...g }; rooms.touch(r); }
}

app.get('/healthz', (_req, res) => res.json({ ok: true, rooms: rooms.rooms.size }));

// ---------------- Socket.IO ----------------

io.use(async (socket, next) => {
  try {
    const s = await auth.fromToken(parseCookies(socket.handshake.headers.cookie)[COOKIE]);
    if (s) socket.data.userId = s.user.id;
  } catch (e) {
    console.error('socket auth failed', e);
  }
  next();
});

io.on('connection', (socket) => {
  const guard = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      socket.emit('toast', e instanceof Error ? e.message : '出错了');
    }
  };
  const me = () => socket.data.playerId ?? '';
  /** 登录了就用账号当身份（换设备也能回到座位）；没登录用浏览器里存的 token */
  const identify = async (token: string, name: string) => {
    const user = socket.data.userId ? await auth.userById(socket.data.userId) : null;
    socket.data.playerId = user ? playerIdOf(user.id) : String(token);
    return { user, name: user?.name ?? name, who: { userId: user?.id ?? null, avatar: user ? avatarOf(user) : null } };
  };

  socket.on('room:create', async ({ name, token, maxPlayers }, ack) => {
    try {
      const id = await identify(token, name);
      const room = rooms.create(me(), id.name, socket.id, maxPlayers === 2 ? 2 : maxPlayers === 4 ? 4 : 3, id.who);
      ack({ ok: true, code: room.code });
      broadcast(room);
    } catch (e) {
      ack(fail(e));
    }
  });

  socket.on('room:join', async ({ code, name, token }, ack) => {
    try {
      const id = await identify(token, name);
      const target = rooms.rooms.get(String(code).toUpperCase().trim());
      if (target?.group) {
        if (!id.user) throw new AuthError('这是小组牌桌，要先登录');
        if (!(await groups.member(target.group.id, id.user.id))) throw new AuthError('你不在这个小组里');
      }
      const room = rooms.join(code, me(), id.name, socket.id, id.who);
      ack({ ok: true, code: room.code });
      broadcast(room);
    } catch (e) {
      ack(fail(e));
    }
  });

  socket.on('group:createTable', async ({ groupId, maxPlayers }, ack) => {
    try {
      const id = await identify('', '');
      if (!id.user) throw new AuthError('要先登录');
      if (!(await groups.member(String(groupId), id.user.id))) throw new AuthError('你不在这个小组里');
      const [g] = await db.query<{ id: string; name: string; icon: string }>('select id, name, icon from groups where id = $1', [String(groupId)]);
      const room = rooms.create(me(), id.name, socket.id, maxPlayers === 2 ? 2 : maxPlayers === 4 ? 4 : 3, id.who, g);
      ack({ ok: true, code: room.code });
      broadcast(room);
    } catch (e) {
      ack(fail(e));
    }
  });

  socket.on('group:watch', async ({ groupId }) => {
    const gid = String(groupId);
    if (!socket.data.userId || !(await groups.member(gid, socket.data.userId))) return;
    socket.join(`g:${gid}`);
    socket.emit('group:tables', { groupId: gid, tables: rooms.tablesFor(gid) });
  });
  socket.on('group:unwatch', ({ groupId }) => { socket.leave(`g:${String(groupId)}`); });

  socket.on('room:leave', () => guard(() => {
    const room = rooms.roomOf(me());
    rooms.leave(me());
    if (room) broadcast(room);
  }));
  socket.on('room:addBot', () => guard(() => rooms.addBot(me())));
  socket.on('room:kick', ({ playerId }) => guard(() => rooms.kick(me(), playerId)));
  socket.on('room:setMax', ({ maxPlayers }) => guard(() => rooms.setMax(me(), maxPlayers === 2 ? 2 : maxPlayers === 4 ? 4 : 3)));
  socket.on('game:start', () => guard(() => rooms.start(me())));
  socket.on('game:next', () => guard(() => rooms.next(me())));
  socket.on('game:end', () => guard(() => rooms.end(me())));
  socket.on('game:newMatch', () => guard(() => rooms.newMatch(me())));

  socket.on('game:play', ({ cards }, ack) => {
    try {
      if (!Array.isArray(cards) || !cards.every((c) => Number.isInteger(c) && c >= 0 && c < 104)) throw new Error('无效的牌');
      rooms.play(me(), cards);
      ack({ ok: true });
    } catch (e) {
      ack(fail(e));
    }
  });

  socket.on('game:pass', (ack) => {
    try {
      rooms.pass(me());
      ack({ ok: true });
    } catch (e) {
      ack(fail(e));
    }
  });

  socket.on('disconnect', () => rooms.disconnect(socket.id));
});

setInterval(() => rooms.sweep(), 60_000).unref();

if (fs.existsSync(DIST)) {
  app.use(express.static(DIST, { maxAge: '1h', index: false }));
  app.get(/.*/, (_req, res) => res.sendFile(path.join(DIST, 'index.html')));
}

http.listen(PORT, () => console.log(`大老二 server on http://localhost:${PORT}`));
