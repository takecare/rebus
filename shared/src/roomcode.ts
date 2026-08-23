import type { Rng } from './rng.js';

/** No I, O, 0 or 1 — the code gets read aloud across a table. SPEC §2.1. */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 4;

export function generateCode(rng: Rng): string {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CODE_ALPHABET[Math.floor(rng() * CODE_ALPHABET.length)];
  }
  return out;
}

export function normalizeCode(input: string): string {
  // The alphabet has no I, O, 0 or 1, so there is nothing sane to map those to —
  // strip anything that is not a code character and let isValidCode reject the rest.
  return input
    .toUpperCase()
    .split('')
    .filter((ch) => CODE_ALPHABET.includes(ch))
    .join('')
    .slice(0, CODE_LENGTH);
}

export function isValidCode(code: string): boolean {
  if (code.length !== CODE_LENGTH) return false;
  for (const ch of code) if (!CODE_ALPHABET.includes(ch)) return false;
  return true;
}
