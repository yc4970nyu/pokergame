import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { GameView } from '../src/protocol';
import { identify, CardId } from '../src';

// 模拟手机上会出现的各种音频状态：暂停、被打断（iPhone 切出去再回来）、彻底关掉
const played: { name: string; via: string }[] = [];
const contexts: FakeCtx[] = [];
let resumeCalls = 0;
class FakeCtx {
  currentTime = 0;
  state: string = 'suspended';
  destination = {};
  onstatechange: null | (() => void) = null;
  constructor() { contexts.push(this); }
  resume() { resumeCalls++; this.state = 'running'; this.onstatechange?.(); return Promise.resolve(); }
  decodeAudioData(data: { name: string }, ok: (b: unknown) => void) { ok({ name: data.name, duration: 1 }); }
  createBuffer() { return { name: '__silence', duration: 0 }; }
  createGain() { return { gain: { value: 1, setTargetAtTime() {} }, connect: (x: unknown) => x }; }
  createBufferSource() {
    const s = {
      buffer: null as null | { name: string }, onended: null as null | (() => void),
      connect: (x: unknown) => x,
      start() { if (s.buffer && s.buffer.name !== '__silence') played.push({ name: s.buffer.name, via: 'buf' }); },
      stop() {},
    };
    return s;
  }
}
class FakeAudio {
  onended: null | (() => void) = null; onerror: null | (() => void) = null;
  constructor(public src: string) {}
  setAttribute() {}
  play() { played.push({ name: this.src.replace('/voice/', '').replace('.mp3', ''), via: 'el' }); return Promise.resolve(); }
  pause() {}
}
let failFor = new Map<string, number>(); // 这些文件前 N 次下载失败
let fetches = new Map<string, number>();

let voice: typeof import('../../client/src/voice').voice;
let sound: typeof import('../../client/src/sound');
beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.window = { AudioContext: FakeCtx, matchMedia: () => ({ matches: false }) };
  Object.defineProperty(globalThis, 'navigator', { value: { audioSession: { type: 'auto' } }, configurable: true });
  g.localStorage = { getItem: () => null, setItem() {} };
  g.Audio = FakeAudio;
  g.fetch = async (url: string) => {
    const name = url.replace('/voice/', '').replace('.mp3', '');
    fetches.set(name, (fetches.get(name) ?? 0) + 1);
    const left = failFor.get(name) ?? 0;
    if (left > 0) { failFor.set(name, left - 1); return { ok: false, status: 503 }; }
    return { ok: true, arrayBuffer: async () => ({ name }) };
  };
  sound = await import('../../client/src/sound');
  voice = (await import('../../client/src/voice')).voice;
});
beforeEach(() => { voice.stop(); played.length = 0; voice.onState(null); });

const R: Record<string, number> = { '3': 0, '4': 1, '5': 2, '6': 3, '7': 4, '8': 5, '9': 6, '10': 7, J: 8, Q: 9, K: 10, A: 11, '2': 12 };
const S: Record<string, number> = { c: 0, d: 1, h: 2, s: 3 };
const c = (s: string): CardId => R[s.slice(0, -1)] * 4 + S[s.slice(-1)];
const cb = (s: string) => identify(s.split(' ').map(c))!;
const v = (p: Partial<GameView>): GameView => ({
  phase: 'playing', dealNo: 1, seq: 1, turn: 0, lastPlay: null, passed: [false, false, false], winner: null, lastDeltas: null,
  yourSeat: 0, yourHand: [c('9h'), c('3c')], ...p,
} as GameView);
const otherPlays = (combo: string, seq: number) => {
  voice.onState(v({ seq, turn: 1 }));
  voice.onState(v({ seq: seq + 1, turn: 2, lastPlay: { seat: 1, combo: cb(combo) } }));
};

describe('音频通道：任何情况都要能出声', () => {
  it('iPhone 上把音频类型设成 playback（静音开关打开也出声）', async () => {
    failFor = new Map([['single-9', 2], ['bomb', 99]]); // single-9 先失败两次（测重试）；bomb 一直下载失败（测兜底）
    await voice.preload();
    expect((globalThis as unknown as { navigator: { audioSession: { type: string } } }).navigator.audioSession.type).toBe('playback');
  });

  it('下载失败会自动重试，最后能成功', async () => {
    // preload 时 single-9 失败两次，第三次成功
    expect(fetches.get('single-9')).toBe(3);
    otherPlays('9h', 10);
    expect(played).toEqual([{ name: 'single-9', via: 'buf' }]);
  }, 10_000);

  it('通道被暂停 / 被打断时，出牌会先恢复再播', () => {
    const ctx = contexts[contexts.length - 1];
    for (const st of ['suspended', 'interrupted']) {
      ctx.state = st;
      const before = resumeCalls;
      played.length = 0;
      otherPlays('Kc Kd', 20 + (st === 'suspended' ? 0 : 10));
      expect(resumeCalls).toBeGreaterThan(before);
      expect(ctx.state).toBe('running');
      expect(played).toEqual([{ name: 'pair-K', via: 'buf' }]);
    }
  });

  it('通道彻底关掉（closed）会重新建一个，照样出声', () => {
    const n = contexts.length;
    contexts[n - 1].state = 'closed';
    otherPlays('Ac Ad', 40);
    expect(contexts.length).toBe(n + 1);
    expect(played).toEqual([{ name: 'pair-A', via: 'buf' }]);
  });

  it('某一段一直没解码好 → 用 <audio> 直接播，照样出声，不会静音', () => {
    otherPlays('8c 8d 8h 8s 3c', 50);
    expect(played).toEqual([{ name: 'bomb', via: 'el' }]);
    expect(fetches.get('bomb')).toBeGreaterThanOrEqual(3); // 每次都重试过
  });

  it('解锁函数在手势里调用时会恢复通道', () => {
    const ctx = contexts[contexts.length - 1];
    ctx.state = 'interrupted';
    expect(sound.audioRunning()).toBe(false);
    sound.unlockAudio();
    expect(sound.audioRunning()).toBe(true);
  });
});
