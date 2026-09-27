# nav-eval: raw results (2026-09-27)

Throwaway sandbox for choosing the navigation and collision-query libraries. Nothing here is used by the app build.
Machine: Apple M3 Max, Node v26.8.2. Library versions: recast-navigation 0.43.1, @dimforge/rapier3d-compat and
-deterministic-compat 0.21.0, three-mesh-bvh 0.9.15, three 0.185.1. The summary and recommendation are in
`docs/engineering/LIB_EVAL.md`.

## Rerun

```bash
cd viewer/experiments/nav-eval
npm install
node lib/campus.mjs            # campus.glb -> out/campus-{chiba,all}.bin (about 1 s, meshopt decode)
node exp-a-recast.mjs          # Recast on the synthetic ground + campus (about 15 s; add --skip-campus for about 1 s)
node exp-a2-same-scene.mjs     # bespoke engine/spatial vs Recast on engine/scenes/proving-ground.ts
node exp-b-rapier.mjs          # Rapier compat + deterministic-compat
node exp-c-bvh.mjs             # three-mesh-bvh
```

Each script writes its JSON output to `out/*.json`. That directory is gitignored.

## Geometry

- **campus.glb:** 70 MB. Uses `EXT_meshopt_compression` (listed as required). Loads in Node with `GLTFLoader` +
  `MeshoptDecoder`, stripping images, textures and materials first as `deploy/catalog.mjs` does. It contains 4,772
  meshes and no instancing. After skipping people:
  - `all`: 1.486 M triangles.
  - `chiba` (assembly `chiba` bbox + 15 m): 331 k triangles.

  The file has no terrain, so I added a ground quad at y = -0.16 (the catalog's ground height). Extraction takes
  about 0.4 s.
- **Synthetic ground (`lib/proving-ground.mjs`):** 60×60 m. Contents:
  - a wall;
  - a U-trap;
  - a 1.0 m × 4 m corridor, which is the only exit from its field;
  - platform A at 2.88 m with a complete 16×0.18 m stair;
  - platform B with steps 6–11 missing.
- **Engine scene (`engine/scenes/proving-ground.ts`):** the lead engineer's scene, converted to triangles by
  `lib/scene-to-mesh.mjs`. Stair links become real step blocks, and treads listed as missing in `link.reason` are
  left out.

## A. Recast (recast-navigation-js)

Settings: cs 0.1, ch 0.05, radius 0.3 (3 vx), height 1.8 (36 vx), climb 0.2 (4 vx), slope 45°.

### Synthetic ground

| | solo | tiled (64 vx) | TileCache (48 vx) |
|---|---|---|---|
| build | 3–6 ms (first build includes JIT) | ~5 ms | ~5 ms |
| wall 6 m apart | 18.05 m, no penetration | 18.05 | 18.05 |
| U-trap exit | 25.6 m, no penetration | 25.4 | 25.7 |
| 1.0 m corridor | passes, 12 m | passes | passes |
| under deck → deck, same XZ | 20.1 m via stair, maxY 2.88 | via stair | via stair |
| deck → under | 24.6 m via stair | via stair | via stair |
| broken stair B | unreachable (partial path, `success:true`) | same | same |
| stair polys flagged + `excludeFlags` | path refused; default filter still OK | same | same |
| byte-identical rebuild | yes | yes | yes |
| identical repeated query | yes | yes | yes |
| computePath | 4–6 µs | 4–6 µs | 5–9 µs |
| findNearestPoly | ~0.8 µs | | |

- **cs 0.2 / ch 0.1:** the 1.2 m stair disappears. The ledge filter plus 2 vx of erosion on each side leaves no
  cells, so the deck becomes unreachable and the 1.0 m corridor closes.
- **Off-mesh link over broken stair B:** the route to the top of B succeeds (solo build).
- **TileCache obstacles:**
  - Adding a 6 m box takes 0.15 ms for the call plus 0.23 ms for 6 `update()` iterations. The route grows from
    8.0 m to 10.2 m. Removing the box takes 0.13 ms and restores the route.
  - Plugging the corridor makes the route unreachable. Unplugging restores it.
  - 20 obstacles at once: 0.4 ms total.
- **Wide agent (radius 0.8):** needs its own navmesh. The navmesh is pre-eroded, so the 0.3 m mesh would route a
  0.8 m agent through the 1.0 m corridor. On the 0.8 mesh, the corridor and stair A close and the U-trap still
  solves.
- **Crowd, two agents swapping through the 1.0 m × 4 m corridor:** permanent deadlock. Neither agent arrives
  within 90 s, both are stationary for 82 s, and they stay 1.6 m apart. Detour Crowd has no yielding. With a
  2.0 m corridor they pass in 12.0 s (minimum separation 1.22 m, no direction flips). One crowd step takes
  about 5 µs.

### Engine scene: bespoke `engine/spatial` vs Recast (`exp-a2-same-scene.mjs`)

| query | bespoke length / time | Recast solo cs0.1 length / time |
|---|---|---|
| grid / navmesh build | 31 ms (2 levels, 600², median of 5) | 148 ms (cs 0.05: 321 ms) |
| wall | 11.42 m / 2.9 ms | 10.77 m / 11 µs |
| U-trap | 18.47 / 2.1 ms | 17.32 / 6 µs |
| narrow 1.0 m | 10.0 / 1.5 ms | 10.0 / 4 µs |
| oblique stair approach → deck | 12.94 / 6.0 ms | 11.53 / 5 µs |
| deck → ground below | 16.17 / 2.1 ms | 16.23 / 5 µs |
| same XZ, ground → deck | 16.58 / 7.8 ms | 15.87 / 6 µs |
| next to broken stair B → deck | 30.28 / 21.5 ms (via A) | 28.93 / 6 µs (via A) |
| long cross-level | 60.09 / 46 ms (95 k expansions) | 61.67 / 5 µs |
| both stairs broken | fails with `route.link-unusable` and names the missing treads | findPath unsuccessful (no reason) |
| wide 0.6 m through the gap | detours 23.6 m (per-query radius) | detours 23.2 m, but needs a separate 68 ms build |
| panel installed in gap | 30 ms rebuild + replan | TileCache 0.39 ms; solo full rebuild 69 ms |

Two notes on the table:

- **Recast lengths are shorter** because Recast hugs corners at the eroded radius. When its paths are measured on
  the bespoke clearance grid, minimum clearance is 0.17–0.25 m against the 0.28 m radius (at cs 0.1). This is
  quantisation of the voxel erosion.
- **The 0 clearance values in the JSON for stair legs are an artifact.** The ground-level segment enters the
  stair footprint, which the bespoke grid marks as blocked.

### Real campus

| subset / mode | tris | build | polys (tiles) | navmesh bytes | wasm heap | 300 random paths |
|---|---|---|---|---|---|---|
| chiba solo cs0.1 | 331 k | 0.67 s | 326 (1) | 55 KB | 64 MB (no growth) | 7 µs avg, 90% reach target |
| chiba tiled 64 | 331 k | 0.86 s | 677 (255) | 207 KB | 64 MB | 20 µs |
| chiba TileCache 48 | 331 k | 0.60 s | 924 (491) | 227 KB | 64 MB | 48 µs; a 6 m obstacle update takes 0.25 ms |
| all tiled cs0.2 | 1.49 M | 2.7 s | 1257 (456) | 313 KB | 142 MB | 26 µs |
| all tiled cs0.1 | 1.49 M | 4.4 s | 3050 (1776) | 962 KB | 171 MB | 75 µs |

- **Walkable area by height** is bucketed at 0 / 2.5 / 3 / 4.5 / 6–6.5 m. Upper floors and roofs are detected with
  no authoring: 336 m² at 3 m and about 190 m² at 6–6.5 m.
- **Roofs are walkable** unless they are filtered out, because the mesh carries no semantics. Most of the 10%
  "reach" misses come from random points on isolated roof or furniture islands.

## B. Rapier 0.21 (compat vs deterministic-compat, which are identical in behaviour)

| | compat | deterministic-compat |
|---|---|---|
| init (base64 WASM) | 42 ms | 32 ms |
| engine-scene trimesh | 1 ms | 1 ms |
| Chiba trimesh (331 k tris) | 90 ms | 92 ms |
| castShape beam 5.8×0.1×0.1, proving ground | 2.9 µs | 2.7 µs |
| castShape beam 5.8 m random sweeps, Chiba | 236 µs | 299 µs |
| intersectionsWithShape 5.8×0.4 OBB | 1.3 µs | 1.3 µs |
| KinematicCharacterController move | 35–70 µs | 46–69 µs |

castShape results:

- The beam swept into the wall hits at toi 0.395.
- The same beam swept on a clear line does not hit.
- The beam carried broadside through the 1.0 m gap hits. The same beam carried end-on through the gap is clear.
  Both are correct.

Character controller (KCC):

- **Autostep 0.25 m on stair A** climbs to the deck (y 2.99), but only when the desired translation has **no
  downward component**.
- **With `y: -0.05` in the desired move** (a common gravity pattern), autostep never triggers and the capsule
  stops at the first riser. This is a significant gotcha.
- **On broken stair B**, the capsule climbs 4 steps, reaches y 0.77 and stops at the gap. That is correct.

Snapshot of a small world: 52 KB (`takeSnapshot`).

## C. three-mesh-bvh 0.9.15

| | proving ground | Chiba 331 k |
|---|---|---|
| BVH build | 2.7 ms | 127 ms |
| OBB (`intersectsBox` with matrix) | ~29 µs per 0.05 m sample on the sweep (81 samples, 2.3 ms) | 5.0 µs per pose |
| sphere r 0.28 | | 2.6 µs |
| serialized BVH | | 6.9 MB |

- **There is no swept or continuous query.** Sweeps have to be sampled, and the step size limits how thin an
  obstacle the sweep can catch.
- **Beam into wall:** first hit at x = -18. The half-length is 2.9 m, so the hit is correct. End-on through the
  1.0 m gap: no hit, which is correct.

## D. SE(2) carried-load planner: NOT RUN

This experiment ran out of time; there are no measurements. See LIB_EVAL.md for the proposed design.

## Worker / Durable Object and bundle sizes

Sizes are gzip -9, measured from the package files, not a real bundle:

| artifact | raw | gzip |
|---|---|---|
| recast wasm (`./wasm` entry: .js + .wasm) | 560 KB + 339 KB | 60 KB + 131 KB |
| recast wasm-compat (inlined base64, default entry) | 1.01 MB | 236 KB |
| @recast-navigation/core + generators | 145 KB | 28 KB |
| rapier3d-compat `rapier.mjs` (inlined WASM) | 4.34 MB | 1.65 MB |
| rapier .wasm alone | 3.08 MB | 1.17 MB |
| three-mesh-bvh | 291 KB | 62 KB |

**Workers: not executed.** No wrangler/workerd test was run. Findings from reading the packages:

- **Both default ("compat") builds call `WebAssembly.instantiate(bytes)` on inlined base64.** Workers refuse to
  compile WASM from runtime bytes, so the compat builds should be expected to fail in a Worker or DO.
- **Recast has a workaround.** The `@recast-navigation/wasm/wasm` Emscripten factory accepts an `instantiateWasm`
  hook, so a wrangler-imported `WebAssembly.Module` can be passed in with `init(() => factory({instantiateWasm}))`.
- **Rapier has a partial workaround.** Its `rapier_wasm3d.js` has `initSync(module)`, but the compat package's
  `init()` takes no module. Using it would need a patch or wrapper.
- **Size limits are not a blocker.** Recast is about 0.2 MB gzip and Rapier about 1.2 MB, both well inside the
  Worker size limits.
