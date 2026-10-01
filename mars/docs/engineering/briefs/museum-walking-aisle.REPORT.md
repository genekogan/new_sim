# Furnished museum aisle and thin tabletop collision

2026-10-01: codex/museum-walking-aisle, basebdbc7e3. Own isolated tree includes exact root frozen7ea1a88 historical source/page copies for validation ONLY; those files/assets are never staged. Root owns their integration and pin decisions. This correction owns walking.ts, walking.test.mjs, mars-stepped-access.test.mjs, mars-stepped-access.spec.ts and this report. No authoritative NPC/activity/rig/support/claims, historical geometry/placement/material, asset or explicit traversal tags changed.

## Actual integration failure and clear aisle

Root's combined frozen-history browser run was6pass/1fail: the former seed[u11.5,v5.7] landed on the newly imported photographed projector table, giving eyeY2.69508 instead of actual lower-entry1.91308. All nine exact access tags still passed. Retained root failure: .cloudflare/historical-import/physical-browser.log/trace. This was occupied physical seed geometry, not traversal admission failure.

The reviewed furnishings put the projector table at[u11.48,v5.72], loose chairs at[4,4.65],[6.9,6.6],[8.05,4.65], and other portable objects nearby. The browser now follows the clearv4.1 aisle with the SAME support expectations: start[3.671513,1.91308,10.121287] → upper[-4.016650,4.802293,6.496077]. Source frame is still[-8.47875,0,8.925], yaw-atan2(.4265,.9045), u11.5→3.0. Real heldW ascent and heldS descent return from the attained upper pose without reseeding. Every sampled frame is active/grounded, unchanged exact9tag list/no refusals; all lower/upper/return tolerances are unchanged. No furniture was moved, hidden, relabeled or given traversal metadata.

## Reproduced collision defect and narrow camera correction

The three horizontal body rays at feet+.45/1/1.65 miss a thin horizontal tabletop between their heights. At actual entry floorY.21308 they run atY.66308/1.21308/1.86308; table/cloth/runner tops lie approximatelyY.9206–.9951. Its hanging audience-side drape intersects the lower ray, but its open rear admits the camera body through the table volume. A real frozen-museum rear approach reproduced that negative while eyeY remained1.91308/grounded, with exact table cloth footprint[u11.11,11.85]×[v5.13,6.31] intersecting the body's vertical volume. Readout JSON, capture and trace are retained; not inferred from an asset name.

walking.ts adds one downward ray through the candidate body CENTER band, head→old feet+ordinarySTEP. A hit above ordinarySTEP blocks unless it is the actual upward top of this movement's already-verified nextSurface high/low mesh, at its witnessed top within its existing precision. Existing three horizontal rays, head clearance, exact tagged seam/footprint/rise/gap rules and ordinary low-step behavior remain. Nothing becomes transparent or freely stepable. This is a small renderer collision boundary, not full capsule/limb collision certification or authoritative world physics.

## Intentional superseded untagged-CAD contract

The earlier bare-CAD regression recorded that the untagged central line reached the upper tier with>0.1m abrupt lifts; its old assertions were final eyeY4.8022931 within2e-6 and largestLift>.1. The new generic body-volume guard intentionally refuses the first untagged thin deck above ordinarySTEP. Root approved: “generic body-volume guard must refuse an untagged deck above ordinary STEP.” Preserving the former outcome would require a name/layer/shape exception admitting the same missing thin-table collision.

The old assertion initially failed after this correction (focused22pass/1fail); it was explicitly replaced with stronger per-frame admission evidence:255frames remain grounded at the actual lower entryY1.9130799 within the same2e-6 support precision and never advance past the first actual tier front (1e-6 geometry precision). Tagged exact9 still traverse all tiers both directions unchanged. No tolerance/baseline weakening or deleted negative assertion.

Source clarification: original generic floorInfo intentionally accepts ABSnormal, and a grounded ray starting at floor+.35≈.563 can originate inside the first~.029m-thick deck (bottom≈.553/top≈.582), then accept its underside and later top. “Intermediate rack supports” in the earlier investigation was an unmeasured inference, not established provenance; the accurate retained observation is the old untagged path reached the top. Generic floor behavior is unchanged; the new body-band admission closes its thin-volume entry.

## Validation and inspected evidence

Before correction: new thin-table Node regression17/18pass,1fail; actual rear-table browser0/1, named `camera body must not enter the untagged thin tabletop volume`. Preserved under viewer/.cloudflare/museum-walking-aisle/tabletop-before/{node.log,browser.log,mars-stepped-access-actual-1da21-ks-entry-from-its-open-rear/trace.zip}, plus before capture/JSON in the browser artifacts/attachments. The aisle-only test had already passed1/1 in43.5s before the collision fix.

After correction:
- `node --test deploy/walking.test.mjs deploy/mars-stepped-access.test.mjs`:23/23pass,0fail/skip,1.815s. All prior synthetic boundaries, actual tagged CAD ascent/descent, source/hole guards, six legacy stairs/controls tests plus thin tabletop negative; intentional untagged admission contract above.
- `E2E_VITE_PORT=5491 E2E_RUN=museum-tabletop-after-2026-10-01 ./node_modules/.bin/playwright test -c e2e/playwright.config.ts e2e/mars-stepped-access.spec.ts`:2/2pass,1.2min. Actual frozen furnished aisle41.7s; actual rear tabletop30.7s. Readout JSON verifies no sampled body center enters the untagged tabletop footprint/vertical volume; ordinary sliding around edges remains legitimate.
- Viewer TSC and cinematography TSC:pass. Scoped oxlint on four owned source/test files:pass; registration promises in both owned Node files now explicitly void, preserving test behavior. gitdiff--check:pass. No full gate/build/deploy or additional pose tests here.

Personally inspected viewer/e2e/artifacts/museum-tabletop-after-2026-10-01/chiba-projector-table-rear-collision.png and chiba-wasd-returned-to-entry.png: frozen photographed furnishings/tiers visible, camera remains behind the thin table and returns through the clear side aisle. Table/HUD partly occupy the foreground, so exact body-volume position proof is the attached readout, not a claimed visible NPC contact. Earlier aisle upper capture is in worktree-root e2e/artifacts/museum-walking-aisle-2026-10-01/chiba-wasd-upper-tier.png (first run was invoked from root). No existing screenshots/goldens updated.

Heavy slot returned immediately after2/2 browser green; root owns extraction, historical source/pins, combined gate and release. Remaining limit: center-body ray + existing sparse horizontal rays is approximate first-person collision, not full swept-capsule certification. The separate downhill ankle fix remains unchanged and separately proved.
