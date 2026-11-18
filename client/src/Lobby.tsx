import type { RoomView } from '../../shared/src/protocol';
import { api, toast } from './net';
import { Avatar } from './ui';

export function Lobby({ room }: { room: RoomView }) {
  const isHost = room.hostId === room.you;
  const group = room.group;
  const seats = Array.from({ length: room.maxPlayers }, (_, i) => room.players[i] ?? null);
  const link = `${location.origin}/?room=${room.code}`;

  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: '来打大老二', text: `房间号 ${room.code}`, url: link });
      else { await navigator.clipboard.writeText(link); toast('邀请链接已复制'); }
    } catch { /* cancelled */ }
  };

  return (
    <main className="lobby">
      <header className="lobby-head">
        <button className="btn small ghost" onClick={api.leave}>离开</button>
        {group ? (
          <div className="room-code group-code">
            <span>小组牌桌</span>
            <strong>{group.icon} {group.name}</strong>
          </div>
        ) : (
          <div className="room-code">
            <span>房间号</span>
            <strong className="num">{room.code}</strong>
          </div>
        )}
        {group ? <span className="head-spacer" /> : <button className="btn small" onClick={share}>邀请朋友</button>}
      </header>

      <section className="seats">
        {seats.map((p, i) => (
          <div key={i} className={`seat-slot ${p ? 'filled' : ''}`}>
            {p ? (
              <>
                <Avatar name={p.name} avatar={p.avatar} />
                <div className="seat-name">
                  {p.name}
                  {p.id === room.hostId && <em>房主</em>}
                  {p.isBot && <em>机器人</em>}
                  {p.id === room.you && <em>你</em>}
                </div>
                {isHost && p.id !== room.you && (
                  <button className="kick" onClick={() => api.kick(p.id)} aria-label={`移出 ${p.name}`}>×</button>
                )}
              </>
            ) : isHost && !group ? (
              <button className="add-bot" onClick={api.addBot}>＋ 加机器人</button>
            ) : (
              <span className="waiting">{group ? '等组员从小组页加入…' : '等待加入…'}</span>
            )}
          </div>
        ))}
      </section>

      {isHost ? (
        <div className="lobby-actions">
          <div className="seg" role="radiogroup" aria-label="人数">
            {[4, 3, 2].map((n) => (
              <button key={n} role="radio" aria-checked={room.maxPlayers === n} className={room.maxPlayers === n ? 'on' : ''} onClick={() => api.setMax(n as 2 | 3 | 4)}>
                {n} 人局
              </button>
            ))}
          </div>
          <button className="btn gold big" disabled={room.players.length < 2} onClick={api.start}>
            开始游戏
          </button>
          {room.maxPlayers === 4 && <p className="hint">四人局：一副牌，每人 13 张，没有翻牌，其余规则和三人局一样。不满四人开始，就按三人局打。</p>}
          {room.players.length < 2 && (
            <p className="hint">{group ? '至少 2 个人才能开始。组员打开小组页就能看到这张桌，点「加入」就坐进来。' : '至少 2 个人才能开始。发房间号给朋友，或者加个机器人。'}</p>
          )}
          {group && <p className="hint">小组牌桌不能加机器人，每局输赢自动记进「{group.name}」的账本。</p>}
        </div>
      ) : (
        <p className="hint center">等房主开始游戏</p>
      )}
    </main>
  );
}
