# Engine Lab (`/lab`)

The deterministic engine (`viewer/engine/`) running live in the browser over the
proving ground (`engine/scenes/proving-ground.ts`). It renders with the studio's
animated people (Quaternius CC0 `animated-{casual,punk,woman}.glb`, clips Idle/Walk).
Dev only for now: `npm run dev` → `http://127.0.0.1:5173/lab?scenario=stairs`.
The production Worker (`deploy/configure.mjs`) does not route `/lab` yet.

## Modules
| file | role |
| --- | --- |
| `scenarios.ts` | presets, pure TS (node can run them): wall, u-trap, narrow-passage, stairs, deck-to-ground, incomplete-stairs, construction, trio, stress-30, build-bay, campfire-evening, year-2020 … year-2026 |
| `build-bay.ts` | flagship "build a rack bay" preset: world/registry/invariants/contributors of `engine/scenarios/build-bay.ts` on the test's open ground, `bindTemplate` → `SequenceRunner` stepped live (`advance()` once, then per tick `rt.step()` → `poll()` → `advance()`, exactly `run()`'s loop) |
| `hand-up.ts`, `meal.ts` | presets `hand-up` (flagship v3, `engine/scenarios/build-bay-v3.ts`: joists and s1 handed up to people on the beams, s2 off the forks; same SequenceRunner loop as build-bay, `bindRunner`) and `meal` (`engine/scenarios/meal.ts`: take bowl + spoon, serve, sit round the fire, eat until empty; runMeal's loop body per tick). Hook `bones(id?)` (feet/soles, stair gait, posture, arms vs targets), `stairs()`, `heldItems()`; specs `e2e/stairs.spec.ts`, `poses.spec.ts`, `meal.spec.ts` (POSES.md) |
| `../engine-view/components.ts` | one persistent object per world component, pose interpolated between ticks; Euler(pitch, −yaw, roll, 'YXZ') = engine `entityCorners` order; uprights as braced two-column frames, stair flights as two stringers (treads are their own entities), everything else a catalog-coloured box; `nearestPoint` for hand placement |
| `campfire-evening.ts` | HYPOTHETICAL inhabited scene (milestone H, `engine/social`): campfire + 2 benches + 3 camp chairs south-west of the proving ground's test zones, 14 people, a timed script of direct submits (gather, converse, sit, ambient_wander; stand + take_slot at 40 s; last place at 42 s; full-circle `slot.none-free` + `reservation.conflict` at 50 s as EXPECTED diagnostics; bench at 51 s; `releaseForDirective` + `walk_to` at 54 s); runs 75 s, dusk lighting |
| `year-walkabout.ts` | year walkabouts (pure TS): fetch `public/engine/campus-<year>.json` in `prepare()` (2026: `campus-2026.json` cropped ±60 m around staging-east), build `Spatial` + 0.1 m grids in the browser (timed for the HUD), four walkers at region-hull-derived spots (snapped to ≥ 0.6 m clearance) with `walk_to` targets across the campus and optional `via` passage checks |
| `year-walkabout-view.ts` | the studio's real geometry as backdrop (`createHistoricalScene(year)` from `app/history/scenes.ts`, dynamically imported so the studio modules stay out of the lab's dev-server reload graph for other presets; 2026 = `browser/campus.glb` minus people/reference ground) and the **Engine obstacle prisms** overlay (ground-band blockers as one instanced translucent draw + outlines, depthTest off so footprints under roofs show) |
| `social-hud.tsx`, `overlay-slots.ts` | social HUD (script status, slot occupancy, Idle-clip legend) and the **Interaction slots** overlay (green free · amber claimed · orange occupied, tick = heading) |
| `../engine-view/fixtures.ts`, `../engine-view/fire.ts` | `kind: 'fixture'` meshes: bench, camp chair (seat faces local +z), campfire (stones, logs + the shared animated fire: noise-shaded flame tongues, coal bed, embers, thin smoke, flickering warm point light at dusk; a pure function of entity-id seed + sim time, also used by the studio ambience fire) |
| `sequence-hud.tsx` | sequence HUD on the canvas (active steps + phase, BLOCKED waits with code/message, last diagnostics) and the panel's step-chip timeline |
| `sim.ts` | `LabSim`: builds `Runtime` (Spatial + walk_to + `DEFAULT_INVARIANTS`), fixed-DT accumulator, step cost stats, event log, replan detection |
| `scene.ts` | ground, walls/solids as boxes from the `SpatialScene`, stairs from `link.path` (missing treads left out), component boxes |
| `../engine-view/people.ts` | template loading copied minimally from `studio/campus-life.ts` (scale 1.75 m, feet at y=0); Walk-clip ground speed measured from the stance foot |
| `../engine-view/humans.ts`, `rig.ts`, `stair-gait.ts`, `posture.ts`, `items.ts` | engine pose → rig (`rotation.y = -yaw`), clip weights per tick, frames interpolate the last two ticks; Walk iff ground speed ≥ 0.08 m/s (engine `human.speed`), out within 0.2 s. Pose layers (**docs/engineering/POSES.md**): sit (+ legs-crossed variant per id), stair gait (feet planted on tread tops by leg IK, pelvis follows), handling postures (crouch / hip bend / heel raise solved from the hand targets, 0.4 s blend), arm IK to the engine hand points (`human.hands`) or grip slot, reach-honest (arms hang beyond 1.25 arm lengths; bones never stretch); items in hand ride the rendered palm (`components.attachHeld`), food level from `contents.fraction` |
| `overlay-*.ts` | clearance heatmap, traffic components, routes/corridors, discs/facing, obstacle prisms, stair links, labels, violation markers |
| `lab-view.ts`, `page.tsx`, `panel.tsx`, `hook.ts` | renderer + loop, UI, `window.__marsEngine` |

## Use
- **Scenario picker** reloads a fresh world. Transport: Play/Pause, Step (one tick), Reset, speed 0.25–8×.
  Simulation time is decoupled from fps (accumulator, ≤ 40 ticks per frame).
- **Build a rack bay**: 43 steps, ≈ 524 s simulated, ≈ 10.5 k ticks. The panel shows every step as a chip (cyan running,
  amber blocked, green done, ⏸ = was blocked at some point; hover for times and diagnostics); the canvas HUD lists running
  steps with their phase and any `BLOCKED traffic.person / carry.setdown-occupied / carry.path-occupied …` wait.
- **Construction**: the panel drops at tick 20. "Drop panel into the gap now" drops it earlier.
- **Overlays** are all off by default. Colours:
  - Heatmap: red = blocked or clearance < r; amber = single-file band; green→clear = open.
  - Traffic: hue per narrow component, red while it is held.
  - Routes: cyan = current leg; ribbons = clearance per segment.
  - Links: green = usable, red = unusable.
- **Failures are loud**: a red banner per failed action (with its diagnostic), a red banner for violations,
  red labels, and red log lines. A verdict badge shows whether the scenario expectations were met.

## Test hook `window.__marsEngine`
`ready`, `frames`, `error`, `scenarios()`, `runScenario(name, {paused=true, speed})` (a Promise for scenarios with `prepare`, i.e. year walkabouts), `step(n)`, `runToEnd(max)`,
`pause(on)`, `setSpeed(x)`, `state()` (humans, checks, stats), `violations()`, `records()`, `log()`,
`setOverlay(name, on)`, `overlays()`, `camera(pos, target)`, `cameraPreset('top'|'oblique')`, `info()`, `perf()`,
`backdropReady` (year backdrop geometry + photos loaded), `scenarioHud()` (panel HUD lines), `sequence()` (step rows + blocked/failed/violation log), `slots()` (interaction slots with claim/occupant), `social()` (fired script events + expected diagnostics), `runUntilSteps(ids, status='completed', max)`, `components()`
(pose, phase, support, engine corners, rendered bounds), `stateHash()`.

`e2e/lab.spec.ts` covers:
- Each scenario: run to completion, check expectations, zero violations, a visible failure banner when a failure is expected, and an identical deterministic replay.
- Captures: top/oblique × overlays off/on, mid-action and at the end.
- Stair geometry checks, and a `test.fail` known engine issue (below).
- Real-time videos: narrow-passage and stairs.
- Perf.

Baselines: `lab-stairs-mid-oblique`, `lab-narrow-passage-mid-top-debug`.

`e2e/lab-social.spec.ts` covers campfire-evening: all expectations, zero violations, the arrangement at 20 s and 65 s (was 60 s: x1 reaches the last place at 63.3 s since W4's walk timing — a 3.5 s traffic wait behind g3, who stands warm in the ring) (fire circle on the 1.6 m ring facing the fire, sitters on claimed seats facing the seat heading, c1/c2 facing each other, no two people closer than 2r), the two EXPECTED conflict banners and no FAILED banner, deterministic replay. Captures `lab-social-t{20,65}-{oblique,top}[-debug].png` (debug = agents, labels, slots, routes) and close-ups `lab-social-t65-close-{pair,circle,chairs,chairs-top}.png`. Baselines: `lab-social-t20-oblique`, `lab-social-t65-top-debug`.

`e2e/fire.spec.ts` covers the animated campfire (campfire-evening at dusk, t 25.0 / 25.3 s): the flame region changes while a still standing person does not, the same tick replayed draws the identical fire, draw calls within +3 of the old cone, no console errors. Baselines: `fire-dusk-oblique`, `fire-dusk-close`.

`e2e/lab-build-bay.spec.ts` covers the flagship sequence: completes, zero violations, final state hash equal to the node
rehearsal (`engine/rehearsal/rehearse.ts`) — so live stepping is the rehearsal — geometry sanity from engine corners
(beams between the columns, joists on the upper beams, ply on the joists, stair top at deck height and at the deck edge,
visitor on the ply) and rendered bounds within the engine boxes; every blocked step appears in the diagnostics log.
Captures (oblique + top): `build-bay-{carry,raise,held,beams,joists,deck,stair,visitor}-*.png`, video
`build-bay-raise-beams-2x.webm` (raise + beams at 2×). Baselines: `build-bay-raise-oblique` (A at about 45°: lifter walking the frame up, footer at the base), `build-bay-held-oblique`, `build-bay-visitor-oblique`.

## Year walkabouts (`year-2020` … `year-2026`)
Checks the generated engine scenes (`docs/engineering/CAMPUS_SCENE.md`) against the studio's rendering of the same year.
The panel HUD shows file size, fetch/parse and **build** ms (`new Spatial` + first `sync`: rasters + EDT clearance).
Turn on **Engine obstacle prisms** (magenta solid, red wall, cyan glass, yellow vehicle, violet fixture; drawn on top of roofs)
and **Walkability / clearance** to see where the engine data and the render disagree.

| preset | walkers (4) | passage checks |
| --- | --- | --- |
| 2020 | portal → forest, geodesic → tent, MCDA → portal, canopy → geodesic | — |
| 2021 | two each way down the corridor between the two wings | each crosses the corridor centre line (≤ 1.2 m) |
| 2022 | courtyard centre → out through each corner passage (gap = closest points of neighbouring building hulls) | each passes its corner gap (≤ 1.2 m) |
| 2023 | Chiba frontage ↔ kitchen across the trailer circle, round Chiba | — |
| 2024 | both ways along the frontage (PV west, glazing east), round the back, down to the kitchen | frontage walkers pass in front of the central stairs (≤ 1.5 m) |
| 2025 | Chiba ↔ kitchen / secondary house / utility booths | — |
| 2026 | staging-east ↔ piles, round Chiba (±60 m crop) | — |

Browser numbers (headless Chromium, 2026-09-27): files 196–277 KB (2026: 960 KB), fetch ≤ 5 ms, parse ≤ 10 ms; build 86–118 ms
for 2020–2025 (0.63–1.30 M cells), 230 ms for the 2026 crop (1.44 M cells). All seven complete with zero violations.

`e2e/lab-years.spec.ts`: every year completes, zero violations, HUD build time > 0; for 2021/2022/2024 a deterministic replay with
captures at 40 % of the run: `lab-year-<y>-{top,top-prisms,top-grid,mid-oblique,mid-close,mid-close-prisms}.png` (mid-close = eye
level down the 2021 corridor, the 2022 south-west corner from outside, along the 2024 frontage); other years one
`lab-year-<y>-end-top-prisms.png`; timings in `lab-years.json`. Baselines: `lab-year-{2021,2022,2024}-top-prisms`.
Top-down views are perspective: roofs (≈ 5 m) appear up to ~1 m further out than the ≤ 1.8 m prisms near the frame edges.

Findings in the engine data (not fixed here; the scene files belong to `deploy/history-scenes.mjs`):
- **2022 south-west corner passage (kitchen / west-house) is closed at ground level.** The west-house table
  (`west-house-table-top-4ba6a452`, x −5.51…−4.71, z 3.33…6.33, top at 0.76 m) ends 1 cm short of the kitchen stair's rail post
  (`kitchen-stair-rail-post-1cef5828`, z 6.35), and its gap to the west-house wall line (x −6.27) is 0.76 m, which the 0.1 m
  conservative raster closes (< 0.34 m clearance). The table is in the studio render too, so the Kit scene itself obstructs the
  "four open corner passages". `w3` instead leaves south under the high end of the kitchen stair (x ≈ −1.4, z 6.4 → 10.8; treads
  ≥ 1.88 m are overhead by the band rule and the stair has no stringers), which is render-consistent but implausible.
  The spec asserts this check as a known failure (`KNOWN_BLOCKED`).
- **2023 and 2024: two trailers stand inside Chiba.** The trailer ring (`ring(k, …, cz 22, rz 24)`) puts 2023 `rv-8`, `rv-9` and
  2024 `rv-9`, `rv-10` inside the hall footprint (hidden under the roof in the render; tilted prisms under the roof in the
  overlay). No walking effect (the hall deck blocks anyway), but they are not historical.
- 2021: the corridor is open end to end and matches the render. The MARS letters (`walkNoCollision`) stand in front of the wings,
  not across the corridor; walkers could pass through the letters themselves (documented caveat).
- 2024: the frontage matches (raked cladding + both flared stairs block; the ground-level doorway under the landing is open);
  the sloped cladding is over-approximated by up to ~1.1 m at 2 m height (OBB of a sloped piece, documented).

## Performance (2026-09-27, M3 Max, headless Chromium + SwiftShader, 1280×800)
`performance.now()` resolution in the page is 0.1 ms, so p50 values are quantised.

| preset | humans | step mean | step p95 | step max | real-time fps | draw calls | triangles | violations |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| trio | 3 | 0.02 ms | 0.1 ms | 0.3 ms | 31 | 143 | 38k | 0 |
| stress-30 (60 s) | 30 | 0.83 ms | 0.6 ms | 202 ms | 10 | 727 | 355k | 0 |

<sub>Table from `viewer/e2e/artifacts/2026-09-27T17-05-55/lab-perf.json` (latest `npm run e2e -- --workers=1 -g "perf"` run, 2026-09-27 13:08).</sub>

- In node, stress-30 averages 1.3 ms per tick.
- The 200 ms spike is the tick where up to 30 walkers plan at once. Each A* on 600×600×2 cells costs 5–45 ms, and there is no planning budget per tick.
- Other replan spikes: the construction replan costs about 31 ms (grid rebuild + A*).
- Rendering is software GL, so fps here is CPU-bound. Draw calls are about 22 per person (meshes × shadow pass). A real GPU will be far faster.
- Walk-clip ground speed at 1.75 m: woman 0.955 m/s, casual 1.19 m/s. Walk timeScale = ground speed / clip speed (minimum 0.35).

## Known limitations (honest)
- **Social poses**: only Idle/Walk clips exist. `sit` is a procedural pose (lowered body, leg IK, hands on thighs, about half the people with legs crossed); the sit-down is a 0.4 s blend (a crouch into the seat), not a clip. `warm` only adds hands held out; `talk` / `watch` / `listen` are the plain Idle pose (no gestures, no head look-at). Seated torsos are upright and do not touch the chair back; there is no body-vs-chair collision, so thighs can clip an armrest.
- **Stairs**: tread-by-tread foot IK on `stairs` links (POSES.md; feet within 0.0 cm of the tread tops at every plant in `stairs.spec.ts`). Frame climbing (`climb` links) plays Idle while the body rises; beam walking plays the flat Walk clip.
- **Stair ends (engine)**: fixed — traversal is continuous entry → steps → exit; `motion.teleport` (0.6 m/tick) guards it.
- **Turning in place** plays Idle (activity is `idle` during `turn`).
- **Route overlay** reads Runtime's private `live` map (`sim.ts liveRoutes`). An engine inspect API should replace it.
- **Construction** mutates the world between ticks (as `walk.test.ts` does), not through an install action.
- **Build-bay people**: only Idle/Walk clips are used (Wave is unused); carry/hold/lift/hand-up are Idle or Walk plus the
  posture layer (crouch / hip bend / heel raise, POSES.md) and arm IK. The rig's arm (0.44–0.50 m) is much shorter than the
  engine's reach envelope (0.75 m): many hand-up points are out of reach and those arms hang (POSES.md "Reach gap"). Hand points now come from the engine's grip slot (`lift-far`, `foot-*`, `hold-N`, `lift-end/edge/corner-*`); a point beyond ~1.25 arm lengths is honestly left unreached.
- **Raise (engine model)**: lifters walk the rising end up (hands ≤ 1.9 m, ≤ 0.6 m/s) while footers stand at the base;
  the footers crouch and put their hands on the column base (posture layer); the lifter's far arm can be out of reach.
- Lifts are swept with a lift-over fallback (PROGRESSIVE.md) and the crew walks with the part; parts no longer pass through beams.
