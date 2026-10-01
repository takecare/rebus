import { useEffect, useRef, useState } from 'react';
import { CONFIG } from '@rebus/shared';
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
 * It does not auto-start the game — pressing Start is part of what the page
 * is for testing.
 */
export function SinglePractice() {
  const setError = useStore((s) => s.setError);
  const startedRef = useRef(false);
  const [status, setStatus] = useState('Setting up a practice room…');

  useEffect(() => {
    // StrictMode mounts, cleans up and mounts again in development; `startedRef`
    // (not the cleanup) is what must make this run exactly once, because the
    // room it creates is real the instant createRoom() returns — there is
    // nothing to "cancel" partway through, only a setup left half-finished.
    if (startedRef.current) return;
    startedRef.current = true;

    (async () => {
      try {
        const nick = localStorage.getItem('rebus:nick') || 'You';
        const code = await socket.createRoom();
        location.hash = `#/r/${code}`;
        socket.connect(code, nick);

        setStatus('Adding practice players…');
        await waitForHello();
        for (let i = 0; i < CONFIG.BOT_COUNT; i++) socket.send({ t: 'addBot' });
      } catch {
        setError('Could not set up a practice room. Try again.');
      }
    })();
  }, [setError]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <h1 className="text-2xl font-bold tracking-tight">Rebus — practice</h1>
      <p className="text-muted">{status}</p>
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
