# Documentation map

Everything needed to understand what is being built is in this repository,
including mirrors of material whose working home is elsewhere.

## One project, two heads

- **eden4 / Sim (the larger head).** One persistent, shared, server-simulated world
  that people and their agents inhabit through owned **Souls**. `sim` (this repo)
  is its app shell: canonical state and log, sync, accounts, the three-tier brain,
  the agent interface, deployment. It wraps an engine.
- **The Mars world simulator (the smaller head, inside).** A deterministic world
  and activity engine being built first as a simulation of life at Mars College.
  When it reaches its milestones, eden4 takes the codebase over, generalizes it,
  and Mars becomes one world inside the larger one. Production runs a toy engine
  behind the same contract; `packages/engine-mars` runs the real one from a local
  checkout. The Mars code is local to Gene's laptop; only its documentation is
  mirrored here.

## Folders

| Folder | What | Home |
|---|---|---|
| [`STATUS.md`](STATUS.md) | What is built, live, measured, and not built, with dates | here |
| [`GLOSSARY.md`](GLOSSARY.md) | Terms (Soul, mind, intent, activity, fold, governor, …) | here |
| [`sim/`](sim/) | **How Sim works**: [architecture](sim/ARCHITECTURE.md), [engine contract](sim/ENGINE-CONTRACT.md), [protocol](sim/PROTOCOL.md), [API and MCP](sim/API.md), [brain](sim/BRAIN.md), [data](sim/DATA.md), [development](sim/DEVELOPMENT.md), [runbook](sim/RUNBOOK.md) | here |
| [`mars/`](mars/README.md) | **The Mars engine**: Sim's survey ([ENGINE-SNAPSHOT](mars/ENGINE-SNAPSHOT.md)) plus mirrored engine docs (vision, roadmap, spec, subsystems, frontier) | mirror of `<mars-campus-repo>` |
| [`eden4/`](eden4/README.md) | **Why and what**: the strategy notes `01`–`19` (vision, neutrality, economy, formalism, dials, specs, sprint, agent interface, the kernel and cards, the Mars bridge) and the decision ledger | mirror of `<eden4>` |
| [`frontier/`](frontier/README.md) | The open design discussion on where the simulation goes next, and its decision log | here |
| [`ONBOARDING-CLOUD.md`](ONBOARDING-CLOUD.md) | Prompt for an agent taking over the frontier discussion from this repo alone | here |

## Reading paths

| If you need to… | Read |
|---|---|
| Understand the project in ten minutes | this file → [`STATUS.md`](STATUS.md) → [`eden4/README.md`](eden4/README.md) |
| Change or debug Sim | [`sim/ARCHITECTURE.md`](sim/ARCHITECTURE.md) → the specific `sim/` doc → [`sim/DEVELOPMENT.md`](sim/DEVELOPMENT.md) |
| Deploy or operate | [`sim/RUNBOOK.md`](sim/RUNBOOK.md) |
| Build an agent that steers a Soul | [`sim/API.md`](sim/API.md), and the live `/skill.md` |
| Work on prompts or model cost | [`sim/BRAIN.md`](sim/BRAIN.md) |
| Understand the world's ontology (things, links, cards, plans, speech) | [`eden4/18-KERNEL-CARDS-AND-SELF-CHANGE.md`](eden4/18-KERNEL-CARDS-AND-SELF-CHANGE.md) → [`sim/ARCHITECTURE.md`](sim/ARCHITECTURE.md), and the live `/cards.md` |
| Understand or adopt the Mars engine | [`eden4/19-MARS-BRIDGE.md`](eden4/19-MARS-BRIDGE.md) → [`mars/ENGINE-SNAPSHOT.md`](mars/ENGINE-SNAPSHOT.md) → [`sim/ENGINE-CONTRACT.md`](sim/ENGINE-CONTRACT.md) → [`mars/README.md`](mars/README.md) |
| Know what has been decided | [`eden4/06-DECISIONS-AND-OPEN-QUESTIONS.md`](eden4/06-DECISIONS-AND-OPEN-QUESTIONS.md), [`frontier/DECISIONS.md`](frontier/DECISIONS.md) |
| Join the design discussion | [`frontier/README.md`](frontier/README.md), [`eden4/17-AGENT-INTERFACE.md`](eden4/17-AGENT-INTERFACE.md), the questions at the end of [`eden4/18`](eden4/18-KERNEL-CARDS-AND-SELF-CHANGE.md) and [`eden4/19`](eden4/19-MARS-BRIDGE.md), and the `notebook` tab of the running app |

## Which document wins

For how Sim behaves: the code, then `sim/`. For current state: `STATUS.md`. For
intent and decisions: `eden4/06`. The strategy notes `eden4/14`–`16` are specs and
plans with a currency note at the top of each; where they differ from `sim/`, `sim/`
is right. Mars docs describe Mars as of `mars/SNAPSHOT.txt`.

## Keeping mirrors fresh

`infra/sync-docs.sh` (run on Gene's laptop) re-copies `eden4/` and `mars/` from
their working homes. Edit the originals, then sync and commit. Everything else
under `docs/` is edited here.
