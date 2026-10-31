# Design decisions

Established game-engine patterns mapped onto the engine, the libraries evaluated, and what was built. The evaluation
sandbox is `mars/viewer/experiments/nav-eval/`. Spec: [spec.md](spec.md) §9, §26.

## Decisions

| Problem | Pattern studied | Built |
| --- | --- | --- |
| Human global paths, levels, construction changes | Recast/Detour corridors, area flags, off-mesh links; Unity carve-when-stationary and activated links | **Bespoke** multi-level 0.1 m raster + exact EDT clearance + A* with stair links (`spatial/`). Pure TS (runs in the Durable Object without WASM), per-query radius, exact clearance, named blockers in diagnostics. Stair usability comes from world state, not voxelized geometry |
| Campus-scale fallback | Recast TileCache | Not built. If raster rebuilds get too slow: feed Recast the engine's semantic surfaces and obstacles (not the render GLB), keep stairs as links driven by `Link.usable`, and keep the EDT check as the final validator |
| Local avoidance | ORCA / RVO, Detour Crowd, yielding, side hysteresis, Reynolds arrival | **Bespoke** traffic resources for single-file passages, right of way, lateral passing offsets and explicit waits ([movement.md](movement.md)). Detour Crowd deadlocked in a 1 m corridor |
| Arrival and failure modes | Godot NavigationAgent lessons | One-shot arrival, tolerance rules and an explicit navigation sync point (`Spatial.sync`, epochs) |
| Carried loads | Formation movement | **Bespoke** hybrid A* over (x, z, θ) on the clearance grid with swept checks; carriers derived from grip slots ([carry.md](carry.md)). No library models crew + load formations |
| Collision validation | Rapier shape casts, three-mesh-bvh | Exact 2D OBB/prism tests (SAT + y range). Rapier works but needs a WASM wrapper in Workers; add it only if 3D sweeps become necessary |
| Interaction slots, sequences, runtime | Unreal Smart Objects; template vs bound plan; hierarchical state per action | Reservable slots as runtime reservations; `SequenceTemplate` → `BoundPlan`; per-action phases. No GOAP or behaviour trees in the core |
| Cameras | Cinemachine decollider/deoccluder, ClearShot, group framing, damping | Separate placement, readability and temporal evaluators; candidate family with hysteresis live; Viterbi with lookahead for takes; stored tracks are resolved data ([camera.md](camera.md)) |
| Replay and versioning | Gameplay replay systems, event log + checkpoints | Content-hashed checkpoints, resumable snapshots for a verified subset, takes with resolved keyframes ([takes-and-plans.md](takes-and-plans.md)) |
| Hands and poses | IK, additive layers, speed-matched playback | View-only: two-bone arm IK, procedural posture and gait layers, Walk clip rate matched to ground speed ([poses.md](poses.md)) |
| Sun position | NOAA solar equations | Pure-TS sun model with UTC input (`env/sun.ts`), no dependency |

## Library evaluation

Measured on the proving ground (60 × 60 m, two levels) and on the campus GLB:

| | Bespoke `engine/spatial` | Recast (recast-navigation-js) | Rapier | three-mesh-bvh |
| --- | --- | --- | --- | --- |
| Build, proving ground | ~30 ms | ~150 ms solo, ~65 ms TileCache | ~1 ms trimesh | ~3 ms BVH |
| Long cross-level route | tens of ms | microseconds | n/a | n/a |
| Construction change | grid patch + replan | TileCache obstacle < 1 ms | collider add ≈ free | rebuild |
| Per-radius agents | per query, from the clearance field | one navmesh per radius class | n/a | n/a |
| Failure diagnostics | names the link and missing treads | status bits | n/a | n/a |
| Clearance guarantee | exact | voxel erosion comes within a few cm of walls at the agent radius | — | — |
| Browser size | 0 | ~190 KB gzip WASM | ~1.2 MB WASM | ~62 KB |

Worker / Durable Object feasibility (read, not executed): the compat builds of Recast and Rapier inline WASM and compile
it at runtime, which Workers disallow; Recast's non-compat factory accepts a pre-imported module, Rapier needs a wrapper.
The pure-TS engine runs in the Durable Object as is.

## Recommendations kept

- Keep the bespoke planner authoritative for rehearsal and validation; adopt Recast only as a scale path, fed semantic
  geometry, never the render GLB (roofs come out walkable and nothing is semantic).
- Do not adopt Detour Crowd for narrow passages.
- Use three-mesh-bvh only for browser-side camera rays against render meshes, never for authoritative validation.
- Determinism across JS engines needs deterministic transcendentals (`core/math.ts`) and takes that store resolved motion,
  so replay never re-simulates.
