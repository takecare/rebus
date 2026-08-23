import { useEffect, useState } from 'react';
import { CONFIG, type GameStateView } from '@rebus/shared';
import { Countdown } from '../components/Countdown.js';
import { EmojiPad } from '../components/EmojiPad.js';
import { EmojiString } from '../components/EmojiString.js';
import { GuessInput } from '../components/GuessInput.js';
import { socket } from '../net/socket.js';
import { useStore } from '../state/store.js';

export function Round({ view }: { view: GameStateView }) {
  const round = view.round;
  if (!round) return null;
  const you = view.players.find((p) => p.id === view.youId);
  const giver = view.players.find((p) => p.id === round.giverId);
  const isGiver = round.giverId === view.youId;

  if (round.step === 'pick') {
    return isGiver ? (
      <Pick view={view} />
    ) : (
      <Waiting title={`${giver?.nick ?? 'Someone'} is picking a title`} deadline={view.deadline} totalMs={CONFIG.TURN_PICK_MS} />
    );
  }

  if (round.step === 'compose') {
    return isGiver ? (
      <Compose view={view} />
    ) : (
      <Waiting title={`${giver?.nick ?? 'Someone'} is writing the emoji`} deadline={view.deadline} totalMs={CONFIG.TURN_COMPOSE_MS} />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <Header view={view} />
      <Countdown deadline={view.deadline} totalMs={round.guessTotalMs} />

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5">
        <EmojiString emoji={round.emoji} />
        <div className="text-center">
          <p className="text-sm uppercase tracking-widest text-muted">{round.category}</p>
          <p className="mt-2 font-mono text-lg tracking-widest text-white/80">
            {round.initials ?? round.shape}
          </p>
        </div>
        <Feedback locked={Boolean(you?.locked)} isGiver={isGiver} />
      </div>

      <AnsweredStrip view={view} />
      <GuessInput disabled={isGiver || Boolean(you?.locked)} />
    </div>
  );
}

function Header({ view }: { view: GameStateView }) {
  return (
    <div className="flex items-center justify-between text-sm text-muted">
      <span>
        Round {view.roundNo} of {view.roundsTotal}
      </span>
      <span>{view.round?.kind === 'turn' ? 'Player round' : 'Room ' + view.code}</span>
    </div>
  );
}

function Feedback({ locked, isGiver }: { locked: boolean; isGiver: boolean }) {
  const result = useStore((s) => s.lastResult);
  if (isGiver) return <p className="text-muted">You wrote this one. Sit tight.</p>;
  if (locked) {
    return (
      <p className="text-lg font-semibold text-good">
        Got it{result?.points ? ` — ${result.points} points` : ''}
      </p>
    );
  }
  if (result?.kind === 'close') return <p className="text-warn">So close. Try again.</p>;
  if (result?.kind === 'wrong') return <p className="text-muted">Not that one.</p>;
  if (result?.kind === 'rate') return <p className="text-muted">Slow down a touch.</p>;
  if (result?.kind === 'used') return <p className="text-muted">Out of guesses this round.</p>;
  return null;
}

function AnsweredStrip({ view }: { view: GameStateView }) {
  return (
    <ul className="flex flex-wrap gap-2 text-sm">
      {view.players.map((p) => (
        <li
          key={p.id}
          className={`rounded-full border px-3 py-1 ${
            p.locked ? 'border-good text-good' : 'border-line text-muted'
          } ${p.connected ? '' : 'opacity-40'}`}
        >
          {p.nick}
          {p.isGiver ? ' ✍️' : p.locked ? ' ✓' : ''}
        </li>
      ))}
    </ul>
  );
}

function Waiting({ title, deadline, totalMs }: { title: string; deadline: number | null; totalMs: number }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center gap-6 text-center">
      <p className="text-2xl font-semibold">{title}</p>
      <Countdown deadline={deadline} totalMs={totalMs} />
      <p className="text-muted">Get your thumbs ready.</p>
    </div>
  );
}

function Pick({ view }: { view: GameStateView }) {
  const candidates = view.round?.candidates ?? [];
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <Header view={view} />
      <Countdown deadline={view.deadline} totalMs={CONFIG.TURN_PICK_MS} />
      <p className="text-center text-xl font-semibold">Your turn. Pick one.</p>
      <div className="flex flex-col gap-3">
        {candidates.map((title, index) => (
          <button key={title} className="btn-ghost" onClick={() => socket.send({ t: 'pickTitle', index })}>
            {title}
          </button>
        ))}
      </div>
      <p className="text-center text-sm text-muted">
        Then you get {CONFIG.TURN_COMPOSE_MS / 1000} seconds to say it in emoji.
      </p>
    </div>
  );
}

function Compose({ view }: { view: GameStateView }) {
  const [tray, setTray] = useState<string[]>([]);
  const deadline = view.deadline;

  // SPEC 2.2: whatever is in the tray goes in when the clock runs out.
  useEffect(() => {
    if (deadline === null) return;
    const id = window.setTimeout(
      () => {
        if (tray.length > 0) socket.send({ t: 'compose', emoji: tray });
      },
      Math.max(0, deadline - Date.now() - 400),
    );
    return () => window.clearTimeout(id);
  }, [deadline, tray]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <Countdown deadline={deadline} totalMs={CONFIG.TURN_COMPOSE_MS} />
      <p className="text-center text-lg">
        Say <span className="font-semibold">{view.round?.title}</span> in emoji
      </p>
      <EmojiPad tray={tray} onChange={setTray} />
      <button
        className="btn-primary"
        disabled={tray.length < CONFIG.CLUE_MIN_EMOJI}
        onClick={() => socket.send({ t: 'compose', emoji: tray })}
      >
        Send the clue
      </button>
    </div>
  );
}
