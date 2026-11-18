import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { settleUp, EMOJI_ICONS } from '../../shared/src/ledger';
import type { ActivityItem, MemberView, TableSummary } from '../../shared/src/ledger';
import { GroupFull, groupsApi, refreshAccount, useAccount } from './account';
import { api, socket, toast } from './net';
import { navigate } from './router';
import { Avatar, BackButton, ConfirmButton, IconPicker, Modal, Money, shareLink, timeAgo } from './ui';
import { SignIn } from './SignIn';
import { sfx } from './sound';

const err = (e: unknown) => toast((e as Error).message);

export function GroupPage({ id }: { id: string }) {
  const [g, setG] = useState<GroupFull | null>(null);
  const [missing, setMissing] = useState(false);
  const [tables, setTables] = useState<TableSummary[]>([]);
  const [sheet, setSheet] = useState<null | 'pay' | 'adjust' | 'settings'>(null);

  const load = useCallback(() => {
    groupsApi.get(id).then((d) => { setG(d); setTables(d.tables); }).catch((e) => { if (e.status === 403 || e.status === 404) setMissing(true); else err(e); });
  }, [id]);

  useEffect(() => {
    load();
    const watch = () => socket.emit('group:watch', { groupId: id });
    watch();
    const onTables = (p: { groupId: string; tables: TableSummary[] }) => { if (p.groupId === id) setTables(p.tables); };
    const onChanged = (p: { groupId: string }) => { if (p.groupId === id) load(); };
    socket.on('connect', watch);
    socket.on('group:tables', onTables);
    socket.on('group:changed', onChanged);
    return () => {
      socket.emit('group:unwatch', { groupId: id });
      socket.off('connect', watch);
      socket.off('group:tables', onTables);
      socket.off('group:changed', onChanged);
    };
  }, [id, load]);

  if (missing) {
    return (
      <main className="page">
        <div className="page-inner narrow">
          <div className="pcard empty-state">
            <p>找不到这个小组，或者你已经不在里面了。</p>
            <button className="btn gold" onClick={() => navigate('/')}>回首页</button>
          </div>
        </div>
      </main>
    );
  }
  if (!g) return <main className="page"><div className="page-loading">加载中…</div></main>;

  const byId = new Map(g.members.map((m) => [m.id, m]));
  const nameOf = (uid: string | null | undefined) => (uid && byId.get(uid)?.name) || '已退出的成员';
  const isAdmin = g.role === 'admin';
  const me = byId.get(g.you)!;
  const invite = `${location.origin}/join/${g.inviteCode}`;
  const done = () => { setSheet(null); load(); refreshAccount(); };

  return (
    <main className="page">
      <div className="page-inner">
        <header className="page-head">
          <BackButton onClick={() => navigate('/')} />
          <div className="gp-icon">{g.icon}</div>
          <div className="page-title">
            <h1>{g.name}</h1>
            <p>{g.members.length} 位成员{isAdmin && ' · 你是管理员'}</p>
          </div>
          <div className="page-head-actions">
            <button className="btn small" onClick={() => shareLink('来我们的大老二小组', `加入「${g.name}」`, invite, toast)}>邀请</button>
            <button className="icon-btn" onClick={() => setSheet('settings')} aria-label="小组设置">
              <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
            </button>
          </div>
        </header>

        <div className="gp-grid">
          <div className="gp-col">
            <Tables groupId={g.id} tables={tables} you={g.you} />
            <Ledger members={g.members} you={g.you} isAdmin={isAdmin} onPay={() => setSheet('pay')} onAdjust={() => setSheet('adjust')} />
          </div>
          <div className="gp-col">
            <Settle members={g.members} you={g.you} isAdmin={isAdmin} groupId={g.id} nameOf={nameOf} onDone={done} />
            <Feed items={g.activity} you={g.you} isAdmin={isAdmin} groupId={g.id} nameOf={nameOf} onDone={done} />
          </div>
        </div>
      </div>

      <AnimatePresence>
        {sheet === 'pay' && <PaymentSheet g={g} me={me} onClose={() => setSheet(null)} onDone={done} />}
        {sheet === 'adjust' && <AdjustSheet g={g} onClose={() => setSheet(null)} onDone={done} />}
        {sheet === 'settings' && <SettingsSheet g={g} invite={invite} onClose={() => setSheet(null)} onDone={done} reload={() => { load(); refreshAccount(); }} />}
      </AnimatePresence>
    </main>
  );
}

function Tables({ groupId, tables, you }: { groupId: string; tables: TableSummary[]; you: string }) {
  const [size, setSize] = useState<2 | 3 | 4>(3);
  const [busy, setBusy] = useState(false);
  const open = async () => {
    sfx.unlock();
    setBusy(true);
    const r = await api.createGroupTable(groupId, size);
    setBusy(false);
    if (!r.ok) toast(r.error);
  };
  const join = async (code: string) => {
    sfx.unlock();
    const r = await api.join(code, '');
    if (!r.ok) toast(r.error);
  };
  return (
    <section className="pcard">
      <header className="pcard-head"><h2>牌桌</h2>{tables.some((t) => t.phase !== 'over') && <span className="live-dot">{tables.filter((t) => t.phase !== 'over').length} 桌开着</span>}</header>
      <AnimatePresence initial={false}>
        {tables.map((t) => {
          const mine = t.players.some((p) => p.userId === you);
          const full = t.players.length >= t.maxPlayers;
          const canJoin = mine || (t.phase === 'lobby' && !full);
          return (
            <motion.div key={t.code} className="table-row" layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }}>
              <div className="table-info">
                <span className={`tstate ${t.phase}`}>
                  {t.phase === 'lobby' ? `等人 ${t.players.length}/${t.maxPlayers}` : t.phase === 'playing' ? `第 ${t.round} 局` : '已结束'}
                </span>
                <span className="table-names">
                  {t.players.map((p) => <span key={p.userId} className={p.connected ? '' : 'away'}>{p.name}</span>)}
                </span>
              </div>
              <button className={`btn small ${mine || canJoin ? 'gold' : ''}`} disabled={!canJoin} onClick={() => join(t.code)}>
                {mine ? '回到牌桌' : t.phase === 'over' ? '已结束' : t.phase === 'playing' ? '进行中' : full ? '满了' : '加入'}
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
      {tables.length === 0 && <p className="hint">现在没人在打。开一桌，组员在这里点一下就能坐进来。</p>}
      <div className="new-table">
        <div className="seg" role="radiogroup" aria-label="人数">
          {[4, 3, 2].map((n) => (
            <button key={n} role="radio" aria-checked={size === n} className={size === n ? 'on' : ''} onClick={() => setSize(n as 2 | 3 | 4)}>{n} 人</button>
          ))}
        </div>
        <button className="btn gold" disabled={busy} onClick={open}>开新桌</button>
      </div>
    </section>
  );
}

function Ledger({ members, you, isAdmin, onPay, onAdjust }: { members: MemberView[]; you: string; isAdmin: boolean; onPay: () => void; onAdjust: () => void }) {
  return (
    <section className="pcard">
      <header className="pcard-head"><h2>账本</h2><span className="pcard-sub">每局打完自动记</span></header>
      <ul className="members">
        {members.map((m) => (
          <li key={m.id} className={m.id === you ? 'me' : ''}>
            <Avatar name={m.name} avatar={m.avatar} picture={m.picture} size={36} />
            <div className="m-text">
              <span className="m-name">{m.name}{m.id === you && <em>你</em>}{m.role === 'admin' && <em>管理员</em>}</span>
              <span className="m-sub">{m.rounds ? `${m.rounds} 局 · 赢 ${m.wins}` : '还没打过'}</span>
            </div>
            <Money v={m.balance} />
          </li>
        ))}
      </ul>
      <div className="pcard-actions">
        <button className="btn small" onClick={onPay}>记一笔还款</button>
        {isAdmin && <button className="btn small ghost" onClick={onAdjust}>调账</button>}
      </div>
    </section>
  );
}

function Settle({ members, you, isAdmin, groupId, nameOf, onDone }: { members: MemberView[]; you: string; isAdmin: boolean; groupId: string; nameOf: (u: string) => string; onDone: () => void }) {
  const plan = useMemo(() => settleUp(members), [members]);
  const pay = (from: string, to: string, amount: number) =>
    groupsApi.payment(groupId, from, to, amount).then(() => { toast('记好了'); [0, 0.06, 0.12].forEach((d) => sfx.chip(d)); onDone(); }).catch(err);
  return (
    <section className="pcard">
      <header className="pcard-head"><h2>怎么结清</h2><span className="pcard-sub">付完点「已付」，账本自动更新</span></header>
      {plan.length === 0 ? (
        <p className="all-clear">大家都两清了 ✓</p>
      ) : (
        <ul className="settle">
          {plan.map((t) => {
            const mine = t.from === you || t.to === you;
            return (
              <li key={`${t.from}-${t.to}`} className={mine ? 'me' : ''}>
                <span className="s-who"><b>{t.from === you ? '你' : nameOf(t.from)}</b><span className="arrow">→</span><b>{t.to === you ? '你' : nameOf(t.to)}</b></span>
                <span className="money num">{t.amount}</span>
                {(mine || isAdmin) && (
                  <ConfirmButton className="btn small" confirm="确认已付" onConfirm={() => pay(t.from, t.to, t.amount)}>已付</ConfirmButton>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Feed({ items, you, isAdmin, groupId, nameOf, onDone }: { items: ActivityItem[]; you: string; isAdmin: boolean; groupId: string; nameOf: (u: string | null | undefined) => string; onDone: () => void }) {
  const who = (u: string | null | undefined) => (u === you ? '你' : nameOf(u));
  const canUndo = (a: ActivityItem) => {
    if (a.reversed || a.entryId === undefined) return false;
    const involved = a.gainer === you || a.loser === you;
    if (a.kind === 'payment') return involved || isAdmin;
    if (a.kind === 'adjust') return isAdmin;
    return false;
  };
  const undo = (a: ActivityItem) => groupsApi.reverse(groupId, a.entryId!).then(() => { toast('已撤销'); onDone(); }).catch(err);
  return (
    <section className="pcard">
      <header className="pcard-head"><h2>动态</h2></header>
      {items.length === 0 && <p className="hint">还没有动态。</p>}
      <ul className="feed">
        {items.map((a) => (
          <li key={a.id} className={a.reversed ? 'reversed' : ''}>
            <span className={`f-dot ${a.kind}`} aria-hidden />
            <div className="f-body">
              {a.kind === 'match' ? (
                <>
                  <span className="f-line">打了 {a.rounds} 局{a.live && <em className="live">进行中</em>}</span>
                  <span className="f-deltas">
                    {Object.entries(a.deltas ?? {}).sort((x, y) => y[1] - x[1]).map(([u, v]) => (
                      <span key={u}>{who(u)} <Money v={v} /></span>
                    ))}
                  </span>
                </>
              ) : a.kind === 'payment' ? (
                <span className="f-line">{who(a.gainer)} 付给 {who(a.loser)} <b className="num">{a.amount}</b>{a.actor !== a.gainer && a.actor !== a.loser && <i> · {who(a.actor)}记的</i>}</span>
              ) : a.kind === 'adjust' ? (
                <span className="f-line">调账：{who(a.loser)} 欠 {who(a.gainer)} <b className="num">{a.amount}</b><i> · {who(a.actor)}</i></span>
              ) : a.kind === 'reverse' ? (
                <span className="f-line">{who(a.actor)} 撤销了一笔</span>
              ) : a.kind === 'reset' ? (
                <span className="f-line">{who(a.actor)} 把所有人清零了</span>
              ) : (
                <span className="f-line">{who(a.actor)} 加入了小组</span>
              )}
              {a.note && <span className="f-note">“{a.note}”</span>}
              <span className="f-time">{timeAgo(a.at)}{a.reversed && ' · 已撤销'}</span>
            </div>
            {canUndo(a) && <ConfirmButton className="f-undo" confirm="确认撤销" onConfirm={() => undo(a)}>撤销</ConfirmButton>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function MemberSelect({ members, value, onChange, exclude = [] }: { members: MemberView[]; value: string; onChange: (v: string) => void; exclude?: string[] }) {
  return (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="" disabled>选一个人</option>
      {members.filter((m) => !exclude.includes(m.id)).map((m) => <option key={m.id} value={m.id}>{m.name}（{m.balance > 0 ? '+' : m.balance < 0 ? '−' : ''}{Math.abs(m.balance)}）</option>)}
    </select>
  );
}

function AmountInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="field">
      <span>金额</span>
      <input inputMode="numeric" pattern="[0-9]*" value={value} onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 7))} placeholder="0" className="num amount" />
    </label>
  );
}

function PaymentSheet({ g, me, onClose, onDone }: { g: GroupFull; me: MemberView; onClose: () => void; onDone: () => void }) {
  // 默认：欠钱就是我付给别人；被欠就是别人付给我
  const [dir, setDir] = useState<'paid' | 'got'>(me.balance > 0 ? 'got' : 'paid');
  const plan = useMemo(() => settleUp(g.members), [g.members]);
  const suggest = (d: typeof dir) => (d === 'paid' ? plan.find((t) => t.from === me.id)?.to : plan.find((t) => t.to === me.id)?.from) ?? '';
  const [other, setOther] = useState(() => suggest(dir));
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const t = dir === 'paid' ? plan.find((x) => x.from === me.id && x.to === other) : plan.find((x) => x.to === me.id && x.from === other);
    if (t) setAmount(String(t.amount));
  }, [dir, other, plan, me.id]);
  const submit = async () => {
    const n = Number(amount);
    if (!other || !n) return;
    setBusy(true);
    try {
      if (dir === 'paid') await groupsApi.payment(g.id, me.id, other, n, note);
      else await groupsApi.payment(g.id, other, me.id, n, note);
      toast('记好了');
      onDone();
    } catch (e) { err(e); } finally { setBusy(false); }
  };
  return (
    <Modal title="记一笔还款" onClose={onClose}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div className="seg">
          <button type="button" className={dir === 'paid' ? 'on' : ''} onClick={() => { setDir('paid'); setOther(suggest('paid')); }}>我付了钱给…</button>
          <button type="button" className={dir === 'got' ? 'on' : ''} onClick={() => { setDir('got'); setOther(suggest('got')); }}>我收到了…的钱</button>
        </div>
        <label className="field"><span>{dir === 'paid' ? '付给谁' : '谁付的'}</span><MemberSelect members={g.members} value={other} onChange={setOther} exclude={[me.id]} /></label>
        <AmountInput value={amount} onChange={setAmount} />
        <label className="field"><span>备注（可不填）</span><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={60} placeholder="比如：微信转账" /></label>
        <p className="hint">{dir === 'paid' ? '你的余额会加上这笔，对方的减去这笔。' : '你的余额会减去这笔，对方的加上这笔。'}记错了可以在动态里撤销。</p>
        <button type="submit" className="btn gold big" disabled={busy || !other || !Number(amount)}>记下来</button>
      </form>
    </Modal>
  );
}

function AdjustSheet({ g, onClose, onDone }: { g: GroupFull; onClose: () => void; onDone: () => void }) {
  const others = g.members;
  const [debtor, setDebtor] = useState('');
  const [creditor, setCreditor] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await groupsApi.adjust(g.id, debtor, creditor, Number(amount), note);
      toast('调好了');
      onDone();
    } catch (e) { err(e); } finally { setBusy(false); }
  };
  return (
    <Modal title="调账" onClose={onClose}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <p className="hint">补记以前的输赢、或者改正记错的账。每一笔都会记在动态里，记错了可以撤销。</p>
        {others.length < 2 ? (
          <p className="hint">小组里至少要有两个人才能调账。</p>
        ) : (
          <>
            <label className="field"><span>谁欠钱</span><MemberSelect members={others} value={debtor} onChange={setDebtor} exclude={[creditor]} /></label>
            <label className="field"><span>欠谁的</span><MemberSelect members={others} value={creditor} onChange={setCreditor} exclude={[debtor]} /></label>
            <AmountInput value={amount} onChange={setAmount} />
            <label className="field"><span>备注（可不填）</span><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={60} placeholder="比如：上线以前的账" /></label>
            <button type="submit" className="btn gold big" disabled={busy || !debtor || !creditor || !Number(amount)}>调账</button>
          </>
        )}
      </form>
    </Modal>
  );
}

function SettingsSheet({ g, invite, onClose, onDone, reload }: { g: GroupFull; invite: string; onClose: () => void; onDone: () => void; reload: () => void }) {
  const isAdmin = g.role === 'admin';
  const [name, setName] = useState(g.name);
  const [icon, setIcon] = useState(g.icon);
  const me = g.members.find((m) => m.id === g.you)!;
  const run = (p: Promise<unknown>, msg: string, close = false) =>
    p.then(() => { toast(msg); if (close) onDone(); else reload(); }).catch(err);
  const save = () => run(groupsApi.update(g.id, { name, icon }), '保存好了', true);
  const leave = () =>
    groupsApi.remove(g.id, g.you).then(() => { toast('已退出小组'); refreshAccount(); navigate('/'); }).catch(err);

  return (
    <Modal title={isAdmin ? '小组设置' : '小组'} onClose={onClose} wide>
      <div className="form">
        {isAdmin && (
          <>
            <label className="field"><span>小组名字</span><input value={name} onChange={(e) => setName(e.target.value)} maxLength={20} /></label>
            <div className="field"><span>图标</span><IconPicker value={icon} onPick={setIcon} /></div>
            <button className="btn gold" disabled={!name.trim() || (name === g.name && icon === g.icon)} onClick={save}>保存</button>
          </>
        )}

        <div className="field">
          <span>邀请链接</span>
          <div className="invite-row">
            <input readOnly value={invite} onFocus={(e) => e.currentTarget.select()} />
            <button className="btn small" onClick={() => navigator.clipboard?.writeText(invite).then(() => toast('已复制'), () => {})}>复制</button>
          </div>
          {isAdmin && <ConfirmButton className="btn small ghost" confirm="旧链接会失效，确认？" onConfirm={() => run(groupsApi.rotateInvite(g.id), '换了新链接')}>换一个新链接</ConfirmButton>}
        </div>

        {isAdmin && (
          <div className="field">
            <span>成员</span>
            <ul className="members compact">
              {g.members.map((m) => (
                <li key={m.id}>
                  <Avatar name={m.name} avatar={m.avatar} picture={m.picture} size={30} />
                  <div className="m-text"><span className="m-name">{m.name}{m.role === 'admin' && <em>管理员</em>}</span></div>
                  {m.id !== g.you && (
                    <div className="m-actions">
                      <button className="btn small ghost" onClick={() => run(groupsApi.setRole(g.id, m.id, m.role === 'admin' ? 'member' : 'admin'), '改好了')}>
                        {m.role === 'admin' ? '取消管理员' : '设为管理员'}
                      </button>
                      <ConfirmButton className="btn small ghost danger" confirm="确认移出" disabled={m.balance !== 0} onConfirm={() => run(groupsApi.remove(g.id, m.id), '已移出')}>移出</ConfirmButton>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <p className="hint">账没结清（余额不为 0）的人不能移出。</p>
          </div>
        )}

        {isAdmin && (
          <div className="field">
            <span>全部清零</span>
            <p className="hint">大家线下都结清了，一键把所有人归零（会记在动态里）。</p>
            <ConfirmButton className="btn small ghost danger" confirm="确认全部清零" onConfirm={() => run(groupsApi.reset(g.id), '已清零', true)}>全部清零</ConfirmButton>
          </div>
        )}

        <div className="field">
          <span>退出小组</span>
          {me.balance !== 0 ? <p className="hint">你的账还没结清，结清了才能退出。</p> : null}
          <ConfirmButton className="btn small ghost danger" confirm="确认退出" disabled={me.balance !== 0} onConfirm={leave}>退出小组</ConfirmButton>
        </div>
      </div>
    </Modal>
  );
}

/** 新建小组 */
export function CreateGroupSheet({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [icon, setIcon] = useState(EMOJI_ICONS[0]);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const { id } = await groupsApi.create(name, icon);
      await refreshAccount();
      onClose();
      navigate(`/g/${id}`);
    } catch (e) { err(e); } finally { setBusy(false); }
  };
  return (
    <Modal title="新建小组" onClose={onClose}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <label className="field"><span>小组名字</span><input value={name} onChange={(e) => setName(e.target.value)} maxLength={20} placeholder="比如：周五牌局" autoFocus /></label>
        <div className="field"><span>图标</span><IconPicker value={icon} onPick={setIcon} /></div>
        <p className="hint">建好以后把邀请链接发到群里。小组里的牌局不用房间号，输赢自动记账，可以超过 4 个人。</p>
        <button type="submit" className="btn gold big" disabled={busy || !name.trim()}>建小组</button>
      </form>
    </Modal>
  );
}

/** /join/:code — 打开邀请链接 */
export function JoinInvite({ code }: { code: string }) {
  const { user, loaded } = useAccount();
  const [g, setG] = useState<{ id: string; name: string; icon: string; members: number } | null>(null);
  const [bad, setBad] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { groupsApi.invite(code).then(setG).catch((e) => setBad(e.message)); }, [code]);
  const join = async () => {
    setBusy(true);
    try {
      const { id } = await groupsApi.join(code);
      await refreshAccount();
      navigate(`/g/${id}`, true);
    } catch (e) { err(e); } finally { setBusy(false); }
  };
  return (
    <main className="page">
      <div className="page-inner narrow">
        <header className="page-head"><BackButton onClick={() => navigate('/')} /></header>
        <motion.div className="pcard invite-card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          {bad ? (
            <><p>{bad}</p><button className="btn" onClick={() => navigate('/')}>回首页</button></>
          ) : !g ? (
            <p className="hint">加载中…</p>
          ) : (
            <>
              <div className="gp-icon big">{g.icon}</div>
              <p className="invite-eyebrow">邀请你加入</p>
              <h1>{g.name}</h1>
              <p className="hint">{g.members} 位成员 · 输赢自动记账</p>
              {!loaded ? null : user ? (
                <button className="btn gold big" disabled={busy} onClick={join}>以 {user.name} 的身份加入</button>
              ) : (
                <>
                  <p className="hint">先登录，之后打的每一局都会记到这个小组的账上。</p>
                  <SignIn />
                </>
              )}
            </>
          )}
        </motion.div>
      </div>
    </main>
  );
}
