import { beforeEach, describe, expect, it } from 'vitest';
import { CONFIG, giverPoints, puzzleById } from '@rebus/shared';
import { TestRoom } from './harness.js';

/**
 * Practice-room bots (SPEC §7.3b, the /single page): scripted players a host
 * can add to a room so one person can get through a lobby, a bank round and
 * a turn round — as both giver and guesser — without a second phone.
 */
describe('addBot (SPEC §7.3b)', () => {
  let room: TestRoom;
  let ana: string;
  let bo: string;

  beforeEach(() => {
    room = new TestRoom({ rounds: 9 });
    ana = room.join('Ana');
    bo = room.join('Bo');
  });

  it('is host-only', () => {
    room.send({ type: 'addBot', playerId: bo, botId: 'intruder' });
    expect(room.state.players.some((p) => p.id === 'intruder')).toBe(false);
    expect(room.to(bo).at(-1)).toMatchObject({ code: 'not_host' });
  });

  it('only works before the round starts', () => {
    room.send({ type: 'start', playerId: ana });
    room.send({ type: 'addBot', playerId: ana, botId: 'late' });
    expect(room.state.players.some((p) => p.id === 'late')).toBe(false);
    expect(room.to(ana).at(-1)).toMatchObject({ code: 'not_now' });
  });

  it('adds a connected, nameable player that counts toward the player total', () => {
    const botId = room.addBot(ana);
    const bot = room.state.players.find((p) => p.id === botId);
    expect(bot).toMatchObject({ isBot: true, connected: true, nick: 'Bot 1' });
    expect(room.view(ana).players.find((p) => p.id === botId)).toMatchObject({ isBot: true });
  });

  it('numbers bots in order and respects the room cap', () => {
    const b1 = room.addBot(ana);
    const b2 = room.addBot(ana);
    expect(room.state.players.find((p) => p.id === b1)?.nick).toBe('Bot 1');
    expect(room.state.players.find((p) => p.id === b2)?.nick).toBe('Bot 2');
    for (let i = room.state.players.length; i < CONFIG.MAX_PLAYERS; i++) room.addBot(ana);
    expect(room.state.players.length).toBe(CONFIG.MAX_PLAYERS);
    room.send({ type: 'addBot', playerId: ana, botId: 'overflow' });
    expect(room.state.players.some((p) => p.id === 'overflow')).toBe(false);
    expect(room.to(ana).at(-1)).toMatchObject({ code: 'room_full' });
  });
});

describe('a bot-only room does not outlive the human who left it (SPEC §7.3b)', () => {
  it('becomes eligible to close once its only human disconnects', () => {
    const room = new TestRoom({ rounds: 9 });
    const ana = room.join('Ana');
    room.addBot(ana);
    // Before: a connected human means no idle candidate at all.
    expect(room.alarm).toBeNull();

    room.send({ type: 'disconnect', playerId: ana });
    // After: the bot is still "connected", but it must not count as someone
    // keeping the room alive — otherwise a practice room nobody is playing
    // would sit in storage until it next got lucky and nobody ever came back.
    expect(room.alarm).not.toBeNull();
    expect(room.alarm!).toBeLessThanOrEqual(room.now + CONFIG.ROOM_IDLE_MS);
  });
});

describe('a bank round with bots (SPEC §7.3b)', () => {
  it('can end before its own deadline once every bot and the human have answered', () => {
    const room = new TestRoom({ rounds: 9, seed: 0 });
    const ana = room.join('Ana');
    room.addBot(ana);
    room.addBot(ana);
    room.send({ type: 'start', playerId: ana });
    const startedAt = room.now;

    room.guess(ana, room.answer());
    for (let i = 0; i < 50 && room.state.phase === 'round'; i++) room.advanceBy(1_000);

    expect(room.state.phase).toBe('reveal');
    expect(room.now).toBeLessThan(startedAt + CONFIG.BANK_GUESS_MS);
    const results = room.state.round?.results ?? [];
    expect(results.filter((r) => r.correct)).toHaveLength(3); // Ana + both bots
  });

  it('still ends by the deadline for whichever bots never guess', () => {
    const room = new TestRoom({ rounds: 9 });
    const ana = room.join('Ana');
    room.addBot(ana);
    room.send({ type: 'start', playerId: ana });
    // Ana deliberately never answers — same as a round nobody cracks.
    room.runOutClock();
    expect(room.state.phase).toBe('reveal');
  });
});

describe('a turn round with a bot giver (SPEC §7.3b)', () => {
  function roomWithBotGiverAtRound6() {
    const room = new TestRoom({ rounds: 9, seed: 0 });
    const ana = room.join('Ana');
    const b1 = room.addBot(ana);
    const b2 = room.addBot(ana);
    room.send({ type: 'start', playerId: ana });

    // Round 3: Ana is the giver (fewest turnsGiven, then lowest seat). She
    // completes it herself so the rotation moves on, the same as a solo
    // tester who writes their own clue the first time it's their turn.
    while (room.state.roundNo < 3 || room.state.phase !== 'round') room.runOutClock();
    expect(room.state.round?.giverId).toBe(ana);
    room.send({ type: 'pickTitle', playerId: ana, index: 0 });
    room.send({ type: 'compose', playerId: ana, emoji: ['🦄'] });
    room.runOutClock();

    // Round 6 now goes to whichever bot has given fewest times, i.e. b1.
    while (room.state.roundNo < 6 || room.state.phase !== 'round') room.runOutClock();
    expect(room.state.round?.giverId).toBe(b1);
    return { room, ana, b1, b2 };
  }

  it('picks and composes without any pickTitle or compose event', () => {
    const { room } = roomWithBotGiverAtRound6();
    for (let i = 0; i < 20 && room.state.round?.step !== 'guess'; i++) room.advanceBy(3_000);
    expect(room.state.round?.step).toBe('guess');
  });

  it('composes the puzzle bank\'s own emoji, not an invented or empty clue', () => {
    const { room } = roomWithBotGiverAtRound6();
    for (let i = 0; i < 20 && room.state.round?.step !== 'guess'; i++) room.advanceBy(3_000);
    const round = room.state.round!;
    const puzzle = puzzleById(round.puzzleId!)!;
    expect(round.emoji).toEqual(puzzle.emoji);
  });

  it('pays the bot giver by the same formula a human giver earns', () => {
    const { room, ana, b1, b2 } = roomWithBotGiverAtRound6();
    for (let i = 0; i < 20 && room.state.round?.step !== 'guess'; i++) room.advanceBy(3_000);
    room.guess(ana, room.answer());
    room.runOutClock();

    const correctGuessers = (room.state.round?.results ?? []).filter(
      (r) => r.role === 'guesser' && r.correct,
    ).length;
    expect(room.score(b1)).toBeGreaterThanOrEqual(giverPoints(correctGuessers));
    expect(room.state.round?.results?.find((r) => r.playerId === b1)).toMatchObject({
      role: 'giver',
      points: giverPoints(correctGuessers),
    });
    // b2, not the giver this round, is an ordinary eligible guesser.
    expect(room.state.round?.results?.some((r) => r.playerId === b2 && r.role === 'guesser')).toBe(true);
  });
});
