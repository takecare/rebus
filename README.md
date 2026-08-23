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
| `npm run test:e2e:ci` | The same game, but it starts and stops the worker itself |
| `npm run ci` | Everything CI runs: lint, typecheck, test, build |
| `npm run deploy` | Builds the client and deploys client + worker as one Worker |

## Deploying

The client and the API ship as a **single Cloudflare Worker**: the built client is
served from `[assets]` in `server/wrangler.toml`, and `/api/*` is routed to the Worker
ahead of the SPA fallback. That keeps everything on one origin, so there is no CORS and
no `VITE_WS_URL` to configure — `client/src/net/socket.ts` already defaults to the
origin it was served from.

```bash
npx wrangler login
npm run deploy
```

It fits the **Workers Free plan**: static asset requests are free and unlimited, and the
room Durable Object is declared under `new_sqlite_classes`, which is the only kind of
Durable Object the free plan can create and is not billed for storage there. The
practical ceiling is the free plan's 100k Worker requests/day.

CI runs on GitHub Actions (`.github/workflows/ci.yml`) on every push and pull request:
lint, typecheck, unit tests and the client build, then a full end-to-end game against a
real Durable Object. Pushes to `main` deploy after both jobs pass, which needs two repo
secrets, `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

> This repository is public so that Actions minutes stay unmetered. Making it private
> again puts CI back on the 2,000 min/month free allowance.

## Where the interesting parts are

- `shared/src/reducer.ts` — every rule in the game, in one pure function.
- `shared/src/match.ts` — normalization, edit-distance tolerance, and the reasons
  `spider` does not win a round whose answer is `Spider-Man`.
- `shared/src/redact.ts` — the one function allowed to produce something sendable.
  A live round's answer is not in any payload, for anyone, including players who
  already answered.
- `server/src/room.ts` — the Durable Object: hibernated sockets, one alarm, no rules.
