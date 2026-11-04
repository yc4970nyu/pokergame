import { motion } from 'motion/react';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { RoomView } from '../../shared/src/protocol';
import type { RoundRecord } from '../../shared/src/game';
import { api } from './net';
import type { Springs } from './settings';

export interface PlayerStats {
  seat: number;
  name: string;
  you: boolean;
  score: number;
  wins: number;
  /** 牌权 */
  tricks: number;
  tricksAvg: number;
  tricksMin: number;
  tricksMax: number;
  /** 每局结束后的累计积分（第 0 项是 0） */
  series: number[];
  /** 输的那些局，平均手里剩几张 */
  avgLeft: number;
  lostRounds: number;
  /** 单局最大进账 / 最大赔付 */
  best: number;
  worst: number;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const one = (x: number) => (Math.round(x * 10) / 10).toFixed(1);

export function matchStats(room: RoomView, history: RoundRecord[]): PlayerStats[] {
  const g = room.game!;
  return room.players
    .map((p): PlayerStats => {
      const mine = history.map((r) => r.seats[p.seat]).filter(Boolean);
      const tricks = mine.map((x) => x.tricksWon);
      const lost = mine.filter((_, i) => history[i].winner !== p.seat);
      const amounts = mine.map((x) => x.amount);
      return {
        seat: p.seat,
        name: p.name,
        you: p.seat === g.yourSeat,
        score: p.score,
        wins: history.filter((r) => r.winner === p.seat).length,
        tricks: tricks.reduce((a, b) => a + b, 0),
        tricksAvg: avg(tricks),
        tricksMin: tricks.length ? Math.min(...tricks) : 0,
        tricksMax: tricks.length ? Math.max(...tricks) : 0,
        series: amounts.reduce((acc, a) => [...acc, acc[acc.length - 1] + a], [0]),
        avgLeft: avg(lost.map((x) => x.cardsLeft)),
        lostRounds: lost.length,
        best: amounts.length ? Math.max(...amounts) : 0,
        worst: amounts.length ? Math.min(...amounts) : 0,
      };
    })
    .sort((a, b) => b.score - a.score);
}

/** 二次确认，防误触 */
export function ConfirmEnd({ onYes, onNo, sp }: { onYes: () => void; onNo: () => void; sp: Springs }) {
  return (
    <motion.div className="overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} onClick={onNo}>
      <motion.div
        className="confirm panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        initial={{ y: 26, scale: 0.95, opacity: 0 }}
        animate={{ y: 0, scale: 1, opacity: 1 }}
        exit={{ y: 14, scale: 0.97, opacity: 0 }}
        transition={sp.card}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="confirm-title" className="confirm-title">确定要结束比赛吗？</h3>
        <p className="confirm-sub">结束后停在计分板，这一局不算分。</p>
        <div className="confirm-actions">
          <button className="btn ghost" onClick={onNo}>继续玩</button>
          <button className="btn gold" onClick={onYes}>看数据</button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/** 三位玩家的固定颜色，所有图表通用 */
const SEAT_COLORS = ['#5268C4', '#438579', '#A77B45', '#8A6A9E'];
const colorOf = (seat: number) => SEAT_COLORS[seat % SEAT_COLORS.length];
/** 每位玩家一个标记形状，颜色之外再辅助区分 */
const SHAPES = ['circle', 'square', 'diamond', 'triangle'] as const;
const shapeOf = (seat: number) => SHAPES[seat % SHAPES.length];
const signed = (x: number) => (x > 0 ? `+${x}` : x < 0 ? `−${Math.abs(x)}` : '0');
const ease = [0.22, 1, 0.36, 1] as const;

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setSize((s) => (s.w === el.clientWidth && s.h === el.clientHeight ? s : { w: el.clientWidth, h: el.clientHeight }));
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size.w, size.h] as const;
}

/** 比赛结束：数据总结（参考 Tremor Blocks 的卡片和图表样式） */
export function Scoreboard({ room, sp }: { room: RoomView; sp: Springs }) {
  const g = room.game!;
  const history = g.history ?? [];
  const rows = matchStats(room, history);
  const rounds = history.length;
  const bySeat = [...rows].sort((a, b) => a.seat - b.seat);

  const pages: { key: string; title: string; desc: string; cls: string; body: ReactNode }[] = [
    { key: 'result', title: '比赛结果', desc: `共 ${rounds} 局`, cls: 'c-result', body: <Result rows={rows} rounds={rounds} /> },
    { key: 'trend', title: '积分走势', desc: '每局结束后的累计积分', cls: 'c-trend', body: <Trend players={bySeat} rounds={rounds} /> },
    { key: 'wins', title: '胜场', desc: rounds > 1 ? '每一局由谁赢下' : '本场只打了一局', cls: 'c-small', body: <Wins players={bySeat} history={history} rounds={rounds} /> },
    { key: 'tricks', title: '牌权', desc: '其他人都不要、这一轮归你重新出（开局首攻不算）', cls: 'c-small', body: <Tricks players={bySeat} /> },
    { key: 'swing', title: '单局输赢', desc: '每人最好和最差的一局', cls: 'c-small', body: <Swing players={bySeat} /> },
    { key: 'left', title: '输的时候平均剩牌', desc: '剩得越少，输得越少', cls: 'c-small', body: <Left players={bySeat} /> },
  ];

  // 手机：左右滑动，一页一张卡
  const track = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  const onScroll = () => {
    const el = track.current;
    if (!el) return;
    const card = el.firstElementChild as HTMLElement | null;
    const step = card ? card.offsetWidth + parseFloat(getComputedStyle(el).columnGap || '0') : el.clientWidth;
    setPage(Math.round(el.scrollLeft / Math.max(1, step)));
  };
  const goTo = (i: number) => {
    const el = track.current;
    const card = el?.children[i] as HTMLElement | undefined;
    if (el && card) el.scrollTo({ left: card.offsetLeft - el.offsetLeft - parseFloat(getComputedStyle(el).paddingLeft), behavior: 'smooth' });
  };

  return (
    <motion.div className="overlay ms-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
      <motion.div
        className="ms"
        role="dialog"
        aria-label="比赛数据总结"
        initial={{ y: 24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={sp.card}
      >
        <header className="ms-head">
          <p className="ms-eyebrow">比赛总结</p>
          <h2 className="ms-title">比赛结束</h2>
          <p className="ms-sub">共 {rounds} 局 · {rows.length} 位玩家</p>
        </header>

        {rounds === 0 ? (
          <div className="ms-empty ms-card">这场还没打完一局，没有数据。</div>
        ) : (
          <>
            <div className="ms-grid" ref={track} onScroll={onScroll}>
              {pages.map((p, i) => (
                <motion.section
                  key={p.key}
                  className={`ms-card ${p.cls}`}
                  aria-label={p.title}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: 0.05 + i * 0.05, ease }}
                >
                  <header className="ms-card-head">
                    <h3>{p.title}</h3>
                    <p>{p.desc}</p>
                  </header>
                  <div className="ms-card-body">{p.body}</div>
                </motion.section>
              ))}
            </div>
            <nav className="ms-dots" aria-label="切换数据页">
              {pages.map((p, i) => (
                <button key={p.key} className={i === page ? 'on' : ''} onClick={() => goTo(i)} aria-label={p.title} aria-current={i === page}>
                  <span>{p.title}</span>
                </button>
              ))}
            </nav>
          </>
        )}

        <div className="ms-actions">
          <button className="ms-btn secondary" onClick={api.leave}>离开房间</button>
          <button className="ms-btn primary" onClick={api.newMatch}>再来一场</button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function Marker({ seat, size = 10 }: { seat: number; size?: number }) {
  const c = colorOf(seat);
  const sh = shapeOf(seat);
  return (
    <svg className="ms-marker" width={size} height={size} viewBox="0 0 10 10" aria-hidden>
      {sh === 'circle' && <circle cx="5" cy="5" r="4.5" fill={c} />}
      {sh === 'square' && <rect x="0.8" y="0.8" width="8.4" height="8.4" rx="1.6" fill={c} />}
      {sh === 'diamond' && <rect x="1.8" y="1.8" width="6.4" height="6.4" rx="1" fill={c} transform="rotate(45 5 5)" />}
      {sh === 'triangle' && <path d="M5 0.8 L9.4 9 L0.6 9 Z" fill={c} stroke={c} strokeWidth="0.8" strokeLinejoin="round" />}
    </svg>
  );
}

function Who({ p }: { p: PlayerStats }) {
  return (
    <span className="ms-who">
      <Marker seat={p.seat} />
      <span className="ms-who-name">{p.name}</span>
      {p.you && <span className="ms-badge">你</span>}
    </span>
  );
}

/** 比赛结果：冠军 + 排名表（整页最突出） */
function Result({ rows, rounds }: { rows: PlayerStats[]; rounds: number }) {
  const champ = rows[0];
  const tie = rows.length > 1 && rows[1].score === champ.score;
  return (
    <div className="ms-result">
      <div className="ms-champ">
        <span className="ms-label">{tie ? '并列第一' : '冠军'}</span>
        <div className="ms-champ-row">
          <span className="ms-champ-name"><Marker seat={champ.seat} size={14} />{champ.name}{champ.you && <span className="ms-badge">你</span>}</span>
          <span className="ms-kpi">{signed(champ.score)}</span>
        </div>
        <span className="ms-muted">赢下 {champ.wins} / {rounds} 局</span>
      </div>
      <table className="ms-table">
        <thead>
          <tr><th className="l">排名</th><th className="l">玩家</th><th>胜场</th><th>总积分</th></tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.seat} className={r.you ? 'me' : ''}>
              <td className="l num">{i + 1}</td>
              <td className="l"><Who p={r} /></td>
              <td className="num">{r.wins}</td>
              <td className="num strong">{signed(r.score)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 积分走势：折线图，点一下 / 悬停看每局的数值 */
function Trend({ players, rounds }: { players: PlayerStats[]; rounds: number }) {
  const [box, W, boxH] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const H = Math.max(140, Math.min(300, boxH || 220)), L = 40, R = 14, T = 12, B = 28;
  const all = players.flatMap((p) => p.series);
  let lo = Math.min(0, ...all), hi = Math.max(0, ...all);
  if (lo === hi) { lo -= 5; hi += 5; }
  const ticks = niceTicks(lo, hi);
  lo = Math.min(lo, ticks[0]); hi = Math.max(hi, ticks[ticks.length - 1]);
  const iw = Math.max(1, W - L - R);
  const x = (i: number) => L + (i / Math.max(1, rounds)) * iw;
  const y = (v: number) => T + ((hi - v) / (hi - lo)) * (H - T - B);
  const xStep = Math.max(1, Math.ceil(rounds / Math.max(2, Math.floor(iw / 44))));
  const xs = Array.from({ length: rounds + 1 }, (_, i) => i).filter((i) => i % xStep === 0 || i === rounds);
  const pick = (clientX: number, el: Element) => {
    const r = el.getBoundingClientRect();
    const i = Math.round(((clientX - r.left - L) / iw) * rounds);
    setHover(Math.max(0, Math.min(rounds, i)));
  };
  const hi_ = hover ?? rounds;
  const sorted = [...players].sort((a, b) => b.series[hi_] - a.series[hi_]);

  return (
    <div className="ms-trend">
      <ul className="ms-legend">
        {players.map((p) => <li key={p.seat}><Who p={p} /></li>)}
      </ul>
      <div className="ms-chart" ref={box}>
        {W > 0 && (
          <svg
            style={{ position: 'absolute', inset: 0 }}
            width={W} height={H} role="img" aria-label="累计积分折线图"
            onPointerMove={(e) => pick(e.clientX, e.currentTarget)}
            onPointerDown={(e) => pick(e.clientX, e.currentTarget)}
            onPointerLeave={(e) => { if (e.pointerType === 'mouse') setHover(null); }}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className={t === 0 ? 'zero' : 'grid'} />
                <text x={L - 8} y={y(t) + 4} textAnchor="end" className="tick">{signed(t)}</text>
              </g>
            ))}
            {xs.map((i) => (
              <text key={i} x={x(i)} y={H - 8} textAnchor="middle" className="tick">{i === 0 ? '开局' : `第${i}局`}</text>
            ))}
            {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} className="cursor" />}
            {players.map((p, pi) => {
              const d = p.series.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
              const at = hover ?? rounds;
              return (
                <g key={p.seat}>
                  <motion.path
                    d={d} fill="none" stroke={colorOf(p.seat)} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
                    initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
                    transition={{ duration: 0.8, delay: 0.2 + pi * 0.08, ease }}
                  />
                  <PointMark seat={p.seat} cx={x(at)} cy={y(p.series[at])} />
                </g>
              );
            })}
          </svg>
        )}
      </div>
      <div className="ms-readout" aria-live="polite">
        <span className="ms-label">{hover === null || hover === rounds ? '最终' : hover === 0 ? '开局' : `第 ${hover} 局后`}</span>
        <ul>
          {sorted.map((p) => (
            <li key={p.seat}><Who p={p} /><span className="num strong">{signed(p.series[hi_])}</span></li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function PointMark({ seat, cx, cy }: { seat: number; cx: number; cy: number }) {
  const c = colorOf(seat);
  const sh = shapeOf(seat);
  const common = { fill: '#fff', stroke: c, strokeWidth: 2 };
  if (sh === 'circle') return <circle cx={cx} cy={cy} r={4.5} {...common} />;
  if (sh === 'square') return <rect x={cx - 4.2} y={cy - 4.2} width={8.4} height={8.4} rx={1.5} {...common} />;
  if (sh === 'diamond') return <rect x={cx - 3.6} y={cy - 3.6} width={7.2} height={7.2} rx={1} transform={`rotate(45 ${cx} ${cy})`} {...common} />;
  return <path d={`M${cx} ${cy - 5} L${cx + 4.8} ${cy + 3.6} L${cx - 4.8} ${cy + 3.6} Z`} strokeLinejoin="round" {...common} />;
}

function niceTicks(lo: number, hi: number): number[] {
  const raw = (hi - lo) / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let t = Math.floor(lo / step) * step; t <= Math.ceil(hi / step) * step + 1e-9; t += step) out.push(Math.round(t));
  return out;
}

/** 胜场：多局用 Tracker（每格一局，颜色是赢家），一局只给数字 */
function Wins({ players, history, rounds }: { players: PlayerStats[]; history: RoundRecord[]; rounds: number }) {
  const bySeat = new Map(players.map((p) => [p.seat, p]));
  return (
    <div className="ms-wins">
      {rounds > 1 && (
        <div className="ms-tracker" role="img" aria-label="每局赢家">
          {history.map((r, i) => (
            <motion.span
              key={i}
              title={`第 ${i + 1} 局 · ${bySeat.get(r.winner)?.name ?? ''}`}
              style={{ background: colorOf(r.winner) }}
              initial={{ scaleY: 0.3, opacity: 0 }}
              animate={{ scaleY: 1, opacity: 1 }}
              transition={{ duration: 0.3, delay: 0.25 + i * 0.03, ease }}
            />
          ))}
        </div>
      )}
      {rounds > 1 && <div className="ms-axis"><span>第 1 局</span><span>第 {rounds} 局</span></div>}
      <ul className="ms-list">
        {[...players].sort((a, b) => b.wins - a.wins).map((p) => (
          <li key={p.seat}>
            <Who p={p} />
            <span className="ms-muted">{Math.round((p.wins / rounds) * 100)}%</span>
            <span className="num strong">{p.wins} 胜</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Tremor 风格的 BarList：浅色条 + 名字在条里 + 数值在右 */
function BarList({ items }: { items: { p: PlayerStats; value: number; label: string; sub?: string }[] }) {
  const max = Math.max(1e-9, ...items.map((x) => x.value));
  return (
    <ul className="ms-barlist">
      {items.map(({ p, value, label, sub }, i) => (
        <li key={p.seat}>
          <div className="ms-bar">
            <motion.i
              style={{ width: `${Math.max(value > 0 ? 4 : 0, (value / max) * 100)}%`, background: colorOf(p.seat) }}
              initial={{ scaleX: 0 }} animate={{ scaleX: 1 }}
              transition={{ duration: 0.6, delay: 0.25 + i * 0.06, ease }}
            />
            <span className="ms-bar-label"><Who p={p} /></span>
          </div>
          <span className="ms-bar-val">
            <span className="num strong">{label}</span>
            {sub && <span className="ms-muted">{sub}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Tricks({ players }: { players: PlayerStats[] }) {
  const items = [...players].sort((a, b) => b.tricks - a.tricks).map((p) => ({
    p,
    value: p.tricks,
    label: `${p.tricks} 次`,
    sub: `场均 ${one(p.tricksAvg)} · 单局 ${p.tricksMin === p.tricksMax ? p.tricksMin : `${p.tricksMin}–${p.tricksMax}`}`,
  }));
  return <BarList items={items} />;
}

/** 单局输赢：以 0 为中线，右边最好的一局（实色），左边最差的一局（浅色） */
function Swing({ players }: { players: PlayerStats[] }) {
  const m = Math.max(1, ...players.flatMap((p) => [Math.abs(p.best), Math.abs(p.worst)]));
  const seg = (v: number, seat: number, light: boolean, delay: number) => (
    <motion.i
      className={v >= 0 ? 'r' : 'l'}
      style={{ width: `${(Math.abs(v) / m) * 50}%`, background: colorOf(seat), opacity: light ? 0.35 : 1 }}
      initial={{ scaleX: 0 }} animate={{ scaleX: 1 }}
      transition={{ duration: 0.6, delay, ease }}
    />
  );
  return (
    <div className="ms-swing">
      <ul>
        {players.map((p, i) => (
          <li key={p.seat}>
            <div className="ms-swing-top">
              <Who p={p} />
              <span className="ms-swing-vals">
                <span><span className="ms-muted">最差</span> <span className="num">{signed(p.worst)}</span></span>
                <span><span className="ms-muted">最好</span> <span className="num strong">{signed(p.best)}</span></span>
              </span>
            </div>
            <div className="ms-swing-track">
              {seg(p.worst, p.seat, true, 0.25 + i * 0.06)}
              {p.best !== p.worst && seg(p.best, p.seat, false, 0.3 + i * 0.06)}
              <span className="ms-zero" />
            </div>
          </li>
        ))}
      </ul>
      <div className="ms-axis three"><span>{signed(-m)}</span><span>0</span><span>{signed(m)}</span></div>
    </div>
  );
}

function Left({ players }: { players: PlayerStats[] }) {
  const items = [...players].sort((a, b) => a.avgLeft - b.avgLeft).map((p) => ({
    p,
    value: p.lostRounds ? p.avgLeft : 0,
    label: p.lostRounds ? `${one(p.avgLeft)} 张` : '没输过',
    sub: p.lostRounds ? `输了 ${p.lostRounds} 局` : undefined,
  }));
  return <BarList items={items} />;
}

