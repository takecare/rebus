import type { Lang } from './config.js';
import type { ServerMsg } from './protocol.js';

/**
 * Everything that can happen to a room. The Durable Object turns sockets and
 * alarms into these and does nothing else. SPEC §3.2.
 */
export type GameEvent =
  | { type: 'join'; playerId: string; resumeToken: string; nick: string; lang?: Lang }
  | { type: 'resume'; playerId: string; resumeToken: string }
  | { type: 'disconnect'; playerId: string }
  | { type: 'start'; playerId: string }
  | { type: 'guess'; playerId: string; text: string }
  | { type: 'pickTitle'; playerId: string; index: number }
  | { type: 'compose'; playerId: string; emoji: string[] }
  | { type: 'skipReveal'; playerId: string }
  | { type: 'rematch'; playerId: string }
  /** `botId` is minted by the server (room.ts), the same as a real join's id. */
  | { type: 'addBot'; playerId: string; botId: string }
  | { type: 'tick' };

export type Effect =
  /** Re-broadcast the redacted snapshot to every connected player. */
  | { kind: 'state' }
  | { kind: 'send'; to: string | '*'; msg: ServerMsg }
  | { kind: 'setAlarm'; at: number | null }
  | { kind: 'destroy' };

export type EventCtx = { now: number; rng: () => number };
