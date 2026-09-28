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

## Forklift (spec §7, §12)
Code: `viewer/engine/vehicles/forklift.ts` (verbs `forklift_pick`, `forklift_deliver`, invariant
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
  must be square to a deck edge.
