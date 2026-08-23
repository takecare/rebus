# Rebus

A real-time multiplayer party game for phones. The server shows a string of emoji;
everyone races to type what it means. Every third round, one of the players writes
the emoji instead.

See [`SPEC.md`](./SPEC.md) for the design document this implementation follows, and
its §8 for what is and is not built yet.

## Stack

Vite + React 18 + TypeScript (strict) + Tailwind on the phone, a Cloudflare Worker
with one Durable Object per room on the server, and a dependency-free rules module
in `shared/` that both sides import.

The whole game is a pure function: `applyEvent(state, event, ctx) -> { state, effects }`.
The Durable Object turns sockets and alarms into events and effects back into sends
and alarms; it contains no game rules. That is why a nine-round game with a
disconnect, a timeout and a rematch runs as a unit test in a few milliseconds.

```
shared/src/    the rules: reducer, matcher, scoring, redaction, puzzle bank
server/src/    Worker router + RoomDO (hibernated WebSockets, deadline alarms)
client/src/    screens, socket with reconnect + clock offset, Zustand mirror
test/          Vitest suites, plus an end-to-end driver for a live worker
```

## Getting started

```bash
npm install
npm run dev:server     # wrangler dev on :8787
npm run dev:client     # vite on 0.0.0.0:5173, /api proxied to the worker
```

Open `http://<your-laptop-ip>:5173` on a phone on the same Wi-Fi to play for real.
`npm run dev` starts both in one shell if you prefer.

## Scripts

| Script | What it does |
|---|---|
| `npm test` | Vitest: matcher, scoring, reducer, whole-game, redaction, puzzle bank |
| `npm run typecheck` | `tsc` over shared+tests, the worker, and the client |
| `npm run lint` | ESLint, including the rule that keeps `shared/` runtime-agnostic |
| `npm run build` | Production client bundle |
| `npm run test:e2e` | Three scripted clients play a full game against a running `wrangler dev` |

## Where the interesting parts are

- `shared/src/reducer.ts` — every rule in the game, in one pure function.
- `shared/src/match.ts` — normalization, edit-distance tolerance, and the reasons
  `spider` does not win a round whose answer is `Spider-Man`.
- `shared/src/redact.ts` — the one function allowed to produce something sendable.
  A live round's answer is not in any payload, for anyone, including players who
  already answered.
- `server/src/room.ts` — the Durable Object: hibernated sockets, one alarm, no rules.
