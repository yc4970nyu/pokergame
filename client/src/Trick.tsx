import { useEffect, useLayoutEffect, useRef } from 'react';
import { motion, useMotionValue, animate, AnimatePresence } from 'motion/react';
import type { CardId } from '../../shared/src/cards';
import { COMBO_NAMES, isBomb, Combo } from '../../shared/src/combos';
import { CardFace, CardBack } from './Card';
import { flyFrom, seatRect, trickCenter } from './fly';
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

/** Backs flying from the deck to every opponent while my own hand deals in. */
export function DealLayer({ seats, perSeat, speed }: { seats: number[]; perSeat: number; speed: Speed }) {
  if (speed === 'off') return null;
  const c = trickCenter();
  const f = speed === 'fast' ? 2 : 1;
  return (
    <div className="fx-layer" aria-hidden>
      <motion.div className="deck" style={{ left: c.x, top: c.y }} initial={{ opacity: 1 }} animate={{ opacity: 0 }} transition={{ delay: (perSeat * 0.06) / f + 0.2, duration: 0.3 }}>
        {[0, 1, 2].map((i) => <div key={i} className="deck-card" style={{ transform: `translate(${-i * 1.5}px, ${-i * 1.5}px)` }}><CardBack /></div>)}
      </motion.div>
      {seats.flatMap((seat) => {
        const r = seatRect(seat);
        if (!r) return [];
        const tx = r.left + r.width / 2 - c.x;
        const ty = r.top + r.height / 2 - c.y;
        return Array.from({ length: Math.min(perSeat, 17) }, (_, i) => (
          <motion.div
            key={`${seat}-${i}`}
            className="deal-card"
            style={{ left: c.x, top: c.y }}
            initial={{ x: 0, y: 0, rotate: 0, opacity: 0 }}
            animate={{ x: tx, y: ty, rotate: (i % 2 ? 1 : -1) * (8 + i), opacity: [0, 1, 1, 0] }}
            transition={{
              delay: (i * 0.06) / f,
              x: { type: 'spring', stiffness: 170 * f, damping: 20 },
              y: { type: 'spring', stiffness: 170 * f, damping: 20 },
              rotate: { type: 'spring', stiffness: 200, damping: 14 },
              opacity: { duration: 0.5 / f, times: [0, 0.1, 0.75, 1] },
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
