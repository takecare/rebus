import { useEffect, useState } from 'react';
import { serverNow } from '../state/store.js';

/** Renders the server's deadline against our clock offset. SPEC 3.4. */
export function Countdown({ deadline, totalMs }: { deadline: number | null; totalMs: number }) {
  const [remaining, setRemaining] = useState(() => remainingFrom(deadline));

  useEffect(() => {
    if (deadline === null) return;
    let raf = 0;
    const tick = () => {
      setRemaining(remainingFrom(deadline));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [deadline]);

  if (deadline === null) return null;
  const fraction = Math.max(0, Math.min(1, remaining / totalMs));
  const seconds = Math.ceil(remaining / 1000);
  const urgent = remaining <= 10_000;

  return (
    <div className="flex items-center gap-3" aria-live="off">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
        <div
          className={`h-full rounded-full ${urgent ? 'bg-warn' : 'bg-accent'}`}
          style={{ width: `${fraction * 100}%`, transition: 'width 120ms linear' }}
        />
      </div>
      {urgent && (
        <span className="w-8 text-right text-sm font-semibold tabular-nums text-warn">
          {Math.max(0, seconds)}
        </span>
      )}
    </div>
  );
}

function remainingFrom(deadline: number | null): number {
  if (deadline === null) return 0;
  return Math.max(0, deadline - serverNow());
}
