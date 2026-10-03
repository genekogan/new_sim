# Seed planting Lab — authored candidate, not browser proof

This future candidate supplies a scenario-restricted HUD and two actual Play regressions. It is not shipped or browser-validated. No browser/performance process was started while the root's release gate owned the serialized slot.

## Scope and source

- Isolated `codex/seed-planting-lab` worktree begins at gallery-lab `35538e4`.
- Owned new paths: `viewer/app/lab/seed-planting-hud.tsx`, `viewer/e2e/seed-planting.spec.ts`, this report. Shared registry, selector, panel, hook, camera, attention and renderer remain root-owned.
- Existing viewer dependencies/browser binaries are symlinked from the main checkout; frozen `campus.glb` and `.br` were copied from gallery-lab. No installs or asset edits.
- Core `bc86ed78aa03e04085c1b40f38eada09612c0e22` is inherited by cherry-pick `262b2f5`; its API and source commitment refusal are unchanged. Renderer geometry is read from root commit `61af377`, not cherry-picked into this owned-path candidate.

## Truthful controls

The HUD appears only in `seed-planting` and `seed-planting-rotated`. Start plant A/B submits the normal registered `seed_planting` action with the actual bowl, planter and return slot binding. Admission is checked again in the handler; runtime/epoch guards and current active cancellation/direction state prevent stale or repeated submissions.

Pause planting and End planting both request the leaf action's safe cancellation. They do not invent a paused parent or erase placed material. Play runs ordinary withdrawal and bowl return; Continue plant A/B explicitly submits `resume:true` against the same unfinished purpose. The readout distinguishes committed material completion from action execution/return and reports actual source quantity, deposits, purpose, actor, status, phase and named refusals. An unfinished planter commits its finite source, so the other planter's Start remains unavailable with `seed_planting.source-committed` until the first is complete.

Direct planter away submits ordinary `walk_to` to the scenario's rotated `[-5,3]` point. The runtime's handoff safely returns the actual bowl before the directive completes. No actor/material pose is directly written.

All staging and material labels are hypothetical. Four normalized 1/16 bowl transfers place 1/4 bowl into each planter. Visible deposit markers are neither literal seed counts nor sprouts; there is no historical species, growth or refill claim.

## Authored actual Play acceptance

The two cases retain the existing 120-second test limit, run at 2x, and define no retries. Reset's single first Step checks readiness; every activity progression, cleanup and direction then uses actual Play and bounded state waits. Global Pause freezes evidence before controls and captures, preserving exact partial comparisons.

1. Default: actual partial A deposits/current rig and bowl identity; Pause safely returns the same bowl with exact retained purpose/material; B's source commitment refusal; explicit Continue increases real deposits without rebinding purpose; A completes and returns; B completes using the remaining finite bowl. Final source is exactly zero and both beds contain exactly 1/4.
2. Rotated: actual partial A deposits and soil markers; ordinary director handoff returns the bowl and reaches the rotated destination; explicit Continue; End retains exactly the second partial purpose/material; another explicit Continue completes the same purpose, leaving untouched B and the remaining 1/4 bowl.

Checks use the detached `seedPlanting()` and actual rendered `seedMarkers()` hook contracts agreed with root. They assert exact source conservation, IDs/fixtures, planted support, current hand/reach rig, ordinary return support/pose, no outstanding claims/hand drivers/tasks, no violation or page errors, and Reset clears deposits/markers. Marker count equals retained deposit units; actual mesh world centers are checked against the fixture yaw transform, soil Y offset 0.8, local centers ±0.12, and the marker footprint stays within the 0.5×0.5 soil surface. The positional precision checks describe this existing renderer geometry; they do not alter authoritative support/clearance tolerances.

Nine normal PNGs are planned (five default, four rotated), each with accessibility and JSON state. At most two additional failure PNGs keep the bound at eleven. Receipts derive exact source HEAD at execution and include errors, state, records, material, markers, camera activity facts and attention. Actual captures must still be run and personally inspected in the root-granted slot; no screenshot or Play outcome is claimed here.

## Validation and remaining integration

Viewer `npm run typecheck`, an explicit strict TypeScript check of the Play spec (which is outside the viewer tsconfig include), focused type-aware/type-check oxlint on both authored files, formatter and diff checks pass. No Node checks were repeated: the core owner reports 71/71 focused seed/garden/cleanup checks. No browser or performance checks ran. Root must integrate registered actions/scenarios/HUD/hooks/renderer, execute both unchanged authored cases on a frozen combined source, inspect every normal capture and complete release validation before shipment.
