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

## Hashes: before = after, no changes
Probe / flagship build-bay `d54eca7c402a…0f610`; campus flagship `f60e10b461dd…4c182`; lab stress-30
`a6e42f5c6bfb…0e26c` (now pinned in `planning.test.ts`); the other 8 lab scenarios are unchanged too.

**Re-pinned 2026-09-27 (walk.ts head-on passing, not the budget):** head-on walkers with room to pass
now both slow to 0.7 m/s on the 0.45 m offset instead of the later id stopping (`roomToPass`, latched
per encounter). That shifts encounter timing: stress-30 `a6e42f5c…0e26c` → `e55d3ee17dd5…8e989`; probe /
flagship build-bay `d54eca7c…0f610` (11522 ticks) → `79447f750779…96129` (11403 ticks, take
`bf58b85269c981003ce6d9c6`); 0 violations. Campus flagship hash not re-measured here.

## Limits
The tick-5 spike is 30 synchronous plans, so exact stays at ~30 × route cost (80–120 ms); < 60 ms needs the
corridor planner. The stress test (warm, parallel runner) asserts max tick ≤ 150 ms exact (measured 84–91), ≤ 60 ms corridor (42–45).
