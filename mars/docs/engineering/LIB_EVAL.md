# Navigation and collision library evaluation (SPEC §8, §10, §11, §26, §28)

Date: 2026-09-27. Sandbox: `viewer/experiments/nav-eval/`. Raw numbers and rerun commands are in `RESULTS.md` there.
Machine: M3 Max, Node 26. Versions: recast-navigation-js 0.43.1, Rapier 0.21.0 (compat and deterministic-compat),
three-mesh-bvh 0.9.15.

Two things were not measured:

- **The SE(2) carried-load planner (experiment D):** no numbers. The recommendation below is a design argument.
- **Running inside a real Cloudflare Worker or Durable Object:** not executed. The Worker section is based on
  reading the packages.

## Headline numbers

| | bespoke `engine/spatial` (grid + EDT + A*) | Recast (recast-navigation-js) | Rapier | three-mesh-bvh |
|---|---|---|---|---|
| build on engine proving ground (60×60 m, 2 levels) | 31 ms | solo 148 ms at cs 0.1 (321 ms at cs 0.05); TileCache 64 ms | trimesh 1 ms | BVH 2.7 ms |
| build on campus.glb, Chiba (331 k tris) | not tested (needs mesh → Surface/Obstacle extraction) | solo 0.67 s, tiled 0.86 s, TileCache 0.60 s | trimesh 90 ms | 127 ms |
| build on campus.glb, full (1.49 M tris) | not tested | tiled 2.7 s (cs 0.2) / 4.4 s (cs 0.1), 171 MB wasm heap, 0.96 MB navmesh | not tested | not tested |
| long cross-level route | 46 ms (95 k expansions) | 5 µs (about 10,000× faster) | n/a | n/a |
| construction change (panel in gap) | 30 ms rebuild + replan | TileCache obstacle 0.25–0.4 ms; solo rebuild 69 ms | add collider ≈ free | rebuild |
| per-radius agents | per query, from the clearance field | one navmesh per radius class | n/a | n/a |
| failure diagnostics | names the link and the missing treads | status bits only | n/a | n/a |
| determinism | deterministic (engine tests) | byte-identical rebuilds and repeated queries | deterministic build available | pure JS |
| shape sweep (5.8 m beam) | none yet | none | castShape 3 µs (simple scene) / 240–300 µs (Chiba) | sampled only: 5 µs per pose on Chiba |
| gzip size (browser) | 0 | 190 KB (wasm entry) / 236 KB (compat) + 28 KB JS | 1.17 MB wasm (1.65 MB compat JS) | 62 KB |

## What worked, and what did not

### Recast

What worked on every proving-ground case (solo, tiled and TileCache):

- the wall;
- the U-trap;
- the 1.0 m corridor;
- same-XZ multi-level routing: it stayed on the correct floor and went via the stair;
- the complete stair usable;
- the broken stair unreachable, because the geometry itself has the gap;
- an off-mesh link bridging the broken stair;
- query-time disabling of the stair with `setPolyFlags` + `QueryFilter.excludeFlags`;
- TileCache box obstacles re-routing in under 0.5 ms, including 20 obstacles at once.

On the real campus it found the upper floors (3 m, 4.5 m and 6 m bands) with no authoring. Builds and queries are
deterministic.

Gotchas:

- **`walkableHeight`, `walkableClimb` and `walkableRadius` are in voxels, not metres.** The defaults (2, 2, 0.5)
  look like metres.
- **Violating a documented limit crashes WASM instead of returning an error.** `detailSampleDist < 0.9` causes
  "memory access out of bounds".
- **At cs 0.2 a 1.2 m stair disappears.** The ledge filter plus erosion leaves no cells, so the deck becomes
  unreachable. cs 0.1 or finer is needed for Mars-scale stairs and 1 m passages.
- **Paths can undercut the requested radius.** Measured on the exact EDT, paths come within 0.17–0.25 m of walls
  for a 0.28 m radius because of voxel quantisation.
- **Failure is silent.** `computePath` returns `success:true` with a partial path when the target is unreachable,
  so the caller has to check the endpoint distance.
- **Roofs are walkable** because the mesh has no semantics. Filtering needs areas or flags.
- **`generateTileCache` does not expose off-mesh connections.** They require a custom `TileCacheMeshProcess`.
- **Detour Crowd deadlocks head-on in a 1.0 m corridor**, with both agents frozen for 82 s. It has no yielding.
  In a 2.0 m corridor the agents pass cleanly in 12 s.

### Rapier

- **Continuous shape casts are correct and cheap.** The beam hits the wall, clears the open line, is blocked
  broadside in the 1.0 m gap and fits end-on. `intersectionsWithShape` takes 1.3 µs.
- **The kinematic character controller climbs the complete stair and stops at the missing treads.** This only
  works when the desired translation has no downward component. Adding `y:-0.05` (the usual way to apply gravity)
  silently disables autostep.
- **Casts are much more expensive on dense triangles.** Against a single 331 k-triangle trimesh, a cast costs
  240–300 µs. Colliders should come from coarse proxies (boxes and prisms), not render meshes.
- **The deterministic build behaves identically and costs about 10–25% more.**
- **Size:** 1.2 MB gzip of WASM.

### three-mesh-bvh

- It is small (62 KB) and fast for static OBB and sphere overlap: 5 µs and 2.6 µs on Chiba.
- It has no continuous sweep, so sweeps have to be sampled.
- A serialized BVH of Chiba is 6.9 MB.

## Worker / DO feasibility (not executed; based on reading the packages)

- **The compat entry points of both libraries will not run as-is.** They inline base64 WASM and call
  `WebAssembly.instantiate(bytes)` at runtime, and Workers disallow runtime WASM compilation.
- **Recast has a viable path.** Its non-compat Emscripten factory (`@recast-navigation/wasm/wasm`) supports an
  `instantiateWasm` hook, so a wrangler-imported `.wasm` module can be passed in.
- **Rapier's path needs a wrapper or patch.** `rapier_wasm3d.js` exposes `initSync(module)`, but the compat
  package's `init()` takes no module.
- **Size is not the blocker** for either library.
- **The bespoke pure-TS engine runs in the DO today** with no WASM at all.
- **Next step:** a 20-minute `wrangler dev` smoke test should confirm both workarounds before anyone commits to
  them.

## Recommendation

1. **Human navmesh pathing, multi-level, construction changes:**
   - **Now:** keep the bespoke `engine/spatial` planner as the authoritative planner for the proving ground and
     the rehearsal/validation path. Reasons:
     - It is pure TS and deterministic, and runs in the DO with no WASM.
     - It handles per-query radius from the EDT.
     - It enforces exact clearance.
     - It gives named failure reasons (`route.link-unusable`, missing treads).
     - Stair links are first-class and semantic. Usability comes from world state, not from voxelising geometry.
   - **Scaling risk:** 46 ms per long route and 31 ms per rebuild on 60×60 m. The full campus is about 265×195 m
     (about 14× the area), so expect roughly 0.5 s per rebuild and tens to hundreds of ms per route at 0.1 m
     cells.
   - **Mitigation:** adopt Recast (non-compat WASM entry) as a scale path if campus-wide routing or many agents
     become necessary. It is about 10,000× faster per query and supports TileCache for dynamic construction.
     Feed it the engine's semantic Surfaces and Obstacles rather than render meshes, keep stairs as off-mesh
     links driven by `Link.usable`, and keep a bespoke EDT clearance check as the final validator, because
     voxel erosion undercuts the radius.
   - **Don't** hand the render GLB to Recast as the source of truth: roofs come out walkable and nothing is
     semantic.
2. **Local avoidance:** do not adopt Detour Crowd as-is, because it deadlocks in narrow passages. Write
   project-owned steering (RVO/ORCA-lite) with an explicit yield/wait protocol driven by corridor reservations.
   SPEC §28 requires "one yields/waits". If Recast is adopted, Crowd is acceptable only in open areas.
3. **Carried-load SE(2) planning:** bespoke, in project code. No library covers formations. Not measured yet. The
   proposed design reuses the engine's per-level EDT grids:
   - a hybrid-A* / state lattice over (x, z, yaw) with yaw steps of 5–10°;
   - a cheap first test that the load and carrier OBB union is clear using the EDT disc cover;
   - an exact OBB-vs-obstacle check with the existing `obbOverlap` SAT test.

   A 1.5 m corridor corner must fail and a 2.5 m corridor must pass. Until that experiment exists, this item has
   no numbers.
4. **Collision and shape-cast validation:** the engine's obstacles are already OBB prisms, so exact 2D SAT plus a
   y-range check is enough for plan validation and needs no library. Add Rapier (deterministic-compat, colliders
   built from coarse proxies) only if 3D shape casts become necessary, for example:
   - carried loads pitched on stairs;
   - raising frames through an arc;
   - camera decollision against real geometry;
   - the kinematic character controller for free walking.

   Use three-mesh-bvh (62 KB) for browser-side camera rays and overlap against render meshes, not for authoritative
   validation.
