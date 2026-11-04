// 出牌语音：Louis 自己录的声音。
//  - 所有录音提前下载、解码好放在内存里，出牌那一刻直接从内存播放，没有加载延迟。
//  - 同一时间只播一段：新的一手牌出来，立刻停掉上一段再播（不会叠在一起）。
//  - 「不要」只在没有别的语音在播时才播；点得很快（上一手的语音还没播完）就不播。
//  - 最后一张牌打出去：立刻播赢家音效；赢家这一局赢超过 40，紧接着播「赢超过 40 块」。
import type { Combo } from '../../shared/src/combos';
import type { GameView } from '../../shared/src/protocol';
import { VOICE_FILES, voiceEvents, voiceLine, playKey, passKey } from '../../shared/src/voice';
import { ac } from './sound';
import { getSettings } from './settings';

const buffers = new Map<string, AudioBuffer>();
const inflight = new Map<string, Promise<void>>();
const url = (name: string) => `/voice/${name}.mp3`;

/** 下载并解码一段；失败自动重试（最多 3 次，间隔越来越长） */
const lastTry = new Map<string, number>();
function load(name: string, attempt = 0): Promise<void> {
  if (buffers.has(name)) return Promise.resolve();
  const running = inflight.get(name);
  if (running && attempt === 0) return running;
  // 一轮（3 次）都失败的，10 秒内不再重新来过，免得每次状态更新都狂刷网络
  if (attempt === 0) {
    const t = lastTry.get(name);
    if (t && Date.now() - t < 10_000) return Promise.resolve();
    lastTry.set(name, Date.now());
  }
  const p = (async () => {
    const c = ac();
    if (!c) return;
    try {
      const res = await fetch(url(name));
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.arrayBuffer();
      const buf = await new Promise<AudioBuffer>((ok, bad) => {
        const r = c.decodeAudioData(data, ok, bad) as unknown as Promise<AudioBuffer> | undefined;
        r?.catch?.(bad);
      });
      buffers.set(name, buf);
    } catch {
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        return load(name, attempt + 1);
      }
    }
  })();
  if (attempt === 0) {
    inflight.set(name, p);
    void p.finally(() => inflight.delete(name));
  }
  return p;
}

/** 下载并解码全部录音；之后再调用只会补上还没成功的那几段 */
function preload() {
  return Promise.all(VOICE_FILES.filter((n) => !buffers.has(n)).map((n) => load(n))).then(() => undefined);
}

type Playing =
  | { kind: 'buf'; src: AudioBufferSourceNode; gain: GainNode; name: string }
  | { kind: 'el'; el: HTMLAudioElement; name: string };
let current: Playing | null = null;

function stopCurrent() {
  const p = current;
  current = null;
  if (!p) return;
  try {
    if (p.kind === 'el') {
      p.el.pause();
      return;
    }
    const c = ac();
    if (c) {
      // 8ms 的极短淡出，避免硬切时的爆音
      p.gain.gain.setTargetAtTime(0, c.currentTime, 0.002);
      p.src.stop(c.currentTime + 0.008);
    } else p.src.stop();
  } catch {
    /* already stopped */
  }
}

const log = (name: string, dur: number) =>
  // 测试用：页面上定义了 __voiceLog 才记录
  (window as unknown as { __voiceLog?: { name: string; t: number; dur: number; via?: string }[] }).__voiceLog?.push({ name, t: performance.now(), dur, via: Number.isNaN(dur) ? 'el' : 'buf' });

function play(name: string, onEnded?: () => void) {
  if (!getSettings().sound) return false;
  const c = ac(); // 顺手恢复被暂停 / 被打断的音频
  const buf = buffers.get(name);
  stopCurrent();
  if (c && buf) {
    const src = c.createBufferSource();
    src.buffer = buf;
    const gain = c.createGain();
    gain.gain.value = 1;
    src.connect(gain).connect(c.destination);
    const me: Playing = { kind: 'buf', src, gain, name };
    src.onended = () => {
      // 被下一段打断的不算播完
      if (current !== me) return;
      current = null;
      onEnded?.();
    };
    current = me;
    src.start(0);
    log(name, buf.duration);
    return true;
  }
  // 这一段还没解码好（网速慢 / 下载失败）→ 用普通 <audio> 直接播文件，同时在后台再下载一次
  void load(name);
  try {
    const el = new Audio(url(name));
    el.setAttribute('playsinline', '');
    const me: Playing = { kind: 'el', el, name };
    const done = () => {
      if (current !== me) return;
      current = null;
      onEnded?.();
    };
    el.onended = done;
    el.onerror = done;
    current = me;
    const r = el.play();
    if (r && typeof r.catch === 'function') r.catch(done);
    log(name, NaN);
    return true;
  } catch {
    current = null;
    return false;
  }
}

// ---- 赢家音效 + 「赢超过 40 块」 ----
let win: { dealNo: number; amount: number | null; ended: boolean; done: boolean } | null = null;
function maybeWin40() {
  if (!win || !win.ended || win.done || win.amount === null) return;
  win.done = true;
  if (win.amount > 40) play('win-40');
}
function startWin(dealNo: number, amount: number | null) {
  win = { dealNo, amount, ended: false, done: false };
  const w = win;
  const ok = play('win', () => {
    w.ended = true;
    maybeWin40();
  });
  if (!ok) w.ended = true;
}
function winResult(dealNo: number, amount: number) {
  if (win && win.dealNo === dealNo) {
    win.amount = amount;
    maybeWin40();
  } else startWin(dealNo, amount);
}

// ---- 去重：自己出的牌在点击那一刻就播了，服务器状态回来时不再播 ----
const voiced = new Set<string>();
let lastView: GameView | null = null;

const playPass = () => {
  if (current) return; // 上一段还在播 → 这次「不要」不出声
  play(Math.random() < 0.5 ? 'pass-1' : 'pass-2');
};

export const voice = {
  preload,
  /** 现在有语音在播吗（用来避免别的提示音叠上去） */
  busy: () => current !== null,

  /** 我点了「出牌」：不等服务器，当下就播 */
  myPlay(g: GameView, combo: Combo) {
    if (g.yourHand.length === combo.cards.length) {
      // 最后一手 → 赢家音效（钱数等服务器算好再决定要不要播「超过 40」）
      voiced.add(`win:${g.dealNo}`);
      startWin(g.dealNo, null);
      return;
    }
    voiced.add(playKey(g.dealNo, g.yourSeat, g.seq));
    play(voiceLine(combo, g.lastPlay?.combo ?? null));
  },

  /** 我点了「不要」 */
  myPass(g: GameView) {
    voiced.add(passKey(g.dealNo, g.yourSeat, g.seq));
    playPass();
  },

  /** 每次收到服务器状态都调用（在 React 渲染之前，越早越好） */
  onState(g: GameView | null) {
    const prev = lastView;
    lastView = g;
    // 新的一把（或者离开牌桌）→ 清掉上一把的记录，「再来一场」时局号会从头开始
    if (!g || !prev || prev.dealNo !== g.dealNo) {
      voiced.clear();
      win = null;
    }
    if (!g) return;
    for (const e of voiceEvents(prev, g)) {
      if (e.kind === 'win') {
        const k = `win:${e.dealNo}`;
        if (!voiced.has(k)) voiced.add(k);
        winResult(e.dealNo, e.amount);
      } else if (e.kind === 'play') {
        if (voiced.delete(e.key)) continue;
        play(e.line);
      } else {
        if (voiced.delete(e.key)) continue;
        playPass();
      }
    }
  },

  stop() {
    stopCurrent();
  },
};
