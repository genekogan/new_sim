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
refusal must be distinguishable from successful completion.

Object capabilities/state live separately from appearance: workstation, reading,
food, garden and sleep modules expose explicit requirements and retained effects.
Garden care uses finite normalized quantities, not a growth/fluids simulator.
Rig-specific pose mapping stays in renderer adapters; no rig/library migration
in this tranche. Cameras receive detached actual facts and have no world authority.
Active save/load is owner-deferred; do not imply serializable JSON restores an
active coordinator graph. See Lab guide for supported interactions and limitations.
