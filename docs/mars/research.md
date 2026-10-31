# Engine-pattern research: decision notes

Mature game-engine patterns mapped onto the Mars world engine (Three.js + TypeScript;
pure-TS deterministic sim core running in Node tests, the browser and a Cloudflare Durable
Object). Companion to `SPEC.md` (§8–18, 21–23, 26–29, 34) and `AUDIT.md`. Per topic:
Problem · Established pattern (docs) · Adopt? · Mapping to Mars · Why · Test. Versions
from the npm registry, 2026-09-27; "(prior knowledge; not re-verified)" marks items that
could not be re-fetched. "core" = sim core, "view" = Three.js renderer, "DO" = Durable
Object authority; metres, Y up (matches Recast/Detour and Rapier).

---

## 1. Recast/Detour: generation, corridors, links, crowds

**Problem.** Humans, EUCs and forklifts need global routes over a campus whose walkable
surface changes as floors/stairs/walls are built; routes must be corridors, not brittle
point lists (SPEC §10); floors overlap in XZ.

**Established pattern.** Recast voxelises triangles into a heightfield, filters spans by
agent size, builds regions/contours/polys; Detour queries them; DetourCrowd adds local
steering. Docs: https://recastnav.com/structrcConfig.html ,
https://recastnav.com/classdtPathCorridor.html , https://recastnav.com/classdtCrowd.html .
- `rcConfig` (wu = world units, vx = voxels): `cs` ≈ r/2 outdoors or r/3 indoors for
  agent radius r; `ch` ≈ cs/2; `walkableHeight = ceil(h/ch)` (≥ 3); `walkableClimb =
  ceil(maxClimb/ch)`; `walkableRadius = ceil(r/cs)`; slope < 90° (practical ≤ 85);
  `maxEdgeLen ≈ walkableRadius·8`; `maxSimplificationError` 1.1–1.5; `minRegionArea` /
  `mergeRegionArea` in vx²; `detailSampleDist` 0 or ≥ 0.9 wu. Mars human profile
  (r 0.3, h 1.8, climb 0.2 — a stair riser ≈ 0.18 m): cs 0.15, ch 0.075, walkableRadius 2,
  walkableHeight 24, walkableClimb 3, slope 45°. EUC/forklift need separate navmeshes.
- **Overlapping floors** are native (multiple spans per column) as long as
  `walkableHeight` separates them. Pitfall: `findNearestPoly(center, halfExtents)` returns
  the closest poly inside the AABB, so a large `halfExtents.y` near a floor edge snaps to
  the wrong level (Mars floor spacing ≈ 2.4 m). dtCrowd itself uses `(2r, 1.5r, 2r)`
  (DetourCrowd.cpp l.389). Success with `nearestRef == 0` means "not found".
- **Tiled navmesh + TileCache.** TileCache keeps compressed layers per tile and re-derives
  polys when box/cylinder obstacles change (64-request queue; tiles 32–64 vx). Anything
  else (new floor, stair run, wall with a door) needs a tile rebuild.
- **Corridor + funnel.** `dtPathCorridor` holds poly refs; `movePosition` /
  `moveTargetPosition` slide endpoints; `findCorners` = string pulling. dtCrowd runs
  `optimizePathVisibility` every update within `pathOptimizationRange` and
  `optimizePathTopology` every 0.5 s (`OPT_TIME_THR`). Replan triggers (l.942–1035):
  corridor `isValid` fails within `CHECK_LOOKAHEAD = 10` polys after a mesh change;
  agent/target ref invalid; partial path and `targetReplanTime > 1.0 s`.
- **Off-mesh connections** (start, end, radius, bidirectional, area, flags) are baked into
  tiles; crowd agents entering one are lerped over `tmax = dist2D/maxSpeed·0.5`
  (l.1164) — Detour does not animate traversal.
- **Areas/flags.** 6-bit area, 16-bit flags per poly; `dtQueryFilter` = per-area cost +
  include/exclude masks. "Incomplete stairs" = excluded flag until the recipe marks them
  usable (`setPolyFlags`, no rebake); geometry appearing needs a tile rebuild.
- **dtCrowd avoidance** is sampled velocity scoring (not ORCA; defaults `velBias 0.4,
  weightDesVel 2.0, weightToi 2.5, horizTime 2.5`, adaptive `divs 7, rings 2, depth 5`)
  plus soft push-apart (`COLLISION_RESOLVE_FACTOR 0.7`). Corridor max 256 polys.

**Adopt? Partially.** Recast generation (tiled), Detour query/corridor/funnel, flags,
off-mesh links. Not dtCrowd as the mover of record.

**Mapping to Mars.** One navmesh per profile (`human`, `euc`, `forklift`), tiles rebuilt
by construction events. Stairs = per-flight off-mesh link (or real stair polys when
complete) gated by a `usable` flag from the recipe predicate. The core owns a
`PathCorridor` (poly refs + corners) and a mover inside it; dtCrowd is reference only
(owns positions, variable-dt-oriented, cannot express carry formations).

**Why.** The only mature free navmesh builder in WASM for Node + browser; corridors + funnel = SPEC §10.

**Test.** Proving ground: (a) 2-level bay; nearest-poly query 0.3 m from the upper edge
with halfExtents.y 0.5 → upper poly; with 3.0 → document the mis-snap. (b) Flip
`stairs.usable`; ground→upper `findPath` fails before, succeeds after, no rebake. (c)
Install a wall; an in-flight corridor reports `isValid=false` and replans exactly once.

---

## 2. recast-navigation-js (isaac-mason)

**Problem.** Recast/Detour in TypeScript for browser and Node, with serialisable
navmeshes and Three.js input helpers.

**Facts (npm 2026-09-27).** `recast-navigation@0.43.1` (= `@recast-navigation/core` +
`/generators`); `@recast-navigation/three` 0.43.1; `@recast-navigation/wasm` 0.43.1,
1.99 MB unpacked (normal + `wasm-compat` base64 builds; `.wasm` ≈ 600–800 kB, ≈ 250–300 kB
gzip — prior knowledge; not re-verified). ESM, Node + browser, `await init()` first. Docs:
https://github.com/isaac-mason/recast-navigation-js , https://docs.recast-navigation-js.isaacmason.com/ .
- Generators: `generateSoloNavMesh(positions, indices, cfg)`, `generateTiledNavMesh`
  (+`tileSize`), `generateTileCache` (+`expectedLayersPerTile`, `maxObstacles`,
  `tileCacheMeshProcess`). `cfg` uses `rcConfig` names (`cs, ch, walkableSlopeAngle,
  walkableHeight, walkableClimb, walkableRadius, maxEdgeLen, …, borderSize`) +
  `offMeshConnections[]` (`startPosition, endPosition, radius, bidirectional, area,
  flags, userId`), `bounds`, `buildBvTree`. Flat arrays, right-handed, CCW.
- Three helpers: `threeToSoloNavMesh(meshes, cfg)`, `threeToTiledNavMesh`,
  `threeToTileCache`, `getPositionsAndIndices`, `NavMeshHelper`, `DebugDrawer`.
- Query: `NavMeshQuery.computePath(start, end, {filter, halfExtents, maxPathPolys,
  maxStraightPathPoints})`, `findClosestPoint`, `findRandomPointAroundCircle`,
  `moveAlongSurface`, `raycast`, `getPolyHeight`; `QueryFilter` with
  `includeFlags/excludeFlags/setAreaCost`. Default halfExtents `(1,1,1)` (prior
  knowledge) — always pass them explicitly.
- Crowd: `new Crowd(navMesh, {maxAgents, maxAgentRadius})`; `addAgent(pos, {radius,
  height, maxAcceleration, maxSpeed, collisionQueryRange, pathOptimizationRange,
  separationWeight, updateFlags, obstacleAvoidanceType, queryFilterType})`;
  `crowd.update(dt)` fixed or `update(dt, timeSinceLastFrame, maxSubSteps)` — README
  states variable dt is non-deterministic. Agent: `requestMoveTarget`, `teleport`,
  `state()`, `corners()`.
- Serialisation: `exportNavMesh → Uint8Array` / `importNavMesh`; `exportTileCache` /
  `importTileCache(bytes, meshProcess)` (TileCache off-mesh links need a custom
  `TileCacheMeshProcess`).
- Determinism: WASM math is reproducible per build, but generation is sensitive to
  triangle order; the WASM heap is per-isolate state (a DO re-imports bytes on wake).
  README escape hatch: generator only, query exported polys yourself.

**Adopt? Yes** for generation + query + serialisation; **no** for `Crowd`.

**Mapping to Mars.** `viewer/engine/nav/`: `NavBuilder` (Three meshes → per-profile
bytes; worker in browser, inline in Node), `NavIndex` (imported mesh + query per
profile). Navmesh bytes are hashed into the revision so replays use the mesh they were
planned on (§23/25); construction events on the DO produce tile byte diffs.

**Why.** Node/browser parity, byte serialisation and Three helpers remove the biggest
integration risks; sub-MB wire cost is fine.

**Test.** Node: build from the proving-ground geometry, export, re-import after a fresh
`init()`, assert identical `computePath` output and identical SHA-256 of the bytes across
two runs.

---

## 3. Unity AI Navigation patterns

**Problem.** Which agent/obstacle/link/animation conventions keep movers, obstacles and
animation from fighting over one transform.

**Established pattern.** Docs:
https://docs.unity3d.com/Packages/com.unity.ai.navigation@2.0/manual/MixingComponents.html ,
https://docs.unity3d.com/Packages/com.unity.ai.navigation@2.0/manual/CouplingAnimationAndNavigation.html ,
https://docs.unity3d.com/Packages/com.unity.ai.navigation@2.0/manual/AboutObstacles.html .
- **NavMeshObstacle carve vs avoid.** Non-carving obstacles are seen only by local
  avoidance, so agents "might not be able to find [their] way around" clutter; carving
  cuts a hole so pathfinding reroutes. Carve only when stationary (move threshold,
  time-to-stationary); one-frame delay before queries see it; never agent + obstacle on
  the same object.
- **NavMeshLink.** Width, cost override, bidirectional, area, `activated`. Agent side:
  `autoTraverseOffMeshLink` (lerp) or manual — `isOnOffMeshLink`,
  `currentOffMeshLinkData`, play the climb, `CompleteOffMeshLink()`; facing is the
  game's job. `autoRepath` replans when the path goes stale/partial.
- **Animation ownership.** (a) *animation follows agent*: agent owns the transform,
  `agent.velocity` drives a blend tree (robust; some foot sliding). (b) *agent follows
  animation*: `updatePosition/updateRotation = false`, agent is a simulation point
  (`nextPosition`), blend tree fed by `nextPosition − transform.position`, root motion in
  `OnAnimatorMove`, character pulled back when drift > `agent.radius`. Only kinematic
  rigidbodies beside an agent.

**Adopt? Yes**: carving semantics, activated links with manual traversal, mode (a) with
drift correction.

**Mapping to Mars.** Trailers/piles/vehicles that stop → carve (TileCache obstacle or
tile rebuild) as a world event after `timeToStationary` sim-seconds; moving people/EUCs →
local avoidance only. Stairs/ladders/mounts = links with `usable`; traversal is always a
`TraverseLink` phase (orient to entry facing, play clip, complete on core signal). Rule:
the **core mover owns position + yaw**; animation reads velocity and never writes back;
the formation solver owns load poses (topic 6); IK adjusts hands only (topic 11).
`autoRepath` → rate-limited `Mover.replanIfInvalid()` on navmesh-change events.

**Why.** These are the SPEC's own edge cases (stairs from the side, obstacles invisible
to pathfinding, agent/animation fights); "sim point vs rendered transform" keeps the core
deterministic while the view smooths.

**Test.** (1) Trailer placed across a route after departure: with carving the walker
replans before contact (first heading change > 1 m from the obstacle); without carving
the test must fail. (2) Link `usable=false` → not used; true → used, |yaw − linkFacing| <
15° at entry. (3) Rendered − core position never exceeds `radius` over a 30 s walk.

---

## 4. Godot NavigationAgent: failure modes

**Problem.** Godot's docs are the best checklist of "why does my agent jitter / never
arrive / spin at a doorway".

**Established pattern.** Docs:
https://docs.godotengine.org/en/stable/tutorials/navigation/navigation_using_navigationagents.html ,
https://docs.godotengine.org/en/stable/classes/class_navigationagent3d.html .
- `path_desired_distance` 1.0 (advance waypoint), `target_desired_distance` 1.0 (reached),
  `path_max_distance` 5.0 (replan if pushed further). Too small vs speed·dt → overshoot
  and turn back ("dancing"); too large → corner cutting. Rule: tolerance ≥ 2·speed·dt and
  ≤ agent radius.
- `target_reached` fires once per target; setting `target_position` every frame resets
  the path — the classic "never reaches target" bug. `get_next_path_position()` once per
  physics frame; calling it inside `waypoint_reached` recurses.
- Avoidance = RVO2 (`radius`, `neighbor_distance` 50, `max_neighbors` 10,
  `time_horizon_agents` 1.0, `avoidance_priority`); safe velocity arrives via
  `velocity_computed`; avoidance does **not** affect pathfinding unless obstacles carve.
- **Map sync delay**: changes apply on the next `NavigationServer` sync (one physics
  frame); queries in `_ready()` return empty. `path_postprocessing` corridorfunnel vs
  edgecentered; `simplify_path` + `simplify_epsilon`.

**Adopt? Yes** as invariants; no APIs.

**Mapping to Mars.** Per-profile `waypointTolerance` (≥ 2·speed·dt), `arriveTolerance`,
`maxPathDeviation`; `arrived`/`pathFinished` are one-shot lifecycle events. Navmesh
changes apply at an explicit sync point at the start of a DO tick; queries within a tick
see a stable mesh. Intent changes are actions, so a director cannot spam them.

**Why.** Every item is a known jitter cause SPEC §28 forbids; asserts are cheap.

**Test.** Walk a 20 m S-curve at 1.4 m/s, dt 1/30, tolerances {0.02, 0.1, 0.3}: no
heading reversal > 120° within 0.5 s; arrival fires once. Sync: wall-install event and a
path query in the same tick → pre-event mesh; next tick → post-event mesh.

---

## 5. Local avoidance: ORCA, yielding, priority, hysteresis, arrival

**Problem.** Two walkers meeting in a 0.9 m gap must pass or one must wait, without
jitter, path flipping or symmetric deadlock (SPEC §28 "narrow passage").

**Established pattern.** ORCA (van den Berg, Guy, Lin, Manocha, ISRR 2011,
https://gamma.cs.unc.edu/ORCA/ ): each pair induces a velocity-obstacle half-plane, each
agent takes half the responsibility, and the new velocity is the LP-closest point to the
preferred one; `timeHorizon` trades early reaction for freedom (RVO2 params:
https://gamma.cs.unc.edu/RVO2/documentation/2.0/params.html — `neighborDist,
maxNeighbors, timeHorizon, timeHorizonObst, radius, maxSpeed`). Detour instead samples
velocities (topic 1). Known failures: symmetric head-on deadlock, side oscillation when
the preferred velocity is re-funnelled every frame, pushing into walls when the navmesh
boundary is not an obstacle (Detour adds `dtLocalBoundary`; RVO2 needs polylines).
Reynolds (https://www.red3d.com/cwr/steer/ ): *arrival* = speed·clamp(d/slowRadius);
*queuing* = brake when a neighbour is ahead in a cone. Game practice (prior knowledge;
not re-verified): asymmetric priority (Unity/Godot `avoidancePriority`), side hysteresis
(keep the chosen side unless the other is > ~20 % better for > ~0.5 s), explicit yield
when passage width < 2(rA+rB)+margin — lower priority stops at a pull-off point.

**Adopt? Partially.** ORCA half-planes for 2–10 walkers, explicit yield, side
hysteresis, Reynolds arrival. No sampled Detour crowd.

**Mapping to Mars.** Core `Steer`: inputs = funnel corners, neighbours within 3 m, local
boundary segments; output = velocity. Priority: carry formations > forklift > walker with
an active action > idle walker. Formations are *obstacles* to others (capsule chain),
never negotiating agents. Passage width comes from the corridor poly at the corner;
yielding is a mover phase surfaced as `blocked/paused`, `reason: "yielding_to:<id>"`.
Agents update in id order, no randomness. Arrival: slow radius 1.0 m, stop at
`arriveTolerance`, then turn to the action's `facing` over 0.3 s.

**Why.** ORCA is a closed-form LP per agent (no sampling RNG) and Mars scenes have few
movers; the hard cases are semantic (who yields), so they belong in named rules.

**Test.** `narrow_passage`: two walkers (r 0.3) through a 0.9 m gap → one enters
`yielding_to`, the other passes, total < 12 s, zero corridor replans, Σ|Δyaw| < 2π. Gap
1.4 m → both pass, no yield. Head-on on open ground → no deadlock (< 1.5× straight-line
time), no side flip after 0.5 s.

---

## 6. Group/formation movement carrying a shared load

**Problem.** 2–4 people carry a 2.4–5.8 m upright/beam/plywood; crew + load is one rigid
body in SE(2) (x, y, yaw) plus carry height; a route valid for a person is invalid if the
load cannot swing through a corner (SPEC §11, §28).

**Established pattern.**
- RTS formations: Pottinger, "Coordinated Unit Movement" / "Implementing Coordinated
  Movement" (1999, https://www.gamedeveloper.com/programming/coordinated-unit-movement ):
  one path for the group, slots relative to the group pose, speed limited by the slowest
  slot, the formation rotates as a unit. Reynolds' *leader following* is the light version.
- Piano mover's problem = planning a rigid body in configuration space, C = SE(2) for a
  planar body (Latombe, *Robot Motion Planning*, 1991; prior knowledge). Practical solver:
  **hybrid-state A\*** (Dolgov, Thrun, Montemerlo, Diebel, "Practical Search Techniques
  in Path Planning for Autonomous Driving", STAIR 2008): discretise (x, y, θ) but keep a
  continuous state per cell; expand with motion primitives (arcs, forward/reverse, with
  reverse and direction-change penalties); heuristic = max(non-holonomic-without-
  obstacles via Reeds-Shepp/Dubins, holonomic-with-obstacles 2-D DP); analytic
  Reeds-Shepp shots near the goal; Voronoi-field smoothing. Reeds-Shepp (1990; OMPL
  https://ompl.kavrakilab.org/classompl_1_1base_1_1ReedsSheppStateSpace.html ).
- Cooperative transport review (Tuci, Alkilabi, Akanyeti, Frontiers Robotics & AI 2018,
  https://www.frontiersin.org/articles/10.3389/frobt.2018.00059/full ): grasping
  transport = centralised planning of the object pose with carriers derived from grip
  points.

**Adopt? Yes** — plan the load pose centrally; carriers derive from grip slots.

**Mapping to Mars.**
1. `CarryProfile` per asset: allowed crew sizes; grip slots in load-local coordinates
   (19 ft upright, 4 carriers: ±2.6 m and ±0.9 m along the axis, hands 0.75 m up, axis
   horizontal; a vertical-carry variant for a raised upright); max yaw rate and speed;
   carrier footprint = capsules (r 0.3) at slots offset 0.35 m to the load's side.
2. Footprint = load OBB ∪ carrier capsules; swept check = sample each primitive at
   s ≤ min(0.15 m, 2°·L/2), test 2-D vs navmesh boundary *and* 3-D OBB vs BVH; reject on hit.
3. Planner: hybrid A\* over (x, y, θ), cells 0.25 m × 0.25 m × 10°; primitives =
   {straight 0.5 m, arcs L/R at radii 1.5 and 3 m, in-place rotate ±10° (humans pivot,
   unlike cars), reverse 0.5 m at ×2 cost}; heuristic = max(Euclidean, navmesh geodesic
   for the load centre on a profile widened to half the load width); analytic completion =
   straight + pivot within 2 m when the sampled sweep is clear. Output = `LoadPose`
   keyframes.
4. Execution: the formation mover advances the load pose at crew speed; each carrier's
   target = slot transform; carriers run **no** independent avoidance; others treat the
   load as an obstacle; hands held by IK (topic 11). A carrier that cannot reach its slot
   → `blocked` with reason, never a formation break.
5. Raising a tall frame = separate `Raise` action with a planned angular arc; support
   predicate = ≥ N carriers at valid slots + base pinned (SPEC §12).

**Why.** Per-carrier navigation cannot express "the beam must not touch the wall"; the
load pose is the real degree of freedom and hybrid A\* over a rigid footprint is the
standard, testable search. Reeds-Shepp shots are optional because humans pivot.

**Test.** `long_load_corner`: 4.8 m beam through an L-corridor 1.6 m wide → plan found
(advance, pivot ≈ 45°, advance); 1.2 m wide → `failed: no_clearance`, never a clipped
path. Every sampled OBB has zero BVH overlaps, every slot lies on the navmesh, and
hand-to-slot error < 5 cm after execution.

---

## 7. Rapier JS vs a lightweight BVH query layer

**Problem.** Collision *queries* (sweeps, overlaps, rays, capsule vs world) for movers,
load sweeps and cameras, in Node, browser and DO, without a physics sandbox (SPEC §8).

**Established pattern.**
- Rapier JS `@dimforge/rapier3d` 0.21.0 (`-compat` 0.21.0 base64-inlined ≈ 15 MB
  unpacked; `-deterministic-compat` 0.21.0; the plain `.wasm` ≈ 1.5–2 MB, ~500 kB gzip —
  prior knowledge; not re-verified). Docs:
  https://rapier.rs/docs/user_guides/javascript/character_controller/ ,
  https://rapier.rs/docs/user_guides/javascript/scene_queries ,
  https://rapier.rs/docs/user_guides/javascript/determinism . Character controller:
  `createCharacterController(offset)`, `computeColliderMovement(collider, desired)` →
  `computedMovement()` + `computedCollision(i)`; `enableAutostep(maxHeight, minWidth,
  includeDynamic)`, `enableSnapToGround(dist)`, `setMaxSlopeClimbAngle`,
  `setMinSlopeSlideAngle`; no rotation, gravity user-added, kinematic bodies only.
  Queries: `castRay`, `castRayAndGetNormal`, `intersectionsWithRay`, `castShape(pos, rot,
  vel, shape, targetDistance, maxToi, stopAtPenetration, …filters)`,
  `intersectionsWithShape`, `projectPoint`, `collidersWithAabbIntersectingAabb`.
  `world.takeSnapshot()` bytes hash identically across platforms after the same steps,
  provided construction order is identical and *your* inputs avoid `Math.sin/cos` (JS
  engines differ). Rust `enhanced-determinism` (libm, no `simd`) = the
  `-deterministic` npm builds.
- Own BVH: `three-mesh-bvh` 0.9.15 (https://github.com/gkjohnson/three-mesh-bvh ):
  `shapecast({intersectsBounds, intersectsTriangle})`, `raycastFirst`,
  `closestPointToGeometry`, `intersectsGeometry`, `bvhcast`, `refit`, worker generation,
  `ObjectBVH`, and the `characterMovement` example (capsule push-out loop, fixed
  substep). Static only; pure JS; runs in Node.

**Adopt? Partially.** Own BVH query layer first; Rapier reserved for a later opt-in
(forklift dynamics, dropped objects) behind the same `CollisionQuery` interface.

**Mapping to Mars.** Core `CollisionWorld`: static triangle BVH per revision (cached by
content hash) + dynamic capsules/OBBs (actors, loads, vehicles); queries `sweepCapsule`,
`overlapOBB`, `raycast`, `closestPoint`. Mover loop, Rapier-style: desired Δ → sweep →
slide along the contact normal (≤ 3 iterations) → step-up ≤ 0.2 m if the raised sweep is
clear → snap-to-ground ≤ 0.3 m; slopes > 45° slide. Sliding is a safety net; the corridor
is the path (§10). The DO runs the same TS (no wasm); own `Vec3`/`Quat`, fixed order.

**Why.** Query-only needs don't justify a 500 kB+ wasm, a second scene graph and the
"kinematic bodies pass through things unless you compute movement" footgun; a triangle
BVH plus capsules covers walls/floors/loads; the Rapier-shaped interface keeps dynamics open.

**Test.** Capsule sweep into a wall at 45° → slide tangent, zero penetration; step-up
0.15 m succeeds, 0.35 m fails; 1000-step walk into a corner terminates without NaN with
|Δpos| → 0. Hash of all query results identical Node 26 vs Chromium (rerun against Rapier
if adopted).

---

## 8. Reservable slots, sequence model, action runtime

**Problem.** Exclusive claims on actors/objects/work positions/zones (SPEC §13 lifecycle
`requested → validated → reserved → executing → completed | blocked | failed |
cancelled`), a serialisable sequence model with templates vs bound plans (§14), and a
runtime shape for "director submits typed actions".

**Established pattern.**
- Unreal Smart Objects
  (https://dev.epicgames.com/documentation/en-us/unreal-engine/smart-objects-in-unreal-engine---overview ):
  immutable `SmartObjectDefinition` (slots with local transform, user/activity tags,
  per-slot behaviour definitions) vs runtime instances; `FindSmartObjects(filter) →
  Claim → ClaimHandle → Use → Release`; slot states `Free → Claimed → Occupied → Free`;
  slots can be disabled; either side can abort (`OnSlotInvalidated`).
- Unreal StateTree
  (https://dev.epicgames.com/documentation/en-us/unreal-engine/overview-of-state-tree-in-unreal-engine ):
  hierarchical state machine + BT selectors; states run tasks concurrently; tasks return
  Running/Succeeded/Failed; selection runs on transitions, not every tick.
- Unity Timeline / Unreal Sequencer: reusable **asset** (tracks → clips with keys,
  markers, sub-timelines, camera-cuts track) vs **instance** whose bindings map tracks to
  scene objects (Unity keeps bindings on the `PlayableDirector`, not the asset —
  https://docs.unity3d.com/Packages/com.unity.timeline@1.8/manual/tl-overview.html ;
  Unreal: possessables vs spawnables).
- Runtimes (prior knowledge): BTs suit reactive NPCs; GOAP/HTN plan from goals — but our
  director already plans; HSMs suit explicit lifecycles with typed tasks.

**Adopt? Yes**: claim handles, asset/instance split, an HSM per action. **No** GOAP/BT in
the core (a later utility layer may drive Sims-like autonomy by *submitting* actions).

**Mapping to Mars.** `InteractionSlot` on asset definitions (grip, seat, work position,
stair entry, forklift mount): local transform + facing + `requires` + `capacity`. Runtime
`Reservation { holder: actionId, kind: actor|object|slot|zone, since }`; `reserve()` is
atomic per DO tick and fails with `conflict_with`; cancellation releases claims only from
an allowed stop state (never drop a supported load). `Action` = registry record (`kind`,
typed `params`, `preconditions`, `reservations`, `phases`, `completion`, `cancelPolicy`,
`outputs`) run as a small HSM with typed blockers (`no_route`, `no_clearance`,
`slot_conflict`, `support_predicate_false`). `SequenceTemplate` (parametrised DAG of
action templates, barriers, conditions, timed cues, camera-cut markers) vs `BoundPlan`
(template + id bindings + `baseRevision` + validation report + navmesh hash); executing
a bound plan yields a `Take`. MCP tools are generated from the same schemas (§15).

**Why.** Claim handles make "reservation conflict" and "graceful cancellation" (§28)
first-class; asset/instance = template vs bound plan; an HSM per action is deterministic
and serialisable mid-phase (mid-take forks, §22).

**Test.** Two `Sit` actions on one seat in one tick → one `reserved`, one `failed:
slot_conflict`. Cancel a `Carry` mid-route → ends `cancelled` only after a `SetDown`
phase; `supportedBy` never empty. Bind a template to two revisions → two `BoundPlan`
hashes and two `Take`s with disjoint ids.

---

## 9. Cinemachine: decollision, deocclusion, framing, shot selection

**Problem.** Cinematic cameras must not enter geometry, must keep the *subject* (hands,
beam end, socket) readable, must not twitch, and must be validated offline against a
rehearsed take (SPEC §18, §28).

**Established pattern.** Cinemachine 3.1:
https://docs.unity3d.com/Packages/com.unity.cinemachine@3.1/manual/CinemachineDeoccluder.html ,
https://docs.unity3d.com/Packages/com.unity.cinemachine@3.1/manual/CinemachineDecollider.html ,
https://docs.unity3d.com/Packages/com.unity.cinemachine@3.1/manual/CinemachineClearShot.html .
- **Decollider** pushes the final camera position out of colliders (camera radius,
  obstacle layers, terrain rays, damping/smoothing) with *no* line-of-sight preservation.
  **Deoccluder** casts target→camera against "Collide Against" layers (ignore tag,
  transparent layers, min distance from target) and moves the camera by strategy (Pull
  Forward / Preserve Height / Preserve Distance) with separate `Damping` and `Damping When
  Occluded`, a `Smoothing Time` hold, plus **shot-quality evaluation** (optimal distance,
  near/far limits, quality boost) even when avoidance is off.
- **Rotation Composer**: target offset, lookahead (time, smoothing, ignore-Y), dead /
  soft / hard zones in screen fractions, damping. **Target Group** + Group Framing:
  weighted members with radii → bounding box; frame by zoom or dolly. **ClearShot**:
  children score quality via their Deoccluder; best wins, ties by priority, `Activate
  After` / `Min Duration` hysteresis. Prediction is only lookahead; no future knowledge.

**Adopt? Yes** as concepts, on the core's collision queries.

**Mapping to Mars.** `CameraTrack` is bound to a take (§21). Three pure evaluators of
(take frame, camera pose, revision): `placementValid` (camera sphere r 0.25 vs opaque
colliders; plexiglass is in the occlusion set, not the collision set), `readability`
(weighted fraction of action-specific subject points visible by raycast), `coherence`
(Σ acceleration, cut count). Shot types (follow, orbit, frame-group, reveal, wide,
close-up) generate candidates; a ClearShot-style selector scores per frame with
hysteresis (`minDuration` 2 s, switch on gain > 0.25) and looks 3 s ahead in the known
take to cut *before* occlusion. Push-out allowed; flying through walls is not — cut or
fail validation. Damping is view-only; tracks store resolved poses.

**Why.** Cinemachine's split of "not inside geometry" / "subject visible" / "temporal
coherence" maps 1:1 onto §18; offline evaluation over a resolved take is the easy case.

**Test.** Replay a take where a walker passes behind a plywood wall with a naive follow
camera → validator reports the occlusion interval and the planned track contains a cut or
alternate placement before it; 0 frames inside geometry, readability ≥ 0.6 on ≥ 95 % of
frames, ≤ 1 cut per 2 s.

---

## 10. Replay and versioning

**Problem.** Takes replay camera-independently without re-running the planner;
checkpoints fork mid-take; canonical states are immutable (SPEC §21–23).

**Established pattern.**
- Unreal replay
  (https://dev.epicgames.com/documentation/unreal-engine/demonetdriver-and-streamers-in-unreal-engine ):
  `DemoNetDriver` records the replicated stream like a network client; **checkpoints**
  (default every 30 s) are full snapshots, so scrubbing = load the nearest checkpoint,
  then fast-forward the delta stream; streamers (LocalFile, Memory for instant replay,
  SaveGame, HTTP); events/markers; the spectator is independent of the recorded world.
  Only replicated state is captured.
- Deterministic lockstep (fixed timestep, seeded RNG, input log, pinned rules): tiny,
  breaks when any rule changes. State recording: resolved outputs, robust, larger. Event
  sourcing + content-addressed checkpoints (git-like DAG) gives branching with provenance.

**Adopt? Yes** — hybrid: event-sourced world + snapshot checkpoints + **resolved takes**.

**Mapping to Mars.** `Revision` = immutable state, id = SHA-256 of canonical JSON (sorted
keys, exact decimal floats) + `parent` + `ruleVersion` + `assetVersions` +
`navmeshHash`; canonical years are protected roots. `Take = { baseRevision,
boundPlanHash, ruleVersion, seed, dt, events[], keyframes[] }` — events = resolved
lifecycle transitions with ticks and typed reasons; keyframes = per-tick poses of every
actor/load/vehicle (1 mm / 0.1°, delta-encoded). Replay plays keyframes + events: no
planner, steering or LLM; rerunning the plan is a new take. Resumable checkpoints every
5 s of sim time hold HSM phases, reservations, grips, supports, RNG state, corridors
(§22); visual-only snapshots are labelled and unforkable. Determinism guard: integer
ticks, seeded xoshiro128**, own math with polynomial/CORDIC `sin/cos` (JS engines
differ), per-tick hash asserted equal across Node, browser and DO. Replays run in a
separate core instance with reservations disabled.

**Why.** Checkpoint + stream is the proven shape for scrubbing; resolved keyframes make
takes immune to planner changes (SPEC §23); content hashes make fork isolation mechanical.

**Test.** Rerun a take with a different camera track → identical `events`/`keyframes`
hashes. Fork at t = 20 s and edit → parent revision hash unchanged. Bump `ruleVersion`
and replay → identical output; rerun the plan → new take id.

---

## 11. Human IK, carry poses, animation layering, foot sliding

**Problem.** Generic rigs (Quaternius/Mixamo) must hold grips on a moving load, blend a
carry pose onto walk cycles, and not slide their feet.

**Established pattern.**
- three.js `CCDIKSolver(skinnedMesh, iks)` with `{target, effector, links:[{index,
  limitation, rotationMin, rotationMax, enabled}], iteration, minAngle, maxAngle}`,
  `update()`/`updateOne(i)`, `createHelper()`; needs a SkinnedMesh and a target *bone*
  (https://threejs.org/docs/#examples/en/animations/CCDIKSolver ). Engines use analytic
  two-bone IK with a pole vector for limbs; CCD is fine for 3-link arms given a hinge
  `limitation` on the elbow.
- Layering: three.js has no bone masks; filter `clip.tracks` by bone name (or
  `AnimationUtils.subclip`) for upper-body clips, and `makeClipAdditive` +
  `AnimationAction.blendMode = AdditiveAnimationBlendMode` for additive carry poses
  (https://github.com/mrdoob/three.js/blob/dev/src/animation/AnimationUtils.js ).
- Foot sliding: `action.setEffectiveTimeScale(speed / clipStrideSpeed)` with
  `clipStrideSpeed` measured once from the clip's foot travel; blend walk↔run by speed;
  Unity notes "animation follows agent" always slides a little, so measure it (speed
  matching detail: prior knowledge; not re-verified).

**Adopt? Partially.** CCD for hands (arms only), procedural head look, upper-body track
filtering + additive carry pose; no full-body IK, no root-motion ownership.

**Mapping to Mars.** View-side `CharacterRig` adapter per rig family maps bone names
(`mixamorig:RightHand`, …) to roles; grip targets = the core's `gripSlot` world
transforms; IK runs after the mixer, before render; foot-slide = |foot bone world
velocity| in stance, logged with §29 signals. Hand-to-grip error is visual, never a sim failure.

**Why.** Keeps the existing humanoids (§17) and animation stack; IK is view-only, so
core determinism is untouched.

**Test.** Node test on a SkinnedMesh fixture: after 10 CCD iterations hand-to-target
error < 3 cm for targets within 0.8 m; E2E screenshot of 4 carriers with a 4.8 m beam and
foot slide < 5 cm/s during stance.

---

## 12. Sun position for Bombay Beach (33.33 N, −115.73 W)

**Problem.** Convincing sun elevation/azimuth by date and local time, cheap per frame,
separate from simulation time (SPEC §19).

**Established pattern.** NOAA GML "General Solar Position Calculations"
(https://gml.noaa.gov/grad/solcalc/solareqns.PDF ; details
https://gml.noaa.gov/grad/solcalc/calcdetails.html , based on Meeus, *Astronomical
Algorithms*; sunrise/sunset within ~1 min for |lat| ≤ 72°):
```
γ  = 2π/365 · (doy − 1 + (hour − 12)/24)                  (366 in leap years)
eqtime = 229.18·(0.000075 + 0.001868cosγ − 0.032077sinγ − 0.014615cos2γ − 0.040849sin2γ)  [min]
decl   = 0.006918 − 0.399912cosγ + 0.070257sinγ − 0.006758cos2γ + 0.000907sin2γ
         − 0.002697cos3γ + 0.00148sin3γ                                            [rad]
time_offset = eqtime + 4·lon − 60·tz        (lon = −115.73; tz = −8 PST / −7 PDT)
tst = hr·60 + mn + sc/60 + time_offset ;  ha = tst/4 − 180                         [deg]
cos zen = sin lat·sin decl + cos lat·cos decl·cos ha
cos(180 − az) = −(sin lat·cos zen − sin decl)/(cos lat·sin zen)   (az clockwise from N)
sunrise/sunset: ha = ±acos(cos 90.833°/(cos lat·cos decl) − tan lat·tan decl)
```
Feed UTC (tz = 0) to avoid DST mistakes; resolve the azimuth quadrant by the sign of
`ha` (ha > 0 → afternoon → az = 180 + acos(…)). Accuracy ≈ 0.01–0.1°, ample for lighting.
High-precision reference: Reda & Andreas, NREL/TP-560-34302 (SPA, ±0.0003°,
https://docs.nrel.gov/docs/fy08osti/34302.pdf ) — not needed; npm `suncalc` 2.0.2 exists.

**Adopt? Yes** — NOAA equations, ~40 lines of TS, no dependency.

**Mapping to Mars.** `env/sun.ts: sunPosition(utcMs, lat = 33.33, lon = −115.73) →
{azimuthDeg, elevationDeg}` drives the directional light and sky; environment date/time
is a visual-only presentation field on the take, separate from sim time.

**Why.** Deterministic, tiny, cited; Mars runs Jan–Mar when the low winter sun (noon
elevation ≈ 33–45°) is much of the look.

**Test.** Compare with the NOAA calculator: 2026-01-15 12:00 PST → elevation ≈ 35.5°,
azimuth ≈ 177° (±0.5°); 2026-03-15 sunrise ≈ 06:52 PDT, sunset ≈ 18:52 PDT (±3 min);
azimuth monotonic through the day.

---

## Summary

| # | Topic | Decision |
|---|-------|----------|
| 1 | Recast/Detour | **Partially**: tiled navmesh per profile, corridor + funnel, area flags, off-mesh links; not dtCrowd as mover |
| 2 | recast-navigation-js 0.43.1 | **Yes** for generation/query/serialisation (Node + browser); `Crowd` no |
| 3 | Unity navigation patterns | **Yes**: carve-when-stationary, activated links + manual traversal, "animation follows agent" ownership |
| 4 | Godot agent lessons | **Yes** as invariants: one-shot arrival, tolerance rules, explicit navmesh sync point |
| 5 | Local avoidance | **Partially**: ORCA half-planes + explicit yield/priority + side hysteresis + Reynolds arrival |
| 6 | Carry formations | **Yes**: hybrid A* over the load pose (x, y, θ) + swept OBB checks; carriers from grip slots |
| 7 | Rapier vs own BVH | **Partially**: own BVH query layer first (three-mesh-bvh-style); Rapier-shaped interface for later |
| 8 | Smart objects / sequences / runtime | **Yes**: claim handles on slots; template vs bound plan; HSM per action; no GOAP/BT in core |
| 9 | Cinemachine | **Yes** as concepts: placement / readability / coherence evaluators, ClearShot-style selection with lookahead |
| 10 | Replay/versioning | **Yes**: content-hashed revisions, event log + resumable checkpoints, resolved-keyframe takes |
| 11 | IK / animation | **Partially**: CCD hands + additive upper-body carry + speed-matched playback; view-only |
| 12 | Sun position | **Yes**: NOAA equations in TS, UTC input, no dependency |

**Recommended stack.** Pure-TS deterministic core (`viewer/engine/`: own vector math,
seeded RNG, integer ticks, per-tick state hashes); `recast-navigation` 0.43.1 for
per-profile tiled navmesh generation, Detour queries, corridor/funnel and navmesh bytes
pinned into revisions; project-owned corridor mover with ORCA-style avoidance and explicit
yield rules; project-owned triangle BVH + capsule/OBB query layer (Rapier-shaped interface
for a later dynamics opt-in); hybrid-A* SE(2) load-pose planner with grip-slot carriers;
typed action registry with claim-handle reservations and per-action HSMs that also emits
the MCP tool schemas; event-sourced content-addressed revisions with resumable checkpoints
and resolved-keyframe takes; camera tracks scored offline (placement / readability /
coherence, with lookahead); view-side CCD hand IK + additive carry layers; a 40-line NOAA
sun model.
