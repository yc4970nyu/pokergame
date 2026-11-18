import type { CardId } from './cards';
import type { Combo } from './combos';
import type { Settlement, RoundRecord } from './game';
import type { TableSummary } from './ledger';

/** What one client is allowed to see about a room. Other players' hands are hidden. */
export interface RoomView {
  code: string;
  hostId: string;
  maxPlayers: 2 | 3 | 4;
  you: string; // your player id
  /** 小组牌桌（不用房间号、不能加机器人、输赢记账）；普通房间为 null */
  group: { id: string; name: string; icon: string } | null;
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
  /** 登录玩家的账号 id；游客和机器人为 null */
  userId: string | null;
  /** emoji 或头像图片地址 */
  avatar: string | null;
}

export interface GameView {
  phase: 'playing' | 'roundOver' | 'matchOver';
  round: number;
  /** 1 副牌或 2 副牌 */
  decks: 1 | 2;
  /** 每人发几张（不含翻牌） */
  handSize: number;
  /** 第几次发牌（重发也算），变了就播发牌动画 */
  dealNo: number;
  /** 开局第一手必须带上的牌（一般是 ♣3） */
  mustInclude: number | null;
  /** 这个座位拿到了四张 2，本把作废、即将重发 */
  redealSeat: number | null;
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
  'room:create': (p: { name: string; token: string; maxPlayers: 2 | 3 | 4 }, ack: (r: Ack) => void) => void;
  'room:join': (p: { code: string; name: string; token: string }, ack: (r: Ack) => void) => void;
  'room:leave': () => void;
  'room:addBot': () => void;
  'room:kick': (p: { playerId: string }) => void;
  'room:setMax': (p: { maxPlayers: 2 | 3 | 4 }) => void;
  'game:start': () => void;
  'game:play': (p: { cards: CardId[] }, ack: (r: Ack) => void) => void;
  'game:pass': (ack: (r: Ack) => void) => void;
  'game:next': () => void;
  /** 结束比赛，停在计分板上 */
  'game:end': () => void;
  /** 清零积分，开一场新比赛 */
  'game:newMatch': () => void;
  /** 小组：在小组里开一张新桌（不用房间号，组员在小组页直接点进来） */
  'group:createTable': (p: { groupId: string; maxPlayers: 2 | 3 | 4 }, ack: (r: Ack) => void) => void;
  /** 打开小组页时订阅这个小组的牌桌和账本变化 */
  'group:watch': (p: { groupId: string }) => void;
  'group:unwatch': (p: { groupId: string }) => void;
}

export interface ServerToClient {
  'room:state': (v: RoomView) => void;
  'room:closed': (reason: string) => void;
  toast: (msg: string) => void;
  /** 小组现在开着的牌桌 */
  'group:tables': (p: { groupId: string; tables: TableSummary[] }) => void;
  /** 小组的账本 / 成员变了，重新拉一下 */
  'group:changed': (p: { groupId: string }) => void;
}

export type Ack = { ok: true; code?: string } | { ok: false; error: string };
