# Engine Lab (`/lab`)

The deterministic engine running live in the browser. Run `pnpm --filter mars-campus-viewer dev`, then open
`/lab` (for example `/lab?scenario=stairs`). Code: `mars/viewer/app/lab/`; renderer adapters in
`mars/viewer/app/engine-view/`. Contributor rules: [engine-guide.md](engine-guide.md).

## Use

- **Scenario picker** loads a fresh world. Play advances the authoritative 20 Hz simulation; Step advances one fixed tick;
  Pause freezes the whole world; Reset replaces the run, including retained intentions and object state. Speed changes
  playback rate, not the timestep (fixed-DT accumulator, bounded ticks per frame).
- Scripted movement and construction presets start through Play; manually started activity presets have their own
  Start control. Expectations show until satisfied: a red "still running" or unfinished-step check during execution is a
  pending outcome, not a violation.
- **Interventions.** Individual Pause/Interrupt requests safe physical cleanup while others continue; keep Play running
  until cleanup finishes; Resume is explicit. Director and player commands use the same admission, claims, support and
  execution; a refusal names the resource or geometry. End requests ordinary cleanup, keeps partial effects and never
  claims an unfinished purpose completed. There is no active save/load or reload restoration.
- **Failures are loud**: a red banner per failed action with its diagnostic, banners for violations, red log lines. A
  named invariant or executor-fault banner quarantines the world: inspection and camera stay available, everything else
  waits for a fresh Reset ([engine-guide.md](engine-guide.md#failure-model-and-world-liveness)).
- **Overlays** (off by default): clearance heatmap, traffic components, routes and corridors, actor and obstacle
  footprints, obstacle prisms by kind, stair links (green usable, red unusable), interaction slots (free, claimed,
  occupied), labels, violation markers.

## Scenario families

Each selectable preset has a contract (group, start controls, terminal effects, limits, test references) in
`mars/viewer/deploy/scenario-coverage.json`; the panel shows the generated text (`app/lab/scenario-contracts.ts`).
Groups:

| Group | Examples |
| --- | --- |
| Longer connected experiences | `living-day-4`, `living-day-studio`, `prepared-day-*`, `work-break-*`, `communal-supper`, `room-preparation`, `garden-circuit`, `garden-afternoon`, `creative-afternoon`, `computer-workshop`, `design-studio` |
| Individual and shared activities | `classroom-4`, `classroom-8`, `quiet-reading`, `reading-circle`, `library-reading`, `computer-music`, `music-dance`, `open-jam`, `drawing-work`, `art-sharing`, `gallery-tour`, `group-warmup`, `garden-care`, `seed-planting`, `table-cleanup`, `tabletop-chess`, `cold-preparation`, `ground-sleep` |
| Continuous simulations | `stress-30` (declares `execution: 'sustained'`) |
| Automatically started journeys | `wall`, `u-trap`, `narrow-passage`, `stairs`, `deck-to-ground`, `construction`, `trio`, `build-bay`, `hand-up`, `prone`, `prone-forks`, `meal`, `campfire-evening`, `solar-paint`, `year-2020` … `year-2026` walkabouts |
| Manual renderer probes | `body` (reach measurement) |
| Intentional diagnostic demonstrations | `incomplete-stairs` (refuses with `route.link-unusable`) |
| Construction journeys | `year-build-2022`, `year-build-2022-house` |
| Snapshots of persistent places | `eden-camp-snapshot` and the other world snapshots |

All staging and participants are hypothetical. Objects keep identity, support and ownership; a visible prop alone is not a
capability. Bindings are bounded authored choices, not arbitrary people, autonomous needs or a universal planner.

**Year walkabouts** load the generated obstacle scene of a year ([campus-scene.md](campus-scene.md)) over the studio's
rendering of the same year, with walkers between named spots; turn on the prism and clearance overlays to see where the
engine data and the render disagree.

## Camera and sound

The live camera reads actual people, objects and phase facts and never moves actors or owns their tasks. Choose Clear
activity coverage or Restrained observation. Following a person takes operator precedence; dragging the view takes
temporary control, which expires after six simulation seconds (the clock does not advance while paused); Escape or
Return camera to auto releases it. Sound needs a browser gesture; Pause, Reset and disposed sessions silence it.

## Modules

| File | Role |
| --- | --- |
| `scenarios.ts`, family modules (`*-hud.tsx`, `living-day.ts`, `classroom.ts`, …) | Presets and their HUD controls |
| `sim.ts` | `LabSim`: Runtime, fixed-DT accumulator, script result vs world stepping, quarantine, step-cost stats, event log |
| `hook.ts` | `window.__marsEngine` and `fenceLabControls` |
| `lab-view.ts`, `page.tsx`, `panel.tsx` | Renderer and loop, UI |
| `scene.ts`, `overlay-*.ts` | Ground, walls and stairs from the `SpatialScene`; debug overlays |
| `build-bay.ts`, `hand-up.ts`, `year-build.ts` | Sequence presets stepped live (`bindTemplate` → `SequenceRunner`), ending on the Node rehearsal's tick and state hash |
| `year-walkabout.ts`, `year-walkabout-view.ts` | Year scenes: fetch `campus-<year>.json`, build `Spatial` in the browser, studio geometry as backdrop |
| `../engine-view/` | People, rig, pose layers, components, fixtures, items, paint, fire ([poses.md](poses.md)) |

## Test hook `window.__marsEngine`

`ready`, `frames`, `error`, `scenarios()`, `runScenario(name, { paused, speed })`, `step(n)`, `runToEnd(max)`,
`runUntilSteps(ids)`, `pause(on)`, `setSpeed(x)`, `state()`, `violations()`, `records()`, `log()`, `stateHash()`,
`setOverlay(name, on)`, `overlays()`, `camera(pos, target)`, `cameraPreset('top'|'oblique')`, `info()`, `perf()`,
`scenarioHud()`, `sequence()`, `slots()`, `social()`, `stacks()`, `paints()`, `yearBuild()`, plus activity readouts and
camera facts. `step(n)` ticks on past `done`; `runToEnd()` and `runUntilSteps()` stop there. While quarantined,
non-allowlisted methods refuse with `lab.control-quarantined`. Programmatic stepping does not establish natural rendering
or Play timing.

Browser coverage: `e2e/lab*.spec.ts`, the per-activity specs, `selectable-scenarios-audit.spec.ts` (fresh load, Reset and
first Step for every preset; not completion evidence), `year-build.spec.ts` ([`mars/viewer/e2e/README.md`](../../mars/viewer/e2e/README.md)).

## Limitations

- Only Idle and Walk clips exist; sitting, carrying, kneeling and prone poses are procedural layers with arm IK.
  `talk`, `watch` and `listen` are the standing Idle pose (no gestures or gaze).
- Turning in place plays Idle.
- The route overlay reads the Runtime's private live map; an inspection API should replace it.
- The `construction` preset mutates the world between ticks (as `walk.test.ts` does), not through an install action.
