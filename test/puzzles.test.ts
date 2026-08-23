import { describe, expect, it } from 'vitest';
import { isEmojiItem, PUZZLES, validateClue, validatePuzzles } from '@rebus/shared';

describe('the shipped bank (SPEC §5.3)', () => {
  it('validates', () => expect(validatePuzzles()).toEqual([]));
  it('has enough puzzles for several games', () => expect(PUZZLES.length).toBeGreaterThanOrEqual(40));
  it('covers more than one category', () =>
    expect(new Set(PUZZLES.map((p) => p.category)).size).toBeGreaterThanOrEqual(5));
  it('has easy puzzles for the opening rounds', () =>
    expect(PUZZLES.filter((p) => p.difficulty === 1).length).toBeGreaterThanOrEqual(9));
});

describe('emoji validation (SPEC §5.5)', () => {
  it('accepts plain, variation-selected, flag, keycap and ZWJ emoji', () => {
    for (const e of ['🦁', '❄️', '🇰🇷', '1️⃣', '🧑‍🎤', '👍🏽']) expect(isEmojiItem(e)).toBe(true);
  });
  it('rejects text', () => {
    for (const e of ['a', 'lion', '🦁 the lion', '', ' ']) expect(isEmojiItem(e)).toBe(false);
  });
  it('rejects a clue that is text in disguise', () => {
    expect(validateClue(['spider'])).toEqual({ ok: false, reason: 'not_emoji' });
  });
  it('bounds the clue length', () => {
    expect(validateClue([])).toEqual({ ok: false, reason: 'too_short' });
    expect(validateClue(new Array(9).fill('🦁'))).toEqual({ ok: false, reason: 'too_long' });
    expect(validateClue(['🦁', '👑'])).toEqual({ ok: true });
  });
  it('stops a ZWJ bomb', () => {
    const bomb = new Array(40).fill('👩').join('‍');
    expect(validateClue([bomb]).ok).toBe(false);
  });
});
