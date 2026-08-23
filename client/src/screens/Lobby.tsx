import { CONFIG, type GameStateView } from '@rebus/shared';
import { PlayerList } from '../components/PlayerList.js';
import { socket } from '../net/socket.js';

export function Lobby({ view }: { view: GameStateView }) {
  const isHost = view.hostId === view.youId;
  const connected = view.players.filter((p) => p.connected).length;
  const canStart = connected >= CONFIG.MIN_PLAYERS;

  const share = async () => {
    const url = `${location.origin}${location.pathname}#/r/${view.code}`;
    try {
      if (navigator.share) await navigator.share({ title: 'Rebus', url });
      else await navigator.clipboard.writeText(url);
    } catch {
      /* the code on screen is the fallback */
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      <div className="card px-4 py-6 text-center">
        <p className="text-sm uppercase tracking-widest text-muted">Room code</p>
        <p className="mt-1 text-6xl font-bold tracking-[0.2em]">{view.code}</p>
        <button className="mt-4 text-sm text-accent underline" onClick={share}>
          Share the link
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <PlayerList players={view.players} compact />
      </div>

      {isHost ? (
        <button className="btn-primary" onClick={() => socket.send({ t: 'start' })} disabled={!canStart}>
          {canStart ? `Start ${view.roundsTotal} rounds` : 'Waiting for one more player'}
        </button>
      ) : (
        <p className="text-center text-muted">Waiting for the host to start.</p>
      )}
    </div>
  );
}
