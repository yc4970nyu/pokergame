import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { api, saveName, savedName, toast } from './net';
import { CardFace } from './Card';
import { sfx } from './sound';
import { useSettings, springs } from './settings';
import { refreshAccount, useAccount } from './account';
import { navigate } from './router';
import { Avatar, Money } from './ui';
import { SignIn } from './SignIn';
import { CreateGroupSheet } from './Group';

const TWOS = [48, 49, 50, 51]; // ♣2 ♦2 ♥2 ♠2
type Mode = null | 'create' | 'join' | 'practice' | 'signin';

export function Home() {
  const urlCode = new URLSearchParams(location.search).get('room')?.toUpperCase() ?? '';
  const [mode, setMode] = useState<Mode>(urlCode ? 'join' : null);
  const [name, setName] = useState(savedName());
  const [code, setCode] = useState(urlCode);
  const [size, setSize] = useState<2 | 3 | 4>(3);
  const [busy, setBusy] = useState(false);
  const { speed } = useSettings();
  const sp = springs(speed);
  const { user, groups, loaded } = useAccount();
  const [newGroup, setNewGroup] = useState(false);
  useEffect(() => { if (user) refreshAccount(); }, [user?.id]);
  useEffect(() => { if (user && mode === 'signin') setMode(null); }, [user, mode]);

  const needName = () => {
    if (user) { sfx.unlock(); return user.name; }
    const n = name.trim();
    if (!n) { toast('先给自己起个名字'); return null; }
    saveName(n);
    sfx.unlock();
    return n;
  };
  const run = async (fn: (n: string) => Promise<void>) => {
    const n = needName();
    if (!n || busy) return;
    setBusy(true);
    try { await fn(n); } finally { setBusy(false); }
  };
  const create = () => run(async (n) => {
    const r = await api.create(n, size);
    if (!r.ok) toast(r.error);
  });
  const join = () => run(async (n) => {
    if (code.trim().length < 4) { toast('输入 4 位房间号'); return; }
    const r = await api.join(code, n);
    if (!r.ok) toast(r.error);
  });
  const practice = () => run(async (n) => {
    const r = await api.create(n, size);
    if (!r.ok) return toast(r.error);
    for (let i = 1; i < size; i++) api.addBot();
    api.start();
  });

  const pick = (m: Mode) => { sfx.unlock(); sfx.pickup(); setMode(m); };
  const submit = mode === 'create' ? create : mode === 'join' ? join : practice;

  return (
    <main className={`home ${user ? 'signed' : ''}`}>
      <div className="home-top">
        {user ? (
          <button className="account-chip" onClick={() => navigate('/me')} aria-label="我的主页">
            <Avatar name={user.name} avatar={user.avatar} picture={user.picture} size={28} />
            <span>{user.name}</span>
          </button>
        ) : loaded ? (
          <button className="account-chip" onClick={() => pick('signin')}>登录</button>
        ) : null}
      </div>
      <section className="hero">
        <HeroFan sp={sp} still={speed === 'off'} />
        <h1 className="title">大老二</h1>
        <p className="subtitle">两三好友 · 谁先出完谁赢</p>
      </section>

      <div className="home-actions">
        <AnimatePresence mode="wait" initial={false}>
          {mode === null ? (
            <motion.div
              key="menu"
              className="choices"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.22 }}
            >
              {user && (
                <div className="home-groups">
                  <div className="hg-head"><span>我的小组</span><button type="button" onClick={() => setNewGroup(true)}>＋ 新建</button></div>
                  {groups.length === 0 ? (
                    <button className="choice primary" onClick={() => setNewGroup(true)}>
                      <span className="choice-t">建一个小组</span>
                      <span className="choice-s">固定的牌友圈：不用房间号，输赢自动记账</span>
                    </button>
                  ) : (
                    groups.map((g) => (
                      <button key={g.id} className="choice group-choice" onClick={() => { sfx.pickup(); navigate(`/g/${g.id}`); }}>
                        <span className="g-icon">{g.icon}</span>
                        <span className="g-text">
                          <span className="choice-t">{g.name}</span>
                          <span className="choice-s">{g.members} 人{g.tables > 0 && <b className="live-dot"> · {g.tables} 桌在打</b>}</span>
                        </span>
                        <Money v={g.balance} />
                      </button>
                    ))
                  )}
                  <div className="hg-head sub"><span>临时开桌</span></div>
                </div>
              )}
              {!user && loaded && (
                <button className="choice signin-choice" onClick={() => pick('signin')}>
                  <span className="choice-t">登录 / 注册</span>
                  <span className="choice-s">建小组、自动记账、看自己的战绩</span>
                </button>
              )}
              <button className={`choice ${user ? '' : 'primary'}`} onClick={() => pick('create')}>
                <span className="choice-t">开一桌</span>
                <span className="choice-s">开个房间，把房间号发给朋友</span>
              </button>
              <button className="choice" onClick={() => pick('join')}>
                <span className="choice-t">加入朋友</span>
                <span className="choice-s">输入朋友给你的 4 位房间号</span>
              </button>
              <button className="choice quiet" onClick={() => pick('practice')}>
                <span className="choice-t">先练一局</span>
                <span className="choice-s">和机器人打，随时退出</span>
              </button>
            </motion.div>
          ) : mode === 'signin' ? (
            <motion.div
              key="signin"
              className="sheet"
              initial={{ opacity: 0, y: 14, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={sp.card}
            >
              <header className="sheet-head">
                <button type="button" className="sheet-back" onClick={() => setMode(null)} aria-label="返回">
                  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
                <h2>登录</h2>
              </header>
              <SignIn onDone={() => setMode(null)} />
            </motion.div>
          ) : (
            <motion.form
              key={mode}
              className="sheet"
              onSubmit={(e) => { e.preventDefault(); submit(); }}
              initial={{ opacity: 0, y: 14, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={sp.card}
            >
              <header className="sheet-head">
                <button type="button" className="sheet-back" onClick={() => setMode(null)} aria-label="返回">
                  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
                <h2>{mode === 'create' ? '开一桌' : mode === 'join' ? '加入朋友' : '先练一局'}</h2>
              </header>

              {!user && loaded && (
                <label className="field">
                  <span>你的名字</span>
                  <input
                    value={name}
                    maxLength={12}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="比如：Louis"
                    autoComplete="nickname"
                    autoFocus={!name}
                  />
                </label>
              )}

              {mode === 'join' ? (
                <CodeBoxes code={code} setCode={setCode} autoFocus={!!name || !!user} />
              ) : (
                <div className="field">
                  <span>几个人</span>
                  <div className="seg" role="radiogroup" aria-label="人数">
                    {[4, 3, 2].map((n) => (
                      <button type="button" key={n} role="radio" aria-checked={size === n} className={size === n ? 'on' : ''} onClick={() => setSize(n as 2 | 3 | 4)}>
                        {n} 人局
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <button type="submit" className="btn gold big" disabled={busy}>
                {mode === 'create' ? '开桌' : mode === 'join' ? '加入' : '开始练习'}
              </button>
            </motion.form>
          )}
        </AnimatePresence>
      </div>
      <AnimatePresence>{newGroup && <CreateGroupSheet onClose={() => setNewGroup(false)} />}</AnimatePresence>
    </main>
  );
}

/** 4 位房间号：一个真输入框叠在 4 个格子上 */
function CodeBoxes({ code, setCode, autoFocus }: { code: string; setCode: (c: string) => void; autoFocus: boolean }) {
  const [focus, setFocus] = useState(false);
  return (
    <label className="field">
      <span>房间号</span>
      <div className={`code-boxes ${focus ? 'focus' : ''}`}>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={`cb ${code[i] ? 'filled' : ''} ${focus && i === Math.min(code.length, 3) ? 'cur' : ''}`}>{code[i] ?? ''}</span>
        ))}
        <input
          value={code}
          maxLength={4}
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          aria-label="房间号"
          autoFocus={autoFocus}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4))}
        />
      </div>
    </label>
  );
}

/** 主视觉：四张 2 扇形排开，进场时依次翻开 */
function HeroFan({ sp, still }: { sp: ReturnType<typeof springs>; still: boolean }) {
  const n = TWOS.length;
  return (
    <div className="fan" aria-hidden>
      {TWOS.map((c, i) => {
        const o = i - (n - 1) / 2;
        return (
          <motion.div
            key={c}
            className="fan-card"
            style={{ zIndex: i + 1 }}
            initial={{ x: 0, y: 70, rotate: 0, opacity: 0, scale: 0.9 }}
            animate={{ x: `calc(${o} * var(--fan-step))`, y: Math.abs(o) ** 2 * 6, rotate: o * 11, opacity: 1, scale: 1 }}
            transition={{ ...sp.card, delay: still ? 0 : 0.12 + i * 0.07 }}
          >
            <CardFace id={c} />
          </motion.div>
        );
      })}
    </div>
  );
}
