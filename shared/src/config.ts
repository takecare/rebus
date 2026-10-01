/**
 * Every timing, limit and score weight in the game. SPEC §2.3 / §2.4.
 * Nothing else in the codebase is allowed to hardcode one of these.
 */
export const CONFIG = {
  PROTOCOL_VERSION: 1,

  MIN_PLAYERS: 2,
  MAX_PLAYERS: 10,
  MIN_PLAYERS_FOR_TURN_ROUND: 3,

  ROUNDS_DEFAULT: 9,
  ROUNDS_ALLOWED: [5, 9, 15],
  TURN_ROUND_EVERY: 3,

  BANK_GUESS_MS: 45_000,
  TURN_PICK_MS: 15_000,
  TURN_COMPOSE_MS: 60_000,
  TURN_GUESS_MS: 45_000,
  REVEAL_MS: 7_000,
  SCOREBOARD_MS: 6_000,

  HINT_1_AT_MS: 15_000,
  HINT_2_AT_MS: 28_000,

  GUESS_COOLDOWN_MS: 500,
  MAX_GUESSES_PER_ROUND: 25,
  GUESS_MAX_CHARS: 64,

  DISCONNECT_GRACE_MS: 45_000,
  ROOM_IDLE_MS: 30 * 60_000,

  /**
   * A deadline this far past with nothing new from the server means the alarm
   * behind it was missed. The client then says so and nudges the room. SPEC §7.6.
   */
  STALL_AFTER_MS: 10_000,
  /** How often a client re-nudges a room it believes is stalled. */
  STALL_NUDGE_MS: 3_000,

  /**
   * Practice-room bots (SPEC §7.3b, the /single page). A scripted player never
   * holds a socket and never sees a redacted view — it acts straight out of
   * the reducer's own, un-redacted state, the same trusted context the real
   * rules already run in.
   */
  BOT_COUNT: 2,
  /** Each bot's independent chance of ever locking in a guess this round. */
  BOT_GUESS_CHANCE: 0.7,
  /** A scripted action always lands at least this long after it is queued... */
  BOT_ACT_MIN_MS: 2_000,
  /** ...and at least this clear of the round's own deadline, as a margin. */
  BOT_ACT_MARGIN_MS: 2_000,

  NICK_MAX_CHARS: 12,
  CLUE_MIN_EMOJI: 1,
  CLUE_MAX_EMOJI: 8,
  CLUE_MAX_CODEPOINTS: 64,
  TURN_CANDIDATES: 3,

  SCORE_BASE: 100,
  SCORE_SPEED_MAX: 200,
  SCORE_ORDER_BONUS: [100, 50, 25],
  HINT_PENALTY: [1, 0.8, 0.6],
  GIVER_PER_GUESSER: 100,
  GIVER_CAP: 400,
} as const;

export type Lang = 'en';
