import { describe, expect, it } from 'vitest';
import { answerShape, editDistance, matchGuess, normalize } from '@rebus/shared';

describe('normalize (SPEC §5.1)', () => {
  const rows: [string, string][] = [
    ['Spider-Man', 'spider man'],
    ['THE Matrix!!', 'matrix'],
    ['Amélie', 'amelie'],
    ['  finding   nemo ', 'finding nemo'],
    ["Sweet Child o' Mine", 'sweet child o mine'],
    ['Guns & Roses', 'guns and roses'],
    ['A Quiet Place', 'quiet place'],
    ['An Inspector Calls', 'inspector calls'],
    ['The', 'the'], // a bare article is not stripped into nothing
    ['🦁 The Lion King 🦁', 'lion king'],
  ];
  for (const [input, expected] of rows) {
    it(`${input} -> ${expected}`, () => expect(normalize(input)).toBe(expected));
  }
});

describe('editDistance', () => {
  it('counts a transposition as one', () => expect(editDistance('spiderman', 'spidreman')).toBe(1));
  it('bails out past the cutoff', () => expect(editDistance('a', 'abcdefghij', 2)).toBe(3));
  it('is zero for equal strings', () => expect(editDistance('titanic', 'titanic')).toBe(0));
});

describe('matchGuess (SPEC §5.2)', () => {
  const spiderman = { accept: ['spider man', 'spiderman'], reject: ['spider man 2', 'spider man 3'] };

  const correct = ['Spider-Man', 'spider man', 'SPIDERMAN', 'spidermam', 'spidreman', 'the spider man'];
  for (const g of correct) {
    it(`accepts "${g}"`, () => expect(matchGuess(g, spiderman)).toBe('correct'));
  }

  it('calls a bare prefix close, not correct', () => expect(matchGuess('spider', spiderman)).toBe('close'));
  it('refuses a sequel that the tolerance would have let through', () =>
    expect(matchGuess('spider man 2', spiderman)).toBe('close'));
  it('rejects something else entirely', () => expect(matchGuess('batman', spiderman)).toBe('wrong'));
  it('rejects an empty guess', () => expect(matchGuess('   ', spiderman)).toBe('wrong'));

  const shortAnswer = { accept: ['up'] };
  it('is exact for very short answers', () => {
    expect(matchGuess('up', shortAnswer)).toBe('correct');
    expect(matchGuess('ip', shortAnswer)).toBe('close');
  });

  const aliens = { accept: ['aliens'], reject: ['alien'] };
  it('keeps Alien away from Aliens', () => {
    expect(matchGuess('alien', aliens)).toBe('close');
    expect(matchGuess('aliens', aliens)).toBe('correct');
  });

  const longAnswer = { accept: ['the silence of the lambs'.replace(/^the /, '')] };
  it('is forgiving on long answers', () => {
    expect(matchGuess('silense of the lambs', longAnswer)).toBe('correct');
    expect(matchGuess('the silence of the lamb', longAnswer)).toBe('correct');
  });
});

describe('answerShape (SPEC §2.2)', () => {
  it('keeps punctuation and hides letters', () =>
    expect(answerShape('Spider-Man')).toBe('_ _ _ _ _ _ - _ _ _'));
  it('spaces words apart', () => expect(answerShape('Toy Story')).toBe('_ _ _   _ _ _ _ _'));
  it('reveals initials for hint 2', () =>
    expect(answerShape('Toy Story', true)).toBe('T _ _   S _ _ _ _'));
});
