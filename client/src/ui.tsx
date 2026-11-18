// 小组 / 个人页共用的小组件
import { ReactNode, useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { EMOJI_ICONS } from '../../shared/src/ledger';
import { useSettings, springs } from './settings';

const isUrl = (s: string | null | undefined) => !!s && /^https?:\/\//.test(s);

/** 头像：自己选的 emoji > Google 头像 > 名字第一个字 */
export function Avatar({ name, avatar, picture, size = 40, className = '' }: { name: string; avatar?: string | null; picture?: string | null; size?: number; className?: string }) {
  const [broken, setBroken] = useState(false);
  const pic = isUrl(avatar) ? avatar : !avatar && isUrl(picture) ? picture : null;
  const style = { width: size, height: size, fontSize: Math.round(size * (avatar && !pic ? 0.52 : 0.42)) };
  return (
    <span className={`avatar uav ${className}`} style={style} aria-hidden>
      {pic && !broken ? <img src={pic} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} /> : avatar && !isUrl(avatar) ? avatar : [...name][0] ?? '?'}
    </span>
  );
}

export function Money({ v, className = '', plain = false }: { v: number; className?: string; plain?: boolean }) {
  const cls = v > 0 ? 'pos' : v < 0 ? 'neg' : 'zero';
  return <span className={`money num ${cls} ${className}`}>{v > 0 && !plain ? '+' : v < 0 ? '−' : ''}{Math.abs(v)}</span>;
}

/** 手机上是底部弹出的面板，大屏上是居中的对话框 */
export function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const { speed } = useSettings();
  const sp = springs(speed);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <motion.div className="modal-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.div
        className={`modal ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        initial={{ y: 40, opacity: 0, scale: 0.98 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 30, opacity: 0, scale: 0.98 }}
        transition={sp.card}
      >
        <header className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="modal-x" onClick={onClose} aria-label="关闭">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </motion.div>
    </motion.div>
  );
}

/** 点第一下变成「确定？」，3 秒内再点一下才真的执行 */
export function ConfirmButton({ children, confirm = '再点一下确认', onConfirm, className = 'btn small', disabled }: { children: ReactNode; confirm?: string; onConfirm: () => void; className?: string; disabled?: boolean }) {
  const [armed, setArmed] = useState(false);
  const t = useRef<number>(0);
  useEffect(() => () => clearTimeout(t.current), []);
  return (
    <button
      type="button"
      className={`${className} ${armed ? 'armed' : ''}`}
      disabled={disabled}
      onClick={() => {
        if (armed) { setArmed(false); clearTimeout(t.current); onConfirm(); return; }
        setArmed(true);
        t.current = window.setTimeout(() => setArmed(false), 3000);
      }}
    >
      {armed ? confirm : children}
    </button>
  );
}

export function IconPicker({ value, onPick, icons = EMOJI_ICONS }: { value: string | null; onPick: (i: string) => void; icons?: string[] }) {
  return (
    <div className="icon-grid" role="radiogroup">
      {icons.map((i) => (
        <button type="button" key={i} role="radio" aria-checked={value === i} className={value === i ? 'on' : ''} onClick={() => onPick(i)}>{i}</button>
      ))}
    </div>
  );
}

export function BackButton({ onClick, label = '返回' }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" className="sheet-back page-back" onClick={onClick} aria-label={label}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
  );
}

export function timeAgo(iso: string) {
  const t = new Date(iso);
  const s = (Date.now() - t.getTime()) / 1000;
  if (s < 60) return '刚刚';
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  if (s < 2 * 86400) return '昨天';
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} 天前`;
  return `${t.getMonth() + 1}月${t.getDate()}日`;
}

export async function shareLink(title: string, text: string, url: string, toast: (m: string) => void) {
  try {
    if (navigator.share) await navigator.share({ title, text, url });
    else { await navigator.clipboard.writeText(url); toast('邀请链接已复制'); }
  } catch { /* 取消了 */ }
}
