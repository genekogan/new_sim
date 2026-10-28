# Grass at the context hall's origin

The exact retained failure is `<team>/scratch/t4/world-context-views/linux-preflight-v1/a/context.png`: black sprigs emerge through the wooden floor near the bench. The source fixture is the unchanged `tools/context-views/fixture.mjs`, not a replacement world.

## Cause and focused proof

The existing ecology index already excludes every generated cover site inside this hall. Three 0.185.1 calls `Scene.onBeforeRender` before projecting/uploading objects, but calls `Mesh.onBeforeRender` afterward. GroundCover previously generated its matrices, colours and draw counts in the first mesh callback. Its first draw therefore used already-uploaded identity transforms and zero colours: black grass at world origin. Camera switches could likewise draw previously uploaded data.

The regression uses the real `three/src/renderers/webgl/WebGLObjects.js` upload coordinator with an in-memory attribute sink. Before the product change it fails with 69 tall-grass instances whose first uploaded root is `(0,0)`; the exact hall's recipe exclusion test already passes. After preparation moves to the scene callback, all 9 focused checks pass. Outdoor instances remain present. No floor, terrain, density, quality setting, material or generator recipe changes.

Run from this checkout:

```
node --test apps/web/src/gen-mesh/ground-cover.test.ts apps/web/src/gen-mesh/ground-cover-recipe.test.ts
```

Retained CPU evidence: `<team>/scratch/painting-quality-q-20261028/ground-cover/{before.tap,after.tap,source-proof.json}`. The new tests cover the exact fixture, first upload, a camera switch at a different height, prior scene callback ordering, idempotent binding, rebind restoration and disposal. This establishes buffer ordering, not actual rendered pixels.

## Required shared adapters (R-owned)

Apply together with this change; removing the late callback without binding the scenes leaves cover unprepared.

- `apps/web/src/ContextView.ts`, immediately after `scene.add(layer.group);`: `layer.cover.bindScene(scene);`
- `apps/web/src/LiveWorld.tsx`, immediately after `scene.add(entityLayer.group);`: `entityLayer.cover.bindScene(scene);`

`bindScene` chains the previous scene callback, is idempotent, releases the old scene on rebind and restores the original callback on cover disposal. Existing `WorldEntityLayer.dispose()` already disposes its cover.

`WorldPlacePreviews` temporary scenes contain subject masks; their mesh-name filter excludes ground cover. Both ordinary Explore shots and immutable context image captures render their real world through `this.live()`, the same scene bound above. Eyes also renders the supplied live scene. No preview/cache/Eyes adapter was edited by Q.

## Pending visual acceptance

Use the existing context-view fixture and renderer harness under an R-scheduled serial browser slot, following `E2E.md` and the e2e skill. Do not boot another product world or modify current A qualification. On the integrated B head capture the exact interior-seat and enclosed-room views from a fresh renderer; retain first-frame PNGs, console errors, source/build identity and chosen camera. Confirm no black origin sprigs and readable existing room geometry. Capture the outdoor landmark from a fresh renderer and confirm ordinary grass remains. Repeat one interior at another legitimate floor height and switch outdoor/interior cameras in the same renderer, preserving geometry and density. Save proof under `.e2e/runs/` or the existing fixture receipt's owned output, close only owned contexts/processes and report visual status separately.

No browser, build, server, Modal, remote write, deployment or live verification was run by Q. No optional quality candidate was added.
