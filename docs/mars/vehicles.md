# Vehicles: EUC, bicycle and forklift

Spec: [spec.md](spec.md) §10, §12, §17. Code: `engine/vehicles/` (`profiles.ts`, `curve.ts`, `actions.ts`, `invariants.ts`).
Tests: `engine/test/vehicles.test.ts`. The verbs and invariants are registered in `api/registry.ts`.

## Model
- A vehicle is an entity, `kind: 'vehicle'`, catalog def `euc` or `bicycle` (both `obstacle:
  true`); build one with `vehicle(id, 'euc', x, z, yaw)`.
- **Parked:** no phase, support `ground`: a static obstacle at its catalog box that walkers route
  around. **Ridden:** phase `carried` (out of the grids), support `{ kind: 'ridden-by', by }`;
  the rider has `human.riding = id`, activity `ride` and `human.grip = { entity: id, slot:
  'rider' }` (so `walk_to`, `makeWay` and ambient behaviour leave them alone), at the vehicle's
  pose raised by `riderY`.
- Two optional fields were added to `world/types.ts`: `HumanState.riding`, `Support 'ridden-by'`.

## Profiles (`VehicleProfile` extends `AgentProfile`)
| | radius | speed (default / max) | accel / brake | turn radius | step | track margin |
| --- | --- | --- | --- | --- | --- | --- |
| EUC | 0.35 m | 3 / 5 m/s | 1.2 / 2.0 m/s² | 0.6 m at ≤ 1 m/s → 1.5 m at ≥ 3 m/s | 0.05 m | 0.15 m |
| bicycle | 0.40 m | 4 / 6 m/s | 1.0 / 2.0 m/s² | 1.2 m at ≤ 1.5 m/s → 2.0 m at ≥ 4 m/s | 0.08 m | 0.15 m |

All vehicles share these limits: lateral acceleration ≤ 2 m/s², no links, and one level.

## Planning (`curve.ts`)
1. **Grid route.** `findRoute` runs on the vehicle's level with radius = `radius + trackMargin`
   (plus the planner's own 0.06 m) and with the scene's links removed. Kerbs are also treated as
   walls here: an obstacle whose top lies between the vehicle's `stepHeight` and the walkers'
   0.22 m step blocks the vehicle, while walkers still step over it.
2. **Reference curve.** The corridor polyline becomes tangent lines and circular arcs. At each
   corner the arc is either a *fillet* inside the corner, or a *wrap* centred on the nearest
   blocked cell on the inside, which swings wide of an obstacle end. Candidate radii are the fast,
   middle and slow turn radii × 1.1 (headroom), tried largest first. A corner is accepted only if
   every sample from the previous arc through the next tangent keeps clearance ≥
   `radius + 0.08 m` (≥ `radius` within 0.6 m of either end). The choice is sequential, with one
   step of backtracking. If no curve fits, the plan fails with `vehicle.turn-too-tight`, naming
   the wall.
3. **Speed profile.** Arc speed is the lower of the turn-radius limit and √(2·ρ), which keeps
   lateral acceleration ≤ 2 m/s². A backward pass then applies `accel` braking down to 0 at the
   end.

## Following (`ride_to` step)
- **Steering.** Pure pursuit, lookahead `clamp(0.25 + 0.25 v, 0.35, 1.25)` m, curvature clamped
  to 1 / `turnRadiusAt(v)`, poses integrated along arcs. Standing still and misaligned by more
  than 0.6 rad, the rider first pivots the vehicle in place at `turnRate`.
- **Clearance.** Every tick checks `segmentClearance ≥ radius` on the vehicle grids; a failure
  stops the vehicle (`vehicle.corridor`, blocked) and replans. A construction epoch change
  re-checks the rest of the curve; if it is blocked, the vehicle brakes and replans.
- **People.** Anyone within 0.25 m of body gap of the swept path blocks it: the vehicle stops at
  least 1.0 m of body gap short (`traffic.person`), asks them to step off sideways (`makeWay`),
  and rides on once they move. Within 0.6 m of body gap speed is capped at 0.9 m/s; it never
  steps into a person's space. After 3 s stuck it replans around standing people (at most 3 times).

## Verbs
- `mount {actor, vehicle}`: the vehicle must be within 1.2 m on the actor's level and parked with
  clearance ≥ its radius. The actor steps on over about 1 s. A cancel steps them back off.
- `ride_to {actor, x, z, level?, speed?}`: a `level` other than the rider's fails with
  `route.vehicle-no-link`, naming the links. A target that is too narrow fails with
  `vehicle.too-narrow`, naming the walls (a bicycle needs 1.22 m; the 1.0 m passage fails naming
  `passage-w` and `passage-e`). A cancel brakes to a stop.
- `ride_loop {actor, points[], laps?, close?, speed?}`: the points are visited in order, `laps`
  times, closing back to the first point unless `close: false`, as one continuous curve. At
  waypoints the curve fillets, so it passes near each point without stopping; `miss` is reported
  at the end.
- `dismount {actor, side?}`: the rider steps off to the left or right of the stopped vehicle
  (falling back to behind, then in front) at a spot clear of its box. The vehicle is parked there
  and becomes an obstacle.
- `ride_*` outputs: `{length, distance, time, maxSpeed, maxLatAccel, minRadius, replans, miss}`.

## Invariants (`VEHICLE_INVARIANTS`)
`vehicle.rider-off` (the pairing is broken, or the rider is off the pose),
`vehicle.static-clearance`, `route.vehicle-no-link`, `motion.teleport`, `vehicle.max-speed`,
`vehicle.close-pass` (faster than 1 m/s within 0.6 m of body gap of a person),
`collision.vehicle-vehicle` (below).

## Vehicle–vehicle collision (`vehicles/traffic.ts`)
Everything here engages only when a second **ridden** vehicle is on the level (parked vehicles are static
obstacles in the grids, as before), so single-vehicle scenes run the old code path.

- **Footprint.** The catalog box, the rider's body (0.56 m square, rider feet → +1.8 m), per-def parts
  (`FOOTPRINT_PARTS`: the forklift's tines, 1.1 m × truck width ahead of the truck, just under a load on
  the forks, else ≤ 0.45 m up) and any load on the forks at its own box and height — kept in the vehicle's
  frame so it can be placed at any pose along a path. `reach` (farthest corner), `half` (lateral
  half-width) and `front` (overhang) summarise it; a load wider than the truck widens its `half`.
- **Invariant `collision.vehicle-vehicle`.** Every tick, every pair of vehicles (parked or ridden): any two
  footprint boxes overlapping by more than 1 cm in plan where their height bands overlap by more than
  1 cm. One violation per pair, naming both vehicles and the load / rider parts involved (`f1's ply1
  overlaps e1 (euc)`); a load raised above a parked EUC's 0.55 m box does not fire.
- **Lanes.** Each riding vehicle (ride_to, ride_loop, a forklift's drive) publishes every tick its path
  ahead — 4 s at its current speed, plus its stopping distance and front overhang, at least 3 m beyond
  its front — with its speed, footprint `half` / `reach` and the tick its ride started, in
  `services.vehicleLanes` (plain data: snapshotted, never part of a state hash; dropped when the ride
  ends). A lane older than one tick is ignored.
- **Right of way.** The smaller vehicle yields (profile radius: EUC 0.35 < bicycle 0.40 < forklift 1.4);
  between equals, the ride that started earlier keeps its way, then the lower vehicle id.
- **Following (per tick).** Against every other ridden vehicle:
  1. *Footprint on the path*: if the swept footprint (placed at each curve sample) would come within
     0.25 m of its footprint and closer than now, stop 1.0 m short (`V_STOP_GAP`); stopped, it reports
     `traffic.vehicle` — `op1 on f1 waits for r1 on e1 (euc), stopped in its lane at (x, z)` — and after
     3 s plans round a vehicle that stands still (`MAX_REPLANS` 3; a forklift, 2.5 m turn radius and no
     reversing, usually cannot swerve round something it stopped 1 m short of, so it waits).
  2. *Yielding to a lane* (the other has the right of way): stop where the body would come within
     1.0 m (`YIELD_GAP`) of its lane band (path ± `half`, plus its current footprint) —
     `r1 on e1 gives way to op1 on f1 (forklift): waits 1 m clear of its lane at (x, z)`. Already
     inside the band (head-on, or the lane arrived): carry on if the path leaves it within 3 m and stays
     out, else brake and **pull over** to a spot on its own side ≥ 1.1 m clear of the band (candidates
     straight out, then 1.5 / 3 m along the lane; clearance and a drivable curve required), then plan on
     toward the remaining targets — the lane rule holds it at the lane's edge until the other has passed.
     No spot: `… must give way to … but has no room to pull over`, retried every 0.5 s.
  3. *Hard guard*: no step may close a footprint gap already under 2 cm.
  Riders of other vehicles still count as people for slowing (`PASS_GAP` / close-pass), not for stopping or
  `makeWay` (a mounted rider cannot step aside); the forklift's 1.5 m person rule skips them too. The
  forklift's square-up and creep refuse a move that brings truck + load within 0.3 m of another ridden
  vehicle (`traffic.vehicle`, blocked until it moves).
- **Planning.** `ride_to`, `ride_loop` and forklift drives plan round ridden vehicles that are not riding a
  lane (moving ones are yielded to, not avoided), and are refused **`vehicle.path-conflict`** — naming
  both riders and vehicles — when, advancing both from now (discs of their `reach`, 0.1 s steps over
  10 s; the other at its speed, or half its cruise if momentarily stopped), they would come within
  `YIELD_GAP` and the one that must yield cannot: it starts inside the other's lane band with no
  pull-over spot, or (when the planner has the right of way and stands in the other's lane) the other
  cannot stop 1 m short of it within its braking distance and has no pull-over spot either.
- **Tests** (`engine/test/forklift.test.ts`, "traffic: …"): head-on forklift vs EUC on one line (the EUC
  pulls over, waits ≥ 1.0 m clear of the lane, both arrive, footprints ≥ 0.9 m apart, 0 violations); an
  EUC parked by its rider in a forklift's line (the forklift waits ≥ 1 m short with the rider named, and
  carries on once it rides off); two forklifts crossing (f2 waits with the reason named, f1 never
  waits, ≥ 1 m apart, 0 violations); `vehicle.path-conflict` for an EUC boxed against a wall inside a
  moving forklift's lane (and the same ride accepted once the forklift has passed); forced overlaps (a
  parked EUC under a carried sheet → `f1's ply1 overlaps e1`, a raised sheet clear, truck on truck);
  determinism (hash + event log).
- **Approximations.** Lanes are a straight read of the planned curve (no prediction of a replan or of the
  other's braking); yield zones use the yielder's `reach` disc, so a long vehicle (a bicycle, a loaded
  forklift) keeps more than 1 m on its narrow side; the forklift's reach / side-shift / fork-raise
  steps are not checked against other vehicles (only its square-up and creep), and the empty fork
  height is assumed ≤ 0.45 m. A physical three-EUC cycle is detected and reported blocked; this is not a general
  deadlock-freedom guarantee. Invalid-overlap tests inject corruption after `edit_world` refuses it; legitimate
  parked-vehicle setup uses the public edit path.

## Limits (not modelled yet)
- Vehicles are discs (the bicycle's 1.75 m length is not swept); no lean, wheel or balance
  kinematics; no reversing or three-point turns (a standstill pivot instead).
- Vehicle–vehicle traffic is the heuristic above (right of way, yielding, pull-over), not a
  negotiated or proven-deadlock-free scheme; walkers still see a rider as a 0.28 m person, not the
  vehicle's footprint.
- No charging, battery or range model; overhead clearance uses the grids' 1.8 m body height.
- The curve is G1 only (no clothoids); pure pursuit absorbs the curvature jump within 0.08 m.

## Forklift
Code: `engine/vehicles/forklift.ts` (verbs `forklift_pick`, `forklift_deliver`, invariant
`forkliftLoad`; registered in `api/registry.ts`). Tests: `engine/test/forklift.test.ts`.

- **Truck.** Catalog def `forklift` (2.6 × 1.2 m, lowered mast 2.2 m, `obstacle`, 2600 kg; forks at
  local +x); build one with `forklift(id, x, z, yaw)`. Limits (`FORKLIFT`): lift 0–3.2 m, forks
  1.1 m (+0.3 m load overhang), capacity 1000 kg, raise/lower 0.3 m/s, side-shift ±0.15 m,
  push-pull reach at 0.2 m/s, straight creep / back-off 0.5 m/s. Profile `FORKLIFT_PROFILE`: disc
  radius 1.4 m, 1.5 / 2 m/s, turn radius 2.5 m, no links; forklift.ts adds it to
  `VEHICLE_PROFILES`, so `mount` / `dismount` and all vehicle invariants apply unchanged.
- **Load on forks.** Phase `carried`, support `{ kind: 'forks', vehicle }`, pose = truck pose +
  (carriage + gap + depth/2 + reach, side-shift) at fork height. `engagement(def)` picks the side:
  forks along the load's short axis (approach its long side) when that fits the reach, else along
  its long axis; otherwise `forklift.no-engagement`.
- **`forklift_pick {operator, item}`.** The operator must be mounted and idle. The item lies flat on
  the ground (`stored`/`staged`, support `ground`, ≤ capacity). For each fork-side heading the
  approach lane (truck width, from the item's edge back past the pre-pose) must be free of
  obstacles between 5 cm and mast height, and the pre-pose / engagement pose need clearance ≥ 1.4 m;
  otherwise `forklift.no-approach` names the blockers. Then: drive (below), square up, lower forks
  to 0, side-shift + creep until the load touches the carriage, engage, raise to 0.3 m.
- **`forklift_deliver {operator, to: {x, z, yaw, level}}`.** `to` is the load's placement. The
  footprint must lie on one surface of `level` (decks exist in the scene only when installed and
  supported — contributor.ts) and be clear of obstacles and people (`forklift.no-surface`,
  `forklift.placement-blocked`). Deck > 3.2 m above the truck's floor → `forklift.lift-range`. The
  truck must approach square to the receiving edge (the deck side behind the load); the load's far
  side may be at most fork length + 0.3 = 1.4 m in from that edge (`forklift.reach`). Sequence:
  drive loaded to a pre-pose (load 0.3 m short of the edge), square up, raise to deck + 5 cm, creep
  until the truck front is 5 cm short of the edge (the mast never goes under the deck), push the
  load out (reach), lower onto the deck, release, retract, back off 1 m, lower to 0.3 m. The load is
  left `staged` with support `ground` at the deck top: exactly what `stagedCheck` (install_joist /
  install_plywood) accepts. (Construction deck levels are `round(y / 0.5)`; the proving-ground
  deck is scene level 1.)
- **Driving.** Reuses the ride_to follower: a curve from `planCurve` with a *loaded* profile
  (radius = farthest point of truck + load from the truck centre, 2.73 m for a 4x6 sheet) through a
  4 m straight lead-in to the pre-pose, run with `rideTo.start` / `rideTo.step`. The follower's own
  replans use the unloaded 1.4 m disc (per-tick load-collision checks cover the load).
- **Overhead.** Obstacles the walking grids ignore (bottom ≥ 1.8 m: deck slabs, `.up` prisms) are
  checked against truck + load at travel height (max(mast, 0.3 + load, 0.3 + 1.0 m carriage)) along
  the curve, and against the mast at the raise height at the pre-pose and final pose →
  `forklift.overhead` naming the obstacle. The raised load is swept along the creep.
- **Every tick.** Vehicle invariants (rider pose, clearance ≥ 1.4 m, teleport, max speed,
  close-pass); the load box against every scene obstacle (`forklift.load-collision`, in the step and
  as the `forkliftLoad` invariant, which also checks the lift range); anyone within 1.5 m of body
  gap of the moving truck or load (plus braking distance while driving) → the truck stops, calls
  `makeWay`, and reports `traffic.person` (blocked) until they leave.
- **Cancel.** While driving: brake to a stop (deferred). Refused (`forklift.cancel-unsafe`) while the
  load is raised above travel height.
- **Limits.** No tilt, no pallets or dunnage (forks slide under a flat sheet), no load-moment chart
  (capacity is flat 1000 kg), final alignment is a standstill pivot + side-shift (no three-point
  turns), the truck body is not swept against people other than the 1.5 m stop rule, and placements
  must be square to a deck edge. Other vehicles: see "Vehicle–vehicle collision" above.


## Persistent ride waits

Ride waits publish a vehicle mover with its rider as an alias in the wait graph
([movement.md](movement.md#persistent-waits-and-bounded-recovery)). After the grace period, a stopped ordinary ride may
request one validated route retry within its replan cap and the shared per-tick budget; pull-over and resume phases
report recovery unavailable. No vehicle pose or resource is forced free. Forklift manipulation waits, mixed
loaded-vehicle cycles and general deadlock freedom are not covered.
