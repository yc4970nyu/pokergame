import { cardImageName, cardLabel, CardId } from '../../shared/src/cards';

/** svg-cards (htdebeer, LGPL) — every card is a symbol in one sprite, top-left at (0,0) */
const SPRITE = '/cards/svg-cards.svg?v=2';
export const CARD_W = 169.075;
export const CARD_H = 244.64;
/** The printable card inside each sprite cell (the sprite leaves a 1.25 margin) — crop to it so our own rounded edge and shadow define the card */
const FACE_BOX = '1.25 1.25 166.575 242.14';

/** Fetch the sprite once up front so the first deal never flashes blank */
export function preloadCards() {
  fetch(SPRITE).catch(() => {});
}

export function CardFace({ id, className = '' }: { id: CardId; className?: string }) {
  return (
    <div className={`card ${className}`} aria-label={cardLabel(id)} role="img">
      <svg viewBox={FACE_BOX} preserveAspectRatio="none">
        <use href={`${SPRITE}#${cardImageName(id)}`} />
      </svg>
    </div>
  );
}

export function CardBack({ className = '' }: { className?: string }) {
  return (
    <div className={`card back ${className}`} aria-hidden>
      <svg viewBox={`0 0 ${CARD_W} ${CARD_H}`} preserveAspectRatio="none">
        <use href="#dld-back" />
      </svg>
    </div>
  );
}

/**
 * The house card back — rendered once into the page and reused by every <CardBack>.
 * Deep ink-navy field, thin gold frame, a quiet diamond lattice and a 「二」 medallion.
 */
export function CardDefs() {
  const W = CARD_W;
  const H = CARD_H;
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
      <defs>
        <linearGradient id="dld-field" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#26304a" />
          <stop offset="0.55" stopColor="#1a2232" />
          <stop offset="1" stopColor="#0f1420" />
        </linearGradient>
        <linearGradient id="dld-gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f0d77b" />
          <stop offset="0.5" stopColor="#d4af37" />
          <stop offset="1" stopColor="#9c7c22" />
        </linearGradient>
        <pattern id="dld-lattice" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <path d="M0 0H14M0 0V14" stroke="#d4af37" strokeOpacity="0.22" strokeWidth="0.8" fill="none" />
          <circle cx="7" cy="7" r="0.9" fill="#d4af37" fillOpacity="0.28" />
        </pattern>
        <clipPath id="dld-inner">
          <rect x="13" y="13" width={W - 26} height={H - 26} rx="5" />
        </clipPath>
        <g id="dld-back">
          <rect x="0.5" y="0.5" width={W - 1} height={H - 1} rx="11" fill="url(#dld-field)" stroke="#0b0f18" />
          <rect x="7" y="7" width={W - 14} height={H - 14} rx="7" fill="none" stroke="url(#dld-gold)" strokeWidth="1.4" />
          <g clipPath="url(#dld-inner)">
            <rect x="0" y="0" width={W} height={H} fill="url(#dld-lattice)" />
          </g>
          <rect x="13" y="13" width={W - 26} height={H - 26} rx="5" fill="none" stroke="#d4af37" strokeOpacity="0.45" strokeWidth="0.6" />
          {/* medallion */}
          <g transform={`translate(${W / 2} ${H / 2})`}>
            <path d="M0 -46 L32 0 L0 46 L-32 0 Z" fill="#1a2232" stroke="url(#dld-gold)" strokeWidth="1.4" />
            <path d="M0 -38 L26 0 L0 38 L-26 0 Z" fill="none" stroke="#d4af37" strokeOpacity="0.5" strokeWidth="0.6" />
            <text
              y="13"
              textAnchor="middle"
              fontFamily="'Ma Shan Zheng', 'STKaiti', 'KaiTi', serif"
              fontSize="40"
              fill="url(#dld-gold)"
            >
              二
            </text>
          </g>
          {/* corner pips */}
          {[
            [22, 24],
            [W - 22, 24],
            [22, H - 24],
            [W - 22, H - 24],
          ].map(([x, y], i) => (
            <path key={i} transform={`translate(${x} ${y})`} d="M0 -4 L3 0 L0 4 L-3 0 Z" fill="#d4af37" fillOpacity="0.8" />
          ))}
        </g>
      </defs>
    </svg>
  );
}
