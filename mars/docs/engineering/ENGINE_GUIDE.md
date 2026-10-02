# Mars engine — contributor guide (read before touching viewer/engine)

The engine is a bounded deterministic world/activity runtime in pure
TypeScript (`viewer/engine/`). It runs unchanged in Node tests, the browser and
the Cloudflare Durable Object. Spec: `SPEC.md`. Audit of the existing app:
`AUDIT.md`. Owner decisions: `OWNER_DECISIONS.md`. Progress: `PROGRESS.md`.
Start at [engineering navigation](INDEX.md). External contributors: `CODEX.md`
(worktree recipe, gates, merge protocol); current AGENTS.md supersedes older ownership maps.

## Hard rules
- **Node strip-types compatible TS**: no parameter properties, no `enum`, no
  `namespace`, no decorators; relative imports carry the `.ts` extension.
  `import type` for type-only imports. Only dependency allowed in engine core: `zod`.
- **No three.js / DOM / Date.now / Math.random in engine core.** Use
  `core/math.ts`, `core/rng.ts` (seeded, state lives in `world.rng`).
- **Determinism**: fixed tick `DT = 1/20 s` (`runtime/runtime.ts`); iterate maps
  / records in insertion or sorted order; no wall-clock. `new Runtime()` rebuilds
  `world.entities` in sorted-id order (`canonicalEntityOrder`), because `hashOf` ignores
  key order; code that adds entities mid-run must call it again.
- **Fail loudly**: actions return `Diagnostic { code, message, subjects, at }`
  naming concrete objects (e.g. "the 19 ft upright u3 intersects wall
  passage-e during the 90° turn at (14.8, -15.0)"). Never "succeed" by clipping,
  floating or teleporting.
- **World state is plain JSON** (`world/types.ts`). Deterministic Runtime/action lifecycle
  owns mutation; physical movement advances inside fixed-step execution. Renderers/cameras only read.

## Conventions
- Metres, Y up, ground plane (x, z). `Vec2 = [x, z]`.
- `yaw` rotates (x, z) by `rot2(v, yaw)`: x' = x cos − z sin, z' = x sin + z cos.
  In three.js this corresponds to `object.rotation.y = -yaw`.
- Entity pose: `{ p: [x,y,z], yaw, pitch?, roll? }`, local box origin at base
  centre, local x = width/length, y = height, z = depth (`catalog.ts`).
  `entityCorners()` / `entityFootprint()` in `spatial/service.ts` give world geometry.
- Humans: `kind: 'human'`, `human.level` (walkable level id), `human.activity`
  (`idle|walk|wait|climb-up|climb-down|carry|support|…`), `human.task` = owning action id.
- Components: `phase` (`stored|reserved|carried|staged|raising|placed|installed`),
  `support` (`ground|resting-on|held|connected|forks|none`), `connections`.

## Key modules
| Module | Role |
| --- | --- |
| `core/hash.ts` | `stableStringify`, sync `sha256`, `hashOf` |
| `core/rng.ts` | seeded sfc32 with checkpointable state |
| `world/types.ts` | WorldState / Entity / Provenance / `physicalView()` (what plans depend on) |
| `world/catalog.ts` | Mars asset defs: uprights 8/9/12/16/19 ft, beams 8/9/12 ft, 2x4, plywood; grips, sockets, handling |
| `world/factory.ts` | `emptyWorld`, `human`, `component`, `addAll` |
| `history/store.ts` | `WorldHistory`: content-addressed checkpoints, protected canonical workspaces, forks, causes; `attachStateStore` + `toJSON({ states: false })` keep states as separate blobs (the DO) |
| `runtime/runtime.ts` | `Runtime`: submit → validated → reserved → executing; `step()`, `runUntilIdle()`, events, violations |
| `runtime/profile.ts` | opt-in `rt.profile = true` wall-ms profiler (plan/step per verb, Spatial methods); `deploy/perf-stress.mjs` |
| `runtime/invariants.ts` | end-of-tick checks (human/static clearance, human/human overlap, unsupported components) |
| `spatial/types.ts` | SpatialScene (levels, surfaces, obstacles, links), AgentProfile |
| `spatial/grid.ts` | per-level rasters + exact EDT clearance; `segmentClearance`, `nearestBlocker` |
| `spatial/path.ts` | multi-level A* with stair links, corridor string-pulling; diagnostics; opt-in `planner: 'corridor'` (`PLANNING_BUDGET.md`) |
| `spatial/service.ts` | `Spatial`: base scene + world entities → grids (epoch bumps on construction); `narrow()` traffic components; contributors hook |
| `locomotion/walk.ts` | `walk_to` action (corridor following, stairs, yielding, replans) |
| `scenes/proving-ground.ts` | synthetic regression scene (wall, U-trap, 1 m passage, 3 m deck, complete + incomplete stairs) |

## Tests
- `cd viewer && npm run test:engine` (node:test over `engine/test/*.test.ts`).
- `npm test` = existing deploy/*.test.mjs; `npm run typecheck`; `npm run e2e` = Playwright (see `viewer/e2e/README.md`).
- Every feature ships with regression tests including deliberately invalid cases.

## Parallel-work protocol
- Each track owns specific directories/files (listed in its brief). Changes to shared files
  (`runtime/runtime.ts`, `world/types.ts`, `actions/types.ts`, `spatial/*`) must be minimal,
  additive, and described in your final report.
- Commit only your own paths: `git add <your paths> && git commit -m "…"`; if `index.lock`
  exists, wait a few seconds and retry. End messages with
  the established co-author convention (`Co-Authored-By: Codex <noreply@openai.com>`
  for Codex work), with genekogan as author. Never push/add remotes.
- Run focused checks appropriate to the change and TypeScript before committing.
  The full established gate is required on the clean combined release candidate
  before main integration; do not merge known failures or claim skips as proof.
- Keep long validation logs/proof receipts on disk. Serialize expensive browser/performance
  checks and freeze tracked source during the combined gate. Preserve failed evidence.

## Activity and renderer boundary

Reusable coordinators express purpose/roles/permitted bindings; ordinary registered
actions own physical movement, posture, support and manipulation. Independent
`living_intention` commitments retain bounded progress and explicitly resume after
player/director interruption; `living-day` composes existing family mechanisms.
Do not add a second movement controller or fabricate replacement objects. End and
refusal must be distinguishable from successful completion. Once an action accepts
a deferred cancellation, its fixed-step cleanup runs once; repeated parent requests
do not restart it or cancel item-return children. A refused cancellation stays
retryable. Activity-specific Pause contracts may retain a held tool deliberately;
End and ordinary put actions must still provide coherent physical release.

Object capabilities/state live separately from appearance: workstation, reading,
food, garden and sleep modules expose explicit requirements and retained effects.
Garden care uses finite normalized quantities, not a growth/fluids simulator.
Rig-specific pose mapping stays in renderer adapters; no rig/library migration
in this tranche. Cameras receive detached actual facts and have no world authority.
Active save/load is owner-deferred; do not imply serializable JSON restores an
active coordinator graph. See Lab guide for supported interactions and limitations.


## Durable failure model and world liveness (owner mandate2026-10-02)

A local activity failure must not freeze the whole world. Authored journey completion,
refusal or exhausted script budget is distinct from authoritative world-clock liveness.
Manual Pause freezes intentionally. Unrelated actors and UI remain usable after a
local purpose ends. Do not keep dispatching a terminal script or retrying failures each
frame; continuation needs an explicit supported condition or bounded recovery policy.

- **Expected admission refusal:** named Diagnostic, no acquired physical ownership or
  fabricated effects. The world still steps; other actors may act normally.
- **Recoverable execution problem:** relevant reroute/replan or explicitly permitted
  substitute; otherwise explained waiting with sensible physical state and a defined
  retry/intervention condition, or ordinary safe cancellation/release. Retain actual
  completed effects and unfinished purpose. No deadlock/starvation/error-loop promises
  beyond the declared supported model; test representative disruptions and isolation.
- **Serious invariant corruption/uncertain executor fault:** visibly preserve concrete
  diagnostics/state and contain further unsafe execution. Inspection/reset/recovery
  must be explicit; continuing invalid authoritative state is not liveness. An unexpected
  failure remains a failing test, never relabelled as an intentional demonstration.

Intent/coordination owns logical commitments; registered physical actions own movement,
posture, support, object/material writes and cleanup. Renderer/UI/camera observe detached
readouts. Player/director intervention follows ordinary authoritative handoff; paused
intentions resume only under their documented binding/ownership/retained-effect rules.

Required validation: each selectable preset's declared execution contract and exact
production-source proof, actual UI Play plus deterministic checks, representative blocked
routes/equipment/furniture/occupancy/departure/player interruption and failure isolation.
Finite journeys prove meaningful terminal effects; continuous worlds prove sustained
progress; probes prove full supported controls; diagnostic demos prove exact expected
refusal and surrounding-world usability. Startup/mixed stepping/FIXME are not substitutes.
The authoritative coverage inventory and normal gate enforcement are stabilization work;
this requirement is durable, not a claim that every current preset is already certified.


### Hosting boundaries under stabilization

`app/lab/sim.ts` separates the authored script outcome from world stepping.
Terminal/refused/budget-ended finite scripts stop dispatching; ordinary children
and later directions still receive fixed ticks. Manual Pause remains intentional.
Recorded invariant violations produce `lab.invariant-halt`, retain diagnostics and
disable Play/Step until a fresh Reset. Synthetic renderer probes remain detached.
This is a supported driver boundary, not rollback of arbitrary partially mutated
state or a proof that unknown JavaScript faults recover automatically.

The legacy `Scenario.continuous` flag also keeps manually started finite presets
alive. True ongoing dispatch must additionally declare `execution: 'sustained'`;
only that declared class keeps authoring commitments after `maxTicks`, which bounds
its validation window. The production stress preset declares this explicitly.
Fixed DT, seeded choices, bounded per-frame advancement and manual Pause are unchanged.

`engine/sequence/runner.ts` quarantines a recorded invariant at its first tick.
It does not continue, cancel or settle invalid state, and returns an aborted report
with `sequence.invariant-halt` plus the original violation. Normal execute/pause/
resume therefore retains an inspectable failed take while leaving the valid
workspace head unchanged. An invalid private take is evidence, never a resumable
checkpoint. Ordinary action failures retain their existing cleanup/onFail policies.
Low-level Runtime stepping is an internal mechanism; hosts must enforce these
boundaries. These guards have focused deterministic proof, but combined gate and
actual Play certification remain pending on the alpha candidate.
