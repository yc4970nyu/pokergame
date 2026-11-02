import { cardImageName, cardLabel, CardId } from '../../shared/src/cards';

const BACK = '/cards/back-green.png';

/** Preload all faces once so deals / plays never flash blank */
export function preloadCards() {
  for (let i = 0; i < 52; i++) {
    const img = new Image();
    img.src = `/cards/${cardImageName(i)}.png`;
  }
  const b = new Image();
  b.src = BACK;
}

export function CardFace({ id, className = '' }: { id: CardId; className?: string }) {
  return (
    <div className={`card ${className}`} aria-label={cardLabel(id)} role="img">
      <img src={`/cards/${cardImageName(id)}.png`} alt="" draggable={false} />
    </div>
  );
}

export function CardBack({ className = '' }: { className?: string }) {
  return (
    <div className={`card back ${className}`} aria-hidden>
      <img src={BACK} alt="" draggable={false} />
    </div>
  );
}
