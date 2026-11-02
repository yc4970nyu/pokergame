import { describe, it, expect } from 'vitest';
import {
  CardId, identify, canBeat, newGame, play, pass, chooseBotMove, enumerateCombos, playableCombos,
  GameState, rankOf, nextRound,
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
    g = { ...g, turn: 0, seats: g.seats.map((s, i) => ({ ...s, hand: [cs('3c 9c Kc'), cs('5c 6c 7c'), cs('4c 8c Qc')][i] })) };
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
    g = { ...g, turn: 0, seats: g.seats.map((s, i) => ({ ...s, hand: [cs('3c 3d 9c'), cs('5c 5d 7c'), cs('4c 8c Qc')][i] })) };
    expect(() => pass(g, 0)).toThrow();
    g = play(g, 0, cs('3c 3d'));
    expect(() => play(g, 1, cs('7c'))).toThrow();
    g = play(g, 1, cs('5c 5d'));
    expect(g.turn).toBe(2);
  });

  it('scoring: winner gets the sum of the others\' remaining cards', () => {
    let g = mk();
    g = { ...g, turn: 0, seats: g.seats.map((s, i) => ({ ...s, hand: [cs('2s'), cs('3c 4c 5c 6c 8d'), cs('3d 4d 5d 6d 8h')][i] })) };
    g = play(g, 0, cs('2s'));
    expect(g.phase).toBe('roundOver');
    expect(g.winner).toBe(0);
    expect(g.lastDeltas).toEqual([10, -5, -5]);
    expect(g.seats.map((s) => s.score)).toEqual([10, -5, -5]);
    g = nextRound(g);
    expect(g.phase).toBe('playing');
    expect(g.round).toBe(2);
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
