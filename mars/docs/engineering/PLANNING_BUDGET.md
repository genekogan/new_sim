# Planning budget (2026-09-27)

**Problem.** In lab `stress-30` one tick cost ~200 ms. At tick 5 all 30 wanderers submit `walk_to`,
and each plans its full A\* route synchronously inside `submit()` (spec §13). A construction epoch
can also replan every walker in one tick. Numbers: node 26, M3 Max, `node deploy/perf-stress.mjs`
(lab stepping, 60 s simulated). Cold = fresh process; warm = JIT already warm, as in a long-lived lab or DO.

## Measure: `rt.profile = true`
`engine/runtime/profile.ts` records wall ms per `<verb>.plan` / `<verb>.step`, `invariants`, and
Spatial `route` / `sync` / `sync.rebuild` / `routeAround` / `gridsAround` (keys nest).
It is measurement only; a test checks that profiled and unprofiled runs hash equal.

| stress-30, 1200 ticks | tick mean | max (= tick 5) | route calls | worst route |
| --- | ---: | ---: | ---: | ---: |
| baseline f46f658 (cold) | 0.93 ms | 233 ms | 575 ms / 74 | 51 ms |
| exact planner (cold / warm) | 0.67 / 0.60 ms | 122 / 80–91 ms | ~225 ms / 74 | 29 ms |
| `planner: 'corridor'` (cold / warm) | 0.58 / 0.51 ms | 76 / 42–46 ms | 140 ms / 75 | 16 ms |

400 seeded proving-ground routes (warm), mean / p95 / max: reference 7.7 / 31 / 53 ms; exact 3.5 / 14 / 22 ms; corridor 1.5 / 3.9 / 6.5 ms.

## 1. Exact A\*, identical routes (default)
`spatial/path.ts` keeps the reference expansion order, relaxation arithmetic and (key, insertion) pop order.
- **Reused scratch:** a generation-stamped workspace per grid size replaces the ~10 MB of typed
  arrays allocated and filled on every call.
- **Indexed binary heap** over typed arrays: an entry is re-keyed only when its f is strictly lower.
  A lower g can round to the same f, and then the older entry keeps its place, as in the reference.
- **Tighter inner loop:** per-level locals, and the heuristic uses the same float ops as `centreOf`.

`engine/test/path-reference.ts` is a frozen copy of the old planner. `planning.test.ts` asserts
deep-equal results (legs, length, expanded, diagnostics) on the navigation/walk/lab routes,
variants and 200 seeded routes. **Routes are identical.**
No gain from a FIFO lane for f-ties or a 4-ary heap: most near-ties differ by an ulp, and pops are memory-bound.

## 2. Opt-in corridor planner (routes may differ)
Enable with `findRoute(…, { planner: 'corridor' })` or `new Spatial(base, { planner: 'corridor' })`.
- **Search:** A\* on a 0.5 m max-clearance grid (optimistic: every fine route has a coarse image),
  then the same fine A\* restricted to cells within 1.5 m of the coarse path. Coarse grids are built at sync.
- **Failures:** any failure falls back to exact, so failures and their diagnostics are identical.
- **Successes:** 373/399 seeded routes identical. The rest differ by −1.6…+1.3 m (≤ 3.9 %):
  string-pulling a different raw path can come out shorter.
- **Halo trade-off:** 0.5 m → 349/399 identical, 4.2×; 2.0 m → 379/399, 2.0×. Opt-in only: the lab and every pinned scenario use `'exact'`.

## 3. Construction replans staggered (`locomotion/walk.ts`)
A walker whose remaining corridor was invalidated replans only within the tick's budget:
`REPLANS_PER_TICK = 4`, or `services.planning.replansPerTick`.
- **Deferred:** it follows the old corridor while its next `speed × 10 ticks + 0.5 m` is clear, for up to 10 ticks.
- **Forced:** if that stretch is blocked, or the 10 ticks are up, it replans at once and still counts.
- **Deterministic:** submission-order stepping. `services.replanBudget` keeps replans / deferred / peak.
- **Test:** 10 walkers are heading for the 1 m gap when a panel closes it. The drop tick takes
  62 ms unlimited (6 replans + ~28 ms grid rebuild), 37 ms at budget 4 and 36 ms at budget 2.
  The same 6 walkers replan, with 0 violations.
- **Existing scenarios** peak at 1 construction replan per tick, so the budget never binds there.

## 4. Region-local grid updates on construction (`spatial/grid.ts` `updateGrids`)
Every construction step changes a few components, and `Spatial.sync` used to rebuild every level:
re-raster all surfaces and dynamic obstacles, then a full EDT. On the campus crop (800 × 800 cells, 2,696 prisms)
that is ~34 ms per sync: ~19 ms rasterising the ground surface, ~15 ms EDT, plus a 70k-entry `blockers` map.
- **Diff:** the new scene's obstacles (after the `StaticRaster` base prefix) and surfaces are diffed against
  the previous scene by id + raster geometry. Reordered shared obstacles or repeated keys make it
  fall back to a full rebuild (the first covering obstacle names a cell's blocker).
- **Raster:** each level re-rasterises only the cell rectangles of the removed and added items, with the same
  rule and list order (`stampLevel` clipped). An untouched level keeps its `LevelGrid` object, so the corridor
  planner's coarse grids stay memoised. A new level (a deck appearing) or a level whose height moved is built in full.
- **Clearance, exact on a window:** the column pass is kept per level (`keepColumns`) and redone only on columns
  whose free bit flipped. The row pass is redone only on rows that can change: a cell outside the changed box
  grown by r keeps its distance when the largest old distance on that ring is < r. The old distance is
  1-Lipschitz, and its old nearest blocked cell is neither freed nor beaten. r grows until the bound holds.
  Squared distances are exact integers, so the patch equals the full EDT bit for bit.
  `gridsWithObstacles` (people for `routeAround`) uses the same window.
- **`blockers`** is a `BlockerMap`: a `Map<number, string>` stored as an Int32Array index into an id table.
  A patch copies it with one memcpy instead of rebuilding a 70k-entry Map. It is still read with get / has, and iterates in cell order.
- **Semantics:** `epoch` still bumps on every change, so the `narrow()` and `gridsAround` caches are still keyed by it.
  `new Spatial(base, { incremental: false })` restores the full rebuild.

**Proof (`engine/test/grid-incremental.test.ts`):**
- 240 seeded random scenes × 5 chained edits (insert/remove/move obstacles, overhead and sub-step bands,
  rotated boxes, boxes past the edge, deck sheets that create levels, ground resize, with and without prefix).
  Every patch is compared with a full `buildGrids`: identical `free` bytes, `clearance` float32 bits,
  `blockers` entries and level order. All 1,200 patch.
- 600+ people overlays via `gridsWithObstacles`, windowed and full, compared the same way.
- Every one of the 378 + 378 rebuilds of the build-bay probe run, the lab `construction` scenario and the
  campus flagship is checked against a from-scratch build, with both pinned hashes asserted.
- Mutation check: breaking the ring bound (skipping the loop, or under-estimating by 1.5 cells) fails the random test.

| per-sync grid rebuild (378 per run), node 26, M3 Max, loaded host | before | after |
| --- | ---: | ---: |
| build-bay probe, open ground 35 × 30 m: mean / max | 5.8 / 9–11 ms | 0.7 / 5.5 ms |
| probe total rehearsal | 6.0 s | 4.1 s |
| campus flagship (80 m crop): mean excl. first build | 34.9 ms | 1.9 ms (first full build ~200 ms, unchanged) |
| campus flagship: rebuilds total / rehearsal compute | 13.4 s / 22.5 s | 0.9–1.3 s / 9.9–11.8 s |
| stress-30 tick mean / max | 0.69–0.72 / 132–177 ms | 0.65–0.67 / 131–132 ms |

Hashes unchanged: probe `79447f750779…96129`, stress-30 `e55d3ee17dd5…8e989`, campus flagship
`b159317e2937…c0bda`. The `f60e10b4…` campus hash below predates the walk.ts re-pin: the tree before this
change already printed `b159317e…`, the manifest hash in `RELEASE_CHECKLIST.md`.
**Remaining sync cost** after this section (the sha256 navigation key; the whole-grid builds in `carry/validate.ts`) is handled in §5.

## 5. Cheap sync change test; carry grids patched (`spatial/service.ts`, `carry/validate.ts`)
- **Sync change test:** `Spatial.sync` used to sha256 `[id, def, phase, pose, connections, support kind]` of every
  static entity on each call (~32–35k calls per run, ~2 s). It now keeps a flat snapshot of those fields per static
  entity, in world order, and compares with `===`. That allocates nothing when nothing changed.
  Values are copied, not referenced, because actions mutate `pose.p` in place and push onto `connections`.
  `===` agrees with the old key's JSON text: -0 = 0, `pitch: undefined` ≠ 0, `connections` [] = undefined.
  So it rebuilds exactly when the old key changed; there is no quantisation and no hash collision.
- **Proof (`planning.test.ts`):** a directed test edits each relevant field and asserts a rebuild. The fields: p[0..2] in
  place, yaw, pitch set / cleared, roll, phase in / out of the static set, def, support kind, connection push /
  in-place field / pop, entity added / removed / re-inserted, twins swapping order, human ↔ component.
  It also edits the irrelevant fields and asserts no rebuild: label, provenance, assembly, support detail,
  equal connection copies, -0, deep clones, walking humans, carried components.
  A 1,500-edit seeded fuzz checks that `sync()` rebuilds iff the verbatim old `hashOf` key changes.
  Dropping the id, pitch, connection or set-size comparison fails it.
- **Carry grids:** `planCarryAction` built whole grids twice per plan: the gather-approach grid (the item as a 1 m
  obstacle) and the pickup grid of a tall item (the item left out). `Spatial.gridsFor(scene)` now patches them from the
  synced grids with `updateGrids` and the base raster, falling back to `buildGrids`. The item's obstacle is a pure
  remove + append, so every call patches: 16/16 in the test.
- **Proof (`grid-incremental.test.ts`):** every `gridsFor` call is compared with a from-scratch `buildGrids`. That covers the
  carry corner runs, a standing-upright pickup and the probe's 13 carries (free, clearance bits, blockers). The gather routes are pinned to those
  planned on the old path (`8b5ab468…125f8`).

| per run, node 26, M3 Max, loaded host (scratch bench over `rehearse`) | before | after |
| --- | ---: | ---: |
| build-bay probe: sync without rebuild (31,617 calls) | 1.82 s | 0.06–0.12 s |
| build-bay probe: carry.plan (13 plans) | 0.59 s | 0.57–0.58 s (small grid; noise) |
| build-bay probe: rehearsal compute | 4.3 s | 2.6–2.7 s (5.0 s once, host load) |
| campus flagship: sync without rebuild (34,683 calls) | 2.04 s | 0.08–0.09 s |
| campus flagship: carry.plan (13 plans) | 4.0–4.2 s | 1.2–1.3 s |
| campus flagship: rehearsal compute | 9.6 s | 5.0–5.6 s |

Rebuild counts are unchanged (378 per run), and so are the hashes: probe `79447f750779…96129`, stress-30 `e55d3ee17dd5…8e989`,
campus flagship `b159317e2937…c0bda`. Grid rebuilds (~0.2 s probe, ~0.9–1.0 s flagship) are now the largest sync cost.

## 6. Walker per-tick cost after splined turns (W11, 2026-09-28; pure performance, every hash identical)
W4's splined turns + block reaction (`MOVEMENT.md`) roughly doubled `walk_to.step`. Four changes, each behind an off
switch that `engine/test/walk-perf.test.ts` flips to prove it changes nothing:
- **One entity snapshot per `walk_to` step** (`walk.ts` `stepScope`, `WALK_PERF.stepSnapshot`). The people scans
  (encounter, look-ahead, intrusion, driven vehicles, stairs, occupant, sidestep) each called `Object.values(world.entities)`,
  4–6× per walker per tick. `world.entities` is a V8 dictionary-mode object (any map with more than a dozen keys added one by one),
  where each call sorts and copies: ~2.1 µs for 30 entities. Now it is read once per step via `Object.keys` + index
  (`entityList`, same `OrdinaryOwnPropertyKeys` order, ~0.5 µs). The carried-load discs (`services.loadDiscs`, rebuilt from
  every carried component per call, 2–4× per step) are read once per step on first use. A walker's step never adds, removes
  or replaces an entity and never moves a load (poses are read live through the same objects), so every scan sees exactly
  what it saw before. Outside a step (carry's `makeWay`, `stairBlocker` from the carry climb): fresh reads.
- **Failing people-replans prove unreachability early** (`path.ts` `RouteOpts.proveUnreachable`, set by
  `Spatial.routeAround`; `Spatial.proveUnreachable`). A reverse flood from the goal runs alongside the A\*, one cell per
  expansion, over exactly the A\*'s moves backwards: 8 neighbours, no corner cutting, link edges reversed. The A\* only
  ever expands the start and passable cells. So if the flood runs out without meeting the start, the A\* would exhaust
  the start's side and return `null`, and the search returns that `null` at once. That is the same diagnostic. It applies
  only when the grid has ≤ `maxExpand` cells, so `route.search-limit` cannot be the answer. The A\* itself is untouched.
  The stress-30 case: a walker on the ground whose deck goal is cut off (people at stairs-a's foot, stairs-b unfinished).
  The deck pocket (3,957 cells) runs out after 1 ms, where the start's side (~720k cells) took ~65 ms.
- **The unusable-link explanation only when read** (`RouteOpts.explainUnusable`, `WALK_PERF.lazyLinkDiagnostics`). After a
  failure, `findRoute` runs a second, successful exact search with unusable links allowed, only to name the unfinished
  stairs (`route.link-unusable`). That search took 15–20 ms. The walker is the only `routeAround` caller, and it reads a
  failure only for `subjects` among its obstacle ids (the fewer-obstacles fallback). So it asks for the explanation only if
  an unusable link has such an id. The fallback's second call, of which only `.ok` is read, never asks. Decisions are
  identical; the discarded message says `route.unreachable` instead of naming the stairs. Other `findRoute` callers are unchanged.
- **`narrow()` labels** (`service.ts` `narrowComponents`). The single-file component labelling that `findNarrows` needs on
  every construction epoch was a full-grid flood with an array literal per popped cell. Now it is a typed-array flood with
  the same predicate and the same row-major first-cell numbering (the flood order cannot change the labels). It is also
  reused while a level keeps its clearance array: `updateGrids` keeps the array when no cell flips, and clearance arrays are
  never written after they are built. The traffic resource names (`narrow:<epoch>:<level>:<n>`), which also reach
  `app/lab/overlay-grids.ts` and runtime snapshots, are unchanged.

**Proof.** `walk-perf.test.ts` checks the following:
- `proveUnreachable` routes deep-equal the frozen reference A\* (`path-reference.ts`) over 63 cases: goal / start / both
  walled in by rings of people, the cut-off deck, random people. 20+ of them fail with `route.unreachable` or
  `route.link-unusable`. The corridor planner is identical with and without the proof, and a small `maxExpand` still
  gives `route.search-limit`.
- `explainUnusable` = all equals the reference. `explainUnusable` = none changes only link-unusable → unreachable.
- `narrowComponents` equals the frozen old `narrow()` on 4 radii / margins, 12 seeded obstacle scenes, and every
  `narrow()` call of the build-bay probe (pinned hash).
- Stress-30 with every switch off equals on: exact (the pin) and corridor (its tick-1126 failing replan). Same for the meal.

`deploy/perf-walk.mjs` runs the five pinned scenarios and asserts their hashes. Every
number below was measured against a tree of the same HEAD with these four commits reverted, alternating, on a loaded host
(load average 15–30); stress-30 is warm (median of 6 in-process runs after one cold run):

| scenario (hash, before = after) | before | after |
| --- | ---: | ---: |
| stress-30 exact `093779fd18f0…` — tick mean / max / CPU per 60 s run | 0.69–0.71 ms / 99 ms / 945–961 ms | **0.48–0.50 ms** / 94–99 ms / 665–680 ms |
| stress-30 corridor `0754e1ebe936…` — tick mean / max | 0.71–0.73 ms / 88 ms (tick 1126) | **0.43–0.44 ms / 53 ms** (tick 5) |
| failing people-replan (stress-30 corridor, tick 1126, `routeAround`) | 88–94 ms | **8.5–9.5 ms** |
| stress-30 `walk_to.step` total (profiled) | 0.56–0.57 s | 0.31–0.33 s |
| build-bay probe = flagship rehearsal `93fa2a0a7900…` — compute / walk_to.step | 2.94–2.97 s / 0.11 s | 2.72–2.85 s / 0.07 s |
| campus flagship crop `ecb424c74d87…` — compute / walk_to.step | 5.44–5.55 s / 0.18–0.19 s | **4.76–4.81 s** / 0.10 s |
| meal `9dae86bfd31e…` — compute | 0.06–0.07 s | 0.06–0.07 s |
| build-bay v3 `5f32379db672…` — compute / walk_to.step | 5.86–5.99 s / 0.28 s | 5.62–5.68 s / 0.15 s |

(`narrow()` on campus + v3: 701 → 105 ms. `walk_to.step` counts top-level walks only; carry's crew walks run inside `carry.step`.)

**W4's "+10–25 % flagship compute" did not reproduce.** At `9e1c2f4^` vs `9e1c2f4` the probe ran 3.18–3.38 s vs 3.05–3.07 s,
and the campus crop 5.94–6.26 s vs 5.86–6.06 s, per tick about equal. Those figures were probably host load. Walker code is now ~5 %
of the probe rehearsal; the rest is invariants, the take recorder, carry planning and sequence submits.

**Not done, and why.**
- **Max tick ≤ 60 ms with the exact planner.** Tick 5 is 27 synchronous exact A\* plans (399k expansions, 82–95 ms warm;
  95 % in the search loop and heap). Exact routes pin the pop sequence. An inner-loop rewrite (orthogonal passability reused
  for corner tests, per-level heuristic tables) and an int32 tie-break array gained 0–5 %, inside noise, so they were not kept.
  The remaining options all move hashes. One is the corridor planner (max 53 ms here; 373/399 routes identical, the rest ±4 %
  in length, so every walk timing moves). The other is spreading submit-time planning over ticks (moves every start).
- **Look-ahead cache / arc memo.** After the snapshot, `hazardAhead` is ~0.03 ms per tick (stress-30) and `smoothPolyline`
  < 5 ms per rehearsal. An exact cache would need every input (s, v, offset, target offset, each candidate's pose, epoch) as
  its key, and they change every tick for a walker. Not worth the risk.
- **`segmentClearance` redundancy.** On the per-tick path it runs only in `place()`, and with a zero offset q = base there.
  The 17-offset scans (`sidestepTarget`, `roomToPass`) run once per encounter, not per tick.

## Hashes: before = after, no changes
Probe / flagship build-bay `d54eca7c402a…0f610`; campus flagship `f60e10b461dd…4c182`; lab stress-30
`a6e42f5c6bfb…0e26c` (now pinned in `planning.test.ts`); the other 8 lab scenarios are unchanged too.

**Re-pinned 2026-09-27 (walk.ts head-on passing, not the budget):** head-on walkers with room to pass
now both slow to 0.7 m/s on the 0.45 m offset instead of the later id stopping (`roomToPass`, latched
per encounter). That shifts encounter timing: stress-30 `a6e42f5c…0e26c` → `e55d3ee17dd5…8e989`; probe /
flagship build-bay `d54eca7c…0f610` (11522 ticks) → `79447f750779…96129` (11403 ticks, take
`bf58b85269c981003ce6d9c6`); 0 violations. Campus flagship hash not re-measured here.

**Re-pinned 2026-09-28 (grid lattice anchoring, not the budget):** grid cell coordinates were origin-relative
(`centreOf` = x0 + (i + 0.5)·cell), so the same physical cell had centres differing by ulps under different
bounds (the cropped vs full campus: x0 −12 vs −162), and the full-campus flagship diverged from the cropped one.
Every `LevelGrid` now sits on one global lattice (`spatial/grid.ts`): integer offsets `ox/oz`, cell (i, j) =
lattice cell (ox + i, oz + j), centre `latticeCentre(k) = (k + 0.5)·cell`, `cellOf` = floor(x / cell) − ox; the
raster, EDT extents (`latticeOf(bounds)`), A* heuristic, lattice-aligned corridor coarse grids and the carry
planner's field / closed-set bins all go through these. Moved pins (all 0 violations before and after):

| pin | before | after | ticks |
| --- | --- | --- | --- |
| probe / flagship build-bay | `79447f750779…96129` (take `bf58b85269c981003ce6d9c6`) | `c2c84663c993…67a41` (take `3d279fa1eeac4e9a3eec1584`) | 11403 → 11400 |
| campus flagship (staging-east crop) | `b159317e2937…c0bda` | `42dec8e8f371…dde61` | 11950 → 11926 |
| campus flagship, full uncropped | `3a01328f85ed…4a071` (≠ crop) | `42dec8e8f371…dde61` (= crop, now asserted) | 11986 → 11926 |
| lab stress-30 (60 s) | `e55d3ee17dd5…8e989` | `0ec4d884598d…ecf58` | fixed 1200 |
| carry gather routes (`G`) | `8b5ab468…125f8` | `ea04513b…539ab` | — |

Behaviour check against the previous tree: the probe and the cropped campus flagship end with the same
entities, every component bit-identical, every person at exactly the same pose and discrete state (all 24
campus components installed); only the durations move (−3 / −24 ticks). The gather routes are the same cells,
vertices ≤ 1 ulp apart. Stress-30 diverges visibly after 60 s (a soak whose walkers draw new goals from one
shared RNG on arrival, so one shifted arrival reorders every later draw); 0 violations both.

**Re-pinned 2026-09-28 (splined turns + immediate block reaction, 2026-09-28 — not the budget; `9e1c2f4`,
`docs/engineering/MOVEMENT.md`):** walk legs are smoothed into fillets with curvature speed caps, heading follows the path
(turn in place only beyond 120°), a 1.5 s look-ahead stops walkers short of standing people / loads and a block is decided
within 0.5 s. Every walk changes timing, so every pin moves once. Verified in a clean worktree (HEAD `11cd063` + only these
changes): each run ends with 0 violations and the same discrete outcome — same step statuses, every component in the same
phase / support, every person on the same level with the same final activity (v2: p1 and p2 both sit; meal: 5 cycles each,
bowls and pot empty; v3: every joist / sheet handed and received by the same people) — only durations shrink:

| pin | before | after | ticks |
| --- | --- | --- | --- |
| probe / flagship build-bay | `c2c84663c993…67a41` | `93fa2a0a7900…ac67b` | 11400 → 10693 |
| campus flagship (staging-east crop) = full uncropped | `42dec8e8f371…dde61` | `ecb424c74d87…cbb3a` (crop == full still asserted) | 11926 → 11227 |
| lab stress-30 (60 s) | `0ec4d884598d…ecf58` | `093779fd18f0…fcac55` | fixed 1200 |
| meal (`meal.test.ts`) | `baf84de6a939…0ccbfd` | `9dae86bfd31e…a70f87` | 689 → 631 |
| build-bay v3 (`build-bay-v3.test.ts`) | `584685f13886…7fd588` | `e121377dd6d7…a75924b9` | 17288 → 16191 |
| build-bay v2 (not hash-pinned; outcome checked) | `5695f7a8e535…` | `a463bfe2ef12…` | 13536 → 12802 |
| carry gather routes (`G`) | `ea04513b…539ab` | unchanged | — |

Cost: stress-30 mean tick 0.41–0.63 → 0.71–0.85 ms (look-ahead + 0.5 s decisions; `walk_to.step` ≈ 2×), max tick
exact 99–113 ms (tick 5), corridor 83–95 ms (a failing `routeAround` decision, ~90 ms, falls back to the exact planner);
the test's bounds (≤ 250 / ≤ 120 ms) hold. Flagship rehearsal compute +10–25 % (loaded host).

**Re-pinned 2026-09-28 (kneel rule at the edge (W8 patch), 2026-09-28 — not the budget; W10):** at the hand-off a
receiver's hands are ≤ 0.8 m horizontally from their feet (`EDGE_REACH` 0.5 + `KNEEL_BACK` 0.3; plan-time station choice in
`hand_up` and per tick in `lift.hands-out-of-reach` at `reach_down` / `take`). v3's s2 receivers moved: crew[4] kneels on b3
just north of s2, crew[5] at s1's north-west corner; crew[4] steps onto s2 once it is fastened (new step `onto_s2_4`,
87 → 88 steps). 0 violations; same outcome (every joist / sheet handed and received by the same people). Rules
`mars-assembly/3`.

| pin | before | after | ticks |
| --- | --- | --- | --- |
| build-bay v3 (`build-bay-v3.test.ts`) | `e121377dd6d7…a75924b9` | `0870c58386cc…caef946a` | 16191 → 16248 |

**Re-pinned 2026-09-28 (body model unification, 2026-09-28 — not the budget; W10, `BODY_MODEL.md`):** hand-up,
items, solar, aloft fastening, paint and station reach import one body model (`engine/body/model.ts`): arm 0.62 m (was
0.75), shoulders ≤ 1.48 m (1.42 + 0.06 heels; was 1.45), overhead 2.06 m (was 2.1). Hand-up givers now carry a load at
0.80 m (hands hanging; was 0.75) and a one-end (lever) giver stands beside the load's end instead of 0.3 m beyond it
(the inner hand was 0.7 m out). 0 violations; same outcome (every joist / sheet handed and received by the same
people, same step statuses, everyone ends idle off the structure). The meal pin did not move.

| pin | before | after | ticks |
| --- | --- | --- | --- |
| build-bay v3 (`build-bay-v3.test.ts`) | `0870c58386cc…caef946a` | `339cf310d7cc…9f36ad1e` | 16248 → 16219 |

**Re-pinned 2026-09-28 (body model = measured rig, 2026-09-28 — not the budget; W12, `BODY_MODEL.md`):** the engine
body model is the measured rig: shoulders 1.34 m (were 1.42), half-width 0.15, reach-down 0.5 m below the feet (was
1.0), posture bands recomputed from the rig (tops 1.45 m = shoulders + 5 cm shrug + 6 cm heels; kneeling shoulders
≥ 0.07 m above the feet, lean 0.35), chest 1.22, rest hands 0.72 m up (hand-up givers carry at 0.72 m, was 0.80).
Hand-up givers raise a load only as high as the `reach_up` envelope reaches at their grips (2.05 m from the ground).
v3: 0 violations; same outcome — identical step statuses, per-person grip sets (entity | slot role), level changes and
final phase / support / activity / level of every entity (scratch diff against `719ba10`); only the timing moved.
The meal pin, the year-build first bay (`ad844b78…` @ 41019) and the campus pins did not move.

| pin | before | after | ticks |
| --- | --- | --- | --- |
| build-bay v3 (`build-bay-v3.test.ts`) | `339cf310d7cc…9f36ad1e` | `5f32379db672…715d0c73` | 16219 → 16237 |

**Re-pinned 2026-09-28 (walker fallback + hypot + encounters on the smoothed path, 2026-09-28 — not the budget; W15,
`MOVEMENT.md` §2).** The walker changes:
- the decision clock survives creeping;
- a failed people-replan names who is behind it (`RouteOpts.nameObstacles`), and the fallback is a squeezed replan;
- a crowded start snaps up to 1 m;
- a walker at the end of its route counts as standing;
- the static sidestep never flips while its person is alongside;
- follow / head-on / crossing use the smoothed path ahead.

`core/math.ts` `dist2` / `len2` and every former host `Math.hypot` in `engine/**` are now √ of a sum of squares
(`hypot`); the source scan bans `Math.hypot`. Every pin moves once. Verified against HEAD (`b7dd62e`, re-checked on
`87ed562`) with a scratch outcome diff: each run ends with 0 violations and the same discrete outcome. That is the same
step statuses, every component in the same phase / support, and every person on the same level with the same final
activity. v3 also keeps the same per-person grip sets and level changes. The meal keeps the same records per verb and
status (4 people sit, bowls and pot empty); only its action ids shift with submission order. Only durations move:

| pin | before | after | ticks |
| --- | --- | --- | --- |
| probe / flagship build-bay | `93fa2a0a7900…ac67b` | `0147f8f12a99…fd30d5` | 10693 → 10729 |
| campus flagship (staging-east crop) = full uncropped | `ecb424c74d87…cbb3a` | `fee92ee0a94f…40c56` (crop == full still asserted) | 11227 → 11316 |
| lab stress-30 (60 s) | `093779fd18f0…fcac55` | `1298e2e57b62…5ee6b` | fixed 1200 |
| meal (`meal.test.ts`) | `9dae86bfd31e…a70f87` | `035e8c3949b7…baba5` | 631 → 626 |
| build-bay v3 (`build-bay-v3.test.ts`) | `5f32379db672…715d0c73` | `66800edc569a…ccaa2af8d5` | 16237 → 16230 |
| year-build first bay (`year-build.test.ts`) | `ad844b78da3f…248121` | `695d2dcb001b…080a81` (24/24 at the canonical pose, max 0.57 mm / 0°) | 41019 → 41182 |
| year-build whole house (`YEAR_BUILD_FULL=1`) | `14d5c7687782…30c89a` | `35d128861c53…86e11da` (66/66, max 0.57 mm / 0°) | 116477 → 117125 |
| carry gather routes (`G`, `grid-incremental.test.ts`) | `ea04513b…539ab` | `9ba1037c…0133f`: same cells and vertices, one leg length 1 ulp apart | — |
| build-bay v2 (not hash-pinned; outcome checked) | `a463bfe2ef12…` | `7d9b34cde6e4…` | 12802 → 12812 |

`walk-perf.test.ts` still holds unchanged in substance:
- every W11 switch off === on (stress-30 exact and corridor, the meal, the probe);
- `proveUnreachable` routes === the frozen reference A\* (`path-reference.ts` takes the same `hypot`);
- `narrow()` === the frozen reference.

Only its pinned hash strings were updated. `deploy/perf-walk.mjs` asserts the new pins (PIN-OK ×5). One run on a shared
host gave stress-30 a 0.35 ms mean and 29 ms max tick, against W11's 0.48 ms / 94 ms. Plausibly `Math.sqrt` is cheaper
than V8's `Math.hypot`, but that is not a controlled measurement. New cost: a failing people-replan whose failure names
a person pays for one squeezed search (~ the same as the first, with `proveUnreachable`).

**Re-pinned 2026-09-28 (no walker jumps: snaps walked, teleport 0.15 m, overspeed invariant, 2026-09-28 — not the
budget; W21, `MOVEMENT.md` §7).** `walk_to` moves a body at most min(speed, 1.4 m/s)·DT per tick. Forward progress,
sidestep and pull-back share that budget, so walkers slow down on the outside of a bend with a sidestep and step back
into line before a gap. The offset is reverted with the body when the hard layer cancels a step. A frame climb starts
from the body. `motion.teleport` is 0.15 m/tick for people on foot, and `motion.overspeed` is new. Every pin moves once.

Verified against HEAD `e8fb08a` with a scratch outcome diff (W15's, plus the year build), run in a pristine worktree
and in the change's:
- every run ends with 0 violations and the same discrete outcome: step statuses, component phase / support, and each
  person's level, final activity, task and grip;
- v3 also keeps the same grip sets and level changes;
- the meal differs only in action ids.

Only durations move:

| pin | before | after | ticks |
| --- | --- | --- | --- |
| probe / flagship build-bay | `0147f8f12a99…fd30d5` | `b746b0947e65…7f0c3` | 10729 → 10901 |
| campus flagship (staging-east crop) = full uncropped | `fee92ee0a94f…40c56` | `c56ea8da9b03…47157` (crop == full still asserted) | 11316 → 11459 |
| lab stress-30 (60 s) | `1298e2e57b62…5ee6b` | `5c3a33552578…a194e` | fixed 1200 |
| meal (`meal.test.ts`) | `035e8c3949b7…baba5` | `3c28879fa21e…090eb` | 626 → 608 |
| build-bay v3 (`build-bay-v3.test.ts`) | `66800edc569a…af8d5` | `a2f782ad96a0…36e38` | 16230 → 16401 |
| year-build first bay (`year-build.test.ts`) | `695d2dcb001b…080a81` | `251a44c54229…4c96f` (24/24 at the canonical pose) | 41182 → 41317 |
| year-build whole house (`YEAR_BUILD_FULL=1`) | `35d128861c53…86e11da` | `d382e4614e8a…40617` (66/66, max 0.57 mm / 0°) | 117125 → 117277 |
| carry gather routes (`G`, `grid-incremental.test.ts`) | `9ba1037c…0133f` | unchanged (routes are planned, not walked) | — |
| build-bay v2 (not hash-pinned; outcome checked) | `7d9b34cde6e4…` | `f911675c…` | 12812 → 12999 |

Runs are 1–2 % longer. The flagship is +143 ticks (7 s): walkers slow on the outside of their sidesteps instead of
sweeping round at 2–3 m/s, and step back into line before a gap. `deploy/perf-walk.mjs` reports PIN-OK ×5. One run on a
shared host had stress-30 at a 0.30 ms mean and 27 ms max tick. The limiter's bisection runs only when a step is over
budget.

Takes re-recorded at these pins afterwards: the 2022 first bay and whole skeleton (W22, mars-take/4; cameras re-planned with
the kind-aware sampler in W26) and the flagship (W23, `d2f16bd3…`); `record-campus-take.mjs --all --full --check` is OK for
all three (W26).

**Re-pinned 2026-09-29 (v3 step-off spot searched (origin-independent), 2026-09-29 — not the budget; W27).** v3 failed
at some site origins because the grid's clearance is a cell-centre value on the global 0.1 m lattice: the same site-local
spot reads differently depending on where the site falls on the lattice. At staging-east (28, −9) and on open ground at the
same origin, crew[4]'s step-off target on s2 (−0.2, 2.8) is truly 0.35 m from s2's north edge but reads 0.25 m < 0.28 m.
`beam_walk` refused it with `beam.no-room` (framemove.ts `deckAt`: the landing spot needs grid clearance ≥ the body
radius). Separately, `carry_spare` aborted at 7 of 17 open-ground origins: the spare tread's end load disc (r 0.163 m)
sat 0.171 m from the s1/s2 corner. Fixes:
- `beam_walk` now lands on the nearest spot with room within `STEP_OFF_SEARCH` = 0.15 m (1.5 cells). The search uses
  rings of 0.05 m in 16 fixed directions and takes the most room on the first ring that has any. A target truly at an
  edge is still refused. `deckAt` itself is unchanged; handup.ts uses it.
- v3's spare tread now lies at (0, 1.0), across s1 on s2's axis, with its carrier on s2. Every load disc is ≥ 0.27 m from
  a deck edge.

Verified: v3 completes with 0 violations at 17 of 17 open-ground origins (it was 10 of 17) and at staging-east (17 034
ticks; it was `beam.no-room`). At the origin, the discrete outcome is identical to HEAD `49bd10f`: step statuses,
component phase and support, each person's final level, activity, task and grip, grip sets and level changes. The pinned
open-ground target has room, so the step-off search never runs there. The pin moves only because the tread's spot moved.

| pin | before | after | ticks |
| --- | --- | --- | --- |
| build-bay v3 (`build-bay-v3.test.ts`) | `a2f782ad96a0…36e38` | `39a0fb3f4d24…7c2ba` | 16401 → 16374 |

No other pin moves. The engine suite is otherwise unchanged. New regression tests: v3 at (28, −9, −0.16) and
(0.07, 0.03), and a `beam_walk` step-off unit test (lands within 0.15 m; still refused at 0.12 m from an edge).

## Limits
The tick-5 spike is 30 synchronous plans, so exact stays at ~30 × route cost (80–120 ms); < 60 ms needs the
corridor planner (§6: an exact inner-loop rewrite gained ≤ 5 %; corridor max tick is 53 ms once failing replans are cheap). The stress test (warm, parallel runner) asserts max tick ≤ 150 ms exact (measured 84–91), ≤ 60 ms corridor (42–45).
