# W62 — deterministic default performance checks (LM-152)

Branch `codex/perf-gate`, base `60deba6` (lead integration branch). The earlier commit on this branch, `b9b54c7`, is independent evidence-log hardening already handed to the lead. This report covers only the following performance commit.

## Change and reason

Three concurrent full engine suites produced a stress exact maximum tick of 369.1 ms against the unchanged 250 ms threshold; the same code immediately passed alone at 112.3 ms. Campus-history grid construction also had a wall-time threshold in the concurrent suite. Timing acceptance has moved to an **explicit serialized release/performance check**, retaining every threshold rather than relaxing them:

```
cd viewer
node deploy/perf-stress-budget.mjs
```

This command exits nonzero unless exact/corridor stress peaks remain ≤250/120 ms, both means ≤3 ms, zero violations, original exact final hash, and each warmed 2020–2025 grid build <1000 ms. It prints measurements as JSON. It must be run on an otherwise idle host before a release that includes performance changes; it is intentionally not part of the concurrently executed default engine suite. Lead should add this command and policy to RELEASE_CHECKLIST and PLANNING_BUDGET.

The default stress regression instead bounds actual deterministic workload using the existing profiler with `now=()=>0`: method call totals and per-tick peaks. No production instrumentation or engine algorithms changed. The original 1200-tick exact outcome pin remains untouched. The test also proves profiling preserves the unprofiled outcome and zero violations. Actual extra route and redundant grid rebuild operations are injected after the normal run; they leave world state unchanged but correctly exceed their measured work ceilings.

## Baseline ceilings

Measured from the unchanged scenario at base `60deba6`, then verified by the focused regression. These are ceilings, with no arbitrary percentage slack: reduced work passes, added work requires deliberate review.

| Method | Exact total / peak | Corridor total / peak |
| --- | ---: | ---: |
| spatial.route | 75 / 27 | 75 / 27 |
| spatial.routeAround | 9 / 1 | 5 / 1 |
| spatial.gridsAround | 18 / 2 | 10 / 2 |
| spatial.sync | 37097 / 58 | 37087 / 58 |
| spatial.sync.rebuild | 1 / 1 | 1 / 1 |
| spatial.sync.grids | 1 / 1 | 1 / 1 |
| walk_to.plan | 75 / 27 | 75 / 27 |
| walk_to.step | 35724 / 30 | 35722 / 30 |

Exact final hash `5c3a3355257850f2316b92902451c144981486262211d86de4881047ca8a194e`, unchanged. Corridor hash observed `c5a00ad8a680fdeff495353971dbba709cc60914074803d5576af0f00d893551` (not promoted to a new outcome pin). Both runs: zero violations. The existing frozen-reference route test still compares route expansion counts across its seeded corpus.

The default historical-grid test retains construction for every year and now checks extent coverage, buffer dimensions, actual free and blocked geometry, and finite/nonnegative clearance with zero on blocked cells. Those are correctness assertions, **not** algorithmic cost counters; slow work inside a single grid build is detected by the separate unchanged 1000 ms benchmark. Similarly method call ceilings do not detect extra work inside one call: the explicit timing check remains necessary.

## Validation

Heavy suites were intentionally serialized by lead; no full engine or browser suite was launched here.

- Initial read-only `stressWork` baseline: original exact hash and zero violations; counters above.
- `node --test --test-name-pattern='stress-30: exact planner|grids build for every year' engine/test/planning.test.ts engine/test/campus-history.test.ts`: **2 pass / 0 fail**, 2.5 s. Includes profiled/unprofiled equivalence and real extra-work refusal cases.
- `node deploy/perf-stress-budget.mjs`: **PASS**. Exact max113.35 ms / mean0.582 ms; corridor max52.10 ms / mean0.404 ms. Historical grids: 2020 98.9ms, 2021 123.0ms, 2022 90.1ms, 2023 143.2ms, 2024 151.6ms, 2025 144.6ms.
- Focused oxlint: clean. `npx tsc --noEmit -p .`: clean. `git diff --check`: clean.

No outcomes, expected ticks, take/camera IDs, production code, historical content, or existing timing thresholds changed. No re-pin window needed: **0 violations, same outcome**, profiled/unprofiled equal. No screenshots: test/tooling-only change. Full integrated gate remains lead-owned. No claim of N complete flake-free gates is made from these focused checks.

Approximate effort: 20 minutes / 10k tokens, including evidence-log review and waiting for exclusive measurement slots.
