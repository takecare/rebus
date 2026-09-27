import { beforeEach, describe, expect, it } from 'vitest';
import { CONFIG } from '@rebus/shared';
import { TestRoom } from './harness.js';

/**
 * SPEC §7.6, the risk that a round hangs because its alarm never fired.
 *
 * `TestRoom.advanceBy` fires the alarm the way a healthy room does, so these tests
 * move the clock by hand instead — that is exactly a missed alarm: the deadline is
 * in the past and nothing has woken the room. The recovery is a client ping, which
 * the Durable Object turns into a `tick`.
 */
describe('recovering from an alarm that never fired (SPEC §7.6)', () => {
  let room: TestRoom;
  let ana: string;
  let bo: string;

  beforeEach(() => {
    room = new TestRoom({ rounds: 5 });
    ana = room.join('Ana');
    bo = room.join('Bo');
    room.send({ type: 'start', playerId: ana });
  });

  /** Time passes, but nothing fires the alarm. */
  const missAlarm = (extraMs = CONFIG.STALL_AFTER_MS + 1) => {
    expect(room.state.deadline).not.toBeNull();
    room.now = room.state.deadline! + extraMs;
  };

  it('hangs in the round until something wakes it', () => {
    missAlarm();
    // The premise: without a tick the room really is stuck, deadline long past.
    expect(room.state.phase).toBe('round');
    expect(room.now).toBeGreaterThan(room.state.deadline!);
  });

  it('ends the round once a nudge arrives', () => {
    missAlarm();
    room.send({ type: 'tick' });
    expect(room.state.phase).toBe('reveal');
  });

  it('reschedules its alarm when it recovers, so the next phase is not stuck too', () => {
    missAlarm();
    room.send({ type: 'tick' });
    expect(room.alarm).not.toBeNull();
    expect(room.alarm!).toBeGreaterThan(room.now);
  });

  it('recovers a stalled reveal as well as a stalled round', () => {
    room.runOutClock();
    expect(room.state.phase).toBe('reveal');
    missAlarm();
    room.send({ type: 'tick' });
    expect(room.state.phase).not.toBe('reveal');
  });

  // The client nudges every few seconds while it believes the room is stalled, so
  // a nudge has to be worth nothing when the deadline has not passed. Otherwise
  // pinging would skip rounds rather than rescue them.
  it('ignores a nudge that arrives before the deadline', () => {
    const before = {
      phase: room.state.phase,
      roundNo: room.state.roundNo,
      deadline: room.state.deadline,
    };
    room.send({ type: 'tick' });
    room.send({ type: 'tick' });
    room.send({ type: 'tick' });
    expect(room.state.phase).toBe(before.phase);
    expect(room.state.roundNo).toBe(before.roundNo);
    expect(room.state.deadline).toBe(before.deadline);
  });

  it('does not double-advance when several players nudge at once', () => {
    missAlarm();
    room.send({ type: 'tick' });
    const recovered = { phase: room.state.phase, roundNo: room.state.roundNo };
    // Three phones all notice the stall and ping within the same instant.
    room.send({ type: 'tick' });
    room.send({ type: 'tick' });
    expect(room.state.phase).toBe(recovered.phase);
    expect(room.state.roundNo).toBe(recovered.roundNo);
  });

  it('keeps the scores a recovered round produced', () => {
    room.guess(bo, room.answer());
    expect(room.score(bo)).toBeGreaterThan(0);
    const earned = room.score(bo);
    missAlarm();
    room.send({ type: 'tick' });
    expect(room.state.phase).toBe('reveal');
    expect(room.score(bo)).toBe(earned);
  });

  it('still reveals the answer to everyone after a stall', () => {
    missAlarm();
    room.send({ type: 'tick' });
    expect(room.view(ana).round?.answer).toBeTruthy();
    expect(room.view(bo).round?.answer).toBeTruthy();
  });

  it('a stalled game can still be played to the podium', () => {
    // Every single phase change in this game recovers from a missed alarm.
    for (let guard = 0; guard < 60 && room.state.phase !== 'over'; guard++) {
      if (room.state.deadline === null) break;
      room.now = room.state.deadline + CONFIG.STALL_AFTER_MS + 1;
      room.send({ type: 'tick' });
    }
    expect(room.state.phase).toBe('over');
    expect(room.state.roundNo).toBe(5);
  });
});
