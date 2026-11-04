import { describe, it, expect } from 'vitest';
import {
  CardId, identify, canBeat, newGame, play, pass, chooseBotMove, enumerateCombos, playableCombos,
  GameState, rankOf, nextRound, settle, endMatch, newMatch, deal, redeal, legalPlays, pickLeader, configFor,
} from '../src';

// helper: card from "3c", "10s", "Ah", "2d"
const R: Record<string, number> = { '3': 0, '4': 1, '5': 2, '6': 3, '7': 4, '8': 5, '9': 6, '10': 7, J: 8, Q: 9, K: 10, A: 11, '2': 12 };
const S: Record<string, number> = { c: 0, d: 1, h: 2, s: 3 };
const c = (s: string): CardId => R[s.slice(0, -1)] * 4 + S[s.slice(-1)];
const cs = (s: string) => s.split(' ').map(c);
const id = (s: string) => identify(cs(s));

describe('single cards', () => {
  it('3 is smallest, 2 biggest; suits club<diamond<heart<spade', () => {
    expect(canBeat(id('3s')!, id('3h')!)).toBe(true);
    expect(canBeat(id('3h')!, id('3s')!)).toBe(false);
    expect(canBeat(id('2c')!, id('As')!)).toBe(true);
    expect(canBeat(id('2s')!, id('2h')!)).toBe(true);
  });
});

describe('pairs', () => {
  it('compares by rank then higher suit', () => {
    expect(canBeat(id('5c 5s')!, id('5d 5h')!)).toBe(true);
    expect(canBeat(id('4c 4d')!, id('3h 3s')!)).toBe(true);
    expect(id('4c 5c')).toBeNull();
  });
});

describe('straights', () => {
  it('A2345 smallest, 23456 biggest, no wrap', () => {
    const a2345 = id('Ac 2c 3d 4d 5d')!;
    const s34567 = id('3c 4c 5c 6c 7d')!;
    const tjqka = id('10c Jc Qc Kc Ad')!;
    const s23456 = id('2c 3c 4d 5d 6d')!;
    expect(a2345.type).toBe('straight');
    expect(canBeat(s34567, a2345)).toBe(true);
    expect(canBeat(tjqka, s34567)).toBe(true);
    expect(canBeat(s23456, tjqka)).toBe(true);
    expect(id('Jc Qc Kd Ad 2d')).toBeNull();
    expect(id('Qc Kd Ad 2d 3d')).toBeNull();
  });
  it('same straight: suit of the top card (7 for 34567, the 2 for 23456)', () => {
    expect(canBeat(id('3c 4c 5c 6c 7s')!, id('3s 4s 5s 6s 7h')!)).toBe(true);
    expect(canBeat(id('2s 3c 4c 5c 6c')!, id('2h 3s 4s 5s 6s')!)).toBe(true);
  });
});

describe('full house', () => {
  it('only the triple matters', () => {
    expect(canBeat(id('Kc Kd Kh 3c 3d')!, id('Qc Qd Qh 2c 2d')!)).toBe(true);
    expect(canBeat(id('7c 7d 7h 3c 3d')!, id('3h 3s 3c 7s 7h')!)).toBe(true);
  });
  it('cannot beat a straight', () => {
    expect(canBeat(id('Kc Kd Kh 3c 3d')!, id('3c 4c 5c 6c 7d')!)).toBe(false);
  });
});

describe('bombs', () => {
  const quad = id('9c 9d 9h 9s 3c')!;
  const sf = id('3h 4h 5h 6h 7h')!;
  it('four of a kind + 1 is a bomb that beats anything', () => {
    expect(quad.type).toBe('fourkind');
    expect(canBeat(quad, id('2s')!)).toBe(true);
    expect(canBeat(quad, id('2h 2s')!)).toBe(true);
    expect(canBeat(quad, id('2s 3c 4c 5c 6c')!)).toBe(true);
    expect(canBeat(quad, id('Ac Ad Ah 2c 2d')!)).toBe(true);
  });
  it('straight flush beats four-kind; bombs compare among themselves', () => {
    expect(sf.type).toBe('straightflush');
    expect(canBeat(sf, quad)).toBe(true);
    expect(canBeat(quad, sf)).toBe(false);
    expect(canBeat(id('10c 10d 10h 10s 3d')!, quad)).toBe(true);
    expect(canBeat(id('4s 5s 6s 7s 8s')!, sf)).toBe(true);
  });
  it('normal straight cannot beat a straight flush', () => {
    expect(canBeat(id('2c 3c 4d 5d 6d')!, sf)).toBe(false);
  });
});

describe('round flow', () => {
  const mk = () => newGame([
    { id: 'a', name: 'A', isBot: false },
    { id: 'b', name: 'B', isBot: false },
    { id: 'c', name: 'C', isBot: false },
  ]);

  it('deals 17 + flipped card to the ♣3 holder, who leads', () => {
    for (let i = 0; i < 50; i++) {
      const g = mk();
      const total = g.seats.reduce((n, s) => n + s.hand.length, 0);
      expect(total).toBe(52);
      expect(g.seats[g.turn].hand.length).toBe(18);
      expect(g.seats[g.turn].hand).toContain(0); // holds ♣3 (either dealt or flipped)
      expect(g.flippedTo).toBe(g.turn);
    }
  });

  it('2 players: 17 each, flipped to the lowest-card holder', () => {
    const g = newGame([{ id: 'a', name: 'A', isBot: false }, { id: 'b', name: 'B', isBot: false }]);
    expect(g.seats.map((s) => s.hand.length).sort()).toEqual([17, 18]);
    const low = Math.min(...g.seats.flatMap((s) => s.hand));
    expect(g.seats[g.turn].hand).toContain(low);
  });

  it('a player who passed cannot play again in the same trick', () => {
    let g = mk();
    // rig hands: A leads
    g = { ...g, mustInclude: null, redealSeat: null, turn: 0, seats: g.seats.map((s, i) => ({ ...s, hand: [cs('3c 9c Kc'), cs('5c 6c 7c'), cs('4c 8c Qc')][i] })) };
    g = play(g, 0, cs('3c'));   // A: 3
    g = pass(g, 1);             // B passes
    expect(g.turn).toBe(2);
    g = play(g, 2, cs('4c'));   // C: 4
    expect(g.turn).toBe(0);     // skips back to A — B is out of this trick
    g = play(g, 0, cs('9c'));   // A: 9
    expect(g.turn).toBe(2);     // B skipped
    g = pass(g, 2);             // C passes → trick back to A
    expect(g.lastPlay).toBeNull();
    expect(g.turn).toBe(0);
    expect(g.passed).toEqual([false, false, false]);
  });

  it('leader may not pass; must follow the trick type', () => {
    let g = mk();
    g = { ...g, mustInclude: null, redealSeat: null, turn: 0, seats: g.seats.map((s, i) => ({ ...s, hand: [cs('3c 3d 9c'), cs('5c 5d 7c'), cs('4c 8c Qc')][i] })) };
    expect(() => pass(g, 0)).toThrow();
    g = play(g, 0, cs('3c 3d'));
    expect(() => play(g, 1, cs('7c'))).toThrow();
    g = play(g, 1, cs('5c 5d'));
    expect(g.turn).toBe(2);
  });

  it('scoring: winner gets the sum of the others\' remaining cards', () => {
    let g = mk();
    g = { ...g, mustInclude: null, redealSeat: null, turn: 0, seats: g.seats.map((s, i) => ({ ...s, hand: [cs('As'), cs('3c 4c 5c 6c 8d'), cs('3d 4d 5d 6d 8h')][i] })) };
    g = play(g, 0, cs('As'));
    expect(g.phase).toBe('roundOver');
    expect(g.winner).toBe(0);
    expect(g.lastDeltas).toEqual([10, -5, -5]);
    expect(g.seats.map((s) => s.score)).toEqual([10, -5, -5]);
    g = nextRound(g);
    expect(g.phase).toBe('playing');
    expect(g.round).toBe(2);
  });
});

describe('money (算钱)', () => {
  const win = (s: string) => identify(cs(s))!;
  const pay = (hands: string[], final = '3c') => settle([[], ...hands.map(cs)], 0, win(final));

  it('base: cards left', () => {
    expect(pay(['3d 4d 5d 6d 7d']).payments[0].amount).toBe(5);
  });
  it('10 or more cards: ×2 (11 → 22, exactly 10 → 20); 9 is not doubled', () => {
    expect(pay(['3d 4d 5d 6d 7d 8d 9d 10d Jd Qd Kd']).payments[0].amount).toBe(22);
    expect(pay(['3d 4d 5d 6d 7d 8d 9d 10d Jd Qd']).payments[0].amount).toBe(20);
    expect(pay(['3d 4d 5d 6d 7d 8d 9d 10d Jd']).payments[0].amount).toBe(9);
  });
  it('11 cards with one 2: ×2 ×2 → 44', () => {
    expect(pay(['3d 4d 5d 6d 7d 8d 9d 10d Jd Qd 2d']).payments[0].amount).toBe(44);
  });
  it('6 cards with one 2 → ×2 = 12; with two 2s → ×4 = 24', () => {
    expect(pay(['3d 4d 5d 6d 7d 2d']).payments[0].amount).toBe(12);
    expect(pay(['3d 4d 5d 6d 2h 2d']).payments[0].amount).toBe(24);
  });
  it('尾二: winner goes out on a single 2 or a pair of 2s → everyone ×2', () => {
    const single = pay(['3d 4d 5d', '3h 4h 5h 6h 2c'], '2s');
    expect(single.tailTwo).toBe(true);
    expect(single.payments.map((p) => p.amount)).toEqual([6, 20]);
    expect(single.total).toBe(26);
    const pair = pay(['3d 4d 5d'], '2h 2s');
    expect(pair.tailTwo).toBe(true);
    expect(pair.payments[0].amount).toBe(6);
  });
  it('a straight or full house that contains a 2 is not 尾二', () => {
    expect(pay(['3d 4d 5d'], '2c 3c 4c 5c 6h').tailTwo).toBe(false);
    expect(pay(['3d 4d 5d'], '2c 2d 2h 3c 3s').tailTwo).toBe(false);
  });
  it('game applies it: zero-sum deltas', () => {
    let g = newGame([{ id: 'a', name: 'A', isBot: false }, { id: 'b', name: 'B', isBot: false }, { id: 'c', name: 'C', isBot: false }]);
    g = { ...g, mustInclude: null, redealSeat: null, turn: 0, seats: g.seats.map((s, i) => ({ ...s, hand: [cs('2s'), cs('3c 4c 5c 6c 2d'), cs('3d 4d')][i] })) };
    g = play(g, 0, cs('2s'));
    // B: 5 cards ×2 (one 2) ×2 (尾二) = 20 ; C: 2 ×2 (尾二) = 4
    expect(g.lastDeltas).toEqual([24, -20, -4]);
    expect(g.lastSettlement!.tailTwo).toBe(true);
  });
});

describe('enumeration', () => {
  it('finds straights incl. A2345 and bombs', () => {
    const combos = enumerateCombos(cs('Ac 2d 3c 4c 5c 9c 9d 9h 9s'));
    const types = new Set(combos.map((x) => x.type));
    expect(types.has('straight')).toBe(true);
    expect(types.has('fourkind')).toBe(true);
  });
  it('playable combos all beat the table', () => {
    const prev = identify(cs('7c 8c 9c 10c Jd'))!;
    const hand = cs('8d 9d 10d Jd Qd Qs 5c 5d 5h 5s');
    for (const p of playableCombos(hand, prev)) expect(canBeat(p, prev)).toBe(true);
    expect(playableCombos(hand, prev).length).toBeGreaterThan(0);
  });
});

describe('bot simulation', () => {
  it('bots finish 300 full games with only legal moves', () => {
    for (let g = 0; g < 300; g++) {
      const n = g % 2 === 0 ? 3 : 2;
      let s: GameState = newGame(Array.from({ length: n }, (_, i) => ({ id: String(i), name: String(i), isBot: true })));
      let steps = 0;
      while (s.phase === 'playing') {
        if (s.redealSeat !== null) { s = redeal(s); continue; }
        const m = chooseBotMove(s, s.turn);
        s = m.type === 'play' ? play(s, s.turn, m.cards) : pass(s, s.turn);
        if (++steps > 2000) throw new Error('game did not terminate');
      }
      expect(s.seats.reduce((a, x) => a + x.score, 0)).toBe(0); // zero-sum
      expect(s.seats[s.winner!].hand.length).toBe(0);
      void rankOf;
    }
  });
});


describe('match stats (牌权 / 失误)', () => {
  /** three seats with hands we control, seat 0 to lead */
  const rig = (hands: string[]): GameState => {
    const g = newGame([0, 1, 2].map((i) => ({ id: `p${i}`, name: `P${i}`, isBot: false })));
    return { ...g, mustInclude: null, redealSeat: null, turn: 0, lastPlay: null, seats: g.seats.map((s, i) => ({ ...s, hand: cs(hands[i]) })) };
  };

  it('牌权: everyone passing hands the trick back to the player, counted once', () => {
    let g = rig(['2s 3c 4c', '3d 4d 5d', '3h 4h 5h']);
    g = play(g, 0, cs('2s')); // nobody can beat a ♠2
    g = pass(g, 1);
    g = pass(g, 2);
    expect(g.tricksWon).toEqual([1, 0, 0]);
    expect(g.turn).toBe(0); // leads again
    expect(g.lastPlay).toBe(null);
  });

  it('牌权 is not credited for the opening lead', () => {
    const g = rig(['2s 3c', '3d 4d', '3h 4h']);
    expect(g.tricksWon).toEqual([0, 0, 0]);
  });

  it('失误: passing with a plain beat available counts, otherwise it does not', () => {
    let g = rig(['5c 6c 7c', '9d 3d 4d', '3h 4h 5h']);
    g = play(g, 0, cs('5c'));
    g = pass(g, 1); // held ♦9, could have beaten ♣5 → 失误
    expect(g.misses).toEqual([0, 1, 0]);
    expect(g.passes).toEqual([0, 1, 0]);
    g = pass(g, 2); // ♥3/♥4 can't beat ♣5, ♥5 can (heart > club) → also a miss
    expect(g.misses).toEqual([0, 1, 1]);
  });

  it('失误: a pass with nothing that beats the table is clean', () => {
    let g = rig(['2s 3c 4c', '3d 4d 5d', '3h 4h 5h']);
    g = play(g, 0, cs('2s'));
    g = pass(g, 1);
    expect(g.misses).toEqual([0, 0, 0]);
  });

  it('失误: holding only a bomb is not a mistake', () => {
    let g = rig(['5c 6c 7c', '9d 9h 9s 9c 3d', '3h 4h']);
    g = play(g, 0, cs('5c'));
    g = pass(g, 1); // ♦9 beats ♣5 → that is a plain beat, so it IS a miss
    expect(g.misses[1]).toBe(1);
    // now a case where only the bomb could answer: a straight on the table
    let h = rig(['3c 4c 5c 6c 7c 8c', '9d 9h 9s 9c 3d', '3h 4h 5h 6h 7h']);
    h = play(h, 0, cs('4c 5c 6c 7c 8c'));
    h = pass(h, 1); // seat 1 has only 铁支 (a bomb) — not counted
    expect(h.misses[1]).toBe(0);
    expect(h.passes[1]).toBe(1);
  });

  it('history: a finished round is archived, counters reset, scores accumulate', () => {
    let g = rig(['2s', '3d 4d 5d', '3h 4h']);
    g = play(g, 0, cs('2s')); // seat 0 goes out on a single 2 → 尾二
    expect(g.phase).toBe('roundOver');
    expect(g.history).toHaveLength(1);
    const rec = g.history[0];
    expect(rec.winner).toBe(0);
    expect(rec.tailTwo).toBe(true);
    expect(rec.seats[1].cardsLeft).toBe(3);
    expect(rec.seats[1].amount).toBe(-6); // 3 × 2 (尾二)
    expect(rec.seats.reduce((a, x) => a + x.amount, 0)).toBe(0); // zero-sum

    g = nextRound(g);
    expect(g.history).toHaveLength(1); // survives the deal
    expect(g.tricksWon).toEqual([0, 0, 0]); // per-round counters reset
    expect(g.misses).toEqual([0, 0, 0]);
    expect(g.seats[0].score).toBe(10);
  });

  it('endMatch stops the game; newMatch clears scores and history', () => {
    let g = rig(['2s', '3d 4d 5d', '3h 4h']);
    g = play(g, 0, cs('2s'));
    g = endMatch(g);
    expect(g.phase).toBe('matchOver');
    expect(() => nextRound(g)).toThrow();

    g = newMatch(g);
    expect(g.phase).toBe('playing');
    expect(g.history).toEqual([]);
    expect(g.seats.map((s) => s.score)).toEqual([0, 0, 0]);
    expect(g.round).toBe(1);
  });
});


describe('四张 2 重发 & 第一手带 ♣3', () => {
  const players = [0, 1, 2].map((i) => ({ id: `p${i}`, name: `P${i}`, isBot: false }));
  /** rand that makes shuffle() a no-op → deck stays 0..51: flipped = 0, seat 2 gets ids 35..51 (all four 2s) */
  const identity = () => 0.999999;

  it('dealing four 2s to one seat flags a redeal; redeal keeps the round number', () => {
    const g = newGame(players, undefined, identity);
    expect(g.seats[2].hand.filter((x) => rankOf(x) === 12).length).toBe(4);
    expect(g.redealSeat).toBe(2);
    expect(g.log.some((e) => e.kind === 'fourTwos')).toBe(true);
    expect(() => play(g, g.turn, [g.mustInclude!])).toThrow(/四张 2/);
    let r = redeal(g);
    expect(r.round).toBe(g.round);
    expect(r.dealNo).toBe(g.dealNo + 1);
    while (r.redealSeat !== null) r = redeal(r);
    expect(r.seats.every((s) => s.hand.filter((x) => rankOf(x) === 12).length < 4)).toBe(true);
  });

  it('a normal deal has no redeal flag', () => {
    for (let i = 0; i < 200; i++) {
      const g = newGame(players);
      const four = g.seats.some((s) => s.hand.filter((x) => rankOf(x) === 12).length === 4);
      expect(g.redealSeat !== null).toBe(four);
    }
  });

  it('first play must include ♣3 (the leader\'s lowest card); later plays need not', () => {
    let g = newGame(players);
    while (g.redealSeat !== null) g = redeal(g);
    expect(g.mustInclude).toBe(0);
    const hand = g.seats[g.turn].hand;
    const other = hand.find((x) => x !== 0)!;
    expect(() => play(g, g.turn, [other])).toThrow(/♣3/);
    expect(legalPlays(g, g.turn).every((c) => c.cards.includes(0))).toBe(true);
    g = play(g, g.turn, [0]);
    expect(g.mustInclude).toBe(null);
  });

  it('2 players with ♣3 undealt: must include the leader\'s lowest card', () => {
    for (let i = 0; i < 50; i++) {
      let g = newGame(players.slice(0, 2));
      while (g.redealSeat !== null) g = redeal(g);
      expect(g.mustInclude).toBe(Math.min(...g.seats[g.turn].hand));
    }
    void deal;
  });
});

describe('四人局（两副牌）', () => {
  const four = [0, 1, 2, 3].map((i) => ({ id: `p${i}`, name: `P${i}`, isBot: false }));
  const R2: Record<string, number> = { '3': 0, '4': 1, '5': 2, '6': 3, '7': 4, '8': 5, '9': 6, '10': 7, J: 8, Q: 9, K: 10, A: 11, '2': 12 };
  /** 第 k 副牌里的牌：dc("3c",1) = 第二副的 ♣3 */
  const dc = (s: string, deck = 0): CardId => R2[s.slice(0, -1)] * 4 + S[s.slice(-1)] + deck * 52;

  it('104 张牌：翻 1 张，每人 25 张，先手 26 张，烧掉 3 张', () => {
    for (let i = 0; i < 100; i++) {
      const g = newGame(four);
      expect(g.config.decks).toBe(2);
      const sizes = g.seats.map((s) => s.hand.length).sort((a, b) => a - b);
      expect(sizes).toEqual([25, 25, 25, 26]);
      expect(g.seats[g.turn].hand.length).toBe(26);
      const all = g.seats.flatMap((s) => s.hand);
      expect(new Set(all).size).toBe(101); // 没有重复的牌号；104 − 3 张烧掉
      expect(all.every((c) => c >= 0 && c < 104)).toBe(true);
    }
  });

  it('三人局还是一副牌 17 张', () => {
    const g = newGame(four.slice(0, 3));
    expect(g.config.decks).toBe(1);
    expect(g.seats.map((s) => s.hand.length).sort()).toEqual([17, 17, 18]);
  });

  it('先手：有两张 ♣3 的人先出', () => {
    const hands = [[dc('3c'), dc('3c', 1), dc('5d')], [dc('3d'), dc('3d', 1)], [dc('4c')], [dc('6c')]];
    expect(pickLeader(hands)).toBe(0);
  });

  it('先手：两人各一张 ♣3 → 有 ♦3 的人先出', () => {
    const hands = [[dc('3c'), dc('9s')], [dc('3c', 1), dc('3d'), dc('9h')], [dc('4c')], [dc('6c')]];
    expect(pickLeader(hands)).toBe(1);
  });

  it('先手：两人各一张 ♣3、各一张 ♦3 → 有 ♥3 的人先出', () => {
    const hands = [[dc('3c'), dc('3d')], [dc('3c', 1), dc('3d', 1), dc('3h')], [dc('4c')], [dc('6c')]];
    expect(pickLeader(hands)).toBe(1);
    const hands2 = [[dc('3c'), dc('3d'), dc('3h')], [dc('3c', 1), dc('3d', 1)], [dc('4c')], [dc('6c')]];
    expect(pickLeader(hands2)).toBe(0);
  });

  it('先手：一个人有 ♣3 → 他先出；两张 ♣3 都被烧掉 → 看 ♦3', () => {
    expect(pickLeader([[dc('4c')], [dc('3c')], [dc('5c')], [dc('6c')]])).toBe(1);
    expect(pickLeader([[dc('4c')], [dc('5c')], [dc('3d')], [dc('6c')]])).toBe(2);
  });

  it('第一手必须带 ♣3（两副牌里哪张 ♣3 都行）', () => {
    for (let i = 0; i < 30; i++) {
      let g = newGame(four);
      while (g.redealSeat !== null) g = redeal(g);
      const must = g.mustInclude!;
      expect(must).toBe(Math.min(...g.seats[g.turn].hand.map((c) => c % 52)));
      const hand = g.seats[g.turn].hand;
      const other = hand.find((c) => c % 52 !== must)!;
      expect(() => play(g, g.turn, [other])).toThrow();
      const withMust = hand.find((c) => c % 52 === must)!;
      g = play(g, g.turn, [withMust]);
      expect(g.mustInclude).toBe(null);
    }
  });

  it('铁支 = 五张一样的 + 一张单牌（共 6 张）', () => {
    const five = ['8c', '8d', '8h', '8s'].map((x) => dc(x)).concat(dc('8c', 1));
    const b = identify([...five, dc('3c')])!;
    expect(b.type).toBe('fivekind');
    // 比单张、对子、顺子、葫芦都大
    expect(canBeat(b, identify([dc('2s')]))).toBe(true);
    expect(canBeat(b, identify([dc('As'), dc('Ah')]))).toBe(true);
    // 比大小看那五张的点数
    const nine = ['9c', '9d', '9h', '9s'].map((x) => dc(x)).concat(dc('9c', 1));
    expect(canBeat(identify([...nine, dc('3d')])!, b)).toBe(true);
    expect(canBeat(b, identify([...nine, dc('3d')])!)).toBe(false);
    // 同花顺比铁支大
    const sf = identify(['4s', '5s', '6s', '7s', '8s'].map((x) => dc(x)))!;
    expect(sf.type).toBe('straightflush');
    expect(canBeat(sf, b)).toBe(true);
    expect(canBeat(b, sf)).toBe(false);
  });

  it('两副牌里：四张一样的 + 一张不再是铁支；一副牌里五张的铁支不存在', () => {
    const four5 = ['8c', '8d', '8h', '8s'].map((x) => dc(x)).concat(dc('3c'));
    expect(identify(four5)!.type).toBe('fourkind'); // 牌型本身认得出
    let g = newGame(four);
    while (g.redealSeat !== null) g = redeal(g);
    g = { ...g, mustInclude: null, turn: 0, lastPlay: null, seats: g.seats.map((s, i) => ({ ...s, hand: i === 0 ? [...four5, dc('K', 0)] : s.hand })) };
    expect(() => play(g, 0, four5)).toThrow(/五张/);
    const opts = playableCombos(g.seats[0].hand, null, 2);
    expect(opts.some((c) => c.type === 'fourkind')).toBe(false);
    expect(playableCombos(g.seats[0].hand, null, 1).some((c) => c.type === 'fourkind')).toBe(true);
  });

  it('两副牌里相同的牌不能互相压：♠3 压不过另一副的 ♠3，对子同理', () => {
    expect(canBeat(identify([dc('3s', 1)])!, identify([dc('3s')]))).toBe(false);
    expect(canBeat(identify([dc('4c')])!, identify([dc('3s', 1)]))).toBe(true);
    const p1 = identify([dc('5s'), dc('5s', 1)])!;
    const p2 = identify([dc('5s', 1), dc('5s')])!;
    expect(p1.type).toBe('pair');
    expect(canBeat(p2, p1)).toBe(false);
    expect(canBeat(identify([dc('6c'), dc('6d')])!, p1)).toBe(true);
  });

  it('同一张脸的两张可以一起出（两副牌的对子），出牌后只扣掉出的那两张', () => {
    let g = newGame(four);
    while (g.redealSeat !== null) g = redeal(g);
    g = { ...g, mustInclude: null, turn: 0, lastPlay: null, seats: g.seats.map((s, i) => ({ ...s, hand: i === 0 ? [dc('5s'), dc('5s', 1), dc('9c'), dc('9c', 1)] : [dc('Qc', i % 2)] })) };
    const g2 = play(g, 0, [dc('5s'), dc('5s', 1)]);
    expect(g2.seats[0].hand.sort((a, b) => a - b)).toEqual([dc('9c'), dc('9c', 1)]);
  });

  it('四人局：拿到 6 张以上的 2 才重发（约 1%），不是 4 张', () => {
    let redeals = 0, fourPlus = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const g = newGame(four);
      if (g.redealSeat !== null) {
        redeals++;
        expect(g.seats[g.redealSeat].hand.filter((c) => rankOf(c) === 12).length).toBeGreaterThanOrEqual(6);
      }
      if (g.seats.some((x) => x.hand.filter((c) => rankOf(c) === 12).length >= 4)) fourPlus++;
    }
    expect(redeals / N).toBeLessThan(0.03);
    expect(fourPlus / N).toBeGreaterThan(0.2); // 4 张 2 其实很常见，所以不能用它重发
    expect(configFor(3).redealTwos).toBe(4);
  });

  it('算钱：四人局赢家收三家的钱，零和', () => {
    let g = newGame(four);
    while (g.redealSeat !== null) g = redeal(g);
    g = { ...g, mustInclude: null, turn: 0, lastPlay: null, seats: g.seats.map((s, i) => ({ ...s, hand: [[dc('As')], [dc('3c'), dc('4c'), dc('5c')], [dc('3d')], [dc('3h'), dc('4h')]][i] })) };
    g = play(g, 0, [dc('As')]);
    expect(g.phase).toBe('roundOver');
    expect(g.lastDeltas).toEqual([6, -3, -1, -2]);
    expect(g.lastDeltas!.reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('机器人打 150 局四人局：只走合法的牌，零和，能打完', () => {
    for (let k = 0; k < 150; k++) {
      let s: GameState = newGame(Array.from({ length: 4 }, (_, i) => ({ id: String(i), name: String(i), isBot: true })));
      let steps = 0;
      while (s.phase === 'playing') {
        if (s.redealSeat !== null) { s = redeal(s); continue; }
        const m = chooseBotMove(s, s.turn);
        s = m.type === 'play' ? play(s, s.turn, m.cards) : pass(s, s.turn);
        if (++steps > 4000) throw new Error('game did not terminate');
      }
      expect(s.seats.reduce((a, x) => a + x.score, 0)).toBe(0);
      expect(s.seats[s.winner!].hand.length).toBe(0);
    }
  });
});
