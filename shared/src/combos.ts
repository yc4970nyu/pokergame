import { CardId, face, naturalRank, rankOf, suitOf, sortCards } from './cards';

export type ComboType = 'single' | 'pair' | 'fullhouse' | 'straight' | 'fourkind' | 'fivekind' | 'straightflush';

export interface Combo {
  type: ComboType;
  cards: CardId[]; // sorted
  /** Higher key wins between two combos of the same type */
  key: number;
}

export const COMBO_NAMES: Record<ComboType, string> = {
  single: '单张',
  pair: '对子',
  fullhouse: '葫芦',
  straight: '顺子',
  fourkind: '铁支',
  fivekind: '铁支',
  straightflush: '同花顺',
};

export const isBomb = (t: ComboType) => t === 'fourkind' || t === 'fivekind' || t === 'straightflush';

/**
 * 两副牌（4 人局）里，铁支是「五张一样的 + 一张单牌」（共 6 张）；四张一样的 + 一张不再是铁支。
 * 一副牌（2、3 人局）里，铁支还是「四张一样的 + 一张单牌」。
 */
export const allowedCombo = (type: ComboType, decks: number) => (decks >= 2 ? type !== 'fourkind' : type !== 'fivekind');
/** Among bombs: straight flush beats four-of-a-kind */
const BOMB_LEVEL: Partial<Record<ComboType, number>> = { fourkind: 1, fivekind: 1, straightflush: 2 };

/**
 * Valid straight windows, by natural rank start (A=1).
 * Strength order (low → high):
 *   A2345 < 34567 < 45678 < ... < 10JQKA < 23456
 * No wrap-arounds like JQKA2 / QKA23 / KA234.
 */
const STRAIGHT_STRENGTH = new Map<string, number>();
(() => {
  const windows: number[][] = [];
  windows.push([1, 2, 3, 4, 5]); // A2345 — smallest
  for (let s = 3; s <= 9; s++) windows.push([s, s + 1, s + 2, s + 3, s + 4]); // 34567 .. 9-K
  windows.push([10, 11, 12, 13, 1]); // 10JQKA
  windows.push([2, 3, 4, 5, 6]); // 23456 — biggest
  windows.forEach((w, i) => STRAIGHT_STRENGTH.set(w.slice().sort((a, b) => a - b).join(','), i));
})();
export const STRAIGHT_WINDOWS: number[][] = (() => {
  const out: number[][] = [[1, 2, 3, 4, 5]];
  for (let s = 3; s <= 9; s++) out.push([s, s + 1, s + 2, s + 3, s + 4]);
  out.push([10, 11, 12, 13, 1]);
  out.push([2, 3, 4, 5, 6]);
  return out;
})();

function straightStrength(cards: CardId[]): number | null {
  const nat = cards.map(naturalRank).sort((a, b) => a - b);
  if (new Set(nat).size !== 5) return null;
  const s = STRAIGHT_STRENGTH.get(nat.join(','));
  return s === undefined ? null : s;
}

/** Identify a set of cards as a playable combo, or null if it's not legal. */
export function identify(input: CardId[]): Combo | null {
  const cards = sortCards(input);
  if (new Set(cards).size !== cards.length) return null;
  const n = cards.length;
  if (n === 1) return { type: 'single', cards, key: face(cards[0]) };

  const counts = new Map<number, CardId[]>();
  for (const c of cards) {
    const r = rankOf(c);
    if (!counts.has(r)) counts.set(r, []);
    counts.get(r)!.push(c);
  }

  if (n === 2) {
    if (rankOf(cards[0]) === rankOf(cards[1])) return { type: 'pair', cards, key: face(cards[1]) }; // higher suit decides
    return null;
  }

  if (n === 5) {
    const groups = [...counts.values()].sort((a, b) => b.length - a.length);
    // 铁支: four of a kind + 1 kicker
    if (groups[0].length === 4) return { type: 'fourkind', cards, key: rankOf(groups[0][0]) };
    // 葫芦: three of a kind + a pair — compare the triple only
    if (groups[0].length === 3 && groups[1].length === 2)
      return { type: 'fullhouse', cards, key: rankOf(groups[0][0]) };
    // 顺子 / 同花顺: compare sequence, then the suit of the biggest card (max id)
    const strength = straightStrength(cards);
    if (strength !== null) {
      const key = strength * 100 + face(cards[4]);
      const flush = cards.every((c) => suitOf(c) === suitOf(cards[0]));
      return { type: flush ? 'straightflush' : 'straight', cards, key };
    }
  }
  if (n === 6) {
    // 铁支（两副牌）: five of a kind + 1 kicker of another rank
    const groups = [...counts.values()].sort((a, b) => b.length - a.length);
    if (groups[0].length === 5 && groups[1]?.length === 1) return { type: 'fivekind', cards, key: rankOf(groups[0][0]) };
  }
  return null;
}

/** Can `next` be played on top of `prev`? (prev null = leading a new round, anything goes) */
export function canBeat(next: Combo, prev: Combo | null): boolean {
  if (!prev) return true;
  const nb = isBomb(next.type);
  const pb = isBomb(prev.type);
  if (nb && !pb) return true; // bombs beat anything
  if (!nb && pb) return false;
  if (nb && pb) {
    const ln = BOMB_LEVEL[next.type]!;
    const lp = BOMB_LEVEL[prev.type]!;
    if (ln !== lp) return ln > lp;
    return next.key > prev.key;
  }
  if (next.type !== prev.type) return false;
  return next.key > prev.key;
}

// ---------------------------------------------------------------------------
// Enumeration (used by the bot and by the "提示" hint button)
// ---------------------------------------------------------------------------

function byRank(hand: CardId[]): Map<number, CardId[]> {
  const m = new Map<number, CardId[]>();
  for (const c of sortCards(hand)) {
    const r = rankOf(c);
    if (!m.has(r)) m.set(r, []);
    m.get(r)!.push(c);
  }
  return m;
}

const choose = <T,>(arr: T[], k: number): T[][] => {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [h, ...t] = arr;
  return [...choose(t, k - 1).map((x) => [h, ...x]), ...choose(t, k)];
};

/** Natural rank → rankIndex */
const natToRankIndex = (nat: number) => (nat === 1 ? 11 : nat === 2 ? 12 : nat - 3);

/**
 * All meaningfully-distinct combos in a hand. For full houses / four-kinds we
 * keep one representative per key with the cheapest attachments, so the list
 * stays small but never misses a combo that could beat something.
 */
export function enumerateCombos(hand: CardId[]): Combo[] {
  const out: Combo[] = [];
  const ranks = byRank(hand);
  const sorted = sortCards(hand);

  for (const c of sorted) out.push(identify([c])!);

  for (const cs of ranks.values()) for (const p of choose(cs, 2)) out.push(identify(p)!);

  // full houses: each triple rank, cheapest pair from another rank
  for (const [r, cs] of ranks) {
    if (cs.length < 3) continue;
    let pair: CardId[] | null = null;
    for (const [r2, cs2] of ranks) {
      if (r2 === r || cs2.length < 2) continue;
      // prefer a pair that doesn't break a triple/quad
      const cand = cs2.slice(0, 2);
      if (!pair || (cs2.length === 2 && (ranks.get(rankOf(pair[0]))!.length > 2 || face(cand[1]) < face(pair[1])))) pair = cand;
    }
    if (pair) out.push(identify([...cs.slice(0, 3), ...pair])!);
  }

  // four of a kind + cheapest kicker (一副牌)
  for (const [r, cs] of ranks) {
    if (cs.length !== 4) continue;
    const kicker = sorted.find((c) => rankOf(c) !== r);
    if (kicker !== undefined) out.push(identify([...cs, kicker])!);
  }
  // five of a kind + cheapest kicker (两副牌)
  for (const [r, cs] of ranks) {
    if (cs.length < 5) continue;
    const kicker = sorted.find((c) => rankOf(c) !== r);
    if (kicker !== undefined) out.push(identify([...cs.slice(0, 5), kicker])!);
  }

  // straights & straight flushes
  for (const w of STRAIGHT_WINDOWS) {
    const lists = w.map((nat) => ranks.get(natToRankIndex(nat)) ?? []);
    if (lists.some((l) => l.length === 0)) continue;
    // the biggest card (by id) in this window decides ties; try every suit of it
    const topRank = Math.max(...w.map(natToRankIndex));
    const topIdx = w.findIndex((nat) => natToRankIndex(nat) === topRank);
    for (const top of lists[topIdx]) {
      const cards = lists.map((l, i) => (i === topIdx ? top : l[0]));
      const combo = identify(cards);
      if (combo) out.push(combo);
    }
    // straight flushes in each suit
    for (let s = 0; s < 4; s++) {
      const sf = lists.map((l) => l.find((c) => suitOf(c) === s));
      if (sf.every((c) => c !== undefined)) out.push(identify(sf as CardId[])!);
    }
  }

  // dedupe：两副牌里同一张脸的两张牌效果一样，只留一个
  const seen = new Set<string>();
  return out.filter((c) => {
    const k = c.cards.map(face).join(',');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Combos from `hand` that can legally be played on `prev`, cheapest first. */
export function playableCombos(hand: CardId[], prev: Combo | null, decks = 1): Combo[] {
  const order: ComboType[] = ['single', 'pair', 'straight', 'fullhouse', 'fourkind', 'fivekind', 'straightflush'];
  return enumerateCombos(hand)
    .filter((c) => allowedCombo(c.type, decks) && canBeat(c, prev))
    .sort((a, b) => {
      const ba = isBomb(a.type) ? 1 : 0;
      const bb = isBomb(b.type) ? 1 : 0;
      if (ba !== bb) return ba - bb;
      if (a.type !== b.type) return order.indexOf(a.type) - order.indexOf(b.type);
      return a.key - b.key;
    });
}
