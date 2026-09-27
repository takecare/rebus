import { describe, expect, it } from 'vitest';
import {
  acceptedForms,
  allowedDifficulty,
  editDistance,
  isEmojiItem,
  PUZZLES,
  tolerance,
  validateClue,
  validatePuzzles,
} from '@rebus/shared';

describe('the shipped bank (SPEC §5.3)', () => {
  it('validates', () => expect(validatePuzzles()).toEqual([]));
  it('is the ~200 §5.4 asks for', () => expect(PUZZLES.length).toBeGreaterThanOrEqual(200));
  it('covers a spread of categories', () =>
    expect(new Set(PUZZLES.map((p) => p.category)).size).toBeGreaterThanOrEqual(8));

  // The deck deals rounds 1-3 from difficulty 1 alone and rounds 7+ from 2-3, so
  // a bank that is lopsided deals repeats long before it runs out. SPEC §5.4.
  it('can deal every rung of the difficulty ramp', () => {
    for (const round of [1, 4, 7, 12]) {
      const allowed = allowedDifficulty(round);
      const pool = PUZZLES.filter((p) => allowed.includes(p.difficulty));
      expect(pool.length, `round ${round} (difficulty ${allowed.join('/')})`).toBeGreaterThanOrEqual(30);
    }
  });

  // validatePuzzles() catches two puzzles answered by the *same* string. This is
  // the softer failure: two answers close enough that the fuzzy matcher cannot
  // tell which one a player meant, so one of them scores on the other's round.
  it('has no two answers the matcher could confuse', () => {
    const forms = PUZZLES.flatMap((p) => acceptedForms(p).map((f) => ({ id: p.id, f })));
    const ambiguous: string[] = [];
    for (let i = 0; i < forms.length; i++) {
      for (let j = i + 1; j < forms.length; j++) {
        if (forms[i].id === forms[j].id) continue;
        const d = editDistance(forms[i].f, forms[j].f, 8);
        if (d <= Math.max(tolerance(forms[i].f), tolerance(forms[j].f))) {
          ambiguous.push(`"${forms[i].f}" (${forms[i].id}) vs "${forms[j].f}" (${forms[j].id})`);
        }
      }
    }
    expect(ambiguous).toEqual([]);
  });

  it('gives every puzzle a hint-1 category line', () =>
    expect(PUZZLES.filter((p) => !p.categoryFull.includes('·')).map((p) => p.id)).toEqual([]));
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
