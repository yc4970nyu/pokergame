import { CardId, fullDeck, shuffle, sortCards, rankOf, cardLabel } from './cards';
import { Combo, canBeat, identify, isBomb, playableCombos, COMBO_NAMES } from './combos';

export interface GameConfig {
  /** Cards each player is dealt (before the flipped card is added). 17 for 2 or 3 players. */
  handSize: number;
  /** Losers also lose the cards they're left with (zero-sum). If false, only the winner scores. */
  losersLosePoints: boolean;
}

export const DEFAULT_CONFIG: GameConfig = { handSize: 17, losersLosePoints: true };

/** How one loser's payment was worked out, for the result screen */
export interface Payment {
  seat: number;
  cards: number; // cards left in hand
  over10: boolean; // 10 or more left → ×2
  twos: number; // 2s left in hand → ×2 each
  tailTwo: boolean; // winner went out on a 2 or a pair of 2s → ×2 for everyone
  multiplier: number;
  amount: number; // cards × multiplier
}

export interface Settlement {
  winner: number;
  tailTwo: boolean;
  payments: Payment[];
  total: number;
}

const RANK_TWO = 12;

/**
 * 算钱：
 *  - 每个输家基础 = 手里剩的张数
 *  - 剩 10 张或更多：×2
 *  - 手里每剩一张 2：再 ×2（一张 ×2，两张 ×4 …）
 *  - 尾二：赢家最后出的是单张 2 或一对 2 → 所有人再 ×2
 */
export function settle(hands: CardId[][], winner: number, finalCombo: Combo): Settlement {
  const tailTwo =
    (finalCombo.type === 'single' || finalCombo.type === 'pair') && finalCombo.cards.every((c) => rankOf(c) === RANK_TWO);
  const payments: Payment[] = [];
  hands.forEach((hand, seat) => {
    if (seat === winner) return;
    const cards = hand.length;
    const over10 = cards >= 10;
    const twos = hand.filter((c) => rankOf(c) === RANK_TWO).length;
    const multiplier = (over10 ? 2 : 1) * 2 ** twos * (tailTwo ? 2 : 1);
    payments.push({ seat, cards, over10, twos, tailTwo, multiplier, amount: cards * multiplier });
  });
  return { winner, tailTwo, payments, total: payments.reduce((a, p) => a + p.amount, 0) };
}

/** 一局里某个座位的表现 */
export interface SeatRoundStats {
  /** 牌权：其他人全不要，这一轮归他，由他重新开牌（不含开局的首攻） */
  tricksWon: number;
  /** 失误：手里有非炸弹的牌压得过，却选择了不要 */
  misses: number;
  /** 不要的总次数 */
  passes: number;
  cardsLeft: number;
  twosLeft: number;
  /** 这一局的收支，赢家为正 */
  amount: number;
}

/** 一局打完后存档，整场比赛的历史由这些组成 */
export interface RoundRecord {
  round: number;
  winner: number;
  tailTwo: boolean;
  seats: SeatRoundStats[];
}

export interface Seat {
  id: string;
  name: string;
  isBot: boolean;
  hand: CardId[];
  score: number;
}

export interface Play {
  seat: number;
  combo: Combo;
}

export type LogEvent =
  | { kind: 'deal'; flipped: CardId; flippedTo: number; leader: number }
  | { kind: 'play'; seat: number; combo: Combo }
  | { kind: 'pass'; seat: number }
  | { kind: 'newTrick'; leader: number }
  | { kind: 'roundOver'; winner: number; deltas: number[] }
  | { kind: 'fourTwos'; seat: number };

export interface GameState {
  config: GameConfig;
  seats: Seat[];
  phase: 'playing' | 'roundOver' | 'matchOver';
  round: number;
  turn: number;
  /** The play currently on the table this trick (null = turn player leads freely) */
  lastPlay: Play | null;
  /** Seats who said 不要 this trick — they can't play again until the trick ends */
  passed: boolean[];
  flipped: CardId | null;
  flippedTo: number | null;
  winner: number | null;
  lastDeltas: number[] | null;
  lastSettlement: Settlement | null;
  /** 本局至今，每人抢到的牌权次数 */
  tricksWon: number[];
  /** 本局至今，每人的失误次数 */
  misses: number[];
  /** 本局至今，每人说「不要」的次数 */
  passes: number[];
  /** 整场比赛每一局的存档，换局不清空 */
  history: RoundRecord[];
  /** 第几次发牌（重发也算一次），客户端用它触发发牌动画 */
  dealNo: number;
  /** 开局第一手必须带上的牌（先出那个人手里最小的牌，一般是 ♣3）；出过第一手后为 null */
  mustInclude: CardId | null;
  /** 有人拿到四张 2：这把作废，等服务器重新洗牌发牌。null = 正常 */
  redealSeat: number | null;
  /** Monotonic counter; bumps on every change so clients can animate */
  seq: number;
  log: LogEvent[];
}

export class GameError extends Error {}

export function newGame(
  players: { id: string; name: string; isBot: boolean }[],
  config: GameConfig = DEFAULT_CONFIG,
  rand: () => number = Math.random,
): GameState {
  if (players.length < 2 || players.length > 3) throw new GameError('大老二需要 2 或 3 名玩家');
  const state: GameState = {
    config,
    seats: players.map((p) => ({ ...p, hand: [], score: 0 })),
    phase: 'playing',
    round: 0,
    turn: 0,
    lastPlay: null,
    passed: players.map(() => false),
    flipped: null,
    flippedTo: null,
    winner: null,
    lastDeltas: null,
    lastSettlement: null,
    tricksWon: players.map(() => 0),
    misses: players.map(() => 0),
    passes: players.map(() => 0),
    history: [],
    dealNo: 0,
    mustInclude: null,
    redealSeat: null,
    seq: 0,
    log: [],
  };
  return deal(state, rand);
}

/**
 * Deal a round:
 *  1. Flip one random card face-up.
 *  2. Deal `handSize` cards to each player from the rest.
 *  3. The flipped card goes to whoever holds the lowest card (normally ♣3).
 *     If the flipped card *is* ♣3, it goes to whoever holds the next-lowest card.
 *  4. That player leads.
 */
export function deal(prev: GameState, rand: () => number = Math.random, isRedeal = false): GameState {
  const n = prev.seats.length;
  const deck = shuffle(fullDeck(), rand);
  const flipped = deck[0];
  const rest = deck.slice(1);
  const hands: CardId[][] = prev.seats.map((_, i) => rest.slice(i * prev.config.handSize, (i + 1) * prev.config.handSize));

  let lowestSeat = 0;
  let lowest = Infinity;
  hands.forEach((h, i) => {
    const m = Math.min(...h);
    if (m < lowest) {
      lowest = m;
      lowestSeat = i;
    }
  });
  hands[lowestSeat].push(flipped);
  // 第一手必须带上先出那个人手里最小的牌（发了 ♣3 就是 ♣3）
  const mustInclude = Math.min(...hands[lowestSeat]);
  // 有人拿到四张 2 → 这把作废，重新洗牌
  const fourTwos = hands.findIndex((h) => h.filter((c) => rankOf(c) === RANK_TWO).length === 4);
  const redealSeat = fourTwos >= 0 ? fourTwos : null;
  const log: LogEvent[] = [{ kind: 'deal', flipped, flippedTo: lowestSeat, leader: lowestSeat }];
  if (redealSeat !== null) log.push({ kind: 'fourTwos', seat: redealSeat });

  return {
    ...prev,
    seats: prev.seats.map((s, i) => ({ ...s, hand: sortCards(hands[i]) })),
    phase: 'playing',
    round: isRedeal ? prev.round : prev.round + 1,
    turn: lowestSeat,
    lastPlay: null,
    passed: Array(n).fill(false),
    flipped,
    flippedTo: lowestSeat,
    winner: null,
    lastDeltas: null,
    lastSettlement: null,
    tricksWon: Array(n).fill(0),
    misses: Array(n).fill(0),
    passes: Array(n).fill(0),
    dealNo: (prev.dealNo ?? 0) + 1,
    mustInclude,
    redealSeat,
    seq: prev.seq + 1,
    log,
  };
}

/** 有人拿到四张 2 之后：同一局重新洗牌发牌（局数不变） */
export function redeal(state: GameState, rand: () => number = Math.random): GameState {
  if (state.redealSeat === null) throw new GameError('不需要重新发牌');
  return deal(state, rand, true);
}

/** 这个座位现在能出的所有牌型（含「第一手必须带 ♣3」的限制） */
export function legalPlays(state: GameState, seat: number): Combo[] {
  const opts = playableCombos(state.seats[seat].hand, state.lastPlay?.combo ?? null);
  const must = state.mustInclude;
  return must === null ? opts : opts.filter((c) => c.cards.includes(must));
}

const bump = (xs: number[], i: number) => xs.map((x, j) => (j === i ? x + 1 : x));

/** Next seat (clockwise) that hasn't passed this trick. */
function nextActive(state: GameState, from: number, passed: boolean[]): number {
  const n = state.seats.length;
  for (let k = 1; k <= n; k++) {
    const i = (from + k) % n;
    if (!passed[i]) return i;
  }
  return from;
}

/** Validate a play without applying it. Returns the combo or throws. */
export function validatePlay(state: GameState, seat: number, cards: CardId[]): Combo {
  if (state.phase !== 'playing') throw new GameError('这局已经结束');
  if (state.redealSeat !== null) throw new GameError('有人拿到四张 2，正在重新发牌');
  if (seat !== state.turn) throw new GameError('还没轮到你');
  const hand = new Set(state.seats[seat].hand);
  if (cards.length === 0) throw new GameError('请选择要出的牌');
  if (!cards.every((c) => hand.has(c))) throw new GameError('你手里没有这些牌');
  if (state.mustInclude !== null && !cards.includes(state.mustInclude))
    throw new GameError(`第一手必须带上 ${cardLabel(state.mustInclude)}`);
  const combo = identify(cards);
  if (!combo) throw new GameError('不是合法的牌型');
  const prev = state.lastPlay?.combo ?? null;
  if (!canBeat(combo, prev)) {
    if (prev && prev.type !== combo.type) throw new GameError(`这一轮要出${COMBO_NAMES[prev.type]}（或炸弹）`);
    throw new GameError('压不过上家');
  }
  return combo;
}

export function play(state: GameState, seat: number, cards: CardId[]): GameState {
  const combo = validatePlay(state, seat, cards);
  state = { ...state, mustInclude: null };
  const played = new Set(combo.cards);
  const seats = state.seats.map((s, i) => (i === seat ? { ...s, hand: s.hand.filter((c) => !played.has(c)) } : s));
  const log: LogEvent[] = [{ kind: 'play', seat, combo }];

  // First to empty their hand wins the round
  if (seats[seat].hand.length === 0) {
    const settlement = settle(seats.map((s) => s.hand), seat, combo);
    const deltas: number[] = Array(seats.length).fill(0);
    for (const p of settlement.payments) if (state.config.losersLosePoints) deltas[p.seat] = -p.amount;
    deltas[seat] = settlement.total;
    log.push({ kind: 'roundOver', winner: seat, deltas });
    const record: RoundRecord = {
      round: state.round,
      winner: seat,
      tailTwo: settlement.tailTwo,
      seats: seats.map((s, i) => ({
        tricksWon: state.tricksWon[i],
        misses: state.misses[i],
        passes: state.passes[i],
        cardsLeft: s.hand.length,
        twosLeft: s.hand.filter((c) => rankOf(c) === RANK_TWO).length,
        amount: deltas[i],
      })),
    };
    return {
      ...state,
      seats: seats.map((s, i) => ({ ...s, score: s.score + deltas[i] })),
      phase: 'roundOver',
      lastPlay: { seat, combo },
      winner: seat,
      lastDeltas: deltas,
      lastSettlement: settlement,
      history: [...state.history, record],
      seq: state.seq + 1,
      log,
    };
  }

  const next = nextActive(state, seat, state.passed);
  // Everyone else already passed → this seat wins the trick and leads again
  if (next === seat) {
    log.push({ kind: 'newTrick', leader: seat });
    return {
      ...state, seats, lastPlay: null, passed: state.passed.map(() => false), turn: seat,
      tricksWon: bump(state.tricksWon, seat), seq: state.seq + 1, log,
    };
  }
  return { ...state, seats, lastPlay: { seat, combo }, turn: next, seq: state.seq + 1, log };
}

export function pass(state: GameState, seat: number): GameState {
  if (state.phase !== 'playing') throw new GameError('这局已经结束');
  if (state.redealSeat !== null) throw new GameError('有人拿到四张 2，正在重新发牌');
  if (seat !== state.turn) throw new GameError('还没轮到你');
  if (!state.lastPlay) throw new GameError('你是这一轮的首家，必须出牌');
  const passed = state.passed.slice();
  passed[seat] = true;
  // 失误 = 手里有非炸弹的牌压得过却不要。压不过、或只剩炸弹能压，都不算失误。
  const couldHavePlayed = playableCombos(state.seats[seat].hand, state.lastPlay.combo).some((c) => !isBomb(c.type));
  const passes = bump(state.passes, seat);
  const misses = couldHavePlayed ? bump(state.misses, seat) : state.misses;
  const log: LogEvent[] = [{ kind: 'pass', seat }];
  const next = nextActive(state, seat, passed);
  // Back to the player who made the last play → trick over, they lead fresh
  if (next === state.lastPlay.seat) {
    log.push({ kind: 'newTrick', leader: next });
    return {
      ...state, passed: passed.map(() => false), lastPlay: null, turn: next,
      tricksWon: bump(state.tricksWon, next), passes, misses, seq: state.seq + 1, log,
    };
  }
  return { ...state, passed, turn: next, passes, misses, seq: state.seq + 1, log };
}

export function nextRound(state: GameState, rand: () => number = Math.random): GameState {
  if (state.phase !== 'roundOver') throw new GameError('这局还没结束');
  return deal(state, rand);
}

/** 结束比赛：停在计分板上。进行中的那一局不计分，也不进历史。 */
export function endMatch(state: GameState): GameState {
  if (state.phase === 'matchOver') return state;
  return { ...state, phase: 'matchOver', seq: state.seq + 1, log: [] };
}

/** 新比赛：积分和历史清零，重新发牌。 */
export function newMatch(state: GameState, rand: () => number = Math.random): GameState {
  return deal(
    { ...state, seats: state.seats.map((s) => ({ ...s, score: 0 })), history: [], round: 0 },
    rand,
  );
}
