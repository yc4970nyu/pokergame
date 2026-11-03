import type { CardId } from './cards';
import type { Combo } from './combos';
import type { Settlement, RoundRecord } from './game';

/** What one client is allowed to see about a room. Other players' hands are hidden. */
export interface RoomView {
  code: string;
  hostId: string;
  maxPlayers: 2 | 3;
  you: string; // your player id
  players: PlayerView[];
  game: GameView | null;
}

export interface PlayerView {
  id: string;
  name: string;
  isBot: boolean;
  connected: boolean;
  seat: number;
  cardCount: number;
  score: number;
}

export interface GameView {
  phase: 'playing' | 'roundOver' | 'matchOver';
  round: number;
  turn: number;
  lastPlay: { seat: number; combo: Combo } | null;
  passed: boolean[];
  flipped: CardId | null;
  flippedTo: number | null;
  winner: number | null;
  lastDeltas: number[] | null;
  /** How each loser's payment was computed (round over only) */
  settlement: Settlement | null;
  /** Remaining hands, revealed only when the round is over */
  revealedHands: CardId[][] | null;
  /** 这场比赛每一局的存档，计分板和数据分析用 */
  history: RoundRecord[];
  seq: number;
  lastEvent: string | null;
  yourSeat: number;
  yourHand: CardId[];
}

export interface ClientToServer {
  'room:create': (p: { name: string; token: string; maxPlayers: 2 | 3 }, ack: (r: Ack) => void) => void;
  'room:join': (p: { code: string; name: string; token: string }, ack: (r: Ack) => void) => void;
  'room:leave': () => void;
  'room:addBot': () => void;
  'room:kick': (p: { playerId: string }) => void;
  'room:setMax': (p: { maxPlayers: 2 | 3 }) => void;
  'game:start': () => void;
  'game:play': (p: { cards: CardId[] }, ack: (r: Ack) => void) => void;
  'game:pass': (ack: (r: Ack) => void) => void;
  'game:next': () => void;
  /** 结束比赛，停在计分板上 */
  'game:end': () => void;
  /** 清零积分，开一场新比赛 */
  'game:newMatch': () => void;
}

export interface ServerToClient {
  'room:state': (v: RoomView) => void;
  'room:closed': (reason: string) => void;
  toast: (msg: string) => void;
}

export type Ack = { ok: true; code?: string } | { ok: false; error: string };
