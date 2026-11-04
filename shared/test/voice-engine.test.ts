import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { GameView } from '../src/protocol';
import { identify, CardId } from '../src';

// ---- a fake browser audio device: every clip is 1 s long, time only moves when we say so ----
type Src = { name: string; started: boolean; stopped: boolean; onended: null | (() => void); start: () => void; stop: () => void; connect: (x: unknown) => unknown; buffer: { name: string } | null };
const played: string[] = [];
let live: Src[] = [];
class FakeCtx {
  currentTime = 0;
  state = 'running';
  destination = {};
  resume() { return Promise.resolve(); }
  decodeAudioData(data: { name: string }, ok: (b: unknown) => void) { ok({ name: data.name, duration: 1 }); }
  createGain() { return { gain: { value: 1, setTargetAtTime() {} }, connect: (x: unknown) => x }; }
  createBufferSource(): Src {
    const s: Src = {
      name: '', started: false, stopped: false, onended: null, buffer: null,
      connect: (x) => x,
      start() { s.started = true; s.name = s.buffer!.name; played.push(s.name); live.push(s); },
      stop() { if (s.stopped) return; s.stopped = true; live = live.filter((x) => x !== s); queueMicrotask(() => s.onended?.()); },
    };
    return s;
  }
}
/** the clip that is playing now reaches its natural end */
const finish = () => { const s = live.shift(); if (s) { s.stopped = true; s.onended?.(); } };

let voice: typeof import('../../client/src/voice').voice;
beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.window = { AudioContext: FakeCtx, matchMedia: () => ({ matches: false }) };
  g.localStorage = { getItem: () => null, setItem() {} };
  g.performance = globalThis.performance;
  g.fetch = async (url: string) => ({ ok: true, arrayBuffer: async () => ({ name: url.replace('/voice/', '').replace('.mp3', '') }) });
  voice = (await import('../../client/src/voice')).voice;
  await voice.preload();
});
beforeEach(() => { voice.stop(); played.length = 0; live = []; voice.onState(null); });

const R: Record<string, number> = { '3': 0, '4': 1, '5': 2, '6': 3, '7': 4, '8': 5, '9': 6, '10': 7, J: 8, Q: 9, K: 10, A: 11, '2': 12 };
const S: Record<string, number> = { c: 0, d: 1, h: 2, s: 3 };
const c = (s: string): CardId => R[s.slice(0, -1)] * 4 + S[s.slice(-1)];
const cb = (s: string) => identify(s.split(' ').map(c))!;
const v = (p: Partial<GameView>): GameView => ({
  phase: 'playing', dealNo: 1, seq: 1, turn: 0, lastPlay: null, passed: [false, false, false], winner: null, lastDeltas: null,
  yourSeat: 0, yourHand: [c('9h'), c('3c')], ...p,
} as GameView);

describe('语音播放器', () => {
  it('最后一张牌：立刻播赢家音效；赢超过 40 → 赢家音效播完紧接着播「赢超过40块」', async () => {
    const g = v({ yourHand: [c('Ah')], seq: 5 });
    voice.onState(g);
    voice.myPlay(g, cb('Ah'));
    expect(played).toEqual(['win']);
    voice.onState(v({ phase: 'roundOver', seq: 6, winner: 0, lastDeltas: [45, -20, -25], lastPlay: { seat: 0, combo: cb('Ah') } }));
    expect(played).toEqual(['win']); // 赢家音效还没播完，不叠上去
    finish();
    expect(played).toEqual(['win', 'win-40']);
  });

  it('赢正好 40 不播「超过 40」；状态晚到也能接上', async () => {
    const g = v({ yourHand: [c('Ah')], seq: 5 });
    voice.onState(g);
    voice.myPlay(g, cb('Ah'));
    finish(); // 赢家音效先播完，钱数还没回来
    expect(played).toEqual(['win']);
    voice.onState(v({ phase: 'roundOver', seq: 6, winner: 0, lastDeltas: [40, -20, -20] }));
    expect(played).toEqual(['win']);
  });

  it('别人赢了：收到状态就播赢家音效，超过 40 接着播', async () => {
    voice.onState(v({ seq: 5, turn: 1 }));
    voice.onState(v({ phase: 'roundOver', seq: 6, winner: 1, lastDeltas: [-30, 52, -22] }));
    expect(played).toEqual(['win']);
    finish();
    expect(played).toEqual(['win', 'win-40']);
  });

  it('自己出的牌点下去就播，服务器状态回来不再播第二遍', async () => {
    const g = v({ seq: 3 });
    voice.onState(g);
    voice.myPlay(g, cb('9h'));
    expect(played).toEqual(['single-9']);
    voice.onState(v({ seq: 4, turn: 1, lastPlay: { seat: 0, combo: cb('9h') } }));
    expect(played).toEqual(['single-9']);
  });

  it('新的一手牌立刻打断上一段，永远只有一段在播', async () => {
    voice.onState(v({ seq: 1, turn: 1 }));
    voice.onState(v({ seq: 2, turn: 2, lastPlay: { seat: 1, combo: cb('Kc Kd') } }));
    voice.onState(v({ seq: 3, turn: 0, lastPlay: { seat: 2, combo: cb('Kh Ks') } }));
    expect(played).toEqual(['pair-K', 'over-other']);
    expect(live.length).toBe(1);
  });

  it('不要：上一段还在播就不出声；安静时随机播「不要」或「要不起」', async () => {
    voice.onState(v({ seq: 1, turn: 1 }));
    voice.onState(v({ seq: 2, turn: 2, lastPlay: { seat: 1, combo: cb('Kc Kd') } }));
    voice.onState(v({ seq: 3, turn: 0, passed: [false, false, true], lastPlay: { seat: 1, combo: cb('Kc Kd') } }));
    expect(played).toEqual(['pair-K']); // 点得太快，不要被省略
    finish();
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      played.length = 0;
      const g = v({ seq: 10 + i * 2, turn: 0, lastPlay: { seat: 1, combo: cb('Kc Kd') } });
      voice.onState(g);
      voice.myPass(g);
      expect(played.length).toBe(1);
      seen.add(played[0]);
      finish();
    }
    expect([...seen].sort()).toEqual(['pass-1', 'pass-2']);
  });
});
