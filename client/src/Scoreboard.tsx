import { motion } from 'motion/react';
import type { ReactNode } from 'react';
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

/** 每个座位一个颜色，所有图表通用（Apple 系统色） */
const SEAT_COLORS = ['#007AFF', '#FF9500', '#AF52DE'];
const colorOf = (seat: number) => SEAT_COLORS[seat % SEAT_COLORS.length];
const signed = (x: number) => (x > 0 ? `+${x}` : x < 0 ? `−${Math.abs(x)}` : '0');

/** 比赛结束：Apple 风格的数据总结 */
export function Scoreboard({ room, sp }: { room: RoomView; sp: Springs }) {
  const g = room.game!;
  const history = g.history ?? [];
  const rows = matchStats(room, history);
  const rounds = history.length;
  const bySeat = [...rows].sort((a, b) => a.seat - b.seat);
  let k = 0;
  const card = (title: string, sub: string | null, children: ReactNode, wide = false) => (
    <motion.section
      className={`sb-card ${wide ? 'wide' : ''}`}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...sp.push, delay: 0.1 + k++ * 0.06 }}
    >
      <header className="sb-card-head">
        <h3>{title}</h3>
        {sub && <span>{sub}</span>}
      </header>
      {children}
    </motion.section>
  );

  return (
    <motion.div className="overlay sb-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }}>
      <motion.div
        className="sb"
        role="dialog"
        aria-label="比赛数据"
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={sp.card}
      >
        <header className="sb-head">
          <span className="sb-eyebrow">比赛总结</span>
          <h2 className="sb-title">比赛结束</h2>
          <span className="sb-sub">共 {rounds} 局 · {rows.length} 位玩家</span>
        </header>

        {rounds === 0 ? (
          <p className="sb-empty">这场还没打完一局，没有数据。</p>
        ) : (
          <div className="sb-grid">
            {card('排名', '总积分 · 胜场', <Ranking rows={rows} rounds={rounds} />)}
            {card('积分走势', '每局结束后的累计积分', <TrendChart players={bySeat} rounds={rounds} />)}
            {card('胜场', `共 ${rounds} 局`, <WinRings players={bySeat} rounds={rounds} />)}
            {card('牌权', '总数 · 场均 · 单局范围', <TrickRanges players={bySeat} />)}
            {card('单局输赢', '最好的一局 · 最差的一局', <BestWorst players={bySeat} />)}
            {card('输的时候平均剩牌', '张数越少，输得越少', <LeftBars players={bySeat} />)}
            <p className="sb-note">牌权：其他人都不要，这一轮归你重新出（开局首攻不算）。</p>
          </div>
        )}

        <div className="sb-actions">
          <button className="sb-btn plain" onClick={api.leave}>离开房间</button>
          <button className="sb-btn fill" onClick={api.newMatch}>再来一场</button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function Name({ p }: { p: PlayerStats }) {
  return (
    <span className="sb-name">
      <i style={{ background: colorOf(p.seat) }} />
      <span className="sb-name-t">{p.name}</span>
      {p.you && <em>你</em>}
    </span>
  );
}

/** 排名：大号积分 + 胜场 */
function Ranking({ rows, rounds }: { rows: PlayerStats[]; rounds: number }) {
  return (
    <ol className="sb-rank">
      {rows.map((r, i) => (
        <li key={r.seat}>
          <span className="sb-pos">{i + 1}</span>
          <div className="sb-rank-mid">
            <Name p={r} />
            <span className="sb-dim">胜 {r.wins} 局 / {rounds}</span>
          </div>
          <b className={`sb-score ${r.score > 0 ? 'pos' : r.score < 0 ? 'neg' : ''}`}>{signed(r.score)}</b>
        </li>
      ))}
    </ol>
  );
}

/** 折线图：每局后的累计积分 */
function TrendChart({ players, rounds }: { players: PlayerStats[]; rounds: number }) {
  const W = 340, H = 170, L = 34, R = 12, T = 12, B = 24;
  const all = players.flatMap((p) => p.series);
  let lo = Math.min(0, ...all), hi = Math.max(0, ...all);
  if (lo === hi) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.08;
  lo -= pad; hi += pad;
  const x = (i: number) => L + (i / Math.max(1, rounds)) * (W - L - R);
  const y = (v: number) => T + ((hi - v) / (hi - lo)) * (H - T - B);
  const ticks = niceTicks(lo, hi);
  const xStep = Math.max(1, Math.ceil(rounds / 6));
  const xs = Array.from({ length: rounds + 1 }, (_, i) => i).filter((i) => i % xStep === 0 || i === rounds);
  return (
    <div className="sb-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="累计积分折线图">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className={t === 0 ? 'axis0' : 'grid'} />
            <text x={L - 6} y={y(t) + 3.5} textAnchor="end" className="tick">{t}</text>
          </g>
        ))}
        {xs.map((i) => (
          <text key={i} x={x(i)} y={H - 6} textAnchor="middle" className="tick">{i === 0 ? '开局' : i}</text>
        ))}
        {players.map((p, pi) => {
          const d = p.series.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
          const last = p.series[p.series.length - 1];
          return (
            <g key={p.seat}>
              <motion.path
                d={d}
                fill="none"
                stroke={colorOf(p.seat)}
                strokeWidth={2.6}
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.9, delay: 0.25 + pi * 0.12, ease: [0.22, 1, 0.36, 1] }}
              />
              {rounds <= 12 && p.series.slice(1, -1).map((v, i) => (
                <circle key={i} cx={x(i + 1)} cy={y(v)} r={2.2} fill={colorOf(p.seat)} opacity={0.55} />
              ))}
              <motion.circle
                cx={x(rounds)} cy={y(last)} r={4.5} fill="#fff" stroke={colorOf(p.seat)} strokeWidth={2.6}
                initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 1 + pi * 0.12 }}
              />
            </g>
          );
        })}
      </svg>
      <div className="sb-legend">
        {players.map((p) => (
          <span key={p.seat}><Name p={p} /><b className="sb-num">{signed(p.score)}</b></span>
        ))}
      </div>
    </div>
  );
}

function niceTicks(lo: number, hi: number): number[] {
  const span = hi - lo;
  const raw = span / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) out.push(Math.round(t));
  if (!out.includes(0)) out.push(0);
  return out;
}

/** 胜场：Apple Fitness 风格的同心圆环 */
function WinRings({ players, rounds }: { players: PlayerStats[]; rounds: number }) {
  const S = 150, SW = 15, GAP = 3;
  return (
    <div className="sb-rings">
      <svg viewBox={`0 0 ${S} ${S}`} role="img" aria-label="胜场圆环">
        {players.map((p, i) => {
          const r = S / 2 - SW / 2 - i * (SW + GAP);
          const c = 2 * Math.PI * r;
          const frac = rounds ? p.wins / rounds : 0;
          return (
            <g key={p.seat} transform={`rotate(-90 ${S / 2} ${S / 2})`}>
              <circle cx={S / 2} cy={S / 2} r={r} fill="none" stroke={colorOf(p.seat)} strokeOpacity={0.16} strokeWidth={SW} />
              {frac > 0 && (
                <motion.circle
                  cx={S / 2} cy={S / 2} r={r} fill="none" stroke={colorOf(p.seat)} strokeWidth={SW} strokeLinecap="round"
                  strokeDasharray={c}
                  initial={{ strokeDashoffset: c }}
                  animate={{ strokeDashoffset: c * (1 - frac) }}
                  transition={{ duration: 1.1, delay: 0.3 + i * 0.12, ease: [0.22, 1, 0.36, 1] }}
                />
              )}
            </g>
          );
        })}
      </svg>
      <ul className="sb-ring-legend">
        {players.map((p) => (
          <li key={p.seat}>
            <Name p={p} />
            <span className="sb-big" style={{ color: colorOf(p.seat) }}>
              {p.wins}<small>胜</small>
            </span>
            <span className="sb-dim">{rounds ? Math.round((p.wins / rounds) * 100) : 0}% · 输 {rounds - p.wins} 局</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 牌权：单局最少–最多的范围条 + 场均标记 + 总数 */
function TrickRanges({ players }: { players: PlayerStats[] }) {
  const max = Math.max(1, ...players.map((p) => p.tricksMax));
  const pct = (v: number) => `${(v / max) * 100}%`;
  return (
    <div className="sb-ranges">
      {players.map((p, i) => (
        <div className="sb-range-row" key={p.seat}>
          <div className="sb-range-top">
            <Name p={p} />
            <span className="sb-dim">场均 {one(p.tricksAvg)} · 单局 {p.tricksMin === p.tricksMax ? p.tricksMin : `${p.tricksMin}–${p.tricksMax}`}</span>
            <b className="sb-num" style={{ color: colorOf(p.seat) }}>{p.tricks}<small>次</small></b>
          </div>
          <div className="sb-track">
            <motion.i
              className="sb-span"
              style={{ left: pct(p.tricksMin), width: `max(10px, ${pct(p.tricksMax - p.tricksMin)})`, background: colorOf(p.seat) }}
              initial={{ scaleX: 0, opacity: 0 }}
              animate={{ scaleX: 1, opacity: 1 }}
              transition={{ duration: 0.6, delay: 0.3 + i * 0.1, ease: [0.22, 1, 0.36, 1] }}
            />
            <motion.i
              className="sb-avg"
              style={{ left: pct(p.tricksAvg), borderColor: colorOf(p.seat) }}
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ ...{ type: 'spring', stiffness: 500, damping: 26 }, delay: 0.7 + i * 0.1 }}
            />
          </div>
        </div>
      ))}
      <div className="sb-axis"><span>0</span><span>{max}</span></div>
    </div>
  );
}

/** 单局输赢：以 0 为中线，左边最差、右边最好 */
function BestWorst({ players }: { players: PlayerStats[] }) {
  const m = Math.max(1, ...players.flatMap((p) => [Math.abs(p.best), Math.abs(p.worst)]));
  const bar = (v: number, delay: number) => (
    <motion.i
      className={`sb-dv ${v >= 0 ? 'pos' : 'neg'}`}
      style={{ width: `${(Math.abs(v) / m) * 50}%`, [v >= 0 ? 'left' : 'right']: '50%' }}
      initial={{ scaleX: 0 }}
      animate={{ scaleX: 1 }}
      transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
    />
  );
  return (
    <div className="sb-div">
      {players.map((p, i) => (
        <div className="sb-div-row" key={p.seat}>
          <div className="sb-range-top">
            <Name p={p} />
            <span className="sb-pair">
              <b className="sb-num neg">{signed(p.worst)}</b>
              <b className="sb-num pos">{signed(p.best)}</b>
            </span>
          </div>
          <div className="sb-div-track">
            {bar(p.worst, 0.3 + i * 0.1)}
            {p.best !== p.worst && bar(p.best, 0.38 + i * 0.1)}
            <span className="sb-zero" />
          </div>
        </div>
      ))}
      <div className="sb-axis three"><span>最差</span><span>0</span><span>最好</span></div>
    </div>
  );
}

/** 输的时候平均剩几张 */
function LeftBars({ players }: { players: PlayerStats[] }) {
  const max = Math.max(1, ...players.map((p) => p.avgLeft));
  return (
    <div className="sb-bars">
      {players.map((p, i) => (
        <div className="sb-bar-row" key={p.seat}>
          <Name p={p} />
          <div className="sb-bar-track">
            {p.lostRounds > 0 && (
              <motion.i
                style={{ width: `${(p.avgLeft / max) * 100}%`, background: colorOf(p.seat) }}
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: 0.6, delay: 0.3 + i * 0.1, ease: [0.22, 1, 0.36, 1] }}
              />
            )}
          </div>
          <b className="sb-num">{p.lostRounds > 0 ? <>{one(p.avgLeft)}<small>张</small></> : <small>没输过</small>}</b>
        </div>
      ))}
    </div>
  );
}
