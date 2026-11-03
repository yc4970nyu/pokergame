import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, animate } from 'motion/react';
import type { RoomView, PlayerView } from '../../shared/src/protocol';
import { CardId, rankOf, suitOf, cardLabel } from '../../shared/src/cards';
import { identify, canBeat, playableCombos, COMBO_NAMES, isBomb, Combo } from '../../shared/src/combos';
import type { Payment } from '../../shared/src/game';
import { CardFace, CardBack } from './Card';
import { ConfirmEnd, Scoreboard } from './Scoreboard';
import { Hand } from './Hand';
import { TrickCards, DealSequence, ChipsLayer } from './Trick';
import { DealPlan, makeDealPlan, countAt } from './deal';
import { rememberHandRects } from './fly';
import { api, toast } from './net';
import { sfx } from './sound';
import { useSettings, setSettings, springs, speedFactor, Speed, Springs } from './settings';

type Pos = 'bottom' | 'left' | 'right' | 'top';
type SortMode = 'rank' | 'suit';

const posOf = (seat: number, me: number, n: number): Pos => {
  const rel = (seat - me + n) % n;
  if (rel === 0) return 'bottom';
  if (n === 2) return 'top';
  return rel === 1 ? 'right' : 'left';
};

const sortBy = (cards: CardId[], mode: SortMode) =>
  cards.slice().sort(mode === 'suit' ? (a, b) => suitOf(a) - suitOf(b) || rankOf(a) - rankOf(b) : (a, b) => a - b);

export function Table({ room }: { room: RoomView }) {
  const g = room.game!;
  const me = g.yourSeat;
  const n = room.players.length;
  const { speed } = useSettings();
  const sp = springs(speed);
  const k = speedFactor(speed);

  const [selected, setSelected] = useState<Set<CardId>>(new Set());
  const [order, setOrder] = useState<CardId[]>(() => sortBy(g.yourHand, 'rank'));
  const [sortMode, setSortMode] = useState<SortMode | 'custom'>('rank');
  const [hintIdx, setHintIdx] = useState(0);
  const [ghost, setGhost] = useState<{ seat: number; combo: Combo } | null>(null);
  const [menu, setMenu] = useState(false);
  const landscape = useLandscape();
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [sending, setSending] = useState(false);
  const [, setTick] = useState(0);
  const prevRef = useRef<typeof g | null>(null);

  // ---- the opening deal: decided synchronously on the first render of each round ----
  const planRef = useRef<DealPlan | null>(null);
  const seenRound = useRef<number | null>(null);
  if (seenRound.current !== g.dealNo) {
    const fresh = g.phase === 'playing' && !g.lastPlay && g.yourHand.length >= 17 && g.flipped !== null && g.flippedTo !== null;
    planRef.current = fresh && !sp.off ? makeDealPlan(g.dealNo, n, g.flipped!, g.flippedTo!, k) : null;
    seenRound.current = g.dealNo;
  }
  const plan = planRef.current;
  const elapsed = plan ? (performance.now() - plan.startedAt) / 1000 : Infinity;
  const dealing = !!plan && elapsed < plan.ready;

  // re-render ~10×/s during the deal so opponent counters tick up and input unlocks on time
  useEffect(() => {
    if (!plan) return;
    const id = window.setInterval(() => {
      setTick((t) => t + 1);
      if ((performance.now() - plan.startedAt) / 1000 > plan.ready + 0.1) clearInterval(id);
    }, 100);
    return () => clearInterval(id);
  }, [plan]);

  // hand order: on a new round start from rank order immediately (no flash of last round's cards)
  const orderRound = useRef(g.dealNo);
  const shownOrder = (() => {
    if (orderRound.current !== g.dealNo) return sortBy(g.yourHand, 'rank');
    const inHand = new Set(g.yourHand);
    const kept = order.filter((c) => inHand.has(c));
    const missing = g.yourHand.filter((c) => !kept.includes(c));
    return missing.length || kept.length !== order.length ? [...kept, ...sortBy(missing, 'rank')] : order;
  })();

  // ---- react to server updates ----
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = g;
    if (!prev && (g.phase !== 'playing' || g.lastPlay || g.yourHand.length < 17)) {
      // joined / reconnected mid-round: no deal animation
      if (g.lastPlay) setGhost(g.lastPlay);
      return;
    }
    if (!prev || g.dealNo !== prev.dealNo) {
      orderRound.current = g.dealNo;
      setSelected(new Set());
      setGhost(null);
      setOrder(sortBy(g.yourHand, 'rank'));
      setSortMode('rank');
      return;
    }
    if (g.lastPlay && g.lastPlay !== prev.lastPlay && g.seq !== prev.seq) {
      setGhost(g.lastPlay);
      setHintIdx(0);
    }
    if (g.passed.some((p, i) => p && !prev.passed[i])) sfx.pass();
    if (g.phase === 'roundOver' && prev.phase !== 'roundOver') {
      setGhost(g.lastPlay);
      if (g.winner === me) sfx.win(); else sfx.lose();
    } else if (g.phase === 'playing' && g.turn === me && prev.turn !== me) sfx.turn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g.seq]);

  // keep my custom order when cards leave the hand
  useEffect(() => {
    orderRound.current = g.dealNo;
    if (shownOrder !== order) setOrder(shownOrder);
    setSelected((s) => {
      const inHand = new Set(g.yourHand);
      const next = new Set([...s].filter((c) => inHand.has(c)));
      return next.size === s.size ? s : next;
    });
  }, [g.yourHand]);

  const applySort = (mode: SortMode) => {
    setOrder(sortBy(g.yourHand, mode));
    setSortMode(mode);
    sfx.pickup();
  };

  const prevCombo = g.lastPlay?.combo ?? null;
  const redealing = g.redealSeat !== null;
  const myTurn = !dealing && !redealing && g.phase === 'playing' && g.turn === me;
  const must = g.mustInclude;
  const selCombo = selected.size ? identify([...selected]) : null;
  const selHasMust = must === null || selected.has(must);
  const selOk = !!selCombo && canBeat(selCombo, prevCombo) && selHasMust;

  const doPlay = async () => {
    if (!myTurn || sending) return;
    if (!selCombo) { sfx.error(); return toast(selected.size ? '这不是合法的牌型' : '先选牌'); }
    if (!selHasMust) { sfx.error(); return toast(`第一手必须带上 ${cardLabel(must!)}`); }
    if (!selOk) {
      sfx.error();
      return toast(prevCombo && prevCombo.type !== selCombo.type && !isBomb(selCombo.type) ? `这一轮要出${COMBO_NAMES[prevCombo.type]}` : '压不过');
    }
    rememberHandRects(selCombo.cards);
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
    const opts = playableCombos(g.yourHand, prevCombo).filter((c) => must === null || c.cards.includes(must));
    if (!opts.length) { sfx.error(); return toast('没有能压过的牌'); }
    const pick = opts[hintIdx % opts.length];
    setHintIdx((i) => i + 1);
    setSelected(new Set(pick.cards));
    sfx.select();
  };

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
  const over = g.phase === 'roundOver';
  const matchOver = g.phase === 'matchOver';
  const bigWin = over && ((g.lastDeltas?.[g.winner!] ?? 0) >= 20 || !!g.settlement?.tailTwo);

  return (
    <motion.div
      className={`table n${n}`}
      animate={bigWin && !sp.off ? { x: [0, -3, 3, -2, 2, -1, 0], y: [0, 2, -2, 1, -1, 0, 0] } : { x: 0, y: 0 }}
      transition={{ duration: 0.45, delay: 0.9 * k }}
    >
      {/* ---------- top bar ---------- */}
      <header className="topbar">
        <div className="hud panel">
          <div className="hud-cell">
            <span className="hud-label">积分</span>
            <b className="num hud-big gold-text">{meP?.score ?? 0}</b>
          </div>
          <div className="hud-cell">
            <span className="hud-label">第</span>
            <b className="num">{g.round}</b>
            <span className="hud-label">局</span>
          </div>
        </div>
        <div className="topbar-right">
          <span className="chip num" title="房间号">{room.code}</span>
          <button className="icon-btn" onClick={() => setMenu((m) => !m)} aria-label="设置" aria-expanded={menu}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden><path fill="currentColor" d="M4 7h10.2a3 3 0 0 0 5.6 0H20V5h-.2a3 3 0 0 0-5.6 0H4v2Zm13-2a1 1 0 1 1 0 2 1 1 0 0 1 0-2ZM4 13h.2a3 3 0 0 0 5.6 0H20v-2H9.8a3 3 0 0 0-5.6 0H4v2Zm3-2a1 1 0 1 1 0 2 1 1 0 0 1 0-2Zm-3 8h10.2a3 3 0 0 0 5.6 0H20v-2h-.2a3 3 0 0 0-5.6 0H4v2Zm13-2a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z" /></svg>
          </button>
        </div>
        <AnimatePresence>{menu && <SettingsMenu speed={speed} onClose={() => setMenu(false)} onEnd={() => setConfirmEnd(true)} />}</AnimatePresence>
      </header>

      {/* ---------- arena ---------- */}
      <section className="arena">
        <GlassTable />
        {opponents.map((p) => (
          <Seat
            key={p.id}
            p={p}
            count={plan && dealing ? countAt(plan, p.seat, elapsed, p.cardCount) : p.cardCount}
            pos={posOf(p.seat, me, n)}
            active={!dealing && !redealing && g.phase === 'playing' && g.turn === p.seat}
            passed={g.passed[p.seat]}
            sp={sp}
          />
        ))}

        <div className="trick">
          <AnimatePresence mode="popLayout">
            {shown && (
              <TrickCards
                key={`${g.dealNo}-${shown.seat}-${shown.combo.cards.join('.')}`}
                play={shown}
                dim={!g.lastPlay && g.phase === 'playing'}
                win={over && shown.seat === g.winner}
                fromMe={shown.seat === me}
                who={room.players[shown.seat]?.name}
                speed={speed}
              />
            )}
          </AnimatePresence>
          {!shown && !dealing && !redealing && g.phase === 'playing' && (
            <div className="trick-empty">
              {must !== null
                ? myTurn ? `你先出，第一手要带上 ${cardLabel(must)}` : `等 ${turnName} 先出（要带 ${cardLabel(must)}）`
                : myTurn ? '你先出，出什么都行' : `等 ${turnName} 先出`}
            </div>
          )}

        </div>

        <div className="event" aria-live="polite">{g.lastEvent}</div>
      </section>

      {/* ---------- my bar ---------- */}
      <section className={`me-bar ${myTurn ? 'my-turn' : ''}`}>
        <div className="me-info" data-seat={me}>
          <AnimatePresence>{myTurn && g.phase === 'playing' && !dealing && <TurnMarker sp={sp} />}</AnimatePresence>
          <span className={`turn-dot ${myTurn ? 'on' : ''}`} />
          <span className="me-name">{meP?.name}</span>
          {g.passed[me] && <span className="pass-tag">不要</span>}
          <span className="me-status">
            {g.phase !== 'playing' || dealing || redealing
              ? ''
              : myTurn
                ? selCombo
                  ? `${COMBO_NAMES[selCombo.type]}${selOk ? '' : selHasMust ? ' · 压不过' : ` · 要带 ${cardLabel(must!)}`}`
                  : g.lastPlay ? `要压${COMBO_NAMES[g.lastPlay.combo.type]}` : must !== null ? `先出，要带 ${cardLabel(must)}` : '轮到你出牌'
                : `等 ${turnName}`}
          </span>
        </div>
        <div className="sorter seg small" role="group" aria-label="理牌">
          <button className={sortMode === 'rank' ? 'on' : ''} onClick={() => applySort('rank')}>按大小</button>
          <button className={sortMode === 'suit' ? 'on' : ''} onClick={() => applySort('suit')}>按花色</button>
        </div>
      </section>

      <div className="hand-wrap">
        <Hand
          order={shownOrder}
          setOrder={(o) => { setOrder(o); setSortMode('custom'); }}
          selected={selected}
          setSelected={setSelected}
          round={g.dealNo}
          sp={sp}
          deal={plan}
          me={me}
          locked={dealing}
          active={myTurn}
          idle={!sp.off}
          landscape={landscape}
        />
        <div className="actions">
          <button className="btn act" disabled={!myTurn || !g.lastPlay || sending} onClick={doPass}>不要</button>
          <button className="btn act" disabled={!myTurn} onClick={doHint}>提示</button>
          <button className={`btn gold act play ${selOk && myTurn ? 'ready' : ''}`} disabled={!myTurn || !selected.size || sending} onClick={doPlay}>
            出牌
          </button>
        </div>
      </div>

      {plan && dealing && (
        <DealSequence key={`deal-${plan.round}`} plan={plan} me={me} names={room.players.map((p) => p.name)} />
      )}
      {over && g.winner !== null && g.lastDeltas && (
        <ChipsLayer
          key={`chips-${g.round}`}
          to={g.winner}
          from={(g.settlement?.payments ?? []).map((p) => ({ seat: p.seat, n: p.amount }))}
          speed={speed}
        />
      )}

      <AnimatePresence>
        {redealing && !dealing && g.phase === 'playing' && (
          <FourTwos key={`ft-${g.dealNo}`} name={room.players[g.redealSeat!]?.name ?? '?'} isMe={g.redealSeat === me} sp={sp} />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {over && <RoundOver room={room} sp={sp} speed={speed} k={k} onEnd={() => setConfirmEnd(true)} />}
      </AnimatePresence>
      <AnimatePresence>
        {confirmEnd && (
          <ConfirmEnd
            sp={sp}
            onNo={() => setConfirmEnd(false)}
            onYes={() => { setConfirmEnd(false); api.end(); }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>{matchOver && <Scoreboard room={room} sp={sp} />}</AnimatePresence>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------

/** 有人拿到四张 2：公示一下，服务器几秒后重新洗牌发牌 */
function FourTwos({ name, isMe, sp }: { name: string; isMe: boolean; sp: Springs }) {
  return (
    <motion.div className="overlay soft" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
      <motion.div
        className="confirm panel four-twos"
        role="alertdialog"
        aria-live="assertive"
        initial={{ y: 26, scale: 0.95, opacity: 0 }}
        animate={{ y: 0, scale: 1, opacity: 1 }}
        exit={{ y: -14, scale: 0.97, opacity: 0 }}
        transition={sp.card}
      >
        <div className="ft-cards">
          {[48, 49, 50, 51].map((c, i) => (
            <motion.div key={c} initial={{ y: 18, opacity: 0, rotate: 0 }} animate={{ y: 0, opacity: 1, rotate: (i - 1.5) * 7 }} transition={{ ...sp.card, delay: 0.12 + i * 0.07 }}>
              <CardFace id={c} className="tiny" />
            </motion.div>
          ))}
        </div>
        <h3 className="confirm-title">{isMe ? '你' : name} 拿到了四张 2</h3>
        <p className="confirm-sub">这把不算，重新洗牌发牌…</p>
        <div className="ft-bar"><motion.i initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 3.2, ease: 'linear' }} /></div>
      </motion.div>
    </motion.div>
  );
}

const LANDSCAPE_Q = '(orientation: landscape) and (max-height: 540px)';

/** True while the phone is held sideways (and on any short, wide viewport). */
export function useLandscape() {
  const [on, setOn] = useState(() => typeof window !== 'undefined' && window.matchMedia(LANDSCAPE_Q).matches);
  useEffect(() => {
    const m = window.matchMedia(LANDSCAPE_Q);
    const sync = () => setOn(m.matches);
    sync();
    m.addEventListener('change', sync);
    return () => m.removeEventListener('change', sync);
  }, []);
  return on;
}

/**
 * The turn marker: one pane of lit glass that slides to whoever is on turn.
 * Rendered inside the active player's name panel; `layoutId` makes Motion
 * carry the same element across seats instead of fading one out and another in.
 */
function TurnMarker({ sp }: { sp: Springs }) {
  return (
    <motion.span
      layoutId="turn-marker"
      className="turn-marker"
      aria-hidden
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ ...sp.push, opacity: { duration: 0.18 } }}
    />
  );
}

/** A clear glass coffee table seen from slightly above: floor shadow and brass legs under a frosted top with a green slab edge and glare. */
function GlassTable() {
  return (
    <div className="glass-table" aria-hidden>
      <div className="gt-shadow" />
      <div className="gt-legs"><i /><i /><i /><i /></div>
      <div className="gt-top">
        <div className="gt-glare" />
      </div>
    </div>
  );
}

function Seat({ p, count, pos, active, passed, sp }: { p: PlayerView; count: number; pos: Pos; active: boolean; passed: boolean; sp: Springs }) {
  const backs = Math.min(count, 6);
  const warn = count > 0 && count <= 3;
  return (
    <div className={`seat seat-${pos} ${active ? 'active' : ''}`}>
      <div className="seat-backs" aria-hidden>
        {Array.from({ length: backs }, (_, i) => (
          <motion.div key={i} className="mini-back" style={{ zIndex: i }} animate={{ x: i * 7, rotate: (i - backs / 2) * 4 }} transition={sp.card}>
            <CardBack />
          </motion.div>
        ))}
      </div>
      <div className="seat-info panel" data-seat={p.seat}>
        <AnimatePresence>{active && <TurnMarker sp={sp} />}</AnimatePresence>
        <div className={`avatar ${active ? 'ring' : ''}`}>{p.name.slice(0, 1)}</div>
        <div className="seat-text">
          <div className="seat-name">
            {p.name}
            {!p.connected && <em className="off">离线</em>}
          </div>
          <div className="seat-meta">
            <span className={`count num ${warn ? 'warn' : ''}`}>{count}</span>
            <span className="unit">张</span>
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

// ---------------------------------------------------------------------------

function CountUp({ to, speed, delay }: { to: number; speed: Speed; delay: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current!;
    const fmt = (v: number) => (v > 0 ? `+${Math.round(v)}` : `${Math.round(v)}`);
    if (speed === 'off') { el.textContent = fmt(to); return; }
    let last = 0;
    const ctl = animate(0, to, {
      delay,
      duration: Math.min(1.4, 0.3 + Math.abs(to) * 0.07) * (speed === 'fast' ? 0.5 : 1),
      ease: 'easeOut',
      onUpdate: (v) => {
        el.textContent = fmt(v);
        if (Math.round(v) !== last) { last = Math.round(v); sfx.tick(); }
      },
    });
    return () => ctl.stop();
  }, [to, speed, delay]);
  return <span ref={ref} className="num">0</span>;
}

/** "11 张 ×2 满10张 ×2 剩一张2 ×2 尾二" */
function Formula({ p }: { p: Payment }) {
  const parts: string[] = [];
  if (p.over10) parts.push('满10张 ×2');
  if (p.twos) parts.push(`剩${p.twos}张2 ×${2 ** p.twos}`);
  if (p.tailTwo) parts.push('尾二 ×2');
  return (
    <div className="r-formula">
      <span className="num">{p.cards}</span> 张
      {parts.map((t) => <em key={t}>{t}</em>)}
      {p.multiplier > 1 && <> = <b className="num">{p.amount}</b></>}
    </div>
  );
}

function RoundOver({ room, sp, speed, k, onEnd }: { room: RoomView; sp: Springs; speed: Speed; k: number; onEnd: () => void }) {
  const g = room.game!;
  const winner = room.players[g.winner!];
  const iWon = g.winner === g.yourSeat;
  const st = g.settlement;
  // let the winning play land and the chips fly before the sheet slides up
  const delay = 1.5 * k;
  return (
    <motion.div className="overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ delay, duration: 0.25 }}>
      <motion.div className="result panel" initial={{ y: 60, scale: 0.94, opacity: 0 }} animate={{ y: 0, scale: 1, opacity: 1 }} transition={{ ...sp.card, delay }}>
        <h2 className="result-title">{iWon ? '你赢了这局' : `${winner?.name} 先出完了`}</h2>
        {st?.tailTwo && <div className="tail-two">尾二！全场翻倍</div>}
        <ul className="result-list">
          {room.players
            .slice()
            .sort((a, b) => (g.lastDeltas?.[b.seat] ?? 0) - (g.lastDeltas?.[a.seat] ?? 0))
            .map((p) => {
              const d = g.lastDeltas?.[p.seat] ?? 0;
              const left = g.revealedHands?.[p.seat] ?? [];
              const pay = st?.payments.find((x) => x.seat === p.seat);
              return (
                <li key={p.id} className={p.seat === g.winner ? 'win' : ''}>
                  <div className="r-head">
                    <span className="r-name">{p.name}{p.seat === g.yourSeat && '（你）'}</span>
                    <span className={`r-delta ${d > 0 ? 'pos' : d < 0 ? 'neg' : ''}`}><CountUp to={d} speed={speed} delay={delay + 0.2} /></span>
                    <span className="r-total">总分 <b className="num">{p.score}</b></span>
                  </div>
                  {pay && <Formula p={pay} />}
                  {left.length > 0 && (
                    <div className="r-cards">{left.map((c) => <CardFace key={c} id={c} className="tiny" />)}</div>
                  )}
                </li>
              );
            })}
        </ul>
        <div className="result-actions">
          <button className="btn ghost" onClick={onEnd}>结束比赛</button>
          <button className="btn gold big" onClick={api.next}>下一局</button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function SettingsMenu({ speed, onClose, onEnd }: { speed: Speed; onClose: () => void; onEnd: () => void }) {
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
      <p className="menu-keys">理牌：按住一张牌拖到想要的位置（电脑上直接拖）。键盘：Enter 出牌，P 不要，H 提示，Shift+←/→ 移动牌。</p>
      <div className="menu-row">
        <button className="btn small ghost" onClick={() => { onClose(); onEnd(); }}>结束比赛</button>
        <button className="btn small ghost" onClick={() => { if (confirm('离开后由机器人替你托管，确定吗？')) api.leave(); }}>离开房间</button>
      </div>
      <div className="menu-row">
        <button className="btn small" onClick={onClose}>关闭</button>
      </div>
    </motion.div>
  );
}
