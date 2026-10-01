import type { GameStateView, PlayerView, RoundView } from './protocol.js';
import { PUZZLES } from './puzzles.js';
import type { GameState } from './state.js';

/**
 * The only function allowed to produce something the server can send.
 * SPEC §4.4 — the answer does not exist in a live round's payload, for anyone.
 */
export function redact(state: GameState, viewerId: string, now: number): GameStateView {
  const round = state.round;
  const revealing = state.phase === 'reveal' || state.phase === 'scoreboard' || state.phase === 'over';

  const players: PlayerView[] = state.players
    .slice()
    .sort((a, b) => a.seat - b.seat)
    .map((p) => ({
      id: p.id,
      nick: p.nick,
      score: p.score,
      connected: p.connected,
      isHost: state.hostId === p.id,
      isGiver: round?.giverId === p.id,
      isBot: p.isBot,
      locked: Boolean(round?.guesses[p.id]?.locked),
      roundPoints: round?.results?.find((r) => r.playerId === p.id)?.points ?? null,
    }));

  let view: RoundView | null = null;
  if (round) {
    const isGiver = round.giverId === viewerId;
    view = {
      kind: round.kind,
      step: round.step,
      emoji: round.emoji.slice(),
      category: round.hints >= 1 || revealing ? round.categoryFull : round.category,
      shape: round.shape,
      initials: round.hints >= 2 || revealing ? round.initials : null,
      hints: round.hints,
      giverId: round.giverId,
      guessTotalMs: round.guessTotalMs,
      guessStartedAt: round.guessStartedAt,
    };
    // The clue-giver is the only player who may see the title, and only while
    // they are writing the clue.
    if (isGiver && round.step === 'pick') {
      view.candidates = round.candidateIds.map(titleOf);
    }
    if (isGiver && round.title && !revealing) view.title = round.title;
    if (revealing) {
      view.answer = round.title;
      view.results = round.results ?? [];
      // During a turn round the shape is the only clue to a title nobody saw.
      view.initials = round.initials;
    }
  }

  return {
    code: state.code,
    phase: state.phase,
    roundNo: state.roundNo,
    roundsTotal: state.roundsTotal,
    gameNo: state.gameNo,
    hostId: state.hostId,
    youId: viewerId,
    players,
    deadline: state.deadline,
    serverTime: now,
    round: view,
  };
}

const TITLES: Record<string, string> = Object.fromEntries(PUZZLES.map((p) => [p.id, p.title]));

function titleOf(id: string): string {
  return TITLES[id] ?? id;
}
