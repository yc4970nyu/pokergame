import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { ProfileStats } from '../../shared/src/ledger';
import { account, refreshAccount, useAccount } from './account';
import { toast } from './net';
import { navigate } from './router';
import { Avatar, BackButton, ConfirmButton, IconPicker, Modal, Money, timeAgo } from './ui';

const FACES = ['😎', '🤠', '🦊', '🐼', '🐯', '🐸', '🐵', '🦁', '🐻', '🐱', '🐶', '🐲', '🦄', '👻', '🤖', '🧙', '🥷', '👑', '🍀', '🔥'];

export function Profile() {
  const { user, groups, loaded } = useAccount();
  const [stats, setStats] = useState<ProfileStats | null>(null);
  const [edit, setEdit] = useState(false);

  useEffect(() => {
    if (!user) return;
    refreshAccount();
    account.stats().then(setStats).catch((e) => toast(e.message));
  }, [user?.id]);

  useEffect(() => { if (loaded && !user) navigate('/', true); }, [loaded, user]);
  if (!user) return <main className="page"><div className="page-loading">加载中…</div></main>;

  const winRate = stats && stats.rounds ? Math.round((stats.wins / stats.rounds) * 100) : 0;

  return (
    <main className="page">
      <div className="page-inner">
        <header className="page-head">
          <BackButton onClick={() => navigate('/')} />
          <button className="me-hero" onClick={() => setEdit(true)} aria-label="修改名字和头像">
            <Avatar name={user.name} avatar={user.avatar} picture={user.picture} size={56} />
            <span className="page-title">
              <h1>{user.name}</h1>
              <p>{user.hasGoogle ? user.email ?? 'Google 账号' : `用户名 ${user.username}`} · 点这里修改</p>
            </span>
          </button>
        </header>

        <div className="gp-grid">
          <div className="gp-col">
            <section className="pcard">
              <header className="pcard-head"><h2>我的战绩</h2><span className="pcard-sub">只算真人局</span></header>
              {!stats ? <p className="hint">加载中…</p> : stats.rounds === 0 ? (
                <p className="hint">还没打过。登录状态下打完的每一局都会记在这里。</p>
              ) : (
                <>
                  <div className="stat-hero">
                    <span className="stat-label">小组局总输赢</span>
                    <Money v={stats.net} className="stat-big" />
                    {stats.trend.length > 1 && <Spark values={stats.trend} />}
                  </div>
                  <div className="stat-grid">
                    <Stat label="局数" value={stats.rounds} sub={`${stats.matches} 场`} />
                    <Stat label="胜率" value={`${winRate}%`} sub={`赢 ${stats.wins} 局`} />
                    <Stat label="最好一局" value={<Money v={stats.best} />} />
                    <Stat label="最差一局" value={<Money v={stats.worst} />} />
                    <Stat label="输时平均剩牌" value={stats.avgLeftWhenLosing ?? '—'} sub="越少越好" />
                    <Stat label="每局牌权" value={stats.tricksPerRound} sub="抢到出牌权的次数" />
                  </div>
                </>
              )}
            </section>

            <section className="pcard">
              <header className="pcard-head"><h2>我的小组</h2></header>
              {groups.length === 0 ? <p className="hint">还没加入小组。</p> : (
                <ul className="group-list">
                  {groups.map((g) => (
                    <li key={g.id}>
                      <button className="group-row" onClick={() => navigate(`/g/${g.id}`)}>
                        <span className="g-icon">{g.icon}</span>
                        <span className="g-text"><b>{g.name}</b><small>{g.members} 人{g.role === 'admin' ? ' · 管理员' : ''}</small></span>
                        <Money v={g.balance} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <div className="gp-col">
            <section className="pcard">
              <header className="pcard-head"><h2>最近的比赛</h2></header>
              {!stats?.recent.length ? <p className="hint">还没有。</p> : (
                <ul className="recent">
                  {stats.recent.map((m) => (
                    <li key={m.id}>
                      <span className="g-icon small">{m.group?.icon ?? '🃏'}</span>
                      <span className="g-text">
                        <b>{m.group?.name ?? '临时牌桌'}</b>
                        <small>{timeAgo(m.at)} · {m.rounds} 局 · 和 {m.players.join('、') || '—'}</small>
                      </span>
                      <Money v={m.amount} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <div className="signout">
              <ConfirmButton className="btn ghost" confirm="确认退出登录" onConfirm={() => account.logout().then(() => navigate('/'))}>退出登录</ConfirmButton>
            </div>
          </div>
        </div>
      </div>
      <AnimatePresence>{edit && <EditProfile onClose={() => setEdit(false)} />}</AnimatePresence>
    </main>
  );
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-val num">{value}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );
}

/** 最近 30 局累计输赢的小折线 */
function Spark({ values }: { values: number[] }) {
  const w = 220, h = 44;
  const all = [0, ...values];
  const lo = Math.min(...all), hi = Math.max(...all);
  const y = (v: number) => h - 4 - ((v - lo) / Math.max(1, hi - lo)) * (h - 8);
  const x = (i: number) => (i / (all.length - 1)) * w;
  const d = all.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const last = all[all.length - 1];
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-label="最近的累计输赢">
      <line x1="0" x2={w} y1={y(0)} y2={y(0)} className="spark-zero" />
      <motion.path d={d} className={last >= 0 ? 'pos' : 'neg'} initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.8, ease: 'easeOut' }} />
    </svg>
  );
}

function EditProfile({ onClose }: { onClose: () => void }) {
  const { user } = useAccount();
  const [name, setName] = useState(user!.name);
  const [avatar, setAvatar] = useState<string | null>(user!.avatar);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await account.updateMe({ name, avatar });
      toast('保存好了');
      onClose();
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal title="名字和头像" onClose={onClose}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <div className="avatar-preview"><Avatar name={name || '?'} avatar={avatar} picture={user!.picture} size={72} /></div>
        <label className="field"><span>名字（牌桌上显示）</span><input value={name} onChange={(e) => setName(e.target.value)} maxLength={12} /></label>
        <div className="field">
          <span>头像</span>
          <IconPicker value={avatar} onPick={setAvatar} icons={FACES} />
          <button type="button" className="btn small ghost" onClick={() => setAvatar(null)} disabled={avatar === null}>
            {user!.picture ? '用 Google 头像' : '用名字首字'}
          </button>
        </div>
        <button type="submit" className="btn gold big" disabled={busy || !name.trim()}>保存</button>
      </form>
    </Modal>
  );
}
