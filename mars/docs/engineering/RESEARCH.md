# Engine-pattern research: decision notes

Scope: mature game-engine patterns mapped onto the Mars world engine (Three.js + TypeScript;
pure-TS deterministic simulation core running in Node tests, the browser, and a Cloudflare
Durable Object). Companion to `SPEC.md` (sections 8–18, 21–23, 26–29, 34) and `AUDIT.md`.
Each topic: Problem · Established pattern (docs) · Adopt? · Mapping to Mars · Why · Test.
Version numbers were read from the npm registry on 2026-09-27. Items marked
"(prior knowledge; not re-verified)" could not be re-fetched during this pass.

Conventions used below: "core" = the pure-TS sim core; "view" = Three.js renderer; "DO" =
Durable Object authority; Mars units are metres, Y up (matches Recast/Detour and Rapier).

---

## 1. Recast/Detour: generation, corridors, links, crowds

**Problem.** Humans, EUCs and forklifts need global routes over a campus whose walkable
surface changes as floors/stairs/walls are built; routes must be corridors (SPEC §10), not
brittle point lists; multiple floors overlap in XZ.

**Established pattern.** Recast voxelises input triangles into a heightfield, filters
spans by agent size, builds regions/contours/polys; Detour queries the poly mesh; DetourCrowd
adds local steering. Docs: https://recastnav.com/structrcConfig.html ,
https://recastnav.com/classdtPathCorridor.html , https://recastnav.com/classdtCrowd.html .
- `rcConfig` guidance (world units = wu, voxels = vx): `cs` ≈ r/2 (outdoor) or r/3 (tight
  indoor) for agent radius r; `ch` ≈ cs/2 (lower if holes appear at height steps);
  `walkableHeight = ceil(h/ch)` (min 3 vx); `walkableClimb = ceil(maxClimb/ch)`;
  `walkableRadius = ceil(r/cs)`; `walkableSlopeAngle` < 90 (practical ≤ 85);
  `maxEdgeLen ≈ walkableRadius*8`; `maxSimplificationError` 1.1–1.5 (start 1.3);
  `minRegionArea`/`mergeRegionArea` are vx²; `detailSampleDist` 0 or ≥ 0.9 wu.
  Mars starting point for humans (r=0.3 m, h=1.8 m, climb 0.2 m — a 2×4-on-edge step is
  0.09 m, a stair riser ~0.18 m): cs=0.15, ch=0.075, walkableRadius=2, walkableHeight=24,
  walkableClimb=3, slope 45°. Forklift/EUC profiles need separate navmeshes (bigger r, lower
  climb, no stairs).
- **Overlapping floors** are native: the heightfield keeps multiple spans per column, so a
  plywood upper floor and the ground below become separate polys as long as
  `walkableHeight` clearance separates them. Failure mode: `findNearestPoly(center,
  halfExtents)` returns the *closest* poly inside the AABB, so with halfExtents.y larger than
  half the floor spacing (2.4 m at Mars) a query near a floor edge may snap to the wrong
  level. Detour's own crowd uses `halfExtents = (2r, 1.5r, 2r)` (DetourCrowd.cpp l.389).
  Also: success + `nearestRef == 0` means "nothing found" — always check the ref.
- **Tiled navmesh + TileCache.** TileCache stores compressed heightfield layers per tile
  and re-derives polys when box/cylinder obstacles are added/removed (cheap, ≈ms per tile,
  64-request queue). Full tile rebuilds are needed for geometry that is not a box/cylinder
  (new floor, stair run, wall with door). TileCache assumes small tiles (32–64 vx).
- **Corridor + funnel.** `dtPathCorridor` holds the poly path; `movePosition` and
  `moveTargetPosition` slide endpoints while pruning/extending the corridor;
  `findCorners` runs string pulling (funnel) to give the next 2–3 corners. dtCrowd calls
  `optimizePathVisibility` every update within `pathOptimizationRange` (when
  `DT_CROWD_OPTIMIZE_VIS`) and `optimizePathTopology` every 0.5 s (`OPT_TIME_THR`, l.912)
  as a local partial replan. Replan triggers in dtCrowd (l.942–1035): corridor `isValid`
  fails within `CHECK_LOOKAHEAD=10` polys after a navmesh change; agent/target poly ref
  invalid; or path is partial and `targetReplanTime > 1.0 s` (`TARGET_REPLAN_DELAY`).
- **Off-mesh connections** are point-to-point links (start, end, radius, bidirectional,
  area, flags) baked into tiles; crowd agents entering one switch to
  `DT_CROWDAGENT_STATE_OFFMESH` and are lerped start→end over
  `tmax = dist2D/maxSpeed*0.5` (l.1164) — i.e. Detour does *not* animate the traversal;
  the game owns it.
- **Area/flags.** Each poly has an 6-bit area id and 16-bit flags; `dtQueryFilter` has
  per-area cost and include/exclude flag masks. "Incomplete stairs" = a stair poly/link
  whose flag is excluded until the recipe marks it usable; no rebake needed for flag flips
  (`navMesh.setPolyFlags`), but geometry appearing/disappearing does need a tile rebuild.
- **dtCrowd local avoidance** is sampling-based velocity planning (not ORCA): candidate
  velocities are scored by `velBias=0.4, weightDesVel=2.0, weightCurVel=0.75,
  weightSide=0.75, weightToi=2.5, horizTime=2.5`, adaptive pattern `divs=7, rings=2,
  depth=5` (l.408–417). Then position integration and a soft push-apart collision resolve
  (`COLLISION_RESOLVE_FACTOR=0.7`). Corridor max 256 polys; crowd is "local movement"
  only and expects small `dt`.

**Adopt? Partially.** Adopt Recast generation (tiled), Detour query/corridor/funnel,
area flags, off-mesh connections. Do **not** adopt dtCrowd as the mover of record.

**Mapping to Mars.** One navmesh per movement profile (`human`, `euc`, `forklift`),
rebuilt per tile when construction events change walkable geometry (§10 "construction
must alter future navigation"). Stairs: per-flight off-mesh connection (or a real stair
poly strip once complete) gated by a `usable` flag driven by the recipe predicate. The core
owns a `PathCorridor` type mirroring dtPathCorridor (poly refs + corners), and a mover
that integrates within it; dtCrowd is used only as a reference implementation for
scoring/anti-oscillation ideas (topic 5). Reason: dtCrowd owns positions, has
non-deterministic-friendly internals (variable dt, global agent ordering) and cannot
express carry formations.

**Why.** Recast is the only mature, free navmesh builder that runs in WASM in Node and
browser; corridors + funnel are exactly the SPEC §10 "navigable corridor" representation.

**Test it implies.** Proving-ground: (a) build a 2-level rack bay; query nearest poly at a
point 0.3 m from the upper-floor edge with halfExtents.y=0.5 → must return the upper floor
poly; with y=3 → document the mis-snap. (b) Toggle the `stairs.usable` flag; `findPath`
ground→upper must fail before and succeed after without a rebake. (c) Install a wall tile
rebuild; an in-flight corridor must report `isValid=false` and trigger exactly one replan.

---

## 2. recast-navigation-js (isaac-mason) specifics

**Problem.** Need Recast/Detour in TypeScript for browser and Node tests, with
serialisable navmeshes and Three.js input helpers.

**Established pattern / facts (npm 2026-09-27).** `recast-navigation@0.43.1` (meta
package: `@recast-navigation/core` 0.43.1 + `@recast-navigation/generators` 0.43.1);
`@recast-navigation/three` 0.43.1; `@recast-navigation/wasm` 0.43.1 unpacked ≈ 1.99 MB
(contains both the normal and `wasm-compat` base64-inlined builds; the shipped `.wasm`
is roughly 600–800 kB, gzip ≈ 250–300 kB — prior knowledge; not re-verified). ESM,
Node and browser; `await init()` before use. Docs:
https://github.com/isaac-mason/recast-navigation-js ,
https://docs.recast-navigation-js.isaacmason.com/modules/generators.html .
- Generators: `generateSoloNavMesh(positions, indices, cfg)`,
  `generateTiledNavMesh(...)` (adds `tileSize`), `generateTileCache(...)` (adds
  `expectedLayersPerTile`, `maxObstacles`, `tileCacheMeshProcess`). `cfg` mirrors
  `rcConfig` field names (`cs, ch, walkableSlopeAngle, walkableHeight, walkableClimb,
  walkableRadius, maxEdgeLen, maxSimplificationError, minRegionArea, mergeRegionArea,
  maxVertsPerPoly, detailSampleDist, detailSampleMaxError, borderSize`) plus
  `offMeshConnections[]` (`startPosition, endPosition, radius, bidirectional, area, flags,
  userId`), `bounds`, `buildBvTree`. Input: flat arrays, right-handed, CCW indices.
- Three helpers (`@recast-navigation/three`): `threeToSoloNavMesh(meshes, cfg)`,
  `threeToTiledNavMesh`, `threeToTileCache`, `getPositionsAndIndices(meshes)`,
  `NavMeshHelper`, `CrowdHelper`, `TileCacheHelper`, `DebugDrawer`. They bake world
  transforms into the vertex arrays.
- Query: `NavMeshQuery.computePath(start, end, {filter, halfExtents, maxPathPolys,
  maxStraightPathPoints})` (findNearestPoly → findPath → findStraightPath in one call),
  `findClosestPoint`, `findRandomPointAroundCircle`, `moveAlongSurface`, `raycast`,
  `getPolyHeight`; `QueryFilter` with `includeFlags/excludeFlags/setAreaCost`. Default
  halfExtents are `(1,1,1)` (prior knowledge; not re-verified) — set explicitly.
- Crowd: `new Crowd(navMesh, {maxAgents, maxAgentRadius})`; `crowd.addAgent(pos,
  {radius, height, maxAcceleration, maxSpeed, collisionQueryRange, pathOptimizationRange,
  separationWeight, updateFlags, obstacleAvoidanceType, queryFilterType})`;
  `crowd.update(dt)` fixed-step, or `update(dt, timeSinceLastFrame, maxSubSteps)` for
  fixed step + interpolation (README explicitly: variable dt is non-deterministic).
  Agent: `requestMoveTarget/requestMoveVelocity/resetMoveTarget/teleport/state()/corners()`.
- Serialisation: `exportNavMesh(navMesh) → Uint8Array`, `importNavMesh(bytes)`;
  `exportTileCache(navMesh, tileCache)` / `importTileCache(bytes, meshProcess)`. TileCache
  off-mesh links require a custom `TileCacheMeshProcess`.
- Determinism caveats: WASM float math is IEEE-754 deterministic per build, but generation
  is order-sensitive to the input triangle list; `Crowd.update` with variable dt is not
  reproducible; the WASM heap is global state (one `init()` per isolate; a DO isolate must
  re-import the navmesh bytes on wake).
- Escape hatch documented in the README: use recast only as a *generator* and query the
  exported polys with your own code (three-pathfinding style) if the WASM budget or API
  shape doesn't fit.

**Adopt? Yes** for generation + query + serialisation; **no** for `Crowd` as the mover.

**Mapping to Mars.** `viewer/engine/nav/`: `NavBuilder` (Three meshes → per-profile
navmesh bytes, run in a worker in the browser and inline in Node); `NavIndex` (imported
navmesh + query per profile); navmesh bytes hashed and stored as part of the world
checkpoint so a replay uses the exact mesh it was planned on (SPEC §23/25). Tile rebuilds
are triggered by construction events on the DO and shipped as tile byte diffs.

**Why.** Node + browser parity, serialisable bytes, and Three helpers remove the two
biggest integration risks; the 2 MB package (≈ sub-MB wire) is acceptable for a desktop
tool.

**Test it implies.** Node test: build navmesh from the proving-ground geometry, export,
import in a fresh `init()`, and assert identical `computePath` output and identical
SHA-256 of the exported bytes across two runs (generation determinism guard).

---

## 3. Unity AI Navigation patterns

**Problem.** Which of Unity's agent/obstacle/link/animation-coupling conventions are
worth copying so movers, obstacles and animation don't fight over one transform.

**Established pattern.** Docs:
https://docs.unity3d.com/Packages/com.unity.ai.navigation@2.0/manual/MixingComponents.html ,
https://docs.unity3d.com/Packages/com.unity.ai.navigation@2.0/manual/CouplingAnimationAndNavigation.html ,
https://docs.unity3d.com/Packages/com.unity.ai.navigation@2.0/manual/AboutObstacles.html ,
https://docs.unity3d.com/Packages/com.unity.ai.navigation@2.0/manual/NavMeshLink.html .
- **NavMeshSurface** bakes per agent type (radius/height/climb/slope) from collected
  geometry; links and modifiers set area types. One surface per agent type = our
  per-profile navmesh.
- **NavMeshObstacle carve vs avoid.** Non-carving obstacles are only seen by local
  avoidance, so agents "might not be able to find [their] way around" a cluttered scene;
  carving cuts a hole so *pathfinding* reroutes. Carve only when stationary (`Carve Only
  Stationary`, move threshold, time-to-stationary) and expect a one-frame delay before
  queries see the change. Never enable agent + obstacle on the same object.
- **NavMeshLink / OffMeshLink.** Width, cost override, bidirectional, area type,
  `activated` toggle. Agent side: `autoTraverseOffMeshLink` (default: teleport-lerp
  across), or manual: detect `isOnOffMeshLink`, read `currentOffMeshLinkData`
  (start/end/link type), play the climb, then `CompleteOffMeshLink()`. Facing is the
  game's job. `autoRepath` re-plans when the path becomes invalid (partial/stale).
- **Animation ownership ("mixing navigation with animation").** Two sanctioned modes:
  (a) *animation follows agent* — agent owns the transform, `agent.velocity` drives a
  blend tree (simple, robust, some foot sliding); (b) *agent follows animation* — set
  `updatePosition=false`, `updateRotation=false`, keep the agent as a simulation point
  (`nextPosition`), drive the blend tree from `nextPosition - transform.position`
  smoothed, apply root motion in `OnAnimatorMove`, and each frame pull the character back
  toward the agent when drift exceeds `agent.radius`. Physics: only kinematic rigidbodies
  alongside an agent; a dynamic body + agent is a race condition.

**Adopt? Yes** (carving semantics, activated links, manual link traversal, and mode (a)
"animation follows agent" with a drift-corrected variant of (b) for carries).

**Mapping to Mars.**
- Placed trailers/piles/vehicles that stop moving → "carve" (TileCache obstacle or tile
  rebuild); moving people/EUCs → local avoidance only. A carve is committed only after
  `timeToStationary` sim-seconds and is a world event (so replays see it).
- Stairs/ladders/vehicle mounts = off-mesh links with `usable` flag; traversal is always
  *manual*: the mover enters a `TraverseLink` phase, orients to the link's entry facing,
  plays the stair/mount clip, and completes when the core says so. No auto-lerp.
- Transform ownership rule: the **core mover owns position+yaw** for every actor; the
  view's animation layer reads velocity and never writes back (mode a). For carries, the
  formation solver owns the load pose and derives carrier poses (topic 6); IK adjusts
  hands only (topic 11). Nothing else writes `position`.
- `autoRepath` → core `Mover.replanIfInvalid()` on navmesh-change events, rate-limited.

**Why.** These are the exact edge cases the SPEC lists (stairs from the side, obstacles
invisible to pathfinding, agent/animation fights). Unity's split "simulation point vs
rendered transform" is the cleanest way to keep the core deterministic while the view
smooths.

**Test it implies.** (1) Place a trailer across a route after the walker starts: with
carving the walker must replan before contact (distance-to-obstacle at first heading
change > 1 m); without carving it must fail the test. (2) Stair link with `usable=false`:
`computePath` must not use it; set true → path uses it and the mover enters
`TraverseLink` with |yaw − linkFacing| < 15° at entry. (3) View drift test: rendered
position − core position never exceeds `radius` over a 30 s walk.

---

## 4. Godot NavigationAgent: failure modes and best practices

**Problem.** Godot's agent is the most-documented list of "why does my agent jitter /
never arrive / spin at a doorway" — a checklist for our mover.

**Established pattern.** Docs:
https://docs.godotengine.org/en/stable/tutorials/navigation/navigation_using_navigationagents.html ,
https://docs.godotengine.org/en/stable/classes/class_navigationagent3d.html .
- `path_desired_distance` (default 1.0): advance to the next waypoint when within it;
  `target_desired_distance` (1.0): target counts as reached; `path_max_distance` (5.0):
  replan when pushed further than this from the path. Too-small desired distances vs
  agent speed×dt → the agent overshoots a waypoint and turns back ("dancing"); too-large →
  corner cutting through walls. Rule: desired distance ≥ speed·dt·2 and ≤ agent radius.
- `target_reached` fires **once per target**; `navigation_finished` once per path. Setting
  `target_position` every frame resets the path and re-fires everything — the classic
  "never reaches target" bug. Set targets only on intent change.
- `get_next_path_position()` must be called exactly once per physics frame (it advances
  internal state); calling it inside a `waypoint_reached` callback recurses.
- Avoidance is RVO2 (`avoidance_enabled`, `radius`, `neighbor_distance` 50, `max_neighbors`
  10, `time_horizon_agents` 1.0, `time_horizon_obstacles` 0.0, `avoidance_priority`,
  layers/masks). The safe velocity arrives asynchronously via `velocity_computed` and must
  be applied in `_physics_process`; avoidance **does not affect pathfinding** —
  NavigationObstacle3D only affects RVO unless its `affect_navigation_mesh` carve is used.
- **Map sync delay**: region/agent changes apply on the next `NavigationServer` sync (one
  physics frame); querying in `_ready()` returns an empty path. Wait for `map_changed`.
- Path post-processing: `corridorfunnel` (funnel; default) vs `edgecentered` (crosses
  edge midpoints, safer on very coarse meshes); `simplify_path` + `simplify_epsilon` to
  drop collinear waypoints.

**Adopt? Yes** as a checklist; **no** to any of its APIs directly.

**Mapping to Mars.** Mover config per profile: `waypointTolerance` (≥ 2·speed·dt),
`arriveTolerance`, `maxPathDeviation`; `arrived`/`pathFinished` are one-shot events in
the action lifecycle (→ `completed`), never re-evaluated per frame. Navmesh changes are
applied at a *sync point* at the start of a sim tick (the DO batches construction events),
and queries during a tick see a stable mesh — same contract as Godot's server sync but
explicit and deterministic. Intent changes (`requestMoveTarget`) are actions, so a
director cannot spam them per frame.

**Why.** Every item is a known cause of jitter/oscillation that SPEC §28 forbids;
encoding them as config invariants (with asserts) is cheap.

**Test it implies.** Parametric jitter test: walk a 20 m S-curve at 1.4 m/s with dt=1/30
for tolerances {0.02, 0.1, 0.3} m; assert no heading reversal > 120° within 0.5 s and
that arrival fires exactly once. Sync test: issue a wall-install event and a path query in
the same tick; the query must see the pre-event mesh, the next tick the post-event mesh.

---

## 5. Local avoidance: RVO/ORCA, yielding, priority, anti-oscillation, arrival

**Problem.** Two walkers meeting in a 0.9 m gap between a trailer and a rack must pass
or one must wait, without jitter, path flipping, or symmetric deadlock (SPEC §28 "narrow
passage").

**Established pattern.** ORCA (van den Berg, Guy, Lin, Manocha, ISRR 2011,
https://gamma.cs.unc.edu/ORCA/ ): each pair induces a velocity-obstacle half-plane; each
agent takes half the responsibility; the new velocity is the closest-to-preferred point
of the intersection (2-D linear program), with `timeHorizon` trading early reaction for
freedom (RVO2 params https://gamma.cs.unc.edu/RVO2/documentation/2.0/params.html :
`neighborDist, maxNeighbors, timeHorizon, timeHorizonObst, radius, maxSpeed`). Detour's
alternative is sampled velocity scoring (topic 1). Known failures of both: symmetric
head-on deadlock (agents mirror each other), oscillation between sides when the
preferred velocity is recomputed from a re-funnelled corner every frame, and "pushing"
into walls when the navmesh boundary isn't included as an obstacle (Detour fixes this
with `dtLocalBoundary` segments; RVO2 needs explicit obstacle polylines). Reynolds'
*arrival* (https://www.red3d.com/cwr/steer/ ): desired speed = maxSpeed·clamp(d/slowRadius),
and *queuing*: brake when a neighbour is ahead inside a cone.
Game practice (prior knowledge; not re-verified): asymmetric responsibility by priority
(Unity `avoidancePriority` 0–99, lower = more important; Godot `avoidance_priority`),
side-commitment hysteresis (keep the last chosen side unless the alternative is better by
> ~20 % for > ~0.5 s), and explicit *yield*: if the corridor width < 2·(rA+rB)+margin and
the other agent is inside the passage, the lower-priority agent stops at a pull-off point
(nearest navmesh point outside the passage) until the passage is clear.

**Adopt? Partially.** ORCA-style half-planes for 2–10 walkers (deterministic, in-core);
explicit yield logic for narrow passages; hysteresis on side choice; Reynolds arrival.
No sampled-velocity Detour crowd.

**Mapping to Mars.** Core `Steer` module: input = corridor corners (from the funnel),
neighbours within `neighborDist=3 m`, local boundary segments from the navmesh; output =
velocity. Priority order: carrying formations (topic 6) > forklift > walker with an active
action > idle walker. Formations are treated by others as *obstacles* (capsule chain of the
load), never as agents to negotiate with. Passage detection uses the corridor's poly width
at the funnel corner; yield/pull-off is a mover *phase* (`blocked/paused` in the action
lifecycle, with `reason: "yielding_to:<id>"`) so the director can see it. Fixed order of
agent updates (by id) and no randomness → deterministic. Arrival: slow radius = 1.0 m,
stop at `arriveTolerance`, then face the action's `facing` over 0.3 s.

**Why.** ORCA is a closed-form LP per agent (cheap, no sampling RNG), and Mars scenes have
few movers; the hard cases are semantic (who yields) not numeric, so they belong in
explicit rules the tests can name.

**Test it implies.** Proving-ground `narrow_passage`: two walkers, opposite ends of a
0.9 m gap (radius 0.3 each) → one must reach `yielding_to` state, the other passes, total
time < 12 s, zero corridor re-plans, heading-change energy (Σ|Δyaw|) < 2π. Widen gap to
1.4 m → both pass, no yield. Head-on on open ground → no deadlock (both reach targets
< 1.5× straight-line time) and no side flip after the first 0.5 s.

---

## 6. Group/formation movement carrying a shared load

**Problem.** 2–4 people carry a 2.4–5.8 m upright/beam/plywood through the campus; the
crew+load is one rigid moving body in SE(2) (x, y, yaw) plus a carry height; a route valid
for a person is invalid if the load cannot swing through a corner (SPEC §11, §28 "long load
around corner").

**Established pattern.**
- Formations in RTS practice: Pottinger, "Coordinated Unit Movement" / "Implementing
  Coordinated Movement" (Game Developer 1999,
  https://www.gamedeveloper.com/programming/coordinated-unit-movement ): a *group* has a
  single planned path and a formation with slots; units steer to their slots relative to
  the group's pose; the group speed is limited by the slowest slot and the formation
  rotates as a unit through turns. Reynolds' *leader following* is the light version.
- Piano mover's problem: motion planning of a rigid body among obstacles = planning in
  configuration space; for a planar rigid body C = SE(2) (Latombe, *Robot Motion
  Planning*, 1991; prior knowledge). Practical solver: **hybrid-state A\*** (Dolgov,
  Thrun, Montemerlo, Diebel, "Practical Search Techniques in Path Planning for Autonomous
  Driving", STAIR 2008): discretise (x, y, θ) into cells but keep a continuous state per
  cell; expand with motion primitives (arc segments at fixed steering set, forward and
  reverse, with penalties for reverse and direction change); heuristic = max(non-holonomic
  no-obstacle distance via Reeds-Shepp/Dubins, holonomic-with-obstacles 2-D DP distance);
  analytic Reeds-Shepp "shots" to the goal when close; then smooth with a Voronoi-field
  cost. Reeds-Shepp (Pacific J. Math 1990; OMPL
  https://ompl.kavrakilab.org/classompl_1_1base_1_1ReedsSheppStateSpace.html ) is the
  optimal-path family for a car that can reverse; Dubins for forward-only.
- Multi-robot cooperative transport review (Tuci, Alkilabi, Akanyeti, Frontiers Robotics
  & AI 2018, https://www.frontiersin.org/articles/10.3389/frobt.2018.00059/full ):
  distinguishes pushing / grasping / caging; grasping transport = leader–follower or
  centralised planning of the object pose with carriers derived from grip points.

**Adopt? Yes** — centralised planning of the *load pose*, carriers derived from grip slots.

**Mapping to Mars (recommended approach).**
1. **Carry definition** per asset (`CarryProfile`): allowed crew sizes; grip slots as
   load-local points (e.g. 19 ft upright, 4 carriers: slots at ±2.6 m and ±0.9 m along
   the axis, hands at 0.75 m above ground, load axis horizontal, or *vertical-carry*
   variant for a raised upright); allowed yaw-rate and speed; carrier footprint = union of
   carrier capsules (r=0.3) at slot positions offset 0.35 m to the load's side.
2. **Footprint** = load OBB (length × width × height) ∪ carrier capsules; swept-volume
   check for a primitive = sample the primitive at s ≤ min(0.15 m, 2°·L/2 arc) and test
   each sample against static geometry with a 2-D polygon-vs-navmesh-boundary test *and*
   a 3-D OBB overlap against the collision BVH (topic 7). Conservative: reject on any hit.
3. **Planner**: hybrid A\* over (x, y, θ) with cell 0.25 m × 0.25 m × 10°, primitives =
   {straight 0.5 m, arcs L/R at turn radii 1.5 m and 3 m, in-place rotate ±10° (humans can
   pivot — unlike cars), reverse 0.5 m with ×2 cost}; heuristic = max(Euclidean,
   navmesh-geodesic distance for the *load centre* with a human profile widened to half
   the load width). Analytic completion: straight-line + in-place rotate when within 2 m
   and no obstacle in the sampled sweep. Output = ordered `LoadPose` keyframes.
4. **Execution**: the formation mover advances the load pose along the plan at the crew
   speed; each carrier's target = slot transform; carriers use *no* independent avoidance
   (they are one body); other agents treat the load capsule chain as an obstacle. Hand
   contact is kept by IK (topic 11). If a carrier cannot reach its slot (e.g. blocked by a
   pile) the action goes `blocked` with `reason`, not a formation break.
5. **Vertical carries / raising**: treated as a separate `Raise` action with a planned
   angular arc; support predicate = ≥ N carriers at valid slots + base pinned (SPEC §12).

**Why.** Independent per-carrier navigation cannot express "the beam must not touch the
wall"; the load pose is the true degree of freedom, and hybrid A\* with a rigid footprint
is the standard, testable way to search it. Reeds-Shepp shots are optional because humans
can rotate in place, which makes the primitive set simpler than a car's.

**Test it implies.** `long_load_corner`: 4.8 m beam, L-shaped corridor 1.6 m wide with a
right-angle corner → planner must find a path (expected: advance, pivot ~45° at the
corner, advance); corridor 1.2 m wide → must return `failed: no_clearance`, never a
clipped path. Assert every sampled load OBB has zero BVH overlaps and every carrier slot
lies on the navmesh. Hand-to-slot error after execution < 5 cm for all carriers.

---

## 7. Rapier JS vs a lightweight BVH query layer

**Problem.** We need collision *queries* (sweeps, overlaps, ray casts, capsule vs
world) for movers, load sweeps and cameras — in Node tests, the browser and possibly the
DO — without adopting a full physics sandbox (SPEC §8).

**Established pattern.**
- Rapier JS (`@dimforge/rapier3d` 0.21.0, `-compat` 0.21.0 base64-inlined wasm ≈ 15 MB
  unpacked, `-deterministic-compat` 0.21.0; the plain wasm is ≈ 1.5–2 MB, ~500 kB gzip —
  prior knowledge; not re-verified). Docs:
  https://rapier.rs/docs/user_guides/javascript/character_controller/ ,
  https://rapier.rs/docs/user_guides/javascript/scene_queries ,
  https://rapier.rs/docs/user_guides/javascript/determinism .
  Kinematic character controller: `world.createCharacterController(offset)`;
  `computeColliderMovement(collider, desired)` → `computedMovement()` plus
  `computedCollision(i)`; `enableAutostep(maxHeight, minWidth, includeDynamic)`,
  `enableSnapToGround(dist)`, `setMaxSlopeClimbAngle`, `setMinSlopeSlideAngle`,
  `setUp`, `setApplyImpulsesToDynamicBodies`; no rotation, gravity is user-added, only
  for kinematic bodies, capsule/ball/cuboid recommended. Queries: `castRay`,
  `castRayAndGetNormal`, `intersectionsWithRay`, `castShape(pos, rot, vel, shape,
  targetDistance, maxToi, stopAtPenetration, filterFlags, groups, excludeCollider,
  excludeRigidBody)`, `intersectionsWithShape`, `projectPoint`,
  `collidersWithAabbIntersectingAabb`, filters by flags/groups/predicate. Snapshots:
  `world.takeSnapshot()` bytes with identical MD5 across platforms after the same steps;
  cross-platform determinism requires identical construction order and that *your* inputs
  avoid `Math.sin/cos` (non-deterministic across JS engines). Rust feature
  `enhanced-determinism` (libm transcendentals, excludes `simd`) is what the
  `-deterministic` npm builds ship.
- Own-BVH approach: `three-mesh-bvh` 0.9.15 (https://github.com/gkjohnson/three-mesh-bvh ):
  `MeshBVH.shapecast({intersectsBounds, intersectsTriangle})`, `raycastFirst`,
  `closestPointToGeometry`, `intersectsGeometry`, `bvhcast`, `refit`, worker/parallel
  generation, `ObjectBVH` for scene-wide queries, and the `characterMovement` example
  (capsule-vs-triangles push-out loop with a fixed substep). Static BVH only; runs in Node
  (pure JS, depends on `three` math). Caveat: skinned/morphed geometry unsupported.

**Adopt? Partially.** *Own-BVH query layer as primary*; Rapier reserved for a later
opt-in (forklift dynamics, dropped objects), behind the same `CollisionQuery` interface.

**Mapping to Mars.** Core `CollisionWorld`: static triangle BVH per world revision
(rebuilt from placements; cached by content hash), plus a dynamic list of moving capsules
/ OBBs (actors, loads, vehicles). Queries: `sweepCapsule`, `overlapOBB`, `raycast`,
`closestPoint`. Movers use a Unity/Rapier-style controller loop implemented over it:
desired Δ → sweep → slide along contact normal (max 3 iterations) → step-up ≤ 0.2 m if
the step-up sweep is clear → snap-to-ground ray ≤ 0.3 m; slopes > 45° slide. Collision
sliding is a *safety net*; the navmesh corridor is the primary path (SPEC §10). The DO
runs the same TS code (no wasm). For determinism the core uses its own `Vec3`/`Quat`
(not `three`) with a deterministic `sin/cos` (topic 10) and fixed iteration order.

**Why.** Query-only needs don't justify a 500 kB+ wasm, a second scene graph, and the
"kinematic bodies pass through things unless you compute movement" footgun; a triangle
BVH plus capsules covers walls/floors/loads. Rapier's determinism promise is still
attractive if dynamics ever land, so the interface is kept Rapier-shaped.

**Test it implies.** Node: capsule sweep against a wall at 45° → slide vector tangent to
the wall, penetration 0 after resolve; step-up over a 0.15 m ledge succeeds, 0.35 m
fails; 1000-step walk into a corner terminates without NaN and with |Δpos| → 0. Cross-run
hash of all query results identical for identical inputs (Node 26 vs Chromium) — same
test to be run against Rapier if it is ever adopted.

---

## 8. Reservable interaction slots, sequence model, and the action runtime

**Problem.** Actions need exclusive claims on actors, objects, work positions and zones
(SPEC §13 lifecycle `requested → validated → reserved → executing → completed |
blocked | failed | cancelled`), a serialisable sequence model with templates vs bound
plans (§14), and a runtime shape that fits "director submits typed actions".

**Established pattern.**
- Unreal Smart Objects (https://dev.epicgames.com/documentation/en-us/unreal-engine/smart-objects-in-unreal-engine---overview ):
  `SmartObjectDefinition` (immutable asset: slots with local transform, user-required
  tags, activity tags, per-slot behaviour definitions) vs runtime instances; agent flow
  `FindSmartObjects(filter) → Claim(slot) → ClaimHandle → Use → Release`; slot states
  `Free → Claimed → Occupied → Free`; slots can be disabled; either party can abort and
  the subsystem invalidates the claim (`OnSlotInvalidated`). Mass and StateTree consume
  the same claims.
- Unreal StateTree (https://dev.epicgames.com/documentation/en-us/unreal-engine/overview-of-state-tree-in-unreal-engine ):
  hierarchical state machine + behaviour-tree selectors; states run tasks concurrently,
  transitions evaluated on events/tick, tasks return Running/Succeeded/Failed; selection
  runs *on demand* on transitions, not every tick.
- Unity Timeline / Unreal Sequencer: a reusable **asset** (tracks → clips/sections with
  keys, markers/events, sub-timelines/shots, camera-cuts track) is separate from the
  **instance** whose bindings map tracks to scene objects (Unity: bindings live on the
  `PlayableDirector`, not the asset; https://docs.unity3d.com/Packages/com.unity.timeline@1.8/manual/tl-overview.html ;
  Unreal: possessables vs spawnables, Level Sequence asset vs Level Sequence Actor).
- Action runtimes (prior knowledge; not re-verified): behaviour trees excel at reactive
  autonomous NPCs; GOAP/HTN plan from goals — but our *director* already plans; hierarchical
  state machines/StateTree excel at explicit lifecycle with typed tasks.

**Adopt? Yes** for slot claims and asset/instance separation; **HSM per action**
(StateTree-like) for the runtime; **no** GOAP/BT for the core (an optional BT/utility
layer may later drive background "Sims-like" autonomy that *submits* actions).

**Mapping to Mars.**
- `InteractionSlot` on asset definitions (grip slot, seat, work position, stair entry,
  forklift mount): local transform + facing + `requires` tags + `capacity`. Runtime
  `Reservation { holder: actionId, kind: actor|object|slot|zone, since }` in the world
  state; `reserve()` is atomic per DO tick and fails with `conflict_with: actionId`.
  Cancellation releases claims *only* after the action reaches an allowed stop state
  (SPEC §13: never drop a supported load).
- `Action` = typed record in a registry (`kind`, zod/TS-typed `params`, `preconditions`,
  `reservations`, `phases`, `completion`, `cancelPolicy`, `outputs`); each running action
  is a small HSM whose phases map to the lifecycle; blockers are typed
  (`no_route`, `no_clearance`, `slot_conflict`, `support_predicate_false`).
- `SequenceTemplate` (parametrised DAG of action templates, barriers, conditions, timed
  cues, camera-cut markers) vs `BoundPlan` (template + bindings to ids + `baseRevision` +
  validation report + navmesh hash). Executing a bound plan yields a `Take`.
- MCP tools are generated from the same registry schemas (SPEC §15).

**Why.** Claim handles make "reservation conflict" and "graceful cancellation" (§28)
first-class and testable; asset/instance split is exactly template vs bound plan; an HSM
per action is deterministic, serialisable mid-phase (needed for mid-take forks, §22), and
readable in diagnostics.

**Test it implies.** Two `Sit` actions on one seat in the same tick → exactly one
`reserved`, the other `failed: slot_conflict`. Cancel a `Carry` mid-route → the action ends
in `cancelled` only after a `SetDown` sub-phase; the load's `supportedBy` is never empty
across all ticks. Bind a template twice to different revisions → two distinct `BoundPlan`
hashes; execute → two `Take`s that do not share ids.

---

## 9. Cinemachine: decollision, deocclusion, framing, shot selection

**Problem.** Cinematic cameras must not enter geometry, must keep the *subject* (hands,
beam end, socket) readable, must not twitch, and must be validated offline against a
rehearsed take (SPEC §18, §28).

**Established pattern.** Cinemachine 3.1 docs:
https://docs.unity3d.com/Packages/com.unity.cinemachine@3.1/manual/CinemachineDeoccluder.html ,
https://docs.unity3d.com/Packages/com.unity.cinemachine@3.1/manual/CinemachineDecollider.html ,
https://docs.unity3d.com/Packages/com.unity.cinemachine@3.1/manual/CinemachineClearShot.html .
- **Decollider**: post-processes the final camera position to push it out of colliders
  (camera radius, obstacle layers, terrain rays) with damping/smoothing; makes *no*
  attempt to preserve line of sight. **Deoccluder**: ray/sphere-casts from target to
  camera against "Collide Against" layers (ignore tag, transparent layers, min distance
  from target) and moves the camera by strategy (Pull Camera Forward / Preserve Height /
  Preserve Distance), with separate `Damping` and `Damping When Occluded`, a `Smoothing
  Time` hold, and *shot-quality evaluation* (optimal distance, near/far limits, quality
  boost) even when avoidance is off.
- **Composer** (Rotation Composer): tracked-object offset, lookahead (time, smoothing,
  ignore-Y), dead zone / soft zone / hard limits in screen fractions, damping.
  **Target Group** + Group Framing: weighted members with radii → bounding box; frame by
  zoom or dolly with damping. **ClearShot**: children each evaluate shot quality (from
  their Deoccluder); pick the best, tie → priority, `Activate After` and `Min Duration`
  as hysteresis, `Randomize Choice`, custom blends. Predictive occlusion is only the
  composer's lookahead; Cinemachine has no future knowledge.

**Adopt? Yes**, as concepts, implemented on the core's collision queries.

**Mapping to Mars.** `CameraTrack` is a separate artefact bound to a take (§21). Three
evaluators, all pure functions of (take frame, camera pose, world revision):
`placementValid` (camera sphere r=0.25 overlaps no opaque collider; plexiglass is in the
*occlusion* set but not the *collision* set), `readability` (fraction of N subject points
— action-specific: carrier hands, beam ends, socket — visible by raycast, weighted),
`coherence` (Σ camera acceleration and cut count). Shot types (follow, orbit, frame-group,
reveal, wide, close-up) are parametrised generators producing candidate poses; a
ClearShot-style selector scores candidates per frame with hysteresis (`minDuration` 2 s,
switch only if score gain > 0.25) and, because rehearsed takes are known in full, uses
*lookahead* over the next 3 s of the take to cut *before* occlusion. Decollision
(push-out) is allowed; silently flying through walls is not — instead cut or fail
validation. Damping is applied in the view only; the track stores resolved poses.

**Why.** Cinemachine's separation of "not inside geometry" vs "subject visible" vs
"temporal coherence" maps 1:1 onto SPEC §18, and offline evaluation over a resolved take
is strictly easier than Cinemachine's live case.

**Test it implies.** Replay a take in which a walker passes behind a plywood wall with a
naive follow camera → validator reports the occlusion interval and the planned track must
contain a cut or alternate placement before it; assert 0 frames with camera-in-geometry,
readability ≥ 0.6 on ≥ 95 % of frames, and ≤ 1 cut per 2 s.

---

## 10. Replay and versioning

**Problem.** Takes must replay camera-independently without re-running the planner;
checkpoints must be forkable mid-take; canonical states are immutable (SPEC §21–23).

**Established pattern.**
- Unreal replay (https://dev.epicgames.com/documentation/unreal-engine/demonetdriver-and-streamers-in-unreal-engine ):
  `DemoNetDriver` records the replicated data stream like a network client; **checkpoints**
  (default every 30 s, `demo.CheckpointUploadDelayInSeconds`) are full snapshots so
  scrubbing = load nearest checkpoint then fast-forward the delta stream; streamers
  (LocalFile, Memory for instant replay, SaveGame, HTTP); events/markers; spectator pawn
  is independent of the recorded world. Limitation: only replicated state is captured.
- Deterministic lockstep (RTS/fighting games; prior knowledge): fixed timestep, seeded
  RNG, ordered input log, pinned rule version → replay = re-simulate. Cheap to store but
  breaks as soon as any rule changes. State recording = store resolved outputs; robust to
  rule changes, larger.
- Event sourcing + snapshots and content-addressed immutable checkpoints (git-like DAG)
  are the standard way to get branching with provenance.

**Adopt? Yes** — hybrid: event-sourced *world* + snapshot checkpoints + **resolved takes**.

**Mapping to Mars.**
- `Revision` = immutable world state, id = SHA-256 of canonical JSON (sorted keys, floats
  serialised as exact decimal strings) + `parent` + `ruleVersion` + `assetVersions` +
  `navmeshHash`. Canonical years are root revisions with `protected: true`.
- `Take` = `{ baseRevision, boundPlanHash, ruleVersion, seed, dt, events[], keyframes[] }`
  where `events` are the resolved action lifecycle transitions (with tick numbers and
  typed reasons) and `keyframes` are per-tick poses for every actor/load/vehicle (quantised
  to 1 mm / 0.1°, delta-encoded). Replay = play keyframes + events; **no planner, no
  steering, no LLM** is invoked. Re-running the plan is a new take.
- Snapshot checkpoints every 5 s of sim time inside a take include running action HSM
  phases, reservations, grips, supports, RNG state, corridors (poly refs) — a *resumable*
  checkpoint (§22); "visual-only" snapshots are labelled as such and cannot be forked.
- Determinism guard: the core uses integer ticks, a seeded xoshiro128** RNG, its own
  math with a deterministic `sin/cos` (e.g. a polynomial/CORDIC implementation — needed
  because JS engines differ, as Rapier's docs warn), and a per-tick state hash; tests
  assert identical hashes Node vs browser vs DO for the same inputs. Replay isolation:
  replays run in a separate core instance with reservations disabled.

**Why.** Unreal's checkpoint+stream is the proven shape for scrubbing; storing resolved
keyframes makes takes immune to planner improvements, which the SPEC explicitly requires;
content hashes make fork isolation and "plan invalidation" mechanical.

**Test it implies.** Run a take, then re-run with a different camera track → identical
`Take.events`/`keyframes` hashes. Fork at checkpoint t=20 s, apply an edit, and assert the
parent revision hash is unchanged. Change `ruleVersion` and replay → identical output
(replay doesn't re-simulate); rerun the plan → a new take id.

---

## 11. Human IK, carry poses, animation layering, foot sliding

**Problem.** Generic rigs (Quaternius/Mixamo) must hold grips on a moving load, blend a
carry upper-body pose onto walk cycles, and not slide their feet.

**Established pattern.**
- three.js `CCDIKSolver(skinnedMesh, iks)` with `{target, effector, links:[{index,
  limitation, rotationMin, rotationMax, enabled}], iteration, minAngle, maxAngle}`,
  `update()`/`updateOne(i)`, `createHelper()`; requires a SkinnedMesh and a target *bone*
  (https://threejs.org/docs/#examples/en/animations/CCDIKSolver ). Two-bone IK (analytic,
  with a pole vector) is what engines use for arms/legs; CCD is fine for 3-link arm chains
  with joint limits but needs a hinge `limitation` on the elbow.
- Layering: three.js has no bone masks; the pattern is `AnimationUtils.subclip` +
  filtering `clip.tracks` by bone name to make an upper-body-only clip, and
  `AnimationUtils.makeClipAdditive(clip, refFrame, refClip)` + `AnimationAction.blendMode
  = AdditiveAnimationBlendMode` for additive carry poses over locomotion
  (https://github.com/mrdoob/three.js/blob/dev/src/animation/AnimationUtils.js ).
- Foot sliding: match playback rate to speed — `action.setEffectiveTimeScale(speed /
  clipStrideSpeed)` where `clipStrideSpeed` is measured once from the clip's root/foot
  travel; blend walk↔run by speed; Unity's docs note "animation follows agent" always
  slides a little, so quantify it rather than chase zero (prior knowledge for the
  speed-matching detail; not re-verified).

**Adopt? Partially.** CCD for hands (arms only), procedural head look, upper-body track
filtering + additive carry pose; no full-body IK, no root-motion ownership.

**Mapping to Mars.** View-side `CharacterRig` adapter per rig family maps bone names
(Mixamo `mixamorig:RightHand` etc.) to roles; grip targets come from the core's
`gripSlot` world transforms each frame; IK runs after the mixer update and before render;
foot-slide metric = |foot bone world velocity| during stance, logged in the evaluation
signals (§29). The core never depends on IK success; hand-to-grip error is reported as a
visual metric, not a simulation failure.

**Why.** Keeps the existing humanoids (§17) and Three.js animation stack; IK is purely
presentational so determinism of the core is untouched.

**Test it implies.** Headless Node test using a SkinnedMesh fixture: after 10 CCD
iterations hand-to-target error < 3 cm for targets within 0.8 m; browser E2E screenshot
of 4 carriers with a 4.8 m beam and a foot-slide metric < 5 cm/s during stance.

---

## 12. Sun position for Bombay Beach (33.33 N, −115.73 W)

**Problem.** Convincing sun elevation/azimuth by date and local time, cheap enough to run
per frame, separate from simulation time (SPEC §19).

**Established pattern.** NOAA GML "General Solar Position Calculations"
(https://gml.noaa.gov/grad/solcalc/solareqns.PDF ; details
https://gml.noaa.gov/grad/solcalc/calcdetails.html , based on Meeus, *Astronomical
Algorithms*; sunrise/sunset within ~1 min for |lat| ≤ 72°):
```
γ  = 2π/365 · (doy − 1 + (hour − 12)/24)                  (366 in leap years)
eqtime = 229.18·(0.000075 + 0.001868cosγ − 0.032077sinγ − 0.014615cos2γ − 0.040849sin2γ)  [min]
decl   = 0.006918 − 0.399912cosγ + 0.070257sinγ − 0.006758cos2γ + 0.000907sin2γ
         − 0.002697cos3γ + 0.00148sin3γ                                            [rad]
time_offset = eqtime + 4·lon − 60·tz        (lon = −115.73, tz = −8 PST / −7 PDT)
tst = hr·60 + mn + sc/60 + time_offset ;  ha = tst/4 − 180                         [deg]
cos zen = sin lat·sin decl + cos lat·cos decl·cos ha
cos(180 − az) = −(sin lat·cos zen − sin decl)/(cos lat·sin zen)   (az clockwise from N)
sunrise/sunset: ha = ±acos(cos 90.833°/(cos lat·cos decl) − tan lat·tan decl)
```
Use UTC input (tz=0) to avoid DST mistakes; resolve the azimuth quadrant with the sign
of `ha` (ha > 0 → afternoon → az = 180 + acos(...)). Accuracy ≈ 0.01–0.1° — far beyond
what lighting needs. Higher precision reference: Reda & Andreas, NREL/TP-560-34302 (SPA,
±0.0003°, years −2000..6000, https://docs.nrel.gov/docs/fy08osti/34302.pdf ) — not
needed. npm `suncalc` 2.0.2 implements a similar low-precision algorithm if a dependency
is preferred.

**Adopt? Yes** — NOAA equations, ~40 lines of TS, no dependency.

**Mapping to Mars.** `env/sun.ts: sunPosition(utcMs, lat=33.33, lon=-115.73) → {azimuthDeg,
elevationDeg}`; view maps it to the directional light and sky; sim time and environment
date/time are separate fields on the take's presentation settings (visual-only override).

**Why.** Deterministic, tiny, cited; Mars sessions run Jan–Mar when the low winter sun
(noon elevation ≈ 33–45°) is a big part of the look.

**Test it implies.** Unit test vs NOAA calculator values: 2026-01-15 12:00 PST at Bombay
Beach → elevation ≈ 35.5°, azimuth ≈ 177° (±0.5°); 2026-03-15 sunrise ≈ 06:52 PDT and
sunset ≈ 18:52 PDT (±3 min); azimuth increases monotonically through the day.

---

## Summary

| # | Topic | Decision |
|---|-------|----------|
| 1 | Recast/Detour | **Partially**: tiled navmesh per profile, corridor+funnel, area flags, off-mesh links; not dtCrowd as mover |
| 2 | recast-navigation-js 0.43.1 | **Yes** for generation/query/serialisation (Node+browser); `Crowd` no |
| 3 | Unity navigation patterns | **Yes**: carve-when-stationary, activated links + manual traversal, "animation follows agent" ownership |
| 4 | Godot agent lessons | **Yes** as invariants: one-shot arrival, tolerance rules, explicit navmesh sync point |
| 5 | Local avoidance | **Partially**: ORCA half-planes + explicit yield/priority + side hysteresis + Reynolds arrival |
| 6 | Carry formations | **Yes**: plan the load pose with hybrid A* over (x,y,θ) + swept OBB checks; carriers from grip slots |
| 7 | Rapier vs own BVH | **Partially**: own BVH query layer (three-mesh-bvh-style) first; Rapier-shaped interface for later |
| 8 | Smart objects / sequences / runtime | **Yes**: claim handles on slots; template vs bound plan; HSM per action; no GOAP/BT in core |
| 9 | Cinemachine | **Yes** as concepts: placement / readability / coherence evaluators, ClearShot-style selection with lookahead |
| 10 | Replay/versioning | **Yes**: content-hashed revisions, event log + resumable checkpoints, resolved-keyframe takes |
| 11 | IK / animation | **Partially**: CCD hands + additive upper-body carry + speed-matched playback; view-only |
| 12 | Sun position | **Yes**: NOAA equations in TS, UTC input, no dependency |

**Recommended stack.** A pure-TS deterministic core (`viewer/engine/`) with its own
vector math, seeded RNG, integer ticks and per-tick state hashes; `recast-navigation`
0.43.1 for per-profile tiled navmesh generation, Detour queries, corridor/funnel and
serialised navmesh bytes pinned into revisions; a project-owned corridor mover with
ORCA-style avoidance and explicit yield rules; a project-owned static triangle BVH +
capsule/OBB query layer (three-mesh-bvh as reference, Rapier-shaped interface kept for a
possible later dynamics opt-in); a hybrid-A* SE(2) planner for load poses with grip-slot
carrier derivation; a typed action registry with claim-handle reservations and per-action
HSMs that also generates the MCP tool schemas; event-sourced, content-addressed revisions
with resumable checkpoints and resolved-keyframe takes; camera tracks evaluated offline
by placement/readability/coherence scorers with lookahead; view-side Three.js animation
with CCD hand IK and additive carry layers; and a 40-line NOAA sun model.
