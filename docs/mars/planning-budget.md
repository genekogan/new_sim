# Planning budget and pinned hashes

How the engine keeps per-tick cost bounded without changing outcomes, and the rules for moving a pinned hash.

## Measure

`rt.profile = true` (`engine/runtime/profile.ts`) records wall ms per `<verb>.plan` / `<verb>.step`, `invariants`, and the
Spatial calls `route`, `sync`, `sync.rebuild`, `routeAround`, `gridsAround`. It is measurement only; a test asserts that
profiled and unprofiled runs hash equal. Benches: `node deploy/perf-stress.mjs` (Lab stepping, 30 wanderers, 60 s) and
`node deploy/perf-walk.mjs` (runs the pinned walker scenarios and asserts their hashes).

## 1. Exact A*, identical routes (default)

`spatial/path.ts` keeps the reference expansion order, relaxation arithmetic and pop order, with a generation-stamped
scratch workspace per grid size, an indexed binary heap over typed arrays, and a tight inner loop.
`engine/test/path-reference.ts` is a frozen copy of the original planner; `planning.test.ts` asserts deep-equal results
(legs, length, expansions, diagnostics) on the navigation, walk and Lab routes and 200 seeded routes.

## 2. Opt-in corridor planner (routes may differ)

`findRoute(…, { planner: 'corridor' })` or `new Spatial(base, { planner: 'corridor' })`: A* on a 0.5 m max-clearance grid,
then the fine A* restricted to cells within 1.5 m of the coarse path. Any failure falls back to exact, so failures and
diagnostics are identical. Most successful routes are identical; the rest differ by a few percent in length. The Lab and
every pinned scenario use `'exact'`.

## 3. Staggered construction replans (`locomotion/walk.ts`)

A walker whose remaining corridor was invalidated replans only within the tick's budget, `REPLANS_PER_TICK` = 4 (or
`services.planning.replansPerTick`). Deferred walkers follow the old corridor while the next stretch is clear, for up to
10 ticks; a blocked stretch forces an immediate replan. `services.replanBudget` records replans, deferrals and the peak.

## 4. Region-local grid updates (`spatial/grid.ts` `updateGrids`)

`Spatial.sync` diffs the new scene's obstacles and surfaces against the previous one and re-rasterizes only the changed
cell rectangles; untouched levels keep their `LevelGrid` object. The EDT is redone exactly on a window: the column pass on
columns whose free bit flipped, the row pass on rows that can change (squared distances are exact integers, so the patch
equals the full EDT bit for bit). `blockers` is an Int32Array-backed `BlockerMap`. `new Spatial(base, { incremental: false })`
restores full rebuilds. `engine/test/grid-incremental.test.ts` compares every patch with a from-scratch `buildGrids` over
random scenes and chained edits and over every rebuild of the pinned runs.

## 5. Cheap sync change test (`spatial/service.ts`, `carry/validate.ts`)

`Spatial.sync` keeps a flat snapshot of the fields that matter per static entity (id, def, phase, pose, connections,
support kind) and compares with `===`, so it allocates nothing when nothing changed and rebuilds exactly when the old
hashed key would have changed (proved by a directed test and a seeded fuzz in `planning.test.ts`). Carry planning patches
its gather and pickup grids from the synced grids with `updateGrids` (`Spatial.gridsFor`).

## 6. Walker per-tick cost (`walk.ts`, `path.ts`, `service.ts`)

Each behind an off switch that `engine/test/walk-perf.test.ts` flips to prove it changes nothing:

- one entity snapshot per `walk_to` step (`stepScope`, `WALK_PERF.stepSnapshot`) instead of repeated
  `Object.values(world.entities)`;
- failing people-replans prove unreachability early (`RouteOpts.proveUnreachable`): a reverse flood from the goal returns
  the same `null` the A* would after exhausting the start's side;
- the unusable-link explanation search runs only when its result is read (`RouteOpts.explainUnusable`);
- `narrow()` single-file labelling as a typed-array flood with the same numbering, reused while a level keeps its clearance
  array.

**Limit.** A tick where many walkers submit at once costs about one exact route per walker. Going much lower needs the
corridor planner or spreading submit-time planning over ticks; both move hashes.

## Pinned hashes

Engine tests and `deploy/perf-walk.mjs`, `deploy/record-campus-take.mjs --check` and `deploy/determinism-probe.mjs` pin final
state hashes, tick counts and take ids of reference scenarios. Rules:

- A performance change must leave every pin unchanged; prove it with an off switch or a frozen reference copy.
- A pin moves only for an intended behaviour or content change, with proof: 0 violations, the same discrete outcome
  (every sequenced part at its target, the same refusals with reasons), and a reason recorded next to the new value in
  the test.
- Re-record takes with `node deploy/record-campus-take.mjs --scenario <name>` and confirm with `--check`.
- Visual baselines (`npm run e2e:update-baselines`) change only for an explained visual change, after inspecting the new
  captures.
- Never relax a tolerance, timeout or ceiling, or skip a check, to make a run pass.
