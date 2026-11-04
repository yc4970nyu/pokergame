import { CardId, face, rankOf } from './cards';
import { Combo, isBomb } from './combos';
import { GameState, legalPlays } from './game';

export type BotMove = { type: 'play'; cards: CardId[] } | { type: 'pass' };

/**
 * Simple but sensible bot:
 *  - Leading: dump the cheapest multi-card combo first (straight / full house / pair), else the lowest single.
 *  - Following: play the cheapest combo that beats the table; only bombs when an opponent is close to going out.
 *  - Avoids breaking a 2 early unless needed.
 */
export function chooseBotMove(state: GameState, seat: number): BotMove {
  const hand = state.seats[seat].hand;
  const prev = state.lastPlay?.combo ?? null;
  const options = legalPlays(state, seat);
  const threat = Math.min(...state.seats.filter((_, i) => i !== seat).map((s) => s.hand.length));

  // Can we go out right now?
  const finisher = options.find((c) => c.cards.length === hand.length);
  if (finisher) return { type: 'play', cards: finisher.cards };

  if (!prev) {
    const pick = pickLead(options, hand.length, threat);
    return { type: 'play', cards: pick.cards };
  }

  const nonBombs = options.filter((c) => !isBomb(c.type));
  if (nonBombs.length) {
    const cheapest = nonBombs[0];
    // Hold back very high cards early if the threat is low
    const usesTwo = cheapest.cards.some((c) => rankOf(c) === 12);
    if (usesTwo && threat > 5 && hand.length > 6 && Math.random() < 0.6) return { type: 'pass' };
    return { type: 'play', cards: cheapest.cards };
  }
  const bombs = options.filter((c) => isBomb(c.type));
  if (bombs.length && (threat <= 4 || hand.length <= 6)) return { type: 'play', cards: bombs[0].cards };
  return { type: 'pass' };
}

function pickLead(options: Combo[], handLen: number, threat: number): Combo {
  const nonBombs = options.filter((c) => !isBomb(c.type));
  const pool = nonBombs.length ? nonBombs : options;
  const low = (t: Combo['type']) => pool.filter((c) => c.type === t).sort((a, b) => a.key - b.key)[0];
  // When an opponent is about to go out, lead strong / multi-card to block singles
  if (threat <= 2) {
    const big = low('straight') ?? low('fullhouse') ?? low('pair');
    if (big) return big;
    return pool.filter((c) => c.type === 'single').sort((a, b) => b.key - a.key)[0];
  }
  const straight = low('straight');
  if (straight && face(straight.cards[4]) < 44) return straight;
  const fh = low('fullhouse');
  if (fh && fh.key < 9) return fh;
  const single = low('single');
  const pair = low('pair');
  if (pair && single && pair.key < single.key + 8 && handLen > 3) return pair;
  return single ?? pool[0];
}
