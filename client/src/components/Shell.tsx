import { useStore } from '../state/store.js';

/** Full-height frame that respects the keyboard and shows connection state. */
export function Shell({ children }: { children: React.ReactNode }) {
  const status = useStore((s) => s.status);
  const error = useStore((s) => s.error);

  return (
    <div
      className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 pb-4 pt-3"
      style={{ height: 'var(--app-height)' }}
    >
      {status === 'reconnecting' && (
        <div className="rounded-xl bg-warn/15 px-3 py-2 text-center text-sm text-warn" role="status">
          Reconnecting…
        </div>
      )}
      {error && (
        <div className="rounded-xl bg-bad/15 px-3 py-2 text-center text-sm text-bad" role="alert">
          {error}
        </div>
      )}
      {children}
    </div>
  );
}
