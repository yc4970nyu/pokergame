import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CardId, identify, voiceLine, voiceEvents, VOICE_FILES, newGame, play, pass, redeal, GameState } from '../src';
import type { GameView } from '../src/protocol';

const R: Record<string, number> = { '3': 0, '4': 1, '5': 2, '6': 3, '7': 4, '8': 5, '9': 6, '10': 7, J: 8, Q: 9, K: 10, A: 11, '2': 12 };
const S: Record<string, number> = { c: 0, d: 1, h: 2, s: 3 };
const c = (s: string): CardId => R[s.slice(0, -1)] * 4 + S[s.slice(-1)];
const cb = (s: string) => identify(s.split(' ').map(c))!;

describe('出牌语音：选哪一段', () => {
  it('单张按点数，13 个都有', () => {
    expect(voiceLine(cb('9h'), null)).toBe('single-9');
    expect(voiceLine(cb('3c'), null)).toBe('single-3');
    expect(voiceLine(cb('10d'), null)).toBe('single-10');
    expect(voiceLine(cb('Js'), null)).toBe('single-J');
    expect(voiceLine(cb('Ad'), null)).toBe('single-A');
    expect(voiceLine(cb('2s'), null)).toBe('single-2');
    // 压不同点数的单张，还是念点数
    expect(voiceLine(cb('9h'), cb('8s'))).toBe('single-9');
  });
  it('单张：同点数靠花色压 → 1cardOver', () => {
    expect(voiceLine(cb('9s'), cb('9h'))).toBe('over-single');
    expect(voiceLine(cb('2s'), cb('2c'))).toBe('over-single');
  });
  it('对子按点数；同点数的对子压对子 → othercardOver', () => {
    expect(voiceLine(cb('Kc Kd'), null)).toBe('pair-K');
    expect(voiceLine(cb('Kh Ks'), cb('Kc Kd'))).toBe('over-other');
    expect(voiceLine(cb('Ah As'), cb('Kc Kd'))).toBe('pair-A');
    expect(voiceLine(cb('2c 2d'), null)).toBe('pair-2');
    expect(voiceLine(cb('10c 10d'), null)).toBe('pair-10');
  });
  it('顺子：10 种顺子各有一段；同样的顺子靠花色压 → othercardOver', () => {
    const cases: [string, number][] = [
      ['Ac 2d 3h 4s 5c', 0], ['3c 4d 5h 6s 7c', 1], ['4c 5d 6h 7s 8c', 2], ['5c 6d 7h 8s 9c', 3], ['6c 7d 8h 9s 10c', 4],
      ['7c 8d 9h 10s Jc', 5], ['8c 9d 10h Js Qc', 6], ['9c 10d Jh Qs Kc', 7], ['10c Jd Qh Ks Ac', 8], ['2c 3d 4h 5s 6c', 9],
    ];
    for (const [s, w] of cases) expect(voiceLine(cb(s), null)).toBe(`straight-${w}`);
    expect(voiceLine(cb('3d 4c 5h 6c 7s'), cb('3c 4d 5h 6s 7c'))).toBe('over-other');
    expect(voiceLine(cb('4c 5d 6h 7s 8c'), cb('3c 4d 5h 6s 7c'))).toBe('straight-2');
  });
  it('葫芦、同花顺、铁支各一段，不念点数', () => {
    expect(voiceLine(cb('8c 8d 8h 3c 3d'), null)).toBe('fullhouse');
    expect(voiceLine(cb('9c 9d 9h 4c 4d'), cb('8c 8d 8h 3c 3d'))).toBe('fullhouse');
    expect(voiceLine(cb('4s 5s 6s 7s 8s'), null)).toBe('straightflush');
    expect(voiceLine(cb('4s 5s 6s 7s 8s'), cb('4c 5d 6h 7s 8c'))).toBe('straightflush');
    expect(voiceLine(cb('8c 8d 8h 8s 3c'), cb('Kc Kd'))).toBe('bomb');
  });
  it('需要的录音文件都在 client/public/voice 里', () => {
    const dir = path.resolve(__dirname, '../../client/public/voice');
    for (const f of VOICE_FILES) expect(fs.existsSync(path.join(dir, `${f}.mp3`)), f).toBe(true);
  });
});

describe('出牌语音：从状态变化里看出发生了什么', () => {
  const view = (s: GameState): GameView => ({
    phase: s.phase, round: s.round, decks: s.config.decks, handSize: s.config.handSize, dealNo: s.dealNo,
    mustInclude: s.mustInclude, redealSeat: s.redealSeat, turn: s.turn, lastPlay: s.lastPlay, passed: s.passed,
    flipped: s.flipped, flippedTo: s.flippedTo, winner: s.winner, lastDeltas: s.lastDeltas, settlement: s.lastSettlement,
    revealedHands: null, history: s.history, seq: s.seq, yourSeat: 0, yourHand: s.seats[0].hand, tricksWon: s.tricksWon,
  } as unknown as GameView);
  const players = [0, 1, 2].map((i) => ({ id: `p${i}`, name: `P${i}`, isBot: false }));
  const start = (): GameState => {
    let g = newGame(players);
    while (g.redealSeat !== null) g = redeal(g);
    return { ...g, mustInclude: null, turn: 0, lastPlay: null };
  };
  const withHands = (g: GameState, hands: string[]) =>
    ({ ...g, seats: g.seats.map((s, i) => ({ ...s, hand: hands[i].split(' ').map(c) })) });

  it('出牌 → play；不要 → pass；最后一个不要清空这一轮也算 pass', () => {
    let g = withHands(start(), ['9h 3c 4c', '9s 5c 6c', '10c 7c 8c']);
    const v0 = view(g);
    g = play(g, 0, [c('9h')]);
    const v1 = view(g);
    expect(voiceEvents(v0, v1)).toEqual([{ kind: 'play', key: `play:${g.dealNo}:0:${v0.seq}`, line: 'single-9' }]);
    g = play(g, 1, [c('9s')]);
    const v2 = view(g);
    expect(voiceEvents(v1, v2)).toMatchObject([{ kind: 'play', line: 'over-single' }]);
    g = pass(g, 2);
    const v3 = view(g);
    expect(voiceEvents(v2, v3)).toMatchObject([{ kind: 'pass', key: `pass:${g.dealNo}:2:${v2.seq}` }]);
    g = pass(g, 0); // 一轮结束，lastPlay 被清空
    const v4 = view(g);
    expect(v4.lastPlay).toBe(null);
    expect(voiceEvents(v3, v4)).toMatchObject([{ kind: 'pass' }]);
  });

  it('最后一张牌：只有赢家事件（带赢的钱），不念牌', () => {
    let g = withHands(start(), ['Ah', '3c 4c 5c 6c 7d 8d 9d 10d Jd Qd Kd', '3d']);
    const v0 = view(g);
    g = play(g, 0, [c('Ah')]);
    const ev = voiceEvents(v0, view(g));
    expect(ev).toEqual([{ kind: 'win', dealNo: g.dealNo, amount: g.lastDeltas![0] }]);
    expect(g.lastDeltas![0]).toBe(23); // 11 张 ×2 = 22，再加 1 张 = 23
  });

  it('新的一局 / 没变化 → 没有事件', () => {
    const g = start();
    expect(voiceEvents(null, view(g))).toEqual([]);
    expect(voiceEvents(view(g), view(g))).toEqual([]);
  });
});
