import { CONFIG } from './config.js';
import type { Lang } from './config.js';
import type { Phase, RoundKind, RoundResult, TurnStep } from './state.js';

export const PROTOCOL_VERSION = CONFIG.PROTOCOL_VERSION;

export type ClientMsg =
  | { t: 'join'; nick: string; lang?: Lang }
  | { t: 'resume'; playerId: string; resumeToken: string }
  | { t: 'start' }
  | { t: 'guess'; text: string }
  | { t: 'pickTitle'; index: number }
  | { t: 'compose'; emoji: string[] }
  | { t: 'skipReveal' }
  | { t: 'rematch' }
  | { t: 'ping'; t0: number }
  | { t: 'addBot' };

export type GuessKind = 'correct' | 'close' | 'wrong' | 'rate' | 'used' | 'locked';

export type ServerMsg =
  | { t: 'hello'; playerId: string; resumeToken: string; protocol: number; serverTime: number }
  | { t: 'state'; state: GameStateView }
  | { t: 'guessResult'; kind: GuessKind; points?: number; text: string }
  | { t: 'event'; kind: 'playerCorrect'; playerId: string; position: number }
  | { t: 'event'; kind: 'playerWrong'; playerId: string }
  | { t: 'event'; kind: 'playerJoined' | 'playerLeft'; playerId: string; nick: string }
  | { t: 'event'; kind: 'hint'; level: 1 | 2 }
  | { t: 'error'; code: ErrorCode; message: string }
  | { t: 'pong'; t0: number; serverTime: number };

export type ErrorCode =
  | 'bad_message'
  | 'room_full'
  | 'room_not_found'
  | 'nick_required'
  | 'unknown_session'
  | 'not_host'
  | 'not_giver'
  | 'not_now'
  | 'too_late'
  | 'need_players'
  | 'bad_clue'
  | 'protocol_mismatch';

export type PlayerView = {
  id: string;
  nick: string;
  score: number;
  connected: boolean;
  isHost: boolean;
  isGiver: boolean;
  isBot: boolean;
  locked: boolean;
  roundPoints: number | null;
};

export type RoundView = {
  kind: RoundKind;
  step: TurnStep | null;
  emoji: string[];
  category: string;
  shape: string;
  initials: string | null;
  hints: 0 | 1 | 2;
  giverId: string | null;
  guessTotalMs: number;
  guessStartedAt: number | null;
  /** Giver only, during pick. */
  candidates?: string[];
  /** Giver only, from pick onwards. */
  title?: string;
  /** Reveal only. */
  answer?: string;
  results?: RoundResult[];
};

export type GameStateView = {
  code: string;
  phase: Phase;
  roundNo: number;
  roundsTotal: number;
  gameNo: number;
  hostId: string | null;
  youId: string;
  players: PlayerView[];
  deadline: number | null;
  serverTime: number;
  round: RoundView | null;
};
