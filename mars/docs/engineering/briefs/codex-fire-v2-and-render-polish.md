# Codex brief: fire v2 and render polish (paint textures, solar and equipment meshes, green frames)

Branch `codex/fire-v2-render-polish` · worktree per CODEX.md §1 (`TOPIC=fire-v2-render-polish`) · ETA (estimate):
6–10 h of Codex work · report: `docs/engineering/briefs/codex-fire-v2-and-render-polish.REPORT.md`.

## Why

These are renderer honesty gaps Gene will see (HANDOFF "End of night", item 13):
- the fire's smoke is faint, its core saturates to white, and its flames are billboards that read as a flat blob
  from above;
- paint has no textures: a textured sheet is drawn as a hashed colour with a stripe;
- solar modules and equipment are plain boxes with label plates;
- frames render blue, while the evidence photo shows green.

All of this is renderer-only. The engine state it draws is fixed.

## Context to read first

1. `docs/engineering/CODEX.md`, all of it: ports (`E2E_VITE_PORT=5491`), per-spec Playwright, the pin rule,
   ownership.
2. PROGRESS.md, the W3 entries ("W3 animated fire"). `viewer/app/engine-view/fire.ts` (198 lines):
   - three noise-shaded cylindrical-billboard flame layers in one draw, a coal bed, 28 GPU-animated embers,
     12 smoke puffs, and a point light with seeded flicker (×0.72–1.22);
   - a **pure function of (`seedOf(entity id)`, sim / take seconds)**, with no `Math.random` / `Date.now`;
   - shared by the lab (`app/engine-view/fixtures.ts` campfire) and the studio (`app/studio/scenery.ts`).
   - W3's weak spots: smoke barely visible at dusk, core saturates to white, flat from overhead, and
     `e2e/fire.spec.ts` hard-codes `OLD_CALLS = { oblique: 430, top: 428, close: 465 }` (the old cone's
     draw calls).
3. `viewer/e2e/fire.spec.ts`. It asserts:
   - a flame region change of 4.7 % of 2×2 blocks between t 25.0 and 25.3 s, against 0.00 % on a still person;
   - the replayed tick 506 bit-identical in the fire box;
   - draw calls within +3.

   Baselines: `fire-dusk-oblique.png`, `fire-dusk-close.png`.
4. `docs/engineering/SOLAR_PAINT.md`:
   - catalog (`solar-panel-100x170` / `-100x200`, `panel-rail`, `battery`, `charge-controller`, `inverter`);
   - the renderer contract: panel `paint = { face, color | texture, coverage, bands[] }`; `human.hands` /
     `paintHands`; mounted tilt from the pose's `pitch` / `roll`; equipment `{ kind, config }`.
5. `viewer/app/engine-view/paint.ts` (95 lines, `PaintOverlay`, `paintColor`), and in
   `viewer/app/engine-view/components.ts`:
   - `build()` (line 59): colour from the catalog `d.color`;
   - `upright()` (line 83);
   - `panel()` (line 129);
   - `equipment()` (line 168);
   - `labelText` / `labelTexture` (line 353+);
   - the `METAL` set (line 21).

   Frames get `'#1f5fbf'` from `engine/world/catalog.ts:109`. **That file is Claude-owned: recolour in the
   renderer, not the catalog.**
6. Paint textures: the engine's `paint { texture }` is a free string (≤ 120 chars, `engine/work/paint.ts:273`). The
   **2024 flower mural** is the Kit piece `flower-mural` (`app/history/photographic-corrections.ts:34`), textured
   from `viewer/public/history/2024/flower.webp`. `public/history/2025/flower.webp` is also used
   (`app/history/scenes.ts:122`).
7. Evidence photos: `docs/engineering/evidence/2026-09-28-skeleton-stage-racks-2x4-frame-before-plywood.jpg` (the
   frames' colour) and `…material-piles-*.jpg`.
8. Lab scenarios you capture (read-only; Claude-owned):
   - `/lab?scenario=campfire-evening` (fire);
   - `/lab?scenario=solar-paint` (paint, panels, equipment, bundles);
   - `/lab?scenario=year-build-2022` (frames and beams).

   The hook is `window.__marsEngine` (`app/lab/hook.ts`: `runScenario`, `step`, `runToEnd`, `camera(pos, target)`,
   `setOverlay`, `info().calls`). Reuse `e2e/lab-helpers.ts` / `e2e/helpers.ts` (`openLab`, `captureView`); do not
   edit them.

## Files owned (create / edit only these)

- `viewer/app/engine-view/fire.ts`, `viewer/e2e/fire.spec.ts`, and its baselines `viewer/e2e/baselines/fire-*.png`.
- `viewer/app/engine-view/paint.ts`.
- **New** files:
  - `viewer/app/engine-view/solar-mesh.ts` (module frame, cell grid, junction box, rail profile, tilt legs);
  - `viewer/app/engine-view/equipment-mesh.ts` (battery / charge controller / inverter shapes; keep the label
    plate);
  - `viewer/app/engine-view/palette.ts` (renderer colour overrides by catalog def or category, e.g. frames green).
- In `viewer/app/engine-view/components.ts`, **only**:
  - the bodies of `panel()` and `equipment()`, reduced to one-line calls into the new files;
  - the colour lookup in `build()` / `upright()`, routed through `palette.ts`.

  Nothing else in `components.ts` (poses, interpolation, held items, stairs, labels) is yours.
- **New** `viewer/e2e/render-polish.spec.ts` and its baselines `viewer/e2e/baselines/render-polish-*.png`.
- `docs/engineering/briefs/codex-fire-v2-and-render-polish.REPORT.md`.

## Files forbidden (Claude-owned; read only)

- `viewer/engine/**`, all of it, including `world/catalog.ts` (colours), `work/paint.ts`, `construction/solar.ts`
  and `take/**`. No engine change is needed or allowed.
- `viewer/app/engine-view/` everything else: `humans.ts`, `rig.ts`, `posture.ts`, `people.ts`, `items.ts`,
  `fixtures.ts`, `frame-gait.ts`, `stair-gait.ts`, `prone.ts`, `take-replay.ts`.
- `viewer/app/lab/**`, `viewer/app/studio/**` (incl. `scenery.ts`), and `viewer/app/history/**` (the Kit's own
  drawn geometry and murals).
- All other e2e specs, helpers and baselines. **You refresh only `fire-*.png` and `render-polish-*.png`.**
- Every `docs/engineering/*.md` other than your REPORT.

**Pin rule (CODEX.md §4):** never edit a pinned hash. If one moves, STOP, REVERT, REPORT. Renderer changes cannot
move engine pins. If `test:engine` changes, you touched the engine.

## Deliverables

1. **Fire v2** (`fire.ts`):
   - reads as fire from above: crossed or volumetric-looking flame geometry, or a top-facing layer, instead of
     a flat billboard blob in the top-down preset;
   - visible smoke at dusk: a soft column that rises, drifts and thins;
   - a core that is hot but not clipped to white: tone-mapped or colour-graded flame, with no large pure-white
     area;
   - **determinism unchanged**: still a pure function of (entity-id seed, sim seconds), and replay bit-identical
     in the fire box;
   - a draw-call budget of at most +2 over today's fire. Replace the hard-coded `OLD_CALLS` with a measured
     reference, and explain it in the spec.
2. **Paint textures** (`paint.ts`):
   - a texture registry mapping texture names to images under `viewer/public/history/**`, including `flower-mural`
     (2024) and the other mural photos the Kit uses;
   - per-band reveal: a band shows the texture only where `bands[].coverage` says it is painted;
   - unknown texture names keep today's hashed colour + stripe fallback, with a `console.warn` once per name;
   - no new network assets. Only files already in `public/` (check they exist; `public/history/2024/flower.webp`
     does).
3. **Solar and equipment meshes:**
   - modules with an aluminium frame and cell grid (both sizes), front and back distinguishable;
   - rails with a profile;
   - the implied tilt legs / rear risers of a tilted mount (SOLAR_PAINT "Approximate": the engine implies them,
     so draw them);
   - battery / charge controller / inverter as recognisably different objects, keeping the configuration label
     plate.
4. **Green frames** (`palette.ts`): engine-drawn uprights (`category 'rack-upright'`, incl. `upright-*-kit`) in the
   evidence photo's green, with the sRGB value taken from the photo and stated in the REPORT. Beams stay orange.
   The Kit's studio geometry (`app/history/**`) is out of scope: report where lab or studio scenes now mix green
   engine frames with differently coloured Kit posts.

## Tests (acceptance)

- `viewer/e2e/fire.spec.ts`, extended and kept deterministic, asserting:
  - (a) the existing flame-change and still-person assertions;
  - (b) the replayed tick bit-identical in the fire box;
  - (c) a top-down check that the flame is not a flat disc (e.g. the ratio of the flame's lit area at two times,
    or structure inside the flame box; define and justify the metric);
  - (d) smoke present: a luminance / alpha delta above the fire at dusk, above a stated threshold;
  - (e) core not clipped: < a stated % of pure-white pixels in the flame box;
  - (f) the draw-call budget.

  Refresh `fire-dusk-*.png`, and add `fire-top.png` if useful.
- `viewer/e2e/render-polish.spec.ts` (new), with captures + baselines:
  - a textured sheet mid-paint (partial bands);
  - the flower mural texture on a painted sheet;
  - a mounted panel close-up (frame, cells, legs);
  - equipment close-up;
  - a year-build frame in green at eye level.

  It needs no console errors, and a draw-call count per view reported.
- Run: `E2E_VITE_PORT=5491 E2E_RUN=codex-render-<n> npx playwright test -c e2e/playwright.config.ts fire.spec.ts
  render-polish.spec.ts`, plus `npm run test:engine` and `npx tsc --noEmit -p .` (all unchanged and green).
- **Other people's baselines:** the fire's light and the frame colour will change pixels in other specs
  (`lab-social-*`, `campfire`, `poses-*`, `year-build-*`, `build-bay-*`, studio). **Do not refresh them.** Run
  `lab.spec.ts`, `lab-social.spec.ts`, `poses.spec.ts`, `year-build.spec.ts`, `solar-paint.spec.ts` and
  `lab-build-bay.spec.ts`, and list in the REPORT every baseline that now differs (name, % changed, what
  changed). The lead looks at them and accepts firelit / colour drift at merge (CODEX.md §9).
- Look at every PNG you commit. Say in the REPORT what you saw.

## Report format

CODEX.md §8, plus:
- before / after image pairs (paths) for fire from above, at dusk and close up, and for each polish capture;
- the new fire metrics with thresholds;
- draw calls before and after;
- the green sRGB value and the photo region it came from;
- the list of foreign baselines that drift.
