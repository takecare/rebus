import { describe, expect, it } from 'vitest';
import { CONFIG, giverPoints, guessPoints } from '@rebus/shared';

const total = CONFIG.BANK_GUESS_MS;

describe('guessPoints (SPEC §2.4)', () => {
  it('is 400 for an instant first answer', () =>
    expect(guessPoints({ remainingMs: total, totalMs: total, position: 0, hints: 0 })).toBe(400));

  it('is 100 for a buzzer-beating answer with no bonus', () =>
    expect(guessPoints({ remainingMs: 0, totalMs: total, position: 3, hints: 0 })).toBe(100));

  it('drops with position', () => {
    const at = (position: number) => guessPoints({ remainingMs: total / 2, totalMs: total, position, hints: 0 });
    expect(at(0)).toBeGreaterThan(at(1));
    expect(at(1)).toBeGreaterThan(at(2));
    expect(at(2)).toBeGreaterThan(at(3));
    expect(at(3)).toBe(at(9));
  });

  it('charges for hints', () => {
    const base = guessPoints({ remainingMs: total, totalMs: total, position: 0, hints: 0 });
    expect(guessPoints({ remainingMs: total, totalMs: total, position: 0, hints: 1 })).toBe(Math.round(base * 0.8));
    expect(guessPoints({ remainingMs: total, totalMs: total, position: 0, hints: 2 })).toBe(Math.round(base * 0.6));
  });

  it('clamps a remaining time that overshoots the clock', () =>
    expect(guessPoints({ remainingMs: total * 3, totalMs: total, position: 0, hints: 0 })).toBe(400));

  it('never goes negative past the buzzer', () =>
    expect(guessPoints({ remainingMs: -5_000, totalMs: total, position: 0, hints: 2 })).toBe(120));
});

describe('giverPoints (SPEC §2.4)', () => {
  it('is zero when nobody got it', () => expect(giverPoints(0)).toBe(0));
  it('pays per guesser', () => expect(giverPoints(2)).toBe(200));
  it('caps out', () => {
    expect(giverPoints(4)).toBe(400);
    expect(giverPoints(9)).toBe(400);
  });
});
