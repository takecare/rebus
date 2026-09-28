import { useEffect, useState } from 'react';
import { CONFIG } from '@rebus/shared';
import { socket } from '../net/socket.js';
import { serverNow, useStore } from './store.js';

/**
 * True when the current deadline went by long enough ago that the alarm behind it
 * must have been missed. SPEC §7.6.
 *
 * A Durable Object with no sockets talking to it and a lost alarm has nothing to
 * wake it, so the round would hang forever. While stalled this keeps pinging,
 * which wakes the object and makes it re-run its own deadline check. The server
 * treats a late `tick` the same as a punctual one, so nudging is safe to repeat.
 */
export function useStalled(): boolean {
  // The deadline identifies what we are waiting for: when the room moves on it
  // changes, the effect re-runs, and the stall clears on its own.
  const deadline = useStore((s) => s.view?.deadline ?? null);
  const [stalled, setStalled] = useState(false);

  useEffect(() => {
    setStalled(false);
    if (deadline === null) return;

    let timer = 0;
    const check = () => {
      const late = serverNow() - deadline;
      if (late < CONFIG.STALL_AFTER_MS) {
        // Re-check exactly when the grace period would run out.
        timer = window.setTimeout(check, CONFIG.STALL_AFTER_MS - late);
        return;
      }
      setStalled(true);
      socket.nudge();
      timer = window.setTimeout(check, CONFIG.STALL_NUDGE_MS);
    };
    check();

    return () => window.clearTimeout(timer);
  }, [deadline]);

  return stalled;
}
