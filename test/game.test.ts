import { beforeEach, describe, expect, it } from 'vitest';
import { CONFIG, type GameEvent } from '@rebus/shared';
import { TestRoom } from './harness.js';

describe('lobby (SPEC 2.1)', () => {
  it('makes the first player host and lets nobody else start', () => {
    const room = new TestRoom();
    const ana = room.join('Ana');
    const bo = room.join('Bo');
    expect(room.state.hostId).toBe(ana);

    room.send({ type: 'start', playerId: bo });
    expect(room.state.phase).toBe('lobby');
    expect(room.to(bo).at(-1)).toMatchObject({ t: 'error', code: 'not_host' });

    room.send({ type: 'start', playerId: ana });
    expect(room.state.phase).toBe('round');
  });

  it('refuses to start with one player', () => {
    const room = new TestRoom();
    const ana = room.join('Ana');
    room.send({ type: 'start', playerId: ana });
    expect(room.state.phase).toBe('lobby');
    expect(room.to(ana).at(-1)).toMatchObject({ code: 'need_players' });
  });

  it('deduplicates nicknames and caps the room', () => {
    const room = new TestRoom();
    room.join('Ana');
    room.join('Ana');
    expect(room.state.players[1].nick).toBe('Ana (2)');
    for (let i = 0; i < CONFIG.MAX_PLAYERS; i++) room.join(`P${i}`);
    expect(room.state.players.length).toBe(CONFIG.MAX_PLAYERS);
  });
});

describe('a bank round (SPEC 2.2)', () => {
  let room: TestRoom;
  let ana: string;
  let bo: string;
  let cy: string;

  beforeEach(() => {
    room = new TestRoom({ rounds: 5 });
    ana = room.join('Ana');
    bo = room.join('Bo');
    cy = room.join('Cy');
    room.send({ type: 'start', playerId: ana });
  });

  it('deals emoji and a shape but never the answer', () => {
    const view = room.view(bo);
    expect(view.round?.emoji.length).toBeGreaterThan(0);
    expect(view.round?.shape).toMatch(/_/);
    expect(view.round?.answer).toBeUndefined();
    expect(JSON.stringify(view)).not.toContain(room.answer());
  });

  it('scores by speed and by order, and locks a correct player out', () => {
    room.advanceBy(2_000);
    room.guess(ana, room.answer());
    room.advanceBy(5_000);
    room.guess(bo, room.answer());

    expect(room.score(ana)).toBeGreaterThan(room.score(bo));

    const before = room.score(ana);
    room.guess(ana, room.answer());
    expect(room.score(ana)).toBe(before);
  });

  it('costs nothing to be wrong, but the guesses are counted', () => {
    room.guess(bo, 'definitely not that');
    expect(room.score(bo)).toBe(0);
    expect(room.state.round?.guesses[bo].count).toBe(1);
    expect(room.to(bo).at(-2)).toMatchObject({ t: 'guessResult', kind: 'wrong' });
  });

  it('rate-limits a thumb that is too fast, and caps a whole round', () => {
    room.guess(bo, 'one');
    room.guess(bo, 'two');
    expect(room.to(bo).at(-1)).toMatchObject({ t: 'guessResult', kind: 'rate' });
    expect(room.state.round?.guesses[bo].count).toBe(1);

    for (let i = 0; i < CONFIG.MAX_GUESSES_PER_ROUND + 2; i++) {
      room.advanceBy(CONFIG.GUESS_COOLDOWN_MS + 1);
      room.guess(bo, `guess ${i}`);
    }
    expect(room.state.round?.guesses[bo].count).toBe(CONFIG.MAX_GUESSES_PER_ROUND);
    expect(room.to(bo).at(-1)).toMatchObject({ t: 'guessResult', kind: 'used' });
  });

  it('reveals two hints on the clock and charges for them', () => {
    room.advanceBy(CONFIG.HINT_1_AT_MS + 10);
    expect(room.state.round?.hints).toBe(1);
    expect(room.view(bo).round?.category).toBe(room.state.round?.categoryFull);
    expect(room.view(bo).round?.initials).toBeNull();

    room.advanceBy(CONFIG.HINT_2_AT_MS - CONFIG.HINT_1_AT_MS);
    expect(room.state.round?.hints).toBe(2);
    expect(room.view(bo).round?.initials).toMatch(/[A-Z]/);

    room.guess(cy, room.answer());
    expect(room.score(cy)).toBeLessThan(400 * 0.6 + 1);
  });

  it('ends early once everyone connected has answered', () => {
    for (const p of [ana, bo, cy]) {
      room.advanceBy(CONFIG.GUESS_COOLDOWN_MS + 1);
      room.guess(p, room.answer());
    }
    expect(room.state.phase).toBe('reveal');
    expect(room.view(bo).round?.answer).toBe(room.state.round?.title);
    expect(room.state.round?.results).toHaveLength(3);
  });

  it('ends on the clock when nobody answers, scoring nothing', () => {
    room.runOutClock();
    expect(room.state.phase).toBe('reveal');
    expect(room.state.round?.results?.every((r) => r.points === 0)).toBe(true);
  });

  it('walks reveal, scoreboard and the next round on its own', () => {
    room.runOutClock();
    expect(room.state.phase).toBe('reveal');
    room.runOutClock();
    expect(room.state.phase).toBe('scoreboard');
    room.runOutClock();
    expect(room.state.phase).toBe('round');
    expect(room.state.roundNo).toBe(2);
  });

  it('lets the host skip the reveal', () => {
    room.runOutClock();
    room.send({ type: 'skipReveal', playerId: bo });
    expect(room.state.phase).toBe('reveal');
    room.send({ type: 'skipReveal', playerId: ana });
    expect(room.state.phase).toBe('scoreboard');
  });
});

describe('a turn round (SPEC 2.2)', () => {
  function roomAtRound3() {
    const room = new TestRoom({ rounds: 9 });
    const ids = ['Ana', 'Bo', 'Cy'].map((n) => room.join(n));
    room.send({ type: 'start', playerId: ids[0] });
    while (room.state.roundNo < 3 || room.state.phase !== 'round') room.runOutClock();
    return { room, ids };
  }

  it('lands on round 3 with a giver who alone sees the titles', () => {
    const { room, ids } = roomAtRound3();
    const round = room.state.round!;
    expect(round.kind).toBe('turn');
    expect(round.step).toBe('pick');
    const giver = round.giverId!;
    const other = ids.find((id) => id !== giver)!;
    expect(room.view(giver).round?.candidates).toHaveLength(CONFIG.TURN_CANDIDATES);
    expect(room.view(other).round?.candidates).toBeUndefined();
    expect(room.view(other).round?.title).toBeUndefined();
  });

  it('runs pick, compose and guess, and pays the giver per guesser', () => {
    const { room, ids } = roomAtRound3();
    const giver = room.state.round!.giverId!;
    const guessers = ids.filter((id) => id !== giver);

    room.send({ type: 'pickTitle', playerId: giver, index: 1 });
    expect(room.state.round?.step).toBe('compose');
    expect(room.view(giver).round?.title).toBeTruthy();

    room.send({ type: 'compose', playerId: giver, emoji: ['A', 'B'].map((x) => (x === 'A' ? '\u{1F981}' : '\u{1F451}')) });
    expect(room.state.round?.step).toBe('guess');
    expect(room.view(guessers[0]).round?.emoji).toHaveLength(2);

    room.send({ type: 'guess', playerId: giver, text: room.answer() });
    expect(room.score(giver)).toBe(0);

    room.guess(guessers[0], room.answer());
    room.advanceBy(CONFIG.GUESS_COOLDOWN_MS + 1);
    room.guess(guessers[1], room.answer());

    expect(room.state.phase).toBe('reveal');
    expect(room.score(giver)).toBe(200);
    expect(room.state.round?.results?.find((r) => r.playerId === giver)?.role).toBe('giver');
  });

  it('gives the giver nothing when nobody guesses', () => {
    const { room } = roomAtRound3();
    const giver = room.state.round!.giverId!;
    room.send({ type: 'pickTitle', playerId: giver, index: 0 });
    room.send({ type: 'compose', playerId: giver, emoji: ['\u{1F954}'] });
    room.runOutClock();
    expect(room.state.phase).toBe('reveal');
    expect(room.score(giver)).toBe(0);
  });

  it('refuses a clue that is not emoji', () => {
    const { room } = roomAtRound3();
    const giver = room.state.round!.giverId!;
    room.send({ type: 'pickTitle', playerId: giver, index: 0 });
    room.send({ type: 'compose', playerId: giver, emoji: ['spider man'] });
    expect(room.state.round?.step).toBe('compose');
    expect(room.to(giver).at(-1)).toMatchObject({ code: 'bad_clue' });
  });

  it('auto-picks when the giver stalls, then falls back to a bank round', () => {
    const { room } = roomAtRound3();
    room.runOutClock();
    expect(room.state.round?.step).toBe('compose');
    room.runOutClock();
    expect(room.state.round?.kind).toBe('bank');
    expect(room.state.round?.emoji.length).toBeGreaterThan(0);
    expect(room.state.phase).toBe('round');
  });

  it('degrades to a bank round with only two players', () => {
    const room = new TestRoom({ rounds: 9 });
    const ana = room.join('Ana');
    room.join('Bo');
    room.send({ type: 'start', playerId: ana });
    while (room.state.roundNo < 3 || room.state.phase !== 'round') room.runOutClock();
    expect(room.state.round?.kind).toBe('bank');
  });
});

describe('disconnects (SPEC 3.5)', () => {
  it('migrates the host immediately and keeps the seat warm', () => {
    const room = new TestRoom({ rounds: 5 });
    const ana = room.join('Ana');
    const bo = room.join('Bo');
    room.send({ type: 'start', playerId: ana });
    room.guess(ana, room.answer());
    const scored = room.score(ana);

    room.send({ type: 'disconnect', playerId: ana });
    expect(room.state.hostId).toBe(bo);
    expect(room.state.players.find((p) => p.id === ana)?.connected).toBe(false);

    room.advanceBy(5_000);
    room.send({ type: 'resume', playerId: ana, resumeToken: `tok-${ana}` });
    expect(room.state.players.find((p) => p.id === ana)?.connected).toBe(true);
    expect(room.score(ana)).toBe(scored);
    expect(room.state.hostId).toBe(bo);
  });

  it('refuses a resume with the wrong token', () => {
    const room = new TestRoom();
    const ana = room.join('Ana');
    room.send({ type: 'disconnect', playerId: ana });
    room.send({ type: 'resume', playerId: ana, resumeToken: 'nope' });
    expect(room.to(ana).at(-1)).toMatchObject({ code: 'unknown_session' });
  });

  it('does not wait for a disconnected player to answer', () => {
    const room = new TestRoom({ rounds: 5 });
    const ana = room.join('Ana');
    const bo = room.join('Bo');
    room.send({ type: 'start', playerId: ana });
    room.guess(ana, room.answer());
    expect(room.state.phase).toBe('round');
    room.send({ type: 'disconnect', playerId: bo });
    expect(room.state.phase).toBe('reveal');
  });

  it('drops a player who never comes back, and hands the room over', () => {
    const room = new TestRoom({ rounds: 5 });
    const ana = room.join('Ana');
    const bo = room.join('Bo');
    room.send({ type: 'start', playerId: ana });
    room.send({ type: 'disconnect', playerId: ana });
    room.advanceBy(CONFIG.DISCONNECT_GRACE_MS + 1_000);
    expect(room.state.players.map((p) => p.id)).toEqual([bo]);
    expect(room.state.hostId).toBe(bo);
  });

  it('destroys a room nobody is in', () => {
    const room = new TestRoom();
    const ana = room.join('Ana');
    room.send({ type: 'disconnect', playerId: ana });
    room.advanceBy(CONFIG.ROOM_IDLE_MS + 1_000);
    expect(room.destroyed).toBe(true);
  });

  it('hands a stalled turn round back to the bank when the giver vanishes', () => {
    const room = new TestRoom({ rounds: 9 });
    const ids = ['Ana', 'Bo', 'Cy'].map((n) => room.join(n));
    room.send({ type: 'start', playerId: ids[0] });
    while (room.state.roundNo < 3 || room.state.phase !== 'round') room.runOutClock();
    const giver = room.state.round!.giverId!;
    room.send({ type: 'disconnect', playerId: giver });
    expect(room.state.round?.kind).toBe('bank');
    expect(room.state.phase).toBe('round');
  });
});

describe('a whole game (SPEC 7.7, phase 0 exit)', () => {
  it('plays nine rounds, three of them turn rounds, and ends on a podium', () => {
    const room = new TestRoom({ rounds: 9, seed: 7 });
    const ids = ['Ana', 'Bo', 'Cy', 'Di'].map((n) => room.join(n));
    room.send({ type: 'start', playerId: ids[0] });

    const kinds: string[] = [];
    const givers: string[] = [];
    let guard = 0;
    while (room.state.phase !== 'over' && guard++ < 200) {
      if (room.state.phase === 'round') {
        const round = room.state.round!;
        if (round.step === 'pick') {
          room.send({ type: 'pickTitle', playerId: round.giverId!, index: 0 });
          room.send({ type: 'compose', playerId: round.giverId!, emoji: ['\u{1F981}', '\u{1F451}'] });
        }
        if (kinds.length < room.state.roundNo) {
          kinds.push(round.kind);
          if (round.giverId) givers.push(round.giverId);
        }
        // Everyone but one player gets it, and the one who misses rotates.
        room.advanceBy(1_000);
        const guessers = ids.filter((id) => id !== room.state.round!.giverId);
        const missing = room.state.roundNo % guessers.length;
        guessers.forEach((id, i) => {
          room.advanceBy(CONFIG.GUESS_COOLDOWN_MS + 1);
          room.guess(id, i === missing ? 'no idea at all' : room.answer());
        });
      }
      room.runOutClock();
    }

    expect(room.state.phase).toBe('over');
    expect(room.state.roundNo).toBe(9);
    expect(kinds.filter((k) => k === 'turn')).toHaveLength(3);
    expect(new Set(givers).size).toBe(3);
    expect(room.state.players.every((p) => p.score > 0)).toBe(true);
    expect(new Set(room.state.deck).size).toBe(room.state.deck.length);

    room.send({ type: 'rematch', playerId: room.state.hostId! });
    expect(room.state.phase).toBe('lobby');
    expect(room.state.gameNo).toBe(2);
    expect(room.state.players.every((p) => p.score === 0)).toBe(true);
  });

  it('is deterministic for a given seed', () => {
    const play = () => {
      const room = new TestRoom({ rounds: 5, seed: 99 });
      const ids = ['Ana', 'Bo'].map((n) => room.join(n));
      room.send({ type: 'start', playerId: ids[0] });
      const answers: string[] = [];
      let guard = 0;
      while (room.state.phase !== 'over' && guard++ < 100) {
        if (room.state.phase === 'round') answers.push(room.answer());
        room.runOutClock();
      }
      return answers;
    };
    expect(play()).toEqual(play());
  });

  it('never deals the same puzzle twice in a game', () => {
    const room = new TestRoom({ rounds: 15, seed: 5 });
    const ids = ['Ana', 'Bo', 'Cy'].map((n) => room.join(n));
    room.send({ type: 'start', playerId: ids[0] });
    const seen: string[] = [];
    let guard = 0;
    while (room.state.phase !== 'over' && guard++ < 300) {
      const round = room.state.round;
      if (room.state.phase === 'round' && round) {
        if (round.step === 'pick') room.send({ type: 'pickTitle', playerId: round.giverId!, index: 0 });
        if (room.state.round?.puzzleId) seen.push(room.state.round.puzzleId);
      }
      room.runOutClock();
    }
    expect(new Set(seen).size).toBe(seen.length);
  });
});

describe('invalid events are no-ops (SPEC 3.2)', () => {
  it('never throws, whatever arrives in whatever phase', () => {
    const room = new TestRoom({ rounds: 5 });
    const ana = room.join('Ana');
    room.join('Bo');
    const events = [
      { type: 'guess', playerId: ana, text: 'x' },
      { type: 'pickTitle', playerId: ana, index: 99 },
      { type: 'compose', playerId: ana, emoji: ['\u{1F981}'] as string[] },
      { type: 'skipReveal', playerId: ana },
      { type: 'rematch', playerId: ana },
      { type: 'guess', playerId: 'ghost', text: 'x' },
      { type: 'resume', playerId: 'ghost', resumeToken: 'x' },
      { type: 'disconnect', playerId: 'ghost' },
    ] satisfies GameEvent[];

    for (const phase of ['lobby', 'round', 'reveal', 'scoreboard'] as const) {
      let guard = 0;
      while (room.state.phase !== phase && guard++ < 20) {
        if (room.state.phase === 'lobby') room.send({ type: 'start', playerId: ana });
        else room.runOutClock();
      }
      expect(room.state.phase).toBe(phase);
      for (const e of events) expect(() => room.send({ ...e })).not.toThrow();
    }
  });

  it('refuses an empty nickname', () => {
    const room = new TestRoom();
    room.send({ type: 'join', playerId: 'p9', resumeToken: 't', nick: '   ' });
    expect(room.state.players).toHaveLength(0);
  });
});
