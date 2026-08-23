import { CONFIG, type GameStateView } from '@rebus/shared';
import { Countdown } from '../components/Countdown.js';

export function Scoreboard({ view }: { view: GameStateView }) {
  const ranked = [...view.players].sort((a, b) => b.score - a.score);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <Countdown deadline={view.deadline} totalMs={CONFIG.SCOREBOARD_MS} />
      <h2 className="text-center text-sm uppercase tracking-widest text-muted">
        After round {view.roundNo}
      </h2>
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {ranked.map((p, i) => (
          <li
            key={p.id}
            className={`flex items-center gap-3 border-b border-line py-4 ${
              p.id === view.youId ? 'text-white' : 'text-white/80'
            }`}
            style={{ transition: 'transform 300ms ease' }}
          >
            <span className="w-6 text-muted tabular-nums">{i + 1}</span>
            <span className="flex-1 truncate">{p.nick}</span>
            {p.roundPoints !== null && p.roundPoints > 0 && (
              <span className="text-sm text-good">+{p.roundPoints}</span>
            )}
            <span className="w-16 text-right text-lg font-semibold tabular-nums">{p.score}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
