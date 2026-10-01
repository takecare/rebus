import {
  applyEvent,
  createGame,
  mulberry32,
  redact,
  type Effect,
  type GameEvent,
  type GameState,
  type ServerMsg,
} from '@rebus/shared';

/** Drives the reducer on a virtual clock, exactly like the Durable Object does. */
export class TestRoom {
  state: GameState;
  now: number;
  rng: () => number;
  outbox: { to: string; msg: ServerMsg }[] = [];
  alarm: number | null = null;
  destroyed = false;
  private seq = 0;

  constructor(opts: { seed?: number; now?: number; rounds?: number } = {}) {
    this.now = opts.now ?? 1_700_000_000_000;
    this.rng = mulberry32(opts.seed ?? 42);
    this.state = createGame({ code: 'ABCD', now: this.now, rng: this.rng, roundsTotal: opts.rounds });
  }

  send(event: GameEvent): Effect[] {
    const { state, effects } = applyEvent(this.state, event, { now: this.now, rng: this.rng });
    this.state = state;
    for (const fx of effects) {
      if (fx.kind === 'send') this.outbox.push({ to: fx.to, msg: fx.msg });
      if (fx.kind === 'setAlarm') this.alarm = fx.at;
      if (fx.kind === 'destroy') this.destroyed = true;
    }
    return effects;
  }

  join(nick: string): string {
    const playerId = `p${++this.seq}`;
    this.send({ type: 'join', playerId, resumeToken: `tok-${playerId}`, nick });
    return playerId;
  }

  /** `by` must be the current host — same requireHost gate the server enforces. */
  addBot(by: string): string {
    const botId = `bot${++this.seq}`;
    this.send({ type: 'addBot', playerId: by, botId });
    return botId;
  }

  guess(playerId: string, text: string): void {
    this.send({ type: 'guess', playerId, text });
  }

  /** Move time forward, firing the alarm whenever it comes due, as the DO does. */
  advanceBy(ms: number): void {
    const target = this.now + ms;
    let guard = 0;
    while (this.alarm !== null && this.alarm <= target && guard++ < 200) {
      this.now = Math.max(this.now, this.alarm);
      this.send({ type: 'tick' });
    }
    this.now = target;
  }

  /** Skip to just past the current phase deadline. */
  runOutClock(): void {
    const deadline = this.state.deadline;
    if (deadline === null) return;
    this.advanceBy(deadline - this.now + 1);
  }

  view(playerId: string) {
    return redact(this.state, playerId, this.now);
  }

  to(playerId: string): ServerMsg[] {
    return this.outbox.filter((m) => m.to === playerId || m.to === '*').map((m) => m.msg);
  }

  answer(): string {
    return this.state.round?.title ?? '';
  }

  score(playerId: string): number {
    return this.state.players.find((p) => p.id === playerId)?.score ?? 0;
  }
}
