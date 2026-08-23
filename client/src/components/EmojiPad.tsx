import { useState } from 'react';
import { CONFIG } from '@rebus/shared';
import { EMOJI_GROUPS } from '../lib/emoji.js';

export function EmojiPad({
  tray,
  onChange,
}: {
  tray: string[];
  onChange: (next: string[]) => void;
}) {
  const [group, setGroup] = useState(0);
  const full = tray.length >= CONFIG.CLUE_MAX_EMOJI;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="card flex min-h-[72px] flex-wrap items-center gap-1 p-3 text-3xl">
        {tray.length === 0 && <span className="text-base text-muted">Tap emoji to build your clue</span>}
        {tray.map((e, i) => (
          <button
            key={`${e}-${i}`}
            onClick={() => onChange(tray.filter((_, j) => j !== i))}
            aria-label={`Remove ${e}`}
            className="leading-none"
          >
            {e}
          </button>
        ))}
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {EMOJI_GROUPS.map((g, i) => (
          <button
            key={g.name}
            onClick={() => setGroup(i)}
            className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-sm ${
              i === group ? 'border-accent text-white' : 'border-line text-muted'
            }`}
          >
            {g.name}
          </button>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-6 gap-1 overflow-y-auto">
        {EMOJI_GROUPS[group].emoji.map((e) => (
          <button
            key={e}
            disabled={full}
            onClick={() => onChange([...tray, e])}
            className="flex h-12 items-center justify-center rounded-xl text-2xl active:bg-line disabled:opacity-30"
            aria-label={`Add ${e}`}
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}
