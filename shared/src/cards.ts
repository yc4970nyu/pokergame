// 大老二 — card model
//
// A card is an integer 0..51:  id = rankIndex * 4 + suitIndex
//   rankIndex: 0 = '3', 1 = '4', ... 10 = 'K', 11 = 'A', 12 = '2'   (3 smallest, 2 biggest)
//   suitIndex: 0 = ♣ club, 1 = ♦ diamond, 2 = ♥ heart, 3 = ♠ spade (club smallest)
// So comparing two single cards is just comparing their ids.

export type CardId = number;

export const SUITS = ['club', 'diamond', 'heart', 'spade'] as const;
export const SUIT_SYMBOLS = ['♣', '♦', '♥', '♠'] as const;
export const RANK_LABELS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'] as const;

export const CLUB_3: CardId = 0;

export const rankOf = (c: CardId) => Math.floor(c / 4);
export const suitOf = (c: CardId) => c % 4;

/** Natural rank used for straights: A=1, 2=2, 3=3 ... K=13 */
export const naturalRank = (c: CardId) => {
  const r = rankOf(c);
  if (r === 11) return 1; // A
  if (r === 12) return 2; // 2
  return r + 3;
};

export const cardLabel = (c: CardId) => `${SUIT_SYMBOLS[suitOf(c)]}${RANK_LABELS[rankOf(c)]}`;

/** File name inside /cards (svg-cards PNG set) */
export const cardImageName = (c: CardId) => {
  const r = rankOf(c);
  const suit = SUITS[suitOf(c)];
  const face =
    r === 11 ? '1' : r === 12 ? '2' : r === 8 ? 'jack' : r === 9 ? 'queen' : r === 10 ? 'king' : String(r + 3);
  return `${suit}_${face}`;
};

export const fullDeck = (): CardId[] => Array.from({ length: 52 }, (_, i) => i);

export function shuffle<T>(arr: T[], rand: () => number = Math.random): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const sortCards = (cards: CardId[]) => cards.slice().sort((a, b) => a - b);
