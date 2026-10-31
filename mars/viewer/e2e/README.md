# Browser e2e and visual capture

Playwright drives headless Chromium against a fresh Vite dev server, loads studio years and Lab scenarios, checks for
console and page errors, asserts engine state through test hooks, and compares screenshots with reference baselines using
a tolerant pixel diff.

## Commands (from `mars/viewer/`, or `pnpm --filter mars-campus-viewer <script>` from the repo root)

```sh
npm run e2e:install           # Chromium into viewer/.pw-browsers (gitignored)
npm run e2e                   # run the suite, compare with baselines
npm run e2e -- -g 2024        # only tests whose title matches
npm run e2e:update-baselines  # re-capture and overwrite e2e/baselines/*.png
E2E_SIMULATION=1 npm run e2e  # also start the local simulation Worker (wrangler dev)
```

The config starts `vite --port 5391` (`E2E_VITE_PORT`) and never reuses a running server; `E2E_SIMULATION=1` adds the
Durable Object server on `MARS_SIMULATION_PORT` (default 8897). One worker, 120 s per test, 15 s per expectation.

**WebGL.** Chromium runs with `--use-angle=swiftshader --enable-unsafe-swiftshader`: software WebGL, no GPU needed, pixels
nearly deterministic across machines. `expectCanvasNotBlank` fails on a single flat colour. If `e2e:install` fails on a flaky
network, download the Chrome Headless Shell and ffmpeg zips from the URLs `npx playwright install --dry-run chromium`
prints, unpack them under `.pw-browsers/<name>-<rev>/` and touch `INSTALLATION_COMPLETE` in each.

## Readiness hooks

- `window.__marsStudio` (`app/studio/page.tsx`): `year`, `frames`, `ready` (≥ 3 frames after the scene is in), `info()`
  (renderer info), `look(position, target)`, plus take-replay and camera hooks ([studio-replay.md](../../../docs/mars/studio-replay.md)).
  `waitReady` waits for `ready`, the first adaptive pixel-ratio check and the end of "Loading…"; no fixed sleeps.
  Contexts use `reducedMotion: 'reduce'`, which keeps ambient campus life off for stable frames.
- `window.__marsEngine` (`app/lab/hook.ts`): scenario loading, fixed stepping and detached readouts
  ([lab.md](../../../docs/mars/lab.md#test-hook-window__marsengine)).

## Artifacts

```
e2e/baselines/<name>.png              reference images
e2e/artifacts/<run>/<name>.png        this run's captures (gitignored)
e2e/artifacts/<run>/<name>.diff.png   pixelmatch diff, only when pixels differ
e2e/artifacts/<run>/*.json            perf snapshots and per-spec reports
e2e/artifacts/<run>/video/<name>/     .webm from recordVideo()
test-results/                         Playwright traces of failed tests (gitignored)
```

`<run>` is a UTC timestamp, or `E2E_RUN=<name>`. The diff tolerance is `DIFF` in `helpers.ts`: per-pixel YIQ threshold 0.2,
at most 1.5 % of pixels differing, at 1280×800 with deviceScaleFactor 1.

## What the specs cover

- `studio-years.spec.ts`: every studio year loads, renders, switches to plan view and logs no errors; a perf snapshot.
- `lab*.spec.ts` and the per-activity specs: each scenario runs to its expectations with zero violations and a
  deterministic replay; captures at key moments. `lab-build-bay.spec.ts` and `year-build.spec.ts` assert that live stepping
  ends on the Node rehearsal's tick and state hash.
- `selectable-scenarios-audit.spec.ts`: fresh load, Reset and first Step for every selectable preset. It is not
  completion evidence.
- `stairs`, `poses`, `prone`, `meal` specs: renderer pose checks against engine hand points and treads ([poses.md](../../../docs/mars/poses.md)).
- `studio-take`, `studio-build`, `studio-direct*`, `camera-verify` specs: take replay, chapter sets, camera direction and
  render-side verification ([camera-direction.md](../../../docs/mars/camera-direction.md#render-side-verification)).
- `alpha-*.spec.ts`: control quarantine, liveness, discovery and manual Play across presets.

Whole-house build runs are opt-in: `YEAR_BUILD_FULL=1 npm run e2e -- year-build.spec.ts`.

## Adding a scenario

```ts
import { test, expect } from '@playwright/test';
import { openStudio, lookAt, captureView, collectConsoleErrors, waitFrames } from './helpers';

test('2023 kitchen from the trailer circle', async ({ page }, testInfo) => {
  const errors = collectConsoleErrors(page);          // before navigation
  await openStudio(page, 2023);                       // goto + waitReady
  await lookAt(page, [0, 8, 60], [0, 2, 43]);
  await waitFrames(page, 3);
  await captureView(page, 'studio-2023-kitchen', { testInfo });  // compares with baselines/
  expect(errors).toEqual([]);
});
```

Run `npm run e2e:update-baselines -- -g kitchen` once, look at the new baseline and commit it. Pass `{ compare: false }` to
`captureView` for exploratory shots. `recordVideo(browser, name)` returns a recording context (see its docblock).

## Rules

- Serialize browser and performance runs; use isolated ports and a fresh `E2E_RUN`, and keep failed traces before another
  run overwrites `test-results/`.
- Update baselines only for an explained, intended visual change, after inspecting the new captures.
- Skipped, `test.fixme` and `test.fail` cases count as unproved, never as passing evidence.
