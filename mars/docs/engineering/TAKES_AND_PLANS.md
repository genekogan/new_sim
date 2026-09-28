# Sequences, plans, takes, replay and rehearsal

Code: `viewer/engine/{sequence,take,rehearsal}/`. Tests: `engine/test/{sequence,take,rehearsal,history}.test.ts`
(fixtures in `test/sequence-fixtures.ts`). Spec: §14, §16, §21–24, §28.

## Data model

| Artifact | Type / file | Identity | Depends on |
| --- | --- | --- | --- |
| Sequence template | `SequenceTemplate` (`sequence/types.ts`) | `templateHash` | nothing world-specific |
| Bound plan | `BoundPlan` (`sequence/bind.ts`) | `planHash` = hash(everything else) | baseline checkpoint, its `physicalHash`, `rulesVersion` |
| Take | `Take` (`take/types.ts`, `take/recorder.ts`) | `id` = hash(everything else) | start checkpoint, plan, rules |
| Camera track | `CameraTrack { id, takeId, kind, data }` | own id | a take id; stored beside it (`TakeLibrary`) |
| Successor checkpoint | `history.commit(..., { kind: 'simulation-run', take, plan })` | checkpoint id | parent = start checkpoint |

**Template.** `{ schema: 'mars-sequence/1', id, params: { name: { kind } }, steps: StepSpec[] }`.
A step is `{ id, verb, params, after?, when?, at?, onFail? }`:
- `after: [ids]` barrier (all completed); `when: { event: 'started'|'completed', step }`;
  `at: seconds` exact cue relative to sequence start (tick = `round(at / DT)`); conditions AND together.
- `onFail: 'abort'` (default) cancels live steps and skips pending ones; `'continue'` keeps
  independent branches and skips only steps whose conditions can now never hold
  (`sequence.dependency-failed`, naming the dependency).
- Param kinds: `actor(s)`, `entity/entities` (checked against the baseline world), `number`, `string`,
  `point` ([x, z]), `any`.

**Substitution syntax** (no eval, no string interpolation): a param value that is *exactly*
`$name`, `$name[0]`, `$name.field` or a chain of those is replaced by the bound value; `$$x` is the
literal `$x`; any other string is left alone. Unknown names/indices fail with `plan.unbound-reference` /
`plan.bad-reference`.

**Binding** (`bindTemplate(template, bindings, { history, baseline, registry })`) validates the template with
zod (unknown keys rejected), the step graph (duplicate ids, unknown refs, cycles), every binding against the
baseline world, then parses each step's params with the verb's registry schema. All problems are returned at
once in `PlanError.diagnostics`. The plan stores the *parsed* params — exactly what the runtime receives.

**Runner** (`SequenceRunner`, `runSequence`). Before every tick it submits ready steps in declaration order,
re-scanning to a fixed point (so `when: started` fires on the same tick); after each tick it mirrors action
records into `StepReport`s (status, submitted/ended tick, `blockedTicks`, `cueLateTicks`, diagnostic, outputs).
Action ids are `step:<stepId>`. Result `{ status: completed|partial|aborted|timeout, steps, violations,
diagnostics, startTick, endTick, finalStateHash }`. A refused cancel is recorded (`sequence.cancel-refused`),
never forced.

**Take.** `{ schema, id, planHash?, baselineCheckpoint?, baselineStateHash, rulesVersion, dt, startTick, ticks,
keyframeEvery, tracks, changes, events, finalStateHash, finalState }`.
- `tracks[entity]`: samples `[tick, x_mm, y_mm, z_mm, yaw_mrad(, pitch_mrad, roll_mrad)]`, integers.
  Recorded online by `TakeRecorder` (a `RuntimeObserver`): a sample is dropped when linear
  interpolation (shortest arc for angles — the same `interpSample` replay uses) between its neighbours
  reproduces every dropped sample within 1 quantum. Static entities cost one sample; while an entity moves a
  sample is forced at least every `keyframeEvery` (20) ticks. Before motion resumes after a hold, the hold
  point is committed, so interpolation never smears a pause.
- `changes`: `[tick, entity, field, value]` for `present`, `activity`, `level`, `task`, `grip`, `phase`,
  `support`, `reservedBy`, `connections` (initial values at tick 0; entities may appear/disappear).
- `events`: runtime action lifecycle (message kept only for failed/blocked), violations, marks, relative ticks.
- `finalState`: the full successor state, so replay never needs the planner or runtime.

## Replay (`take/replay.ts`)

`sampleTake(take, t)` → poses + discrete state at time t (clamped to the take; before an entity's first
sample it is absent). `replayFinalState(take)` returns a copy of the recorded final state and throws if it
no longer hashes to `finalStateHash`. `takeEvents(take, t0, t1)`. The module imports only `core/` and
`take/types` — no runtime, registry, planner, spatial or history (a test enforces this).

## Rehearsal and execution (`rehearsal/rehearse.ts`)

`EngineConfig = { registry, invariants, services: (world) => services, maxTicks?, keyframeEvery? }`.
Both paths call the single `runPlan`: private `structuredClone` of the start state → fresh services →
`new Runtime(...)` → `TakeRecorder` → `SequenceRunner`. No fast path. `runPlan` refuses a spatial service whose
static scene hash differs from `world.base.staticHash` (`services.base-mismatch`).

- `rehearse(history, ws, plan, cfg)` runs from the plan's own baseline checkpoint, never writes history, and
  returns `{ report, take, finalState, stale? }` (`stale` = what `execute` in `ws` would say right now).
  The controller op `rehearse { plan_id, workspace?, keep? }` is read-only by default: the take is held in an
  in-memory LRU (`UNKEPT_TAKES` = 8, playable via `get_take`) and reported as `take.kept: false`; `keep: true`
  stores it (the only write). `execute` of the same plan or `attach_camera_track` on the take also keeps it.
  Report metrics: simulated duration, ticks, Σ `outputs.replans`, Σ `outputs.length` (path metres),
  blocked ticks, violations.
- `execute(history, ws, plan, cfg, { takes?, commitOnFailure?, label? })`:
  1. protected workspace → `workspace.protected` (fork first);
  2. plan hash / baseline integrity → `plan.corrupt`;
  3. `checkPlan`: rules version and `head.physicalHash === plan.baselinePhysicalHash`, else `plan.stale`
     with a `PhysicalDiff` (`changed: [{ id, fields }]`, added, removed, regions, base, other) and a message
     such as "panel changed (pose)";
  4. runs from the workspace **head** (physically identical to the baseline; env/labels are carried forward);
  5. commits the final state with cause `simulation-run { take, plan }` only if the run completed with zero
     violations (else `execution.failed`, take still returned/stored; `commitOnFailure` overrides).

`physicalView` (world/types.ts) now also includes `inventory` and `rng`: both change what a run produces.
Excluded on purpose: `tick`, `env` (visual per §19), labels/tags/provenance. Camera tracks are not world
state at all, so camera edits cannot invalidate a plan.

## Invariants (tested)

- Same plan + same baseline + same rules ⇒ byte-identical take (same `id`, tracks, events) and identical final
  state hash, whether rehearsed or executed.
- Attaching/editing camera tracks never changes a take's hash or final state.
- Rehearsal and replay never mutate history, workspace heads or the take (takes in `TakeLibrary` are frozen).
- Executing in a fork leaves canonical and sibling workspaces untouched; canonical refuses execution.
- A relevant physical edit after rehearsal ⇒ `plan.stale`; env / label / provenance edits ⇒ still valid.
- Sampling a take at every tick reproduces true poses within 2 mm / 2 mrad and exact activity/level.

## Cross-host determinism

Engine math uses `core/math.ts` `dsin/dcos/dtan/dasin/dacos/datan/datan2/dexp/dlog` (pure IEEE-754 arithmetic; host
`Math.sin`… differ in the last bit between V8 builds; a `core.test.ts` source scan bans them). `node deploy/determinism-probe.mjs [--json]`
prints the flagship build-bay/open-ground `finalStateHash`, take id and math fingerprints — run it on each host (browser, Node, DO) and diff.

## What is resumable — and what is not

- **Quiescent checkpoints:** any checkpoint between runs. A plan bound to it can be rehearsed or executed any
  number of times; any workspace can fork from any checkpoint. `take.finalState` is one because runs end with
  every action terminal (aborted/timed-out runs end with cancelled actions, so theirs are quiescent too; not
  committed by default).
- **Mid-action pause checkpoints (spec §22), for a defined subset.** `rt.snapshot()` returns a
  `RuntimeSnapshot` (`runtime/snapshot.ts`, plain JSON): world, every `ActionRecord`, each live action's
  `exec` + `program`, reservations (`owners`), per-action prior phases, plain-data services (`traffic` holds,
  `walkExecs`, `replanBudget`, `carryExecs` when empty), the Spatial navigation `epoch`, `nextId`, violations and
  the event cursor. RNG state is in `world.rng`. `Runtime.restore(snap, registry, services, invariants)` rebuilds a
  runtime that steps tick-for-tick identically (same `stateHash` every tick, same event stream from the cursor).
  - Encoding (`runtime/codec.ts`) is a graph codec: objects reached twice stay one object after restore (a
    parent's exec holding its child `ActionRecord`s; a walk exec held by the live map and `services.walkExecs`),
    Maps/Sets/undefined/NaN/±Infinity/-0 survive. Every snapshot is proven by a JSON round trip (`hashOf` equal).
    Functions (closures) and class instances are refused naming the path.
  - `snapshot()` syncs the Spatial first (idempotent on the same world, so behaviour-neutral: the paused
    original still matches an unpaused run). `restore()` needs **the runtime's own services** — a fresh
    `Spatial` for the same base scene; a Spatial shared between diverging runtimes would share its epoch.
  - **Resumable (tested in `resume.test.ts`):** `walk_to` in every phase incl. stair `align`/`climb` and
    single-file traffic holds; `take_slot`, `sit`, `stand`, `face`, `converse`, `gather`, `campfire_circle`;
    sequences — `SequenceRunner.serialize()` / `SequenceRunner.restore(rt, state)` carry pending/started steps,
    cues, cut/refused sets (pair with an `rt.snapshot()` at the same tick; `runner.tick()` steps one tick).
  - **Refused loudly** (`snapshot.non-resumable`, naming each action and why; `NON_RESUMABLE` in snapshot.ts):
    `carry` — its exec drives in-process walk sub-execs (not child actions) registered in `services.walkExecs`,
    publishes load discs through a services closure (`loadDiscs`), and holds planner trajectories + formation
    transitions whose tick-exact restoration is unverified; construction lifts (`raise_upright`,
    `connect_beam`, `install_*`, `release_support`) — they hold loads and drive crew sub-walks + lift
    trajectories; vehicles (`mount`, `dismount`, `ride_to`, `ride_loop`) — controller state and the vehicle
    invariant's per-runtime memory are not serialised; `ambient_wander` and any other verb — not yet verified.
    A `walk_to` stepping aside for a carry (`detour.clearOf` closure) is refused by the codec.
  - `snapshot({ allowDrop: true })` leaves refused actions out (`snap.dropped`); `restore()` finishes each as
    `cancelled` with `snapshot.dropped` through the runtime's normal cleanup. Refused anyway
    (`snapshot.drop-unsafe`) while the action holds a load (carried/raising entity or a gripping actor).
  - New verbs opt in with `ActionDef.resumable = true` (plain exec) or `serializeExec`/`restoreExec`, plus a test.
- **History:** `history.commit(ws, snap, { kind: 'pause', note })` stores the world as the checkpoint state and
  the snapshot as a content-addressed blob (`checkpoint.resume`, persisted in `toJSON().resumes`);
  `read(id, { resume: true })` returns `{ world, snapshot }` (`snapshot: null` for ordinary checkpoints) and
  `resumable(id)` tells them apart. `fork(ws, …)` at a pause checkpoint yields a workspace whose head resumes.
- **Limitations:** the restored runtime's `events` start empty (compare from `snap.eventCursor`); observers and
  the profiler are not carried; `maxStepPerTick` has no previous-pose baseline on the first tick after a restore
  (a teleport in exactly that tick would go unflagged); a restored `SequenceRunner.run(maxTicks)` budget counts
  from the resume. `sampleTake(take, t)` is still a **visual** frame, never a resumable state.
- **Control plane (ops, `engine/api/pause.ts`):** `engine_execute { pauseAt: seconds | {step, event}, allowDrop? }`
  drives the plan with the same Runtime/SequenceRunner/TakeRecorder as `runPlan` until the point, then commits
  `{ ...rt.snapshot(), pause: { plan, runStart, runner: runner.serialize(), maxTicks, takes, commands } }` as a
  `pause` checkpoint (cause `{ kind: 'pause', note, take, plan }` — the take so far and plan count as referenced).
  `engine_resume { workspace, until?, commands? }` restores both from the head (`resume.not-resumable` otherwise),
  appends `commands` as unconditioned steps, and finishes with `runner.run(rest)` under the run's shared tick budget,
  so a no-command resume ends in the unpaused `finalStateHash` (tested, incl. a pause chain and a room restart). Each
  segment records its own take (`run.takes`). Paused heads refuse bind/execute/edit (`workspace.paused`). In the DO
  the blob is stored like a state: `y<year>/state/resume.<hash>` (optional `StateStore.getResume/putResume`; the
  history index omits it), counted in the room's `state` storage; it embeds its world, so it costs about one state
  plus the live action state (6.5 kB for the 3-walker cross at 5 s; 8.0 kB for two walkers in the director demo).
- Sizes (JSON, printed by `resume.test.ts`): walk_to mid-climb, 2 people: 3.5 kB; converse gathering (4 people
  + 4 child walks) + face: 9.7 kB; sequence between steps: 1.8 kB (records grow with the take's action count).

## Payload sizes (3 walkers, 69.8 s, proving ground; `take.test.ts` prints them)

| Part | Bytes (stable JSON) |
| --- | --- |
| tracks (847 samples vs 4 188 raw walker-ticks) | 21 902 |
| events (action lifecycle incl. phase changes) | 17 211 |
| changes | 3 963 |
| finalState (4 entities) | 1 275 |
| **total** | **44 800** (gzip 9 127) |

<sub>Measured 2026-09-27 with `cd viewer && node --test --test-name-pattern="payload" engine/test/take.test.ts`.</sub>

`finalState` grows with the world (a full campus will dominate); if that matters, store it as a
content-addressed state in the history store and keep only the hash in the take.

## Known gaps

- Two walkers approaching head-on off a single-file passage can wait on each other forever while reporting
  `executing`, not `blocked` (seen when a panel closes the proving-ground passage and both detour around the same
  wall end). The runner's tick budget turns this into `timeout`. The fix belongs in `locomotion/walk.ts`.
- There is no step-level timeout and no `cancel`/`mark` step verbs yet; `at` cues apply only to registry verbs.
