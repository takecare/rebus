import { useState } from 'react';
import { CONFIG } from '@rebus/shared';
import { RoundsPicker, rememberRounds, storedRounds } from '../components/RoundsPicker.js';
import { socket } from '../net/socket.js';
import { useStore } from '../state/store.js';

/**
 * `/single`: a one-player practice room. It creates a room, joins as you, and
 * adds CONFIG.BOT_COUNT scripted players (SPEC §7.3b) — enough that
 * MIN_PLAYERS_FOR_TURN_ROUND is met without a second phone. From here on it
 * is the ordinary multiplayer path: the same Lobby, the same Round, the same
 * socket. This page only automates what a second and third player would
 * otherwise have had to do by hand.
 *
 * The rounds choice is the same RoundsPicker Home renders, not a second copy
 * of it — the two drifted out of sync once already (rounds became
 * configurable here, this page kept silently defaulting to 9) exactly
 * because the picker lived as Home's own local JSX instead of a shared
 * component. Sharing the component is what stops that from happening again.
 *
 * It does not auto-start the game — pressing Start is part of what the page
 * is for testing.
 */
export function SinglePractice() {
  const setError = useStore((s) => s.setError);
  const [rounds, setRounds] = useState(() => storedRounds());
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const start = async () => {
    setBusy(true);
    setStatus('Setting up a practice room…');
    try {
      rememberRounds(rounds);
      const nick = localStorage.getItem('rebus:nick') || 'You';
      const code = await socket.createRoom(rounds);
      location.hash = `#/r/${code}`;
      socket.connect(code, nick);

      setStatus('Adding practice players…');
      await waitForHello();
      for (let i = 0; i < CONFIG.BOT_COUNT; i++) socket.send({ t: 'addBot' });
    } catch {
      setBusy(false);
      setStatus(null);
      setError('Could not set up a practice room. Try again.');
    }
  };

  if (status) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <h1 className="text-2xl font-bold tracking-tight">Rebus — practice</h1>
        <p className="text-muted">{status}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col justify-center gap-8">
      <header className="text-center">
        <h1 className="text-2xl font-bold tracking-tight">Rebus — practice</h1>
        <p className="mt-2 text-muted">Play alone against {CONFIG.BOT_COUNT} scripted players.</p>
      </header>

      <div className="flex flex-col gap-3">
        <RoundsPicker
          value={rounds}
          onChange={(n) => {
            setRounds(n);
            rememberRounds(n);
          }}
        />
        <button className="btn-primary" onClick={start} disabled={busy}>
          Start practice
        </button>
      </div>
    </div>
  );
}

/** Resolves once `hello` has set our playerId — addBot needs us to be host. */
function waitForHello(): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (useStore.getState().playerId) return resolve();
      window.setTimeout(check, 100);
    };
    check();
  });
}
