# Development

Requirements: Node ≥ 22.18 (the server runs TypeScript by unflagged type stripping,
so no enums or parameter properties, and uses `node:sqlite` with `backup`), pnpm 10.

```bash
pnpm install
cp .env.example .env          # fill keys, or leave them empty and use the fake brain
pnpm check                    # type check (all packages) + tests
pnpm --filter @sim/web build
BRAIN_MODE=fake DEV_AUTH=1 node --env-file=.env apps/server/src/main.ts
# open http://localhost:4500/?dev=1  (dev sign-in; the name "admin" is an admin)
```

For front-end work with hot reload, `pnpm dev` runs Vite on :5173 (proxying `/v1`,
`/ws`, `/skill.md`, `/mcp`, `/healthz` to :4500; `/cards.md` is not proxied) and the
server with `--watch`; the server's data then lands in `apps/server/data/`.

Always run locally with `BRAIN_MODE=fake` unless you are testing the models: a live
local server spends real money around the clock. In fake mode the compiler is
off, so a typed wish goes to the translator; agendas and card proposals still work.

## Layout

| Package | What |
|---|---|
| `packages/kernel` | meaning: things, links, the five changes, the coherence rule, cards, base vocabulary |
| `packages/engine-contract` | the engine interface, scaffold runtime, hashing, RNG, kinematics, conformance suite |
| `packages/engine-toy` | the toy engine (default) |
| `packages/engine-mars` | the Mars adapter; imports the Mars engine from a local checkout |
| `packages/brain` | request builders and interpreters for every model call; the card grammar text |
| `packages/protocol` | everything that crosses a process boundary |
| `packages/client` | replica and connection, for browsers and Node |
| `apps/server`, `apps/web` | the server process and the web app |

## Environment variables

Read in `apps/server/src/config.ts`, except `DEV_AUTH` (`auth.ts`) and
`MARS_ENGINE_DIR` (`packages/engine-mars/src/load.ts`).

| Variable | Default | Meaning |
|---|---|---|
| `PORT`, `HOST` | 4500, 127.0.0.1 | listen address |
| `DATA_DIR` | `./data` | SQLite file and on-box backups |
| `PUBLIC_URL` | `http://localhost:$PORT` | fallback base URL (requests use their own host) |
| `PRIVY_APP_ID`, `PRIVY_APP_SECRET` | none | sign-in; without them logins are disabled |
| `ADMIN_EMAILS` | none | comma-separated admin emails |
| `TYPESAFE_API_KEY`, `ANTHROPIC_API_KEY` | none | Jev and the Anthropic models; without a key that tier runs fake or is off |
| `BRAIN_MODE` | `live` | `fake` = no model calls. Any other value means live |
| `BRAIN_BUDGET_USD_PER_DAY` | 0.5 | governor budget |
| `NARRATOR_MODEL` | `claude-haiku-4-5-20251001` | narrator, and the translator's second pass |
| `COMPILER_MODEL` | `NARRATOR_MODEL` | the compiler |
| `TALK_MODEL` | `NARRATOR_MODEL` | spoken words |
| `ENGINE` | `toy` | `mars` runs the Mars adapter; any other value means toy |
| `MARS_ENGINE_DIR` | `<mars-campus-repo>/viewer/engine` | where the Mars engine checkout is |
| `INVITE_REQUIRED` | on (`0` disables) | invite gate |
| `MAX_SOULS_PER_USER` | 5 | |
| `SNAPSHOT_EVERY_TICKS` | 6000 | 5 minutes at rate 1 |
| `SEED_NATIVES` | on (`0` disables) | seed six native Souls into an empty world |
| `WORLD_SEED` | `sim-genesis-1` | genesis RNG seed |
| `DEV_AUTH` | off | `1` accepts `Bearer dev:<name>`; never set in production |
| `WEB_DIR`, `BUILD_ID` | built web app, `BUILD` file (else `dev`) | |

Cost for the three Anthropic model variables is always computed at Claude Haiku
4.5 prices, whatever model is named.

## Running on the Mars engine

The Mars engine is not in this repository and is not published. With a checkout
at the default path or at `MARS_ENGINE_DIR`:

```bash
ENGINE=mars BRAIN_MODE=fake DEV_AUTH=1 DATA_DIR=./data-mars node --env-file=.env apps/server/src/main.ts
```

Use a separate `DATA_DIR` per engine: a snapshot is bound to the engine's rules
version, and the decisions and plays in a log name that engine's places. Without
a checkout the server exits at start with "Mars engine not found". See
`ENGINE-CONTRACT.md` for what the adapter does.

## Tests

34 run everywhere; 17 more run only where a Mars checkout exists (51 in all).
Without one, the two Mars test files each report a single skipped test.

| Where | What |
|---|---|
| `packages/engine-contract` (4) | hashing, rng |
| `packages/kernel` (6) | the coherence rule, card validation, the DJ story as independent plays, determinism, one-step lookahead, forged speech and bounds |
| `packages/engine-toy` (8) | the six conformance tests + two toy scenarios |
| `packages/brain` (6) | request builders, selection policy, translator, narrator sanitizer |
| `apps/server/src/replay.test.ts` (3) | replay from genesis equals live (engine and kernel, and the kernel alone); restart from snapshot + fast-forward; a world from before the kernel gets one and still replays |
| `apps/server/src/sync.test.ts` (6) | real server + WebSocket clients: late joiners agree, dropped socket resumes from the ring, corrupted replica resyncs, invite gate, full Soul / pairing / agent / MCP / privacy flow, the DJ story through agent-proposed cards and two agendas |
| `apps/server/src/brain.test.ts` (1) | fair mid-brain scheduling |
| `packages/engine-mars` (13, Mars only) | the six conformance tests; programs step by step; refusal of an impossible first step; raw `mars:` verbs; borrowed joint staging; one of Mars's own scenarios as four programs; restore mid-program; keyframes and tick cost with twenty walkers |
| `apps/server/src/mars.test.ts` (4, Mars only) | the shell on Mars: replay, restart from a snapshot, clients fed keyframes, the DJ story on a real server process |

```bash
pnpm test                              # everything; Mars tests skip without a checkout
pnpm --filter @sim/engine-mars test    # the adapter alone
MARS_ENGINE_DIR=/path/to/viewer/engine pnpm --filter @sim/server test
```

CI (`.github/workflows/ci.yml`) runs type check, tests and the web build on pushes
to `main` and on pull requests. It has no Mars checkout, so the Mars tests skip there.
`infra/deploy.sh` runs the same gate before deploying.

## Conventions

- Anything crossing a process boundary goes in `packages/protocol`.
- Engine code is deterministic: no `Date.now`, no `Math.random`; randomness comes
  from `world.rng`. The toy engine and the shared kinematics use no transcendental
  `Math.*` in positions, because clients recompute them. The Mars adapter does
  (`cos`, `sin`, `atan2` when it picks goal points) and sends keyframes instead.
- Kernel code is deterministic and total: a change applies or is refused with a
  reason. New thing ids come from `KState.nextId`.
- Model output never touches the engine or the kernel except as a logged event.
- Meaning changes only through logged events: a card's effects are a `play`, new
  vocabulary is a `mint`, a deck change is a `deck`.
- Docs whose home is elsewhere (`docs/eden4`, `docs/mars`) are mirrors; edit the
  originals and run `infra/sync-docs.sh`.
