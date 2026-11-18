import { describe, it, expect, vi, afterEach } from 'vitest';
import { RoomManager } from '../../server/src/rooms';
import { rankOf } from '../src';

afterEach(() => vi.useRealTimers());

describe('真人永远不会被自动跳过', () => {
  it('掉线的真人轮到他时，等多久都不会被代打或自动「不要」', () => {
    vi.useFakeTimers();
    const rm = new RoomManager(() => {});
    rm.create('a', 'A', 'sa', 2);
    rm.join(rm.byPlayer.get('a')!, 'b', 'B', 'sb');
    rm.start('a');
    const room = rm.roomOf('a')!;
    // 让 B 手里有铁支，上家刚出 ♠2，轮到 B
    const g = room.game!;
    const four = [0, 1, 2, 3].map((s) => 4 * 5 + s); // 四张 8
    const kicker = 4 * 0 + 0; // ♣3
    room.game = {
      ...g,
      phase: 'playing',
      redealSeat: null,
      mustInclude: null,
      turn: 1,
      lastPlay: { seat: 0, combo: { type: 'single', cards: [51], key: 51 } },
      passed: [false, false],
      seats: g.seats.map((s, i) => ({ ...s, hand: i === 1 ? [...four, kicker, 40] : [10, 11, 12] })),
    };
    void rankOf;
    const seq = room.game.seq;
    rm.disconnect('sb'); // B 掉线
    vi.advanceTimersByTime(10 * 60_000); // 过十分钟
    expect(room.game.seq).toBe(seq); // 什么都没发生
    expect(room.game.turn).toBe(1);
    expect(room.game.seats[1].hand.length).toBe(6);
    // B 回来以后，铁支还在，还是轮到他
    rm.join(room.code, 'b', 'B', 'sb2');
    expect(room.game.turn).toBe(1);
    rm.play('b', [...four, kicker]);
    expect(room.game.lastPlay?.combo.type).toBe('fourkind');
  });

  it('机器人仍然会自己出牌', () => {
    vi.useFakeTimers();
    const rm = new RoomManager(() => {});
    rm.create('a', 'A', 'sa', 2);
    rm.addBot('a');
    rm.start('a');
    const room = rm.roomOf('a')!;
    const botSeat = 1;
    room.game = { ...room.game!, turn: botSeat, redealSeat: null, mustInclude: null, lastPlay: null };
    const seq = room.game.seq;
    rm.touch(room);
    vi.advanceTimersByTime(10_000);
    expect(room.game!.seq).toBeGreaterThan(seq);
  });
});

describe('小组牌桌', () => {
  const grp = { id: 'g1', name: '周五牌局', icon: '🎲' };
  const make = () => {
    const rounds: string[] = [];
    const rm = new RoomManager(() => {}, { onRoundOver: (r) => rounds.push(r.matchId!) });
    const room = rm.create('u:a', 'A', 'sa', 2, { userId: 'a' }, grp);
    rm.join(room.code, 'u:b', 'B', 'sb', { userId: 'b' });
    return { rm, room, rounds };
  };

  it('不能加机器人，游客进不来', () => {
    const { rm, room } = make();
    expect(() => rm.addBot('u:a')).toThrow('机器人');
    expect(() => rm.join(room.code, 'guest', 'G', 'sg')).toThrow('登录');
    expect(() => rm.create('guest', 'G', 'sg', 2, { userId: null }, grp)).toThrow('登录');
  });

  it('打到一半离开：座位保留、不托管，回来接着打', () => {
    vi.useFakeTimers();
    const { rm, room } = make();
    rm.start('u:a');
    rm.leave('u:b');
    expect(room.players[1]).toMatchObject({ id: 'u:b', isBot: false, socketId: null });
    vi.advanceTimersByTime(60_000);
    rm.join(room.code, 'u:b', '', 'sb2', { userId: 'b' });
    expect(room.players[1].socketId).toBe('sb2');
    expect(rm.tablesFor('g1')).toHaveLength(1);
  });

  it('一局打完通知记账；比赛结束、人都走了就收桌', () => {
    const { rm, room, rounds } = make();
    rm.start('u:a');
    const g = room.game!;
    // 让 A 只剩一张牌，轮到 A 首攻
    room.game = { ...g, redealSeat: null, mustInclude: null, turn: 0, lastPlay: null, seats: g.seats.map((s, i) => ({ ...s, hand: i === 0 ? [51] : s.hand })) };
    rm.play('u:a', [51]);
    expect(room.game!.phase).toBe('roundOver');
    expect(rounds).toEqual([room.matchId]);
    rm.end('u:a');
    rm.leave('u:a');
    rm.leave('u:b');
    expect(rm.tablesFor('g1')).toHaveLength(0);
  });
});
