# Engine Lab (`/lab`)

The deterministic engine (`viewer/engine/`) running live in the browser over the
proving ground (`engine/scenes/proving-ground.ts`). It renders with the studio's
animated people (Quaternius CC0 `animated-{casual,punk,woman}.glb`, clips Idle/Walk).
Dev only for now: `npm run dev` → `http://127.0.0.1:5173/lab?scenario=stairs`.
The production Worker (`deploy/configure.mjs`) does not route `/lab` yet.

## Modules
| file | role |
| --- | --- |
| `scenarios.ts` | presets, pure TS (node can run them): wall, u-trap, narrow-passage, stairs, deck-to-ground, incomplete-stairs, construction, trio, stress-30, build-bay, campfire-evening |
| `build-bay.ts` | flagship "build a rack bay" preset: world/registry/invariants/contributors of `engine/scenarios/build-bay.ts` on the test's open ground, `bindTemplate` → `SequenceRunner` stepped live (`advance()` once, then per tick `rt.step()` → `poll()` → `advance()`, exactly `run()`'s loop) |
| `../engine-view/components.ts` | one persistent object per world component, pose interpolated between ticks; Euler(pitch, −yaw, roll, 'YXZ') = engine `entityCorners` order; uprights as braced two-column frames, stair flights as two stringers (treads are their own entities), everything else a catalog-coloured box; `nearestPoint` for hand placement |
| `campfire-evening.ts` | HYPOTHETICAL inhabited scene (milestone H, `engine/social`): campfire + 2 benches + 3 camp chairs south-west of the proving ground's test zones, 14 people, a timed script of direct submits (gather, converse, sit, ambient_wander; stand + take_slot at 40 s; last place at 42 s; full-circle `slot.none-free` + `reservation.conflict` at 50 s as EXPECTED diagnostics; bench at 51 s; `releaseForDirective` + `walk_to` at 54 s); runs 75 s, dusk lighting |
| `social-hud.tsx`, `overlay-slots.ts` | social HUD (script status, slot occupancy, Idle-clip legend) and the **Interaction slots** overlay (green free · amber claimed · orange occupied, tick = heading) |
| `../engine-view/fixtures.ts` | `kind: 'fixture'` meshes: bench, camp chair (seat faces local +z), campfire (stones, logs, flame; warm point light at dusk) |
| `sequence-hud.tsx` | sequence HUD on the canvas (active steps + phase, BLOCKED waits with code/message, last diagnostics) and the panel's step-chip timeline |
| `sim.ts` | `LabSim`: builds `Runtime` (Spatial + walk_to + `DEFAULT_INVARIANTS`), fixed-DT accumulator, step cost stats, event log, replan detection |
| `scene.ts` | ground, walls/solids as boxes from the `SpatialScene`, stairs from `link.path` (missing treads left out), component boxes |
| `../engine-view/people.ts` | template loading copied minimally from `studio/campus-life.ts` (scale 1.75 m, feet at y=0); Walk-clip ground speed measured from the stance foot |
| `../engine-view/humans.ts` | engine pose → rig (`rotation.y = -yaw`). Clip weights/phase advance per tick; frames interpolate the last two ticks. Walk whenever the person translates (walk, climb, carry on the move, gathering), Idle otherwise (support/hold, lift, set-down, waiting). People with a `grip` get two-bone arm IK onto the nearest point of the gripped part, only within reach (fades out beyond 1.1–1.8× arm length; reach clamped to 0.97 of the arm, 0.88 when carrying so elbows stay bent; no stretching), plus a ≤ 13° forward lean and a ±2.5 cm shoulder raise/drop toward it, both scaled by contact. Procedural layers on the Idle clip (restored before each mixer apply so nothing accumulates): `sit` / `sit-down` / `stand-up` lower the body onto the seat (hips 0.09 m above the seat surface from `fixtures.ts seatHeight`, 0.45 m default), thighs forward, feet to the ground by leg IK, hands on thighs, blended over 0.4 s; `warm` holds the forearms out toward the fire when its edge is within 1.2 m. Deterministic (variation seeded by id) |
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
`ready`, `frames`, `error`, `scenarios()`, `runScenario(name, {paused=true, speed})`, `step(n)`, `runToEnd(max)`,
`pause(on)`, `setSpeed(x)`, `state()` (humans, checks, stats), `violations()`, `records()`, `log()`,
`setOverlay(name, on)`, `overlays()`, `camera(pos, target)`, `cameraPreset('top'|'oblique')`, `info()`, `perf()`,
`sequence()` (step rows + blocked/failed/violation log), `slots()` (interaction slots with claim/occupant), `social()` (fired script events + expected diagnostics), `runUntilSteps(ids, status='completed', max)`, `components()`
(pose, phase, support, engine corners, rendered bounds), `stateHash()`.

`e2e/lab.spec.ts` covers:
- Each scenario: run to completion, check expectations, zero violations, a visible failure banner when a failure is expected, and an identical deterministic replay.
- Captures: top/oblique × overlays off/on, mid-action and at the end.
- Stair geometry checks, and a `test.fail` known engine issue (below).
- Real-time videos: narrow-passage and stairs.
- Perf.

Baselines: `lab-stairs-mid-oblique`, `lab-narrow-passage-mid-top-debug`.

`e2e/lab-social.spec.ts` covers campfire-evening: all expectations, zero violations, the arrangement at 20 s and 60 s (fire circle on the 1.6 m ring facing the fire, sitters on claimed seats facing the seat heading, c1/c2 facing each other, no two people closer than 2r), the two EXPECTED conflict banners and no FAILED banner, deterministic replay. Captures `lab-social-t{20,60}-{oblique,top}[-debug].png` (debug = agents, labels, slots, routes) and close-ups `lab-social-t60-close-{pair,circle,chairs,chairs-top}.png`. Baselines: `lab-social-t20-oblique`, `lab-social-t60-top-debug`.

`e2e/lab-build-bay.spec.ts` covers the flagship sequence: completes, zero violations, final state hash equal to the node
rehearsal (`engine/rehearsal/rehearse.ts`) — so live stepping is the rehearsal — geometry sanity from engine corners
(beams between the columns, joists on the upper beams, ply on the joists, stair top at deck height and at the deck edge,
visitor on the ply) and rendered bounds within the engine boxes; every blocked step appears in the diagnostics log.
Captures (oblique + top): `build-bay-{carry,raise,held,beams,joists,deck,stair,visitor}-*.png`, video
`build-bay-raise-beams-2x.webm` (raise + beams at 2×). Baselines: `build-bay-raise-oblique` (A at about 45°: lifter walking the frame up, footer at the base), `build-bay-held-oblique`, `build-bay-visitor-oblique`.

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
- **Social poses**: only Idle/Walk clips exist. `sit` is a procedural pose (lowered body, leg IK, hands on thighs); the sit-down is a 0.4 s blend (a crouch into the seat), not a clip. `warm` only adds hands held out; `talk` / `watch` / `listen` are the plain Idle pose (no gestures, no head look-at). Seated torsos are upright and do not touch the chair back; there is no body-vs-chair collision, so thighs can clip an armrest.
- **Stairs**: the flat-ground Walk clip plays along the stair line. Feet sink or hover by up to half a riser (≈ 0.09 m) between treads. No foot IK.
- **Stair ends (engine)**: there is a 0.40–0.47 m horizontal teleport at both ends of every traversal (see report).
- **Turning in place** plays Idle (activity is `idle` during `turn`).
- **Route overlay** reads Runtime's private `live` map (`sim.ts liveRoutes`). An engine inspect API should replace it.
- **Construction** mutates the world between ticks (as `walk.test.ts` does), not through an install action.
- **Build-bay people**: only Idle/Walk clips are used (Wave is unused); carry/hold/lift are Idle or Walk plus arm IK, a
  slight forward lean and a shoulder shrug toward the part; bodies do not crouch or lift, and legs are never adjusted. The IK picks the nearest point of the gripped part per arm, not the engine's grip slot.
- **Raise (engine model)**: the raise crew stands at its final hold stations beside the frame's base for the whole raise;
  nobody is at the rising end, so mid-raise their hands are (honestly) out of reach and the frame visibly rotates up on its own.
- Lifts are interpolated (PROGRESSIVE.md), so a joist/sheet may pass through a beam while being lifted.
