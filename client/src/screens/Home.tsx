import { useEffect, useState } from 'react';
import { CODE_LENGTH, CONFIG, normalizeCode } from '@rebus/shared';
import { socket } from '../net/socket.js';
import { useStore } from '../state/store.js';

export function Home() {
  const [nick, setNick] = useState(() => localStorage.getItem('rebus:nick') ?? '');
  const [code, setCode] = useState(() => codeFromHash());
  const [rounds, setRounds] = useState(() => storedRounds());
  const [busy, setBusy] = useState(false);
  const setError = useStore((s) => s.setError);

  useEffect(() => {
    const onHash = () => setCode(codeFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const remember = () => localStorage.setItem('rebus:nick', nick.trim());

  const create = async () => {
    if (!nick.trim()) return setError('Pick a nickname first.');
    setBusy(true);
    try {
      remember();
      const newCode = await socket.createRoom(rounds);
      location.hash = `#/r/${newCode}`;
      socket.connect(newCode, nick.trim());
    } catch {
      setError('Could not open a room. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const join = () => {
    if (!nick.trim()) return setError('Pick a nickname first.');
    if (code.length !== CODE_LENGTH) return setError('A room code is four letters.');
    remember();
    location.hash = `#/r/${code}`;
    socket.connect(code, nick.trim());
  };

  return (
    <div className="flex flex-1 flex-col justify-center gap-8">
      <header className="text-center">
        <h1 className="text-4xl font-bold tracking-tight">Rebus</h1>
        <p className="mt-2 text-muted">Guess what the emoji mean. Faster than everyone else.</p>
      </header>

      <div className="flex flex-col gap-3">
        <input
          className="field"
          value={nick}
          onChange={(e) => setNick(e.target.value)}
          placeholder="Your name"
          maxLength={12}
          autoCapitalize="words"
          autoComplete="nickname"
          aria-label="Your name"
        />
        <div className="flex items-center justify-center gap-2" role="group" aria-label="Number of rounds">
          {CONFIG.ROUNDS_ALLOWED.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => {
                setRounds(n);
                localStorage.setItem('rebus:rounds', String(n));
              }}
              aria-pressed={n === rounds}
              className={`rounded-full border px-4 py-1.5 text-sm font-medium ${
                n === rounds ? 'border-accent text-white' : 'border-line text-muted'
              }`}
            >
              {n} rounds
            </button>
          ))}
        </div>
        <button className="btn-primary" onClick={create} disabled={busy}>
          Create a room
        </button>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3 text-sm text-muted">
          <span className="h-px flex-1 bg-line" />
          or join one
          <span className="h-px flex-1 bg-line" />
        </div>
        <input
          className="field text-center text-2xl font-semibold uppercase tracking-[0.4em]"
          value={code}
          onChange={(e) => setCode(normalizeCode(e.target.value))}
          placeholder="CODE"
          inputMode="text"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          aria-label="Room code"
        />
        <button className="btn-ghost" onClick={join}>
          Join
        </button>
      </div>
    </div>
  );
}

function codeFromHash(): string {
  const match = location.hash.match(/#\/r\/([A-Za-z0-9]+)/);
  return match ? normalizeCode(match[1]) : '';
}

/** The host's last choice, if it's still one of the valid lengths. */
function storedRounds(): (typeof CONFIG.ROUNDS_ALLOWED)[number] {
  const saved = Number(localStorage.getItem('rebus:rounds'));
  const allowed: readonly number[] = CONFIG.ROUNDS_ALLOWED;
  return allowed.includes(saved) ? (saved as (typeof CONFIG.ROUNDS_ALLOWED)[number]) : CONFIG.ROUNDS_DEFAULT;
}
