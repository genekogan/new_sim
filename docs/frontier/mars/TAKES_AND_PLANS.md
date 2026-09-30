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

**Step labels (W39).** A step's `label` is display text and may carry the same references *inside* the text
("`$crew[2]` climbs below"). `bindTemplate` keeps `BoundStep.label` exactly as the template wrote it: a filled label
would change `planHash`, and with it every recorded take's `planHash` / id. Readers that show a label fill it with
`bindLabel(label, plan.bindings)` (`sequence/bind.ts`): any inline `$name`, `$name[i]`, `$name.field` is replaced by the
bound value ("m3 climbs below"; a list is joined with ", "), a `.word` that is no field ends the reference (sentence
text), `$$` is a literal `$`, and an unbound name or a missing index is left as written. The take recorder's step
timeline (`deploy/record-campus-take.mjs` `timeline()`, the take file's `steps[].label`, which the studio shows as the
current step and in the log) is filled this way; `engine/test/take-labels.test.ts` checks that no shipped chapter
take's step label or event message still holds a reference.

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
keyframeEvery, tracks, changes, events, finalStateHash, finalState, entities0?, removed? }` (the last two since mars-take/4).
- `tracks[entity]`: samples `[tick, x_mm, y_mm, z_mm, yaw_mrad(, pitch_mrad, roll_mrad)]`, integers.
  Recorded online by `TakeRecorder` (a `RuntimeObserver`): a sample is dropped when linear
  interpolation (shortest arc for angles — the same `interpSample` replay uses) between its neighbours
  reproduces every dropped sample within `TRACK_TOL` (since mars-take/4: 4 mm per axis, 8 mrad; before: 1 quantum).
  Static entities cost one sample; while an entity moves a sample is forced at least every `keyframeEvery` (20) ticks.
  A position hold is exact at both ends: its first still sample (arrival) and its last (departure) are committed, so
  interpolation never smears a pause (angles may turn during the hold).
- `changes`: `[tick, entity, field, value]` for `present`, `activity`, `level`, `task`, `grip`, `phase`,
  `support`, `reservedBy`, `connections`, `equipment`, `paint`, and since mars-take/2 `hands` (integer mm),
  `baseActivity`, `on`, `speed` (integer cm/s), `contents` (initial values at tick 0; entities may appear/disappear).
  Every field is a step (last value ≤ t) except the mars-take/3 thinned fields `hands` / `speed` (below).
- `events`: runtime action lifecycle (message kept only for failed/blocked), violations, marks, relative ticks;
  compacted since mars-take/4 (below). Read them through `takeEvents` / `expandEvents`.
- `finalState`: the full successor state, so replay never needs the planner or runtime.
- `entities0` (mars-take/4): every tracked entity as first recorded, minus provenance / label / tags; `removed`:
  `[{ id, t }]` for each `present: false` change.

## Thinned fields (mars-take/3)

`hands` and `speed` changed on almost every tick someone reached or walked (the 2022 whole-house take: 51,768 `hands`
changes = 3.8 MB, 43,580 `speed` changes = 1.1 MB of 8.3 MB). Since **mars-take/3** (`TAKE_SCHEMA`, W20) their changes
are **keyframes**, simplified like pose tracks. `INTERP_FIELDS` (`take/types.ts`) holds the tolerances.

| Field | Tolerance | Guarantee: `sampleTake` vs the live world at every tick |
| --- | --- | --- |
| `hands` | 5 mm per hand point (Euclidean) | ≤ 5.5 mm (tolerance + ½ mm quantisation) |
| `speed` | 1 cm/s | ≤ 1.5 cm/s |

Rules (`thinChanges` in `take/recorder.ts`, run by `TakeRecorder.finish()`; `RecorderOptions.fieldTol` overrides,
0 = exact at every tick):
- **Semantics.** Between two consecutive keyframes of one entity and field that are both non-null and **of the same
  shape** (the same hands present), the value is linear in the tick (`interpChange` in `take/replay.ts`, also at
  fractional ticks). Otherwise the earlier keyframe holds until the next one. After the last keyframe it holds.
- **Exact events.** A release (`null`: hands free, not walking) and a shape change (a hand appears or goes) are
  keyframes at exactly their tick and are never interpolated across.
- **Holds.** The recorded step signal is simplified per run of one shape. A hold contributes its first and its last
  tick (a line against a constant misses most at the ends), so a pause is never smeared into the motion that follows.
  The same idea as the pose tracks' hold commit.
- **Simplifier.** Greedy, as the pose tracks: a point is dropped when the line between the kept neighbours reproduces
  it, and every point dropped before it, within the tolerance, evaluated with the same arithmetic `sampleTake` uses.
  At most 256 points are pending per keyframe pair.
- **What is untouched.** Every other field, `tracks`, `events` and `finalState`. `replayFinalState` and every pinned
  final-state hash are bit-identical (the final state is not a track). The take `id` changes because `changes` and
  `schema` do; `takeIdOf` itself is unchanged. The camera planner (`camera/take-sampler.ts`) reads only
  `present` / `grip` / `task` / `reservedBy` and tracks, so a re-planned camera track has identical `data`. Its id
  (`cam-` + hash of `{ takeId, data }`) changes only through the take id.
- **Consumers.** `sampleTake` indexes `changes` once per take (a WeakMap on the frozen `changes` array) and
  binary-searches each entity's fields. Before, it scanned all changes on every call. `sliceTake` (`get_take`
  ranges) keeps the bracketing keyframes of thinned fields: the last one ≤ t0 at its own tick and the first one
  after t1. So a slice still samples like the whole take. A mars-take/2 reader (step semantics) still loads a /3
  take, but it holds each keyframe instead of interpolating.

Measured 2026-09-28 (W20) by recording each take with the /2 recorder and applying `thinChanges`. Each run was
checked at every tick against the /2 step signal: worst hand 4.93 mm, worst speed 1.00 cm/s, every release exact.

| Take | ticks | total /2 → /3 (raw) | gzip | `hands` /2 → /3 | `speed` /2 → /3 | tracks | events |
| --- | --- | --- | --- | --- | --- | --- | --- |
| flagship (build bay, campus) | 11,316 | 539 → 468 KB | 117 → 105 KB | — (none) | 114 → 43 KB (4,705 → 1,776) | 277 KB | 86 KB |
| 2022 east-house, first bay | 41,182 | 2.51 → 1.35 MB | 421 → 261 KB | 956 → 30 KB (12,864 → 456) | 362 → 135 KB (15,033 → 5,577) | 695 KB | 319 KB |
| 2022 east-house, whole house | 117,125 | 8.32 → 3.94 MB | 1.35 → 0.76 MB | 3.83 MB → 100 KB (51,768 → 1,494) | 1.06 MB → 414 KB (43,580 → 16,895) | 2.04 MB | 0.90 MB |

(Take JSON only. The studio file adds the camera track, 1.2 MB for the 10 Hz flagship.) `speed` keeps more:
walk_to's speed has real steps (a replan, a yield, 45 → 101 cm/s in one tick), and each step costs its hold's end
keyframe. The acceleration ramps (6 cm/s per tick) reduce to two keyframes.

`sampleTake` at every tick of the whole take: flagship 1.3 s → 0.60 s (112 → 53 µs/tick); first bay ≈ 14.8 s →
2.3 s (358 → 57 µs/tick); whole house ≈ 114 s → 14.3 s (972 → 122 µs/tick). The old figures are extrapolated from
every 20th–1000th tick. The new cost scales with entities, not with take length.

What now dominates a long take: `tracks` (2.0 MB whole house) and `events` (0.9 MB, the action lifecycle incl. phase
changes). A 2020–2026 set of whole-year takes at ≈ 4 MB each is feasible. The next lever would be the events
(phase-change lifecycle lines) or a coarser pose tolerance for people standing still. Both are done in mars-take/4.

## Compact tracks, events and entities0 (mars-take/4)

W22, 2026-09-28. `TAKE_SCHEMA = 'mars-take/4'`. Bumped (not /3) because the `events` field changed meaning for a reader
that counts statuses. The studio loader checks only the `mars-take-replay/1` wrapper and the final-state hash, so it
reads /4 files. A /3 reader still samples a /4 take correctly (tracks and changes keep their format).

**entities0 / removed.** A take used to store nothing about an entity absent from `finalState`: an emptied pile
(`pile-upright-16ft-kit-1` in the 2022 takes) has tracks and changes but no def or kind, so the replay could not draw it.
`entities0[id]` is the entity as first recorded (tick 0, or the tick it appeared): def, kind, pose, phase, support,
connections, contents, human state … minus provenance / label / tags. `removed` lists `{ id, t }` per `present: false`
change. The studio (`take-replay.ts`) draws an entity from the final state, else from `entities0`. Pose, phase, support
and contents still come from the frame (`sampleTake`), so the pile shrinks and disappears at its removal tick. Cost:
5 KB flagship, 8 KB first bay, 18 KB whole house.

**Tracks at TRACK_TOL.** Position 4 mm per axis, angles 8 mrad (`TRACK_TOL`, `take/types.ts`; `RecorderOptions.tol` /
`EngineConfig.trackTol` override, a number applies to both). The guarantee is `sampleTake` vs the live world at every
tick: ≤ 4.5 mm / 8.5 mrad (tolerance + ½ quantum), so inside 5 mm / 0.5°. The measured worst over the meal, hand-up and
yard takes (`take-fields.test.ts`) is 4.50 mm / 8.31 mrad, at the bound. Two rules keep the coarser line honest:
- **Holds are exact at both ends.** Before /4 only the end of a *static* hold (every value unchanged) was committed. At
  4 mm, a line smeared a stop over the next ticks and a start over the previous ones (a turn in place masks a position
  hold), so the take's per-tick speed showed 0.004–0.047 m/s "walk stalls" that the live meter never saw (35 in the
  flagship on open ground, `movement.test.ts`). Now the first still sample (arrival) and the last still sample
  (departure) of a *position* hold are committed. Stalls from the take are back to 0.
- **4 mm, not 5.** At 5 mm the proving-ground cross take moved a directed orbit's searched start heading (0° → 147°) and
  its raise correction (1 → 2.5 m) in `camera-direct.test.ts`. 1–4 mm keep them. It is a marginal search, so it may flip
  again with any change to the motion.

**Events.** `compactEvents` (`take/recorder.ts`, run by `finish()`; `RecorderOptions.compactEvents: false` keeps the raw
stream):
1. **Lifecycle runs.** An action's `requested` event, followed in the stream on the same tick by `validated`,
   `reserved`, `executing` (a prefix of `LIFECYCLE`, ≥ 2 events, only the last one with phase / code / message), becomes
   the last event with `from: 'requested'`. Lossless: `expandEvents` (take/replay.ts; `takeEvents` uses it) rebuilds the
   runtime's events exactly.
2. **Repeated blocked waits.** Per action, a `blocked` event with the same code, message and phase as that action's
   previous one, with at most one `executing` resume of that phase in between, is merged into the first. The first keeps
   its tick exact and gains `n` (waits merged) and `until` (the last one's tick). The resumes in between are dropped; the
   one after the last wait is kept. This is lossy only in the dropped wait / resume ticks. `blockedWaits(events)` counts
   each merged wait `n` times, i.e. the raw stream's number of `blocked` events (the manifest's `blockedWaits`, the studio
   Diagnostics total). A log line shows "(×n until t s)".

**Unchanged.** `finalState`, `finalStateHash`, `changes` and `replayFinalState`: the final state is not a track, and a
recording with the raw stream has identical changes and tracks (`take-fields.test.ts`). Every final-state pin passed
before and after. Recording the /4 takes reproduced each pin: flagship `c56ea8da…` @ 11 459, 2022 first bay `251a44c5…`
@ 41 317, whole skeleton `d382e461…` @ 117 277. The take `id` changes (tracks / events / schema are in it).

**Camera.** The camera planner reads `present` / `grip` / `task` / `reservedBy` and the tracks, so thinned tracks move
it. Planned from the 4 mm tracks against the same motion planned from 1 mm tracks, the camera differed as follows:
flagship ≤ 1.1 cm, 0 key changes; first bay ≤ 1.2 cm; whole house: 99 of 2 933 samples took another correction (up to
26.7 m apart, 50 → 48 cuts, readability deltas ≤ 0.196, all valid). That last one is too close to the 0.2 verify
threshold. So `record-campus-take.mjs` **plans every camera from an exact re-run** (`EngineConfig.trackTol: 1`; same
ticks and final state, checked) and attaches the track to the shipped take's id. The shipped `camera.data` is
byte-identical to a plan from 1 mm tracks. The in-engine director (`direct_camera` on a stored take, the studio's Direct
camera) plans from the stored, thinned tracks.

Sizes (raw JSON of the studio file; the take alone in brackets; gzip -9). Before = the committed files at the start of W22
(mars-take/2, recorded before W21's re-pin, so the motion differs slightly). The whole house had no file; W20's /3
measurement of its take is given.

| Take | ticks | file before → after | take before → after | take gzip before → after | tracks | events | changes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| flagship (campus) | 11 459 | 1.75 → 1.54 MB | 540 → 314 KB | 117 → 67 KB | 277 → 153 KB | 86 → 54 KB | 157 → 82 KB |
| 2022 first bay | 41 317 | 2.88 → 1.34 MB | 2.51 MB → 938 KB | 421 → 169 KB | 695 → 412 KB | 319 → 203 KB | 1.46 MB → 282 KB |
| 2022 whole skeleton (`--full`) | 117 277 | — → 3.85 MB | 3.94 (W20 /3) → 2.71 MB | 0.76 → 0.48 MB | 2.00 → 1.19 MB | 0.90 → 0.59 MB | 0.84 MB |

The 1 mm column for the same /4 run: tracks 276 / 687 / 2 001 KB. Camera tracks are unchanged by all this: 1.19 MB
flagship (10 Hz), 337 KB first bay, 976 KB whole house (0.5 Hz). In the flagship file they are now the bulk.

**The flagship file is not re-recorded yet (still /2, take `969c8bf9…`, pre-W21 motion).** Re-recorded at W21's re-pin
(`c56ea8da…` @ 11 459, take `d2f16bd3…`), it makes `camera-synth.test.ts` (a) fail: the directed 270° bay orbit from
`seat_b1` reaches min readability 0.56, under the planner's 0.6. The same happens with a 1 mm-track re-record of the same
motion, so the new motion causes it, not mars-take/4. `record-campus-take.mjs --scenario flagship` reproduces the file
(deterministic) once the camera side accepts it. Until then `--check` reports the flagship as a mismatch.

## Replay (`take/replay.ts`)

`sampleTake(take, t)` → poses + discrete state at time t (clamped to the take; before an entity's first
sample it is absent; `hands` / `speed` interpolated between their keyframes, in metres / m/s). `replayFinalState(take)` returns a copy of the recorded final state and throws if it
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
  3. `checkPlan`: rules version, then `head.physicalHash === plan.baselinePhysicalHash`; if they differ, the
     change is **region-scoped** (below): outside every step's envelope → valid (`outsideEnvelope`), inside →
     `plan.stale` with a `PhysicalDiff` (`changed: [{ id, fields }]`, added, removed, regions, base, other),
     `affected: [{ step, causes }]` and a message such as "panel changed (pose); inside the plan's
     route/footprint: step s ← panel (pose)";
  4. runs from the workspace **head** (physically identical to the baseline, or different only outside every
     step's envelope; env/labels are carried forward);
  5. commits the final state with cause `simulation-run { take, plan }` only if the run completed with zero
     violations (else `execution.failed`, take still returned/stored; `commitOnFailure` overrides).

`physicalView` (world/types.ts) now also includes `inventory` and `rng`: both change what a run produces, and
(W58, LM-003) a `place` region's audience `layout` (`{ focus, spacing?, rowGap?, kind? }`): it decides where
gather / take_slot send people. A region without a layout hashes exactly as before (the perf-walk and year-build
pins do not move). Excluded on purpose: `tick`, `env` (visual per §19), labels/tags/provenance. Camera tracks
are not world state at all, so camera edits cannot invalidate a plan.

### Staleness is region-scoped (W58, LM-004; `rehearsal/envelope.ts`)

A plan's **envelope** is measured on a run of the plan from its own baseline checkpoint (the rehearsal): per
step, the entities and regions its params name, every other entity that moves or changes while the step is
live (a load on forks, a person stepping aside), and the ground boxes those entities sweep (tracks resampled
every ≤ 1 m, merged to ≤ 3 m boxes, padded by the entity's half-diagonal + 0.75 m; `[x, z]` / `{x, z}` params get
a 0.75 m box). A physical change reaches a step when it changes an entity or region the step names, or when
the changed entity's footprint (before or after) or the region's polygon box overlaps one of the step's boxes.
A change of the static base, the inventory mode or the RNG state reaches every step. Levels are ignored (a
change on the deck above a ground route counts): conservative on purpose.

- No step reached → the plan stays valid. `execute` runs it from the head and reports `outsideEnvelope:
  { summary, diff }`; `rehearse` reports the same instead of `stale`. The equality "rehearsal take = execution
  take" then holds only for an unchanged head: a planner may pick a different route through the changed
  far-away geometry, and the execution's own report is what gets committed.
- The envelope is a pure function of (plan, baseline state): the controller caches it per plan
  (`ENVELOPES` = 16, in memory, never persisted) — from the rehearse op's own run, or, the first time an
  `execute` / `checkPlan` needs it, from one extra run from the baseline (so an unrehearsed plan is scoped too;
  cost: one run). A baseline run that does not complete cleanly has no envelope: then any physical change stales
  the plan, as before W58.

### Auto rebind (W58, LM-001)

`engine_execute` and `engine_rehearse` take `rebind: 'auto' | 'refuse'` (default `'refuse'` = the refusal
above). With `'auto'`, a plan that is stale against the workspace head (region-scoped as above, or bound under
older rules) is bound again — same template, same bindings, the head as baseline — giving a new `plan_id`
(stored, with `StoredPlan.reboundFrom`), and the op returns `plan_id` and `rebound: { type: 'plan.rebound',
from, to, workspace, fromBaseline, toBaseline, reason, diff, summary, affected }`; execute then runs the new
plan (identical to rehearsing it), rehearse rehearses it. A binding that no longer holds (a bound person
removed, a step's params no longer valid) is refused with `plan.rebind-failed`, `details.steps` naming the steps
whose params use the failing binding, `details.diagnostics` and `details.stale`. A plan that is not stale is run
unchanged (no `rebound`).

## Invariants (tested)

- Same plan + same baseline + same rules ⇒ byte-identical take (same `id`, tracks, events) and identical final
  state hash, whether rehearsed or executed.
- Attaching/editing camera tracks never changes a take's hash or final state.
- Rehearsal and replay never mutate history, workspace heads or the take (takes in `TakeLibrary` are frozen).
- Executing in a fork leaves canonical and sibling workspaces untouched; canonical refuses execution.
- History workspace/checkpoint views and `toJSON()` return independent values. Re-publishing an existing workspace refuses with `exists`; only unprotected leaf refs may be deleted. Persisted state/checkpoint/resume hashes and index ancestry are verified, with lazy state/snapshot checks at first read and per-checkpoint snapshot/world consistency. Corrupt storage refuses with `corrupt-history` (LM075; `history-integrity.test.ts`). Content hashes detect corruption, not an authenticated attacker who can rewrite every hash.
- A relevant physical edit after rehearsal ⇒ `plan.stale`; env / label / provenance edits ⇒ still valid.
- Sampling a take at every tick reproduces true poses within TRACK_TOL + ½ quantum (4.5 mm / 8.5 mrad since mars-take/4;
  2 mm / 2 mrad before) and exact activity/level; hands within
  5.5 mm, speed within 1.5 cm/s, releases exact (`take-fields.test.ts`).

## Cross-host determinism

Engine math uses `core/math.ts` `dsin/dcos/dtan/dasin/dacos/datan/datan2/dexp/dlog` (pure IEEE-754 arithmetic; host
`Math.sin`… differ in the last bit between V8 builds; a `core.test.ts` source scan bans them). `node deploy/determinism-probe.mjs [--json]`
prints the flagship build-bay/open-ground `finalStateHash`, take id and math fingerprints — run it on each host (browser, Node, DO) and diff.

## What is resumable — and what is not

- **Quiescent checkpoints:** any checkpoint between runs. A plan bound to it can be rehearsed or executed any
  number of times; any workspace can fork from any checkpoint. A final take state is quiescent only when
  every action is terminal. Certified `blocked` runs retain live actions and supported loads; unsafe
  cancellation can also leave work unsettled. Execute refuses an unsettled result even with `commitOnFailure`.
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
    `raise_upright` is additionally verified only during controlled cancellation lowering
    (`raise-cancel.test.ts`): reverse trail, holder ownership and the lowering cursor resume tick-exactly.
  - **Refused loudly** (`snapshot.non-resumable`, naming each action and why; `NON_RESUMABLE` in snapshot.ts):
    `carry` — its exec drives in-process walk sub-execs (not child actions) registered in `services.walkExecs`,
    publishes load discs through a services closure (`loadDiscs`), and holds planner trajectories + formation
    transitions whose tick-exact restoration is unverified; construction lifts (`raise_upright` outside lowering,
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

mars-take/4 (2026-09-28, W22; the scenario now runs 58.8 s): total 21 365 B (gzip 5 791): tracks 9 640 (378 samples),
events 4 268, changes 5 178 (the /2 fields), finalState 1 250.

`finalState` grows with the world (a full campus will dominate); if that matters, store it as a
content-addressed state in the history store and keep only the hash in the take.

## Known gaps

- Two walkers approaching head-on off a single-file passage can wait on each other forever while reporting
  `executing`, not `blocked` (seen when a panel closes the proving-ground passage and both detour around the same
  wall end). The runner's tick budget turns this into `timeout`. The fix belongs in `locomotion/walk.ts`.
- (Closed by W58, LM-016.) Steps take `timeout` (seconds after the step starts; still live then → cancelled
  with `sequence.step-timeout`, a controlled stop, handled by `onFail`), and the runner has two built-in
  verbs, validated at bind and listed by `list_verbs` as `sequenceVerbs`: `mark { name, data? }` puts a mark
  event in the run and its take; `cancel { step }` stops another step of the plan (live → cancelled, pending →
  skipped, both `sequence.step-cancelled`; a step the plan cancels ran as directed, so the sequence can still be
  `completed`). `at`, `after` and `when` apply to built-ins like to any step. A registry verb may not use a
  built-in's name.

Action ids are unique across live and terminal records. Duplicate explicit ids throw `ActionAdmissionError` with `action.duplicate-id` before events, reservations or history change; the controller translates it to its named refusal envelope. Generated ids skip occupied explicit `aN` names, including after snapshot restore.
