/**
 * End-to-end: three scripted clients play a whole game against the real
 * Durable Object. Run `npm run dev:server` in one shell, then
 * `node --experimental-strip-types test/e2e.mjs`. SPEC 7.5.
 */
const BASE = process.env.REBUS_URL ?? 'http://127.0.0.1:8787';
const WS = BASE.replace(/^http/, 'ws');
const { PUZZLE_BANK } = await import('../shared/src/puzzles.data.ts');

const byEmoji = new Map(PUZZLE_BANK.map((p) => [p.emoji.join(''), p.title]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Client {
  constructor(nick) {
    this.nick = nick;
    this.state = null;
    this.session = null;
    this.results = [];
  }

  connect(code) {
    this.code = code;
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${WS}/api/rooms/${code}/socket?v=1`);
      this.ws = ws;
      const timer = setTimeout(() => reject(new Error(`${this.nick}: connect timed out`)), 10_000);
      ws.onopen = () => {
        if (this.session) ws.send(JSON.stringify({ t: 'resume', ...this.session }));
        else ws.send(JSON.stringify({ t: 'join', nick: this.nick }));
      };
      ws.onmessage = (e) => {
        const msg = JSON.parse(String(e.data));
        if (msg.t === 'hello') {
          this.session = { playerId: msg.playerId, resumeToken: msg.resumeToken };
          clearTimeout(timer);
          resolve();
        }
        if (msg.t === 'state') this.state = msg.state;
        if (msg.t === 'guessResult') this.results.push(msg);
        if (msg.t === 'error') this.lastError = msg;
      };
      ws.onerror = () => {};
    });
  }

  send(msg) {
    this.ws.send(JSON.stringify(msg));
  }

  drop() {
    this.ws.close();
  }

  get me() {
    return this.state?.players.find((p) => p.id === this.state.youId);
  }

  async until(pred, label, timeoutMs = 30_000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (pred(this.state)) return this.state;
      await sleep(50);
    }
    throw new Error(`${this.nick}: timed out waiting for ${label} (phase=${this.state?.phase})`);
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(`FAILED: ${message}`);
  console.log(`  ok  ${message}`);
}

const created = await fetch(`${BASE}/api/rooms`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ rounds: 5 }),
}).then((r) => r.json());
assert(/^[A-Z0-9]{4}$/.test(created.code), `room created: ${created.code}`);

const info = await fetch(`${BASE}/api/rooms/${created.code}`).then((r) => r.json());
assert(info.phase === 'lobby', 'the room reports itself in the lobby');
assert((await fetch(`${BASE}/api/rooms/ZZZZ`)).status === 404, 'an unknown code is a 404');

const players = [new Client('Ana'), new Client('Bo'), new Client('Cy')];
for (const p of players) await p.connect(created.code);
const [ana, bo, cy] = players;
await ana.until((s) => s?.players.length === 3, 'three players in the lobby');
assert(ana.state.hostId === ana.session.playerId, 'the first player is host');

bo.send({ t: 'start' });
await sleep(300);
assert(ana.state.phase === 'lobby', 'a non-host cannot start the game');
assert(bo.lastError?.code === 'not_host', 'and is told why');

ana.send({ t: 'start' });
await ana.until((s) => s?.phase === 'round', 'round 1');
assert(ana.state.round.emoji.length > 0, 'the emoji arrive');
assert(ana.state.round.answer === undefined, 'the answer does not');
assert(ana.state.deadline > Date.now(), 'a deadline arrives with them');

bo.send({ t: 'guess', text: 'not the answer at all' });
await sleep(400);
assert(bo.results.at(-1)?.kind === 'wrong', 'a wrong guess comes back wrong');
bo.send({ t: 'guess', text: 'again too fast' });
await sleep(300);
assert(bo.results.at(-1)?.kind === 'rate', 'a second guess inside the cooldown is rate-limited');

// A ping now also re-runs the room's deadline check, so that a room whose alarm was
// missed can be nudged back to life (SPEC 7.6). The risk that buys is the opposite
// one: the ordinary 20-second keepalive must not push a live round along. Three
// pings mid-round, from every phone, must change nothing.
{
  const phase = ana.state.phase;
  const roundNo = ana.state.roundNo;
  const deadline = ana.state.deadline;
  const scores = ana.state.players.map((p) => p.score);
  for (const p of players) p.send({ t: 'ping', t0: Date.now() });
  await sleep(600);
  assert(ana.state.phase === phase, 'a ping mid-round does not change the phase');
  assert(ana.state.roundNo === roundNo, 'a ping mid-round does not advance the round');
  assert(ana.state.deadline === deadline, 'a ping mid-round does not move the deadline');
  assert(
    ana.state.players.every((p, i) => p.score === scores[i]),
    'a ping mid-round does not touch the scores',
  );
}

let sharedTitle = null;
let rounds = 0;
let sawTurnRound = false;
const guard = Date.now() + 180_000;

while (ana.state.phase !== 'over' && Date.now() < guard) {
  const view = ana.state;
  if (view.phase !== 'round') {
    await sleep(200);
    continue;
  }
  const round = view.round;
  const giver = players.find((p) => p.session.playerId === round.giverId);

  if (round.step === 'pick' && giver) {
    sawTurnRound = true;
    giver.send({ t: 'pickTitle', index: 0 });
    await giver.until((s) => s.round?.step === 'compose', 'compose step');
    sharedTitle = giver.state.round.title;
    giver.send({ t: 'compose', emoji: ['\u{1F981}', '\u{1F451}'] });
    await ana.until((s) => s.round?.step === 'guess', 'guessing to open');
  }

  const answer = round.kind === 'turn' ? sharedTitle : byEmoji.get(ana.state.round.emoji.join(''));
  if (!answer) throw new Error('the driver could not identify the puzzle');

  const guessers = players.filter((p) => p.session.playerId !== round.giverId);
  for (const p of guessers) {
    p.send({ t: 'guess', text: answer });
    await sleep(600);
  }

  await ana.until((s) => s.phase === 'reveal', 'the reveal');
  assert(ana.state.round.answer === answer, `round ${view.roundNo}: the answer is revealed (${answer})`);
  rounds++;

  if (rounds === 1) {
    // A phone that sleeps mid-game comes back to its seat. SPEC 3.5.
    const scoreBefore = cy.me.score;
    cy.drop();
    await sleep(500);
    await cy.connect(created.code);
    await cy.until((s) => s?.players.some((p) => p.id === cy.session.playerId && p.connected), 'resume');
    assert(cy.me.score === scoreBefore, 'a reconnecting player keeps their score');
  }

  await ana.until((s) => s.phase !== 'reveal', 'the scoreboard');
  await ana.until((s) => s.phase === 'round' || s.phase === 'over', 'the next round');
}

assert(ana.state.phase === 'over', `the game finished after ${rounds} rounds`);
assert(rounds === 5, 'all five rounds were played');
assert(sawTurnRound, 'round 3 was a player-written round');
assert(
  ana.state.players.every((p) => p.score > 0),
  'everybody scored something',
);

ana.send({ t: 'rematch' });
await ana.until((s) => s.phase === 'lobby', 'the rematch lobby');
assert(ana.state.gameNo === 2, 'a rematch keeps the room and resets the scores');

console.log('\nfinal scores:', ana.state.players.map((p) => `${p.nick} ${p.score}`).join(', '));
for (const p of players) p.drop();
console.log('e2e passed');
process.exit(0);
