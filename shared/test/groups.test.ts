import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { openDb, Db } from '../../server/src/db';
import { Auth } from '../../server/src/auth';
import { Groups } from '../../server/src/groups';
import { settleUp } from '../src/ledger';

let db: Db;
let auth: Auth;
let groups: Groups;
const ids: Record<string, string> = {};

beforeAll(async () => {
  db = await openDb({ url: '', dir: null }); // 内存里的 PGlite
  auth = new Auth(db);
  groups = new Groups(db);
  for (const n of ['alice', 'bob', 'carol', 'dave']) ids[n] = (await auth.register(n, 'secret1', n)).id;
}, 30_000);
afterAll(() => db.close());

const bal = async (gid: string) =>
  Object.fromEntries((await groups.detail(gid, ids.alice)).members.map((m) => [m.name, m.balance]));

describe('账号', () => {
  it('用户名密码注册、登录、会话', async () => {
    await expect(auth.register('ALICE', 'secret1', 'x')).rejects.toThrow('已经有人用了');
    await expect(auth.passwordLogin('alice', 'wrong!!')).rejects.toThrow();
    const u = await auth.passwordLogin('Alice', 'secret1');
    const token = await auth.createSession(u.id);
    expect((await auth.fromToken(token))?.user.id).toBe(u.id);
    await auth.logout(token);
    expect(await auth.fromToken(token)).toBeNull();
  });
});

describe('小组账本', () => {
  let gid = '';
  it('建组、邀请加入', async () => {
    gid = await groups.create(ids.alice, '周五牌局', '🎲');
    const d = await groups.detail(gid, ids.alice);
    expect(d.role).toBe('admin');
    for (const n of ['bob', 'carol', 'dave']) await groups.join(d.inviteCode, ids[n]);
    expect((await groups.detail(gid, ids.bob)).members).toHaveLength(4);
    await expect(groups.update(gid, ids.bob, { name: 'x' })).rejects.toThrow('管理员');
  });

  it('打完一局自动记账（零和）', async () => {
    await groups.recordRound({
      matchId: 'm1', groupId: gid,
      players: [{ userId: ids.alice, name: 'alice' }, { userId: ids.bob, name: 'bob' }, { userId: ids.carol, name: 'carol' }],
      record: {
        round: 1, winner: 0, tailTwo: false,
        seats: [
          { tricksWon: 3, misses: 0, passes: 1, cardsLeft: 0, twosLeft: 0, amount: 30 },
          { tricksWon: 1, misses: 0, passes: 2, cardsLeft: 10, twosLeft: 0, amount: -20 },
          { tricksWon: 0, misses: 0, passes: 2, cardsLeft: 10, twosLeft: 1, amount: -10 },
        ],
      },
    });
    expect(await bal(gid)).toMatchObject({ alice: 30, bob: -20, carol: -10, dave: 0 });
    const p = await groups.profile(ids.alice);
    expect(p).toMatchObject({ rounds: 1, wins: 1, net: 30 });
  });

  it('管理员可以调账（包括自己的）；别人可以记自己的还款', async () => {
    await groups.adjust(gid, ids.alice, ids.bob, ids.alice, 5);
    expect(await bal(gid)).toMatchObject({ alice: 35, bob: -25 });
    await groups.adjust(gid, ids.alice, ids.alice, ids.bob, 5);
    expect(await bal(gid)).toMatchObject({ alice: 30, bob: -20 });
    await expect(groups.adjust(gid, ids.bob, ids.carol, ids.dave, 5)).rejects.toThrow('管理员');
    await groups.adjust(gid, ids.alice, ids.carol, ids.dave, 5); // carol 欠 dave 5（补记以前的）
    expect(await bal(gid)).toMatchObject({ carol: -15, dave: 5 });
    await expect(groups.payment(gid, ids.carol, ids.bob, ids.alice, 20)).rejects.toThrow('自己');
    await groups.payment(gid, ids.bob, ids.bob, ids.alice, 20); // bob 还了 alice 20
    expect(await bal(gid)).toMatchObject({ alice: 10, bob: 0 });
  });

  it('撤销、清零、结清建议', async () => {
    const act = await groups.activity(gid);
    const pay = act.find((a) => a.kind === 'payment')!;
    await expect(groups.reverse(gid, ids.carol, pay.entryId)).rejects.toThrow();
    await groups.reverse(gid, ids.bob, pay.entryId);
    expect(await bal(gid)).toMatchObject({ alice: 30, bob: -20 });
    await expect(groups.reverse(gid, ids.bob, pay.entryId)).rejects.toThrow('撤销过');
    await expect(groups.removeMember(gid, ids.bob, ids.bob)).rejects.toThrow('结清');

    const plan = settleUp((await groups.detail(gid, ids.alice)).members.map((m) => ({ id: m.id, balance: m.balance })));
    expect(plan.reduce((a, t) => a + t.amount, 0)).toBe(35);
    for (const t of plan) await groups.payment(gid, t.from, t.from, t.to, t.amount);
    expect(Object.values(await bal(gid)).every((v) => v === 0)).toBe(true);

    await groups.adjust(gid, ids.alice, ids.bob, ids.carol, 7);
    await groups.reset(gid, ids.alice);
    expect(Object.values(await bal(gid)).every((v) => v === 0)).toBe(true);
  });

  it('至少留一个管理员', async () => {
    await expect(groups.setRole(gid, ids.alice, ids.alice, 'member')).rejects.toThrow('至少');
    await groups.setRole(gid, ids.alice, ids.bob, 'admin');
    await groups.setRole(gid, ids.bob, ids.alice, 'member');
    expect((await groups.detail(gid, ids.alice)).role).toBe('member');
  });
});

describe('settleUp', () => {
  it('笔数少、金额对', () => {
    const t = settleUp([{ id: 'a', balance: 50 }, { id: 'b', balance: -30 }, { id: 'c', balance: -20 }, { id: 'd', balance: 0 }]);
    expect(t).toEqual([{ from: 'b', to: 'a', amount: 30 }, { from: 'c', to: 'a', amount: 20 }]);
  });
});
