import type { Lang } from './config.js';

/** SPEC §5.1 — the normalization pipeline, applied to guesses and answers alike. */
const ARTICLES: Record<Lang, string[]> = {
  en: ['the', 'a', 'an'],
};

const SEPARATORS = /['’‘`\-–—_/.,:;!?"“”()[\]]/g;

export function normalize(input: string, lang: Lang = 'en'): string {
  let s = input.normalize('NFKD').replace(/\p{M}+/gu, '');
  s = s.toLowerCase();
  s = s.replace(/&/g, ' and ');
  s = s.replace(SEPARATORS, ' ');
  s = s.replace(/[^a-z0-9 ]/g, ' ');
  s = s.trim().replace(/\s+/g, ' ');
  const [first, ...rest] = s.split(' ');
  if (rest.length > 0 && ARTICLES[lang].includes(first)) s = rest.join(' ');
  return s.trim().replace(/\s+/g, ' ');
}

/** Damerau–Levenshtein with a cutoff: we only ever care about small distances. */
export function editDistance(a: string, b: string, max = 4): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev2 = new Array<number>(b.length + 1);
  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  let prevPrev: number[] = prev2.fill(0);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prevPrev[j - 2] + 1);
      }
      curr[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    const spare = prevPrev;
    prevPrev = prev;
    prev = curr;
    curr = spare;
  }
  return prev[b.length];
}

/** SPEC §5.2 — tolerance scales with how much room for a typo the answer gives. */
export function tolerance(answer: string): number {
  const n = answer.length;
  if (n <= 4) return 0;
  if (n <= 8) return 1;
  if (n <= 14) return 2;
  return 3;
}

export type MatchTarget = {
  /** Normalized title + aliases. */
  accept: string[];
  /** Normalized near-misses that are actually a different answer. */
  reject?: string[];
};

export type MatchVerdict = 'correct' | 'close' | 'wrong';

export function matchGuess(raw: string, target: MatchTarget, lang: Lang = 'en'): MatchVerdict {
  const g = normalize(raw, lang);
  if (!g) return 'wrong';

  for (const form of target.accept) if (g === form) return 'correct';

  // A strict prefix of the answer is someone hedging, not someone answering.
  for (const form of target.accept) {
    if (form.startsWith(g) && g.length < form.length * 0.7) return 'close';
  }

  // Reject list wins over the tolerance: "Alien" must not take "Aliens".
  for (const bad of target.reject ?? []) {
    if (editDistance(g, bad) <= tolerance(bad)) return 'close';
  }

  let best = Infinity;
  let bestTol = 0;
  for (const form of target.accept) {
    const d = editDistance(g, form);
    if (d < best) {
      best = d;
      bestTol = tolerance(form);
    }
  }
  if (best <= bestTol) return 'correct';
  if (best <= bestTol + 1) return 'close';
  return 'wrong';
}

/** "_ _ _ _ _ _ - _ _ _" — the answer's shape, given away for free. SPEC §2.2. */
export function answerShape(title: string, revealInitials = false): string {
  return title
    .trim()
    .split(/\s+/)
    .map((word) =>
      Array.from(word)
        .map((ch, ci) => {
          if (!/[\p{L}\p{N}]/u.test(ch)) return ch;
          if (revealInitials && ci === 0) return ch.toUpperCase();
          return '_';
        })
        .join(' '),
    )
    .join('   ');
}
