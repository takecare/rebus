import { describe, expect, it } from 'vitest';
import { CONFIG } from '@rebus/shared';
import { TestRoom } from './harness.js';

/**
 * SPEC 4.4 - the property that matters more than any other here: a live
 * round's answer is never in a payload, for anyone.
 */
describe('redaction', () => {
  it('never leaks a live answer to anybody, over a whole game', () => {
    const room = new TestRoom({ rounds: 9, seed: 3 });
    const ids = ['Ana', 'Bo', 'Cy'].map((n) => room.join(n));
    room.send({ type: 'start', playerId: ids[0] });

    let checks = 0;
    let guard = 0;
    while (room.state.phase !== 'over' && guard++ < 300) {
      if (room.state.phase === 'round') {
        const round = room.state.round!;
        if (round.step === 'pick') {
          for (const id of ids) {
            if (id === round.giverId) continue;
            for (const candidate of round.candidateIds) {
              expect(JSON.stringify(room.view(id))).not.toContain(candidate);
            }
            checks++;
          }
          room.send({ type: 'pickTitle', playerId: round.giverId!, index: 0 });
          room.send({ type: 'compose', playerId: round.giverId!, emoji: ['\u{1F981}', '\u{1F451}'] });
        }
        const answer = room.answer();
        for (const id of ids) {
          const view = room.view(id);
          expect(view.round?.answer).toBeUndefined();
          if (id !== room.state.round?.giverId) {
            expect(JSON.stringify(view)).not.toContain(answer);
          }
          checks++;
        }
        const guesser = ids.find((id) => id !== room.state.round?.giverId)!;
        room.guess(guesser, answer);
        expect(JSON.stringify(room.view(guesser))).not.toContain(answer);
        checks++;
      }
      room.advanceBy(CONFIG.GUESS_COOLDOWN_MS + 1);
      room.runOutClock();
    }
    expect(checks).toBeGreaterThan(20);
  });

  it('shows the answer to everyone at the reveal', () => {
    const room = new TestRoom({ rounds: 5 });
    const ana = room.join('Ana');
    const bo = room.join('Bo');
    room.send({ type: 'start', playerId: ana });
    const answer = room.answer();
    room.runOutClock();
    expect(room.state.phase).toBe('reveal');
    for (const id of [ana, bo]) {
      expect(room.view(id).round?.answer).toBe(answer);
      expect(room.view(id).round?.results).toHaveLength(2);
    }
  });

  it('never ships a resume token in a snapshot', () => {
    const room = new TestRoom();
    const ana = room.join('Ana');
    expect(JSON.stringify(room.view(ana))).not.toContain('tok-');
  });
});
