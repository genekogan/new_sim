# Tranche progress log

Running log for the overnight simulation-engine tranche. Newest entries at the bottom.
Budget: weekly usage meter (`<usage-tool>`) started at 11% used; hard stop ≈61%.

## 2026-09-27 ~01:00 — Phase 0 started
- Local git baseline committed (repo root = campus-2026-reconstruction/).
- Spec copied to docs/engineering/SPEC.md; owner decisions in OWNER_DECISIONS.md.
- Running in parallel: AUDIT.md (architecture audit), RESEARCH.md (engine patterns), LIB_EVAL.md (recast/rapier/bvh/bespoke experiments in viewer/experiments/nav-eval).
- Known: `npm test` broken on Node 26 (`--experimental-transform-types` removed) — fix in Phase 1.

## Next steps
1. Integrate audit/research/lib-eval into ENGINEERING.md (assessment + plan + milestones).
2. Phase 1: pure-TS deterministic engine core (`viewer/engine/`): world state, IDs/semantics, action registry + lifecycle, diagnostics, fixed-step runtime, checkpoints.

## ~03:00 — Phase 1–2 progress
- AUDIT.md done (key: 2026 GLB has 667 CAD rack_member pieces, no frames; stock library frames 8/12/16/19 ft; no 9 ft part; nav was 1 m grid A* zig-zag, no levels; control plane analytic paths + virtual clock; historical IDs build-order dependent).
- e2e harness done (viewer/e2e, 11/11 green, 17 baselines incl. 2021/2022/2024 correction views; `npm run e2e`). Perf: 2026 = 1083 draw calls / 957k tris.
- Engine: core (hash/rng/history/runtime) + grid nav (EDT, multi-level A*, stair links) + walk_to (traffic yielding, replans) + invariants. `npm run test:engine`: 23/23.
- Research + lib-eval agents still running (repeated network stalls; resumed).

## Next steps
1. Crew carry: SE(2) formation planner + carry action (grips, whole-load clearance), carry regressions 6–7.
2. Takes: recorder + replay + camera independence; sequences/plans bound to baselines; rehearsal API.
3. Assembly: upright raise/hold/beam connect/release predicate.
4. Browser integration: render engine world in studio (debug overlays), then DO integration.

## ~09:30 — Milestones B–G reached on synthetic scenes; campus bridge landed
- Carry (SE(2) hybrid-A*, formations, whole-load clearance), takes/plans/rehearsal/execute, camera (decollide/deocclude/plan), progressive decks + stairs, DO + 9 `engine_*` MCP tools, 2026 campus SpatialScene (7578 prisms, staging-east) — all committed with tests + docs (CARRY.md, TAKES_AND_PLANS.md, CAMERA.md, PROGRESSIVE.md, CAMPUS_SCENE.md).
- Flagship `scenarios/build-bay.ts`: piles → carries → raise/hold → beams → release (refused early) → joists → plywood → stair + treads → visitor walks onto the deck. 43 steps, 456 s sim, 0 violations; execute == rehearsal hash; canonical untouched. Test: `engine/test/build-bay.test.ts`.
- Engine fixes found by the scenario: carry replans on topology change; people in a formation's path halt it and idle bystanders are asked to make way; set-down stations must be clear; raise picks its footing end; walk turn hysteresis, hard separation, continuous stair traversal, stair occupancy waits.
- Stress-30 (lab): 0 violations / 60 s. Lab e2e 13/13 (two spurious ENOENTs from overlapping Playwright runs).
- Env/lighting agent still running (repeated network stalls).

## Next steps
1. Flagship on the real 2026 fork at `staging-east` (crop scene); record take + camera track; capture screenshots via lab/studio.
2. Add `/lab` to Worker SPA routes; full e2e; production deploy with rollback note.
3. Handoff report (HANDOFF.md).
