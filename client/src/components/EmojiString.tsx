export function EmojiString({ emoji, small }: { emoji: string[]; small?: boolean }) {
  return (
    <div
      className={`flex flex-wrap items-center justify-center gap-1 text-center leading-none ${
        small ? 'text-3xl' : 'text-[clamp(2.5rem,14vh,5rem)]'
      }`}
      role="img"
      aria-label={`Emoji clue: ${emoji.join(', ')}`}
    >
      {emoji.map((e, i) => (
        <span key={`${e}-${i}`}>{e}</span>
      ))}
    </div>
  );
}
