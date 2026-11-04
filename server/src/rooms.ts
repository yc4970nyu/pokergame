import {
  GameState, GameError, newGame, play, pass, nextRound, endMatch, newMatch, redeal, chooseBotMove, LogEvent,
  RoomView, CardId, COMBO_NAMES,
} from '../../shared/src/index';

export interface Player {
  id: string; // stable token stored on the client
  name: string;
  isBot: boolean;
  socketId: string | null;
  disconnectedAt: number | null;
}

export interface Room {
  code: string;
  hostId: string;
  maxPlayers: 2 | 3 | 4;
  players: Player[]; // seat order
  game: GameState | null;
  lastEvent: string | null;
  botTimer: NodeJS.Timeout | null;
  updatedAt: number;
  /** when the current round was dealt */
  dealtAt: number;
}

const BOT_NAMES = ['小黑', '阿财', '老K', '雀神', '赌圣'];
/** Clients animate the deal for ~5 s; nobody automated moves before it finishes */
export const DEAL_HOLD_MS = 6_000;
/** 四张 2：发完牌后公示多久再重新洗牌 */
export const FOUR_TWOS_NOTICE_MS = 3_500;

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export class RoomManager {
  rooms = new Map<string, Room>();
  /** player token → room code */
  byPlayer = new Map<string, string>();

  constructor(private onChange: (room: Room) => void) {}

  private newCode(): string {
    for (;;) {
      const code = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
      if (!this.rooms.has(code)) return code;
    }
  }

  roomOf(playerId: string) {
    const code = this.byPlayer.get(playerId);
    return code ? this.rooms.get(code) ?? null : null;
  }

  create(playerId: string, name: string, socketId: string, maxPlayers: 2 | 3 | 4): Room {
    this.leave(playerId);
    const room: Room = {
      code: this.newCode(),
      hostId: playerId,
      maxPlayers,
      players: [{ id: playerId, name: clean(name), isBot: false, socketId, disconnectedAt: null }],
      game: null,
      lastEvent: null,
      botTimer: null,
      updatedAt: Date.now(),
      dealtAt: 0,
    };
    this.rooms.set(room.code, room);
    this.byPlayer.set(playerId, room.code);
    return room;
  }

  join(code: string, playerId: string, name: string, socketId: string): Room {
    const room = this.rooms.get(code.toUpperCase().trim());
    if (!room) throw new GameError('房间不存在');
    const existing = room.players.find((p) => p.id === playerId);
    if (existing) {
      // reconnect
      existing.socketId = socketId;
      existing.disconnectedAt = null;
      if (name) existing.name = clean(name);
      this.byPlayer.set(playerId, room.code);
      this.touch(room);
      return room;
    }
    if (room.game) throw new GameError('游戏已经开始了');
    if (room.players.length >= room.maxPlayers) throw new GameError('房间已满');
    this.leave(playerId);
    room.players.push({ id: playerId, name: clean(name), isBot: false, socketId, disconnectedAt: null });
    this.byPlayer.set(playerId, room.code);
    this.touch(room);
    return room;
  }

  leave(playerId: string) {
    const room = this.roomOf(playerId);
    if (!room) return;
    this.byPlayer.delete(playerId);
    const p = room.players.find((x) => x.id === playerId);
    if (!p) return;
    if (room.game) {
      // mid-game: a bot takes over the seat
      p.isBot = true;
      p.socketId = null;
      p.name = `${p.name}(托管)`;
      p.id = `bot-${Math.random().toString(36).slice(2, 8)}`;
      room.game.seats = room.game.seats.map((s) => (s.id === playerId ? { ...s, id: p.id, isBot: true, name: p.name } : s));
    } else {
      room.players = room.players.filter((x) => x.id !== playerId);
    }
    const humans = room.players.filter((x) => !x.isBot);
    if (humans.length === 0) return this.destroy(room);
    if (room.hostId === playerId) room.hostId = humans[0].id;
    this.touch(room);
  }

  disconnect(socketId: string) {
    for (const room of this.rooms.values()) {
      const p = room.players.find((x) => x.socketId === socketId);
      if (p) {
        p.socketId = null;
        p.disconnectedAt = Date.now();
        this.touch(room);
      }
    }
  }

  addBot(playerId: string) {
    const room = this.requireHost(playerId);
    if (room.game) throw new GameError('游戏已经开始了');
    if (room.players.length >= room.maxPlayers) throw new GameError('房间已满');
    const used = new Set(room.players.map((p) => p.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) ?? `机器人${room.players.length}`;
    room.players.push({ id: `bot-${Math.random().toString(36).slice(2, 8)}`, name, isBot: true, socketId: null, disconnectedAt: null });
    this.touch(room);
  }

  kick(playerId: string, target: string) {
    const room = this.requireHost(playerId);
    if (room.game) throw new GameError('游戏中不能踢人');
    if (target === playerId) return;
    room.players = room.players.filter((p) => p.id !== target);
    this.byPlayer.delete(target);
    this.touch(room);
  }

  setMax(playerId: string, max: 2 | 3 | 4) {
    const room = this.requireHost(playerId);
    if (room.game) throw new GameError('游戏已经开始了');
    if (room.players.length > max) throw new GameError('人数已经超过了');
    room.maxPlayers = max;
    this.touch(room);
  }

  start(playerId: string) {
    const room = this.requireHost(playerId);
    if (room.game) throw new GameError('游戏已经开始了');
    if (room.players.length < 2) throw new GameError('至少需要 2 名玩家（可以加机器人）');
    room.game = newGame(room.players.map((p) => ({ id: p.id, name: p.name, isBot: p.isBot })));
    room.dealtAt = Date.now();
    room.lastEvent = describe(room, room.game.log);
    this.touch(room);
  }

  play(playerId: string, cards: CardId[]) {
    const { room, seat } = this.requireSeat(playerId);
    room.game = play(room.game!, seat, cards);
    room.lastEvent = describe(room, room.game.log);
    this.touch(room);
  }

  pass(playerId: string) {
    const { room, seat } = this.requireSeat(playerId);
    room.game = pass(room.game!, seat);
    room.lastEvent = describe(room, room.game.log);
    this.touch(room);
  }

  next(playerId: string) {
    const room = this.roomOf(playerId);
    if (!room?.game) throw new GameError('没有进行中的游戏');
    if (room.game.phase !== 'roundOver') return;
    room.game = nextRound(room.game);
    room.dealtAt = Date.now();
    room.lastEvent = describe(room, room.game.log);
    this.touch(room);
  }

  /** 结束比赛，所有人停在计分板上 */
  end(playerId: string) {
    const room = this.roomOf(playerId);
    if (!room?.game) throw new GameError('没有进行中的游戏');
    if (room.game.phase === 'matchOver') return;
    room.game = endMatch(room.game);
    room.lastEvent = '比赛结束';
    this.touch(room);
  }

  /** 积分清零，重新开一场 */
  newMatch(playerId: string) {
    const room = this.roomOf(playerId);
    if (!room?.game) throw new GameError('没有进行中的游戏');
    room.game = newMatch(room.game);
    room.dealtAt = Date.now();
    room.lastEvent = describe(room, room.game.log);
    this.touch(room);
  }

  /** Called after every change: schedules bot / auto-play moves. */
  scheduleBots(room: Room) {
    if (room.botTimer) clearTimeout(room.botTimer);
    room.botTimer = null;
    const g = room.game;
    if (!g || g.phase !== 'playing') return;
    if (g.redealSeat !== null) {
      // 先让大家看完发牌和「四张 2」的提示，再重新洗牌发牌
      const seq = g.seq;
      const wait = Math.max(0, room.dealtAt + DEAL_HOLD_MS + FOUR_TWOS_NOTICE_MS - Date.now());
      room.botTimer = setTimeout(() => {
        room.botTimer = null;
        if (!room.game || room.game.seq !== seq || room.game.redealSeat === null) return;
        room.game = redeal(room.game);
        room.dealtAt = Date.now();
        room.lastEvent = describe(room, room.game.log);
        this.touch(room);
      }, wait);
      return;
    }
    const p = room.players[g.turn];
    let delay: number | null = null;
    // 只有机器人会自动出牌。真人（哪怕掉线了）永远等他自己点「出牌」或「不要」，绝不替他决定。
    if (p.isBot) delay = 650 + Math.random() * 600;
    if (delay === null) return;
    // let everyone's deal animation finish before the first automated move
    delay = Math.max(delay, room.dealtAt + DEAL_HOLD_MS - Date.now());
    const seq = g.seq;
    room.botTimer = setTimeout(() => {
      room.botTimer = null;
      if (!room.game || room.game.seq !== seq) return;
      const cur = room.players[room.game.turn];
      if (!cur.isBot) return;
      const move = chooseBotMove(room.game, room.game.turn);
      room.game = move.type === 'play' ? play(room.game, room.game.turn, move.cards) : pass(room.game, room.game.turn);
      room.lastEvent = describe(room, room.game.log);
      this.touch(room);
    }, delay);
  }

  view(room: Room, playerId: string): RoomView {
    const g = room.game;
    const yourSeat = room.players.findIndex((p) => p.id === playerId);
    return {
      code: room.code,
      hostId: room.hostId,
      maxPlayers: room.maxPlayers,
      you: playerId,
      players: room.players.map((p, i) => ({
        id: p.id,
        name: p.name,
        isBot: p.isBot,
        connected: p.isBot || !!p.socketId,
        seat: i,
        cardCount: g ? g.seats[i].hand.length : 0,
        score: g ? g.seats[i].score : 0,
      })),
      game: g
        ? {
            phase: g.phase,
            round: g.round,
            decks: g.config.decks,
            handSize: g.config.handSize,
            dealNo: g.dealNo,
            mustInclude: g.mustInclude,
            redealSeat: g.redealSeat,
            turn: g.turn,
            lastPlay: g.lastPlay,
            passed: g.passed,
            flipped: g.flipped,
            flippedTo: g.flippedTo,
            winner: g.winner,
            lastDeltas: g.lastDeltas,
            settlement: g.lastSettlement,
            revealedHands: g.phase === 'playing' ? null : g.seats.map((s) => s.hand),
            history: g.history,
            seq: g.seq,
            lastEvent: room.lastEvent,
            yourSeat,
            yourHand: yourSeat >= 0 ? g.seats[yourSeat].hand : [],
          }
        : null,
    };
  }

  /** Remove rooms nobody has touched in a while. */
  sweep(maxIdleMs = 30 * 60_000) {
    const now = Date.now();
    for (const room of this.rooms.values()) {
      const anyoneHere = room.players.some((p) => !p.isBot && p.socketId);
      if (!anyoneHere && now - room.updatedAt > maxIdleMs) this.destroy(room);
    }
  }

  private destroy(room: Room) {
    if (room.botTimer) clearTimeout(room.botTimer);
    for (const p of room.players) if (this.byPlayer.get(p.id) === room.code) this.byPlayer.delete(p.id);
    this.rooms.delete(room.code);
  }

  touch(room: Room) {
    room.updatedAt = Date.now();
    this.scheduleBots(room);
    this.onChange(room);
  }

  private requireHost(playerId: string): Room {
    const room = this.roomOf(playerId);
    if (!room) throw new GameError('你不在房间里');
    if (room.hostId !== playerId) throw new GameError('只有房主可以这样做');
    return room;
  }

  private requireSeat(playerId: string) {
    const room = this.roomOf(playerId);
    if (!room?.game) throw new GameError('没有进行中的游戏');
    const seat = room.players.findIndex((p) => p.id === playerId);
    if (seat < 0) throw new GameError('你不在这局里');
    return { room, seat };
  }
}

const clean = (name: string) => (name || '玩家').trim().slice(0, 12) || '玩家';

function describe(room: Room, log: LogEvent[]): string | null {
  const nm = (s: number) => room.players[s]?.name ?? '?';
  const parts: string[] = [];
  for (const e of log) {
    if (e.kind === 'deal') parts.push(`第 ${room.game!.round} 局开始，${nm(e.leader)} ${e.flipped === null ? '先出' : '拿到翻牌，先出'}`);
    if (e.kind === 'play') parts.push(`${nm(e.seat)} 出了${COMBO_NAMES[e.combo.type]}`);
    if (e.kind === 'pass') parts.push(`${nm(e.seat)} 不要`);
    if (e.kind === 'newTrick') parts.push(`${nm(e.leader)} 获得出牌权`);
    if (e.kind === 'fourTwos') parts.push(`${nm(e.seat)} 拿到四张 2，重新洗牌发牌`);
    if (e.kind === 'roundOver') parts.push(`${nm(e.winner)} 出完了！+${e.deltas[e.winner]}`);
  }
  return parts.join('，') || null;
}
