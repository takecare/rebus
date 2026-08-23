import type { GameStateView } from '@rebus/shared';
import { socket } from '../net/socket.js';

export function GameOver({ view }: { view: GameStateView }) {
  const ranked = [...view.players].sort((a, b) => b.score - a.score);
  const isHost = view.hostId === view.youId;
  const winner = ranked[0];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      <div className="pt-6 text-center">
        <p className="text-sm uppercase tracking-widest text-muted">Winner</p>
        <p className="mt-1 text-4xl font-bold">{winner?.nick}</p>
        <p className="mt-1 text-2xl tabular-nums text-accent">{winner?.score}</p>
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto">
        {ranked.slice(1).map((p, i) => (
          <li key={p.id} className="flex items-center gap-3 border-b border-line py-3">
            <span className="w-6 text-muted tabular-nums">{i + 2}</span>
            <span className="flex-1 truncate">{p.nick}</span>
            <span className="w-16 text-right tabular-nums">{p.score}</span>
          </li>
        ))}
      </ul>

      {isHost ? (
        <button className="btn-primary" onClick={() => socket.send({ t: 'rematch' })}>
          Play again
        </button>
      ) : (
        <p className="text-center text-muted">Waiting for the host to start another one.</p>
      )}
      <button className="btn-ghost" onClick={() => socket.leave()}>
        Leave
      </button>
    </div>
  );
}
