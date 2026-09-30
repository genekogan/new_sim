# The Mars world simulator (documentation snapshot)

The engine that eden4 will take over. Its code lives only in a local Git repo on
Gene's laptop (`<mars-campus-repo>`, never pushed); this
folder mirrors its documentation so the project can be understood from here.
`SNAPSHOT.txt` records the Mars commit and the copy date. **These files are
mirrors: do not edit them here.** Refresh with `infra/sync-docs.sh`.

The Mars project moves fast (hundreds of commits a day, releases daily), so
anything here describing "current" work is current as of the snapshot date.

## Start here

| File | Read it for |
|---|---|
| [`ENGINE-SNAPSHOT.md`](ENGINE-SNAPSHOT.md) | **Sim's own survey** (not a mirror): architecture, the contracts Sim mirrors, execution model, gaps the shell fills, what the transplant needs, roadmap summary |
| [`SIMULATION_VISION.md`](SIMULATION_VISION.md) | The product goal and boundaries; which documents are authoritative in Mars |
| [`ACTIVE_ROADMAP.md`](ACTIVE_ROADMAP.md) | What is being built now, the latest release, what comes next |
| [`SIMULATION_FRONTIER.md`](SIMULATION_FRONTIER.md), [`SIMULATION_FRONTIER_APPLICATIONS.md`](SIMULATION_FRONTIER_APPLICATIONS.md) | Where the simulation should go next: multi-day projects, commitments, relationships; what is Mars-specific and what generalizes to Eden. The basis of `../frontier/` |

## Engine reference

| File | Subject |
|---|---|
| [`ENGINE_GUIDE.md`](ENGINE_GUIDE.md) | The hard rules of the engine (determinism, fixed step, dependencies) |
| [`ENGINEERING.md`](ENGINEERING.md) | How the codebase is organized and worked on |
| [`SPEC.md`](SPEC.md) | The engine specification |
| [`TAKES_AND_PLANS.md`](TAKES_AND_PLANS.md) | Plans bound to world state, rehearsal, execution, takes (recorded runs), staleness |
| [`MOVEMENT.md`](MOVEMENT.md), [`CARRY.md`](CARRY.md), [`VEHICLES.md`](VEHICLES.md) | Locomotion and pathing, carrying loads, vehicles |
| [`BODY_MODEL.md`](BODY_MODEL.md), [`POSES.md`](POSES.md) | The human body model and procedural poses |
| [`SOCIAL.md`](SOCIAL.md), [`ITEMS.md`](ITEMS.md) | Social behaviours (gathering, conversation); small held items |
| [`CAMERA.md`](CAMERA.md) | Shot specs, planning, the camera track format |
| [`PLANNING_BUDGET.md`](PLANNING_BUDGET.md) | Performance measurements and planning budgets |
| [`LIB_EVAL.md`](LIB_EVAL.md), [`RESEARCH.md`](RESEARCH.md) | Libraries evaluated and rejected or kept; background research |

## App, server and operations

| File | Subject |
|---|---|
| [`MARS-README.md`](MARS-README.md), [`MARS-ROADMAP.md`](MARS-ROADMAP.md) | The Mars repo's own README and long-range roadmap |
| [`LAB-README.md`](LAB-README.md), [`LAB_GUIDE.md`](LAB_GUIDE.md) | The `/lab` live sandbox |
| [`SIMULATION-SERVER-README.md`](SIMULATION-SERVER-README.md) | The Cloudflare Worker + Durable Object server |
| [`SIMULATION-AGENT-GUIDE.md`](SIMULATION-AGENT-GUIDE.md) | The guide Mars serves to agents that drive it over MCP |
| [`HANDOFF.md`](HANDOFF.md) | The running session handoff (long; a log, not a summary) |
| [`OWNER_DECISIONS.md`](OWNER_DECISIONS.md), [`AUDIT.md`](AUDIT.md) | Gene's recorded decisions; an audit of the codebase |

Not mirrored (available only in the Mars repo): the progress log, backlog,
release checklists, question files, per-feature briefs and evidence.

## How Mars relates to Sim

Sim's `packages/engine-contract` mirrors the Mars engine's types and method names
so that adopting the engine is an adapter, not a rewrite: see
[`../sim/ENGINE-CONTRACT.md`](../sim/ENGINE-CONTRACT.md) for the mapping and for
what the transplant requires of Mars.
