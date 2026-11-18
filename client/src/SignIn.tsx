import { useEffect, useRef, useState } from 'react';
import { account, useAccount } from './account';
import { toast } from './net';
import { navigate } from './router';

type GoogleId = {
  initialize(o: { client_id: string; callback: (r: { credential: string }) => void; auto_select?: boolean; ux_mode?: string; itp_support?: boolean }): void;
  renderButton(el: HTMLElement, o: Record<string, unknown>): void;
  disableAutoSelect(): void;
};
declare global { interface Window { google?: { accounts: { id: GoogleId } } } }

let gsi: Promise<GoogleId> | null = null;
function loadGsi(clientId: string): Promise<GoogleId> {
  gsi ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => {
      const id = window.google!.accounts.id;
      id.initialize({
        client_id: clientId,
        ux_mode: 'popup',
        itp_support: true,
        callback: ({ credential }) => {
          account.google(credential).then((u) => toast(`欢迎，${u.name}`)).catch((e) => toast(e.message));
        },
      });
      resolve(id);
    };
    s.onerror = () => { gsi = null; reject(new Error('Google 登录加载失败')); };
    document.head.appendChild(s);
  });
  return gsi;
}

function GoogleButton({ clientId }: { clientId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    loadGsi(clientId)
      .then((id) => {
        if (!alive || !ref.current) return;
        const width = Math.min(360, Math.max(200, Math.round(ref.current.clientWidth)));
        id.renderButton(ref.current, { theme: 'outline', size: 'large', shape: 'pill', text: 'continue_with', locale: 'zh_CN', width });
      })
      .catch(() => alive && setFailed(true));
    return () => { alive = false; };
  }, [clientId]);
  if (failed) return <p className="hint">Google 登录暂时加载不了，可以先用用户名登录。</p>;
  return <div className="gsi" ref={ref} />;
}

/** 登录面板：Google 一键登录，或者用户名 + 密码 */
export function SignIn({ onDone }: { onDone?: () => void }) {
  const { googleClientId } = useAccount();
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const u = tab === 'login' ? await account.login(username, password) : await account.register(username, password, name || username);
      toast(tab === 'login' ? `欢迎回来，${u.name}` : `注册好了，${u.name}`);
      onDone?.();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="signin">
      {googleClientId && (
        <>
          <GoogleButton clientId={googleClientId} />
          <div className="or"><span>或者用用户名</span></div>
        </>
      )}
      <div className="seg" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'login'} className={tab === 'login' ? 'on' : ''} onClick={() => setTab('login')}>登录</button>
        <button type="button" role="tab" aria-selected={tab === 'register'} className={tab === 'register' ? 'on' : ''} onClick={() => setTab('register')}>注册新账号</button>
      </div>
      <form className="signin-form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <label className="field">
          <span>用户名</span>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={20} />
        </label>
        <label className="field">
          <span>密码{tab === 'register' && '（至少 6 位）'}</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={tab === 'login' ? 'current-password' : 'new-password'} />
        </label>
        {tab === 'register' && (
          <label className="field">
            <span>牌桌上显示的名字</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={12} placeholder={username || '比如：Louis'} autoComplete="nickname" />
          </label>
        )}
        <button type="submit" className="btn gold big" disabled={busy || !username || !password}>{tab === 'login' ? '登录' : '注册并登录'}</button>
      </form>
      <p className="hint center-text">
        登录一次一直有效，除非你自己退出。
        <a className="legal-link" href="/privacy" onClick={(e) => { e.preventDefault(); navigate('/privacy'); }}>隐私说明</a>
      </p>
    </div>
  );
}
