import { useEffect, useLayoutEffect, useRef } from 'react';
import { motion, useMotionValue, animate, AnimatePresence } from 'motion/react';
import type { CardId } from '../../shared/src/cards';
import { COMBO_NAMES, isBomb, Combo } from '../../shared/src/combos';
import { CardFace, CardBack } from './Card';
import { flyFrom, seatRect, deckPoint, flipPoint } from './fly';
import { DealPlan, dealTime } from './deal';
import { cardLabel } from '../../shared/src/cards';
import { sfx } from './sound';
import type { Speed } from './settings';

/**
 * One card landing on the table. It starts wherever it came from (my hand, or an
 * opponent's seat), travels on a lobbed arc driven by two springs with a sideways
 * kick, flips face-up if it was hidden, and lands with a small scale bounce.
 */
function TableCard({
  id, index, count, seat, fromMe, speed, onLand,
}: {
  id: CardId; index: number; count: number; seat: number; fromMe: boolean; speed: Speed; onLand?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const r = useMotionValue(0);
  const ry = useMotionValue(0);
  const s = useMotionValue(1);

  useLayoutEffect(() => {
    if (speed === 'off') return;
    const to = ref.current!.getBoundingClientRect();
    const toC = { x: to.left + to.width / 2, y: to.top + to.height / 2 };
    const mine = fromMe ? flyFrom.get(id) : undefined;
    let from: { x: number; y: number; w: number; rot: number };
    if (mine) {
      const m = mine.rect;
      from = { x: m.left + m.width / 2, y: m.top + m.height / 2, w: m.width, rot: mine.rotate };
    } else {
      const sr = seatRect(seat);
      from = sr
        ? { x: sr.left + sr.width / 2, y: sr.top + sr.height / 2, w: to.width * 0.45, rot: (index - count / 2) * 14 }
        : { x: toC.x, y: toC.y - 200, w: to.width, rot: 0 };
    }
    const dx = from.x - toC.x;
    const dy = from.y - toC.y;
    x.set(dx);
    y.set(dy);
    r.set(from.rot);
    s.set(from.w / to.width);
    if (!fromMe) ry.set(180);

    // perpendicular kick so the path bows instead of going straight
    const len = Math.hypot(dx, dy) || 1;
    let px = -dy / len;
    let py = dx / len;
    if (py > 0 || (Math.abs(py) < 0.2 && (index - (count - 1) / 2) * px < 0)) { px = -px; py = -py; }
    const kick = Math.min(1100, len * 2.4);
    const f = speed === 'fast' ? 1.8 : 1;
    const delay = index * 0.045 / f;
    const ctl = [
      animate(x, 0, { type: 'spring', stiffness: 150 * f, damping: 19, velocity: px * kick, delay }),
      animate(y, 0, { type: 'spring', stiffness: 150 * f, damping: 19, velocity: py * kick, delay }),
      animate(r, 0, { type: 'spring', stiffness: 200 * f, damping: 12, delay }),
      animate(ry, 0, { type: 'spring', stiffness: 260 * f, damping: 26, delay: delay + 0.05 }),
      // grow on the way in, overshoot a touch, then the landing bounce
      animate(s, [s.get(), 1.14, 1], { duration: 0.5 / f, times: [0, 0.65, 1], ease: ['easeOut', 'backOut'], delay }),
    ];
    const t = window.setTimeout(() => onLand?.(), (delay + 0.33 / f) * 1000);
    if (!fromMe) window.setTimeout(() => sfx.flip(), (delay + 0.12 / f) * 1000);
    return () => { ctl.forEach((c) => c.stop()); clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <motion.div ref={ref} className="trick-card" style={{ zIndex: index, x, y, rotate: r, scale: s }}>
      <motion.div className="flip-inner" style={{ rotateY: ry }}>
        <div className="flip-face"><CardFace id={id} /></div>
        <div className="flip-face backside"><CardBack /></div>
      </motion.div>
    </motion.div>
  );
}

export function TrickCards({
  play, dim, win, fromMe, who, speed,
}: {
  play: { seat: number; combo: Combo };
  dim: boolean; win: boolean; fromMe: boolean; who?: string; speed: Speed;
}) {
  const cards = play.combo.cards;
  const bomb = isBomb(play.combo.type);
  let landed = false;
  return (
    <motion.div
      className={`trick-cards ${dim ? 'dim' : ''} ${bomb ? 'bomb' : ''} ${win ? 'win' : ''}`}
      animate={win && speed !== 'off' ? { y: -12 } : { y: 0 }}
      transition={{ type: 'spring', stiffness: 220, damping: 18 }}
      exit={{ opacity: 0, scale: 0.88, y: 24, transition: { duration: 0.2 } }}
    >
      <div className="trick-pot">
        <span>{who}</span>
        <b>{COMBO_NAMES[play.combo.type]}</b>
        {bomb && <i className="bomb-tag">炸弹</i>}
      </div>
      <div className="trick-row" style={{ ['--count' as string]: cards.length }}>
        {cards.map((c, i) => (
          <TableCard
            key={c}
            id={c}
            index={i}
            count={cards.length}
            seat={play.seat}
            fromMe={fromMe}
            speed={speed}
            onLand={() => { if (!landed) { landed = true; sfx.thunk(); } }}
          />
        ))}
      </div>
    </motion.div>
  );
}

/**
 * The opening sequence (see deal.ts): deck in the middle, the random card drawn and turned
 * face-up beside it, then cards dealt round-robin to every opponent seat, then the drawn card
 * flies to its owner. My own cards are animated by <Hand> on the same timeline.
 */
export function DealSequence({ plan, me, names }: { plan: DealPlan; me: number; names: string[] }) {
  const d = deckPoint();
  const fp = flipPoint();
  const opponents = plan.seats.filter((s) => s !== me);
  // 4 人局没有翻牌：只发牌，不翻、不递牌
  const flipCard = plan.flipped;
  const flipTo = plan.flippedTo;

  // one soft card sound per card leaving the deck, plus the draw and the hand-over
  useEffect(() => {
    const ts: number[] = [];
    const at = (sec: number, fn: () => void) => ts.push(window.setTimeout(fn, sec * 1000));
    if (flipCard !== null) at(0.25, () => sfx.flip());
    for (const seat of plan.seats) for (let j = 0; j < plan.perSeat; j++) at(dealTime(plan, seat, j), () => sfx.dealCard());
    if (flipCard !== null) at(plan.give, () => sfx.thunk());
    return () => ts.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toOwner = (() => {
    if (flipTo === null || flipTo === me) return null; // <Hand> takes over the card
    const r = seatRect(flipTo);
    return r ? { x: r.left + r.width / 2 - fp.x, y: r.top + r.height / 2 - fp.y } : null;
  })();

  return (
    <div className="fx-layer" aria-hidden>
      {/* the deck */}
      <motion.div
        className="deck"
        style={{ left: d.x, top: d.y }}
        initial={{ opacity: 0, scale: 0.8, y: 20 }}
        animate={{ opacity: [0, 1, 1, 0], scale: [0.8, 1, 1, 0.9], y: [20, 0, 0, 0] }}
        transition={{ duration: plan.dealEnd + 0.2, times: [0, 0.12 / (plan.dealEnd + 0.2) * 2, plan.dealEnd / (plan.dealEnd + 0.2), 1] }}
      >
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="deck-card" style={{ transform: `translate(${-i * 0.8}px, ${-i * 1.2}px)` }}><CardBack /></div>
        ))}
      </motion.div>

      {/* the drawn card: lifts off the deck, flips face-up, waits in the middle, then goes to its owner */}
      {flipCard !== null && flipTo !== null && (<>
      <motion.div
        className="drawn"
        style={{ left: fp.x, top: fp.y }}
        initial={{ x: d.x - fp.x, y: d.y - fp.y - 6, rotate: -4, scale: 1, opacity: 0 }}
        animate={{
          x: [d.x - fp.x, 0, 0, toOwner ? toOwner.x : 0],
          y: [d.y - fp.y - 6, -10, 0, toOwner ? toOwner.y : 0],
          rotate: [-4, 3, 0, toOwner ? 10 : 0],
          scale: [1, 1.25, 1.25, toOwner ? 0.6 : 1.25],
          // into my hand: vanish the instant the hand's copy starts from this spot
          opacity: toOwner ? [1, 1, 1, 0] : [1, 1, 1, 0],
        }}
        transition={{
          duration: toOwner ? plan.give + 0.5 : plan.give + 0.02,
          times: toOwner
            ? [0, 0.6 / (plan.give + 0.5), plan.give / (plan.give + 0.5), 1]
            : [0, 0.6 / (plan.give + 0.02), plan.give / (plan.give + 0.02), 1],
          ease: 'easeInOut',
        }}
      >
        <div className="flip-3d-wrap">
          <motion.div className="flip-inner" initial={{ rotateY: 180 }} animate={{ rotateY: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 24, delay: 0.3 }}>
            <div className="flip-face"><CardFace id={flipCard} /></div>
            <div className="flip-face backside"><CardBack /></div>
          </motion.div>
        </div>
      </motion.div>
      <motion.div
        className="drawn-label"
        style={{ left: fp.x, top: fp.y }}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: [0, 1, 1, 0], y: [10, 0, 0, 0] }}
        transition={{ duration: plan.give + 0.3, times: [0, 0.9 / (plan.give + 0.3), plan.give / (plan.give + 0.3), 1] }}
      >
        翻牌 {cardLabel(flipCard)} → {names[flipTo]}
      </motion.div>
      </>)}

      {/* cards dealt to each opponent, one at a time, round-robin */}
      {opponents.flatMap((seat) => {
        const r = seatRect(seat);
        if (!r) return [];
        const tx = r.left + r.width / 2 - d.x;
        const ty = r.top + r.height / 2 - d.y;
        return Array.from({ length: plan.perSeat }, (_, j) => (
          <motion.div
            key={`${seat}-${j}`}
            className="deal-card"
            style={{ left: d.x, top: d.y }}
            initial={{ x: 0, y: 0, rotate: 0, opacity: 0, scale: 1 }}
            animate={{ x: tx, y: ty, rotate: 180 + (j % 2 ? 9 : -9), opacity: [1, 1, 0], scale: 0.7 }}
            transition={{
              delay: dealTime(plan, seat, j),
              x: { type: 'spring', stiffness: 240, damping: 26 },
              y: { type: 'spring', stiffness: 240, damping: 26 },
              rotate: { type: 'spring', stiffness: 200, damping: 20 },
              scale: { duration: 0.35 },
              opacity: { duration: 0.45, times: [0, 0.7, 1] },
            }}
          >
            <CardBack />
          </motion.div>
        ));
      })}
    </div>
  );
}

/** Gold chips flying from each loser to the winner — one chip per card they were left holding. */
export function ChipsLayer({ from, to, speed }: { from: { seat: number; n: number }[]; to: number; speed: Speed }) {
  const f = speed === 'fast' ? 2 : 1;
  const total = from.reduce((a, b) => a + Math.min(b.n, 12), 0);
  useEffect(() => {
    if (speed === 'off') return;
    const ts = Array.from({ length: total }, (_, i) => window.setTimeout(() => sfx.chip(), ((0.35 + i * 0.06) / f + 0.45 / f) * 1000));
    return () => ts.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (speed === 'off') return null;
  const target = seatRect(to);
  if (!target) return null;
  const tx = target.left + target.width / 2;
  const ty = target.top + target.height / 2;
  let k = 0;
  return (
    <div className="fx-layer" aria-hidden>
      {from.flatMap(({ seat, n }) => {
        const r = seatRect(seat);
        if (!r) return [];
        const sx = r.left + r.width / 2;
        const sy = r.top + r.height / 2;
        return Array.from({ length: Math.min(n, 12) }, (_, i) => {
          const delay = (0.35 + k++ * 0.06) / f;
          return (
            <motion.div
              key={`${seat}-${i}`}
              className="chip-token"
              style={{ left: sx, top: sy }}
              initial={{ x: 0, y: 0, scale: 0, opacity: 0 }}
              animate={{ x: tx - sx, y: ty - sy, scale: [0, 1.15, 1, 0.6], opacity: [0, 1, 1, 0] }}
              transition={{
                delay,
                x: { type: 'spring', stiffness: 120 * f, damping: 17 },
                y: { type: 'spring', stiffness: 120 * f, damping: 17, velocity: -700 },
                scale: { duration: 0.75 / f, times: [0, 0.15, 0.8, 1] },
                opacity: { duration: 0.75 / f, times: [0, 0.1, 0.85, 1] },
              }}
            />
          );
        });
      })}
    </div>
  );
}

export { AnimatePresence };
