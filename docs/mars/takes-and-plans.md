# Sequences, plans, takes, replay and rehearsal

Code: `engine/{sequence,take,rehearsal,history}/`, `engine/runtime/snapshot.ts`, `engine/api/pause.ts`. Tests:
`engine/test/{sequence,take,rehearsal,history,resume}.test.ts`, `take-fields.test.ts`. Spec: [spec.md](spec.md) §14, §16,
§21–24, §28.

## Data model

| Artifact | Type | Identity | Depends on |
| --- | --- | --- | --- |
| Sequence template | `SequenceTemplate` (`sequence/types.ts`) | `templateHash` | nothing world-specific |
| Bound plan | `BoundPlan` (`sequence/bind.ts`) | `planHash` | baseline checkpoint, its `physicalHash`, `rulesVersion` |
| Take | `Take` (`take/types.ts`, `take/recorder.ts`) | `id` = hash of everything else | start checkpoint, plan, rules |
| Camera track | `CameraTrack { id, takeId, kind, data }` | own id | a take id; stored beside it |
| Successor checkpoint | `history.commit(…, { kind: 'simulation-run', take, plan })` | checkpoint id | parent = start checkpoint |

**Template.** `{ schema: 'mars-sequence/1', id, params, steps }`; a step is `{ id, verb, params, after?, when?, at?,
onFail?, timeout?, label? }`:

- `after: [ids]` (all completed); `when: { event: 'started'|'completed', step }`; `at: seconds` from sequence start;
  conditions AND together. `timeout` cancels a still-live step (`sequence.step-timeout`).
- `onFail: 'abort'` (default) cancels live steps and skips pending ones; `'continue'` skips only steps whose conditions can
  never hold (`sequence.dependency-failed`).
- Built-in verbs `mark { name, data? }` and `cancel { step }`; a registry verb may not use their names.
- Param kinds: `actor(s)`, `entity/entities` (checked against the baseline), `number`, `string`, `point`, `any`.
- Substitution: a param value that is exactly `$name`, `$name[0]`, `$name.field` (or a chain) is replaced by the bound
  value; `$$x` is the literal `$x`. Labels keep references verbatim (filling them would change `planHash`); readers fill
  them with `bindLabel(label, plan.bindings)`.

**Binding** (`bindTemplate(template, bindings, { history, baseline, registry })`) validates the template (zod, unknown keys
rejected), the step graph (duplicates, unknown refs, cycles), every binding against the baseline, then parses each step's
params with the verb's schema. All problems come back together in `PlanError.diagnostics`.

**Runner** (`SequenceRunner`, `runSequence`). Before every tick it submits ready steps in declaration order, re-scanning to
a fixed point; after each tick it mirrors action records into `StepReport`s. Action ids are `step:<stepId>`. Result
`{ status: completed|partial|aborted|timeout|blocked, steps, violations, diagnostics, startTick, endTick, finalStateHash }`.
A refused cancel is recorded (`sequence.cancel-refused`), never forced. A ready step whose resources are held by an
ambient make-way walk waits for it.

## Takes

`{ schema: 'mars-take/4', id, planHash?, baselineCheckpoint?, baselineStateHash, rulesVersion, dt, startTick, ticks,
keyframeEvery, tracks, changes, events, finalStateHash, finalState, entities0?, removed? }`

- `tracks[entity]`: integer samples `[tick, x_mm, y_mm, z_mm, yaw_mrad(, pitch_mrad, roll_mrad)]`, recorded online by
  `TakeRecorder`. A sample is dropped when linear interpolation between its neighbours reproduces it within `TRACK_TOL`
  (4 mm per axis, 8 mrad). A moving entity gets a sample at least every `keyframeEvery` (20) ticks; the first and last
  samples of a position hold are kept, so pauses are never smeared.
- `changes`: `[tick, entity, field, value]` for `present`, `activity`, `level`, `task`, `grip`, `phase`, `support`,
  `reservedBy`, `connections`, `equipment`, `paint`, `hands` (integer mm), `baseActivity`, `on`, `speed` (cm/s),
  `contents`. Every field is a step function except `hands` and `speed`, which are keyframes interpolated linearly
  (`INTERP_FIELDS`: 5 mm per hand, 1 cm/s); a release or a hand appearing is an exact keyframe.
- `events`: action lifecycle, violations and marks. `compactEvents` merges a same-tick requested → validated → reserved →
  executing run into one event (lossless; `expandEvents` rebuilds it) and folds repeated identical blocked waits into the
  first with `n` and `until`. Read them through `takeEvents` / `expandEvents`; `blockedWaits` counts raw waits.
- `finalState`: the full successor state, so replay never needs the planner or runtime.
- `entities0`: every tracked entity as first recorded (minus provenance, label, tags); `removed: [{ id, t }]`.

Guarantees (`take-fields.test.ts`): sampling at every tick reproduces true poses within 4.5 mm / 8.5 mrad, hands within
5.5 mm, speed within 1.5 cm/s, and exact activity and level.

## Replay (`take/replay.ts`)

`sampleTake(take, t)` returns poses and discrete state at time t (clamped; absent before an entity's first sample).
`replayFinalState(take)` returns a copy of the final state and throws if it no longer hashes to `finalStateHash`.
`sliceTake` keeps the bracketing keyframes of interpolated fields. The module imports only `core/` and `take/types`: no
runtime, registry, planner, spatial or history (a test enforces this).

## Rehearsal and execution (`rehearsal/rehearse.ts`)

`EngineConfig = { registry, invariants, services: (world) => services, maxTicks?, keyframeEvery?, trackTol? }`. Both paths
call one `runPlan`: clone the start state → fresh services → `new Runtime` → `TakeRecorder` → `SequenceRunner`. No fast
path. A spatial service whose static scene hash differs from `world.base.staticHash` is refused
(`services.base-mismatch`).

- `rehearse(history, ws, plan, cfg)` runs from the plan's baseline and never writes history. The controller op keeps the
  take in a small in-memory LRU unless `keep: true`.
- `execute(history, ws, plan, cfg, { takes?, commitOnFailure?, label? })`:
  1. protected workspace → `workspace.protected` (fork first);
  2. plan integrity → `plan.corrupt`;
  3. `checkPlan`: rules version, then physical hash; a difference inside any step's envelope is `plan.stale` with a
     `PhysicalDiff` and the affected steps;
  4. runs from the workspace head;
  5. commits with cause `simulation-run` only if the run completed with zero violations (else `execution.failed`, take
     still returned). An unsettled result is never committed, even with `commitOnFailure`.

`physicalView` includes `inventory`, `rng` and a region's audience `layout`; it excludes `tick`, `env`, labels, tags and
provenance. Camera tracks are not world state.

**Region-scoped staleness** (`rehearsal/envelope.ts`). A plan's envelope, measured on a baseline run, is per step: the
entities and regions it names, every entity that moves while it is live, and padded ground boxes of what they sweep. A
change outside every envelope leaves the plan valid (reported as `outsideEnvelope`); a change of the static base,
inventory mode or RNG reaches every step. Levels are ignored (conservative).

**Auto rebind.** `engine_execute` / `engine_rehearse` take `rebind: 'auto' | 'refuse'` (default refuse). With `auto`, a stale
plan is bound again from the head with the same template and bindings (a new `plan_id`, reported in `rebound`); a binding
that no longer holds is `plan.rebind-failed` naming the steps.

## Invariants (tested)

- Same plan + baseline + rules ⇒ byte-identical take and final state, rehearsed or executed.
- Camera tracks never change a take's hash or final state.
- Rehearsal and replay never mutate history, workspace heads or takes.
- Executing in a fork leaves canonical and sibling workspaces untouched; canonical refuses execution.
- A relevant physical edit after rehearsal ⇒ `plan.stale`; environment, label and provenance edits do not.
- Corrupt persisted history refuses with `corrupt-history`; duplicate explicit action ids throw `action.duplicate-id` before
  any event or reservation.

## Cross-host determinism

Engine math uses `core/math.ts` (`dsin`, `dcos`, `datan2`, `dexp`, `dlog`, …), pure IEEE-754 arithmetic, because host
`Math.sin` differs in the last bit between V8 builds. `node deploy/determinism-probe.mjs [--json]` prints a reference
scenario's `finalStateHash`, take id and math fingerprints: run it on each host (browser, Node, Durable Object) and diff.

## What is resumable

- **Quiescent checkpoints**: any checkpoint between runs; plans bound to it can run any number of times.
- **Mid-action snapshots, for a verified subset.** `rt.snapshot()` returns plain JSON: world, action records, each live
  action's exec and program, reservations, plain-data services, the navigation epoch, `nextId`, violations and the event
  cursor. `Runtime.restore(snap, registry, services, invariants)` steps tick-for-tick identically. The graph codec
  (`runtime/codec.ts`) keeps shared references and Maps/Sets; closures and class instances are refused by path. Restore
  needs the runtime's own fresh services.
  - Resumable (`resume.test.ts`): `walk_to` in every phase, `take_slot`, `sit`, `stand`, `face`, `converse`, `gather`,
    `campfire_circle`, the item verbs, sequences (`SequenceRunner.serialize()` / `restore()`), and `raise_upright` during
    controlled cancellation lowering.
  - Refused loudly (`snapshot.non-resumable`, naming each action): `carry`, construction lifts, vehicle verbs, and any
    verb not yet verified. New verbs opt in with `resumable: true` or `serializeExec` / `restoreExec`, plus a test.
  - `snapshot({ allowDrop: true })` leaves refused actions out and restores them as `cancelled` (`snapshot.dropped`),
    except while they hold a load (`snapshot.drop-unsafe`).
- **History**: `history.commit(ws, snap, { kind: 'pause' })` stores the snapshot as a content-addressed blob;
  `read(id, { resume: true })` returns `{ world, snapshot }`; `fork` at a pause checkpoint gives a workspace that resumes.
- **Ops**: `engine_execute { pauseAt }` runs to the point and commits a pause checkpoint; `engine_resume { workspace,
  until?, commands? }` restores and continues, so a resume with no commands ends in the unpaused `finalStateHash`. Paused
  heads refuse bind, execute and edit (`workspace.paused`).
- **Limits**: restored events start empty (compare from `snap.eventCursor`); observers and the profiler are not carried;
  a sampled take frame is a visual frame, never a resumable state.
