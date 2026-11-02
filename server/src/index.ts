import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ClientToServer, ServerToClient, Ack } from '../../shared/src/protocol';
import { RoomManager, Room } from './rooms';

const PORT = Number(process.env.PORT ?? 3001);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, '../../client/dist');

const app = express();
const http = createServer(app);
const io = new Server<ClientToServer, ServerToClient, object, { playerId?: string }>(http, {
  cors: { origin: true },
  pingInterval: 10_000,
  pingTimeout: 15_000,
});

const rooms = new RoomManager(broadcast);

function broadcast(room: Room) {
  for (const p of room.players) {
    if (!p.socketId) continue;
    io.to(p.socketId).emit('room:state', rooms.view(room, p.id));
  }
}

const fail = (e: unknown): Ack => ({ ok: false, error: e instanceof Error ? e.message : '出错了' });

io.on('connection', (socket) => {
  const guard = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      socket.emit('toast', e instanceof Error ? e.message : '出错了');
    }
  };
  const me = () => socket.data.playerId ?? '';

  socket.on('room:create', ({ name, token, maxPlayers }, ack) => {
    try {
      socket.data.playerId = token;
      const room = rooms.create(token, name, socket.id, maxPlayers === 2 ? 2 : 3);
      ack({ ok: true, code: room.code });
      broadcast(room);
    } catch (e) {
      ack(fail(e));
    }
  });

  socket.on('room:join', ({ code, name, token }, ack) => {
    try {
      socket.data.playerId = token;
      const room = rooms.join(code, token, name, socket.id);
      ack({ ok: true, code: room.code });
      broadcast(room);
    } catch (e) {
      ack(fail(e));
    }
  });

  socket.on('room:leave', () => guard(() => {
    const room = rooms.roomOf(me());
    rooms.leave(me());
    if (room) broadcast(room);
  }));
  socket.on('room:addBot', () => guard(() => rooms.addBot(me())));
  socket.on('room:kick', ({ playerId }) => guard(() => rooms.kick(me(), playerId)));
  socket.on('room:setMax', ({ maxPlayers }) => guard(() => rooms.setMax(me(), maxPlayers === 2 ? 2 : 3)));
  socket.on('game:start', () => guard(() => rooms.start(me())));
  socket.on('game:next', () => guard(() => rooms.next(me())));

  socket.on('game:play', ({ cards }, ack) => {
    try {
      if (!Array.isArray(cards) || !cards.every((c) => Number.isInteger(c) && c >= 0 && c < 52)) throw new Error('无效的牌');
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

app.get('/healthz', (_req, res) => res.json({ ok: true, rooms: rooms.rooms.size }));

if (fs.existsSync(DIST)) {
  app.use(express.static(DIST, { maxAge: '1h', index: false }));
  app.get(/.*/, (_req, res) => res.sendFile(path.join(DIST, 'index.html')));
}

http.listen(PORT, () => console.log(`大老二 server on http://localhost:${PORT}`));
