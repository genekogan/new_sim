# Vehicles: EUC and bicycle riders (spec §10, §17)

Code: `viewer/engine/vehicles/` (`profiles.ts`, `curve.ts`, `actions.ts`, `invariants.ts`).
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
`vehicle.close-pass` (faster than 1 m/s within 0.6 m of body gap of a person).

## Limits (not modelled yet)
- Vehicles are discs (the bicycle's 1.75 m length is not swept); no lean, wheel or balance
  kinematics; no reversing or three-point turns (a standstill pivot instead).
- No collisions or traffic rules between moving vehicles (each sees the other's rider as a
  person); walkers see a rider as a 0.28 m person, not the 0.35–0.40 m disc.
- No charging, battery or range model; overhead clearance uses the grids' 1.8 m body height.
- The curve is G1 only (no clothoids); pure pursuit absorbs the curvature jump within 0.08 m.
