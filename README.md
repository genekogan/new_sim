# Sim

The app shell of **eden4**: one persistent, shared, server-simulated world whose
inhabitants, called **Souls**, belong to people who steer them and are kept alive
by a three-tier brain. Live at https://sim.eden.art.

This is a two-headed project. **Sim** (this repo) is the larger head: canonical
state and log, sync, accounts, the brain, the agent interface, deployment. The
smaller head, inside it, is the **Mars world simulator**: a deterministic world
and activity engine being built separately, which eden4 will take over as its
engine. Until then Sim runs a **toy engine** (a 100 m plane, a campfire, benches)
behind the same contract, and the UI is a text-only debug shell.

**Start with [`docs/README.md`](docs/README.md)**: the documentation map, reading
paths by task, current status and glossary.

## Layout

| Path | What |
|---|---|
| `packages/engine-contract` | The engine contract mirrored from the Mars engine (`WorldState`, `Runtime`, `ActionDef`, hashing, rng, timed-path kinematics) and a conformance suite any engine must pass |
| `packages/engine-toy` | The stand-in engine |
| `packages/protocol` | Everything that crosses a process boundary: log events, WebSocket messages, REST schemas |
| `packages/brain` | Jev client and request builders (mid-brain, translator, director), narrator prompt |
| `packages/client` | Client replica and reconnecting connection (browser and Node) |
| `apps/server` | The sequencer: tick loop, event log, snapshots, WebSocket hub, REST, MCP, auth, brain scheduler, governor |
| `apps/web` | React + Vite: watch view, Soul dashboard, debug panels |
| `infra/` | systemd units, Caddy site, Litestream config, deploy / rollback / box setup, docs sync |
| `docs/` | `sim/` technical docs · `mars/` the engine (snapshot) · `eden4/` strategy · `frontier/` open design discussion |

## Quick start

```bash
pnpm install
cp .env.example .env
pnpm check                                   # type check + 26 tests (Node ≥ 22.18)
pnpm --filter @sim/web build
BRAIN_MODE=fake DEV_AUTH=1 node --env-file=.env apps/server/src/main.ts
# http://localhost:4500/?dev=1
```

Details: [`docs/sim/DEVELOPMENT.md`](docs/sim/DEVELOPMENT.md). Production:
[`docs/sim/RUNBOOK.md`](docs/sim/RUNBOOK.md).
