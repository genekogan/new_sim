# Fire v2 and render polish — Codex report

## 2026-09-28

- Branch: `codex/fire-v2-render-polish`; base after rebase: `0d68c60223972bcd7a6f52c450a2da9594e5e4b5` (`git merge-base HEAD main` at report time).
- Feature commit: `f4af2ed` **Polish fire and engine component materials**. This report is the follow-up commit.
- Local only; no remote, push or deploy.

### Changes

- `viewer/app/engine-view/fire.ts`: crossed, tilted seeded flame ribbons in the existing one-draw geometry; normal-blended warm core, more visible rising smoke composited behind the flames. Seed/time replay remains deterministic.
- `viewer/app/engine-view/paint.ts`: 10 known names map to existing `public/history` images, with sRGB sampling and per-band UV reveal. Unknown names retain hashed colour/stripe and warn once; the E2E spec checks that invalid case.
- `viewer/app/engine-view/solar-mesh.ts`: front laminate/cell grid, aluminium edge, backsheet, junction box for both module sizes; also contains C-channel rail and tilt-riser builders.
- `viewer/app/engine-view/equipment-mesh.ts`: battery terminals/handle, controller screen/ports, inverter face/vents, with the configuration label plates.
- `viewer/app/engine-view/palette.ts` and the permitted `components.ts` edits: engine rack uprights use green `#2c4629` sRGB, beams keep their catalog colour; panel and equipment bodies delegate to the new modules.
- `viewer/e2e/fire.spec.ts`, `viewer/e2e/render-polish.spec.ts`, and only their owned baselines: fire pixel/draw/replay checks, invalid texture check, and five polish captures.

### Gates and measured results

After rebasing onto `main`, from `viewer/`: `npm run test:engine` **380 pass, 0 fail, 3 skip** (383 total); `npx tsc --noEmit -p .` **clean**; `E2E_VITE_PORT=5491 E2E_RUN=codex-render-post-rebase npx playwright test -c e2e/playwright.config.ts fire.spec.ts render-polish.spec.ts --reporter=line` **4 pass**. All pinned tests pass unchanged; no pinned hash or engine file was edited.

Fire at tick 500: **431 oblique, 429 top, 466 close** draw calls, exactly the measured pre-v2 W3 reference in each view (budget reference +2). From tick 500 to 506, the close fire box changed **2.4%** of 2×2 blocks (>32/255) while still person g4 changed **0.00%**; top-close changed **2.62%** (>1% threshold) and contained **55.49%** warm pixels (>0.5%); the projected smoke column changed **6.37%** (>0.2%, level 12); pure-white fire-box pixels **0.000%** (<1%). Replaying tick 506 changed **0.000%** of the fire box. The top metric measures temporal internal/silhouette structure, not physical flame height; smoke motion can include changing illumination behind translucent smoke.

Polish view draw calls: partial paint **516**, flower mural **518**, mounted module **503**, equipment **379**, green year-build frame **1787**. The mounted module close-up shows the new cell grid and frame but still lacks risers; see the ownership note below.

### Captures inspected

| View | Before | After | What I saw |
| --- | --- | --- | --- |
| Fire top | `viewer/e2e/artifacts/codex-render-before/fire-top.png` | `viewer/e2e/baselines/fire-top.png`, `fire-top-close.png` | The old top preset reads as a small pale blob; top-close now shows orange crossed tongues over the logs. The wide top preset remains small at this scale. |
| Fire dusk oblique | `viewer/e2e/artifacts/codex-render-before/baseline-fire-dusk-oblique.png` | `viewer/e2e/baselines/fire-dusk-oblique.png` | Warm points visible between people; smoke is subtle at this distance. |
| Fire close | `viewer/e2e/artifacts/codex-render-before/baseline-fire-dusk-close.png` | `viewer/e2e/baselines/fire-dusk-close.png` | Orange, separated flame tongues instead of a broad white core; a soft column is visible against the people/wall. |
| Partial paint | `viewer/e2e/baselines/solar-paint-mid-paint.png` (closest pre-v2 view) | `viewer/e2e/baselines/render-polish-partial-paint.png` | Flower image appears only in partly covered upper bands; the unpainted plywood remains visible. |
| Flower mural | No equivalent pre-v2 mural close-up was saved | `viewer/e2e/baselines/render-polish-flower-mural.png` | A large red/blue flower image occupies painted bands, with untouched wood above/below; the painter occludes its middle. |
| Mounted module | `viewer/e2e/baselines/solar-paint-mounted-equipment.png` (wider pre-v2 view) | `viewer/e2e/baselines/render-polish-mounted-panel.png` | Blue cell laminate and silver rim are clear; rails remain plain rectangular bars and risers absent. |
| Equipment | `viewer/e2e/baselines/solar-paint-mounted-equipment.png` (wider pre-v2 view) | `viewer/e2e/baselines/render-polish-equipment.png` | Three distinct cases with labels; the panel remains in the background. |
| Green frame | `viewer/e2e/baselines/year-build-skeleton.png` (wider pre-v2 view) | `viewer/e2e/baselines/render-polish-green-frame.png` | Braced upright is dark green at eye level while nearby Kit structure is brown/blue-grey. |

I looked at every new or refreshed PNG listed above. The frame green is the median sampled from the upright patch **x 727–742, y 740–890** of `docs/engineering/evidence/2026-09-28-skeleton-stage-racks-2x4-frame-before-plywood.jpg`: RGB **(44,70,41)**, sRGB **`#2c4629`**. This is a photo-derived renderer approximation, not an asserted paint specification.

### Other specs and baseline drift

Ran `E2E_VITE_PORT=5491 E2E_RUN=codex-render-foreign npx playwright test -c e2e/playwright.config.ts lab.spec.ts lab-social.spec.ts poses.spec.ts year-build.spec.ts solar-paint.spec.ts lab-build-bay.spec.ts --reporter=line` before the rebase: **24 pass, 1 skip, 1 visual failure** in `poses-raise-footer` at **1.520%**, above the 1.5% threshold. No foreign baseline was refreshed. No lab/engine assertion failed. The intervening main commits changed studio playback, not these Lab view files.

All same-name capture/baseline pixel differences, measured with the suite's pixelmatch threshold 0.2 (including comparisons disabled in the foreign specs):

| Baseline(s) | Changed pixels | Observation |
| --- | --- | --- |
| `build-bay-held-oblique`, `build-bay-raise-oblique`, `build-bay-visitor-oblique` | 0.365%, 0.783%, 0.469% | Frame/crew edges and HUD text. |
| `lab-narrow-passage-mid-top-debug`, `lab-stairs-mid-oblique` | 1.452%, 1.057% | Debug/HUD text and person edges; attribution to this patch is unconfirmed. |
| `lab-social-t20-oblique`, `lab-social-t65-top-debug` | 0.038%, 1.178% | Firelit person edge in the oblique view; debug/HUD region in top view. |
| `poses-beam-walk`, `poses-climb-frame`, `poses-handup-joist`, `poses-handup`, `poses-raise-footer` | 0.787%, 0.529%, <0.001%, 1.243%, **1.520%** | Green frame edges, people and HUD; the footer view is the sole threshold failure. |
| `solar-paint-mid-paint`, `solar-paint-mounted-equipment` | 0.664%, 0.577% | Image-painted sheet, module grid and equipment. |
| `year-build-handup-248`, `year-build-skeleton` | 0.033%, 0.217% | Green frame/bracing and HUD. |

The comparison captures and `.diff.png` files are under `viewer/e2e/artifacts/codex-render-foreign/`; I inspected a contact sheet of all 16 diffs. Several diffs include text or people edges and cannot be confidently attributed to renderer edits. The lead should judge/refresh these owned baselines after its merge gate.

### Ownership-limited gaps

- `components.ts` only permitted a colour lookup and one-line `panel()`/`equipment()` bodies. `panel-rail` currently falls through `build()` to a plain box. The lead needs to route `e.def === 'panel-rail'` to `solarRailMesh()` in `build()`.
- `panel()` currently receives only the definition and dimensions. The lead needs to pass the entity's installed state/pose to it (or another owned renderer call site) and attach `solarTiltLegs()` only for installed tilted modules. Adding them unconditionally would put risers on carried modules.
- `app/history/kit.ts:84` draws Kit rack posts `#293c45`, whereas engine uprights now use `#2c4629`; mixed year-build/studio views can show both. `app/lab/solar-paint.ts` still describes textures as hashed stripes, and the `components.ts` upright comment still says blue; these lines are Claude-owned.
- The 2024 flower photo is a source mural image applied to the hypothetical Lab sheet; its placement/crop is illustrative. Fire smoke is visible close up but still faint in the wide oblique preset.

Approximate work: **~1 h 20 min**, **~20k tokens** in this brief (estimate).
