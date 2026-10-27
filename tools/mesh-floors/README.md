# Mesh support extraction

`node tools/mesh-floors/extract.mjs` reads the nine content-addressed, shipped GLBs for Chiba, tool camp, Freeside and west racks (including legacy and live fidelity variants). It emits `packages/world-compiler/src/mesh-floor-overlays.json`. `--check` checks regeneration without writing. This is offline work; no GLBs, definitions, or live data are changed.

The extractor follows the viewer's actual fitting rule: world transforms, precise mesh bounds, base centering and uniform scale on the mesh's largest axis. Asset-index boxes can have stale dimensions and are not used as mesh geometry. Hash and fitting-axis checks prevent applying a supplement to unrelated or differently scaled geometry. Existing pinned definitions acquire the supplement through compilation; they do not need to adopt a new catalogue revision.

Upward, horizontal coplanar triangles are welded into boundary edges. A 15 cm cell is accepted only when it is wholly within the projected triangle union; holes and disconnected components are retained. Cells with less than 1.8 m overhead clearance at their centre are rejected. The normal limit is 0.9999, height tolerance 1 cm, minimum connected area 1 m², total extraction bound 250,000 cells. Each connected patch carries its actual source-node provenance. Disjoint contained rectangles represent patches in the engine's existing surface format; no bounding rectangle spans a hole.

This first supplement accepts only support at terrain-step height (0–0.45 m). The bridge checks the actual terrain at placement. Upper faces remain rejected without a verified stair/entrance chain; the rejected list records why. Authored surfaces at the same height override extraction. Chiba's existing named gallery plate remains until geometric and walkability parity is established.

Focused verification:

```
node --test tools/mesh-floors/geometry.test.mjs
node --test packages/world-compiler/src/mesh-floors.test.ts apps/server/src/god/floor-plates.test.ts
node tools/mesh-floors/extract.mjs --check
```
