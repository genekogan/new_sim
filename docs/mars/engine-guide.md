# Engine contributor guide

The engine (`mars/viewer/engine/`) is a bounded deterministic world and activity runtime in pure TypeScript. It
runs unchanged in Node tests, the browser and the Durable Object host. Requirements: [spec.md](spec.md). The
short list of invariants is in [`mars/AGENTS.md`](../../mars/AGENTS.md).

## Hard rules

- **Strip-types compatible TypeScript**: no parameter properties, `enum`, `namespace` or decorators; relative
  imports carry the `.ts` extension; `import type` for type-only imports. The only runtime dependency is `zod`.
- **No three.js, DOM, `Date.now` or `Math.random` in the engine.** Use `core/math.ts` (deterministic
  transcendentals) and `core/rng.ts` (seeded sfc32, state in `world.rng`). `engine/test/source-scan.test.ts`
  rejects host `Math.sin` and friends.
- **Determinism**: fixed tick `DT = 1/20 s` (`runtime/runtime.ts`; changing it is a rules-version change). Iterate
  maps and records in insertion or sorted order. `new Runtime()` rebuilds `world.entities` in sorted-id order
  (`canonicalEntityOrder`); code that adds entities mid-run must call it again.
- **Fail loudly**: actions return `Diagnostic { code, message, subjects, at }` naming concrete objects ("the 19 ft
  upright u3 intersects wall passage-e during the 90° turn at (14.8, -15.0)"). Never succeed by clipping, floating
  or teleporting.
- **World state is plain JSON** (`world/types.ts`). Only the Runtime and action lifecycle mutate it, inside
  fixed-step execution. Renderers and cameras only read.

## Conventions

- Metres, Y up, ground plane (x, z). `Vec2 = [x, z]`.
- `yaw` rotates (x, z) by `rot2(v, yaw)`: x' = x cos − z sin, z' = x sin + z cos. In three.js,
  `object.rotation.y = -yaw`.
- Entity pose `{ p: [x,y,z], yaw, pitch?, roll? }`; the local box origin is the base centre (x = length, y = height,
  z = depth). `entityCorners()` / `entityFootprint()` (`spatial/service.ts`) give world geometry.
- Humans: `kind: 'human'`, `human.level`, `human.activity` (`idle|walk|wait|climb-up|carry|support|…`),
  `human.task` = owning action id.
- Components: `phase` (`stored|reserved|carried|staged|raising|placed|installed`), `support`
  (`ground|resting-on|held|connected|forks|none|…`), `connections`.

## Key modules

| Module | Role |
| --- | --- |
| `core/hash.ts`, `core/rng.ts`, `core/math.ts` | `stableStringify`, `sha256`, `hashOf`; seeded RNG; deterministic math |
| `world/types.ts`, `world/catalog.ts`, `world/factory.ts` | World types and `physicalView()`; asset defs (frames, beams, timber, plywood, grips, slots, handling); `emptyWorld`, `human`, `component` |
| `history/store.ts` | `WorldHistory`: content-addressed checkpoints, protected workspaces, forks, causes |
| `runtime/runtime.ts`, `runtime/invariants.ts` | `Runtime` (`submit`, `cancel`, `step`, `runUntilIdle`, events, violations); end-of-tick invariants |
| `runtime/snapshot.ts`, `runtime/codec.ts` | resumable snapshots for verified verbs |
| `runtime/profile.ts` | opt-in `rt.profile = true` wall-time profiler (measurement only) |
| `spatial/` | `SpatialScene`, per-level rasters with exact EDT clearance, multi-level A*, the `Spatial` service |
| `locomotion/walk.ts` | `walk_to` ([movement.md](movement.md)) |
| `scenes/proving-ground.ts` | synthetic regression scene (wall, U-trap, 1 m passage, deck, complete and incomplete stairs) |

## Author an activity and expose a scenario

Start from a bounded purpose: participants and roles, required object capabilities, permitted bindings, resource
ownership, observable progress, meaningful completion, ordinary cancellation and the effects that survive
interruption. State unsupported conditions explicitly. A coordinator composes registered actions; it never
implements another mover, repairs support directly, invents material or replaces a missing participant. Routine
execution is deterministic and needs no LLM calls.

| Contract / module | Responsibility |
| --- | --- |
| `actions/types.ts` `ActionDef<Params, Program, Exec>` | Strict zod schema; pure `plan(rt, params)` returns a program or a named Diagnostic; `reservations(world, params)` declares resources; `start` runs once after admission; `step` advances by `dt`; `cancel` reaches an allowed stop or refuses |
| `runtime/runtime.ts` | `rt.submit(verb, params, { parent?, preempt? })` does admission and reservation; inspect the returned `ActionRecord`. `rt.cancel(id)` uses the action's cleanup contract. Terminal statuses: completed, failed, cancelled; blocked is still live |
| `objects/`, `items/`, `activities/` | Object capability and state live in their modules. Coordinators own purpose, roles and child ids; children own physical writes under their reservations. Publish detached `read…(rt, action)` facts for progress, bindings, waiting reasons and retained effects |
| `api/registry.ts` | Add verbs to `ENGINE_ACTIONS` and invariants to `ENGINE_INVARIANTS`. `createRegistry` rejects duplicates and sequence built-in names. Semantic changes to verbs, DT or invariants need a rules-version change |
| `engine/scenarios/` | Build the initial world, props, actors, bindings and Runtime. Initial placement is authoring; runtime repositioning uses ordinary actions |
| `app/lab/scenarios.ts` | Register a stable id in `SELECTABLE_SCENARIOS`. A `Scenario` declares title, scene or custom `build`, `start`, `maxTicks`, `expect`, and optional `admission`, `tick`, `done` |
| `app/lab/*-hud.tsx`, `panel.tsx`, `hook.ts` | Controls submit registered verbs; preview with pure plans and show refusals; distinguish accepted commands from completed work. Hooks observe and command the same Runtime |
| Renderer and camera adapters | Map authoritative state to poses and detached camera observations; no authority over entities, claims or outcomes |

Each selectable preset has a contract (group, start controls, terminal effects, limits, test references) in
`mars/docs/engineering/SCENARIO_COVERAGE.json`. `node deploy/scenario-contracts.mjs` generates
`app/lab/scenario-contracts.ts` from it (do not edit that file by hand); `--check` and
`engine/test/scenario-contracts.test.ts` verify parity. A catalog row is not proof that the preset completes.

### Example: prepare and use a room

`engine/activities/room-preparation.ts` defines `room_preparation` and `room_preparation_control`;
`engine/scenarios/room-preparation.ts` provides the world and `roomPreparationBinding()`; `room-preparation-hud.tsx`
exposes Start, local Pause/Resume and End. The purpose has three stages (clear, arrange, gather) and delegates to
`tidy_table`, `setup_room` and `classroom_session`, whose children own hands, movement and furniture. The coordinator
reserves only the exclusive `room-preparation` purpose resource (`drivesReservedHands: false`). Each stage is admitted
against the then-current world. `readRoomPreparation` reports stage, child readouts, placements and named waiting
diagnostics. Success means real storage and furniture placement followed by the classroom ending; End is
cancellation, not success. Completed placements survive interruption. Resume revalidates retained items and retries
only unfinished work; gathering refuses local Pause with `room_preparation.session-pause-unsupported`. Reload
restoration of the active coordinator is refused explicitly.

## Activity and renderer boundary

Coordinators express purpose and bindings; registered actions own movement, posture, support and manipulation.
`living_intention` commitments retain bounded progress and resume explicitly after interruption. End and refusal are
distinguishable from success. Once an action accepts a deferred cancellation, its cleanup runs once; a refused
cancellation stays retryable. Object capabilities are separate from appearance; garden care uses finite normalized
quantities, not a growth or fluid simulator. Rig-specific pose mapping stays in renderer adapters. A serializable
world does not imply that an active coordinator graph restores.

## Failure model and world liveness

A local activity failure never freezes the world. Authored journey completion, refusal or exhausted script budget is
distinct from the world clock. Manual Pause freezes intentionally. Unrelated actors and the UI stay usable after a
local purpose ends; a terminal script is not re-dispatched every frame.

- **Admission refusal**: named Diagnostic, no acquired ownership, no fabricated effects; the world keeps stepping.
- **Recoverable execution problem**: relevant replan or permitted substitute; otherwise explained waiting with a defined
  retry or intervention condition, or ordinary safe cancellation. Completed effects and the unfinished purpose remain.
- **Serious invariant corruption or unknown executor fault**: preserve diagnostics and state visibly and stop further
  unsafe execution. Inspection and Reset are explicit; stepping invalid state is not liveness. An unexpected failure
  stays a failing test.

Host safeguards that implement this:

- `app/lab/sim.ts` separates the authored script result from world stepping. `scriptResult` freezes the first stop tick,
  state hash and reason (`terminal`, `admission-refused`, `budget`); later ticks may change the live hash. Neither
  `done()` nor a stop receipt proves the purpose's effects.
- A recorded invariant violation raises `lab.invariant-halt` and halts stepping until Reset. An unexpected executor
  error records `lab.executor-fault`, clears the script receipt and quarantines the world; it does not cancel children
  or release claims, since those cannot be certified safe.
- `hook.ts` applies `fenceLabControls`: while halted, non-allowlisted methods refuse with `lab.control-quarantined`.
  Add a method to `QUARANTINE_ALLOWED` only if it returns detached observations or acts on presentation or a fresh
  world.
- `Scenario.continuous` affects only authored completion; ongoing dispatch needs `execution: 'sustained'`, where
  `maxTicks` bounds the validation window.
- `engine/sequence/runner.ts` stops at the first recorded invariant and returns an aborted report with
  `sequence.invariant-halt`; the invalid take is evidence, never a resumable checkpoint, and the workspace head is
  unchanged.

These are bounded safeguards, not recovery guarantees for arbitrary input.

## Persistence

World checkpoints (`history/store.ts`), same-Runtime retained intentions and resumable runtime snapshots are separate
guarantees. A world blob alone does not restore live coordinators, reservations or services. `runtime/snapshot.ts`
checks each live verb's `resumable` declaration or codec and refuses the rest by name; a new verb needs tick-exact
restore tests before it opts in. `allowDrop` refuses held loads and action-owned equipment state
(`snapshot.drop-unsafe`). See [takes-and-plans.md](takes-and-plans.md).

## Proving an extension

Prove the declared purpose and its boundaries: repeated seeded execution with identical terminal hashes and effects;
deliberately invalid admission without acquired ownership; interruption, deferred cancellation and retained effects;
representative route, equipment, furniture, occupancy and departure disruptions; named waiting or End with the rest of
the world still running; invariant and unknown-fault quarantine tested separately from ordinary recovery. Never erase a
diagnostic or bypass support or ownership to make a journey finish.

UI proof follows the preset's Start/control sequence to meaningful terminal effects (finite journeys), sustained
progress (continuous worlds), every supported interaction (probes) or the exact expected refusal (diagnostic demos),
with inspected captures. Node checks, first-Step smoke and programmatic stepping are distinct from actual Play.
Skipped, TODO and FIXME checks count as unproved.

## Tests

From the repo root: `pnpm test:mars` (engine suite). Other scripts run with `pnpm --filter mars-campus-viewer <script>`:
`test` (deploy tests), `typecheck`, `lint`, `e2e` ([`mars/viewer/e2e/README.md`](../../mars/viewer/e2e/README.md)),
`gate` (the full release gate). Every feature ships with regression tests, including deliberately invalid cases.
Changes to shared files (`runtime/runtime.ts`, `world/types.ts`, `actions/types.ts`, `spatial/*`) are minimal and
additive.
