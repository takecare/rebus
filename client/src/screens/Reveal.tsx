import { CONFIG, type GameStateView } from '@rebus/shared';
import { Countdown } from '../components/Countdown.js';
import { EmojiString } from '../components/EmojiString.js';
import { socket } from '../net/socket.js';

export function Reveal({ view }: { view: GameStateView }) {
  const round = view.round;
  if (!round) return null;
  const results = round.results ?? [];
  const got = results.filter((r) => r.correct);
  const isHost = view.hostId === view.youId;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <Countdown deadline={view.deadline} totalMs={CONFIG.REVEAL_MS} />
      <div className="flex flex-col items-center gap-3 pt-2">
        <EmojiString emoji={round.emoji} small />
        <p className="text-center text-3xl font-bold">{round.answer}</p>
        <p className="text-muted">
          {got.length === 0
            ? 'Nobody got it.'
            : `${got.length} of ${results.filter((r) => r.role === 'guesser').length} got it.`}
        </p>
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto">
        {results
          .slice()
          .sort((a, b) => b.points - a.points)
          .map((r) => {
            const player = view.players.find((p) => p.id === r.playerId);
            return (
              <li key={r.playerId} className="flex items-center gap-3 border-b border-line py-3">
                <span className="flex-1 truncate">
                  {player?.nick ?? 'Someone'}
                  {r.role === 'giver' && <span className="text-muted"> wrote it</span>}
                </span>
                {r.guess && <span className="max-w-[8rem] truncate text-sm text-muted">{r.guess}</span>}
                <span className={`w-16 text-right tabular-nums ${r.points > 0 ? 'text-good' : 'text-muted'}`}>
                  {r.points > 0 ? `+${r.points}` : '0'}
                </span>
              </li>
            );
          })}
      </ul>

      {isHost && (
        <button className="btn-ghost" onClick={() => socket.send({ t: 'skipReveal' })}>
          Next
        </button>
      )}
    </div>
  );
}
