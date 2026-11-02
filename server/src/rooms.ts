import {
  GameState, GameError, newGame, play, pass, nextRound, chooseBotMove, LogEvent,
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
  maxPlayers: 2 | 3;
  players: Player[]; // seat order
  game: GameState | null;
  lastEvent: string | null;
  botTimer: NodeJS.Timeout | null;
  updatedAt: number;
}

const BOT_NAMES = ['小黑', '阿财', '老K', '雀神', '赌圣'];
/** A disconnected human is auto-played after this long on their turn */
export const AUTOPLAY_AFTER_MS = 20_000;

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

  create(playerId: string, name: string, socketId: string, maxPlayers: 2 | 3): Room {
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

  setMax(playerId: string, max: 2 | 3) {
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
    room.lastEvent = describe(room, room.game.log);
    this.touch(room);
  }

  /** Called after every change: schedules bot / auto-play moves. */
  scheduleBots(room: Room) {
    if (room.botTimer) clearTimeout(room.botTimer);
    room.botTimer = null;
    const g = room.game;
    if (!g || g.phase !== 'playing') return;
    const p = room.players[g.turn];
    let delay: number | null = null;
    if (p.isBot) delay = 650 + Math.random() * 600;
    else if (p.disconnectedAt) delay = Math.max(500, AUTOPLAY_AFTER_MS - (Date.now() - p.disconnectedAt));
    if (delay === null) return;
    const seq = g.seq;
    room.botTimer = setTimeout(() => {
      room.botTimer = null;
      if (!room.game || room.game.seq !== seq) return;
      const cur = room.players[room.game.turn];
      if (!cur.isBot && !cur.disconnectedAt) return;
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
            turn: g.turn,
            lastPlay: g.lastPlay,
            passed: g.passed,
            flipped: g.flipped,
            flippedTo: g.flippedTo,
            winner: g.winner,
            lastDeltas: g.lastDeltas,
            revealedHands: g.phase === 'roundOver' ? g.seats.map((s) => s.hand) : null,
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

  private touch(room: Room) {
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
    if (e.kind === 'deal') parts.push(`第 ${room.game!.round} 局开始，${nm(e.leader)} 拿到翻牌，先出`);
    if (e.kind === 'play') parts.push(`${nm(e.seat)} 出了${COMBO_NAMES[e.combo.type]}`);
    if (e.kind === 'pass') parts.push(`${nm(e.seat)} 不要`);
    if (e.kind === 'newTrick') parts.push(`${nm(e.leader)} 获得出牌权`);
    if (e.kind === 'roundOver') parts.push(`${nm(e.winner)} 出完了！+${e.deltas[e.winner]} 分`);
  }
  return parts.join('，') || null;
}
