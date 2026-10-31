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

## Author an activity and expose a scenario

Start with a bounded purpose: participants and roles, required object capabilities,
permitted bindings/alternatives, resource ownership, observable progress, meaningful
completion, ordinary cancellation and the effects that survive interruption. State
unsupported conditions explicitly. A coordinator composes registered actions; it does
not implement another mover, directly repair support, invent material or replace a
missing participant. Routine execution is deterministic and requires no LLM calls.

| Contract / module | Contributor responsibility |
| --- | --- |
| `actions/types.ts`: `ActionDef<Params, Program, Exec>` | Give the verb a strict zod schema; pure `plan(rt, params)` returns a program or named Diagnostic; `reservations(world, params)` declares exclusive/shared resources; `start` initializes execution once after admission and reservation; `step` advances with fixed `dt`; `cancel` reaches an allowed stop or explicitly refuses. |
| `runtime/runtime.ts` | `rt.submit(verb, params, { parent?, preempt? })` performs authoritative admission/reservation; inspect the returned `ActionRecord`, not just its id. Child submissions identify their parent. `rt.cancel(id)` uses the action's cleanup contract; terminal statuses are completed/failed/cancelled, while blocked is still active. |
| `objects/`, `items/`, `activities/` | Object capability/state and material/support validation belong to their existing modules. Activity coordinators own purpose/roles and child ids; children own physical writes under their reservations. Publish detached `read…(rt, action)` facts for progress, bindings, waiting reason and retained effects. |
| `api/registry.ts` | Add physical/coordinator/control verbs to `ENGINE_ACTIONS`; add relevant invariants to `ENGINE_INVARIANTS`. `createRegistry` rejects duplicate verbs and sequence built-ins. `engineConfig`/`servicesFor` supply a world's own scene/services; semantic changes to verbs, DT or invariants require a rules-version change. |
| `engine/scenarios/` | Construct the initial world, supported props, actors, binding factory and Runtime before execution. Initial fixture placement is authoring; runtime repositioning still requires ordinary actions. Use the shared registry/invariants/services rather than a parallel control plane. |
| `app/lab/scenarios.ts` and family scenario modules | Register a stable id in `SELECTABLE_SCENARIOS` and `scenarioByName`. A `Scenario` declares title/limits, scene/humans or custom `build`, `start`, `maxTicks`, `expect`, optional read-only `admission`, `tick` and `done`. Default `buildRuntime` is the walk-only proving ground; a richer activity needs its appropriate custom Runtime. |
| `app/lab/*-hud.tsx`, `panel.tsx`, `hook.ts` | Start/control buttons submit registered verbs; preview availability with pure plans and surface refusal diagnostics. Revalidate against the current Runtime before submission. Display detached readouts and distinguish accepted commands from completed physical work. Reset replaces the run; global Pause freezes it. Hooks expose observation and commands through the same authoritative Runtime, not another simulation. |
| Renderer and camera adapters | Map actual authoritative state to poses and detached camera observations. `camera-observation.ts` may synchronize derived spatial caches, but has no authority over entities, claims, actions or outcomes. Camera policy/quality remains separately owned. |

The authoritative selectable catalog and proof registry is
[SCENARIO_COVERAGE.json](SCENARIO_COVERAGE.json). Add the preset's discovery group,
start controls, contract reference (terminal effects and limits), named test references
and honest source/proof status there. Generate only the UI contract text with
`cd viewer && node deploy/scenario-contracts.mjs`; verify parity with
`node deploy/scenario-contracts.mjs --check` and `engine/test/scenario-contracts.test.ts`.
`app/lab/scenario-contracts.ts` is generated, not a second hand-maintained catalog.
The clean combined gate and supported bounded public alpha acceptance passed at
release42 functional source `043957e`. See [current status](INDEX.md) and the
inventory for exact-source scope; a catalog row/generated instruction is not proof
that the preset completed on the current source.

### Existing example: prepare and use a room

`engine/activities/room-preparation.ts` defines `room_preparation` and
`room_preparation_control`. `engine/scenarios/room-preparation.ts` provides the
hypothetical world and `roomPreparationBinding()`; the Lab family module registers
`room-preparation`, and `room-preparation-hud.tsx` exposes Start, supported local
Pause/Resume, End and ordinary classroom controls. Start then Play advances actual
work; selecting this manual preset alone does not start the preparation.

The purpose has three stages: clear, arrange, gather. The worker stores the same
`break-bowl` and `break-spoon` from `belongings-table` on `storage-table`; guest1/guest2
carry that emptied table, guest3 carries existing `seat8`, and the existing classroom
uses the room with a declared late visitor. These bindings require actual supported
slots, a table/chair, available people and registered child actions. The coordinator
reserves the exclusive `room-preparation` purpose resource, sets
`drivesReservedHands: false`, and delegates to `tidy_table`, `setup_room` and
`classroom_session`; their children own hands, movement and furniture handling.

Admission checks the declared structure, actual fixtures/visitor and initial tidy
plan. Later stage admission checks the then-current world; initial acceptance does
not guarantee future availability. `readRoomPreparation` reports stage/mode, child
readouts, actual placements/support and named waiting diagnostics. Success means
real storage and furniture placement followed by the classroom ending, with physical
children released; End is cancellation, not successful fulfillment of that purpose.
Stored original items/material and completed furniture placements survive ordinary
interruption. Payload or stored-support changes produce explicit waiting/refusal.

Local Pause during clearing retains the tidy task; arranging waits for ordinary
safe furniture cancellation. Resume requires an actually paused/waiting state and
revalidates retained items and remaining moves, retrying only the unfinished setup
from supported ground placements. A stopped tidy task or previously started classroom
is not silently recreated. Gathering rejects local Pause with
`room_preparation.session-pause-unsupported`; use global Pause or classroom controls.
End requests deferred cancellation and drains existing physical children. This is
same-Runtime continuation; the action explicitly refuses active reload restoration.
The camera observes these actual stages and placements without advancing them.

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
The authoritative coverage inventory and normal gate enforcement retain source/proof
distinctions. Accepted bounded alpha scope does not certify every future input or
turn all 63 mapped presets into 63 fresh public full-Play journeys.


### Hosting boundaries under stabilization

`app/lab/sim.ts` separates the authored script outcome from world stepping.
Terminal/refused/budget-ended finite scripts stop dispatching; ordinary children
and later directions still receive fixed ticks. Manual Pause remains intentional.
`scriptResult` freezes the first authored stop tick/time/stateHash and its reason
(`terminal`, `admission-refused` or `budget`); later ordinary ticks may change the
live world hash. Neither `done()` nor a stop receipt alone proves successful purpose
effects. Compare deterministic boundary hashes with that receipt and verify declared
effects separately; budget exhaustion is not journey completion. A later invariant
or executor fault invalidates the receipt; Reset starts a new run.
Recorded invariant violations produce `lab.invariant-halt`, retain diagnostics and
halt further stepping until a fresh Reset. The Lab's unexpected
host/executor guard records `lab.executor-fault` with phase/tick/error details,
clears any successful script receipt and quarantines the actual world, records and
claims as uncertain partial execution. It does not cancel children, release claims
or invent a rollback; those mutations cannot be certified safe after an unknown fault.
The Lab panel disables execution/activity controls while halted, retaining
Reset/scenario selection, inspection and camera controls. `hook.ts` applies
`fenceLabControls` before invoking non-allowlisted methods, refusing with
`lab.control-quarantined` without new world events/claims. New hook methods inherit
that fence; add to `QUARANTINE_ALLOWED` only after proving the method returns detached
observations or operates solely on presentation/a fresh world. Current-source
bounded certification is recorded in [current status](INDEX.md); dev-only source-import
fixtures carry local gate proof, not production execution proof. Synthetic renderer
probes remain detached.
These are bounded host safeguards, not recovery guarantees for arbitrary future
inputs. These guards are included in deployed release42 source; the product
acceptance receipts retain their local/public proof distinctions. Source inspection
alone is not execution proof.

The legacy `Scenario.continuous` flag affects authored completion/budget for
manually started finite presets; healthy world stepping continues independently
of that flag. True ongoing dispatch must additionally declare `execution: 'sustained'`;
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
boundaries. These guards have focused deterministic proof and the release42 clean
combined gate; [current status](INDEX.md) owns accepted proof scope and limits.


## Persistence and extension acceptance

Plain JSON world state, same-Runtime retained intentions and resumable runtime
snapshots are separate guarantees. `history/store.ts` persists content-addressed
world checkpoints/workspace ancestry; a world blob alone does not restore live
coordinators, reservation graphs or services. `runtime/snapshot.ts` checks each live
verb's `resumable` declaration/codec or verified subset and refuses unsupported
state by name. A new verb requires tick-exact restore tests with its own services
before opting in. The optional drop path refuses held loads and action-owned active
equipment task state (`snapshot.drop-unsafe`); safely finish the ordinary owning-task
stop before omitting its progress. It is not a recovery strategy for uncertain
executor state. See
[TAKES_AND_PLANS.md](TAKES_AND_PLANS.md) for existing checkpoint/take
contracts and limitations. Active GUI save/load remains owner-deferred.

For an extension, prove the declared purpose and boundaries: repeat seeded execution
and terminal hashes/effects, deliberate invalid admission without acquired ownership,
ordinary interruption/deferred cancellation and retained effects, and representative
route/equipment/furniture/occupancy/departure disruptions. Verify supported retry or
waiting/End with named diagnostics and continued unrelated-world activity; test
invariant/unknown-fault quarantine separately from ordinary recovery. Never claim
universal recovery, erase diagnostic failures or bypass support/ownership to make a
journey finish.

Actual UI Play must follow the preset's documented Start/control sequence to meaningful
terminal effects for finite journeys, sustained progress for declared continuous worlds,
all supported interactions for probes, or exact expected refusal plus surrounding-world
usability for diagnostic demonstrations. Inspect captures of the physical effects.
Record exact source, executed commands, original failures and limits in the inventory/
evidence; deterministic Node checks, first-Step smoke, programmatic stepping and mixed
completion remain distinct from actual Play. Each future extension still requires
its clean combined gate and source-bound UI proof. Release42 passed its local gate;
supported bounded public alpha acceptance is recorded in [current status](INDEX.md).
