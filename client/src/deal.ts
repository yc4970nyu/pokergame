import type { CardId } from '../../shared/src/cards';

/**
 * The opening of every round, as one timeline (seconds from the start, already scaled by the speed setting):
 *   draw   — the deck appears, the random card is drawn off the top, flips face-up and sits in the middle
 *   deal   — 17 cards each (25 with two decks), dealt round-robin one at a time (about 3 s at normal speed)
 *   give   — the drawn card flies to whoever holds the lowest card (♣3)
 *   reveal — my hand turns face-up
 *   ready  — input unlocks
 */
export interface DealPlan {
  round: number;
  startedAt: number; // performance.now() ms
  seats: number[]; // deal order
  perSeat: number;
  step: number;
  dealStart: number;
  dealEnd: number;
  give: number;
  reveal: number;
  ready: number;
  flipped: CardId;
  flippedTo: number;
}

// The server holds bots for DEAL_HOLD_MS (server/src/rooms.ts) so nobody moves before this timeline ends at normal speed.

export function makeDealPlan(round: number, nSeats: number, flipped: CardId, flippedTo: number, k: number, perSeat = 17): DealPlan {
  const dealStart = 0.9 * k;
  const dealDur = 3.0 * k;
  const step = dealDur / (perSeat * nSeats);
  const dealEnd = dealStart + dealDur;
  const give = dealEnd + 0.15 * k;
  const reveal = give + 0.35 * k;
  const ready = reveal + 0.45 * k;
  return {
    round, startedAt: performance.now(), seats: Array.from({ length: nSeats }, (_, i) => i), perSeat, step,
    dealStart, dealEnd, give, reveal, ready, flipped, flippedTo,
  };
}

/** When the j-th card for `seat` leaves the deck */
export const dealTime = (p: DealPlan, seat: number, j: number) =>
  p.dealStart + (j * p.seats.length + p.seats.indexOf(seat)) * p.step;

/** How many cards `seat` holds `t` seconds into the plan (for the opponent counters) */
export function countAt(p: DealPlan, seat: number, t: number, final: number) {
  if (t >= p.ready) return final;
  let n = 0;
  for (let j = 0; j < p.perSeat; j++) if (dealTime(p, seat, j) + 0.25 <= t) n++;
  if (seat === p.flippedTo && t >= p.give + 0.4) n++;
  return Math.min(n, final);
}
