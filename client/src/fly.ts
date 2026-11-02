import type { CardId } from '../../shared/src/cards';

/**
 * Screen rects of cards just before they leave the hand, so the table copy can
 * fly from exactly where the card was. Filled right before sending a play.
 */
export const flyFrom = new Map<CardId, { rect: DOMRect; rotate: number }>();

export function rememberHandRects(cards: CardId[]) {
  for (const c of cards) {
    const el = document.querySelector<HTMLElement>(`[data-card="${c}"] .card`);
    if (!el) continue;
    const m = /rotate\(([-\d.]+)deg\)/.exec(el.closest<HTMLElement>('[data-card]')?.style.transform ?? '');
    flyFrom.set(c, { rect: el.getBoundingClientRect(), rotate: m ? Number(m[1]) : 0 });
  }
}

/** Centre of a seat on screen (opponent badge, or my bar) */
export function seatRect(seat: number): DOMRect | null {
  return document.querySelector<HTMLElement>(`[data-seat="${seat}"]`)?.getBoundingClientRect() ?? null;
}

export function trickCenter(): { x: number; y: number } {
  const r = document.querySelector<HTMLElement>('.trick')?.getBoundingClientRect();
  return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: innerWidth / 2, y: innerHeight * 0.45 };
}
