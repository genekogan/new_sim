# Mars Studio browser e2e + visual capture

Playwright drives headless Chromium against the Vite dev server, loads each
studio year, checks that there are no console or page errors, and compares
screenshots against committed baselines using a tolerant pixel diff. The same
helpers are meant for future engine scenarios.

## Commands (from `viewer/`)

```sh
npm install                   # installs @playwright/test, pixelmatch, pngjs
npm run e2e:install           # Chromium -> viewer/.pw-browsers (never ~/Library)
npm run e2e                   # run the suite, compare with baselines
npm run e2e:update-baselines  # re-capture and overwrite e2e/baselines/*.png
npm run e2e -- -g 2024        # only tests whose title matches
E2E_SIMULATION=1 npm run e2e  # also start the local simulation (wrangler)
```

The config starts `vite --port 5391` (override with `E2E_VITE_PORT`) and shuts
it down when the run ends. It never reuses a running server. The studio calls
`/api/simulation` only after you join a room, so the simulation Worker is off by
default. `E2E_SIMULATION=1` adds `wrangler dev --config simulation/wrangler.jsonc`
on `MARS_SIMULATION_PORT` (default 8897; Vite proxies to the same port).

### Browsers

The npm scripts set `PLAYWRIGHT_BROWSERS_PATH=.pw-browsers` (gitignored). The
config sets the same default if you call `npx playwright` directly. Headless
runs use *Chrome Headless Shell*, and video recording needs *ffmpeg*.

If `npm run e2e:install` keeps failing on a flaky network (the zip download has
no resume), fetch the zips with resumable curl and unpack them yourself. Get
the URLs from `npx playwright install --dry-run chromium`, then:

```sh
curl -L -C - --retry 10 --retry-all-errors -o shell.zip <chrome-headless-shell url>
curl -L -C - --retry 10 --retry-all-errors -o ffmpeg.zip <ffmpeg url>
mkdir -p .pw-browsers/chromium_headless_shell-<rev> .pw-browsers/ffmpeg-<rev>
unzip -q shell.zip -d .pw-browsers/chromium_headless_shell-<rev>
unzip -q ffmpeg.zip -d .pw-browsers/ffmpeg-<rev>
touch .pw-browsers/chromium_headless_shell-<rev>/INSTALLATION_COMPLETE .pw-browsers/ffmpeg-<rev>/INSTALLATION_COMPLETE
```

### WebGL

Chromium launches with `--use-angle=swiftshader --enable-unsafe-swiftshader`.
That is software WebGL: no GPU is needed, and pixels are nearly deterministic
across machines. `expectCanvasNotBlank` fails when the canvas renders as a
single flat colour.

## Readiness: `window.__marsStudio`

`app/studio/page.tsx` installs a tiny test hook (about 15 lines, removed on
unmount):

| field | meaning |
| --- | --- |
| `year` | year the studio was mounted with |
| `frames` | frames rendered since the campus scene was added (0 while loading) |
| `ready` | `frames >= 3`: the model or historical scene is in, and frames are drawn |
| `info()` | `renderer.info.render` + `renderer.info.memory` + `pixelRatio` |
| `look(position, target)` | set the orbit camera (scene metres) |

`waitReady` waits for `ready`, then for the first adaptive pixel-ratio check
(the canvas `data-pixel-ratio` attribute appears after the first 5 s budget
window). Screenshots are therefore taken at the final render resolution. It
then waits a few more frames and checks that the "Loading…" status is gone. No
fixed sleeps are used. Contexts run with `reducedMotion: 'reduce'`, which the
studio already honours by starting with campus life (walkers, breeze, dust)
off. Frames stay still enough for pixel diffs.

## Artifacts

```
e2e/baselines/<name>.png              committed reference images
e2e/artifacts/<run>/<name>.png        this run's captures (gitignored)
e2e/artifacts/<run>/<name>.diff.png   pixelmatch diff, only written when pixels differ
e2e/artifacts/<run>/perf.json         renderer.info + JS heap per year
e2e/artifacts/<run>/video/<name>/     .webm from recordVideo()
test-results/                         Playwright traces for failed tests (gitignored)
```

`<run>` is a UTC timestamp (`2026-09-27T09-12-00`), or `E2E_RUN=name` to choose
it. Names follow the pattern `studio[-YYYY]-<view>`, for example
`studio-default`, `studio-2024-plan` and `studio-2022-courtyard`.

The diff tolerance lives in `helpers.ts` (`DIFF`): per-pixel YIQ threshold 0.2,
and at most 1.5 % of pixels may differ. Baselines are captured at 1280×800 with
deviceScaleFactor 1 and SwiftShader. Re-baseline after any intended visual
change, and review the new PNGs before committing them.

## Replay take (`studio-take.spec.ts`)

Opens `/studio`, selects the flagship campus take from `public/engine/takes/manifest.json` (regenerate with
`node deploy/record-campus-take.mjs`), scrubs to the manifest's four moments (first carry, both frames held, deck
installed, visitor on the deck) with the engine camera on, then turns it off and frames a user camera. It asserts the
sampled entity count and the final-state hash against the manifest, identical entity poses with either camera, the
HYPOTHETICAL banner, and no console errors. Captures `studio-take-{carry,held,deck,visitor,user-camera}.png`; baselines
`studio-take-held`, `studio-take-visitor`. `window.__marsStudio.take()` returns the replay readout (null when closed).

## Watch it being built, direct camera (`studio-build.spec.ts`, `studio-direct.spec.ts`)

See `docs/engineering/STUDIO_REPLAY.md`.

- **`studio-build.spec.ts`** runs once per year-build take of the manifest (2022: the first bay and the whole skeleton;
  W24). Each run:
  - opens `/studio/<year>` and picks the take from **Watch it being built**;
  - checks the hash (replayed = recorded = manifest), the datum offset (year file `groundY` − take `site.groundY`) and
    that the rebuilt building is hidden;
  - plays at 64×;
  - scrubs to the yard (t 0.5 s), the half-way skeleton and the final frame, capturing `studio-build-<take>-{yard,mid,final}.png` (`<take>` = `east-house-bay1`, `east-house`)
    (no baselines, because W17 regenerates the take);
  - checks the take log and the final-frame checks (✓ n / n frames + beams at the canonical pose);
  - compares rendered palms with recorded hand points at 12 hand-up moments (median < 5 cm; measured < 0.5 mm).
  A second test per take plays it at 64× for 10 s and writes the frame intervals and the replay's redraw cost to
  `studio-build-perf.json` (STUDIO_REPLAY.md §6).
  Per chapter set (W37 / W48, STUDIO_REPLAY.md "Chapter sets"): the walk through the set
  (`studio-build-set-{yard,roof-relay,stair,walls,final}.png`, `studio-build-set.json`); 64× across the A → D0 seam
  (`studio-build-set-perf.json`); the **shot hold** at 64× for 60 s, planned camera against the hold (shots on screen,
  on-screen time, the chain = the rule's; `studio-build-set-hold.json`, `studio-build-set-hold-held.png`); the **leg
  phase at the A → D0 and D0 → D1 seams** (≤ 0.1 carried, the W37 restart reported; `studio-build-set-gait.json`); and
  **Direct camera** on chapter D2 (a hold on a crew member → shot list, play, save into D2's file;
  `studio-build-set-direct-{panel,hold}.png`, `studio-build-set-direct.json`).
- **`studio-direct.spec.ts`**, on the flagship take:
  - the direction form writes the typed JSON;
  - **Compute camera** shows the shot list with `foreground → raise`;
  - **Play directed track** drives the engine camera with the take hash and poses unchanged;
  - an unknown group is refused.

  Captures `studio-direct-{shots,playing}.png`.
- **`studio-direct-sentences.spec.ts`** (W48), on the flagship take: Gene's four sentences through the panel's **Say it**
  box (three appended as CAMERA_DIRECT.md §1's objects, the deictic one refused with its question); an ambiguous word
  with its candidates; "… then …" appending two; the 270° rack-bay orbit sentence computed and played. Captures
  `studio-direct-sentences-{refused,orbit}.png`, report `studio-direct-sentences.json`. The "save track" test (W24) saves the directed track into the take
  file (a download), serves it back in place of the shipped file, picks it from the **Camera** picker and verifies it by
  file id; captures `studio-direct-file-track.png`.
- **`lab.spec.ts`** "Oblique yard" (W24): the year-build preset's yard view equals the whole-skeleton take's first
  camera sample; captures `lab-year-build-oblique-yard.png`.
- **`camera-verify.spec.ts`**, test "directed tracks", uses `verifyCamera { track }` on the flagship bay orbit, the
  corrected hold, the Chiba sunset pan (take-less) and the 2024 kitchen move (take-less, `/studio/2024`). It writes
  `camera-verify-directed.json` plus a capture of each track's worst sample.

## Tests (`studio-years.spec.ts`)

- For `/studio` and `/studio/2020` … `/studio/2025`: load, wait until ready,
  check the canvas is not blank, capture the default camera, click
  **Plan view ↑**, capture the plan view, and assert no console, page or
  request errors.
- Framed views of the photographic corrections: `studio-2021-corridor-aluminet`,
  `studio-2022-courtyard` and `studio-2024-frontage`.
- Perf snapshot: opens every year in one page and writes `perf.json`.

## Adding a scenario

```ts
import { test, expect } from '@playwright/test';
import { openStudio, lookAt, captureView, collectConsoleErrors, waitFrames } from './helpers';

test('2023 kitchen from the trailer circle', async ({ page }, testInfo) => {
  const errors = collectConsoleErrors(page);          // before navigation
  await openStudio(page, 2023);                       // goto + waitReady
  await lookAt(page, [0, 8, 60], [0, 2, 43]);         // or click real UI buttons
  await page.getByRole('button', { name: 'Show grid' }).click();
  await waitFrames(page, 3);
  await captureView(page, 'studio-2023-kitchen', { testInfo });  // compares with baselines/
  expect(errors).toEqual([]);
});
```

Then run `npm run e2e:update-baselines -- -g kitchen` once, look at
`e2e/baselines/studio-2023-kitchen.png`, and commit it. Pass
`{ compare: false }` to `captureView` for exploratory shots that have no
baseline.

Video: `recordVideo(browser, 'walk-tour')` returns a recording context. Its
docblock in `helpers.ts` has a full walk-mode example. The `.webm` is written
when the context closes.

## Perf snapshot

`perf.json` records, per year, `window.__marsStudio.info()` (the three.js
`renderer.info` for the last frame at the default camera) and the Chromium
`performance.memory` heap. Chromium runs with `--enable-precise-memory-info`;
without that flag the heap figures are coarse and stale. Run of 2026-09-27,
1280×800, SwiftShader, M-series Mac:

| route | load ms* | draw calls | triangles | geometries | textures | JS heap MB† |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| /studio (2026) | 8756 | 1083 | 957,420 | 1296 | 390 | 329 |
| /studio/2020 | 7362 | 128 | 17,298 | 104 | 19 | 353 |
| /studio/2021 | 5880 | 95 | 23,096 | 116 | 13 | 402 |
| /studio/2022 | 5794 | 57 | 12,030 | 126 | 13 | 82 |
| /studio/2023 | 5810 | 76 | 16,196 | 141 | 12 | 64 |
| /studio/2024 | 5838 | 117 | 17,144 | 155 | 18 | 74 |
| /studio/2025 | 5873 | 65 | 17,646 | 136 | 11 | 111 |

\* From `goto` to `waitReady`. About 5 s of that is the fixed pixel-ratio
budget window that `waitReady` waits for, so the model/scene load itself is
roughly load − 5 s. The 70 MB 2026 GLB comes from the local disk.
† Used heap at snapshot time, without a forced GC. All years are opened in one
page, in order, so 2020 and 2021 still carry uncollected garbage from the 2026
model. Compare trends between runs, not absolute values. The adaptive loop
drops SwiftShader to `pixelRatio` 0.8 on every route, because software GL
renders under 30 fps. On a real GPU, draw calls and triangles are the same but
the pixel ratio stays higher.

## Current and historical east-house coverage

`year-build.spec.ts` always executes current reviewed2022 first-bay and whole
skeleton completion: real Play through the reported s0021 climb, then responsive
fixed-tick batches to completion, exact current Node/browser hash and tick parity,
canonical24/66 identity/support and clean crew. Release proof additionally runs
`YEAR_BUILD_FULL=1 npm run e2e -- year-build.spec.ts --grep 'current source'`: both
current journeys finish through the actual Play transport (brief pause for the
s0021 capture), with ordinary UI speed8. The flag does not override the two
original W51 fine-pose/golden FIXMEs, which remain skipped and unproved.

The old7648 layout's3/9 staging refusals and the earlier supported whole-house
fixture are separately source-verified. Neither certifies the loaded production
layout. Skeleton completion does not establish plywood/roof construction, continuous
aggregate extraction animation, or exhaustive anatomy clearance.
