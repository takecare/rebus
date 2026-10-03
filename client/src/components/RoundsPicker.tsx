import { CONFIG } from '@rebus/shared';

type RoundCount = (typeof CONFIG.ROUNDS_ALLOWED)[number];

/**
 * A row of pills, not a slider: CONFIG.ROUNDS_ALLOWED has exactly three valid
 * values, and a slider for three discrete stops is a worse button on mobile.
 *
 * Shared by Home (creating a normal room) and SinglePractice (the /single
 * bootstrap) so the two pickers cannot drift apart the way they already did
 * once — rounds became configurable on one screen and not the other simply
 * because this lived as one screen's local JSX instead of its own component.
 */
export function RoundsPicker({
  value,
  onChange,
}: {
  value: RoundCount;
  onChange: (n: RoundCount) => void;
}) {
  return (
    <div className="flex items-center justify-center gap-2" role="group" aria-label="Number of rounds">
      {CONFIG.ROUNDS_ALLOWED.map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          aria-pressed={n === value}
          className={`rounded-full border px-4 py-1.5 text-sm font-medium ${
            n === value ? 'border-accent text-white' : 'border-line text-muted'
          }`}
        >
          {n} rounds
        </button>
      ))}
    </div>
  );
}

/** The last choice made on either screen, if it's still one of the valid lengths. */
export function storedRounds(): RoundCount {
  const saved = Number(localStorage.getItem('rebus:rounds'));
  const allowed: readonly number[] = CONFIG.ROUNDS_ALLOWED;
  return allowed.includes(saved) ? (saved as RoundCount) : CONFIG.ROUNDS_DEFAULT;
}

export function rememberRounds(n: RoundCount): void {
  localStorage.setItem('rebus:rounds', String(n));
}
