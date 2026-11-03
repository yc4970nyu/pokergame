import { motion } from 'motion/react';
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
  /** 失误 */
  misses: number;
  missesAvg: number;
  /** 输的那些局，平均手里剩几张 */
  avgLeft: number;
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
        misses: mine.reduce((a, x) => a + x.misses, 0),
        missesAvg: avg(mine.map((x) => x.misses)),
        avgLeft: avg(lost.map((x) => x.cardsLeft)),
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

/** 比赛结束：积分榜 + 这场的数据 */
export function Scoreboard({ room, sp }: { room: RoomView; sp: Springs }) {
  const g = room.game!;
  const history = g.history ?? [];
  const rows = matchStats(room, history);
  const rounds = history.length;
  const top = Math.max(1, ...rows.map((r) => Math.abs(r.score)));

  return (
    <motion.div className="overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }}>
      <motion.div
        className="board panel"
        initial={{ y: 40, scale: 0.96, opacity: 0 }}
        animate={{ y: 0, scale: 1, opacity: 1 }}
        transition={sp.card}
      >
        <header className="board-head">
          <h2 className="board-title">比赛结束</h2>
          <span className="board-sub">共 <b className="num">{rounds}</b> 局</span>
        </header>

        {rounds === 0 ? (
          <p className="board-empty">这场还没打完一局，没有数据。</p>
        ) : (
          <div className="board-body">
            <ol className="board-rank">
              {rows.map((r, i) => (
                <motion.li
                  key={r.seat}
                  className={`br ${i === 0 ? 'first' : ''} ${r.you ? 'me' : ''}`}
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ ...sp.push, delay: 0.08 + i * 0.07 }}
                >
                  <span className="br-pos num">{i + 1}</span>
                  <span className="br-name">{r.name}{r.you && <em>你</em>}</span>
                  <span className="br-wins">赢 <b className="num">{r.wins}</b> 局</span>
                  <span className={`br-score num ${r.score > 0 ? 'pos' : r.score < 0 ? 'neg' : ''}`}>
                    {r.score > 0 ? `+${r.score}` : r.score}
                  </span>
                  <i className="br-bar" style={{ width: `${(Math.abs(r.score) / top) * 100}%` }} data-sign={r.score >= 0 ? 'pos' : 'neg'} />
                </motion.li>
              ))}
            </ol>

            <div className="board-col">
            <h3 className="board-h3">这场的数据</h3>
            <div className="board-stats">
              {rows.map((r) => (
                <div className="bs" key={r.seat}>
                  <div className="bs-name">{r.name}{r.you && <em>你</em>}</div>
                  <div className="bs-grid">
                    <Stat big={r.tricks} label="牌权" note={`场均 ${one(r.tricksAvg)} · ${r.tricksMin === r.tricksMax ? r.tricksMin : `${r.tricksMin}–${r.tricksMax}`}`} />
                    <Stat big={r.misses} label="失误" note={`场均 ${one(r.missesAvg)}`} />
                    <Stat big={one(r.avgLeft)} label="输时剩牌" note="平均张数" />
                    <Stat big={r.best > 0 ? `+${r.best}` : r.best} label="单局最高" note={`最低 ${r.worst}`} />
                  </div>
                </div>
              ))}
            </div>
            <p className="board-note">
              牌权＝其他人全不要、这一轮归你重开（不含开局首攻）。失误＝手里有非炸弹的牌压得过却说了不要；只剩炸弹能压不算。
            </p>
            </div>
          </div>
        )}

        <div className="board-actions">
          <button className="btn ghost" onClick={api.leave}>离开房间</button>
          <button className="btn gold big" onClick={api.newMatch}>再来一场</button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function Stat({ big, label, note }: { big: number | string; label: string; note: string }) {
  return (
    <div className="st">
      <b className="st-big num">{big}</b>
      <span className="st-label">{label}</span>
      <em className="st-note">{note}</em>
    </div>
  );
}
