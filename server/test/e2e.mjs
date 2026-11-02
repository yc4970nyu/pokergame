// End-to-end: spin up 3 socket clients (2 humans playing via the bot brain + 1 server bot)
// and play several full rounds through the real server.
import { io } from 'socket.io-client';
import { chooseBotMove } from '../../shared/src/bot.ts';

const URL = process.env.URL ?? 'http://localhost:3001';
const mk = (token, name) => {
  const s = io(URL, { transports: ['websocket'] });
  s.token = token; s.name = name; s.view = null;
  s.on('room:state', (v) => { s.view = v; });
  s.on('toast', (m) => console.log(`[toast→${name}]`, m));
  return s;
};
const ack = (s, ev, p) => new Promise((r) => (p === undefined ? s.emit(ev, r) : s.emit(ev, p, r)));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const a = mk('tok-a', 'Louis');
const b = mk('tok-b', '朋友');
await wait(300);
const r1 = await ack(a, 'room:create', { name: 'Louis', token: 'tok-a', maxPlayers: 3 });
console.log('create', r1);
console.log('join', await ack(b, 'room:join', { code: r1.code, name: '朋友', token: 'tok-b' }));
a.emit('room:addBot');
await wait(200);
console.log('players', a.view.players.map((p) => p.name));
a.emit('game:start');
await wait(300);

// reconnect test mid-game
b.disconnect();
await wait(200);
const b2 = mk('tok-b', '朋友');
await wait(200);
console.log('rejoin', await ack(b2, 'room:join', { code: r1.code, name: '朋友', token: 'tok-b' }));
await wait(200);
console.log('b2 hand size after rejoin', b2.view.game.yourHand.length);

const humans = [a, b2];
let rounds = 0;
const start = Date.now();
while (rounds < 3 && Date.now() - start < 120_000) {
  await wait(40);
  const v = a.view.game;
  if (!v) continue;
  if (v.phase === 'roundOver') {
    rounds++;
    console.log(`round ${v.round} winner=${a.view.players[v.winner].name} deltas=${v.lastDeltas} scores=${a.view.players.map((p) => p.score)}`);
    a.emit('game:next');
    await wait(300);
    continue;
  }
  for (const h of humans) {
    const hv = h.view.game;
    if (hv.phase !== 'playing' || hv.turn !== hv.yourSeat) continue;
    // reconstruct a minimal GameState for the bot brain
    const st = {
      seats: h.view.players.map((p, i) => ({ hand: i === hv.yourSeat ? hv.yourHand : Array(p.cardCount).fill(0) })),
      lastPlay: hv.lastPlay,
    };
    const m = chooseBotMove(st, hv.yourSeat);
    const res = m.type === 'play' ? await ack(h, 'game:play', { cards: m.cards }) : await ack(h, 'game:pass');
    if (!res.ok) { console.log('REJECTED', res); process.exit(1); }
    await wait(60);
  }
}
// illegal move must be rejected
const illegal = await ack(a, 'game:play', { cards: [51, 0] });
console.log('illegal play rejected:', illegal.ok === false, illegal.error);
console.log(rounds >= 3 ? 'E2E OK' : 'E2E TIMEOUT');
process.exit(rounds >= 3 ? 0 : 1);
