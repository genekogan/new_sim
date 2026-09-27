# Engine Lab (`/lab`)

The deterministic engine (`viewer/engine/`) running live in the browser over the
proving ground (`engine/scenes/proving-ground.ts`). It renders with the studio's
animated people (Quaternius CC0 `animated-{casual,punk,woman}.glb`, clips Idle/Walk).
Dev only for now: `npm run dev` → `http://127.0.0.1:5173/lab?scenario=stairs`.
The production Worker (`deploy/configure.mjs`) does not route `/lab` yet.

## Modules
| file | role |
| --- | --- |
| `scenarios.ts` | presets, pure TS (node can run them): wall, u-trap, narrow-passage, stairs, deck-to-ground, incomplete-stairs, construction, trio, stress-30 |
| `sim.ts` | `LabSim`: builds `Runtime` (Spatial + walk_to + `DEFAULT_INVARIANTS`), fixed-DT accumulator, step cost stats, event log, replan detection |
| `scene.ts` | ground, walls/solids as boxes from the `SpatialScene`, stairs from `link.path` (missing treads left out), component boxes |
| `people.ts` | template loading copied minimally from `studio/campus-life.ts` (scale 1.75 m, feet at y=0); Walk-clip ground speed measured from the stance foot |
| `humans.ts` | engine pose → rig (`rotation.y = -yaw`). Clip weights/phase advance per tick; frames interpolate the last two ticks |
| `overlay-*.ts` | clearance heatmap, traffic components, routes/corridors, discs/facing, obstacle prisms, stair links, labels, violation markers |
| `lab-view.ts`, `page.tsx`, `panel.tsx`, `hook.ts` | renderer + loop, UI, `window.__marsEngine` |

## Use
- **Scenario picker** reloads a fresh world. Transport: Play/Pause, Step (one tick), Reset, speed 0.25–8×.
  Simulation time is decoupled from fps (accumulator, ≤ 40 ticks per frame).
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
`setOverlay(name, on)`, `overlays()`, `camera(pos, target)`, `cameraPreset('top'|'oblique')`, `info()`, `perf()`.

`e2e/lab.spec.ts` covers:
- Each scenario: run to completion, check expectations, zero violations, a visible failure banner when a failure is expected, and an identical deterministic replay.
- Captures: top/oblique × overlays off/on, mid-action and at the end.
- Stair geometry checks, and a `test.fail` known engine issue (below).
- Real-time videos: narrow-passage and stairs.
- Perf.

Baselines: `lab-stairs-mid-oblique`, `lab-narrow-passage-mid-top-debug`.

## Performance (2026-09-27, M3 Max, headless Chromium + SwiftShader, 1280×800)
`performance.now()` resolution in the page is 0.1 ms, so p50 values are quantised.

| preset | humans | step mean | step p95 | step max | real-time fps | draw calls | triangles | violations |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| trio | 3 | 0.02 ms | 0.1 ms | 0.3 ms | 29 | 143 | 38k | 0 |
| stress-30 (60 s) | 30 | 1.24 ms | 3.2 ms | 207 ms | 10 | 727 | 355k | 879 |

- In node, stress-30 averages 1.3 ms per tick.
- The 200 ms spike is the tick where up to 30 walkers plan at once. Each A* on 600×600×2 cells costs 5–45 ms, and there is no planning budget per tick.
- Other replan spikes: the construction replan costs about 31 ms (grid rebuild + A*).
- Rendering is software GL, so fps here is CPU-bound. Draw calls are about 22 per person (meshes × shadow pass). A real GPU will be far faster.
- Walk-clip ground speed at 1.75 m: woman 0.955 m/s, casual 1.19 m/s. Walk timeScale = ground speed / clip speed (minimum 0.35).

## Known limitations (honest)
- **Stairs**: the flat-ground Walk clip plays along the stair line. Feet sink or hover by up to half a riser (≈ 0.09 m) between treads. No foot IK.
- **Stair ends (engine)**: there is a 0.40–0.47 m horizontal teleport at both ends of every traversal (see report).
- **Turning in place** plays Idle (activity is `idle` during `turn`).
- **Route overlay** reads Runtime's private `live` map (`sim.ts liveRoutes`). An engine inspect API should replace it.
- **Construction** mutates the world between ticks (as `walk.test.ts` does), not through an install action.
