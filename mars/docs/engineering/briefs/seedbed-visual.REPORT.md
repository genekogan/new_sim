# Seedbed visual boundary (future candidate)

Root-owned renderer-only addition on `codex/seed-planting-integration`, based on
future social candidate35538e4. No published planting or Play acceptance claim.

A garden-planter carrying `planting.kind=seedbed-v1` renders the existing bounded
wood/soil geometry without the decorative plant silhouette. Four initially hidden
material-deposit markers become visible only from discrete real retained
`planting.deposited` fractions, one per1/16 transfer. They represent normalized
deposited seed material, not individual authoritative seeds, seedlings or growth.
Ordinary care planters retain their original appearance. Renderer and inspection
never write the world or spawn simulation entities.

Markers use the shared primitive geometry/material cache; Reset clears view nodes
and marker state. `FixtureViews.seedMarkers()` reads actual visible geometry,
returns detached world positions and records absence of decorative plant geometry.
Each marker's base is at soil-top y0.8 for the existing0.6×0.8×0.6 fixture; local
x/z centers are±0.12, with0.075×0.016×0.035 geometry, inside its supported soil.
The ordinary fixture transform gives the exact rotated world positions.

Focused renderer checks:6/6PASS (two existing fixture checks plus four new seedbed
checks); unchanged-world snapshots,0–4markers in both orientations, detached
inspection, no invented quantity for invalid state,25resets using the same cached
geometry, ordinary-care appearance and disposal. ViewerTSc/type-awarefocusedlint/
whitespace checks PASS. Invalid authoritative planting state must still be named
by activity admission/execution; a renderer guard is no authority-validation proof.

Core/HUD/shared registry/selector/hook wiring, actual Play/capture inspection,
combined gate and public verification remain pending. No anatomical/library change,
new asset or historical color/geometry value was introduced.
