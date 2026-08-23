import { CONFIG } from './config.js';
import type { Lang } from './config.js';
import type { Effect, EventCtx, GameEvent } from './events.js';
import { answerShape, matchGuess } from './match.js';
import type { ErrorCode, ServerMsg } from './protocol.js';
import {
  acceptedForms,
  allowedDifficulty,
  puzzleById,
  PUZZLES,
  rejectedForms,
  validateClue,
} from './puzzles.js';
import type { Puzzle } from './puzzles.js';
import { shuffle } from './rng.js';
import { guessPoints, giverPoints } from './scoring.js';
import type { GameState, PlayerState, RoundResult, RoundState } from './state.js';
import { connectedPlayers, eligibleGuessers, playerById } from './state.js';

export type Reduced = { state: GameState; effects: Effect[] };

/* ------------------------------------------------------------------ setup */

export function createGame(opts: {
  code: string;
  lang?: Lang;
  roundsTotal?: number;
  now: number;
  rng: () => number;
}): GameState {
  const lang = opts.lang ?? 'en';
  const roundsTotal = CONFIG.ROUNDS_ALLOWED.includes(opts.roundsTotal as never)
    ? (opts.roundsTotal as number)
    : CONFIG.ROUNDS_DEFAULT;
  return {
    v: 1,
    code: opts.code,
    lang,
    phase: 'lobby',
    roundNo: 0,
    roundsTotal,
    gameNo: 1,
    hostId: null,
    players: [],
    deck: freshDeck(lang, opts.rng),
    round: null,
    deadline: null,
    createdAt: opts.now,
    lastActivityAt: opts.now,
  };
}

function freshDeck(lang: Lang, rng: () => number): string[] {
  return shuffle(
    PUZZLES.filter((p) => p.lang === lang),
    rng,
  ).map((p) => p.id);
}

/* ------------------------------------------------------------- the reducer */

export function applyEvent(state: GameState, event: GameEvent, ctx: EventCtx): Reduced {
  const s = clone(state);
  const fx: Effect[] = [];
  // A tick is the room's own heartbeat, not activity — if it counted, the
  // idle timeout in sweep() could never elapse.
  if (event.type !== 'tick') s.lastActivityAt = ctx.now;

  switch (event.type) {
    case 'join':
      onJoin(s, event, ctx, fx);
      break;
    case 'resume':
      onResume(s, event, fx);
      break;
    case 'disconnect':
      onDisconnect(s, event, ctx, fx);
      break;
    case 'start':
      onStart(s, event, ctx, fx);
      break;
    case 'guess':
      onGuess(s, event, ctx, fx);
      break;
    case 'pickTitle':
      onPickTitle(s, event, ctx, fx);
      break;
    case 'compose':
      onCompose(s, event, ctx, fx);
      break;
    case 'skipReveal':
      if (!requireHost(s, event.playerId, fx)) break;
      if (s.phase !== 'reveal') {
        fail(fx, event.playerId, 'not_now', 'Nothing to skip.');
        break;
      }
      advance(s, ctx, fx);
      break;
    case 'rematch':
      onRematch(s, event, ctx, fx);
      break;
    case 'tick':
      onTick(s, ctx, fx);
      break;
  }

  // The alarm always equals whatever the room is waiting for next. SPEC §3.3.
  const destroyed = fx.some((f) => f.kind === 'destroy');
  fx.push({ kind: 'setAlarm', at: destroyed ? null : nextAlarm(s, ctx.now) });
  return { state: s, effects: fx };
}

/* -------------------------------------------------------------- membership */

function onJoin(
  s: GameState,
  e: Extract<GameEvent, { type: 'join' }>,
  ctx: EventCtx,
  fx: Effect[],
): void {
  const nick = sanitizeNick(e.nick);
  if (!nick) return fail(fx, e.playerId, 'nick_required', 'Pick a nickname.');
  if (s.players.length >= CONFIG.MAX_PLAYERS) {
    return fail(fx, e.playerId, 'room_full', 'That room is full.');
  }
  // Joining the final round would be a podium entry with nothing behind it.
  if (s.phase !== 'lobby' && s.phase !== 'over' && s.roundNo >= s.roundsTotal) {
    return fail(fx, e.playerId, 'too_late', 'This game is on its last round — wait for the next.');
  }

  const player: PlayerState = {
    id: e.playerId,
    nick: dedupeNick(s, nick),
    seat: (s.players.at(-1)?.seat ?? -1) + 1,
    score: 0,
    connected: true,
    joinedAt: ctx.now,
    disconnectedAt: null,
    resumeToken: e.resumeToken,
    firstCorrectAt: null,
    turnsGiven: 0,
    joinedAtRound: s.roundNo,
  };
  s.players.push(player);
  if (!s.hostId) s.hostId = player.id;
  if (s.round) s.round.guesses[player.id] = { count: 0, lastGuessAt: 0, locked: false };

  fx.push({ kind: 'send', to: '*', msg: { t: 'event', kind: 'playerJoined', playerId: player.id, nick: player.nick } });
  fx.push({ kind: 'state' });
}

function onResume(s: GameState, e: Extract<GameEvent, { type: 'resume' }>, fx: Effect[]): void {
  const p = playerById(s, e.playerId);
  if (!p || p.resumeToken !== e.resumeToken) {
    return fail(fx, e.playerId, 'unknown_session', 'That seat is gone — join again.');
  }
  p.connected = true;
  p.disconnectedAt = null;
  if (!s.hostId) s.hostId = p.id;
  fx.push({ kind: 'state' });
}

function onDisconnect(
  s: GameState,
  e: Extract<GameEvent, { type: 'disconnect' }>,
  ctx: EventCtx,
  fx: Effect[],
): void {
  const p = playerById(s, e.playerId);
  if (!p || !p.connected) return;
  p.connected = false;
  p.disconnectedAt = ctx.now;

  // Host migration happens on the drop, not after the grace period, so the
  // start button is never stranded. SPEC §3.5.
  if (s.hostId === p.id) s.hostId = connectedPlayers(s).sort((a, b) => a.joinedAt - b.joinedAt)[0]?.id ?? null;

  // A giver who walks away must not cost everyone a minute of staring.
  if (s.phase === 'round' && s.round?.giverId === p.id && s.round.step !== 'guess') {
    abandonTurnRound(s, ctx, fx);
  } else if (s.phase === 'round' && everyoneAnswered(s)) {
    endRound(s, ctx, fx);
  }
  fx.push({ kind: 'send', to: '*', msg: { t: 'event', kind: 'playerLeft', playerId: p.id, nick: p.nick } });
  fx.push({ kind: 'state' });
}

/* ------------------------------------------------------------------- flow */

function onStart(
  s: GameState,
  e: Extract<GameEvent, { type: 'start' }>,
  ctx: EventCtx,
  fx: Effect[],
): void {
  if (!requireHost(s, e.playerId, fx)) return;
  if (s.phase !== 'lobby') return fail(fx, e.playerId, 'not_now', 'The game is already running.');
  if (connectedPlayers(s).length < CONFIG.MIN_PLAYERS) {
    return fail(fx, e.playerId, 'need_players', 'You need at least two players.');
  }
  startRound(s, ctx, 1, fx);
}

function onRematch(
  s: GameState,
  e: Extract<GameEvent, { type: 'rematch' }>,
  ctx: EventCtx,
  fx: Effect[],
): void {
  if (!requireHost(s, e.playerId, fx)) return;
  if (s.phase !== 'over') return fail(fx, e.playerId, 'not_now', 'The game is still going.');
  s.gameNo += 1;
  s.phase = 'lobby';
  s.roundNo = 0;
  s.round = null;
  s.deadline = null;
  s.deck = freshDeck(s.lang, ctx.rng);
  for (const p of s.players) {
    p.score = 0;
    p.firstCorrectAt = null;
    p.turnsGiven = 0;
    p.joinedAtRound = 0;
  }
  fx.push({ kind: 'state' });
}

function startRound(s: GameState, ctx: EventCtx, roundNo: number, fx: Effect[]): void {
  s.phase = 'round';
  s.roundNo = roundNo;

  const isTurn =
    roundNo % CONFIG.TURN_ROUND_EVERY === 0 &&
    connectedPlayers(s).length >= CONFIG.MIN_PLAYERS_FOR_TURN_ROUND;

  s.round = isTurn ? turnRound(s, ctx) : bankRound(s, ctx, roundNo);
  s.deadline =
    s.round.step === 'pick' ? ctx.now + CONFIG.TURN_PICK_MS : ctx.now + CONFIG.BANK_GUESS_MS;
  fx.push({ kind: 'state' });
}

function blankRound(s: GameState, ctx: EventCtx, kind: 'bank' | 'turn'): RoundState {
  const guesses: Record<string, { count: number; lastGuessAt: number; locked: boolean }> = {};
  for (const p of s.players) guesses[p.id] = { count: 0, lastGuessAt: 0, locked: false };
  return {
    kind,
    step: null,
    puzzleId: null,
    candidateIds: [],
    title: '',
    accept: [],
    reject: [],
    emoji: [],
    category: '',
    categoryFull: '',
    shape: '',
    initials: '',
    hints: 0,
    giverId: null,
    startedAt: ctx.now,
    guessStartedAt: null,
    guessTotalMs: CONFIG.BANK_GUESS_MS,
    correct: [],
    guesses,
    results: null,
  };
}

function bankRound(s: GameState, ctx: EventCtx, roundNo: number): RoundState {
  const round = blankRound(s, ctx, 'bank');
  const puzzle = draw(s, ctx, roundNo);
  applyPuzzle(round, puzzle);
  round.step = null;
  round.guessStartedAt = ctx.now;
  round.guessTotalMs = CONFIG.BANK_GUESS_MS;
  return round;
}

function turnRound(s: GameState, ctx: EventCtx): RoundState {
  const round = blankRound(s, ctx, 'turn');
  round.step = 'pick';
  const giver = nextGiver(s);
  round.giverId = giver.id;
  giver.turnsGiven += 1;
  for (let i = 0; i < CONFIG.TURN_CANDIDATES; i++) {
    round.candidateIds.push(draw(s, ctx, s.roundNo).id);
  }
  round.guessTotalMs = CONFIG.TURN_GUESS_MS;
  return round;
}

/** Fairest rotation that survives people leaving: fewest turns, then seat. */
function nextGiver(s: GameState): PlayerState {
  return connectedPlayers(s)
    .slice()
    .sort((a, b) => a.turnsGiven - b.turnsGiven || a.seat - b.seat)[0];
}

function applyPuzzle(round: RoundState, puzzle: Puzzle): void {
  round.puzzleId = puzzle.id;
  round.title = puzzle.title;
  round.accept = acceptedForms(puzzle);
  round.reject = rejectedForms(puzzle);
  round.emoji = puzzle.emoji.slice();
  round.category = puzzle.category;
  round.categoryFull = puzzle.categoryFull;
  round.shape = answerShape(puzzle.title);
  round.initials = answerShape(puzzle.title, true);
}

function draw(s: GameState, ctx: EventCtx, roundNo: number): Puzzle {
  if (s.deck.length === 0) s.deck = freshDeck(s.lang, ctx.rng);
  const wanted = allowedDifficulty(roundNo);
  let index = s.deck.findIndex((id) => {
    const p = puzzleById(id);
    return p && wanted.includes(p.difficulty);
  });
  if (index < 0) index = 0;
  const [id] = s.deck.splice(index, 1);
  const puzzle = puzzleById(id);
  // The deck only ever holds ids that came out of PUZZLES, so this is a
  // corrupted-storage path, not a gameplay one.
  if (!puzzle) return draw(s, ctx, roundNo);
  return puzzle;
}

/* ---------------------------------------------------------------- guessing */

function onGuess(
  s: GameState,
  e: Extract<GameEvent, { type: 'guess' }>,
  ctx: EventCtx,
  fx: Effect[],
): void {
  const round = s.round;
  const p = playerById(s, e.playerId);
  if (!p || !round || s.phase !== 'round') {
    return fail(fx, e.playerId, 'not_now', 'No round is running.');
  }
  if (round.kind === 'turn' && round.step !== 'guess') {
    return fail(fx, e.playerId, 'not_now', 'Nobody is guessing yet.');
  }
  if (round.giverId === p.id) return fail(fx, e.playerId, 'not_now', 'You wrote it.');

  const g = (round.guesses[p.id] ??= { count: 0, lastGuessAt: 0, locked: false });
  const reply = (kind: 'locked' | 'rate' | 'used'): void => {
    fx.push({ kind: 'send', to: p.id, msg: { t: 'guessResult', kind, text: e.text } });
  };
  if (g.locked) return reply('locked');
  if (ctx.now - g.lastGuessAt < CONFIG.GUESS_COOLDOWN_MS) return reply('rate');
  if (g.count >= CONFIG.MAX_GUESSES_PER_ROUND) return reply('used');

  g.count += 1;
  g.lastGuessAt = ctx.now;
  const text = e.text.slice(0, CONFIG.GUESS_MAX_CHARS);
  const verdict = matchGuess(text, { accept: round.accept, reject: round.reject }, s.lang);

  if (verdict !== 'correct') {
    fx.push({ kind: 'send', to: p.id, msg: { t: 'guessResult', kind: verdict, text } });
    fx.push({ kind: 'send', to: '*', msg: { t: 'event', kind: 'playerWrong', playerId: p.id } });
    return;
  }

  const position = round.correct.length;
  const points = guessPoints({
    remainingMs: (s.deadline ?? ctx.now) - ctx.now,
    totalMs: round.guessTotalMs,
    position,
    hints: round.hints,
  });
  g.locked = true;
  p.score += points;
  p.firstCorrectAt ??= ctx.now;
  round.correct.push({ playerId: p.id, at: ctx.now, points, guess: text });

  fx.push({ kind: 'send', to: p.id, msg: { t: 'guessResult', kind: 'correct', points, text } });
  fx.push({ kind: 'send', to: '*', msg: { t: 'event', kind: 'playerCorrect', playerId: p.id, position } });
  fx.push({ kind: 'state' });

  if (everyoneAnswered(s)) endRound(s, ctx, fx);
}

function everyoneAnswered(s: GameState): boolean {
  const round = s.round;
  if (!round) return false;
  if (round.kind === 'turn' && round.step !== 'guess') return false;
  const guessers = eligibleGuessers(s);
  if (guessers.length === 0) return true;
  return guessers.every((p) => round.guesses[p.id]?.locked);
}

/* ------------------------------------------------------------- turn rounds */

function onPickTitle(
  s: GameState,
  e: Extract<GameEvent, { type: 'pickTitle' }>,
  ctx: EventCtx,
  fx: Effect[],
): void {
  const round = s.round;
  if (!round || round.step !== 'pick') return fail(fx, e.playerId, 'not_now', 'Not right now.');
  if (round.giverId !== e.playerId) return fail(fx, e.playerId, 'not_giver', "It isn't your turn.");
  pickTitle(s, ctx, e.index, fx);
}

function pickTitle(s: GameState, ctx: EventCtx, index: number, fx: Effect[]): void {
  const round = s.round;
  if (!round) return;
  const id = round.candidateIds[index] ?? round.candidateIds[0];
  const puzzle = puzzleById(id);
  if (!puzzle) return;
  applyPuzzle(round, puzzle);
  round.emoji = [];
  round.step = 'compose';
  s.deadline = ctx.now + CONFIG.TURN_COMPOSE_MS;
  fx.push({ kind: 'state' });
}

function onCompose(
  s: GameState,
  e: Extract<GameEvent, { type: 'compose' }>,
  ctx: EventCtx,
  fx: Effect[],
): void {
  const round = s.round;
  if (!round || round.step !== 'compose') return fail(fx, e.playerId, 'not_now', 'Not right now.');
  if (round.giverId !== e.playerId) return fail(fx, e.playerId, 'not_giver', "It isn't your turn.");
  const check = validateClue(e.emoji);
  if (!check.ok) return fail(fx, e.playerId, 'bad_clue', 'Use between one and eight emoji.');

  round.emoji = e.emoji.slice();
  round.step = 'guess';
  round.guessStartedAt = ctx.now;
  round.guessTotalMs = CONFIG.TURN_GUESS_MS;
  s.deadline = ctx.now + CONFIG.TURN_GUESS_MS;
  fx.push({ kind: 'state' });
}

/** Giver gone or out of time with nothing composed: fall back to a bank round. */
function abandonTurnRound(s: GameState, ctx: EventCtx, fx: Effect[]): void {
  const giverId = s.round?.giverId ?? null;
  const giver = playerById(s, giverId);
  if (giver) giver.turnsGiven = Math.max(0, giver.turnsGiven - 1);
  s.round = bankRound(s, ctx, s.roundNo);
  s.deadline = ctx.now + CONFIG.BANK_GUESS_MS;
  fx.push({ kind: 'state' });
}

/* --------------------------------------------------------- ends of phases */

function endRound(s: GameState, ctx: EventCtx, fx: Effect[]): void {
  const round = s.round;
  if (!round) return;
  const results: RoundResult[] = [];

  for (const p of s.players) {
    if (p.id === round.giverId) continue;
    const hit = round.correct.find((c) => c.playerId === p.id);
    results.push({
      playerId: p.id,
      role: 'guesser',
      correct: Boolean(hit),
      points: hit?.points ?? 0,
      ms: hit && round.guessStartedAt ? hit.at - round.guessStartedAt : null,
      guess: hit?.guess ?? null,
    });
  }

  const giver = playerById(s, round.giverId);
  if (giver) {
    const points = giverPoints(round.correct.length);
    giver.score += points;
    results.push({ playerId: giver.id, role: 'giver', correct: false, points, ms: null, guess: null });
  }

  round.results = results;
  s.phase = 'reveal';
  s.deadline = ctx.now + CONFIG.REVEAL_MS;
  fx.push({ kind: 'state' });
}

function advance(s: GameState, ctx: EventCtx, fx: Effect[]): void {
  if (s.phase === 'reveal') {
    s.phase = 'scoreboard';
    s.deadline = ctx.now + CONFIG.SCOREBOARD_MS;
    fx.push({ kind: 'state' });
    return;
  }
  if (s.phase === 'scoreboard') {
    if (s.roundNo >= s.roundsTotal) {
      s.phase = 'over';
      s.deadline = null;
      fx.push({ kind: 'state' });
    } else {
      startRound(s, ctx, s.roundNo + 1, fx);
    }
  }
}

/* ------------------------------------------------------------------ timers */

function onTick(s: GameState, ctx: EventCtx, fx: Effect[]): void {
  sweep(s, ctx, fx);

  if (s.phase === 'round' && s.round) {
    const round = s.round;
    // Hints first: a hint that was due before the buzzer must not be skipped,
    // because the penalty a player already paid was computed from it.
    if (round.kind === 'bank' && round.guessStartedAt !== null) {
      const elapsed = ctx.now - round.guessStartedAt;
      if (round.hints < 1 && elapsed >= CONFIG.HINT_1_AT_MS) {
        round.hints = 1;
        fx.push({ kind: 'send', to: '*', msg: { t: 'event', kind: 'hint', level: 1 } });
        fx.push({ kind: 'state' });
      }
      if (round.hints < 2 && elapsed >= CONFIG.HINT_2_AT_MS) {
        round.hints = 2;
        fx.push({ kind: 'send', to: '*', msg: { t: 'event', kind: 'hint', level: 2 } });
        fx.push({ kind: 'state' });
      }
    }

    if (s.deadline !== null && ctx.now >= s.deadline) {
      if (round.step === 'pick') pickTitle(s, ctx, 0, fx);
      else if (round.step === 'compose') abandonTurnRound(s, ctx, fx);
      else endRound(s, ctx, fx);
    }
    return;
  }

  if ((s.phase === 'reveal' || s.phase === 'scoreboard') && s.deadline !== null && ctx.now >= s.deadline) {
    advance(s, ctx, fx);
  }
}

/** Drop players who are past the grace period; destroy an idle room. */
function sweep(s: GameState, ctx: EventCtx, fx: Effect[]): void {
  if (s.phase !== 'over') {
    const gone = s.players.filter(
      (p) => !p.connected && p.disconnectedAt !== null && ctx.now - p.disconnectedAt >= CONFIG.DISCONNECT_GRACE_MS,
    );
    if (gone.length > 0) {
      s.players = s.players.filter((p) => !gone.includes(p));
      if (!playerById(s, s.hostId)) s.hostId = connectedPlayers(s)[0]?.id ?? null;
      fx.push({ kind: 'state' });
    }
  }
  if (connectedPlayers(s).length === 0 && ctx.now - s.lastActivityAt >= CONFIG.ROOM_IDLE_MS) {
    fx.push({ kind: 'destroy' });
  }
}

/** The single next moment the room needs to wake up. SPEC §3.3. */
export function nextAlarm(s: GameState, now: number): number | null {
  const candidates: number[] = [];
  if (s.deadline !== null) candidates.push(s.deadline);
  if (s.phase === 'round' && s.round?.kind === 'bank' && s.round.guessStartedAt !== null) {
    if (s.round.hints < 1) candidates.push(s.round.guessStartedAt + CONFIG.HINT_1_AT_MS);
    if (s.round.hints < 2) candidates.push(s.round.guessStartedAt + CONFIG.HINT_2_AT_MS);
  }
  for (const p of s.players) {
    if (!p.connected && p.disconnectedAt !== null) {
      candidates.push(p.disconnectedAt + CONFIG.DISCONNECT_GRACE_MS);
    }
  }
  if (connectedPlayers(s).length === 0) candidates.push(s.lastActivityAt + CONFIG.ROOM_IDLE_MS);
  if (candidates.length === 0) return null;
  return Math.max(now + 50, Math.min(...candidates));
}

/* ------------------------------------------------------------------ bits */

function requireHost(s: GameState, playerId: string, fx: Effect[]): boolean {
  if (s.hostId !== playerId) {
    fail(fx, playerId, 'not_host', 'Only the host can do that.');
    return false;
  }
  return true;
}

function fail(fx: Effect[], to: string, code: ErrorCode, message: string): void {
  const msg: ServerMsg = { t: 'error', code, message };
  fx.push({ kind: 'send', to, msg });
}

export function sanitizeNick(raw: string): string {
  return (raw ?? '')
    .replace(/[\p{C}]/gu, '')
    .trim()
    .slice(0, CONFIG.NICK_MAX_CHARS)
    .trim();
}

function dedupeNick(s: GameState, nick: string): string {
  const taken = new Set(s.players.map((p) => p.nick.toLowerCase()));
  if (!taken.has(nick.toLowerCase())) return nick;
  for (let i = 2; i < 50; i++) {
    const candidate = `${nick} (${i})`.slice(0, CONFIG.NICK_MAX_CHARS + 4);
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return nick;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
