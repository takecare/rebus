import type { PlayerView } from '@rebus/shared';
import { useStore } from '../state/store.js';

export function PlayerList({ players, compact }: { players: PlayerView[]; compact?: boolean }) {
  const flashes = useStore((s) => s.flashes);
  const youId = useStore((s) => s.view?.youId);

  return (
    <ul className="flex flex-col gap-2">
      {players.map((p) => {
        const flash = flashes.filter((f) => f.playerId === p.id).at(-1);
        const fresh = flash && Date.now() - flash.at < 1_200 ? flash.kind : null;
        return (
          <li
            key={p.id}
            className={`card flex items-center gap-3 px-4 py-3 ${
              fresh === 'correct' ? 'border-good' : fresh === 'wrong' ? 'border-bad' : ''
            } ${p.connected ? '' : 'opacity-40'}`}
          >
            <span className="flex-1 truncate font-medium">
              {p.nick}
              {p.id === youId && <span className="text-muted"> (you)</span>}
            </span>
            {p.isHost && <Tag>host</Tag>}
            {p.isBot && <Tag>bot</Tag>}
            {p.isGiver && <Tag>writing</Tag>}
            {p.locked && <span className="text-good" aria-label="answered">✓</span>}
            {!compact && <span className="w-14 text-right tabular-nums text-muted">{p.score}</span>}
          </li>
        );
      })}
    </ul>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-line px-2 py-0.5 text-xs uppercase tracking-wide text-muted">
      {children}
    </span>
  );
}
