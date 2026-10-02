# Renderer geometry lifetimes on Reset

Base: `40a67391fc9993d72c80e4339dd0dbf4959d4a8c`.
Branch: `codex/component-cache-reset-alpha`.
Scope: component renderer, per-view campfire geometry, owned year-backdrop line
disposal, native lifecycle regressions and this report only.

The construction journey inserts its plywood panel at tick 20. Its initial world
has no components and 11 GPU geometries; progress/endpoint have the panel and 12.
Reset restores the exact initial world hash, empty component list, 65 draws and
13402 triangles, but retains 12 GPU geometries through later paused frames.
`ComponentViews.clear()` drops views while preserving the geometry map; the panel
geometry stayed cached until full renderer disposal. This is retained finite
cache content, not evidence of unbounded growth on identical repeated resets.

`ComponentViews.reset()` now clears old views, disposes the previous world's
shared component geometry pool, clears that pool and rebuilds the new world.
Ordinary tick geometry sharing, the material pool, rig/model resources, engine
state, physical execution and the strict GPU counter assertion are unchanged.

## Validation

- Native lifecycle regressions: each RED before its own fix (component/campfire
  expected disposal 1, actual 0; backdrop line geometry/material disposal 0), then
  GREEN after the fixes, 3 PASS/0 FAIL. No WebGL context or browser used.
- The regression checks three reset cycles with a persistent initial beam and a
  transient panel: actual geometry dispose events, fresh geometry identities,
  ordinary tick reuse, retained material identity, absence of old cached geometry,
  full view disposal without duplicate geometry disposal, and unchanged entities.
- Campfire regression checks three resets with actual per-fire stone/log disposal
  events, ordinary tick reuse, retention of shared fixture unit geometry, new fire
  geometry identities and no repeated disposal of old fire geometry at full exit.
- Backdrop regression checks the actual exported production disposer over three
  independent lifetimes with nested/shared mesh and line geometry, materials and
  texture dispose events exactly once. Existing esbuild bundles extensionless
  browser imports in memory; Three remains external with the same native classes.
- `npm run typecheck`: PASS.
- `npm run lint`: PASS.
- `git diff --check`: PASS.

No full engine gate, browser run, deployment or integration performed. Root owns
actual UI construction completion with three reset cycles and other component
preset checks. The specifically requested frozen base was retained; no rebase to
moving main or edits to the frozen alpha candidate were performed.

## Extended owned-resource fixes

The other alpha resource failures cannot all be fixed by the component pool.
Campfire-evening has no components and meal retains the same item definitions.
Both contain a campfire fixture. Before the fix, `FixtureViews.campfire()` allocated fresh stone and
log geometry via `keep()` on each rebuild (`fixtures.ts:110,120`), while Reset
clears views without disposing these geometries. The two retained geometries
match 43→45 and 56→58 respectively, with unchanged reset draws/triangles/textures.
Extended authorization covers this fixture ownership. Stone/log geometry is now
recorded in the existing view-owned geometry list, released by its existing
clear/reset/removal cleanup. The shared fixture unit/material pool is preserved.

Year 2020 has no components or engine fixtures. The Lab year backdrop's
Before the fix, `disposeTree()` ignored non-Mesh drawables (`year-walkabout-view.ts:20–26`). The
2020 scene has a geodesic `LineSegments` geometry (`studio-2020/scene.ts:274–276`)
and two additional line objects in reconciliation. The original 2020 disposer
explicitly includes `LineSegments`; the generic Lab disposer does not. This is
a concrete independent disposal omission consistent with 688→689. The disposer
now includes owned `LineSegments` in the same deduplicated resource sets as Mesh.
Historical content/geometry values and GLB/material ownership are unchanged.
Exact GPU visibility/identity has not been probed; root should verify actual UI
campfire, meal and year 2020 resets as well as construction before claiming PASS.

## Hand-up cleanup semantics (read-only)

The saved endpoint has all 88 sequence steps completed, no held items/claims or
violations, and 10 cancelled `take_slot` children. Eight belong to completed
`step:fire` (`campfire_circle`) and one each to completed `step:sit0`/`step:sit1`
(`gather`). Authored `step:stand0` through `step:stand9` are completed, each with
`outputs.released` identifying one of those 10 children. `stand` intentionally
calls `rt.cancel(holder)` then completes only when the holder is inactive
(`social/actions.ts:278–283`). These cancellations are the intended safe ending.

Recommended root-owned assertion: allow `cancelled` only for hand-up `take_slot`
records under these three exact completed parents, with prior `occupied` history
and a completed authored `step:stand[0-9]` whose matching actor and
`outputs.released` name that child. Require exactly 10 such releases/cancellations
(8/1/1 parent distribution), and every other record completed. Keep all sequence,
support, physical outcome, held/slot/claim and violation checks. No broad terminal
status allowance, unexpected failures or arbitrary cancellations are accepted.
