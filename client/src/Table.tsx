import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, LayoutGroup, motion, animate } from 'motion/react';
import type { RoomView, PlayerView } from '../../shared/src/protocol';
import { CardId, cardLabel, rankOf, suitOf } from '../../shared/src/cards';
import { identify, canBeat, playableCombos, COMBO_NAMES, isBomb, Combo } from '../../shared/src/combos';
import { CardFace, CardBack } from './Card';
import { api, toast } from './net';
import { sfx } from './sound';
import { useSettings, setSettings, springs, speedFactor, Speed } from './settings';

type Pos = 'bottom' | 'left' | 'right' | 'top';
type Springs = ReturnType<typeof springs>;

const posOf = (seat: number, me: number, n: number): Pos => {
  const rel = (seat - me + n) % n;
  if (rel === 0) return 'bottom';
  if (n === 2) return 'top';
  return rel === 1 ? 'right' : 'left';
};

/** Where cards fly in from, relative to the table centre */
const originOf = (p: Pos) => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (p === 'left') return { x: -w * 0.38, y: -h * 0.12 };
  if (p === 'right') return { x: w * 0.38, y: -h * 0.12 };
  if (p === 'top') return { x: 0, y: -h * 0.3 };
  return { x: 0, y: h * 0.35 };
};

const layoutKey = (round: number, id: CardId) => `r${round}-c${id}`;

export function Table({ room }: { room: RoomView }) {
  const g = room.game!;
  const me = g.yourSeat;
  const n = room.players.length;
  const { speed } = useSettings();
  const sp = springs(speed);
  const k = speedFactor(speed);

  const [selected, setSelected] = useState<Set<CardId>>(new Set());
  const [sortMode, setSortMode] = useState<'rank' | 'suit'>('rank');
  const [hintIdx, setHintIdx] = useState(0);
  const [ghost, setGhost] = useState<{ seat: number; combo: Combo } | null>(null);
  const [flipShow, setFlipShow] = useState(false);
  const [menu, setMenu] = useState(false);
  const [sending, setSending] = useState(false);
  const dealtAt = useRef(Date.now());
  const prevRef = useRef(g);

  // ---- react to server updates: sounds, ghost trick, deal overlay ----
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = g;
    if (prev === g) {
      // first mount
      dealtAt.current = Date.now();
      setFlipShow(true);
      sfx.deal();
      return;
    }
    if (g.round !== prev.round) {
      dealtAt.current = Date.now();
      setSelected(new Set());
      setGhost(null);
      setFlipShow(true);
      sfx.deal();
      return;
    }
    if (g.lastPlay && g.lastPlay !== prev.lastPlay && g.seq !== prev.seq) {
      const c = g.lastPlay.combo;
      sfx.play(c.cards.length);
      setGhost(g.lastPlay);
      setHintIdx(0);
    }
    if (g.passed.some((p, i) => p && !prev.passed[i])) sfx.pass();
    if (g.phase === 'roundOver' && prev.phase !== 'roundOver') {
      // the winning play also counts as the last play on the table
      setGhost(g.lastPlay);
      if (g.winner === me) sfx.win(); else sfx.lose();
    } else if (g.phase === 'playing' && g.turn === me && prev.turn !== me) sfx.turn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g.seq]);

  useEffect(() => {
    if (!flipShow) return;
    const t = setTimeout(() => setFlipShow(false), 2000 * Math.max(k, 0.5));
    return () => clearTimeout(t);
  }, [flipShow, k]);

  // keep selection in sync with the hand
  const hand = useMemo(() => {
    const h = g.yourHand.slice();
    if (sortMode === 'suit') h.sort((a, b) => suitOf(a) - suitOf(b) || rankOf(a) - rankOf(b));
    else h.sort((a, b) => a - b);
    return h;
  }, [g.yourHand, sortMode]);

  useEffect(() => {
    setSelected((s) => {
      const inHand = new Set(g.yourHand);
      const next = new Set([...s].filter((c) => inHand.has(c)));
      return next.size === s.size ? s : next;
    });
  }, [g.yourHand]);

  const prevCombo = g.lastPlay?.combo ?? null;
  const myTurn = g.phase === 'playing' && g.turn === me;
  const selCombo = selected.size ? identify([...selected]) : null;
  const selOk = !!selCombo && canBeat(selCombo, prevCombo);

  const doPlay = async () => {
    if (!myTurn || sending) return;
    if (!selCombo) { sfx.error(); return toast(selected.size ? '这不是合法的牌型' : '先选牌'); }
    if (!selOk) { sfx.error(); return toast(prevCombo && prevCombo.type !== selCombo.type && !isBomb(selCombo.type) ? `这一轮要出${COMBO_NAMES[prevCombo.type]}` : '压不过'); }
    setSending(true);
    const r = await api.play(selCombo.cards);
    setSending(false);
    if (!r.ok) { sfx.error(); toast(r.error); } else setSelected(new Set());
  };

  const doPass = async () => {
    if (!myTurn || !g.lastPlay || sending) return;
    setSending(true);
    const r = await api.pass();
    setSending(false);
    if (!r.ok) toast(r.error);
    setSelected(new Set());
  };

  const doHint = () => {
    const opts = playableCombos(g.yourHand, prevCombo);
    if (!opts.length) { sfx.error(); return toast('没有能压过的牌'); }
    const pick = opts[hintIdx % opts.length];
    setHintIdx((i) => i + 1);
    setSelected(new Set(pick.cards));
    sfx.select();
  };

  // ---- keyboard shortcuts on desktop ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key === 'Enter') doPlay();
      else if (e.key === 'p' || e.key === 'P') doPass();
      else if (e.key === 'h' || e.key === 'H') doHint();
      else if (e.key === 'Escape') setSelected(new Set());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const shown = g.lastPlay ?? ghost;
  const turnName = room.players[g.turn]?.name;
  const opponents = room.players.filter((p) => p.seat !== me);
  const meP = room.players[me];

  return (
    <LayoutGroup>
      <div className={`table n${n}`}>
        {/* ---------- top bar ---------- */}
        <header className="topbar">
          <div className="hud panel">
            <span className="hud-round">第 <b className="num">{g.round}</b> 局</span>
            <span className="hud-score">
              积分 <b className="num gold-text">{meP?.score ?? 0}</b>
            </span>
          </div>
          <div className="topbar-right">
            <span className="chip num">{room.code}</span>
            <button className="icon-btn" onClick={() => setMenu((m) => !m)} aria-label="设置" aria-expanded={menu}>⚙︎</button>
          </div>
          <AnimatePresence>
            {menu && <SettingsMenu speed={speed} onClose={() => setMenu(false)} />}
          </AnimatePresence>
        </header>

        {/* ---------- arena ---------- */}
        <section className="arena">
          {opponents.map((p) => (
            <Seat key={p.id} p={p} pos={posOf(p.seat, me, n)} active={g.phase === 'playing' && g.turn === p.seat} passed={g.passed[p.seat]} sp={sp} />
          ))}

          <div className="trick">
            <AnimatePresence mode="popLayout">
              {shown && (
                <TrickCards
                  key={`${g.round}-${shown.seat}-${shown.combo.cards.join('.')}`}
                  play={shown}
                  dim={!g.lastPlay && g.phase === 'playing'}
                  fromMe={shown.seat === me}
                  pos={posOf(shown.seat, me, n)}
                  round={g.round}
                  who={room.players[shown.seat]?.name}
                  sp={sp}
                />
              )}
            </AnimatePresence>
            {!shown && !flipShow && g.phase === 'playing' && (
              <div className="trick-empty">{myTurn ? '你先出，出什么都行' : `${turnName} 先出`}</div>
            )}
            <AnimatePresence>
              {flipShow && g.flipped !== null && <FlipReveal card={g.flipped} to={room.players[g.flippedTo ?? 0]?.name} sp={sp} />}
            </AnimatePresence>
          </div>

          <div className="event" aria-live="polite">{g.lastEvent}</div>
        </section>

        {/* ---------- my controls ---------- */}
        <section className={`me-bar ${myTurn ? 'my-turn' : ''}`}>
          <div className="me-info">
            <span className={`turn-dot ${myTurn ? 'on' : ''}`} />
            <span className="me-name">{meP?.name}</span>
            {g.passed[me] && <span className="pass-tag">不要</span>}
            <span className="me-status">
              {g.phase !== 'playing'
                ? ''
                : myTurn
                  ? selCombo
                    ? `${COMBO_NAMES[selCombo.type]}${selOk ? '' : ' · 压不过'}`
                    : g.lastPlay ? `要压 ${COMBO_NAMES[g.lastPlay.combo.type]}` : '轮到你出牌'
                  : `等 ${turnName} 出牌`}
            </span>
          </div>
          <div className="actions">
            <button className="btn small ghost" onClick={() => setSortMode((m) => (m === 'rank' ? 'suit' : 'rank'))}>
              {sortMode === 'rank' ? '按花色' : '按大小'}
            </button>
            <button className="btn" disabled={!myTurn || !g.lastPlay || sending} onClick={doPass}>不要</button>
            <button className="btn" disabled={!myTurn} onClick={doHint}>提示</button>
            <button className={`btn gold ${selOk && myTurn ? 'ready' : ''}`} disabled={!myTurn || !selected.size || sending} onClick={doPlay}>
              出牌
            </button>
          </div>
        </section>

        <Hand cards={hand} selected={selected} setSelected={setSelected} round={g.round} sp={sp} k={k} dealtAt={dealtAt.current} active={myTurn} />

        <AnimatePresence>
          {g.phase === 'roundOver' && <RoundOver room={room} sp={sp} speed={speed} />}
        </AnimatePresence>
      </div>
    </LayoutGroup>
  );
}

// ---------------------------------------------------------------------------

function Seat({ p, pos, active, passed, sp }: { p: PlayerView; pos: Pos; active: boolean; passed: boolean; sp: Springs }) {
  const backs = Math.min(p.cardCount, 6);
  const warn = p.cardCount > 0 && p.cardCount <= 3;
  return (
    <div className={`seat seat-${pos} ${active ? 'active' : ''}`}>
      <div className="seat-backs" aria-hidden>
        {Array.from({ length: backs }, (_, i) => (
          <motion.div key={i} className="mini-back" style={{ zIndex: i }} animate={{ x: i * 7, rotate: (i - backs / 2) * 4 }} transition={sp.card}>
            <CardBack />
          </motion.div>
        ))}
      </div>
      <div className="seat-info panel">
        <div className={`avatar ${active ? 'ring' : ''}`}>{p.name.slice(0, 1)}</div>
        <div className="seat-text">
          <div className="seat-name">
            {p.name}
            {!p.connected && <em className="off">离线</em>}
          </div>
          <div className="seat-meta">
            <span className={`count num ${warn ? 'warn' : ''}`}>{p.cardCount}</span> 张
            <span className="seat-score num">{p.score > 0 ? `+${p.score}` : p.score}</span>
          </div>
        </div>
      </div>
      <AnimatePresence>
        {passed && (
          <motion.div className="bubble" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }} transition={sp.land}>
            不要
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function TrickCards({
  play, dim, fromMe, pos, round, who, sp,
}: {
  play: { seat: number; combo: Combo };
  dim: boolean; fromMe: boolean; pos: Pos; round: number; who?: string; sp: Springs;
}) {
  const o = originOf(pos);
  const cards = play.combo.cards;
  const bomb = isBomb(play.combo.type);
  return (
    <motion.div
      className={`trick-cards ${dim ? 'dim' : ''} ${bomb ? 'bomb' : ''}`}
      exit={{ opacity: 0, scale: 0.85, y: 20, transition: { duration: 0.18 } }}
    >
      <div className="trick-row" style={{ ['--count' as string]: cards.length }}>
        {cards.map((c, i) =>
          fromMe ? (
            <motion.div key={c} layoutId={layoutKey(round, c)} className="trick-card" style={{ zIndex: i }} transition={sp.land}>
              <CardFace id={c} />
            </motion.div>
          ) : (
            <motion.div
              key={c}
              className="trick-card"
              style={{ zIndex: i }}
              initial={{ x: o.x, y: o.y, rotate: (i - 2) * 12, rotateY: 90, scale: 0.6 }}
              animate={{ x: 0, y: 0, rotate: 0, rotateY: 0, scale: 1 }}
              transition={{ ...sp.land, delay: sp.land.duration === 0 ? 0 : i * 0.04 }}
            >
              <CardFace id={c} />
            </motion.div>
          ),
        )}
      </div>
      <div className="trick-label">
        {who} · {COMBO_NAMES[play.combo.type]}
        {bomb && ' 💣'}
      </div>
    </motion.div>
  );
}

function FlipReveal({ card, to, sp }: { card: CardId; to?: string; sp: Springs }) {
  return (
    <motion.div className="flip-reveal" initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6, y: 60 }} transition={sp.card}>
      <div className="flip-3d">
        <motion.div className="flip-inner" initial={{ rotateY: 180 }} animate={{ rotateY: 0 }} transition={{ ...sp.card, delay: sp.card.duration === 0 ? 0 : 0.35 }}>
          <div className="flip-face front"><CardFace id={card} /></div>
          <div className="flip-face backside"><CardBack /></div>
        </motion.div>
      </div>
      <div className="flip-text">翻牌 {cardLabel(card)} → {to}</div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------

function Hand({
  cards, selected, setSelected, round, sp, k, dealtAt, active,
}: {
  cards: CardId[]; selected: Set<CardId>; setSelected: (s: Set<CardId>) => void;
  round: number; sp: Springs; k: number; dealtAt: number; active: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 360, h: 640 });
  const drag = useRef<{ mode: boolean; touched: Set<CardId> } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: window.innerHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ---- geometry: one fanned row, or two rows on narrow screens ----
  const n = cards.length;
  const { w, h } = box;
  const cw = Math.max(50, Math.min(112, w / 6, h * 0.16));
  const ch = cw * 1.447;
  let rows: CardId[][] = [cards];
  const pad = Math.max(12, cw * 0.18); // room for the tilted outer cards
  const usable = w - pad * 2;
  const fit = (count: number) => (count > 1 ? Math.min(cw * 0.6, (usable - cw) / (count - 1)) : 0);
  if (n > 1 && fit(n) < cw * 0.38) rows = [cards.slice(0, Math.ceil(n / 2)), cards.slice(Math.ceil(n / 2))];
  const rowGap = ch * 0.5;

  const layout = new Map<CardId, { x: number; y: number; r: number; z: number; i: number }>();
  let order = 0;
  rows.forEach((row, ri) => {
    const step = fit(row.length);
    const span = cw + step * (row.length - 1);
    const x0 = pad + (usable - span) / 2;
    const mid = (row.length - 1) / 2 || 1;
    row.forEach((c, i) => {
      const t = (i - mid) / mid; // -1..1
      const arc = rows.length === 1 ? t * t * cw * 0.16 : 0;
      const rot = rows.length === 1 ? t * Math.min(8, row.length * 0.6) : 0;
      layout.set(c, { x: x0 + i * step, y: 26 + ri * rowGap + arc, r: rot, z: ri * 100 + i, i: order++ });
    });
  });
  // tall enough for the lowest (arced + rotated) card
  let height = ch + 30;
  for (const L of layout.values()) {
    const tilt = Math.abs(Math.sin((L.r * Math.PI) / 180)) * cw * 0.5;
    height = Math.max(height, L.y + ch + tilt + 6);
  }

  const dealing = Date.now() - dealtAt < 1800 * Math.max(k, 0.01);

  // ---- tap / swipe to select ----
  const idAt = (x: number, y: number) => {
    const el = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest('[data-card]') as HTMLElement | null;
    return el ? Number(el.dataset.card) : null;
  };
  const apply = (id: CardId) => {
    const d = drag.current;
    if (!d || d.touched.has(id)) return;
    d.touched.add(id);
    const next = new Set(selected);
    if (d.mode) next.add(id); else next.delete(id);
    // mutate the closure copy so a fast swipe accumulates
    selected = next;
    setSelected(next);
    sfx.select();
  };

  return (
    <div
      ref={ref}
      className={`hand ${active ? 'active' : ''}`}
      style={{ height, ['--cw' as string]: `${cw}px` }}
      onPointerDown={(e) => {
        const id = idAt(e.clientX, e.clientY);
        if (id === null) return;
        drag.current = { mode: !selected.has(id), touched: new Set() };
        apply(id);
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        const id = idAt(e.clientX, e.clientY);
        if (id !== null) apply(id);
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
      onPointerLeave={() => (drag.current = null)}
    >
      {cards.map((c) => {
        const L = layout.get(c)!;
        const sel = selected.has(c);
        return (
          <motion.div
            key={layoutKey(round, c)}
            layoutId={layoutKey(round, c)}
            data-card={c}
            className={`hand-card ${sel ? 'sel' : ''}`}
            style={{ zIndex: L.z, width: cw }}
            tabIndex={0}
            role="checkbox"
            aria-checked={sel}
            aria-label={cardLabel(c)}
            onKeyDown={(e) => {
              if (e.key === ' ') {
                e.preventDefault();
                const next = new Set(selected);
                if (sel) next.delete(c); else next.add(c);
                setSelected(next);
              }
            }}
            initial={{ x: w / 2 - cw / 2, y: -h * 0.45, rotate: (Math.random() - 0.5) * 40, opacity: 0, scale: 0.7 }}
            animate={{ x: L.x, y: L.y - (sel ? 24 : 0), rotate: L.r, opacity: 1, scale: sel ? 1.06 : 1 }}
            whileHover={{ y: L.y - (sel ? 28 : 12), scale: sel ? 1.08 : 1.05 }}
            transition={{ ...sp.card, delay: dealing && sp.card.duration !== 0 ? L.i * 0.06 * k : 0 }}
          >
            <CardFace id={c} />
          </motion.div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------

function CountUp({ to, speed }: { to: number; speed: Speed }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current!;
    const fmt = (v: number) => (v > 0 ? `+${Math.round(v)}` : `${Math.round(v)}`);
    if (speed === 'off') { el.textContent = fmt(to); return; }
    let last = 0;
    const ctl = animate(0, to, {
      duration: Math.min(1.4, 0.3 + Math.abs(to) * 0.07) * (speed === 'fast' ? 0.5 : 1),
      ease: 'easeOut',
      onUpdate: (v) => {
        el.textContent = fmt(v);
        if (Math.round(v) !== last) { last = Math.round(v); sfx.tick(); }
      },
    });
    return () => ctl.stop();
  }, [to, speed]);
  return <span ref={ref} className="num">0</span>;
}

function RoundOver({ room, sp, speed }: { room: RoomView; sp: Springs; speed: Speed }) {
  const g = room.game!;
  const winner = room.players[g.winner!];
  const iWon = g.winner === g.yourSeat;
  const big = iWon && (g.lastDeltas?.[g.winner!] ?? 0) >= 10;
  return (
    <motion.div className="overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div
        className="result panel"
        initial={{ y: 40, scale: 0.92, opacity: 0 }}
        animate={{ y: 0, scale: 1, opacity: 1, x: big && speed !== 'off' ? [0, -3, 3, -2, 2, 0] : 0 }}
        transition={{ ...sp.card, delay: speed === 'off' ? 0 : 0.5 }}
      >
        <h2 className="result-title">{iWon ? '你赢了这局' : `${winner?.name} 先出完了`}</h2>
        <ul className="result-list">
          {room.players.map((p) => {
            const d = g.lastDeltas?.[p.seat] ?? 0;
            const left = g.revealedHands?.[p.seat] ?? [];
            return (
              <li key={p.id} className={p.seat === g.winner ? 'win' : ''}>
                <div className="r-head">
                  <span className="r-name">{p.name}{p.seat === g.yourSeat && '（你）'}</span>
                  <span className={`r-delta ${d > 0 ? 'pos' : d < 0 ? 'neg' : ''}`}><CountUp to={d} speed={speed} /></span>
                  <span className="r-total">总分 <b className="num">{p.score}</b></span>
                </div>
                {left.length > 0 && (
                  <div className="r-cards">
                    {left.map((c) => <CardFace key={c} id={c} className="tiny" />)}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <div className="result-actions">
          <button className="btn ghost" onClick={api.leave}>离开房间</button>
          <button className="btn gold big" onClick={api.next}>下一局</button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function SettingsMenu({ speed, onClose }: { speed: Speed; onClose: () => void }) {
  const { sound } = useSettings();
  return (
    <motion.div className="menu panel" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
      <div className="menu-row">
        <span>动画</span>
        <div className="seg small">
          {(['normal', 'fast', 'off'] as Speed[]).map((s) => (
            <button key={s} className={speed === s ? 'on' : ''} onClick={() => setSettings({ speed: s })}>
              {s === 'normal' ? '正常' : s === 'fast' ? '快速' : '关闭'}
            </button>
          ))}
        </div>
      </div>
      <div className="menu-row">
        <span>音效</span>
        <div className="seg small">
          <button className={sound ? 'on' : ''} onClick={() => { setSettings({ sound: true }); sfx.unlock(); }}>开</button>
          <button className={!sound ? 'on' : ''} onClick={() => setSettings({ sound: false })}>关</button>
        </div>
      </div>
      <p className="menu-keys">键盘：Enter 出牌 · P 不要 · H 提示 · Esc 取消选择</p>
      <div className="menu-row">
        <button className="btn small ghost" onClick={() => { if (confirm('离开后由机器人替你托管，确定吗？')) api.leave(); }}>离开房间</button>
        <button className="btn small" onClick={onClose}>关闭</button>
      </div>
    </motion.div>
  );
}
