/**
 * 策略模拟器 — 在真实规则引擎上跑大量牌局，测量不同打法的期望收益。
 *
 *   npx tsx scripts/strategy-sim.ts
 *
 * 用共同随机数（同样的发牌序列）对比各个策略变体，大幅降低方差。
 */
import { CardId, rankOf, fullDeck } from '../shared/src/cards';
import { Combo, isBomb, playableCombos } from '../shared/src/combos';
import { GameState, newGame, play, pass, nextRound } from '../shared/src/game';

const RANK_TWO = 12;
const isTwo = (c: CardId) => rankOf(c) === RANK_TWO;

// ---------- seeded RNG (mulberry32) ----------
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- configurable policy ----------
export interface Params {
  name: string;
  /** 跟牌时，若最便宜的解需要动用 2，有多大概率改为不要 */
  holdTwoProb: number;
  /** 只有对手最少手牌 > 这个数时才考虑留 2 */
  holdTwoThreatMin: number;
  /** 只有自己手牌 > 这个数时才考虑留 2 */
  holdTwoHandMin: number;
  /** 首攻时主动把 2 当单张甩出去（手牌还多的时候） */
  dumpTwoLead: boolean;
  /** 首攻时优先出张数多的牌型，尽快把手牌压到 10 张及以下 */
  shedFast: boolean;
  /** 手牌降到这个数以下时启动 shedFast（0 = 一直启用） */
  shedFastFrom: number;
  /** 手牌很少时，尽量把 2 留作最后一手（尾二） */
  tailTwoPlan: boolean;
  /** 对手手牌 ≤ 这个数时才舍得放炸弹 */
  bombThreat: number;
}

export const BASELINE: Params = {
  name: 'baseline',
  holdTwoProb: 0.6,
  holdTwoThreatMin: 5,
  holdTwoHandMin: 6,
  dumpTwoLead: false,
  shedFast: false,
  shedFastFrom: 0,
  tailTwoPlan: false,
  bombThreat: 4,
};

type Move = { type: 'play'; cards: CardId[] } | { type: 'pass' };

function decide(state: GameState, seat: number, p: Params, rand: () => number): Move {
  const hand = state.seats[seat].hand;
  const prev = state.lastPlay?.combo ?? null;
  const options = playableCombos(hand, prev);
  const threat = Math.min(...state.seats.filter((_, i) => i !== seat).map((s) => s.hand.length));

  // 能一把出完就出完
  const finishers = options.filter((c) => c.cards.length === hand.length);
  if (finishers.length) {
    if (p.tailTwoPlan) {
      // 优先用能构成尾二的那一手收尾（单张 2 或一对 2），全场翻倍
      const tail = finishers.find(
        (c) => (c.type === 'single' || c.type === 'pair') && c.cards.every(isTwo),
      );
      if (tail) return { type: 'play', cards: tail.cards };
    }
    return { type: 'play', cards: finishers[0].cards };
  }

  if (!prev) return { type: 'play', cards: pickLead(options, hand, threat, p, rand).cards };

  const nonBombs = options.filter((c) => !isBomb(c.type));
  if (nonBombs.length) {
    let cheapest = nonBombs[0];
    // 尾二规划：手牌快空了，别把最后的 2 当普通牌打掉
    if (p.tailTwoPlan && hand.length <= 4) {
      const twosLeft = hand.filter(isTwo).length;
      const keepable = nonBombs.find((c) => !c.cards.some(isTwo));
      if (twosLeft > 0 && keepable && hand.length - keepable.cards.length >= twosLeft) cheapest = keepable;
    }
    const usesTwo = cheapest.cards.some(isTwo);
    if (
      usesTwo &&
      threat > p.holdTwoThreatMin &&
      hand.length > p.holdTwoHandMin &&
      rand() < p.holdTwoProb
    )
      return { type: 'pass' };
    return { type: 'play', cards: cheapest.cards };
  }
  const bombs = options.filter((c) => isBomb(c.type));
  if (bombs.length && (threat <= p.bombThreat || hand.length <= 6)) return { type: 'play', cards: bombs[0].cards };
  return { type: 'pass' };
}

function pickLead(options: Combo[], hand: CardId[], threat: number, p: Params, rand: () => number): Combo {
  const nonBombs = options.filter((c) => !isBomb(c.type));
  const pool = nonBombs.length ? nonBombs : options;
  const low = (t: Combo['type']) => pool.filter((c) => c.type === t).sort((a, b) => a.key - b.key)[0];

  // 快速减牌：首攻时优先出张数最多的牌型，尽快越过 10 张线
  if (p.shedFast && (p.shedFastFrom === 0 || hand.length <= p.shedFastFrom)) {
    const multi = pool
      .filter((c) => !(p.tailTwoPlan && c.cards.every(isTwo) && hand.length > c.cards.length))
      .sort((a, b) => b.cards.length - a.cards.length || a.key - b.key)[0];
    if (multi && multi.cards.length > 1) return multi;
  }

  // 主动甩 2：手牌还多的时候用 2 抢回出牌权
  if (p.dumpTwoLead && hand.length > 8) {
    const twoSingle = pool.filter((c) => c.type === 'single' && isTwo(c.cards[0])).sort((a, b) => a.key - b.key)[0];
    if (twoSingle) return twoSingle;
  }

  if (threat <= 2) {
    const big = low('straight') ?? low('fullhouse') ?? low('pair');
    if (big) return big;
    return pool.filter((c) => c.type === 'single').sort((a, b) => b.key - a.key)[0];
  }
  const straight = low('straight');
  if (straight && straight.cards[4] < 44) return straight;
  const fh = low('fullhouse');
  if (fh && fh.key < 9) return fh;
  const single = low('single');
  const pair = low('pair');
  if (pair && single && pair.key < single.key + 8 && hand.length > 3) return pair;
  return single ?? pool[0];
}

// ---------- one round ----------
export interface RoundResult {
  winner: number;
  deltas: number[];
  tailTwo: boolean;
  /** per losing seat: cards left, twos left, amount */
  losers: { seat: number; cards: number; twos: number; over10: boolean; amount: number }[];
  plies: number;
}

export function playRound(policies: Params[], seed: number): RoundResult {
  const rand = rng(seed);
  const n = policies.length;
  let state = newGame(
    policies.map((p, i) => ({ id: `p${i}`, name: p.name, isBot: true })),
    undefined,
    rand,
  );
  let plies = 0;
  while (state.phase === 'playing' && plies < 400) {
    const seat = state.turn;
    const mv = decide(state, seat, policies[seat], rand);
    state = mv.type === 'play' ? play(state, seat, mv.cards) : pass(state, seat);
    plies++;
  }
  const s = state.lastSettlement!;
  return {
    winner: state.winner!,
    deltas: state.lastDeltas!,
    tailTwo: s.tailTwo,
    losers: s.payments.map((pm) => ({
      seat: pm.seat,
      cards: pm.cards,
      twos: pm.twos,
      over10: pm.over10,
      amount: pm.amount,
    })),
    plies,
  };
}

/** 跑 N 局，seat 0 用 variant，其余用 baseline。返回 seat 0 的每局平均净收益。 */
export function abTest(variant: Params, n: number, seats = 3, seed0 = 12345) {
  const policies = [variant, ...Array.from({ length: seats - 1 }, () => BASELINE)];
  let total = 0;
  let wins = 0;
  const sq: number[] = [];
  for (let i = 0; i < n; i++) {
    const r = playRound(policies, seed0 + i);
    total += r.deltas[0];
    sq.push(r.deltas[0]);
    if (r.winner === 0) wins++;
  }
  const mean = total / n;
  const variance = sq.reduce((a, x) => a + (x - mean) ** 2, 0) / (n - 1);
  return { mean, se: Math.sqrt(variance / n), winRate: wins / n, n };
}
