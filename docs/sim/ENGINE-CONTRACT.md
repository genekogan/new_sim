# The engine contract

`packages/engine-contract` is the seam between the shell and any engine. The toy
engine implements it now; the Mars engine gets an adapter later. Names mirror the
Mars engine (`../mars/ENGINE-SNAPSHOT.md`) so the adapter is thin.

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

Differences on purpose: the scaffold `Runtime` requires every `ActionDef` to
implement `serializeExec(exec)` / `restoreExec(rt, params, data, actionId)`, so
`snapshot()` works at any tick with actions in flight. In Mars these are optional
per verb with different signatures (`serializeExec?(rt, exec)`, `restoreExec?(rt, data)`)
plus a `resumable` flag; an adapter must bridge that. `HumanState`
adds `soul`; `Entity` adds `seats`.

## What the shell needs from an engine (`engine.ts`)

```ts
interface Engine {
  rulesVersion: string; dt: number; schema: string;
  runtime: Runtime; world: WorldState; registry: Map<string, ActionDef>;
  describeVerbs(): VerbInfo[];
  stateHash(): string; physicalHash(): string;
  step(): { paths: PathCommit[]; changes: ChangeEvent[]; events: RuntimeEvent[] };
  submit(verb, params, opts?): ActionRecord; cancel(id, reason?): ActionRecord;
  snapshot(): RuntimeSnapshot;
  spawnHuman({ id, label, soul }): string; removeEntity(id): void;
  enumerateActivities(actorId, intent): ActivityOption[];   // feasible now, params bound, cheap
  describeSurroundings(actorId): { nearby[], region, happening };  // word-bucketed, no numbers
  regionAt(p): string; poseSampleOf(id): PoseSample; currentPath(id): PathCommit | undefined;
}
interface EngineFactory { rulesVersion; genesis(seed): WorldState; create(world): Engine; restore(snap): Engine }
```

- `step()` returns what changed for broadcast: **paths** (timed waypoints when an
  actor commits to moving), **changes** (`[tick, entityId, field, value]`), and
  runtime events.
- `ActivityOption { id, template, label, goodWhen?, notFor?, servesIntent?, target?,
  steps: {verb, params}[], durationHint }` is what the mid-brain chooses among.
  The engine, not the model, decides feasibility and binds parameters.
- `enumerateActivities` must be pure (no rng), because it is not called on replay.

## Conformance suite

`@sim/engine-contract/conformance` exports `conformance(name, factory, drive)`:
determinism (same seed and inputs → same hash), different seeds diverge,
snapshot/restore mid-action continues identically, `physicalHash` ignores labels
and env, verbs describe with JSON Schema, unknown verb fails cleanly. Any engine
adapter must pass it (`packages/engine-toy/src/toy.test.ts` shows usage).

## The toy engine (`packages/engine-toy`)

- World: 100 × 100 m plane (`±50`), fixtures `campfire` (12 seats), `bench-1..4`
  (3 seats), `kiosk`, `gate` (arrival); regions `center` (±18 m) and `ring`.
  Schema `sim-toy-world/1`, rules `sim-toy/1+activities/1`.
- Verbs: `walk_to`, `sit`, `stand`, `rest`, `converse`, `gather`, `wave`, `perform`,
  `ambient_wander`, and `do_activity` (runs an ordered list of the others for one
  actor; what `decision` events submit).
- Movement: straight timed paths at 1.35 m/s, integer millimetres, no avoidance,
  arithmetic-only `atan2` so positions are bit-identical on server and clients.
- Activity options: attend the campfire, rest on the two nearest free benches,
  converse with the three nearest Souls, perform, wander near/far, plus
  intent-specific options (follow, go, converse/rest with a named target).
  Options the standing intent asks for are flagged `servesIntent`.

## What the Mars transplant must provide

1. `snapshot()` / restore at any tick with in-flight actions (Mars: "active
   activity snapshots remain explicitly nonresumable").
2. A cheap `enumerateActivities` and `describeSurroundings` (Mars `rehearse` is
   ~200 ms, too slow per Soul).
3. Emitting committed paths as they are decided (the take track format fits).
4. `spawnHuman` / `removeEntity` for arrivals and departures at runtime.
