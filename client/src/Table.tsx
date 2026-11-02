import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, animate } from 'motion/react';
import type { RoomView, PlayerView } from '../../shared/src/protocol';
import { CardId, cardLabel, rankOf, suitOf } from '../../shared/src/cards';
import { identify, canBeat, playableCombos, COMBO_NAMES, isBomb, Combo } from '../../shared/src/combos';
import { CardFace, CardBack } from './Card';
import { Hand } from './Hand';
import { TrickCards, DealLayer, ChipsLayer } from './Trick';
import { rememberHandRects } from './fly';
import { api, toast } from './net';
import { sfx } from './sound';
import { useSettings, setSettings, springs, speedFactor, Speed } from './settings';

type Pos = 'bottom' | 'left' | 'right' | 'top';
type Springs = ReturnType<typeof springs>;
type SortMode = 'rank' | 'suit';
/** how long the deal animation runs (17 cards × 60 ms + settle) */
const DEAL_S = 17 * 0.06 + 0.25;

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
  const [flipShow, setFlipShow] = useState(false);
  const [dealFx, setDealFx] = useState(0);
  const [menu, setMenu] = useState(false);
  const [sending, setSending] = useState(false);
  const dealtAt = useRef(Date.now());
  const prevRef = useRef<typeof g | null>(null);

  // ---- react to server updates ----
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = g;
    if (!prev && (g.phase !== 'playing' || g.lastPlay || g.yourHand.length < 17)) {
      // joined / reconnected mid-round: no deal animation
      dealtAt.current = 0;
      if (g.lastPlay) setGhost(g.lastPlay);
      return;
    }
    if (!prev || g.round !== prev.round) {
      dealtAt.current = Date.now();
      setSelected(new Set());
      setGhost(null);
      setOrder(sortBy(g.yourHand, 'rank'));
      setSortMode('rank');
      setFlipShow(true);
      setDealFx((x) => x + 1);
      sfx.deal();
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

  useEffect(() => {
    if (!flipShow) return;
    const t = setTimeout(() => setFlipShow(false), (2000 + DEAL_S * 1000) * Math.max(k, 0.5));
    return () => clearTimeout(t);
  }, [flipShow, k]);

  // keep my custom order when cards leave the hand
  useEffect(() => {
    setOrder((o) => {
      const inHand = new Set(g.yourHand);
      const kept = o.filter((c) => inHand.has(c));
      const missing = g.yourHand.filter((c) => !kept.includes(c));
      return missing.length || kept.length !== o.length ? [...kept, ...sortBy(missing, 'rank')] : o;
    });
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
  const myTurn = g.phase === 'playing' && g.turn === me;
  const selCombo = selected.size ? identify([...selected]) : null;
  const selOk = !!selCombo && canBeat(selCombo, prevCombo);

  const doPlay = async () => {
    if (!myTurn || sending) return;
    if (!selCombo) { sfx.error(); return toast(selected.size ? '这不是合法的牌型' : '先选牌'); }
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
    const opts = playableCombos(g.yourHand, prevCombo);
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
  const bigWin = over && (g.lastDeltas?.[g.winner!] ?? 0) >= 10;

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
        <AnimatePresence>{menu && <SettingsMenu speed={speed} onClose={() => setMenu(false)} />}</AnimatePresence>
      </header>

      {/* ---------- arena ---------- */}
      <section className="arena">
        <div className="oval" aria-hidden />
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
                win={over && shown.seat === g.winner}
                fromMe={shown.seat === me}
                who={room.players[shown.seat]?.name}
                speed={speed}
              />
            )}
          </AnimatePresence>
          {!shown && !flipShow && g.phase === 'playing' && (
            <div className="trick-empty">{myTurn ? '你先出，出什么都行' : `等 ${turnName} 先出`}</div>
          )}
          <AnimatePresence>
            {flipShow && !shown && g.flipped !== null && <FlipReveal card={g.flipped} to={room.players[g.flippedTo ?? 0]?.name} sp={sp} wait={DEAL_S * k} />}
          </AnimatePresence>
        </div>

        <div className="event" aria-live="polite">{g.lastEvent}</div>
      </section>

      {/* ---------- my bar ---------- */}
      <section className={`me-bar ${myTurn ? 'my-turn' : ''}`}>
        <div className="me-info" data-seat={me}>
          <span className={`turn-dot ${myTurn ? 'on' : ''}`} />
          <span className="me-name">{meP?.name}</span>
          {g.passed[me] && <span className="pass-tag">不要</span>}
          <span className="me-status">
            {g.phase !== 'playing'
              ? ''
              : myTurn
                ? selCombo
                  ? `${COMBO_NAMES[selCombo.type]}${selOk ? '' : ' · 压不过'}`
                  : g.lastPlay ? `要压${COMBO_NAMES[g.lastPlay.combo.type]}` : '轮到你出牌'
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
          order={order}
          setOrder={(o) => { setOrder(o); setSortMode('custom'); }}
          selected={selected}
          setSelected={setSelected}
          round={g.round}
          sp={sp}
          k={k}
          dealtAt={dealtAt.current}
          active={myTurn}
          idle={!sp.off}
        />
        <div className="actions">
          <button className="btn act" disabled={!myTurn || !g.lastPlay || sending} onClick={doPass}>不要</button>
          <button className="btn act" disabled={!myTurn} onClick={doHint}>提示</button>
          <button className={`btn gold act play ${selOk && myTurn ? 'ready' : ''}`} disabled={!myTurn || !selected.size || sending} onClick={doPlay}>
            出牌
          </button>
        </div>
      </div>

      {dealFx > 0 && (
        <DealLayer key={`deal-${g.round}-${dealFx}`} seats={opponents.map((p) => p.seat)} perSeat={17} speed={speed} />
      )}
      {over && g.winner !== null && g.lastDeltas && (
        <ChipsLayer
          key={`chips-${g.round}`}
          to={g.winner}
          from={room.players.filter((p) => p.seat !== g.winner).map((p) => ({ seat: p.seat, n: -(g.lastDeltas![p.seat]) || g.revealedHands?.[p.seat]?.length || 0 }))}
          speed={speed}
        />
      )}

      <AnimatePresence>{over && <RoundOver room={room} sp={sp} speed={speed} k={k} />}</AnimatePresence>
    </motion.div>
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
      <div className="seat-info panel" data-seat={p.seat}>
        <div className={`avatar ${active ? 'ring' : ''}`}>{p.name.slice(0, 1)}</div>
        <div className="seat-text">
          <div className="seat-name">
            {p.name}
            {!p.connected && <em className="off">离线</em>}
          </div>
          <div className="seat-meta">
            <span className={`count num ${warn ? 'warn' : ''}`}>{p.cardCount}</span>
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

function FlipReveal({ card, to, sp, wait }: { card: CardId; to?: string; sp: Springs; wait: number }) {
  useEffect(() => {
    if (sp.off) return;
    const t = setTimeout(() => sfx.flip(), (wait + 0.4) * 1000);
    return () => clearTimeout(t);
  }, [sp.off, wait]);
  return (
    <motion.div className="flip-reveal" initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6, y: 80 }} transition={{ ...sp.card, delay: wait }}>
      <div className="flip-3d">
        <motion.div className="flip-inner" initial={{ rotateY: 180 }} animate={{ rotateY: 0 }} transition={{ ...sp.flip, delay: sp.off ? 0 : wait + 0.4 }}>
          <div className="flip-face"><CardFace id={card} /></div>
          <div className="flip-face backside"><CardBack /></div>
        </motion.div>
      </div>
      <div className="flip-text">翻牌 {cardLabel(card)} → {to}</div>
    </motion.div>
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

function RoundOver({ room, sp, speed, k }: { room: RoomView; sp: Springs; speed: Speed; k: number }) {
  const g = room.game!;
  const winner = room.players[g.winner!];
  const iWon = g.winner === g.yourSeat;
  // let the winning play land and the chips fly before the sheet slides up
  const delay = 1.5 * k;
  return (
    <motion.div className="overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ delay, duration: 0.25 }}>
      <motion.div className="result panel" initial={{ y: 60, scale: 0.94, opacity: 0 }} animate={{ y: 0, scale: 1, opacity: 1 }} transition={{ ...sp.card, delay }}>
        <h2 className="result-title">{iWon ? '你赢了这局' : `${winner?.name} 先出完了`}</h2>
        <ul className="result-list">
          {room.players
            .slice()
            .sort((a, b) => (g.lastDeltas?.[b.seat] ?? 0) - (g.lastDeltas?.[a.seat] ?? 0))
            .map((p) => {
              const d = g.lastDeltas?.[p.seat] ?? 0;
              const left = g.revealedHands?.[p.seat] ?? [];
              return (
                <li key={p.id} className={p.seat === g.winner ? 'win' : ''}>
                  <div className="r-head">
                    <span className="r-name">{p.name}{p.seat === g.yourSeat && '（你）'}</span>
                    <span className={`r-delta ${d > 0 ? 'pos' : d < 0 ? 'neg' : ''}`}><CountUp to={d} speed={speed} delay={delay + 0.2} /></span>
                    <span className="r-total">总分 <b className="num">{p.score}</b></span>
                  </div>
                  {left.length > 0 && (
                    <div className="r-cards">{left.map((c) => <CardFace key={c} id={c} className="tiny" />)}</div>
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
      <p className="menu-keys">理牌：按住一张牌拖到想要的位置（电脑上直接拖）。键盘：Enter 出牌，P 不要，H 提示，Shift+←/→ 移动牌。</p>
      <div className="menu-row">
        <button className="btn small ghost" onClick={() => { if (confirm('离开后由机器人替你托管，确定吗？')) api.leave(); }}>离开房间</button>
        <button className="btn small" onClick={onClose}>关闭</button>
      </div>
    </motion.div>
  );
}
