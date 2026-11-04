// 出牌语音：每一手牌该播哪一段录音（只是规则，不碰音频）
import { rankOf } from './cards';
import type { Combo } from './combos';
import type { GameView } from './protocol';

const RANK_NAME = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];

/** 顺子是第几种（0 = A2345，1 = 34567 … 8 = 10JQKA，9 = 23456），和 combos.ts 里顺子的大小顺序一致 */
const straightWindow = (c: Combo) => Math.floor(c.key / 100);

/**
 * 这一手牌对应的录音文件名（client/public/voice/<name>.mp3）。
 *  - 单张：点数和上一手单张一样、靠花色压过去 → over-single；否则 single-<点数>
 *  - 对子：点数和上一手对子一样、靠花色压过去 → over-other；否则 pair-<点数>
 *  - 顺子：和上一手顺子是同一种顺子、靠花色压过去 → over-other；否则 straight-<第几种>
 *  - 葫芦 / 同花顺 / 铁支：每种固定一段
 */
export function voiceLine(combo: Combo, prev: Combo | null): string {
  switch (combo.type) {
    case 'single': {
      const r = rankOf(combo.cards[0]);
      if (prev?.type === 'single' && rankOf(prev.cards[0]) === r) return 'over-single';
      return `single-${RANK_NAME[r]}`;
    }
    case 'pair': {
      const r = rankOf(combo.cards[0]);
      if (prev?.type === 'pair' && rankOf(prev.cards[0]) === r) return 'over-other';
      return `pair-${RANK_NAME[r]}`;
    }
    case 'straight': {
      const w = straightWindow(combo);
      if (prev?.type === 'straight' && straightWindow(prev) === w) return 'over-other';
      return `straight-${w}`;
    }
    case 'fullhouse':
      return 'fullhouse';
    case 'straightflush':
      return 'straightflush';
    case 'fourkind':
    case 'fivekind':
      return 'bomb';
  }
}

export const VOICE_FILES: string[] = [
  ...RANK_NAME.map((r) => `single-${r}`),
  ...RANK_NAME.map((r) => `pair-${r}`),
  ...Array.from({ length: 10 }, (_, i) => `straight-${i}`),
  'over-single', 'over-other', 'fullhouse', 'straightflush', 'bomb',
  'pass-1', 'pass-2', 'win', 'win-40',
];

export type VoiceEvent =
  | { kind: 'play'; key: string; line: string }
  | { kind: 'pass'; key: string }
  | { kind: 'win'; dealNo: number; amount: number };

/** 同一手牌在「我点出牌的那一刻」和「服务器状态回来」时算出的 key 一样，用来避免播两遍 */
export const playKey = (dealNo: number, seat: number, seqBefore: number) => `play:${dealNo}:${seat}:${seqBefore}`;
export const passKey = (dealNo: number, seat: number, seqBefore: number) => `pass:${dealNo}:${seat}:${seqBefore}`;

/** 比较前后两次服务器状态，看刚刚发生了什么：有人出牌、有人不要、有人赢了 */
export function voiceEvents(prev: GameView | null, next: GameView): VoiceEvent[] {
  if (!prev || prev.dealNo !== next.dealNo || prev.seq === next.seq) return [];
  if (prev.phase !== 'playing') return [];
  // 最后一手牌打出去 → 直接播赢家音效，不再念牌
  if (next.phase !== 'playing') {
    if (next.winner === null) return [];
    return [{ kind: 'win', dealNo: next.dealNo, amount: next.lastDeltas?.[next.winner] ?? 0 }];
  }
  const a = prev.lastPlay;
  const b = next.lastPlay;
  const isNewPlay = !!b && (!a || a.seat !== b.seat || a.combo.cards.join('.') !== b.combo.cards.join('.'));
  if (isNewPlay) return [{ kind: 'play', key: playKey(next.dealNo, b!.seat, prev.seq), line: voiceLine(b!.combo, a?.combo ?? null) }];
  // 轮到的人没出牌、轮次往下走了 → 他点了不要（最后一个不要会把这一轮清空）
  const s = prev.turn;
  if ((next.passed[s] && !prev.passed[s]) || (a && !b)) return [{ kind: 'pass', key: passKey(next.dealNo, s, prev.seq) }];
  return [];
}
