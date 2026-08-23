import { useEffect, useRef, useState } from 'react';
import { socket } from '../net/socket.js';
import { useStore } from '../state/store.js';

export function GuessInput({ disabled }: { disabled?: boolean }) {
  const [text, setText] = useState('');
  const result = useStore((s) => s.lastResult);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (result?.kind === 'wrong' || result?.kind === 'close') setText('');
  }, [result?.at, result?.kind]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const guess = text.trim();
    if (!guess) return;
    socket.send({ t: 'guess', text: guess });
    setText('');
    // Keep the keyboard up: the next guess should cost one tap, not two.
    inputRef.current?.focus();
  };

  const tone =
    result?.kind === 'correct' ? 'border-good' : result?.kind === 'close' ? 'border-warn' : '';

  return (
    <form onSubmit={submit} className="flex gap-2">
      <input
        ref={inputRef}
        className={`field flex-1 ${tone}`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={disabled ? 'Waiting…' : 'What is it?'}
        disabled={disabled}
        autoCapitalize="none"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="send"
        maxLength={64}
        aria-label="Your guess"
      />
      <button type="submit" className="btn-primary w-auto px-5" disabled={disabled}>
        Send
      </button>
    </form>
  );
}
