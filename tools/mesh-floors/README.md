# Mesh support extraction

`node tools/mesh-floors/extract.mjs` reads the nine content-addressed, shipped GLBs for Chiba, tool camp, Freeside and west racks (including legacy and live fidelity variants). It emits the full provenance manifest `packages/world-compiler/src/mesh-floor-overlays.json` and the compact runtime payload `packages/world-compiler/src/mesh-floor-runtime.json`. Only the compact file is imported by runtime code: identical rectangles and links are interned across asset revisions, with rectangle tuples expanded without coordinate rounding. Tests compare every reconstructed surface and link against the full manifest. `--check` checks regeneration without writing. It runs offline on the GLBs in the checkout (fetch them with `node tools/assets/pull.mjs`) and changes no GLB, definition or live data.

The extractor follows the viewer's actual fitting rule: world transforms, precise mesh bounds, base centering and uniform scale on the mesh's largest axis. Asset-index boxes can have stale dimensions and are not used as mesh geometry. Hash and fitting-axis checks prevent applying a supplement to unrelated or differently scaled geometry. Existing pinned definitions acquire the supplement through compilation; they do not need to adopt a new catalogue revision.

Upward, horizontal coplanar triangles are welded into boundary edges. A 15 cm cell is accepted only when it is wholly within the projected triangle union; holes and disconnected components are retained. Cells with less than 1.8 m overhead clearance at their centre are rejected. The normal limit is 0.9999, height tolerance 1 cm, minimum connected area 1 m², total extraction bound 250,000 cells. Each connected patch carries its actual source-node provenance. Disjoint contained rectangles represent patches in the engine's existing surface format; no bounding rectangle spans a hole.

The supplement accepts support at terrain-step height (0–0.45 m), plus Chiba bleacher treads and its mezzanine when a mesh-proven three-rise flight connects them to a terrain entrance. Each flight verifies support across the body width and bounds gaps, rises, and landing clearance. The bridge checks actual terrain at placement. Other upper faces remain rejected without a verified stair/entrance chain; the rejected list records why. Authored surfaces at the same height override extraction. Chiba's existing named gallery plate remains until geometric and walkability parity is established.

Focused verification:

```
node --test tools/mesh-floors/geometry.test.mjs tools/mesh-floors/steps.test.mjs
node --test packages/world-compiler/src/mesh-floors.test.ts apps/server/src/god/floor-plates.test.ts
node tools/mesh-floors/extract.mjs --check
```
