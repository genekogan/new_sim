# Handoff: Mars Studio simulation engine, tranche of 2026-09-27

> **Current state (2026-09-29): read "Codex split and checkpoint 1" at the very bottom, then "End of night" above it**:
> what landed overnight, the gate, takes, pins, decisions you may veto, and open items. Questions for Gene are parked
> in `QUESTIONS_FOR_GENE.md`. The sections below are the 2026-09-27 report and the later addenda, kept as history.

This is the end-of-tranche report that SPEC.md §30 and §33 ask for. The engine suite was re-run for
this handoff at HEAD `19aa5b6` on 2026-09-27 (M3 Max, Node 26). Other numbers cite a file, test or
commit. Anything not checked is marked **(unverified)**. Where a committed doc or commit message
disagrees with the re-run, both values are given.

Companion documents in `docs/engineering/`: `SPEC.md` (the brief), `OWNER_DECISIONS.md`, `PROGRESS.md`
(the log), `ENGINEERING.md` (the plan and decision log), `AUDIT.md`, `RESEARCH.md`, `LIB_EVAL.md`,
`ENGINE_GUIDE.md` (contributor rules), and the subsystem notes `CARRY.md`, `TAKES_AND_PLANS.md`,
`CAMERA.md`, `PROGRESSIVE.md` and `CAMPUS_SCENE.md`.

## What was learned about the codebase

Full detail with file:line references is in `AUDIT.md` §0–§11.
- **Rendering and editing.** React 19 and three.js; `app/studio/page.tsx` (1700 lines, 935 in one
  `useEffect`) covers 2020–2026. 2026 is a CAD-derived GLB (6459 instances) whose 667 `rack_member`
  pieces are single posts and brace fragments, not frame units (AUDIT §2.2, §2.4). 2020–2025 are
  procedural `Kit` scenes whose IDs depend on build order (AUDIT §0.6, §11.4).
- **"Upright" is overloaded.** The stock library has 8, 12, 16 and 19 ft two-column frames. The kit
  code calls a single post a "rack upright". No 9 ft part exists anywhere (AUDIT §0.1–0.2).
- **Navigation before this tranche.** A 1 m occupancy grid with 8-connected A\*
  (`app/studio/ambience-math.ts`): no smoothing, no levels, stairs or interiors. The server grid and
  the browser grid could diverge (AUDIT §0.4–0.5).
- **Control plane.** A Worker plus one SQLite Durable Object per room and year, with 20 MCP tools.
  It is purely analytic: immutable paths on an anchored virtual clock, with no tick and no input
  log, so replay and fork were impossible (AUDIT §6).
- **Environment and people.** The sun was a sinusoid of the hour, with no date or latitude
  (AUDIT §7). Humans have only Idle, Walk and Wave clips (AUDIT §4).
- **Repo hygiene at the start.** There was no git repo; `simulation/.wrangler` DO state was committed;
  `public/modular` and `public/data` symlink outside the repo; `npm test` was broken on Node 26 (fixed
  in `d406128`).

## Architecture decisions

The records are in `ENGINEERING.md` §4–§5 and its decision log, and in the `RESEARCH.md` Summary.
- **One engine everywhere.** Pure TS in `viewer/engine/`. The only dependency is `zod`. It is
  compatible with strip-types and uses no three.js, DOM, `Date.now` or `Math.random`. A fixed tick of
  `DT = 1/20 s` runs Node tests, `/lab` in the browser, and the Durable Object.
- **One action registry** (`api/registry.ts`). It generates the controller verbs, the zod validation
  and the 9 MCP `engine_*` tools. There is no second control path.
- **World state is plain JSON.** `physicalView()` defines what a plan depends on: poses, phases,
  supports, inventory and RNG. It excludes env, labels and provenance.
- **History** (`history/store.ts`). Content-addressed checkpoints, protected canonical workspaces,
  forks, and causes (`reconstruction-edit`, `design-edit`, `simulation-run`).
- **Plans are bound to a baseline.** A plan records a `physicalHash` and a `rulesVersion`.
  `rehearse` and `execute` share one `runPlan` path, and a mismatch is refused as `plan.stale` with
  a physical diff.
- **Takes are resolved motion.** They store integer tracks, changes, events and the final state.
  Replay imports only `core/` and `take/types`, and a test enforces this.
- **Navigation is bespoke** (`spatial/`): multi-level rasters, an exact EDT clearance field, and A\*
  with semantic stair links. Recast was rejected as the authority (paths undercut the radius by
  0.17–0.25 m, silent failure, walkable roofs) and Detour Crowd deadlocked for 82 s in a 1 m corridor
  (`LIB_EVAL.md`). Recast TileCache is kept as the scale fallback.
- **Carried loads.** Bespoke hybrid-A\* over (x, z, θ), with swept disc-cover checks against the EDT
  and exact SAT checks at set-down (`CARRY.md`). Collision uses exact 2D OBB/prism tests. Rapier is
  deferred.
- **Cameras only read.** A track is separate data keyed by take id. It is planned by lookahead
  Viterbi, with placement, readability and temporal evaluators kept separate (Cinemachine concepts,
  `CAMERA.md`).
- **The 2026 campus is reduced to prisms offline**, as a `SpatialScene`. Unknown interiors are
  non-walkable by rule (`CAMPUS_SCENE.md`).
- **Owner decisions** (`OWNER_DECISIONS.md`): an upright is the two-column frame; the flagship is a
  hypothetical build in a *fork* of 2026; production deploys are allowed with the prior version
  recorded for rollback; nothing is pushed to a remote.

## Research performed

- **`RESEARCH.md`**: 600 lines, 12 decision records. Recast/Detour, recast-navigation-js 0.43.1,
  Unity AI Navigation, Godot failure modes, ORCA and yielding, formation carrying, Rapier vs a BVH,
  smart-object slots and sequences, Cinemachine, replay and versioning, IK and carry animation, and
  the NOAA sun.
- **`LIB_EVAL.md`**: measured experiments in `viewer/experiments/nav-eval/` (`RESULTS.md`,
  `exp-a-recast.mjs`, `exp-a2-same-scene.mjs`, `exp-b-rapier.mjs`, `exp-c-bvh.mjs`). Bespoke grid:
  31 ms build, 46 ms long route. Recast: 5 µs per query, 4.4 s full-campus build. Rapier `castShape`:
  3 µs simple, 240–300 µs against Chiba. three-mesh-bvh: 62 KB gzip. Not measured: the SE(2) planner
  (experiment D) and running in a real Worker.
- **`AUDIT.md`**: 699 lines, an architecture audit of the existing viewer.

## Code changed / new systems (module map with sizes)

Line counts are `wc -l` at `19aa5b6`. There are 47 commits, `9d6f188` through `19aa5b6`; run
`git log --stat` for detail.

| Path | Files | Lines | Role |
| --- | ---: | ---: | --- |
| `engine/core/` | 3 | 172 | sync sha256, stableStringify, seeded sfc32 rng, math |
| `engine/world/` | 3 | 418 | WorldState, `physicalView`, Mars catalog (uprights 8/9/12/16/19 ft, beams, 2x4, plywood, stairs), factory |
| `engine/history/` | 1 | 158 | `WorldHistory`: checkpoints, protected canonical, forks, causes |
| `engine/actions/`, `runtime/` | 3 | 347 | ActionDef contract; `Runtime` lifecycle; end-of-tick invariants |
| `engine/spatial/` | 4 | 627 | multi-level grids with EDT, A\* with stair links, `Spatial` service (epochs, contributors) |
| `engine/locomotion/` | 1 | 575 | `walk_to`: corridors, stairs, yielding, replans, hard separation |
| `engine/carry/` | 7 | 1320 | formation, sweep, hybrid-A\*, validation, `carry` action, invariant, scenes |
| `engine/construction/` | 11 | 1394 | raise, hold, connect, release; stability rule; joists, plywood, flights, treads; work stations; nav contributor |
| `engine/sequence/`, `take/`, `rehearsal/` | 8 | 1201 | templates, binding, runner; take recorder and replay; `rehearse`/`execute` |
| `engine/camera/` | 8 | 1019 | geometry, shots, quality, solver, Viterbi planner, tracks |
| `engine/api/` | 5 | 654 | controller facade, op registry, schemas, seeds |
| `engine/campus/` | 7 | 726 | 2026 GLB → SpatialScene, regions, loader, `publishCampus2026` |
| `engine/env/` | 2 | 372 | NOAA sun, daylight factors |
| `engine/scenes/`, `scenarios/` | 2 | 234 | proving ground; flagship `build-bay.ts` |
| `engine/test/` | 20 | 2770 | 19 `*.test.ts` files plus fixtures |
| `app/lab/*` | — | 1507 | `/lab` Engine Lab (engine in the browser, overlays, `window.__marsEngine`) |
| `simulation/engine-room.ts`, `engine-tools.ts` | 2 | 142 | engine state per room and year in DO SQLite; `engine_*` tools (+26 lines in `worker.ts` for the take endpoint) |
| `deploy/engine-scene.mjs` | 1 | 126 | offline campus extractor (`--check`) |
| `public/engine/campus-2026.json` | 1 | 0.98 MB | 7578 prisms (132 KB gzip) |
| `e2e/*` | 6 | ~570 | Playwright harness, studio spec, lab spec |

Also changed: `deploy/configure.mjs` (`/lab` route, `5f02352`); `app/studio/environment.ts` (NOAA sun,
wetness, shadows; `0c21dc1`, `83fda6f`).

## Tests & evaluations (per file counts, pass/fail, exact commands)

**Engine suite.** `cd viewer && node --test engine/test/*.test.ts` (same as `npm run test:engine`).
At `2ecff4b` (the deployed tree) it ran **127 tests: 126 pass, 0 fail, 1 skipped** (~3 min wall; the
campus flagship test alone is ~2 min). Verified again by the deploy gate before release.

| File (`engine/test/*.test.ts`) | n | Result | File | n | Result |
| --- | ---: | --- | --- | ---: | --- |
| `api` | 6 | pass | `env-sun` | 9 | pass |
| `build-bay` | 1 | pass | `history` | 3 | pass |
| `camera-geom` | 6 | pass | `navigation` | 11 | pass |
| `camera-replay` | 3 | pass | `progressive` | 9 | pass |
| `camera` | 6 | pass | `rehearsal` | 8 | pass |
| `campus-extract` | 7 | 6 pass, 1 skip (`CAMPUS_FULL=1`) | `review` | 5 | pass (C1–C3, H1–H2 regressions) |
| `campus-flagship` | 1 | pass | `sequence` | 9 | pass |
| `campus` | 9 | pass | `take` | 7 | pass |
| `carry` | 10 | pass | `walk` | 7 | pass |
| `construction` | 4 | pass | `core` | 6 | pass |

Earlier in the day `progressive floor` failed (walker at y 1.9494 instead of 1.9875). Root cause was
the test fixture, not the engine: lying frames were placed with their base centre at y 0, i.e. sunk
3.8 cm into the ground, which the old fixed-height beam placement masked. Fixtures now rest frames on
the ground; two assertions were added (raised frames stand at y 0; feet exactly on the sheet top).

**Other gates at release:** `npm test` 48/48 · `npx tsc --noEmit -p .` clean · Playwright
`npm run e2e -- --workers=1` 26/26 (studio 11, lab 13, lab-build-bay 2) · `deploy/simulation-integration.mjs`
PASS locally and against production (20 legacy + 9 `engine_*` tools).

## Concrete demonstrations that work (with numbers)

**Flagship on the proving ground** (`scenarios/build-bay.ts`, `build-bay.test.ts`): piles → carries →
raise/hold → beams → early release refused → release → joists → plywood → stair + treads → a visitor
walks onto the deck (level 4). Commit `3566e10` recorded **43 steps, ~456 s simulated, 0 violations**,
rehearsal hash = execution hash. Re-run at HEAD: `43 steps, 523.5 s simulated, 5041 ms compute`, passing
(0 violations, execute == rehearsal, canonical untouched). The longer run likely comes from the
carry/walk changes in `baf7b8b` **(inferred)**.

**Flagship on the 2026 campus** (`campus-flagship.test.ts`; fork of protected `mars-2026`,
`staging-east`, ±40 m crop): commit `baf7b8b` recorded **43 steps, ~548 s simulated, 0 violations**,
execute == rehearsal. Re-run: `43 steps, 565.6 s simulated, 56989 ms compute, take 457974 bytes`;
canonical 2026 gained no parts and its log length stayed 1. The 548 vs 565.6 s gap is unexplained
**(unverified)**; the tracked engine tree was clean.

**Stress-30** in `/lab` (30 walkers, 60 s). Latest run `e2e/artifacts/2026-09-27T14-15-57/lab-perf.json`:
**0 violations**, fast-forward step mean 0.88 ms / p95 0.7 ms / max 208.7 ms, 9.8 fps real time
(SwiftShader). Older runs (`lab-dev`, `lab-final`, `…T10-55-12`: 879, 918 and 2118 violations) predate
hard separation (`64eeba8`); the `app/lab/README.md` table (879) is stale.

**Durable Object timings** (local `wrangler dev`, `simulation/README.md`): rehearse of the 60 s
three-walker plan 200–260 ms (Node ≈ 150 ms), execute 200–270 ms, a 33 s beam carry ≈ 230 ms, a 60 s
camera track 230–300 ms. The same plan gives a byte-identical take id in Node and in workerd.
Production DO timings are **(unverified)**; the engine is not deployed.

**Take sizes.** `take.test.ts` at HEAD (3 walkers, 65.5 s): 33,650 B, 7,931 B gzip, 723 samples
(`TAKES_AND_PLANS.md` lists a stale 25,856 B for 59.9 s). In the DO: a 60 s take ≈ 29 KB, a plan
≈ 2.3 KB, a camera track ≈ 100 KB. The campus flagship take is 457,974 B.

**Camera plan timings.** `camera.test.ts` at HEAD: `60 s @10 Hz, 3 subjects, 601 samples → 159 ms;
readable 100%, min 1.00, cuts 4, invalid 0` against a 1 s budget (`CAMERA.md` says 60–80 ms). The
U-occlusion plan leaves the desired shot at 6 s, before occlusion at 7 s. Hysteresis: greedy flips 10
times; the planner and LiveSolver oscillate 0 times.

**Carry, navigation, construction.** The 12 ft beam rounds the 2.5 m L corner (plan + validate 232 ms).
The 19 ft upright with 4 carriers is rejected, naming carrier q2 and 'corridor A south wall'. Nav
grid build 29.7 ms (600×600×2); long route 51.2 ms, 94,909 expansions. Progressive full sequence:
4767 ticks = 238.3 s, 98 actions, 0 violations.

**Flagship v2** (`scenarios/build-bay-v2.ts`, `build-bay-v2.test.ts`; a second template, v1 and its
pins untouched): v1's build plus (a) plywood s2 picked off its stack by a forklift (p6 mounts,
`forklift_pick`, `forklift_deliver` beside the bay, `ride_to` back, dismount), then installed by p3/p4;
(b) p1 carries a spare stair tread up the finished flight onto the deck (single-carrier stairs carry);
(c) two sit on benches, 8 people fill the campfire's 8 places, two wander (`ambient_wander`, 45 s, is
the clock), then everyone `stand`s and the run ends settled. Open ground: **66 steps, 676.9 s
simulated, ~3.7 s compute, 0 violations**, execute == rehearsal, canonical untouched. Campus fork
(staging-east): **66 steps, 723.8 s simulated, ~6.4 s compute, take 571,196 B**. Layout changes forced
by refusals: the forklift cannot stage s2 on the deck (truck refused next to frames A/B, tested), a
2x4 cannot be carried onto the 1.83 m deck (`carry.stairs-blocked`), a `sit` step ends `cancelled`
(benches use `gather`). Engine gap routed around in the scenario: `carryIntegrity` flags fork loads.

## Visual evidence (paths to committed baselines and artifact dirs)

**Committed baselines** (`viewer/e2e/baselines/`): 17 studio images (`studio-{default,plan}`,
`studio-202{0..5}-{default,plan}`, `studio-2021-corridor-aluminet`, `studio-2022-courtyard`,
`studio-2024-frontage`; re-captured for the NOAA sun in `83fda6f`) and 2 lab images
(`lab-stairs-mid-oblique`, `lab-narrow-passage-mid-top-debug`).

**Artifacts** (`viewer/e2e/artifacts/`, gitignored, local only): `lab-final/` (82 files: every lab
scenario at mid/end, top/oblique, with and without debug overlays, plus `lab-perf.json`);
`2026-09-27T14-15-57/` (latest lab run, with `video/lab-{narrow-passage,stairs}/*.webm`); `baseline/`,
`final/`, `verify/` (studio captures with `perf.json`); `season-check/` (sun at 08/13/19 h on
2026-03-15 and 2026-12-21).

**Gaps.** No committed flagship or campus-build captures or video yet. The lab build-bay scenario is in
progress but uncommitted (`viewer/app/lab/build-bay.ts` and `components.ts` untracked at the time of
writing). No camera track has been rendered to video.

## Known shortcomings

- **Poses are procedural layers on Idle/Walk, not clips.** `app/engine-view/humans.ts`: `sit`
  lowers the body onto the seat with leg IK (0.4 s blend, no real sit-down motion); gripping people
  get arm IK plus a ≤ 13° lean and shoulder shrug (carriers keep elbows bent) — no crouch or lift;
  `warm` holds hands out; `talk`/`watch` are plain Idle. No foot IK when walking: on stairs feet sink
  or hover by about 0.09 m. Turning in place plays Idle (`app/lab/README.md`).
- **Formations don't avoid each other.** Simultaneous carries are not co-planned and have no space
  reservation, so a sequence has to order them with `after` dependencies (the `step(…, after)` calls
  in `build-bay.ts`).
- **People-avoidance is heuristic.** Walkers use traffic resources, right-of-way, turn hysteresis and
  hard separation. Head-on walkers with room to pass both slow and keep to one side (latched per
  encounter); only tight spots and single-file passages make one stop and give way. Formations halt for people in the way, ask idle bystanders to "make way", then
  replan treating them as soft obstacles (`carry/actions.ts` `pathBystander`/`makeWay`). This is not
  ORCA and not proven deadlock-free: a head-on wait-forever shows up only as a runner `timeout`
  (`TAKES_AND_PLANS.md` Known gaps).
- **Campus interiors and upper floors are non-walkable by design.** Only ground level 0 of 2026 is
  walkable. There are 152 `interior:` blockers and no decks, stairs or doors (`CAMPUS_SCENE.md`).
- **No ladders or scaffold.** Anything more than 2.1 m above the nearest floor fails with
  `reach.too-high`, so only low platforms can be built (`PROGRESSIVE.md`).
- **9 ft frame unverified** (`QUESTIONS_FOR_GENE.md` Q5). Gene named 8/9/12/19 ft, but the library has no 9 ft frame.
  `world/catalog.ts:88–89` marks it `provisional` with an assumed 4 ft depth. The flagship uses
  `beam-9ft`.
- **North-axis assumption.** World −Z is taken as geographic north, with `NORTH_AZIMUTH_OFFSET = 0`
  (`engine/env/sun.ts:27–42`). No site bearing was found, so the sun and shadows may be rotated.
- **Mid-action resumability is not supported.** Only quiescent checkpoints resume. `sampleTake(t)`
  returns a visual frame only (`TAKES_AND_PLANS.md`).
- **Planning cost spikes with many simultaneous walkers.** Stress-30 has a ~200 ms tick when 30
  walkers plan at once: 5–45 ms per A\* and no per-tick budget. A construction replan costs ≈ 31 ms.
- **Replay slowed ~3× after people-avoidance** (lead-reported). Here the campus flagship rehearsal
  took 57 s of compute; the "before" figure is **(unverified)**.
- **Other limits.** Loads stay level, with nothing carried on stairs or between levels. Formations are
  rigid (no re-grip). A blocked mid-carry route holds unless the blocker is a bystander. Raises follow a
  lifter/footer choreography (lifters walk the frame up, hands ≤ 1.9 m, ≤ 0.6 m/s) and install lifts are
  swept with a lift-over fallback (PROGRESSIVE.md "Swept lifts"); the arc itself is still sampled, not
  continuous. The camera sees obstacle prisms only, not the render mesh. There
  are no dismantling verbs. The lab README still describes the stair-end teleport that `64eeba8` fixed.

## Deferred work

From `ENGINEERING.md` §10 and SPEC §32: rigid-body dynamics, electrical simulation, a timeline editor,
branch merge, real-person scans; mid-action resumable forks, loads on stairs, the forklift; milestone H
(inhabited scenes: campfire, class, party, dance, riding); a studio adapter so engine takes drive
`/studio` people; campus-year scenes in DO engine rooms (only `proving-ground` and `carry-yard` are
seeded); the Recast TileCache scale path and Rapier 3D sweeps; GPU-picking checks of camera
visibility; stable IDs for the 2020–2025 kit scenes.

## Historical reconstruction risks

- **The flagship is non-historical.** Its inventory, staging-east, piles and 6 people are all
  `design-edit`/`hypothetical`. It runs only in a fork; `mars-2026` refuses commits (`campus.test.ts`).
  Every UI or video must label it (SPEC §4, §31).
- **2026 rack geometry is CAD posts, not stock frames** (4.29/4.88/5.97 m, unmapped; AUDIT §2.4). The
  9 ft size is unconfirmed; deck, stair and tread dimensions are provisional.
- **Prisms are OBBs fitted to render geometry.** Parts within 0.5 m merge, glass and plexiglass are
  indistinguishable, vehicles are detected by CAD name, and the ground is flat (`provisional`).
- **2020–2025 IDs depend on build order.** Binding plans to them before stable IDs exist risks silent
  retargeting (AUDIT §11.4).
- **Plywood span rule** is ≤ 24 in directly on beams vs 4 ft in the brief; owner may overrule
  (`PROGRESSIVE.md`). **Staging placement is algorithmic**: re-extraction can move staging-east and
  the piles (tests re-validate clearance).

## Performance observations

- **Campus grids** (`CAMPUS_SCENE.md`): whole campus at 0.1 m takes 460 ms (5.6 M cells, ~84 MB); a
  ±40 m crop takes 156 ms, so use the crop for construction (`Spatial.sync` rebuilds every epoch).
  Campus routes take 9–57 ms.
- **Flagship compute:** 5.0 s on the proving ground vs 57 s on the campus crop, ≈ 11× for similar
  simulated time. Likely cause: grid rebuild plus A\* over 0.64 M-cell levels on every epoch
  **(inferred, unprofiled)**.
- **Lab and render:** trio 0.02 ms per tick; stress-30 0.88 ms mean with 200+ ms spikes (now ~122 ms cold / ~85 ms warm with
  identical routes, ~45 ms with the opt-in corridor planner; `PLANNING_BUDGET.md`, `node deploy/perf-stress.mjs`). About 22
  draw calls per person in software GL; the 2026 studio draws 1083 calls, 957 k triangles (`e2e/README.md`).
- **DO CPU and storage:** measured runs sit far below the 30 s DO limit, and the engine adds ~260 KB to
  the worker bundle. A campus-scale take like the 57 s flagship would exceed the limit and need
  chunked resolution **(inferred)**. On the campus `finalState` dominates take size; store it
  content-addressed in history (`TAKES_AND_PLANS.md`).

## Exact local run/test commands

From `viewer/`:
```sh
npm install
node --test engine/test/*.test.ts                              # engine suite (= npm run test:engine), ~2 min
node --test engine/test/build-bay.test.ts                      # proving-ground flagship, ~10 s
node --test engine/test/campus-flagship.test.ts                # campus flagship, ~2 min
CAMPUS_FULL=1 node --test engine/test/campus-extract.test.ts   # + full re-extraction
node deploy/engine-scene.mjs --check                           # re-extract campus-2026.json, compare hash
npm test && npm run typecheck && npm run lint
npm run e2e:install && npm run e2e                             # Chromium in .pw-browsers; studio + lab
npm run e2e -- -g lab                                          # lab spec only
npm run e2e:update-baselines                                   # review PNGs before committing
npm run dev        # http://127.0.0.1:5173/lab?scenario=stairs  (also stress-30, construction, …)
wrangler dev --config simulation/wrangler.jsonc --port 8797 --inspector-port 9237
node deploy/simulation-integration.mjs                         # real MCP incl. engine_*; SIM_BASE=… for prod
```

## Deployment status

- **Production:** Worker `mars-campus-2026`, R2 bucket `mars-campus-2026-models`, at
  `https://mars-campus-2026.<workers-subdomain>.workers.dev` (`/studio`, `/mcp`, `/simulation-agent-guide.md`).
- **Live:** `07dce638-2950-444f-823f-0e19b8f62320` (deploy 6, the bleeding edge, from `27e04f6`).
- **Rollback target:** `cebd5827-b08d-4224-a320-afba968a1352` (deploy 5, live before deploy 6, confirmed at
  100% with `wrangler deployments status`). `viewer/deploy/deployment.json` records it as
  `rollback_version`; its `version` is the live `07dce638…`.
- **Release gate:** a deploy starts from a green `npm run gate` report (`ok: true`, `gitHead` = the
  deployed commit, `gitDirty: false`). See `RELEASE_CHECKLIST.md`.
- **Release steps** (`viewer/deploy/README.md`): `browser-model.py` → `compress-browser.mjs` →
  `prepare.py` → `CLOUDFLARE_RELEASE=1 npm run build` → `deploy/upload.mjs` →
  `wrangler deploy --config dist/server/cloudflare.json`; then `SITE_BASE=… ALL_ASSETS=1 node
  deploy/smoke.mjs` and `SIM_BASE=… node deploy/simulation-integration.mjs`.
- **Shipped to production 2026-09-27** (deploys 1–4) **and 2026-09-28** (deploys 5 and 6; see below); before that, not live:
  the engine, the `engine_*` tools,
  `/api/simulation/engine/take`, `/lab` (`5f02352`) and the NOAA sun.
- Git is local only; nothing is pushed without Gene.

**Production deploy (2026-09-27):** Worker version `d33a4d6b-d4ae-4535-a818-0e5c329e9b4f`, built
from `2ecff4b`, replacing `de2dddaa-0fab-477c-8b8f-cb1c579efba5`. Gates were green: 48 unit, engine
126 pass / 1 skip, tsc, e2e 26/26. Live smoke returned 200 on all routes, `/engine/campus-2026.json`
and the R2 GLB. `simulation-integration.mjs` PASSED against production (20 legacy + 9 engine tools).
A headless `/lab` build-bay run reached done: 43/43 steps, 0 violations, 0 console errors. Details are
in `RELEASE_CHECKLIST.md`. Rollback, from `viewer/`: `WRANGLER_WRITE_LOGS=false
./node_modules/.bin/wrangler rollback de2dddaa-0fab-477c-8b8f-cb1c579efba5 --name mars-campus-2026
-m "rollback: <reason>"`

**Production deploy 2 (2026-09-27):** Worker version `6f1200ce-ed10-467b-8d7f-a683f91292db`, built
from `6593a06`, replacing `d33a4d6b-d4ae-4535-a818-0e5c329e9b4f` (now the rollback target). It ships
the review fixes (teleport/holder/load invariants), raise choreography, swept lifts and deterministic trig.
Gates were green: 48 unit, engine 141 pass / 1 skip, tsc, e2e 26/26. Live smoke returned 200 on all
routes and on the R2 GLB. `simulation-integration.mjs` PASSED against production. The headless `/lab`
build-bay run reached done at tick 10918: 43/43 steps, 0 violations, 0 console errors. **The production
browser final-state hash equals the node hash** (`deploy/determinism-probe.mjs`): both are
`5c29efcf…1c96`, so determinism holds across hosts in production. Details are in `RELEASE_CHECKLIST.md`.
Rollback, from `viewer/`: `WRANGLER_WRITE_LOGS=false ./node_modules/.bin/wrangler rollback
d33a4d6b-d4ae-4535-a818-0e5c329e9b4f --name mars-campus-2026 -m "rollback: <reason>"`

**Production deploy 3 (2026-09-27):** Worker version `17f7c9aa-84d1-437d-b1d6-287c85e553fe`, built
from `3f5ece7`, replacing `6f1200ce-ed10-467b-8d7f-a683f91292db` (now the rollback target). It ships
crews that accompany lifted parts, the `lift.hands-out-of-reach` invariant, rules `mars-assembly/2`
(plans bound under `/1` now report stale) and the gate script. The gate was green
(`.cloudflare/gate/2026-09-27T21-06-25-559Z`): 48 unit, engine 144 pass / 1 skip, tsc, e2e 26/26, probe
hash `d54eca7c…f610`. One baseline was refreshed after visual review: `build-bay-visitor-oblique`, where
crews end in different spots. Live smoke returned 200 on all routes and the R2 GLB, and integration
PASSED. Headless production `/lab` build-bay: 43/43 steps, 0 violations, tick 11522. **The production
hash equals the node probe hash** (`d54eca7c…f610`). Rollback, from `viewer/`: `WRANGLER_WRITE_LOGS=false
./node_modules/.bin/wrangler rollback 6f1200ce-ed10-467b-8d7f-a683f91292db --name mars-campus-2026
-m "rollback: <reason>"`

**Production deploy 4 (2026-09-27):** Worker version `89e65c8c-5abb-4377-a693-3689de30d465`, built
from `9561854`, replacing `17f7c9aa-84d1-437d-b1d6-287c85e553fe` (now the rollback target). It ships
studio take replay with the engine camera, social vocabulary and the campfire lab scene, review
M3/M5/M6 and the DO caps, deterministic head-on passing, the evidence report and the gate. `prepare.py`
now stages `engine/takes/*.json` (`72bb2ad`). The gate was green
(`.cloudflare/gate/2026-09-27T23-03-25-583Z`, gitDirty false): 48 unit, engine 177 pass / 1 skip, tsc,
e2e 28/28, probe hash `79447f75…6129`. Evidence: 17/17 rows PROVEN. No baselines were refreshed. Live
smoke returned 200 on all routes, including `/engine/takes/*`, and on the R2 GLB. Integration PASSED.
Headless production `/lab` build-bay: 43/43 steps, 0 violations, tick 11403. **The production hash
equals the node probe hash.** Headless production `/studio` take replay at "held" matches the baseline:
37/37 entities, banner visible, 0 errors. Rollback, from `viewer/`: `WRANGLER_WRITE_LOGS=false
./node_modules/.bin/wrangler rollback 17f7c9aa-84d1-437d-b1d6-287c85e553fe --name mars-campus-2026
-m "rollback: <reason>"`

**Production deploy 5 (2026-09-28, session checkpoint):** Worker version
`cebd5827-b08d-4224-a320-afba968a1352`, built from `d5d2f84`, replacing
`89e65c8c-5abb-4377-a693-3689de30d465` (now the rollback target). The gate ran at `26acb78`; the later
commits touch only docs and evidence. It ships pause/resume, `engine_edit_world` and the list/delete
ops over MCP, the forklift, vehicles, social scenes, carrying loads on stairs, engine year scenes
2020–2025, stable ids, camera occluders, incremental grids, renderer poses and flagship v2. The gate was
green (`.cloudflare/gate/2026-09-28T02-12-46-239Z`, gitDirty false): 56 unit, engine 243 pass / 1 skip /
1 todo, tsc, e2e 37/37, probe hash `79447f75…6129` (unchanged). Evidence: 17/17 rows and 8/8 milestones
PROVEN. No baselines were refreshed. Live smoke returned 200 on all routes, including
`/engine/campus-2022.json` and `/engine/takes/*`, and on the R2 GLB. Integration PASSED (13 engine
tools, 2022 year room). The director demo PASSED against production (9 steps, 7.4 s). Headless production
`/lab` build-bay: 43/43 steps, 0 violations, tick 11403. **The production hash equals the node probe
hash.** Headless production `/studio` take replay at "held" is visually identical to the baseline: 37/37
entities, banner visible, 0 errors. Rollback, from `viewer/`: `WRANGLER_WRITE_LOGS=false
./node_modules/.bin/wrangler rollback 89e65c8c-5abb-4377-a693-3689de30d465 --name mars-campus-2026
-m "rollback: <reason>"`

**Production deploy 6 (2026-09-28, bleeding edge, W34):** Worker version
`07dce638-2950-444f-823f-0e19b8f62320`, built from `27e04f6` (Gene: "pre-release, ok to break stuff"), replacing
`cebd5827-b08d-4224-a320-afba968a1352` (now the rollback target). It ships the overnight tranche and checkpoint-1 work
up to `27e04f6` (hand-up + forklift, one body model, splined walking without jumps, stair IK, 2022 year build A + B,
paint / solar, meals, fire, `engine_direct_camera`, takes `mars-take/4`, studio "Watch it being built" 2022, flagship
v3 take). **Not in it:** W32's prone model `0cd2f19` and the docs / merge commits after it. The gate was green
(W34 worktree `.cloudflare/gate/2026-09-28T16-12-39-722Z`, gitDirty false): 56 unit, engine 370 pass / 3 skip, tsc,
e2e 64 passed / 1 skipped, probe `b746b094…f0c3`. Live smoke returned 200 on all routes, `/engine/campus-2022.json`,
all five `/engine/takes/*` files and the R2 GLB. The director demo PASSED (9 steps, 7.96 s). **The committed
`simulation-integration.mjs` fails against production** on a stale tool-name list (it lacks `engine_direct_camera`);
with that one name added in a scratch copy, all three PASS lines printed. Headless production `/lab` build-bay: 43/43
steps, 0 violations, tick 10901; **the production hash equals the node probe hash.** Headless production `/studio`:
the 2022 "Watch it being built" picker offers both year-build takes; flagship replay at "held" 37/37 entities, hash =
recorded = manifest (`c56ea8da…`), banner visible, 0 errors. Details: `RELEASE_CHECKLIST.md` "Production deploy 6".
Rollback, from `viewer/`: `WRANGLER_WRITE_LOGS=false ./node_modules/.bin/wrangler rollback
cebd5827-b08d-4224-a320-afba968a1352 --name mars-campus-2026 -m "rollback: <reason>"`

## Suggested next tranche (prioritised)

> **Owner feedback (2026-09-28) supersedes the ordering below:** see `OWNER_FEEDBACK_2026-09-28.md` —
> hand-up / climb-the-structure floor building (no levitating materials), immediate reaction to blocks,
> splined turns, feet on stair treads, animated fire — and the headline milestone: replay every year's
> construction from raw material piles to its canonical state (skeleton first), with painting and solar-panel
> verbs; and a full tranche on autonomous, expressive, self-correcting camera direction (§11). Then the items here.

1. **Gate script + doc refresh.** Put `test:engine`, `npm test`, `typecheck`, `lint`, `e2e` and
   `test:simulation` in one gate script and record its output. Refresh stale numbers in
   `app/lab/README.md`, `TAKES_AND_PLANS.md`, `CAMERA.md`, `CARRY.md`.
2. **Planning cost, remaining part.** Base-obstacle rasters are cached now (campus flagship 56 s → 17 s
   compute, identical hashes); still missing: a per-tick planning budget / queued replans for many
   simultaneous walkers (200 ms spikes with 30), and region-local EDT updates instead of whole-grid.
3a. **Crew accompanies lifted parts (deferred, spec §7/§8).** Construction lifts move a part from its
   staging spot to its seat while the crew stands at fixed stations, so a plywood lift-over reads as a
   floating sheet (`e2e/artifacts/raise-evidence/deck_s1-a-rising-oblique.png`). Plan: crew positions
   derived from the part pose each tick (≤ 0.9 m/s, no clipping), a `lift.hands-out-of-reach`
   invariant (holder ≤ 1.0 m from a hand point; hand points ≤ 2.4 m above the holder's floor), tests
   for a joist lift and a plywood lift-over. Four delegated attempts stalled on the network with no
   output on 2026-09-27; nothing of it is in the tree.
3. **Campus take in the studio.** The flagship already renders live in `/lab` on open ground; next is
   the *campus* take (staging-east fork) rendered inside the 2026 studio scene with a planned camera
   track and video, labelled hypothetical. (The raise choreography fix and swept lift checks landed
   2026-09-27; the lab baselines `build-bay-*.png` may need re-inspection.)
4. **People realism.** Carry, lift and hold poses (CCD hand IK, speed-matched walk), stair foot
   placement, multi-formation space reservation, and a deadlock detector that turns mutual waits into
   `blocked` plus a replan.
5. **Integration.** Engine takes drive `/studio` people; campus-year scenes in DO engine rooms; a
   production deploy of the engine tools, with rollback.
6. **Owner confirmations.** Parked in `QUESTIONS_FOR_GENE.md`.
7. **Reach.** Ladders and scaffold for full-height bays. Evidence-backed walkable decks and stairs in
   real 2026 buildings, as hand-authored links with provenance.
8. **Milestone H** (inhabited scenes), then **mid-take resumability** (`ActionDef.snapshot/restore`).

## Late-session addendum (lead, 2026-09-27 afternoon)

Landed after the draft above was written; all commits are in the deployed tree `2ecff4b` unless noted.

- **Independent review** (`docs/engineering/REVIEW.md`): 3 critical / 2 high / 6 medium / 9 low. The
  criticals were real "impossible outcome, zero violations" cases, reproduced by scripts: carriers
  teleporting to the heading-flipped pose on a mid-carry replan; holders able to walk away while the
  frame stayed "held"; walkers passing through carried loads. All C/H findings are fixed with
  regression tests (`engine/test/review.test.ts`) and three new invariants: `motion.teleport`
  (0.6 m/tick — it immediately exposed two further walk_to teleports, also fixed), `support.holder-missing`,
  `collision.human-load`. Failed/cancelled actions now cancel children, restore reserved phases, clear
  tasks and release traffic entries; station reachability is checked at plan time. Medium/low findings
  remain open (notably M2 cancel-on-stairs, M4 timeout leaves actions live, M5 DO rewrites whole history).
- **Performance**: profiling showed the slowdown was `Spatial.sync` re-rasterising all 2,696 campus
  obstacles on every construction change, not the people-avoidance replans. Cached base rasters:
  campus flagship 56.4 s → 17.4 s compute; `routeAround` 2.3 s → 0.26 s; final-state and take hashes
  bit-identical. Flagship after the review fixes: open ground 527.6 s simulated, campus 559.4 s,
  take ≈ 452 KB, 0 violations, execute == rehearsal.
- **Lab flagship**: `/lab` scenario "Build a rack bay" drives the real `SequenceRunner` per tick; its
  final hash equals a Node `rehearse()` of the same plan. Baselines `e2e/baselines/build-bay-held-oblique.png`
  and `build-bay-visitor-oblique.png` were inspected by the lead: frames held by two people each with
  hands on the columns, beams at both heights between the columns, five joists, two sheets, ten-tread
  stair to the deck edge, visitor on top. Honest weak spots: no lifting/leaning poses (only Idle/Walk
  clips), raise crew stands at the base while the frame pivots up, lifts are not swept, the beam spins
  180° in the air during `connect_beam` (one-line fix in `beam.ts`), a carrier can still bump a walker
  who stopped beside the carry path (1 of 51 tried layouts).
- **Production**: version `d33a4d6b-d4ae-4535-a818-0e5c329e9b4f` (built from `2ecff4b`), replacing
  `de2dddaa-0fab-477c-8b8f-cb1c579efba5` (the previous `deployment.json` value `763de986…` was two
  versions stale). `prepare.py` needed an `engine/` allowlist entry or `/engine/campus-2026.json`
  would have 404'd. Live smoke: all routes 200, R2 model 200, MCP integration PASS (rehearse ≈ 0.85 s,
  execute ≈ 0.74 s in the DO), headless production `/lab` flagship 43/43, 0 violations, screenshot
  `viewer/e2e/artifacts/prod-smoke/build-bay-end-oblique.png` (inspected by the lead; identical state
  to the local baseline). Rollback: see `RELEASE_CHECKLIST.md`.
- **Process notes**: the network dropped repeatedly overnight; subagents stalled and were resumed
  without losing committed work. `<usage-tool>` read a flat 11 % all night and did not track
  this session. Git is local only (author genekogan); nothing was pushed — Gene adds the remote.

## Checkpoint addendum (lead, 2026-09-28 evening)

State at the session checkpoint; the takeover prompt is `NEXT_SESSION_PROMPT.md`.

**Landed since the previous addendum** (each with tests; pinned hashes unchanged unless noted; details in the
per-area docs): seats/benches/campfire as obstacles with approach points and sit-down/stand-up; director demo over
MCP (`deploy/director-demo.mjs` → DIRECTOR_DEMO.md); `prepare.py` folder allowlist + test; stable historical ids
with a 7,942-entry migration (HISTORY_IDS.md); single-carrier loads up/down stairs; replay/fork/staleness proven
through the real room; camera: people + take parts as per-tick occluders, verified against the render
(planner-vs-render disagreements 40 → 1, CAMERA_VERIFY.md); engine scenes and protected states for 2020–2025 with
year rooms; EUC/bicycle riders and a forklift as engine agents (VEHICLES.md); region-local grid updates and a
non-hashing sync key (campus flagship compute 56 s → ~5 s, bit-identical); MCP `engine_edit_world`, `engine_list`,
`engine_delete_workspace`, one refusal envelope, `engine_execute {pauseAt}` + `engine_resume` (13 engine tools);
mid-action resumable checkpoints for the walking/social subset; renderer sit/warm/hold poses driven by engine grip
slots; Lab campfire-evening and year-walkabout scenarios with baselines; flagship v2 (forklift delivery, tread
carried up the stair, campfire ending: 66 steps, 0 violations, open ground 677 s / campus 724 s simulated).

**Evidence:** `npm run evidence` → 17/17 §28 rows, 8/8 milestones, 11/12 capability rows PROVEN; the PARTIAL row is
the uncropped campus run (physically identical, hash differs — grid cell centres depend on the grid origin; fix in
`spatial/grid.ts` first thing next session, it re-pins every hash).

**Reconstruction questions surfaced by the year walkabout:** parked in `QUESTIONS_FOR_GENE.md` (Q1, Q2).

**Open (see NEXT_SESSION_PROMPT.md for priority):** grid-origin hash; renderer reach gaps (footers, far arm, no foot
IK, talk/watch Idle); crews on stairs; ~~vehicle–vehicle collision~~ (closed overnight, W25: `vehicles/traffic.ts`);
~~social pre-emption is manual (`releaseForDirective`)~~ (closed overnight, W25: automatic, SOCIAL.md); static geometry not editable over MCP; region layout edits don't stale plans; 9 ft frame
and north axis unverified (`QUESTIONS_FOR_GENE.md` Q5, Q3); `npm run lint` broken locally (missing oxlint-tsgolint) and not in the gate
(now `briefs/codex-tooling.md`).

**Releases today:** 4 gated production deploys before this checkpoint (see RELEASE_CHECKLIST.md records); the fifth
(this checkpoint) is recorded in the Deployment status section above if it completed.


## End of night: overnight session 2026-09-28 (lead: Fable 5.1 as PM, Opus 5.5 workers; 00:18 → ~08:45 EDT)

For Gene. Every number below is from a file or a test run tonight; the live log with each worker's report, cost and the lead's
verdict is `PROGRESS.md` (from "Overnight session start"). Nothing was deployed (your instruction); nothing was pushed.
Consolidated by W26 in a worktree of `c27093d` (branch `w26-final`, fast-forwarded onto `main`).

### What landed, by owner-feedback item (`OWNER_FEEDBACK_2026-09-28.md`)

| § | What exists now | Workers | Doc |
| --- | --- | --- | --- |
| 1 fire | Animated fire shared by lab + studio (`app/engine-view/fire.ts`): 3 billboard flame layers, coal bed, embers, smoke, seeded flickering light; pure function of id + sim time (`e2e/fire.spec.ts`). | W3 | PROGRESS W3 |
| 2 splined turns | Walk legs = straight runs + circular fillets checked every 2 cm against corridor clearance, curvature speed cap, turn in place only > 120°. | W4 | MOVEMENT.md |
| 3 react to blocks | 1.5 s look-ahead, stop on the tick something appears, decision ≤ 0.5 s (wait with reason / route around); squeezed people-replan; encounters on the smoothed path; walk-stall metric = 0; **no jumps**: ≤ min(speed, 1.4 m/s)·DT per tick, `motion.teleport` 0.15 m/tick on foot, new `motion.overspeed`. | W4, W15, W21 | MOVEMENT.md (§2, §7) |
| 4 stairs | Two-bone leg IK, tread-by-tread gait: soles 0.0 cm from treads at every plant, up and down. | W6 | POSES.md |
| 5 hand-up / forklift | Climbable frames + beam walkways, `hand_up` (ground crew → receivers on the beams), forklift variant, `aloft.ts` fastening, receiver edge / kneel rules, lever grip + `handup.unbalanced`; flagship v3 (87→88 steps, 0 violations). | W2, W8, W10, W12 | HANDUP.md |
| 6 handling motions | One body model (`engine/body/model.ts` = the measured rig: shoulders 1.34, arm 0.62, overhead 2.00/2.06, reach-down 0.5 m); posture solver (crouch, one-knee kneel, bend), closed grip, arm IK to engine hand points; hand-up v3 92.5 % of hand points reached, 0 rig-reachable misses; ladder-cycle climbing, beam-walk. | W6, W9, W10, W12, W14 | BODY_MODEL.md, POSES.md |
| 7 year build (headline) | **Phase A done for 2022 east-house**: assembly graph, BOM + strapped piles, `cut`, frame stances, `hang_beam` — 552 steps, 117 277 ticks, 0 violations, 66/66 frames + beams at the canonical pose. **Phase B partial (W13, still in flight)**: material rules + generator for decks, Kit stair, walls, solar; each section reported clean in W13's runs; the suite executes the plan and one tranche (first bay + first ground-floor deck strip, 53 604 ticks, pinned `94db263e…`); the whole A+B run has no pin and no take. | W7, W13, W14 | YEAR_BUILD.md |
| 8 paint | `paint` verb, 0.2 m bands, top band from a 0.6 m platform, rendered band overlay (colour + stripe, no textures). | W8, W12, W14 | SOLAR_PAINT.md |
| 9 solar | Rails, panels, battery / charge controller / inverter, fragile-tilt refusal, rendered; in the year build as a phase-B section (plan-tested only). | W8, W14, W13 | SOLAR_PAINT.md |
| 10 "watch it being built" | Studio year picker → **Watch it being built** for 2022 (first bay, whole skeleton): engine camera, refusal / blocked log, 64× (≈ 20 fps SwiftShader), final check = recorded hash + parts at the canonical pose. | W19, W24, W17, W22, W26 | STUDIO_REPLAY.md |
| 11 camera direction | Phase 1: typed directions → computed trajectories (orbit radius from extent, sun-behind window, camera navmesh), `engine_direct_camera`. Phase 2: every shot simulated + self-corrected (collision, squeeze, foreground, flare, frame, horizon, motion, `occluded`), recorded reasons. Studio Direct-camera panel, file cameras, Save track, `verifyCamera { track }`. | W16, W18, W23, W19, W24 | CAMERA_DIRECT.md, STUDIO_REPLAY.md |
| 12 meal | Table / bowl / spoon / cup / pot, `take_item` / `put_item` / `serve` / `eat` (overlay inside sit / gather / converse), legs-crossed sit, spoon at the lips. | W5, W6 | ITEMS.md, POSES.md |
| (open items) | Grid on one global lattice (full campus == crop, bit-identical); walker perf (stress-30 mean 0.70 → 0.49 ms); takes mars-take/3 + /4 (thinned hands / speed / tracks, entities0, compact events, file cameras; whole house 8.3 → 3.85 MB); automatic pre-emption of social holds; vehicle–vehicle collision + right of way. | W1, W11, W20, W22, W25 | PLANNING_BUDGET.md, TAKES_AND_PLANS.md, SOCIAL.md, VEHICLES.md |

### Gate (W26 worktree)

GREEN at `1395dd4` (worktree; `gitDirty: true` only from these docs being written and the untracked `.pw-browsers`
symlink). Report `viewer/.cloudflare/gate/2026-09-28T12-53-41-373Z/report.json` in the W26 worktree (gitignored).

| stage | result | time |
| --- | --- | --- |
| unit (`npm test`) | 56 / 56 | 0.4 s |
| engine | 358 pass / 0 fail / 3 skip (361 in 54 files) | 43.5 s |
| tsc | clean | 1.5 s |
| e2e (Playwright) | 61 passed / 1 skipped | 643.5 s |
| determinism probe | `b746b0947e65…62e7f0c3` @ 10 901 (= pin) | 2.7 s |

Two reds found and fixed on the way (details PROGRESS W26): `npm test` had been 55/56 since `0ab2e6f` (W19) — the release-allowlist
scanner read a doc comment in `app/studio/direct-camera.ts` as an unstaged URL (comment reworded); three live-lab hand-up
baselines (`poses-pickup-crouch`, `poses-handup-joist`, `poses-climb-frame`, 2.1–3.6 % off) drifted with W21's walker timing
(same moments, +117 ticks; looked at baseline / new / diff; refreshed).

### Takes (`viewer/public/engine/takes/`, `node deploy/record-campus-take.mjs --all --full --check` → OK for all three)

| take | take id | final state @ ticks | camera | cuts | readability min / mean | file / gzip |
| --- | --- | --- | --- | ---: | --- | --- |
| flagship, 2026 staging-east | `d2f16bd3424c67066f25f2a5` | `c56ea8da…` @ 11 459 | `cam-bb4b6990b0c93c33` | 12 | 0.60 / 0.96 | 1 542 240 B / 239 672 B |
| 2022 east-house, first bay | `b7b882fda48c63e8e21d4e88` | `251a44c5…` @ 41 317 | `cam-7492f43a731bf215` (was `cam-305a0efe…`) | 19 | 0.42 / 0.81 (was 0.40 / 0.81) | 1 335 100 B / 246 884 B |
| 2022 east-house, whole skeleton | `69c41651fc6002f64ee3b32d` | `d382e461…` @ 117 277 | `cam-b83a682873e5b1c5` (was `cam-9609b6f7…`) | 52 (was 50) | 0.31 / 0.79 | 3 852 499 B / 697 763 B |

All `mars-take/4`, `hypothetical: true`. The two year-build cameras were re-planned tonight with the kind-aware sampler (piles
are boxes, not people; lead decision after W23); takes and final states are unchanged. Not recordable: flagship v3
(`onto_s2_4` `beam_walk` → `beam.no-room`, clearance 0.25 < 0.28 m, tick 11 009) and year build A+B (no pin yet).

### Pins (PLANNING_BUDGET.md, last re-pin "no walker jumps", W21; unchanged by W22–W26)

probe / flagship build-bay `b746b094…` @ 10 901 · campus flagship crop = full uncropped `c56ea8da…` @ 11 459 · stress-30
`5c3a3355…` · meal `3c28879f…` @ 608 · build-bay v3 `a2f782ad…` @ 16 401 · year build first bay `251a44c5…` @ 41 317 (24/24) ·
whole skeleton `d382e461…` @ 117 277 (66/66, `YEAR_BUILD_FULL=1`) · year build B first bay + first deck strip `94db263e…` @ 53 604
(`year-build-b.test.ts`) · gather routes `G` unchanged. Seven re-pins overnight, each with a stated reason and an outcome diff:
grid lattice (W1), splines (W4), walker fallback (W15), no jumps (W21) moved every pin; kneel rule, body model, measured rig
(W10, W10, W12) moved v3 only.

### Lead decisions taken overnight that you may veto

1. **One body model** (OWNER_DECISIONS, 02:20): engine reach and the rendered rig come from one `engine/body/model.ts`; the rig's
   arms are scaled to it; anything outside it is refused.
2. **Body model = the measured rig** (OWNER_DECISIONS, 04:20): shoulders 1.34 m, reach-down **0.5 m** below the feet (the spec said
   ≈ 1.0 m); deeper hand-offs are refused ("use the forklift"). Alternative: a lying-down receiver posture.
3. **Kneel rule at the edge** (PROGRESS W8/W10): receivers' hands ≤ 0.8 m horizontally from their feet; `RULES_VERSION`
   `mars-assembly/3`.
4. **Walker behaviour beyond brief** (PROGRESS W15): squeezed people-replan; an arrived walker counts as standing.
5. **Year-build camera sampler** (PROGRESS W23): piles sampled as boxes, re-recorded tonight (above).
6. **No production deploy** tonight (your instruction, 00:35): production is still release 5 (`cebd5827…`).

### Questions for Gene

Parked in `QUESTIONS_FOR_GENE.md` (non-blocking, with pictures; not re-surfaced in handoffs).

### Known shortcomings and open items (deduplicated, highest first)

1. **Year build B is not finished.** No committed test executes the stair / wall / solar sections; the whole A+B run has no pin
   and no take (≈ 8 MB when last tried); only 2022 east-house is sequenced (other houses plan only; 2020 / 2025 racks don't map).
2. **Flagship v3 is a knife edge:** `onto_s2_4` `beam_walk` needs 0.28 m and has 0.25 m at staging-east and at 11 of 17 open-ground
   origins; the pinned run passes by ≈ 3 cm. Not recordable as a take.
3. **Frame-stance bodies:** the rear `hang_beam` lifter faces travel with the beam behind its back; stance holders' hands sit
   0.73–0.79 m beside the body while facing the frame (needs a facing / turn in the engine); one whole-skeleton reach-down renders
   the palm 1.025 m from the recorded hand (t 2682.3 s); no engine foot / hand holds on the bracing.
4. **makeWay asks reserved people:** 95 `reservation.conflict` make-way refusals show as "refused / failed" in the
   whole-skeleton replay (same outcome); unfilled `$crew[0]` step labels in that take.
5. **Year-build camera readability is low:** min 0.31 (whole skeleton) / 0.42 (bay 1) at 0.5 Hz slow shots.
6. **Reach model vs bodies:** one reach-down cap (0.5 m) for templates reaching 0.35–0.54 m (woman template below the cap →
   per-person body variant); giver hands sit at 0 mm slack on the envelope; hand-up v3 92.5 % and year build 76.6 % of engine hand
   points reached by the rig.
7. **Pre-emption (W25):** a pre-empted sit / conversation is not resumed; a converse loses all members.
8. **Vehicles (W25):** a forklift behind a parked-but-ridden EUC waits indefinitely (no swerve / reverse); reach / side-shift /
   raise not checked against vehicles; 3-vehicle yield cycles undetected; `edit_world` cannot move vehicles.
9. **Walking:** look-ahead assumes 0.9 m/s lateral; carry / climb / stance / sit publish no speed; 1.08–1.5 m gaps between people are
   walkable but not plannable at 0.1 m cells; head-on round a tight corner falls to the single-file rule; heuristic, not ORCA.
10. **Camera:** correction ladders are fixed (first valid wins), thresholds chosen not measured; synthesis collides with static
    geometry only; no door objects in year scenes; navmesh rebuilt per call (100–250 ms); render parity only in Playwright.
11. **Studio:** rebuilt racks draw 0.16 m below the Kit's (datum); a saved directed track is a download the owner copies into
    `public/engine/takes/` (no room op stores it).
12. **Performance:** stress-30 tick 5 = 27–30 synchronous exact A\* ≈ 90 ms (only the corridor planner gets < 60 ms, and it moves
    hashes).
13. **Items / fire / render:** reach over a table (1.1 m) unchecked, 1-tick item lag while walking, no item–item collision; fire
    smoke faint, core saturates, billboards flat from above; paint has no textures; frames render blue (photo: green); skeleton lacks
    the 2x4 top framing.
14. **Engine hygiene:** host `**` on 14 non-test engine lines is not scanned; W7 follow-ups (climb paths not body-checked, beam
    walk-in checks static geometry only, bundle keeps its full box until empty, `contents.count` untyped, BOM solar ids vs W8's).
15. **Carried from before tonight:** crews (multi-carrier) on stairs; static geometry not editable over MCP; region layout edits
    don't stale plans; talk / watch are Idle; `npm run lint` broken locally (Codex: `briefs/codex-tooling.md`); scanned Martians (consent), electrical model.

Closed tonight (were open at the checkpoint): grid-origin hash dependence (W1); lab-social t60 (W9/W15); foot IK on stairs (W6);
**automatic pre-emption of social holds (W25)**; **vehicle–vehicle collision (W25)**; take size (W20/W22); emptied piles undrawable
(W22); camera sampler treating piles as people (W23, re-recorded W26).

### Evidence

`npm run evidence` at `1395dd4` (`EVIDENCE.md`, `evidence.json`): §28 rows **17 / 17 PROVEN**; capabilities **27 PROVEN / 1 PARTIAL /
0 UNPROVEN of 28** — the PARTIAL is year build B (3 / 4: plan, report-only, first bay + first deck strip pass; the whole A+B house is
`YEAR_BUILD_FULL`-gated and unpinned); new rows tonight: camera direction phase 1 (15 tests), phase 2 incl. `occluded` (11), takes
/3 + /4 (4), no walker jumps (2), social pre-emption (7), vehicle–vehicle (6); milestones **8 / 8**. Campus flagship compute 7.9 s;
full uncropped = cropped `c56ea8da…`.

### Cost (subagent tally from PROGRESS.md)

24 landed workers (W1–W12, W14–W25): **≈ 8.65 M subagent tokens, ≈ 1 460 worker-minutes (≈ 24 h)** over ≈ 8 h wall (00:25 →
08:15 EDT), i.e. ≈ 1.1 M tokens/h, 2–3 workers at a time. Largest: W7 620k, W2 530k, W4 525k, W14 520k, W16 500k. Not included:
W13 (phase B, still running at this write-up) and W26 (this consolidation, ≈ 0.35 M tokens, ≈ 1 h 10 min). usage.py at 07:07 EDT: 5-h window 3 %,
week 24 %.

**If resuming:** `git status` in the main tree — unstaged files there belong to W13 (`engine/campus/**`, `construction/**`,
`scenarios/year-build.ts`, `test/year-build-b.test.ts`, `YEAR_BUILD.md`). Pinned hashes in the tests are the truth.

**Addendum after W26 (lead, 09:40 EDT): W13 landed** (`77e9d28`…`97957ca`, 13 commits) — §7 phase B for 2022 east-house: decks, stair, walls and
solar sequenced from piles with `cut`, `pass_up`, `install_wall`, stringer/tread/post/handrail verbs; each section 0 violations; 12 frames,
54 beams, 81 deck pieces, 25 wall panels, 16/21 stair parts, 6/20 solar parts at their target poses; 19 unplaced with reasons; default-suite
tranche pinned `94db263e…` @53604; **the end-to-end A+B run is not green** (37 ticks `collision.human-human`, a wall carrier vs a parked crew
member) and has no pin/take yet — first item for the next session. Report-only plans exist for all six years (YEAR_BUILD.md). Final head
`97957ca`: tsc clean, engine 358/0/3 of 361 (lead-verified); full gate last GREEN at `1395dd4`, W13's later commits are engine + docs.

## Codex split and checkpoint 1 (2026-09-29, W33 for the lead)

**External Codex contributor (Gene, 09:45 EDT).** Bounded areas move to Codex, an external contributor and not a
Claude subagent. Codex works on `codex/<topic>` branches in its own worktree, with its own Vite / Playwright port
(5491 / 5493) and `E2E_RUN` dirs. It gates with `npm run test:engine`, `npx tsc --noEmit -p .` and Playwright
per spec (not `npm run gate`), rebases onto `main` before every report, and reports only to
`docs/engineering/briefs/<brief>.REPORT.md`.
- **The lead** re-gates in a worktree (test:engine + tsc + the brief's specs; the full gate before a release),
  then fast-forwards or cherry-picks. It accepts firelit / colour drift in other baselines at merge after looking
  at them.
- **A change that moves a pin** is rejected, with the reason appended to the REPORT.
- **Codex commits** end with `Co-Authored-By: Codex <noreply@openai.com>`.

Contract: `CODEX.md`.

**Ownership map (final).**
- **Codex-owned:**
  - `engine/camera/parse.ts` (+ `engine/test/camera-parse*.test.ts`);
  - `app/engine-view/fire.ts` + `e2e/fire.spec.ts` (+ `fire-*` baselines);
  - render-polish files: `app/engine-view/paint.ts`, new `solar-mesh.ts` / `equipment-mesh.ts` / `palette.ts`,
    one-line delegations in `components.ts` `panel()` / `equipment()` / the colour lookup, and new
    `e2e/render-polish.spec.ts` (+ `render-polish-*` baselines);
  - `docs/engineering/data/**` + `deploy/group-2026-frames.{mjs,test.mjs}`;
  - lint / gate tooling (`.oxlintrc.json`, the package.json `lint` script + devDeps + lockfile, the `gate.mjs`
    lint stage, new `engine/test/source-scan.test.ts`);
  - its REPORT files.
- **Claude-owned:** everything else, explicitly:
  - locomotion, construction, campus (incl. `assembly.ts`), spatial, body;
  - **take (`engine/take/**`)**, year-build sequencing, studio replay, **`app/history/scenes.ts`** (and all
    `app/history/**`);
  - the camera modules other than `parse.ts`, the catalog, the lab, all other specs and docs.
- Claude workers are never briefed into Codex areas, and nobody touches `codex/*` except to merge.
- **Note for the lead:** OWNER_DECISIONS.md's 09:45 entry still lists `app/history/scenes.ts` and take thinning as
  Codex-owned. Gene's correction moved both to Claude, and the year-scene doors brief was dropped. OWNER_DECISIONS
  is the lead's to amend.

**Codex blocks** (`briefs/`; ETAs are W33's estimates of Codex hours, uncalibrated):

| Brief | Block | ETA (estimate) |
| --- | --- | --- |
| `codex-2026-frame-grouping.md` | 2026 CAD `rack_member` + beams → catalog frames / beams with seat heights → `docs/engineering/data/campus-2026-frames.json` + unclassified report + SVG overlay. Claude then takes the `assembly.ts` integration half (block F). | 6–10 h |
| `codex-camera-nl-parse.md` | `engine/camera/parse.ts`: sentence → `CameraDirection` (schema frozen), structured refusals, Gene's four sentences. | 4–6 h |
| `codex-fire-v2-and-render-polish.md` | Fire from above / smoke / core; paint textures incl. the 2024 flower mural; solar and equipment meshes; green frames. | 6–10 h |
| `codex-tooling.md` | `npm run lint` repaired (oxlint-tsgolint) and gated only once green; the source scan extended to `**` with an allowlist of today's 14 sites. | 2–4 h |

The total is ≈ 18–30 Codex hours, and the four briefs are independent, so they can run in parallel.

**Checkpoint 1** = **2022 complete: phase B landed and pinned, 2x4 framing verbs, all four houses, studio "Watch it
being built · 2022"**. All of this is Claude-owned. Phase B for the east-house is green and pinned (`ddb634d6…`,
W27). Open: its take (over budget), 2x4 framing, the other three houses and the studio chapter (W31 in flight).

**Questions for Gene:** parked in `QUESTIONS_FOR_GENE.md` (14 open, 2 answered, with pictures). They are not
re-surfaced here.
