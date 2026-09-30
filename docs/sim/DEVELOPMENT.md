# Development

Requirements: Node ≥ 22.13 (the server runs TypeScript by type stripping, so no
enums or parameter properties), pnpm 10.

```bash
pnpm install
cp .env.example .env          # fill keys, or leave them empty and use the fake brain
pnpm check                    # type check (all packages) + tests
pnpm --filter @sim/web build
BRAIN_MODE=fake DEV_AUTH=1 node --env-file=.env apps/server/src/main.ts
# open http://localhost:4500/?dev=1  (dev sign-in; the name "admin" is an admin)
```

Always run locally with `BRAIN_MODE=fake` unless you are testing the models: a live
local server spends real money around the clock.

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `PORT`, `HOST` | 4500, 127.0.0.1 | listen address |
| `DATA_DIR` | `./data` | SQLite file and on-box backups |
| `PUBLIC_URL` | `http://localhost:$PORT` | fallback base URL (requests use their own host) |
| `PRIVY_APP_ID`, `PRIVY_APP_SECRET` | none | sign-in; without them logins are disabled |
| `ADMIN_EMAILS` | none | comma-separated admin emails |
| `TYPESAFE_API_KEY`, `ANTHROPIC_API_KEY` | none | Jev and Haiku; without a key that tier runs fake |
| `BRAIN_MODE` | `live` | `fake` = no model calls |
| `BRAIN_BUDGET_USD_PER_DAY` | 0.5 | governor budget |
| `NARRATOR_MODEL` | `claude-haiku-4-5-20251001` | |
| `INVITE_REQUIRED` | on (`0` disables) | invite gate |
| `MAX_SOULS_PER_USER` | 5 | |
| `SNAPSHOT_EVERY_TICKS` | 6000 | 5 minutes at rate 1 |
| `SEED_NATIVES` | on | seed six native Souls into an empty world |
| `WORLD_SEED` | `sim-genesis-1` | genesis RNG seed |
| `DEV_AUTH` | off | accept `Bearer dev:<name>`; never set in production |
| `WEB_DIR`, `BUILD_ID` | built web app, `BUILD` file | |

## Tests (26)

| Where | What |
|---|---|
| `packages/engine-contract` | hashing, rng |
| `packages/engine-toy` | the six conformance tests + two toy scenarios |
| `packages/brain` | request builders, selection policy, translator, narrator sanitizer |
| `apps/server/src/replay.test.ts` | replay from genesis equals live; restart from snapshot + fast-forward |
| `apps/server/src/sync.test.ts` | real server + WebSocket clients: late joiners agree, dropped socket resumes from the ring, corrupted replica resyncs, invite gate, full Soul / pairing / agent / MCP / privacy flow |
| `apps/server/src/brain.test.ts` | fair mid-brain scheduling |

CI (`.github/workflows/ci.yml`) runs type check, tests and the web build on every push.
`infra/deploy.sh` runs the same gate before deploying.

## Conventions

- Anything crossing a process boundary goes in `packages/protocol`.
- Engine code is deterministic: no `Date.now`, no `Math.random`, no transcendental
  `Math.*` in positions; randomness comes from `world.rng`.
- Model output never touches the engine except as a logged event.
- Docs whose home is elsewhere (`docs/eden4`, `docs/mars`) are mirrors; edit the
  originals and run `infra/sync-docs.sh`.
