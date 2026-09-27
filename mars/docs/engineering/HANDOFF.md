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
At `19aa5b6` it ran **122 tests: 120 pass, 1 fail, 1 skipped**, in 115 s wall time (not the ~10 min
the brief expected).

| File (`engine/test/*.test.ts`) | n | Result | File | n | Result |
| --- | ---: | --- | --- | ---: | --- |
| `api` | 6 | pass | `core` | 6 | pass |
| `build-bay` | 1 | pass | `env-sun` | 9 | pass |
| `camera-geom` | 6 | pass | `history` | 3 | pass |
| `camera-replay` | 3 | pass | `navigation` | 11 | pass |
| `camera` | 6 | pass | **`progressive`** | 9 | **8 pass, 1 FAIL** |
| `campus-extract` | 7 | 6 pass, 1 skip (`CAMPUS_FULL=1`) | `rehearsal` | 8 | pass |
| `campus-flagship` | 1 | pass (114 s) | `sequence` | 9 | pass |
| `campus` | 9 | pass | `take` | 7 | pass |
| `carry` | 10 | pass | `walk` | 7 | pass |
| `construction` | 4 | pass | | | |

The failure, verbatim:
```
✖ progressive floor: after 1 of 2 sheets only the installed sheet is walkable (2585.882333ms)
  AssertionError [ERR_ASSERTION]: standing on the deck (y 1.9494500000000001)
      at TestContext.<anonymous> (file:///…/viewer/engine/test/progressive.test.ts:113:10)
```
This is the "progressive deck-y regression" that `PROGRESS.md` (~11:30) lists as delegated. The suite
is red until it lands.

**Spec §28 cases and the tests that cover them:**

| Case | Test (file: title) |
| --- | --- |
| Wall | `navigation`: "wall: plans around the wall before contact"; `walk`: "walk around wall…" |
| U-trap | `navigation`: "U-shaped trap…" |
| Narrow passage | `walk`: "narrow passage: opposing walkers take turns…" |
| Stair approach | `navigation`: "stairs: oblique approach…"; `walk`: "stairs: oblique start…" |
| Multiple floors | `navigation`: "multi-level: deck → ground…" |
| Long load around a corner | `carry`: 12 ft beam in the 2.5 m L passes; 19 ft upright is rejected at the corner |
| Raise frame / premature release | `construction`: "supported bay: raise, hold, premature release refused…" |
| Construction changes navigation | `navigation`: "construction changes navigation…"; `walk`: "construction mid-walk…"; `progressive`: "…forces a replan" |
| Incomplete floor or stairs | `navigation`: "incomplete stairs…"; `progressive`: "progressive stairs…" |
| Reservation conflict | `carry`: "…fails with reservation.conflict" |
| Graceful cancellation | `carry`: three cancel cases; `construction`: "cancel mid-raise is refused" |
| Camera collision and readability | `camera`: the collision, readability, glass and hysteresis tests |
| Replay independence | `camera-replay`, `take`: "replay camera independence…", `api` |
| Fork isolation, plan invalidation, replay isolation | `rehearsal`, `history`, `take`: "replay isolation…" |

**Other suites** (none re-run for this handoff): `npm test` (`deploy/*.test.mjs`, 48/48 at audit
time); `npm run test:simulation` (real MCP incl. `engine_*`, `fa20f9a`; needs `wrangler dev`);
`npm run e2e` (studio 11/11, lab 13/13 per `PROGRESS.md`); `npm run typecheck`, `npm run lint`. All
**(unverified now)**.

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

- **No foot IK and no carry, lift or hold poses.** Carriers play Walk or Idle beside the load. On
  stairs, feet sink or hover by about 0.09 m. Turning in place plays Idle (`app/lab/README.md`).
  `RESEARCH.md` §11 (IK) is not implemented.
- **Formations don't avoid each other.** Simultaneous carries are not co-planned and have no space
  reservation, so a sequence has to order them with `after` dependencies (the `step(…, after)` calls
  in `build-bay.ts`).
- **People-avoidance is heuristic.** Walkers use traffic resources, right-of-way, turn hysteresis and
  hard separation. Formations halt for people in the way, ask idle bystanders to "make way", then
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
  rigid (no re-grip). A blocked mid-carry route holds unless the blocker is a bystander. Lifts and
  raises are interpolated, not swept. The camera sees obstacle prisms only, not the render mesh. There
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
- **Lab and render:** trio 0.02 ms per tick; stress-30 0.88 ms mean with 200+ ms spikes. About 22
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
- **Rollback target:** `viewer/deploy/deployment.json` records version
  `763de986-3bdd-4947-a335-226f28a8ed79` (published 2026-09-05, updated 2026-09-26 with the Brahman
  2020 stairs and Portal screens). OWNER_DECISIONS requires recording it. Confirm it is still live
  with `wrangler deployments list` before deploying **(unverified)**.
- **Release steps** (`viewer/deploy/README.md`): `browser-model.py` → `compress-browser.mjs` →
  `prepare.py` → `CLOUDFLARE_RELEASE=1 npm run build` → `deploy/upload.mjs` →
  `wrangler deploy --config dist/server/cloudflare.json`; then `SITE_BASE=… ALL_ASSETS=1 node
  deploy/smoke.mjs` and `SIM_BASE=… node deploy/simulation-integration.mjs`.
- **Not in production yet**, per `deployment.json`: the engine, the `engine_*` tools,
  `/api/simulation/engine/take`, `/lab` (`5f02352`) and the NOAA sun.
- **Review first:** an uncommitted line in `viewer/deploy/prepare.py` and in-progress lab edits (not
  part of this handoff). Git is local only; nothing is pushed without Gene.

**TODO (lead): production deploy result — date, new Worker version id, smoke + integration results,
rollback command: ______**

## Suggested next tranche (prioritised)

1. **Green gate.** Fix the `progressive floor` deck-y regression. Put `test:engine`, `npm test`,
   `typecheck`, `lint`, `e2e` and `test:simulation` in one gate script and record its output. Refresh
   the stale numbers in `app/lab/README.md`, `TAKES_AND_PLANS.md` and `CAMERA.md`.
2. **Planning cost.** Add a per-tick planning budget or queued replans. Replace the full `Spatial.sync`
   rebuild with region-local grid/EDT updates. Profile the campus flagship to under 10 s of compute (or
   chunk it for DO limits), and measure the ~3× replay regression before and after.
3. **Visual proof of the flagship.** Render the campus take in the lab or studio, with a planned camera
   track, video and committed baselines, all labelled hypothetical.
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
