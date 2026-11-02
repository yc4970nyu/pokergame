import { useState } from 'react';
import { motion } from 'motion/react';
import { api, saveName, savedName, toast } from './net';
import { CardFace } from './Card';
import { sfx } from './sound';
import { useSettings, springs } from './settings';

const TWOS = [49, 50, 51, 48]; // ♦2 ♥2 ♠2 ♣2 — fanned behind the title

export function Home() {
  const urlCode = new URLSearchParams(location.search).get('room')?.toUpperCase() ?? '';
  const [name, setName] = useState(savedName());
  const [code, setCode] = useState(urlCode);
  const [size, setSize] = useState<2 | 3>(3);
  const [busy, setBusy] = useState(false);
  const { speed } = useSettings();
  const sp = springs(speed);

  const needName = () => {
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

  return (
    <main className="home">
      <div className="hero">
        <div className="hero-fan" aria-hidden>
          {TWOS.map((c, i) => (
            <motion.div
              key={c}
              className="hero-card"
              initial={{ y: 80, rotate: 0, opacity: 0 }}
              animate={{ y: 0, rotate: (i - 1.5) * 13, opacity: 1 }}
              transition={{ ...sp.card, delay: speed === 'off' ? 0 : 0.15 + i * 0.07 }}
            >
              <CardFace id={c} />
            </motion.div>
          ))}
        </div>
        <h1 className="title">大老二</h1>
        <p className="subtitle">三人或两人 · 先出完的人赢</p>
      </div>

      <section className="panel home-form">
        <label className="field">
          <span>你的名字</span>
          <input value={name} maxLength={12} onChange={(e) => setName(e.target.value)} placeholder="比如：Louis" autoComplete="nickname" />
        </label>

        <div className="seg" role="radiogroup" aria-label="人数">
          {[3, 2].map((n) => (
            <button key={n} role="radio" aria-checked={size === n} className={size === n ? 'on' : ''} onClick={() => setSize(n as 2 | 3)}>
              {n} 人局
            </button>
          ))}
        </div>

        <button className="btn gold" disabled={busy} onClick={create}>创建房间</button>

        <div className="join-row">
          <input
            className="code-input"
            value={code}
            maxLength={4}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
            placeholder="房间号"
            aria-label="房间号"
            autoCapitalize="characters"
          />
          <button className="btn" disabled={busy} onClick={join}>加入</button>
        </div>

        <button className="btn ghost" disabled={busy} onClick={practice}>和机器人练习</button>
      </section>
    </main>
  );
}
