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
`/ws`, `/skill.md`, `/cards.md`, `/mcp`, `/healthz` to :4500) and the
server with `--watch`; the server's data then lands in `apps/server/data/`.

Always run locally with `BRAIN_MODE=fake` unless you are testing the models: a live
local server spends real money around the clock. In fake mode the compiler is
off. Toy commands use the translator; living worlds use bounded code alignment
for existing cards. Agendas and card proposals still work.

## Layout

| Package | What |
|---|---|
| `packages/kernel` | meaning: things, links, the five changes, the coherence rule, cards, base vocabulary |
| `packages/engine-contract` | the engine interface, scaffold runtime, hashing, RNG, kinematics, conformance suite |
| `packages/engine-toy` | the toy engine (default) |
| `packages/engine-mars` | the Mars adapter; imports the hard-forked Mars engine under `mars/` |
| `packages/brain` | request builders and interpreters for every model call; the card grammar text |
| `packages/protocol` | everything that crosses a process boundary |
| `packages/client` | replica and connection, for browsers and Node |
| `apps/server`, `apps/web` | the server process and the web app |

## Environment variables

Read in `apps/server/src/config.ts`, except `DEV_AUTH` (`auth.ts`). The Mars
engine always loads from the hard fork inside this repository.

| Variable | Default | Meaning |
|---|---|---|
| `PORT`, `HOST` | 4500, 127.0.0.1 | listen address |
| `DATA_DIR` | `./data` | SQLite file and on-box backups |
| `PUBLIC_URL` | `http://localhost:$PORT` | fallback base URL (requests use their own host) |
| `PRIVY_APP_ID`, `PRIVY_APP_SECRET` | none | sign-in; without them logins are disabled |
| `ADMIN_EMAILS` | none | comma-separated admin emails |
| `TYPESAFE_API_KEY`, `ANTHROPIC_API_KEY` | none | Jev and the Anthropic models; without a key that tier runs fake or is off |
| `BRAIN_MODE` | `live` | `fake` = no model calls. Any other value means live |
| `BRAIN_BUDGET_USD_PER_DAY` | 0.5 | rolling real-24-hour budget; clamped to $0–$1, reserved before provider calls |
| `ENABLE_LIVING_WORLD` | off | `1` enables the persistent non-Toy world day |
| `NARRATOR_MODEL` | `claude-haiku-4-5-20251001` | narrator, and the translator's second pass |
| `COMPILER_MODEL` | `NARRATOR_MODEL` | the compiler |
| `TALK_MODEL` | `NARRATOR_MODEL` | spoken words |
| `ENGINE` | `toy` | `mars` runs the Mars adapter; any other value means toy |
| `INVITE_REQUIRED` | on (`0` disables) | invite gate |
| `MAX_SOULS_PER_USER` | 20 | Per-account body limit in a world; Soul minds run at the edge. |
| `SNAPSHOT_EVERY_TICKS` | 6000 | 5 minutes at rate 1 |
| `SEED_NATIVES` | on (`0` disables) | Toy seeds its original cast; new worlds seed the defined cast owned by `WORLD_OWNER_ID` |
| `WORLD_SEED` | `sim-genesis-1` | genesis RNG seed |
| `DEV_AUTH` | off | `1` accepts `Bearer dev:<name>`; never set in production |
| `WEB_DIR`, `BUILD_ID` | built web app, `BUILD` file (else `dev`) | |

Provider prices come from the named-model admission registry; unknown models
refuse admission. Durable reservations bound spend before calls.

## Running on the Mars engine

The Mars engine is hard-forked under `mars/viewer/engine`; deployment and CI
need no external laptop checkout. For an isolated camp process:

```bash
WORLD_KEY=mars WORLD_OWNER_ID=dev:admin ENABLE_LIVING_WORLD=1 ENGINE=mars BRAIN_MODE=fake DEV_AUTH=1 DATA_DIR=./data-mars node --env-file=.env apps/server/src/main.ts
```

Use a separate `DATA_DIR` per engine: a snapshot is bound to the engine's rules
version, and the decisions and plays in a log name that engine's places. Use `WORLD_KEY=littlemartians` or `eden` for the other places, always with an
explicit owner; Toy uses its independent original rules and data. See
`ENGINE-CONTRACT.md` for what the adapter does.

## Tests

The in-repo engine is required; no Mars tests skip merely because the original
laptop checkout is absent. Current dated counts and evidence are in
[STATUS](../STATUS.md) and the qualification note, rather than frozen here.

```bash
pnpm check                            # workspace types, Sim suites, native engine
pnpm --filter @sim/server test        # server replay, persistence, auth, steering, budget, sync
pnpm --filter @sim/engine-mars test    # adapter, worlds, phase-aware restart, construction
pnpm test:mars                        # deterministic native engine suite
pnpm test:mars:release                # long inherited full gate; requires isolated public fixtures
```

CI runs workspace typechecks, recursive package tests and the web build. The
release script additionally runs `pnpm check`, including native engine cases.
The original full native gate and focused repairs are distinct evidence; see
[qualification](../MERGE-QUALIFICATION-20261003.md). Do not rerun passing long
checks without a relevant change or unresolved finding.

## Static app and assets

The web quick start builds the shared shell only. For Lab/year-page work:

```bash
SIM_STATIC=1 pnpm --filter mars-campus-viewer build:static
node infra/copy-decoders.mjs
```

Production Caddy routes `/w/<key>/` to the matching process. Server `main.ts`
strips its own world prefix before HTTP/WS routing. Local Vite hot reload proxies the root Toy API;
run a separately built camp server for camp work, or use a scoped local proxy
for several processes. It does not reproduce the production world routing by itself.
Use a separate data directory and port for each process. New worlds require
`ENGINE=mars`, `ENABLE_LIVING_WORLD=1` and an explicit `WORLD_OWNER_ID` (local
`dev:admin` only with DEV_AUTH). No credentials are needed for fake minds.

`ARCHIVE_TAKES` defaults off locally; enable only for an authorized scoped R2
proof. `WORLD_ID` defaults to `<WORLD_KEY>-1` (`toy-1` for Toy), `WORLD_PATH` to
`/w/<WORLD_KEY>`, and `R2_PREFIX` to `sim`. Staging overrides the prefix to
`sim/staging`. Configuration is defined in `apps/server/src/config.ts`.
Never run native source-archive preparation against the protected source trees.
For browser cache, proof bundles and the ten-route smoke, see [E2E](../../E2E.md).

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
- Strategy mirrors are edited at `<eden4>` then synced. Native mirrors
  come from the authorized in-repo fork; do not edit protected original Mars.
  Sim-authored introductions are edited here. See the documentation map.
