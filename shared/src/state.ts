import type { Lang } from './config.js';

export type Phase = 'lobby' | 'round' | 'reveal' | 'scoreboard' | 'over';
export type RoundKind = 'bank' | 'turn';
export type TurnStep = 'pick' | 'compose' | 'guess';

export type PlayerState = {
  id: string;
  nick: string;
  seat: number;
  score: number;
  connected: boolean;
  joinedAt: number;
  disconnectedAt: number | null;
  /** Never leaves the server except once, in `hello`. SPEC §4.4. */
  resumeToken: string;
  /** Game-long tiebreak (SPEC §2.4) and turn-round rotation fairness. */
  firstCorrectAt: number | null;
  turnsGiven: number;
  joinedAtRound: number;
};

export type GuessState = { count: number; lastGuessAt: number; locked: boolean };

export type RoundResult = {
  playerId: string;
  role: 'guesser' | 'giver';
  correct: boolean;
  points: number;
  /** Time from the start of guessing to the correct guess. */
  ms: number | null;
  guess: string | null;
};

export type RoundState = {
  kind: RoundKind;
  step: TurnStep | null;
  puzzleId: string | null;
  candidateIds: string[];
  title: string;
  accept: string[];
  reject: string[];
  emoji: string[];
  category: string;
  categoryFull: string;
  shape: string;
  initials: string;
  hints: 0 | 1 | 2;
  giverId: string | null;
  startedAt: number;
  guessStartedAt: number | null;
  guessTotalMs: number;
  correct: { playerId: string; at: number; points: number; guess: string }[];
  guesses: Record<string, GuessState>;
  results: RoundResult[] | null;
};

export type GameState = {
  v: 1;
  code: string;
  lang: Lang;
  phase: Phase;
  roundNo: number;
  roundsTotal: number;
  gameNo: number;
  hostId: string | null;
  players: PlayerState[];
  /** Puzzle ids, shuffled once per game. SPEC §5.4. */
  deck: string[];
  round: RoundState | null;
  /** Server epoch ms for the end of the current phase. SPEC §3.4. */
  deadline: number | null;
  createdAt: number;
  lastActivityAt: number;
};

export function playerById(state: GameState, id: string | null): PlayerState | undefined {
  if (!id) return undefined;
  return state.players.find((p) => p.id === id);
}

export function connectedPlayers(state: GameState): PlayerState[] {
  return state.players.filter((p) => p.connected);
}

/** Everyone who is expected to answer this round: connected, not the giver. */
export function eligibleGuessers(state: GameState): PlayerState[] {
  const giverId = state.round?.giverId ?? null;
  return connectedPlayers(state).filter((p) => p.id !== giverId);
}
