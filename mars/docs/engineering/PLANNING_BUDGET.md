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

## Limits
The tick-5 spike is 30 synchronous plans, so exact stays at ~30 × route cost (80–120 ms); < 60 ms needs the
corridor planner. The stress test (warm, parallel runner) asserts max tick ≤ 150 ms exact (measured 84–91), ≤ 60 ms corridor (42–45).
