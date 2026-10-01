# Rebus — build spec

A real-time multiplayer party game for phones. The server shows a string of emoji;
everyone races to type what it means. Every third round, one of the players is the
one who writes the emoji.

Written in the style of [Fragment](https://github.com/takecare/aprenshaders)'s own build
spec: this document is the contract, the code follows it, and where the code currently
stops is written down in §8 rather than left to be discovered.

## Table of contents

1. [Product overview & constraints](#1-product-overview--constraints)
2. [Game design](#2-game-design)
3. [Architecture](#3-architecture)
4. [Protocol](#4-protocol)
5. [Matching & content](#5-matching--content)
6. [Client](#6-client)
7. [Repo, build, deploy, testing](#7-repo-build-deploy-testing)
8. [Status of the skeleton on this branch](#8-status-of-the-skeleton-on-this-branch)

---

## 1. Product overview & constraints

Six friends in a room, or six friends on a call. One person opens the site, taps
**Create room**, reads out a four-letter code. Everyone else types the code on their
own phone. Ninety seconds later the first puzzle is on screen:

```
🕷️👨‍🦰🕸️🏙️
```

Everyone types. `spiderman` scores. So does `Spider-Man`, `spider man`, and
`spidermam`. `spider` does not — it is a prefix, not an answer. The fastest correct
guess is worth roughly three times the slowest one, so the round stays tense until
the clock runs out, and then the answer flips over and the scoreboard moves.

### 1.1 Non-negotiable constraints

- **Phone-first, portrait, one thumb.** No desktop layout, no landscape layout, no
  shared "TV" screen. Every player sees the same game on their own device. If it does
  not work on a 375 × 667 viewport with a keyboard covering half of it, it does not work.
- **No accounts.** A nickname and a room code. Nothing to install, nothing to sign up
  for, no email, no password, no personal data at rest.
- **Server-authoritative.** The client is a renderer with an input box. Scores, timers,
  correctness, and phase transitions are decided in one place, on the server, so that a
  player with devtools open cannot out-score a player without.
- **Joinable and survivable.** Phones sleep, tunnels drop, Safari backgrounds tabs. A
  player who disconnects mid-round and comes back four seconds later must land back in
  the same round with their score intact. Losing the host must not end the game.
- **Cheap at rest.** A room that nobody is playing in must cost nothing. This rules out
  a process-per-room server that has to stay warm and rules *in* Durable Objects, which
  hibernate with their sockets open.

### 1.2 The three ideas everything hangs off

1. **The game is a pure function.** `applyEvent(state, event) -> { state, effects }`
   lives in `shared/` and imports nothing — no Workers runtime, no React, no clock, no
   randomness that is not passed in. The Durable Object is a thin adapter that turns
   sockets and alarms into events and turns effects back into sends and alarms. Every
   rule in §2 is therefore testable in Node in milliseconds, and the *same* reducer can
   later drive a replay tool, a bot, or a local single-device mode. This is the same bet
   Fragment makes with `engine/` having zero React in it, and it is enforced the same
   way — with a lint boundary rule, from commit one.

2. **The bank carries the pace; the players carry the replay value.** A curated puzzle
   bank is what makes the first ninety seconds good — authored emoji strings are simply
   better than what a stranger types in forty seconds. But a bank is finite and a group
   burns through it. So every third round hands the pen to a player: they get three
   titles to choose from, an emoji keyboard, and sixty seconds. Bank rounds are the
   metronome, turn rounds are the reason to play a fourth game.

3. **Matching is a design surface, not a string comparison.** The single fastest way to
   ruin this game is to reject `spider man` when the answer is `Spider-Man`. Normalization,
   edit-distance tolerance scaled to answer length, per-puzzle alias lists, and per-puzzle
   *reject* lists for near-misses that are actually different answers (`Alien` vs `Aliens`)
   are all first-class, all in `shared/match.ts`, and all under test with a table of real
   inputs — including the ones that must **fail**.

### 1.3 Build order

Each phase ends in something playable by real people on real phones. No phase ends in
"the plumbing is done".

| Phase | What lands | Exit criterion |
|---|---|---|
| 0 | Workspace, shared types, pure reducer, matcher, scoring, tests | `npm test` green; a full 9-round game can be driven in a unit test with no server |
| 1 | Durable Object, WebSocket transport, room create/join, lobby | Two phones in the same lobby see each other's nicknames appear and disappear |
| 2 | Bank rounds end to end: deal, guess, hints, reveal, scoreboard | A whole bank-only game is playable and fun with 4 people |
| 3 | Turn rounds: title choice, emoji composer, giver scoring | Round 3 hands the pen over and comes back with a working clue |
| 4 | Reconnect, host migration, game-over, rematch | Airplane-mode a phone mid-round; it returns to the same round with its score |
| 5 | Content pass (200+ puzzles), copy pass, motion, sound, share card | A stranger can run a game without being told how anything works |

The skeleton on this branch covers phases 0–4 (see §8).

### 1.4 Deliberately out of scope for v1

- Accounts, persistent profiles, cross-game stats, friend lists.
- Public matchmaking. Rooms are private by code; there is no lobby browser to moderate.
- Chat. A free-text channel between strangers is a moderation product, not a feature.
- Voice, video, avatars, cosmetics, currency.
- Desktop/tablet layouts and a separate "big screen" host view. Both are natural v2s —
  the protocol already allows a spectator connection — but they double the UI surface.
- Server-side persistence beyond the life of a room. Rooms are ephemeral; when the game
  ends and everyone leaves, the room evaporates.

### 1.5 Open questions to resolve before/during build

1. **Turn-round title source.** The clue-giver currently picks from three titles drawn
   from the same bank. Alternative: let them type their own title. That removes the
   content ceiling entirely but opens the door to in-joke titles nobody can guess and to
   text that needs moderating. Current answer: bank-drawn in v1, "free title" as a room
   option in v2, gated behind §5.6.
2. **Ideal round length.** 45 s is a guess from playtests of similar games. Instrument
   time-to-first-correct-guess and cut to 35 s if the median is under 12 s.
3. **Should everyone see everyone's wrong guesses?** Funnier, and it leaks answers. v1
   shows only *that* someone guessed wrong (a shaking avatar), never the text.
4. **Score curve.** The order bonus (§2.4) may over-reward the one player with a fast
   thumb. Consider replacing it with a pure speed curve if playtests show a runaway leader.
5. **Language.** The bank ships English. Catalan/Portuguese banks are a data problem, not
   a code problem — `lang` is on the puzzle record and on the room — but the matcher's
   article stripping is per-language and needs a native speaker's list per locale.

---

## 2. Game design

### 2.1 Session shape

```
        ┌──────────┐  host taps start (≥2 players)
        │  LOBBY   │──────────────┐
        └──────────┘              ▼
                          ┌───────────────┐
              ┌──────────►│  ROUND n      │  bank round or turn round
              │           └───────┬───────┘
              │                   │ everyone answered, or the clock ran out
              │                   ▼
              │           ┌───────────────┐
              │           │   REVEAL      │  7 s: the answer, who got it, deltas
              │           └───────┬───────┘
              │                   ▼
              │           ┌───────────────┐
              └───────────│  SCOREBOARD   │  6 s, auto-advances
             n < 9        └───────┬───────┘
                                  │ n = 9
                                  ▼
                          ┌───────────────┐
                          │  GAME OVER    │  podium, rematch keeps the room
                          └───────────────┘
```

- **Room size**: 2–10 players. Below 2 the start button stays disabled; above 10 the
  join is refused with `room_full`.
- **Rounds per game**: 9 by default (a game runs ~9 minutes). Configurable per room at
  create time to 5 / 9 / 15.
- **Turn rounds**: every 3rd round (3, 6, 9). The giver rotates through the player list
  by join order, skipping anyone who is disconnected at the moment the round starts. With
  fewer than 3 players, turn rounds degrade to bank rounds — a two-person turn round is
  one person guessing one person, which is a different (worse) game.
- **Late joiners** may enter during any phase and start scoring from the next round.
  They cannot join a game in its final round, to avoid a pointless podium entry.

### 2.2 Round types

**Bank round.** The server picks an unused puzzle from the room's shuffled deck and
broadcasts its emoji, category, and answer *shape* (word lengths, e.g. `_ _ _ _ _ _ - _ _ _`).
Everyone guesses in parallel. A player who guesses correctly is locked for the rest of the
round and sees a "waiting for the others" state with their score delta. The round ends when
every connected player is locked, or on the 45 s deadline.

**Turn round.** Three phases inside one round:

1. **Pick** — the giver is shown 3 candidate titles from the deck and taps one. 15 s;
   on timeout the first is auto-picked. Everyone else sees "Ana is thinking…".
2. **Compose** — the giver gets an emoji picker and builds a string of 1–8 emoji. 60 s;
   on timeout, whatever is in the tray is submitted, and an empty tray forfeits the round
   (it becomes a bank round instead, so nobody loses a minute to an AFK giver).
3. **Guess** — as a bank round, 45 s, except that the giver cannot guess and instead
   watches the guessers' progress. There are no hints on a turn round; a player-authored
   clue is already imprecise enough.

### 2.3 Timings

All of these live in `shared/config.ts` as a single frozen object; nothing else in the
codebase is allowed to hardcode a duration.

| Constant | Value | Note |
|---|---|---|
| `BANK_GUESS_MS` | 45 000 | |
| `TURN_PICK_MS` | 15 000 | auto-picks candidate 0 |
| `TURN_COMPOSE_MS` | 60 000 | auto-submits the tray |
| `TURN_GUESS_MS` | 45 000 | |
| `REVEAL_MS` | 7 000 | |
| `SCOREBOARD_MS` | 6 000 | |
| `HINT_1_AT_MS` | 15 000 | elapsed, not remaining |
| `HINT_2_AT_MS` | 28 000 | |
| `GUESS_COOLDOWN_MS` | 500 | per player, server-enforced |
| `MAX_GUESSES_PER_ROUND` | 25 | brute-force ceiling |
| `DISCONNECT_GRACE_MS` | 45 000 | before a player is dropped from the room |
| `ROOM_IDLE_MS` | 1 800 000 | 30 min with no sockets → room self-deletes |

### 2.4 Scoring

Bank round, per correct guesser:

```
base        = 100
speed       = round(200 * remainingMs / totalMs)      // 200 at t=0, 0 at the buzzer
order       = [100, 50, 25][positionAmongCorrect] ?? 0
hintPenalty = [1.0, 0.8, 0.6][hintsRevealedWhenAnswered]
points      = round((base + speed + order) * hintPenalty)
```

So a first-place instant answer is 400 and a last-second answer after both hints is 66.
Wrong guesses cost nothing — this is a game about shouting, not about hesitating.

Turn round: guessers score by the same formula with `hintPenalty = 1`. The giver scores
`100 × correctGuessers`, capped at 400, and **0 if nobody guessed**. The cap and the zero
together push the giver toward a clue that two or three people can get, which is exactly
the clue that is fun to see revealed.

Ties are broken by `firstCorrectAt` across the game (earliest wins); the podium shows a
shared position if even that is equal.

### 2.5 Hints

Two, on the clock, bank rounds only, revealed to everyone at once so that the penalty is
fair:

1. **t = 15 s** — the category is upgraded from `Film` to `Film · 2002 · superhero`.
2. **t = 28 s** — the first letter of each word, in the shape that was already shown.

Hints never change the answer, and the penalty is charged based on what was on screen
when the player locked in, not on what was on screen when the round ended.

### 2.6 Fairness and abuse

- **The answer is never sent to a guesser's client.** Not obfuscated, not base64'd —
  simply absent from every payload that goes to anyone who is still guessing (§4.4).
  Matching happens on the server. This is the single most important line in the spec.
- **Guess rate** is capped at one per 500 ms and 25 per round, server-side, so that a
  script cannot walk a dictionary.
- **The clue-giver's title** is sent only to the giver, and only during pick/compose.
- **Player-authored emoji** are validated server-side as 1–8 *emoji* code point sequences
  (§5.6), so the composer cannot become a text channel.
- **Nicknames** are 1–12 characters, trimmed, deduplicated inside a room (`Ana`, `Ana (2)`),
  and passed through the same profanity screen as any other player-authored text.

---

## 3. Architecture

### 3.1 Topology

```
  phone  ──HTTPS──►  Cloudflare Pages (static React bundle)
    │
    └────WSS──────►  Worker  ──►  Durable Object "room:ABCD"   ◄── alarm()
                     (router)      · authoritative GameState
                                   · one WebSocket per player (hibernatable)
                                   · deadline alarms
```

One Durable Object per room, addressed by `idFromName("room:" + code)`. The DO *is* the
room: it owns the state, the sockets, and the clock. There is no database, no Redis, no
cross-room state. Room codes are claimed by attempting to create the room inside the DO
and refusing if it already exists (§3.3), so no separate registry is needed.

Why Durable Objects rather than a Node process: a party game is a swarm of tiny, spiky,
stateful sessions. Durable Objects give exactly one authoritative instance per room, at
the edge, with WebSocket **hibernation** — the sockets stay open while the object is
evicted from memory, so an idle lobby costs nothing and wakes on the next message. The
price is a runtime that is not Node (no `setInterval` across hibernation — use `alarm()`,
see §3.3) and an execution model where in-memory state must be re-derivable from storage.

### 3.2 The pure reducer

`shared/reducer.ts` exports:

```ts
export function applyEvent(state: GameState, event: GameEvent, ctx: EventCtx):
  { state: GameState; effects: Effect[] }

type EventCtx = { now: number; rng: () => number };   // no ambient clock, no ambient random
type Effect =
  | { kind: 'broadcast' }                              // re-send redacted state to everyone
  | { kind: 'toPlayer'; playerId: string; msg: ServerMsg }
  | { kind: 'setAlarm'; at: number | null }
  | { kind: 'close'; playerId: string; reason: CloseReason };
```

Rules of the reducer:

- Pure. Same `(state, event, ctx)` in, same `(state, effects)` out, always.
- Total. Every event is valid in every phase; invalid combinations return the state
  unchanged plus at most a `toPlayer` error, never a throw. A malformed client message
  must not be able to take a room down.
- The only source of "now" is `ctx.now`; the only source of randomness is `ctx.rng`. Tests
  drive both, so a whole nine-round game is deterministic and runs in a millisecond.
- It never emits the answer. Redaction is enforced in `redact.ts`, which is applied to
  every `broadcast`, and which is itself unit-tested against a "no answer leaks to a
  guesser" property test that walks a whole game.

The Durable Object contains no game rules at all. Its job: decode a socket message into
a `GameEvent`, call `applyEvent`, persist the new state, and execute the effects. When the
rules are wrong, one file changes, and it is a file that runs in Node.

### 3.3 Durable Object lifecycle

- **Create.** `POST /api/rooms` generates a candidate code (§2.1 alphabet), gets the DO,
  and calls `create`. The DO refuses if it already holds a room, and the Worker retries
  with a new code up to 5 times. 32⁴ ≈ 1 M codes; at any realistic concurrency, collisions
  are rare and the retry is free.
- **Join.** `GET /api/rooms/:code/socket` upgrades to a WebSocket and hands it to the DO
  via `acceptWebSocket` (the hibernation API, not `addEventListener`). The socket's
  attachment carries `{ playerId }`, so a woken DO knows who each socket is without any
  in-memory map.
- **State** lives in `storage.put('state', …)` after every event that changes it. On wake,
  `blockConcurrencyWhile` loads it. In-memory state is a cache, never the truth.
- **Timers** are `storage.setAlarm(deadline)`. Exactly one alarm exists at a time and it
  always equals the current phase deadline; the reducer emits `setAlarm` whenever a phase
  changes. `alarm()` re-enters the reducer with a `{ type: 'deadline' }` event. Never
  `setTimeout` — a hibernated object has no timers.
- **Idle death.** The alarm also carries a room-idle check: no connected sockets for
  `ROOM_IDLE_MS` → `storage.deleteAll()`, and the room ceases to exist.

### 3.4 Time and the countdown

The server sends absolute deadlines in **server epoch milliseconds**, never durations.
The client estimates its offset from the server clock with a ping/pong exchange on connect
and every 20 s (`offset = serverTime - (t0 + rtt/2)`, keeping the *median* of the last 5
samples), and renders `deadline - (Date.now() + offset)`. Consequences worth stating:

- Countdowns are consistent across phones with badly-set clocks.
- A late-joining or reconnecting client renders the correct remaining time immediately,
  with no "resync" frame, because the deadline is in the snapshot.
- The client never decides that time is up. It renders 0 and waits; the phase changes when
  the server's alarm fires. Sub-second disagreement is invisible.

### 3.5 Reconnection and host migration

On join, the server issues `{ playerId, resumeToken }`; the client stores both in
`sessionStorage` under the room code. A reconnecting client sends `resume` with them:
matched, the player's seat, score, and lock state are restored and their socket replaced;
unmatched, it is treated as a fresh join.

- A dropped socket marks the player `connected: false`. They keep their seat and score for
  `DISCONNECT_GRACE_MS`, then are removed (and, if the game is over, kept for the podium).
- A round never waits on a disconnected player: "everyone has answered" counts connected
  players only.
- **Host migration**: the host flag moves to the longest-connected remaining player the
  moment the host's socket drops — not after the grace period, so a start button is never
  stranded. If the original host returns, they do not take it back.
- If *every* player disconnects mid-game, the room freezes on its current phase; the alarm
  keeps firing, and phases keep advancing to game over. That is deliberate: it means a
  group that all walked into a lift comes back to a finished game rather than a stuck one.

### 3.6 Failure modes we accept

| Failure | Behaviour |
|---|---|
| DO evicted mid-game | Next message or alarm wakes it, state reloads from storage; players see nothing |
| Player's phone sleeps 30 s | Socket drops, `resume` on wake, back in the same round |
| Player misses a whole round | Round scores 0 for them; the scoreboard explains nothing, which is fine |
| Cloudflare drops the socket | Client reconnects with backoff 0.5/1/2/4/8 s + jitter, forever, showing a quiet banner |
| Two tabs, same player | Second `resume` wins, first socket is closed with `superseded` |
| Room code guessed by a stranger | They join as a player. Rooms are unlisted, not secret — a 4-char code is 1 in a million, and the game has no stakes. Documented, not defended. |

---

## 4. Protocol

### 4.1 Transport

JSON over one WebSocket per player. Every message is `{ t: <string>, … }`. The client
sends `PROTOCOL_VERSION` in the connect query string; a mismatch is closed immediately with
`code 4001` and the client shows "the game was updated — reload". Versioning is a hard
break on purpose: a party game session lasts nine minutes, so there is no value in
supporting two protocol versions at once.

### 4.2 Client → server

| `t` | Payload | Valid in |
|---|---|---|
| `join` | `{ nick, lang? }` | on connect (no resume token) |
| `resume` | `{ playerId, resumeToken }` | on connect |
| `start` | `{}` | lobby, host only |
| `guess` | `{ text }` | any guessing phase, if not locked |
| `pickTitle` | `{ index }` | turn/pick, giver only |
| `compose` | `{ emoji: string[] }` | turn/compose, giver only |
| `skipReveal` | `{}` | reveal, host only |
| `rematch` | `{}` | game over, host only |
| `ping` | `{ t0 }` | any |

### 4.3 Server → client

| `t` | Payload | When |
|---|---|---|
| `hello` | `{ playerId, resumeToken, protocol, serverTime }` | after join/resume |
| `state` | redacted `GameStateView` | after every state change |
| `guessResult` | `{ ok, kind: 'correct'\|'wrong'\|'close'\|'rate'\|'used', points? }` | to the guesser only |
| `event` | `{ kind: 'playerCorrect'\|'playerJoined'\|'playerLeft'\|'hint', … }` | ephemeral, for animation and sound |
| `error` | `{ code, message }` | on a refused action |
| `pong` | `{ t0, serverTime }` | reply to ping |

`state` is a full snapshot, not a patch. A snapshot for 10 players is well under 4 KB, it
is sent on transitions rather than per frame, and it makes reconnection, late join, and
"the client got confused" all the same code path. Patches are a v2 optimization with a
measurement in front of them.

### 4.4 Redaction

`redact(state, viewerId)` is the only function that produces a `GameStateView`, and the
DO cannot broadcast anything else. It removes:

- `round.answer`, `round.aliases`, `round.puzzleId` — for **everyone** while the round is
  live, including players who have already locked in correctly (they know the answer, but
  their client should not be able to prove it to a devtools user sitting next to them).
- `round.title` for everyone except the giver during turn/pick and turn/compose.
- `round.candidates` for everyone except the giver.
- other players' in-progress guess text — which is never sent to the server as anything
  but a submitted guess anyway.
- `player.resumeToken` for everyone including its owner (it arrives once, in `hello`).

At reveal, the answer is added back for everyone. There is a property test that walks a
scripted nine-round game, redacts every broadcast for every viewer, and asserts that the
answer string never appears in a payload sent to someone who has not yet answered.

### 4.5 Snapshot shape

```ts
type GameStateView = {
  code: string;
  phase: 'lobby' | 'round' | 'reveal' | 'scoreboard' | 'over';
  roundNo: number; roundsTotal: number;
  hostId: string; youId: string;
  players: PlayerView[];            // id, nick, score, connected, locked, streak, isGiver
  deadline: number | null;          // server epoch ms, null in lobby/over
  round?: {
    kind: 'bank' | 'turn';
    step?: 'pick' | 'compose' | 'guess';
    emoji: string[];                // [] until a turn clue is composed
    category?: string;              // upgraded by hint 1
    shape: string;                  // "_ _ _ _ _ _ - _ _ _"
    initials?: string;              // hint 2
    hints: 0 | 1 | 2;
    giverId?: string;
    candidates?: string[];          // giver only
    title?: string;                 // giver only
    answer?: string;                // reveal only
    results?: RoundResult[];        // reveal only: playerId, points, ms, guessText
  };
};
```

### 4.6 One round on the wire

```
S→C  state    {phase:'round', roundNo:1, round:{kind:'bank', emoji:['🕷️','👨‍🦰','🕸️','🏙️'],
                category:'Film', shape:'_ _ _ _ _ _ - _ _ _', hints:0}, deadline:1738…}
C→S  guess    {text:'spider man'}
S→C  guessResult {ok:true, kind:'correct', points:340}
S→C  event    {kind:'playerCorrect', playerId:'p2', position:1}      → to everyone
S→C  state    {…players[p2].locked:true…}
S→C  event    {kind:'hint', level:1}                                  → t+15s
S→C  state    {…round.category:'Film · 2002 · superhero', hints:1…}
S→C  state    {phase:'reveal', round:{answer:'Spider-Man', results:[…]}}
```

---

## 5. Matching & content

### 5.1 Normalization

`normalize(s)` — applied to both the guess and every accepted answer, in this order:

1. Unicode NFKD, strip combining marks (`Amélie` → `Amelie`).
2. Lowercase, then trim and collapse internal whitespace.
3. Replace `&` with `and`; replace `'` `’` `-` `–` `_` `/` `.` `,` `:` `!` `?` with a space.
4. Drop everything that is not `[a-z0-9 ]` after that (this removes emoji, quotes, and any
   remaining punctuation).
5. Strip a leading article: `the`, `a`, `an` (English). Per-locale lists live beside it.
6. Collapse whitespace again.

`Spider-Man` → `spider man`. `THE Matrix!!` → `matrix`. `Amélie` → `amelie`.

### 5.2 Fuzzy match

After normalization, a guess is **correct** if it equals any accepted form, or if its
Damerau–Levenshtein distance to one is within a length-scaled tolerance:

| Normalized answer length | Tolerance |
|---|---|
| ≤ 4 | 0 — short answers are exact |
| 5–8 | 1 |
| 9–14 | 2 |
| ≥ 15 | 3 |

Two extra rules, both learned from watching people play games like this:

- **Distance-1 near misses inside the reject list are refused**, not accepted, and the
  guesser is told `close` rather than `wrong` — so `Alien` cannot win a round whose answer
  is `Aliens` just because the tolerance would have allowed it.
- **A guess that is a strict prefix of the answer and shorter than 70 % of it is `close`,
  not correct.** `spider` does not win `Spider-Man`; `spider man` does.

`close` results shake the input and cost a guess but do not end the player's round.

### 5.3 Puzzle schema

```jsonc
{
  "id": "film-spiderman-2002",
  "lang": "en",
  "category": "Film",
  "categoryFull": "Film · 2002 · superhero",   // hint 1
  "title": "Spider-Man",
  "aliases": ["spiderman", "spider man 2002"],  // normalized on load
  "reject": ["spider man 2", "spider man 3"],   // near misses that are other answers
  "emoji": ["🕷️", "👨‍🦰", "🕸️", "🏙️"],
  "difficulty": 1                                // 1 easy … 3 hard
}
```

`shared/puzzles.data.json` holds the bank. `validatePuzzles()` runs in a test and in CI and
enforces: unique ids; 1–8 emoji, each a real emoji sequence (§5.6); non-empty title; no
normalized title or alias claimed by two puzzles (a collision means a guess would be
ambiguous); every `reject` entry within distance 3 of the title (otherwise it is noise);
`difficulty` in range; `categoryFull` present.

### 5.4 The deck

Per room, the bank is filtered by `lang`, shuffled with a seeded RNG (seed = room code +
game number, so a rematch is a different deck), and then dealt in a difficulty ramp:
rounds 1–3 draw from difficulty 1, 4–6 from 1–2, 7+ from 2–3. Turn rounds draw their three
candidate titles from the same deck and consume all three, so a candidate the giver did not
pick cannot come back as a bank round later in the same game.

The bank ships 220 puzzles across Film, Phrase, Song, Book, TV, Game, Food, Place,
Fairy tale, Meme, Sport and Holiday (75 at difficulty 1, 109 at 2, 36 at 3, so every
rung of the ramp in §5.4 has a deep pool). Content notes for whoever writes them:

- **Read it aloud as a picture, not as a rebus of letters.** 🕷️👨‍🦰🕸️🏙️ is a picture.
  🅱️➕🅰️ is a crossword clue, and it is not fun on a phone.
- **4–6 emoji is the sweet spot.** Under 3 is usually ambiguous; over 6 stops parsing as
  one image on a 375 px screen.
- **Avoid emoji whose rendering differs wildly between iOS and Android** (🥺 and the
  gendered/skin-tone ZWJ sequences are the usual offenders); the puzzle must survive the
  worst renderer in the room.
- **Difficulty is about how well-known the answer is**, not how clever the emoji are.

### 5.5 Player-authored clues

The composer is an emoji keyboard, not a text field. The server nonetheless re-validates:
1–8 items; each item must match the emoji-sequence regex (`\p{RI}{2}` or
`\p{Extended_Pictographic}(️|\p{Emoji_Modifier})*(‍\p{Extended_Pictographic}…)*`)
with no other code points; the whole string is capped at 64 code points to stop a ZWJ bomb.
Anything else is refused with `bad_clue` and the tray is left as it was. Because the only
free text a player can emit is their nickname and their guesses (which are only ever shown
back to themselves), the game has no user-to-user text channel to moderate.

### 5.6 Localization

Room-level `lang` selects the bank and the article-stripping list. Everything player-facing
in the client goes through a flat `t('key')` lookup with the English table as the default.
Not doing this from the start is how you end up unable to add Catalan without a rewrite.

---

## 6. Client

### 6.1 Screens

| Screen | Phase | The one thing it must do |
|---|---|---|
| Home | — | Create a room, or type a code and a nickname, in under 10 seconds |
| Lobby | `lobby` | Show the code big enough to read across a table, and who is in |
| Round (bank) | `round` | Emoji huge, one input, one timer, no decoration |
| Pick | `round/pick` | Three tappable titles for the giver; a waiting state for everyone else |
| Compose | `round/compose` | An emoji keyboard and a tray of ≤8, with backspace and submit |
| Reveal | `reveal` | The answer, then who got it, in that order, with the deltas |
| Scoreboard | `scoreboard` | Rank, name, score, movement — nothing else |
| Game over | `over` | Podium and a rematch button that keeps the room |

Routing is state-driven, not URL-driven: the server's `phase` decides what renders. The only
URL that matters is `/#/r/ABCD`, which prefills the join code so the code can be shared as a
link instead of read aloud.

### 6.2 Visual direction

Dark, high-contrast, one accent. The emoji string is the hero — 15–20 vh, centred, with the
rest of the screen deliberately quiet. Type: system stack (`ui-sans-serif`) at large sizes;
nothing to load, nothing to shift. The timer is a thin bar at the top that drains, not a
number, until the last 10 seconds when it becomes a number and turns amber.

Motion is short and purposeful: score deltas fly up from the player row, the scoreboard
reorders with a 300 ms spring, a correct guess pulses the input green once. Everything
respects `prefers-reduced-motion`.

### 6.3 The phone keyboard problem

Fragment learned this the hard way (see its README): on iOS, the software keyboard covers
the layout instead of resizing it. Same fix here — a `visualViewport` listener sets a CSS
custom property with the visible height, the round screen shrinks the emoji block while the
keyboard is up rather than letting it scroll under, and the input stays pinned above the
keyboard. Also:

- `autocapitalize="none" autocorrect="off" autocomplete="off" spellcheck="false"` on the
  guess field — autocorrect turning `spidermam` into something else mid-race is infuriating,
  and the fuzzy matcher already handles the typo.
- `enterkeyhint="send"`, and the field never blurs after a submit, so a player can keep
  firing guesses without re-tapping.
- The emoji composer uses the OS emoji keyboard on iOS/Android via a hidden input, with the
  in-app grid as the fallback for anything that has no emoji key. Both feed the same tray.

### 6.4 Accessibility floor

Not a full audit; a floor, stated so it can be checked:

- Every interactive target ≥ 44 × 44 px.
- Contrast ≥ 4.5:1 for text, ≥ 3:1 for the timer bar and status colours.
- The emoji string carries an `aria-label` listing the emoji names, so a screen reader user
  gets "spider, man, spider web, cityscape" rather than silence.
- Correct/wrong is never colour alone — a tick, a cross, and a shake back it up.
- Live regions announce phase changes and hint reveals.
- `prefers-reduced-motion` disables the spring, the shake, and the pulse.

### 6.5 Copy

Short, second person, never cute about failure. "Nobody got it." not "Ouch, nobody got it! 😅".
The game is already made of emoji; the interface should not be.

---

## 7. Repo, build, deploy, testing

### 7.1 Stack

| Layer | Choice | Why |
|---|---|---|
| Client | Vite + React 18 + TypeScript strict + Tailwind | Same as Fragment; one toolchain to know |
| Client state | Zustand | The server owns the game; the store is a socket mirror |
| Server | Cloudflare Worker + Durable Objects | §3.1 |
| Rules | Plain TypeScript in `shared/`, zero deps | §3.2 |
| Tests | Vitest (Node) for `shared/`, `wrangler dev` + a scripted two-client game for the server | Fast where it matters, real where it matters |
| Deploy | One Worker: `[assets]` for the client + `wrangler deploy`, GitHub Actions | Free tier, one origin, no CORS |

### 7.2 Layout

```
rebus/
  SPEC.md                  this file
  package.json             npm workspaces: shared, server, client
  shared/src/
    config.ts              every timing and limit, frozen
    protocol.ts            wire types + PROTOCOL_VERSION
    state.ts               GameState, PlayerState, RoundState
    events.ts              GameEvent union
    reducer.ts             applyEvent — the whole game
    redact.ts              GameState -> GameStateView, per viewer
    match.ts               normalize, damerau, matchGuess
    scoring.ts             the formulas in §2.4
    roomcode.ts            alphabet, generate, validate
    rng.ts                 mulberry32 seeded RNG
    puzzles.ts             types, loader, validatePuzzles
    puzzles.data.json      the bank
  server/src/
    index.ts               Worker router: create room, upgrade socket
    room.ts                RoomDO — sockets, storage, alarms, effects
  client/src/
    net/socket.ts          reconnect, clock offset, message plumbing
    state/store.ts         Zustand store fed by the socket
    screens/…              Home, Lobby, Round, Compose, Reveal, Scoreboard, Over
    components/…           EmojiString, Countdown, GuessInput, PlayerList, EmojiTray
  test/                    Vitest suites for shared/ and a full-game integration test
```

The boundary rule: `shared/` may not import from `client/` or `server/`, and may not import
any runtime API that is not in both Node and Workers (no `window`, no `node:fs`). Enforced
by lint, the same way Fragment enforces `engine/` ⊥ React.

### 7.3 Local development

```bash
cd rebus
npm install
npm run dev          # wrangler dev on :8787 + vite on :5173, proxied
npm test             # vitest: rules, matcher, scoring, redaction, full-game
npm run typecheck
npm run lint
```

`npm run dev` is the only command needed to play locally on a phone: Vite listens on
`0.0.0.0`, so a phone on the same Wi-Fi can hit `http://<laptop-ip>:5173` and the client
talks to the local worker.

### 7.3b Practice rooms (no second phone)

`/single` is a one-player path through the real game: it creates a room, joins as you,
then adds `CONFIG.BOT_COUNT` scripted players (`addBot`, host-only, lobby-only) so
`MIN_PLAYERS_FOR_TURN_ROUND` is met without anyone else. From the Lobby on, it is the
ordinary multiplayer room — same screens, same socket, same reducer — not a separate
code path to keep in sync.

A bot is a `PlayerState` with `isBot: true` and no socket of its own; it never receives
a redacted view and acts straight out of the reducer's own true state, the same trusted
context the rules already run in, so there is no answer to leak. Its moves are queued as
`RoundState.botActions` — timestamps `onTick` already consumes the same way it consumes
a deadline — each with its own margin clear of the round's real clock, so a scripted
action is a courtesy, never a race with the real one:

- **Guessing.** Every eligible bot guesser gets its own, independent chance
  (`BOT_GUESS_CHANCE`) of ever locking in a guess at all, at a random moment in the
  window — so a round can end early once every bot (and you) have answered, or run the
  full clock if nobody did, same as any human.
- **Giving.** A bot giver always completes its turn: it picks the first candidate, then
  composes with that puzzle's own canonical emoji from the bank, rather than inventing
  one. The usual deadline fallback (auto-pick, then abandon to a bank round) still backs
  this up if anything goes wrong.

A bot never disconnects, so a room's "nobody is here" check (`sweep`, `nextAlarm`) asks
specifically whether a *human* is still connected — otherwise a practice room abandoned
after one person's visit would sit in storage, kept "alive" by its own bots, until
`ROOM_IDLE_MS` could never actually arrive.

### 7.4 Deploy

One Worker serves both halves. `npm run deploy` builds the client and runs
`wrangler deploy --config server/wrangler.toml`; there is no second deploy and no Pages
project.

- **Client** → `[assets] directory = "../client/dist"` in `server/wrangler.toml`. Requests
  to static assets are free and unlimited, so the client never draws down the Worker
  request budget. `not_found_handling = "single-page-application"` makes deep links work,
  and `run_worker_first = ["/api/*"]` keeps the API and the socket upgrade from being
  swallowed by the SPA fallback.
- **Why not Pages** → sharing an origin with the API removes CORS and removes `VITE_WS_URL`
  entirely (`client/src/net/socket.ts` already defaults to same-origin), and one deploy
  cannot skew client and server apart mid-party.
- **Server** → the same `wrangler deploy`. Durable Object migration `v1` declares `RoomDO`
  under `new_sqlite_classes`, which is what makes this free-tier deployable: SQLite-backed
  Durable Objects are the only kind the Workers Free plan can create, and are not billed
  for storage there. The free plan's 100k requests/day is the real ceiling, and a game is
  a few thousand requests.
- **CI** runs `lint`, `typecheck`, `test` and the client build on every push and pull
  request, then a full end-to-end game against a real Durable Object (`npm run
  test:e2e:ci`, which boots its own worker). `main` deploys after both pass, using the
  `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets.
- **Note** the repo is public specifically so Actions minutes stay unmetered; the free
  allowance for a private repo is 2,000 min/month and this pipeline would eat it.

### 7.4b The answer must not ship to the phone

§4.4 keeps a live answer out of every payload. The build is the same guarantee by
another route: `shared/` is one module graph, and the client imports `CONFIG` and the
wire types from its barrel, which also re-exports the bank. Only `sideEffects: false`
in `shared/package.json` lets Rollup drop it, and one `import { PUZZLES }` in client
code would put all 220 answers back in the bundle for any player to read.

`npm run check:bundle` (in `npm run ci`, after the build) fails if a puzzle id, a bank
field name or a long answer appears in the built client. It matches on ids and field
names rather than titles alone, because a minified React bundle genuinely contains
`return"Portal"` and hides "Up" inside `forceUpdate`.

### 7.5 Testing plan

| Suite | Covers |
|---|---|
| `match.test.ts` | A table of ~60 (guess, answer, expected) rows including every `close` and every must-fail |
| `scoring.test.ts` | Both formulas at boundaries: t=0, t=deadline, 0 correct, all correct, hint multipliers |
| `reducer.test.ts` | Every event in every phase, including the invalid combinations, which must be no-ops |
| `game.test.ts` | A scripted 9-round game with 4 players driven through the reducer: deterministic scores, turn rounds land on 3/6/9, a giver who times out, a player who disconnects and resumes |
| `redact.test.ts` | Property test: the answer never appears in a payload to a player who has not answered |
| `puzzles.test.ts` | `validatePuzzles()` over the shipped bank |
| `integration` | `wrangler dev` + two scripted WebSocket clients playing a real game against the real DO |

### 7.6 Risk register

| Risk | Mitigation |
|---|---|
| Emoji render differently across phones and a puzzle becomes unguessable | Content rule §5.4; a `renderRisk` flag on puzzles known to differ |
| Fuzzy matcher accepts a wrong answer | Reject lists, must-fail rows in the test table, `close` as the safety valve |
| DO hibernation loses in-flight state | State is persisted after every mutating event; in-memory is only a cache |
| A round stalls because an alarm did not fire | **Built.** After `STALL_AFTER_MS` past the deadline the client shows "Still going…" and pings every `STALL_NUDGE_MS`; the DO answers a ping whose deadline has passed with a `tick`, re-running its own deadline check. `tick` is deadline-guarded in the reducer, so a nudge is a no-op rather than a skip, and several phones nudging at once cannot double-advance. `test/stall.test.ts` |
| Player-authored clues are garbage | Giver scores 0 when nobody guesses; three-title choice removes "I don't know this one" |
| The bank runs dry for a regular group | Turn rounds; and the deck is per-game shuffled, so repeats are spread |
| Cost blowup from idle rooms | Hibernation + `ROOM_IDLE_MS` self-delete |

### 7.7 Phase exit criteria

- **P0** `npm test` green, including a full nine-round game driven entirely through the reducer.
- **P1** Two devices, one lobby, join/leave visible within 300 ms.
- **P2** Four people play a bank-only game to the podium with no console errors and no
  disagreement about the timer.
- **P3** Round 3 hands over, comes back with a composed clue, and the giver's score matches
  the formula by hand.
- **P4** A phone in airplane mode for 20 s mid-round returns to the same round with its score.
- **P5** A group that was not told the rules finishes a game without asking a question.

---

## 8. Status of the skeleton on this branch

What is implemented in `rebus/` right now, against the spec above:

**Done (phases 0–4):** the shared rules module and the pure reducer, the matcher with
the full normalization pipeline and the reject/prefix rules, both scoring formulas, the
seeded deck with its difficulty ramp, the 220-puzzle bank, redaction, the
stall recovery of §7.6, the Durable Object with hibernated
sockets and deadline alarms, room create/join/resume, host migration, lobby → bank
rounds → turn rounds → reveal → scoreboard → podium → rematch, and the React client for
all of those screens with the clock-offset countdown and the reconnect banner.

**Verified:** `npm test` is 79 passing assertions over the rules, including a scripted
nine-round four-player game and the redaction property test of §4.4. `npm run test:e2e`
plays a full five-round game — turn round, mid-game reconnect, rematch included —
through three real WebSocket clients against a real `wrangler dev` Durable Object, and
passes. The client has been driven through lobby, round, wrong guess, reveal and
scoreboard in two concurrent headless Chromium phones. It is deployed at
`https://rebus.rui-b69.workers.dev`, and the same five-round game has been played
against that deployment over real WebSockets.

**Not done, and deliberately:** the emoji composer uses the in-app grid only (the hidden-input path to the OS
emoji keyboard in §6.3 is specified but not wired); sound, share cards, the `t()`
localization table are absent; `test:e2e`
still expects a worker you started, but `test:e2e:ci` boots one itself and is what CI
runs; and no real-device pass has happened — everything in §6 has been exercised in
headless Chromium at phone size and reasoned about on iOS, which is exactly the caveat
Fragment's README carries and the reason it carries it.
