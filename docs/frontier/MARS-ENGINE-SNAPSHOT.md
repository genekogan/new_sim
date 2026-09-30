# The Mars engine, as surveyed for Sim (snapshot)

Surveyed 2026-09-30 from `<mars-campus-repo>`
(local-only Git, HEAD `5c8672d`, release 21 deployed). This is what the Sim shell
is built to wrap. The engine keeps moving at hundreds of commits a day, so treat
numbers as a dated snapshot and re-read the copied docs in `mars/` for direction.
Nothing in Sim modifies that repo.

## What it is

Mars Studio: a deterministic world and activity engine plus a three.js viewer,
built to simulate life at Mars College (building, classroom, food, social life),
explicitly framed as "the first substantial application of a reusable world and
activity framework" (`mars/SIMULATION_VISION.md`). Gene's plan: finish Mars, then
stop Mars development and let eden4 take the codebase over, generalize it, and
make Mars one world inside it.

## Shape of the code (`viewer/`)

| Folder | Lines | Role |
|---|---|---|
| `engine/` | ~57k (19k tests) | pure TypeScript, no DOM, no `Date.now`/`Math.random`; zod is the only dependency |
| `app/` | ~18k | React 19 + three.js 0.185 (not R3F); `/lab` live sandbox, `/studio` historical museum |
| `simulation/` | ~1.8k | Cloudflare Worker + one SQLite Durable Object per room/year; MCP over Streamable HTTP + REST |
| `deploy/`, `e2e/` | ~11k | release gate, Playwright |

Engine modules by size: construction 8.4k (racks, beams, stairs; Mars-specific),
camera 4.6k, campus 3.4k (Mars-specific), vehicles 2.5k, api 2.1k, carry 2k,
locomotion 1.7k, spatial 1.6k (0.1 m raster, A*, traffic), runtime 1.4k,
activities 1.3k (classroom), world 1.2k, social 1.1k, take 1.1k, sequence 0.9k.

## Contracts Sim mirrors (in `packages/engine-contract`)

- `WorldState { schema, base, tick, entities, regions, env, inventory, rng }`
  (`mars-world/1`); `Entity { id, def, kind, pose, provenance, human?, … }`;
  `Region { id, kind, polygon }`; `RngState` = sfc32 inside the state.
- `hashOf = sha256(stableStringify(x))`; `physicalView` drops labels, provenance,
  tick and env, so plans bind to a `physicalHash` that camera/weather edits do not
  invalidate.
- `Runtime` with `DT = 1/20`, `submit(verb, params, {id, parent, preempt})`,
  `cancel`, `step()`, `stateHash()`, `snapshot()` / `Runtime.restore()`; actions
  move requested → validated → reserved → executing; reservations on resources
  such as `actor:<id>`; invariants run every tick and record violations.
- `ActionDef { verb, description, schema (zod), reservations, plan, start, step,
  cancel, … }`; `StepResult` running/completed/blocked/failed; `Diagnostic`.
- One op registry generates REST, MCP tools (`engine_<op>`) and browser schemas.
- `WorldHistory`: content-addressed checkpoints with `rulesVersion`, protected
  canonical workspaces, forks, no merge.
- Plans: `mars-sequence/1` templates → `BoundPlan` bound to a checkpoint and
  `physicalHash`; stale plans are refused with a diff.
- Takes (`mars-take/4`): quantized pose tracks `[tick, x mm, y mm, z mm, yaw mrad]`
  with tolerance simplification, change events, final state; the renderer
  consumes takes and camera tracks, never a live runtime.
- Camera: `ShotSpec` union (fixed, follow, orbit, frameGroup, path, reveal,
  establishing), deterministic planners, natural-language camera parsing.

## Execution model today, and the gaps Sim's shell already fills

Mars runs "submit plan → simulate faster than real time inside one request →
store a take → viewers poll once a second". There is no background tick, no
WebSocket, no accounts (capability tokens per room), no per-entity ownership, no
economy, no LLM in the loop (one bounded Jev camera experiment). Admission caps:
128 entities, 96 steps, 30 s CPU per invocation. Stress-tested to 30 walkers
(sub-millisecond ticks; 50–100 ms spikes when many replan A* at once).

Sim's shell supplies the missing wrapper: a 24/7 fixed-step loop with a clock-rate
dial, an append-only event log with replay, snapshots and restore, WebSocket sync
of path decisions, accounts and per-Soul ownership, agent pairing and MCP, the
three-tier brain, spend governance, deployment. What the engine transplant will
demand of Mars (recorded in `../eden4/15-SCAFFOLD-SPEC.md` §2):

1. `snapshot()` at any tick with in-flight action state serialized (Mars has
   `serializeExec/restoreExec` per verb and `resumable` flags, but not universally;
   "active activity snapshots remain explicitly nonresumable").
2. A cheap `enumerateActivities(actor)` feasibility pass for the brain, since
   `rehearse` (~200 ms) is too slow per Soul.
3. Emitting committed paths as they are decided (the take format already fits).

## Mars roadmap, as of 2026-09-30

From `mars/ACTIVE_ROADMAP.md`: release 21 is live (classroom → lightning talks →
conversation → shared food → resumed unfinished notes, physical chair/table
setup). Next: quiet rest, then the connected communal day (rest/work/food/social/
sleep), then **reuse in a small non-Mars environment**, which is the seam Sim is
built for. Product allocation 60/30/10 (product / leverage engineering / polish);
within product 50/30/20 (complete experiences / breadth of activities and usable
objects / social believability). Work is done by up to three Codex workers with a
full release gate; local Git only.

The two frontier documents (`mars/SIMULATION_FRONTIER*.md`, 2026-09-30) describe
where the engine wants to go after that: intentions that last days, projects with
unfinished state, commitments, relationships, learning, care of shared things, and
readable social choreography, with three candidate demonstrations (communal dinner,
collaborative workshop project, exhibition opening).
