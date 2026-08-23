import type { Lang } from './config.js';
import { CONFIG } from './config.js';
import { editDistance, normalize } from './match.js';
import { PUZZLE_BANK } from './puzzles.data.js';

export type Difficulty = 1 | 2 | 3;

export type Puzzle = {
  id: string;
  lang: Lang;
  category: string;
  categoryFull: string;
  title: string;
  aliases?: string[];
  reject?: string[];
  emoji: string[];
  difficulty: Difficulty;
  /** Renders very differently across platforms — usable, but never in round 1. */
  renderRisk?: boolean;
};

export const PUZZLES: Puzzle[] = PUZZLE_BANK;

export function puzzleById(id: string): Puzzle | undefined {
  return PUZZLES.find((p) => p.id === id);
}

export function acceptedForms(p: Puzzle): string[] {
  const forms = new Set<string>([normalize(p.title, p.lang)]);
  for (const a of p.aliases ?? []) forms.add(normalize(a, p.lang));
  forms.delete('');
  return [...forms];
}

export function rejectedForms(p: Puzzle): string[] {
  const accept = new Set(acceptedForms(p));
  return (p.reject ?? []).map((r) => normalize(r, p.lang)).filter((r) => r && !accept.has(r));
}

/**
 * A single emoji "item": a flag pair, a keycap, or a pictographic base with its
 * variation selectors, skin tones and ZWJ continuations. SPEC §5.5.
 */
const EMOJI_ITEM =
  /^(?:\p{RI}\p{RI}|[0-9#*]️?⃣|\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier}|[\u{E0020}-\u{E007F}])*(?:‍\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})*)*)$/u;

export function isEmojiItem(s: string): boolean {
  return EMOJI_ITEM.test(s);
}

export function validateClue(emoji: string[]): { ok: true } | { ok: false; reason: string } {
  if (!Array.isArray(emoji)) return { ok: false, reason: 'not_a_list' };
  if (emoji.length < CONFIG.CLUE_MIN_EMOJI) return { ok: false, reason: 'too_short' };
  if (emoji.length > CONFIG.CLUE_MAX_EMOJI) return { ok: false, reason: 'too_long' };
  let codepoints = 0;
  for (const item of emoji) {
    if (typeof item !== 'string' || !isEmojiItem(item)) return { ok: false, reason: 'not_emoji' };
    codepoints += [...item].length;
  }
  if (codepoints > CONFIG.CLUE_MAX_CODEPOINTS) return { ok: false, reason: 'too_long' };
  return { ok: true };
}

/** Runs in CI (SPEC §5.3). A bad bank is a bug, not a content problem. */
export function validatePuzzles(puzzles: readonly Puzzle[] = PUZZLES): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  const claimed = new Map<string, string>();

  for (const p of puzzles) {
    const where = p.id ?? '(no id)';
    if (!p.id) problems.push('a puzzle has no id');
    if (ids.has(p.id)) problems.push(`${where}: duplicate id`);
    ids.add(p.id);
    if (!p.title?.trim()) problems.push(`${where}: empty title`);
    if (!p.category?.trim()) problems.push(`${where}: empty category`);
    if (!p.categoryFull?.trim()) problems.push(`${where}: missing categoryFull (hint 1)`);
    if (![1, 2, 3].includes(p.difficulty)) problems.push(`${where}: difficulty out of range`);

    const clue = validateClue(p.emoji);
    if (!clue.ok) problems.push(`${where}: emoji rejected (${clue.reason})`);

    for (const form of acceptedForms(p)) {
      const owner = claimed.get(form);
      if (owner && owner !== p.id) problems.push(`${where}: "${form}" also answers ${owner}`);
      claimed.set(form, p.id);
    }
    for (const r of rejectedForms(p)) {
      const nearest = Math.min(...acceptedForms(p).map((f) => editDistance(r, f, 8)));
      if (nearest > 3) problems.push(`${where}: reject "${r}" is nowhere near the answer`);
    }
  }
  return problems;
}

/**
 * SPEC §5.4 — the deck is dealt on a difficulty ramp: rounds 1-3 easy, 4-6
 * easy/medium, 7+ medium/hard, falling back to whatever is left rather than
 * ever failing to deal.
 */
export function allowedDifficulty(roundNo: number): Difficulty[] {
  if (roundNo <= 3) return [1];
  if (roundNo <= 6) return [1, 2];
  return [2, 3];
}
