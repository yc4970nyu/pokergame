import { useLayoutEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { CardId, cardLabel } from '../../shared/src/cards';
import { CardFace } from './Card';
import { sfx } from './sound';
import { trickCenter } from './fly';
import type { springs } from './settings';

type Springs = ReturnType<typeof springs>;

interface Slot { x: number; y: number; r: number; z: number }

/** Slot geometry for n cards: one fanned arc, or two rows on narrow screens. */
function computeSlots(n: number, w: number, h: number) {
  const cw = Math.max(50, Math.min(112, w / 6, h * 0.16));
  const ch = cw * (244.64 / 169.075);
  const pad = Math.max(12, cw * 0.18);
  const usable = w - pad * 2;
  // ~35% overlap when there's room
  const fit = (count: number) => (count > 1 ? Math.min(cw * 0.65, (usable - cw) / (count - 1)) : 0);
  const rowsCount = n > 1 && fit(n) < cw * 0.38 ? 2 : 1;
  const per = rowsCount === 2 ? [Math.ceil(n / 2), n - Math.ceil(n / 2)] : [n];
  const rowGap = ch * 0.5;
  const slots: Slot[] = [];
  per.forEach((count, ri) => {
    const step = fit(count);
    const span = cw + step * Math.max(0, count - 1);
    const x0 = pad + (usable - span) / 2;
    const mid = (count - 1) / 2 || 1;
    for (let i = 0; i < count; i++) {
      const t = (i - mid) / mid;
      const single = rowsCount === 1;
      slots.push({
        x: x0 + i * step,
        y: 30 + ri * rowGap + (single ? t * t * cw * 0.16 : 0),
        r: single ? t * Math.min(8, count * 0.6) : 0,
        z: ri * 100 + i,
      });
    }
  });
  let height = ch + 34;
  for (const s of slots) height = Math.max(height, s.y + ch + Math.abs(Math.sin((s.r * Math.PI) / 180)) * cw * 0.5 + 6);
  return { slots, cw, ch, height };
}

type Gesture =
  | { mode: 'pending'; id: CardId; x0: number; y0: number; type: string; timer: number }
  | { mode: 'select'; add: boolean; touched: Set<CardId> }
  | { mode: 'drag'; id: CardId; dx: number; dy: number };

export function Hand({
  order, setOrder, selected, setSelected, round, sp, k, dealtAt, active, idle,
}: {
  order: CardId[];
  setOrder: (o: CardId[]) => void;
  selected: Set<CardId>;
  setSelected: (s: Set<CardId>) => void;
  round: number;
  sp: Springs;
  k: number;
  dealtAt: number;
  active: boolean;
  idle: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 360, h: 640 });
  const [drag, setDrag] = useState<{ id: CardId; x: number; y: number } | null>(null);
  const gesture = useRef<Gesture | null>(null);
  // live copies so pointer handlers never read stale props mid-gesture
  const live = useRef({ order, selected });
  live.current = { order, selected };

  useLayoutEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: window.innerHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { slots, cw, ch, height } = computeSlots(order.length, box.w, box.h);
  const dealing = Date.now() - dealtAt < 1800 * Math.max(k, 0.01);

  // where the deck sits, relative to this container — cards fly from there on the deal
  const deckFrom = (() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return { x: box.w / 2 - cw / 2, y: -box.h * 0.4 };
    const c = trickCenter();
    return { x: c.x - r.left - cw / 2, y: c.y - r.top - ch / 2 };
  })();

  // ---------------- gestures ----------------
  const local = (e: { clientX: number; clientY: number }) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const idAt = (x: number, y: number) => {
    const el = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('[data-card]');
    return el && ref.current?.contains(el) ? Number(el.dataset.card) : null;
  };
  const toggle = (id: CardId, add?: boolean) => {
    const cur = live.current.selected;
    const on = add ?? !cur.has(id);
    if (cur.has(id) === on) return;
    const next = new Set(cur);
    if (on) next.add(id); else next.delete(id);
    live.current.selected = next;
    setSelected(next);
    sfx.select();
  };

  const startDrag = (id: CardId, px: number, py: number) => {
    const i = live.current.order.indexOf(id);
    const s = slots[i];
    if (!s) return;
    gesture.current = { mode: 'drag', id, dx: px - s.x, dy: py - s.y };
    setDrag({ id, x: s.x, y: s.y - 30 });
    navigator.vibrate?.(8);
    sfx.pickup();
  };

  const nearestSlot = (x: number, y: number) => {
    let best = 0;
    let bd = Infinity;
    slots.forEach((s, i) => {
      const d = (s.x - x) ** 2 + ((s.y - y) * 1.6) ** 2;
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  };

  const onDown = (e: React.PointerEvent) => {
    const id = idAt(e.clientX, e.clientY);
    if (id === null) return;
    ref.current!.setPointerCapture(e.pointerId);
    const p = local(e);
    const timer = window.setTimeout(() => {
      const g = gesture.current;
      if (g?.mode === 'pending') startDrag(g.id, p.x, p.y); // long-press picks the card up
    }, 260);
    gesture.current = { mode: 'pending', id, x0: e.clientX, y0: e.clientY, type: e.pointerType, timer };
  };

  const onMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    if (g.mode === 'pending') {
      const dist = Math.hypot(e.clientX - g.x0, e.clientY - g.y0);
      if (dist < 8) return;
      clearTimeout(g.timer);
      if (g.type === 'mouse') {
        const p = local({ clientX: g.x0, clientY: g.y0 });
        startDrag(g.id, p.x, p.y);
      } else {
        // a quick finger swipe across cards = select a run of cards
        const add = !live.current.selected.has(g.id);
        gesture.current = { mode: 'select', add, touched: new Set([g.id]) };
        toggle(g.id, add);
      }
      return;
    }
    if (g.mode === 'select') {
      const id = idAt(e.clientX, e.clientY);
      if (id !== null && !g.touched.has(id)) {
        g.touched.add(id);
        toggle(id, g.add);
      }
      return;
    }
    // dragging: card follows the finger, neighbours make room
    const p = local(e);
    const x = p.x - g.dx;
    const y = p.y - g.dy;
    setDrag({ id: g.id, x, y });
    const cur = live.current.order;
    const from = cur.indexOf(g.id);
    const to = nearestSlot(x, y + 30);
    if (from !== to && from >= 0) {
      const next = cur.slice();
      next.splice(from, 1);
      next.splice(to, 0, g.id);
      live.current.order = next;
      setOrder(next);
      sfx.tick();
    }
  };

  const onUp = () => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (g.mode === 'pending') {
      clearTimeout(g.timer);
      toggle(g.id); // a plain tap
    }
    if (g.mode === 'drag') setDrag(null); // card snaps into its slot
  };

  return (
    <div
      ref={ref}
      className={`hand ${active ? 'active' : ''} ${drag ? 'dragging' : ''} ${idle ? 'idle' : ''}`}
      style={{ height, ['--cw' as string]: `${cw}px` }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onContextMenu={(e) => e.preventDefault()}
    >
      {order.map((c, i) => {
        const s = slots[i];
        if (!s) return null;
        const sel = selected.has(c);
        const isDragged = drag?.id === c;
        const target = isDragged
          ? { x: drag.x, y: drag.y, rotate: 0, scale: 1.1 }
          : { x: s.x, y: s.y - (sel ? 24 : 0), rotate: s.r, scale: sel ? 1.08 : 1 };
        const transition = isDragged
          ? { x: { duration: 0 }, y: { duration: 0 }, rotate: sp.snap, scale: sp.snap }
          : dealing && !sp.off
            ? { ...sp.deal, delay: i * 0.06 * k }
            : drag
              ? sp.push
              : sp.snap;
        return (
          <motion.div
            key={`r${round}-c${c}`}
            data-card={c}
            className={`hand-card ${sel ? 'sel' : ''} ${isDragged ? 'held' : ''}`}
            style={{ zIndex: isDragged ? 999 : s.z, width: cw }}
            tabIndex={0}
            role="checkbox"
            aria-checked={sel}
            aria-label={cardLabel(c)}
            onKeyDown={(e) => {
              if (e.key === ' ') { e.preventDefault(); toggle(c); }
              // keyboard reorder: Shift + ← / →
              if (e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
                e.preventDefault();
                const j = i + (e.key === 'ArrowLeft' ? -1 : 1);
                if (j < 0 || j >= order.length) return;
                const next = order.slice();
                [next[i], next[j]] = [next[j], next[i]];
                setOrder(next);
              }
            }}
            onPointerMove={(e) => {
              // tilt toward the cursor (mouse only)
              if (e.pointerType !== 'mouse' || drag) return;
              const el = e.currentTarget.querySelector<HTMLElement>('.tilt');
              const r = e.currentTarget.getBoundingClientRect();
              const px = (e.clientX - r.left) / r.width - 0.5;
              const py = (e.clientY - r.top) / r.height - 0.5;
              el?.style.setProperty('--rx', `${(-py * 14).toFixed(1)}deg`);
              el?.style.setProperty('--ry', `${(px * 16).toFixed(1)}deg`);
            }}
            onPointerLeave={(e) => {
              const el = e.currentTarget.querySelector<HTMLElement>('.tilt');
              el?.style.setProperty('--rx', '0deg');
              el?.style.setProperty('--ry', '0deg');
            }}
            initial={{ x: deckFrom.x, y: deckFrom.y, rotate: (Math.random() - 0.5) * 50, scale: 0.75, opacity: 0 }}
            animate={{ ...target, opacity: 1 }}
            whileHover={isDragged || drag ? undefined : { y: s.y - (sel ? 28 : 12), scale: sel ? 1.1 : 1.05 }}
            transition={transition}
          >
            <div className="tilt">
              <div className="breathe" style={{ animationDelay: `${(i * 0.37) % 4}s` }}>
                <CardFace id={c} />
              </div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
