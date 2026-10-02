# Preserve visual failures while completing functional checks

Base: `f7f468a821783c34f24e1786ca9afdb429bf73be`; isolated branch `codex/soft-visual-alpha`.

`captureView` accepts optional `softVisual` (default false). When explicitly true, only the final diff-ratio assertion uses Playwright `expect.soft`; its error remains a native test failure while later original functional assertions can execute. Missing baselines, PNG reading, screenshot dimensions and capture errors stay hard. Pixelmatch threshold 0.2 and maximum different-pixel ratio 0.015 are unchanged. Comparisons, diff images, attachments, baseline-update behavior and return values are unchanged.

Opt-in is limited to baseline-comparison capture calls in the requested fire, lab-build-bay, lab-social, lab-years and lab specs. Exploratory `compare: false` calls remain unchanged; wrappers still use their existing baseline-name sets. All original physical, terminal, hash, timing, draw-call and console-error assertions remain unchanged. No baseline, app, engine or content changes. This change does not make visual differences acceptable or certify intentional changes; each visual assertion must still fail until separately reviewed.

Validation: `npm run typecheck` PASS before the subsequent instruction to defer further TypeScript work during root's timing tests. `git diff --check` PASS. Targeted oxlint on the six modified e2e files FAILS with four existing diagnostics: fire.spec.ts lines 103 and 136 Buffer generic assignments (TS2322); lab.spec.ts line 151 duplicate ticks (TS2783); lab-build-bay.spec.ts line 194 missing Hook.setSpeed (TS2339). Read-only base contents linted through temporary adjacent files reproduce exactly those four diagnostics; temporary files removed. No unrelated diagnostic fixes included.

Source review of installed Playwright confirms `expect.soft` marks failed matcher steps with `softError` and records test errors, rather than throwing out of the test body. No browser, performance or native heavy execution ran here; the affected cohort's still-RED outcome and later original assertion execution require root's serialized focused run. No baseline acceptance or functional PASS is claimed.

## Meal follow-up

The frozen root gate's case 139, `meal.spec.ts:91` captures, failed in 3.7 seconds at the first compared capture (`meal-spoon-at-mouth`, line 105). Read-only inspection of `world-alpha-stabilization/viewer/test-results/meal-meal-captures-sit-spoon-at-the-mouth-legs-crossed-/trace.zip` records exact diffRatio 0.033173828125 (3.32%), expected <= 0.015. Gate log: `world-alpha-stabilization/viewer/.cloudflare/gate/2026-10-02T22-25-19-387Z/e2e.log:297`. This prevented the later original crossed-sitter assertion and legs-crossed capture from executing; their outcomes remain unproved.

Added explicit `softVisual: true` only to the two compared meal captures, spoon-at-mouth and legs-crossed. Sit-down and oblique `compare: false` captures remain unchanged. Original 300-second case timeout, all functional assertions, baseline images and thresholds are unchanged. Diff reviewed and `git diff --check` PASS. No follow-up browser, TypeScript, performance or native heavy validation executed while root's frozen gate continues. Intended visual changes and later functional acceptance still require root's serialized review/run.

## Poses follow-up

Root's read-only trace diagnosis reported cases 148/149/150 failing first on pixel ratio only: poses-pickup-crouch 0.032033203125, poses-raise-footer 0.0321669921875, poses-climb-frame 0.032037109375, each > unchanged 0.015. This provenance is root's trace review, not a new execution by this helper.

Added explicit `softVisual: true` to all six compared pose captures (pickup-crouch, handup-joist, handup, raise-footer, climb-frame and beam-walk). The two exploratory `compare: false` captures remain unchanged. All original planted-sole, hand-reach, arm-length, continuation, completion and timing assertions remain byte-for-byte unchanged, as do timeouts, baseline images and comparison thresholds. Diff reviewed and `git diff --check` PASS. No browser, TypeScript or heavy validation ran for this extension; the serialized cohort and reviewed baseline acceptance remain root-owned and pending.

## Prone follow-up

Read-only inspection of root's native trace `world-alpha-stabilization/viewer/test-results/prone-prone-captures-lie-d-7f4d7--push-up-kneel-up-standing-/trace.zip` confirms the sole recorded first error is pixel ratio at `prone-reach`: 0.0289716796875 (2.90%) > 0.015, from captureView through prone.spec.ts lines 293/302. Root gate log `2026-10-02T22-25-19-387Z/e2e.log:378` records case 169, capture test at line 284, failing in 2.8 seconds. No physical or other error is recorded before this visual stop; later transitions remain unproved.

The capture-local wrapper now passes `softVisual: compare`, so only its three existing compared shots (prone-reach, prone-push-up, prone-standing) opt in. Exploratory shots retain false comparison and false softVisual. All original take/push-up/kneel-up/standing transition assertions, 600-second timeout, baseline images and thresholds remain unchanged. Diff reviewed and `git diff --check` PASS. No browser, TypeScript or heavy validation executed. Root owns the serialized cohort and any reviewed baseline acceptance; no later functional PASS is claimed.

## Render-polish follow-up

Root's native trace review identified cases 187/188 with first errors solely in pixel ratio: render-polish-partial-paint 0.0325048828125 and render-polish-green-frame-supported-historical 0.037009765625, each > unchanged 0.015. This provenance is root's trace diagnosis, not a helper execution.

The file-local compared-capture wrapper now explicitly opts into softVisual for its existing six compared shots: partial-paint, flower-mural, mounted-panel, tilt-legs, equipment and green-frame-supported-historical. All original paint texture/coverage, mounted-panel roll, historical content hash, admission, raise completion, supported equipment definition, violation and console/page/network assertions remain unchanged; both 180-second timeouts and all baseline/threshold values are unchanged. No historical fixture values or renderer files changed. Diff reviewed and `git diff --check` PASS; no browser, TypeScript or heavy validation executed. Root owns later original assertion proof and reviewed baseline acceptance; no functional acceptance or new baseline approval is claimed.

## Stairs follow-up

Read-only inspection of root's native trace `world-alpha-stabilization/viewer/test-results/stairs-stair-foot-IK-capture-mid-flight-up-/trace.zip` confirms the sole recorded error is poses-stairs-mid-flight diffRatio 0.0221298828125 (2.21%) > unchanged 0.015, at stairs.spec.ts:91. Root gate log `2026-10-02T22-25-19-387Z/e2e.log:499` records case 269, capture at line 75, failing in 1.7 seconds. Root reports independent foot-IK up/down and replay cases 267/268/270 passed; this helper did not execute or independently certify them.

Only the single compared mid-flight capture now explicitly opts into softVisual. All original sole, foot-IK and replay tests and assertions remain unchanged, as do the capture's 240-second timeout, existing camera/sample progression, baseline image and thresholds. The capture is the final operation in its case; this extension retains a native visual failure rather than adding functional proof. Diff reviewed and `git diff --check` PASS. No browser, TypeScript or heavy validation executed; root owns serialized cohort proof and reviewed baseline acceptance.
