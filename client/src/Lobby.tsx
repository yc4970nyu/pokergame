import type { RoomView } from '../../shared/src/protocol';
import { api, toast } from './net';

export function Lobby({ room }: { room: RoomView }) {
  const isHost = room.hostId === room.you;
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
        <div className="room-code">
          <span>房间号</span>
          <strong className="num">{room.code}</strong>
        </div>
        <button className="btn small" onClick={share}>邀请朋友</button>
      </header>

      <section className="seats">
        {seats.map((p, i) => (
          <div key={i} className={`seat-slot ${p ? 'filled' : ''}`}>
            {p ? (
              <>
                <div className="avatar">{p.name.slice(0, 1)}</div>
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
            ) : isHost ? (
              <button className="add-bot" onClick={api.addBot}>＋ 加机器人</button>
            ) : (
              <span className="waiting">等待加入…</span>
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
          {room.players.length < 2 && <p className="hint">至少 2 个人才能开始。发房间号给朋友，或者加个机器人。</p>}
        </div>
      ) : (
        <p className="hint center">等房主开始游戏</p>
      )}
    </main>
  );
}
