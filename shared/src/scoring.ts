import { CONFIG } from './config.js';

/** SPEC §2.4 — bank/turn guesser points. */
export function guessPoints(opts: {
  remainingMs: number;
  totalMs: number;
  position: number; // 0-based, among correct guessers this round
  hints: 0 | 1 | 2;
}): number {
  const remaining = Math.max(0, Math.min(opts.remainingMs, opts.totalMs));
  const speed = Math.round((CONFIG.SCORE_SPEED_MAX * remaining) / opts.totalMs);
  const order = CONFIG.SCORE_ORDER_BONUS[opts.position] ?? 0;
  const penalty = CONFIG.HINT_PENALTY[opts.hints] ?? 1;
  return Math.round((CONFIG.SCORE_BASE + speed + order) * penalty);
}

/**
 * The clue-giver. Zero when nobody got it, capped when everybody did — the two
 * together aim the giver at a clue two or three people can crack. SPEC §2.4.
 */
export function giverPoints(correctGuessers: number): number {
  if (correctGuessers <= 0) return 0;
  return Math.min(CONFIG.GIVER_CAP, correctGuessers * CONFIG.GIVER_PER_GUESSER);
}
