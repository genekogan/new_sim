# Handoff: Mars Studio simulation engine, tranche of 2026-09-27

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
- **9 ft frame unverified.** Gene named 8/9/12/19 ft, but the library has no 9 ft frame.
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
- **Live:** `89e65c8c-5abb-4377-a693-3689de30d465` (deploy 4, from `9561854`).
- **Rollback target:** `17f7c9aa-84d1-437d-b1d6-287c85e553fe` (live before deploy 4, confirmed at
  100% with `wrangler deployments status`). `viewer/deploy/deployment.json` records it as
  `rollback_version`; its `version` is the live `89e65c8c…`.
- **Release gate:** a deploy starts from a green `npm run gate` report (`ok: true`, `gitHead` = the
  deployed commit, `gitDirty: false`). See `RELEASE_CHECKLIST.md`.
- **Release steps** (`viewer/deploy/README.md`): `browser-model.py` → `compress-browser.mjs` →
  `prepare.py` → `CLOUDFLARE_RELEASE=1 npm run build` → `deploy/upload.mjs` →
  `wrangler deploy --config dist/server/cloudflare.json`; then `SITE_BASE=… ALL_ASSETS=1 node
  deploy/smoke.mjs` and `SIM_BASE=… node deploy/simulation-integration.mjs`.
- **Shipped to production 2026-09-27** (deploys 1, 2, 3 and 4; see below); before that, not live:
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

## Suggested next tranche (prioritised)

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
6. **Owner confirmations.** The site north bearing (`NORTH_AZIMUTH_OFFSET`), whether the 9 ft part
   exists and what it is, the plywood span rule, and stair/plywood dimensions against photos.
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

