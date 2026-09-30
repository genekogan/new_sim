# Documentation map

This repository is meant to be self-sufficient: everything needed to understand
what is being built is here, including material whose working home is elsewhere.

## One project, two heads

- **eden4 / Sim (the larger one).** One persistent, shared, server-simulated world
  that people and their agents inhabit through owned **Souls**. `sim` (this repo)
  is its app shell: canonical state and log, sync, accounts, the three-tier brain,
  the agent interface, deployment. It wraps an engine.
- **The Mars world simulator (the smaller one, inside).** A deterministic world and
  activity engine being built first as a simulation of life at Mars College. It is
  the engine Sim is designed to wrap. When Mars reaches its milestones, its
  development stops as a separate effort, eden4 takes the codebase over and
  generalizes it, and Mars becomes one world inside the larger one. Until then Sim
  runs a toy engine behind the same contract.

The Mars code lives only on Gene's laptop (local Git, never pushed); what is here
is a documentation snapshot of it, not the code.

## Where things are

| Folder | What | Working home |
|---|---|---|
| `../README.md`, `RUNBOOK.md` | What Sim is, how it is laid out, how it runs on the box | this repo |
| `eden4/` | The eden4 strategy documents, numbered `01`–`17` plus the illustrated report: vision, bodies, neutrality and versioned rules, economy, state formalism, engine frontier, dials, MVP spec, scaffold spec as built, hardening sprint, agent interface | `<eden4>/` on Gene's laptop |
| `frontier/` | The open design discussion on where the simulation goes next (lives, projects, commitments, places), its decision log, and `MARS-ENGINE-SNAPSHOT.md` | this repo |
| `frontier/mars/` | Snapshot of the Mars engine's own docs: frontier, vision, roadmap, engineering guide, spec, handoff, takes and plans, camera, body, movement, social, items, vehicles, planning budget, lab and server guides. `SNAPSHOT.txt` records the Mars commit and date | `<mars-campus-repo>/docs/engineering/` |
| `ONBOARDING-CLOUD.md` | Prompt for an agent taking over the frontier discussion from this repo alone | this repo |

Reading order for a newcomer: `../README.md` → `eden4/README.md` and `eden4/01`–`06`
→ `frontier/MARS-ENGINE-SNAPSHOT.md` → `eden4/15` (what is built) → `frontier/README.md`.

## Keeping the snapshots fresh

`infra/sync-docs.sh` (run on Gene's laptop) re-copies `eden4/` and `frontier/mars/`
from their working homes. The copies here are read-only mirrors: edit the
originals, then sync. Documents whose home is this repo (`frontier/README.md`,
`frontier/DECISIONS.md`, `frontier/MARS-ENGINE-SNAPSHOT.md`, this file) are edited here.
