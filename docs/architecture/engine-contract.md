# The engine contract

`packages/engine-contract` is the seam between the shell and any engine. Two
engines implement it: the toy engine (`packages/engine-toy`, the default) and an
adapter over the Mars engine (`packages/engine-mars`, `ENGINE=mars`). Names mirror
the Mars engine (`../mars/ENGINE-SNAPSHOT.md`). Design notes for the adapter:
`../eden4/19-MARS-BRIDGE.md`.

## Mirrored from Mars `viewer/engine`

| Here | Mars source |
|---|---|
| `WorldState`, `Entity`, `Region`, `Pose`, `Provenance`, `Environment`, `physicalView` (`world.ts`) | `world/types.ts` (`mars-world/1`) |
| `hashOf`, `stableStringify`, `sha256` (`hash.ts`) | `core/hash.ts` |
| `RngState`, `seedRng`, sfc32 (`rng.ts`) | `core/rng.ts` |
| `Runtime`, `DT = 1/20`, `submit / cancel / step / stateHash / snapshot / restore`, `RuntimeEvent`, `Invariant` (`runtime.ts`) | `runtime/runtime.ts` |
| `ActionDef`, `ActionRecord`, `StepResult`, `Diagnostic`, `Reservation` (`actions.ts`) | `actions/types.ts` |
| `createRegistry`, `describeVerbs`, `jsonSchemaOf` (`registry.ts`) | `api/registry.ts` |
| `PoseSample = [tick, x mm, y mm, z mm, yaw mrad]` | `take/types.ts` |

Differences on purpose: the scaffold `Runtime` (used by the toy engine only)
requires every `ActionDef` to implement `serializeExec(exec)` / `restoreExec(rt,
params, data, actionId)`, so `snapshot()` works at any tick with actions in flight.
In Mars these are optional per verb. The Mars adapter does not use the scaffold
`Runtime`; it wraps Mars's own and exposes it through `RuntimeView`. `HumanState`
adds `soul`; `Entity` adds `seats`.

## What the shell needs from an engine (`engine.ts`)

```ts
interface Engine {
  rulesVersion: string; dt: number; schema: string;
  runtime: RuntimeView;            // { tick, records, violations, liveIds() }
  world: WorldState;
  describeVerbs(): VerbInfo[];     // { verb, description, inputSchema, scope? }
  stateHash(): string; physicalHash(): string;
  step(): { paths: PathCommit[]; changes: ChangeEvent[]; events: RuntimeEvent[]; programs: ProgramEvent[] };
  perform(program): { id; ok; diagnostic? };        // start a program, replacing what the actor was doing
  stop(programId): void;                            // request stop; committed physical work may drain safely
  canPerform(program): { code; message } | null;    // is the first step feasible now? null = yes; no side effects
  programOf(actor): string | null;
  submit(verb, params, opts?): ActionRecord; cancel(id, reason?): ActionRecord;
  snapshot(): EngineSnapshot;      // opaque to the shell except { format, tick, stateHash }
  spawnHuman({ id, label, soul }): string; removeEntity(id): void;
  anchors(): Anchor[];             // regions and named places that meaning can refer to; stable ids
  enumerateActivities(actorId, intent): ActivityOption[];          // no longer called by the server
  describeSurroundings(actorId): { nearby[], region, happening };  // word-bucketed, no numbers
  regionAt(p): string; poseSampleOf(id): PoseSample; currentPath(id): PathCommit | undefined;
}
interface EngineFactory { rulesVersion; genesis(seed): WorldState; create(world): Engine; restore(snap: EngineSnapshot): Engine }
```

- **`Program`** `{ actor, label, steps: {verb, params}[] }` is a depiction program
  for one actor. A `decision` event starts one. One actor runs one program.
- **`ProgramEvent`** `{ tick, id, actor, kind, step, code?, message? }` with `kind`
  one of `step`, `completed`, `failed`, `cancelled`. For `step`, `step` is the index
  of the step now running; for the other kinds both engines send `-1`. The host
  uses these events to apply a card's changes once its approach steps are done.
- **`Anchor`** `{ id, kind: 'region' | 'place', name, in?, entity?, point?, tags? }`.
  The fold mirrors every anchor as a kernel Thing at genesis and keeps `entity`,
  `point` and `tags` as traits. The place tagged `arrival` is where new Souls are
  put in the kernel.
- **`step()`** returns what changed for broadcast: **paths** (timed waypoints),
  **changes** (`[tick, entityId, field, value]`), runtime events and program events.
- **`VerbInfo.scope`** is `'world'` for a verb that belongs to one world's engine and
  not to the shared body language. Such verbs are listed briefly in `/cards.md`.
- An unknown verb fails with the code `action.unknown-verb` in both engines.
- `ActivityOption { id, template, label, goodWhen?, notFor?, servesIntent?, target?,
  steps, durationHint }` is the shape the mid-brain chooses among. The server now
  builds these from cards (`apps/server/src/deck.ts`), not from `enumerateActivities`.

The interface excerpt above shows the core seam. Current optional hooks include
`takeChunks`, `renderScene`, `canSnapshot`, `configureClock`,
`configureRuntimePolicy`, `compact` and `actorBorrowed`; the exact declarations
are in `packages/engine-contract/src/engine.ts`. Quiet renewal/fault recovery are
host responsibilities using these hooks. Native geometry, body admission and
controller reservations remain authoritative. Finite construction stop requests
finish the committed safe phase before releasing crew; stop is not a teleport
or guaranteed immediate idle pose.

## Body language

Both engines describe the same nine verbs for one actor's body. Cards may use only
verbs the running engine describes. The actor is implied by the program.

`walk_to {to, standoff?}` · `sit {on, seconds?}` · `stand` · `rest {seconds?}` ·
`wave {at?, seconds?}` · `converse {with, seconds?}` · `gather {at, seconds?}` ·
`perform {what?, seconds?}` · `ambient_wander {seconds?, radius?}`

`deck.ts` replaces card references in step params with what the engine can find:
a body's entity id, a fixture's entity id, or a point `[x, z]`.

## Conformance suite

`@sim/engine-contract/conformance` exports `conformance(name, factory, drive)`:
determinism (same seed and inputs → same hash), different seeds diverge,
snapshot/restore mid-action continues identically, `physicalHash` ignores labels
and env, verbs describe with JSON Schema, unknown verb fails cleanly. Both engines
pass it (`packages/engine-toy/src/toy.test.ts`, `packages/engine-mars/src/mars.test.ts`).

## The toy engine (`packages/engine-toy`)

- World: 100 × 100 m plane (`±50`), fixtures `campfire` (12 seats), `bench-1..4`
  (3 seats), `kiosk`, `gate` (arrival); regions `center` (±18 m) and `ring`.
  Schema `sim-toy-world/1`, rules `sim-toy/1+activities/1`.
- Verbs: the nine above plus `do_activity`, which runs an ordered list of the
  others for one actor. `perform` submits a `do_activity` with `preempt`; the
  program id is that action's id and `programOf` reads `human.task`.
- Anchors: each region as a `region`; each fixture as a `place` in its region,
  tagged with its `def`, `seats` if it has any, and `arrival` for the gate.
- Movement: straight timed paths at 1.35 m/s, integer millimetres, no avoidance,
  arithmetic-only `atan2` so positions are bit-identical on server and clients.
- `enumerateActivities` still exists (attend the campfire, rest on a bench,
  converse, perform, wander, plus intent-specific options) and is used only by the
  toy engine's own tests.

## The Mars adapter (`packages/engine-mars`)

The Mars engine is hard-forked under `mars/viewer/engine`. `load.ts` imports that
required in-repo tree and installs a Node SHA-256 provider with identical UTF-8
digests. Browser/Worker hashing stays portable. `MARS_ENGINE_DIR` is obsolete.
`marsFactory()` loads asynchronously; `main.ts` selects it for `ENGINE=mars`.

- **World.** The default adapter configuration retains the synthetic proving ground for
  conformance. Production selects authored camp, ceramic garden or green field
  by WORLD_KEY, with configured arrival points, scenes and bodies. Rules version
  `sim-mars/1+<Mars rules version>`; `schema` is the Mars world's own. A second
  configuration, `MEAL_WORLD`, loads one of Mars's authored scenarios and is used
  by a test only.
- **Lowering.** Each body-language step becomes Mars actions and waits when the
  step begins:

  | Body step | Mars actions |
  |---|---|
  | `walk_to` | `walk_to {x, z}` to a reachable point `standoff` metres from the target (eight directions are tried; never closer than 0.9 m to an entity), then `face` it if it is an entity |
  | `sit` | `sit {fixture}`, then wait; the seat is kept after the step |
  | `gather` | `campfire_circle` or `gather {fixture}` or `gather {region}`, then wait; if none is possible, walk to within 2 m and wait |
  | `converse` | `converse {actors}` if the other body is free and the verb plans; otherwise `face` and wait |
  | `wave` | `face`, then wait |
  | `rest`, `perform` | wait |
  | `ambient_wander` | up to six `walk_to` legs with pauses, drawn from the world RNG |
  | `stand` | `stand`, if something holds the actor |

- **Raw verbs.** Every Mars verb is also described as `mars:<verb>` with `scope:
  'world'`. A raw step fills in `actor` (or `actors: [actor]`) when the verb takes
  one and the step gives none.
- **One program per actor.** `perform` replaces the actor's program. A program
  whose first step moves the body (`walk_to`, `sit`, `gather`, `converse`,
  `ambient_wander`) first asks whatever holds the actor (a seat, a circle, a
  borrowed conversation) to let go, and fails with `actor.busy` if that takes more
  than 15 seconds. A program that begins by waiting, turning or with a raw Mars
  verb keeps what the actor has. While something holds the actor, a `face` is
  skipped, `stand` and raw verbs are submitted as they are, and any other Mars
  action releases the actor first.
- **Borrowed joint staging.** Mars's `converse` takes two actors. The adapter lets a
  `converse` step borrow the other body only while that body has no program and
  nothing holds it. The other body's own program takes it back whenever it needs
  the body, and the borrower's step simply ends.
- **Feasibility first.** `canPerform` plans the first step (`walk_to`, `sit` and raw
  verbs go through Mars's `verb.plan`) and `perform` refuses a program that fails it,
  because in Mars even a refused instruction disturbs the actor.
- **Broadcast.** Movement is sent as keyframes: every 5 ticks (`KEY_EVERY`) a body
  that moved gets a two-waypoint path from its last keyframe to its pose now.
  `currentPath` returns nothing. Activity and seat changes are sent as changes.
- **Snapshot.** Format `sim-mars-snapshot/1`: Mars's own snapshot plus the programs,
  the program counter, bodies waiting to be removed, and the world configuration.
  `stateHash` covers the Mars state hash and the adapter's programs.
  Resumability checks actual ActionDef codecs in the current phase. Active
  non-resumable programs defer the checkpoint; accepted suffix replay continues
  them without dropping work. Daily compaction requires released controllers.
- **Bounded runtime.** Completed records/events are trimmed in the adapter; daily
  quiet renewal creates a fresh native Runtime. Persistent accepted history and
  verified take manifests remain in the DB/R2, separate from Runtime diagnostics.
- **Regions.** `anchors()` returns one region, `grounds`, plus a place per Mars
  region (except `no-go`) and per fixture. `regionAt` returns `grounds` for every
  point. `enumerateActivities` returns nothing.

Not built: scenes (one kernel Thing staged by one Mars coordinator, `../eden4/19`
§5), engine entities for things that cards make, and any motion for manners.
