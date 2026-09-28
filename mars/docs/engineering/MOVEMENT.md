# Movement: splined turns and block reaction (2026-09-28)

Owner feedback 2026-09-28 §2 (people turn on the spot, sometimes ~270°) and §3 (people walk into
things for 4–5 strides before redirecting). Code: `viewer/engine/locomotion/spline.ts`,
`viewer/engine/locomotion/walk.ts`, `viewer/engine/take/metrics.ts`. Tests:
`viewer/engine/test/movement.test.ts`. Landed in `9e1c2f4`.

## 1. Spline model (`spline.ts`, `smoothPolyline`)

The planner still string-pulls a raw corridor polyline (`spatial/path.ts`, unchanged). On entering a
walk leg, `walk_to` turns it into a **dense polyline**: straight runs joined by circular fillets.
All the existing corridor machinery (`pointAt`, narrows, lateral offsets, replan validity) runs on
these segments.

- **Per interior vertex V** (incoming from the end of the previous fillet, outgoing to the next raw
  vertex), candidates are tried largest radius first:
  - radius R ∈ {1.2, 0.9, 0.6, 0.45, 0.3, 0.2} m;
  - vertex pushed outward along the external bisector δ ∈ {0, 0.1, 0.2, 0.3} m (a wide turn round a
    corner the path hugs).
- **Fit.** A fillet must fit its legs: tangent length R·tan(θ/2) ≤ incoming leg, and ≤ half the
  outgoing leg (all of it on the last vertex).
- **Clearance (hard).** Every piece a candidate changes is sampled every 2 cm (`denseClearance`). Its
  grid clearance must stay ≥ min(plan clearance r + 0.06 m, the raw corridor's own clearance on the
  two legs). The raw legs are measured the same way, so no smoothed sample is worse than the raw
  corridor at that corner.
- **Fallback.** If no candidate fits, the raw vertex stays sharp (the polyline, locally).
- **Samples.** Arcs are sampled every ≤ 0.1 m and ≤ 0.15 rad. Rotation uses `dsin`/`dcos`, and the
  turn angle uses `datan2`. Endpoints are preserved exactly.
- **Speed caps.** Every vertex carries the speed the walker must be down to on arrival there:
  - on a fillet: `min(speed, √(1.5 m/s² · R), 0.8 · turnRate · R)`. So R ≥ 0.6 m at walking speed
    (1.35 m/s needs R ≥ 1.2 m); a 0.3 m fillet is walked at ≤ 0.67 m/s.
  - on a sharp vertex: 0.35 m/s, or 0 (stop and turn in place) if it turns > 2.5 rad.
- **Braking.** The follower brakes at 1.2 m/s² for every cap ahead: `capAhead` = min over vertices
  of √(cap² + 2·a·d).
- **Planning grid.** A route planned around people (`routeAround`) is smoothed on the same
  people-overlaid grids (`Spatial.gridsAround`), so a fillet never cuts into someone it routes
  around.

**Heading.** The walker aims along the chord to the path point 0.3 m ahead, turning at most
`turnRate·dt` = 0.2 rad per tick (`turnToward`, always the shorter way, so never > 180°). The heading
error caps speed: full up to 20°, falling linearly to 0 at **120°** (`TURN_IN_PLACE`). A walker
therefore turns in place only when the path leaves at more than 120° from where it faces (leaving a
seat, a reversal, a replan backwards). It rotates only until the error is below 120°, then walks off
while finishing the turn. A new corridor (replan, next leg) also caps the current speed by its
heading error at once, so nobody slides sideways or backwards at walking speed.

Observed on the proving ground:
- **Corners.** 150 seeded routes plus the wall / U-trap / passage / stairs approach: every corner is
  filleted, > 85 % with R ≥ 0.6 m, none left sharp.
- **Turning.** The wall and U-trap routes from an aligned start have 0 turn-in-place ticks. A 180°
  start turns in place for < 60° + 0.25 rad, then walks. The walked radius at ≥ 1.0 m/s is ≥ 0.55 m
  (4-tick chords).

## 2. Block reaction (`walk.ts`)

**Anticipation (`hazardAhead`), every tick.** The look-ahead covers the next 1.5 s of corridor
(≥ 1 m, `LOOK_TIME`). It is sampled every 0.1 m along the path, with the lateral offset the walker
will actually have there: moving toward its target at 0.9 m/s, halved where clearance does not allow
it. It looks for:
- **standing people**: idle, seated, working, or anyone whose task is not a live `walk_to`, using the
  hard-layer rule (closer than 2r − 0.02 = 0.54 m *and* getting closer);
- **momentarily blocked walkers**: only the next 0.1 m (contact avoidance), because walker-walker
  traffic is the encounter rules' job (follow / head-on give way / crossing / pass with room);
- **carried loads** (`services.loadDiscs`);
- **geometry**: only while the corridor predates the current navigation epoch (a construction
  replan that was deferred).

The first hit is refined by bisection (< 2 mm). The walker brakes to stop **2 cm short** of it
(`STOP_GAP`), so the hard separation layer is a backstop that rarely fires.

**States and reasons.**

| state | when | activity | status / diagnostic |
| --- | --- | --- | --- |
| walking | ground speed ≥ 0.08 m/s | `walk` | running `walk` |
| turning in place | heading error ≥ 120° | `idle` | running `turn` |
| emergency stop | a hazard inside the comfortable stopping distance v²/(2·1.2) — something placed or stepped in front | `wait` | blocked on that tick: `traffic.person` / `traffic.load` / `walk.obstacle` naming it |
| stopped short | at the stop point of a hazard | `wait` | blocked, same codes |
| holding | stopped by X and X is still the hazard ahead: no creeping up to it | `wait` | blocked, same codes |
| give way / yield | head-on without room (`traffic.person`); single-file passage held by someone else (`traffic.yield`); stepped aside for a formation (`traffic.stepped-aside`) | `wait` (or `walk` while stepping sideways) | blocked |
| decision | `DECIDE_TICKS` = 10 ticks (0.5 s) after stopping, if no blocker has moved 0.1 m since: `routeAround` all standing people + loads + the blockers | — | running `replan` |

Rules around the decision:
- **Back-off.** If a replan did not free the walker, the next attempt waits 1, 2, 4, 8, 16 s (at most
  6 attempts, `MAX_PEOPLE_REPLANS`). A blocker that keeps moving is waited for, with its name, up
  to 4 s before routing round it anyway.
- **Fewer obstacles.** If routing round everyone fails because the walker is walled in by people who
  are not blocking it (a fire ring filling up), it routes round only the people who blocked it.
  This fallback runs only when the failure names such a person: a structural failure, such as an
  unfinished stair, never pays for a second search.
- **Idle people** in the way are also asked to make way (`makeWay`), as before.
- **Geometry.** A `walk.obstacle` block forces a construction replan on the next tick.

**Sidesteps round standing people.** The lateral target is the offset (±0.8 m, 0.1 m steps) with the
most room at the encounter point: min(grid clearance − r, distance to every standing person −
0.54 m). So a walker threads the middle of a 1.22 m gap between two people instead of stepping
toward one of them. The sidestep is latched until the person is behind the walker, is released at
the goal, and is reset by a new corridor. If the hard layer cancels a step only because of its
lateral part, the forward part is kept and the offset holds.

**Vehicles.** A walker whose position or next 1.5 s of path comes within 1.5 m of a vehicle being
driven slows to 0.5 m/s (a speed cap only: never a stop, so no standoff with the truck, which stops
for people itself).

**Counters.**
- `outputs.pushes`: steps the hard layer had to cancel. It is 0 in the obstacle-ahead and head-on
  tests.
- `stuck` / `still` / `block` on the exec: the decision clock.

## 3. Renderer contract (W6)

- **`human.speed`** (`world/types.ts` `HumanState.speed`, additive, optional): horizontal ground speed
  in m/s over the last tick, rounded to mm/s. Published by `walk_to` every tick it owns the person,
  including stairs, settle and step-aside; deleted when the walk completes, fails or is cancelled.
- **`human.activity === 'walk'`** is set only while speed ≥ `WALK_MIN` = 0.08 m/s. A blocked walker
  is `'wait'` with speed 0. A walker turning in place, or at rest between states, is `'idle'`.
- **Walk clip rule.** Play Walk iff (live) `human.speed ≥ 0.08`, or (take replay) the track's ground
  speed ≥ 0.08. `speed` is not in the take recorder's discrete FIELDS, and adding it would put a
  change event every tick; replay should derive it from consecutive track samples, as
  `humans.ts` already does.
- **Stair waits.** `app/engine-view/humans.ts` currently plays Walk for any `act.startsWith('climb')`.
  That includes `'climb-wait'` (standing on a flight, waiting for someone), at a minimum 0.35× rate
  even at zero speed. It should exclude `climb-wait` and use the speed floor. This is renderer-owned,
  not changed here.

## 4. The take metric (`take/metrics.ts`)

"Walk stall" = a person-tick whose activity is `walk` while the ground speed (horizontal
displacement since the previous tick / dt) is < 0.05 m/s.

- `walkStallsOfTake(take)` computes it from a recorded take: the same interpolation as replay,
  1 mm quanta, ±0.028 m/s noise.
- `walkStallMeter(rt)` is the live observer (exact positions). Both return
  `{ ticks, walkTicks, stalls, byActor, first[] }`.

| scene | before (HEAD `09f318b`) | after |
| --- | --- | --- |
| build-bay flagship rehearsal take | 24 / 7714 walk-ticks | **0** / 7391 |
| lab stress-30, 60 s | 11 / 27903 | **0** / 27275 |
| lab campfire evening, 75 s | 9 / 2995 | **0** / 2876 |

The bound asserted in `movement.test.ts` is exactly 0 for all three. The "before" stalls were
decelerations ending under 0.05 m/s while still labelled `walk`. The larger dishonesty was the other
way round: in build-bay, 414 `wait` ticks and 215 `idle` ticks were really moving (sideways yields
and settles at up to 0.9 m/s without the Walk clip). Now any ground motion ≥ 0.08 m/s is `walk`.

## 5. Costs

stress-30 (lab stepping, 60 s, loaded machine):

| | before | after |
| --- | --- | --- |
| mean tick | 0.41–0.63 ms | 0.71–0.85 ms |
| max tick | 63–133 ms (tick 5) | 83–113 ms |

`walk_to.step` total is about 2× (the look-ahead and the more frequent 0.5 s decisions). Flagship
rehearsals take +10–25 % compute, measured on a loaded host.

W11 (`PLANNING_BUDGET.md` §6, all hashes identical) brought stress-30 back to a 0.48–0.50 ms mean tick and failing
people-replans from ~90 ms to ~9 ms. The +10–25 % rehearsal figure did not reproduce there.

## 6. What is approximate

- **Look-ahead offset.** The sidestep offset the look-ahead predicts is a straight-line
  extrapolation at 0.9 m/s, halved against the grid. The real offset can differ; the hard layer
  catches the rest, and those cases are counted in `pushes`.
- **Sharp fallback is rare.** On clear legs a fillet of R ≥ 0.2 always fits a 90° corner
  geometrically. The sharp fallback happens only for very short legs, near-reversals, and
  half-cell clearance quantisation. The adversarial test therefore shows the clearance check
  rejecting the wide arcs, not a full fallback.
- **Walker-walker encounters.** These are still the old follow / head-on / crossing rules on the
  current tangent, not the smoothed path ahead.
- **Emergency stop.** Stopping at once when something appears inside ~0.8 m at walking speed is
  abrupt (velocity to 0 in one tick; position is continuous). It is what the spec asks for; a
  one-step physical stop is not modelled.
- **Vehicles.** A vehicle counts as "being driven" when its rider's action is active and not
  blocked. There is no velocity model.
- **Crowd jams.** When a walker is walled in by a crowd that never moves, it still waits with a
  named reason after the backed-off attempts. It never squeezes below the 0.54 m separation.
