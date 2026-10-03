# Sim

The eden4 app at [sim.eden.art](https://sim.eden.art): four persistent worlds with
owned Souls, recorded 3D watching, private owner steering, and independent clocks,
logs, checkpoints and model budgets. The deterministic Mars engine is hard-forked
in this repository with filtered history. Canonical checkout: `<repo>`.

Live worlds: `/w/toy`, `/w/mars`, `/w/littlemartians`, `/w/eden`. The original Toy
rules and database are preserved. Three paused browser Labs and eight Mars year
pages share the release. The independent legacy Mars app remains untouched.

Start with [the documentation map](docs/README.md), [current status](docs/STATUS.md)
and [development](docs/sim/DEVELOPMENT.md). Before operating the server, read the
[runbook](docs/sim/RUNBOOK.md). Design intent and implementation evidence have
separate authorities; see the map before following an older plan.

## Layout

| Path | Role |
|---|---|
| `mars/` | Vendored Mars engine, native viewer/Lab, tests and inherited docs |
| `worlds/` | World definitions, public derivative assets and authored scenes |
| `packages/engine-contract`, `engine-toy`, `engine-mars` | Shared contract, preserved Toy, native Mars adapter |
| `packages/kernel` | Meaning, links, cards, vocabulary and coherence |
| `packages/protocol`, `client`, `brain` | Wire schemas, replica, model request builders |
| `apps/server` | World host, log/replay, auth, steering, REST/MCP, spend and archives |
| `apps/web` | Shared recorded 3D shell and owner/debug panels |
| `infra/` | Scoped Sim deployment, rollback, watchdog, qualification and docs tools |
| `docs/` | Current technical docs, strategy mirrors and dated evidence |

## Local quick start

Node ≥22.18 and pnpm 10.27:

```bash
pnpm install --frozen-lockfile
cp .env.example .env
pnpm --filter @sim/web build
BRAIN_MODE=fake DEV_AUTH=1 DATA_DIR=./data-local node --env-file=.env apps/server/src/main.ts
# http://localhost:4500/?dev=1
```

`pnpm check` runs workspace typechecks, Sim tests and the vendored native engine
suite. Local work uses fake minds and isolated data. See development for a Mars
camp process, static Labs, asset builds and browser verification.
