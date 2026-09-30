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

Rules around the decision (W15, 2026-09-28, where noted):
- **Stationary vs moving blocker.** A blocker standing still (idle, warm, seated, working, a blocked
  walker, or a walker at the end of its route turning to face: speed 0) is routed around within
  `DECIDE_TICKS` of the walker stopping. A blocker that is itself walking keeps moving, so the clock never
  reaches 10 ticks: the walker waits, follows or gives way with the blocker's name. It routes round a
  moving blocker only after 4 s (`STUCK_TICKS`), the safeguard against someone jittering in place.
  Tests: `movement.test.ts` (stationary blocker, moving blocker).
- **One blocked stretch, one clock (W15).** The stretch, and its decision clock, ends only when the walker
  is under way again: faster than 0.15 m/s (`CREEP_SPEED`) or 0.2 m further along the corridor
  (`BLOCK_PROGRESS`). Before W15, one tick of creeping (0.06 m/s, 3 mm) between two blocked ticks reset the
  clock. In the lab campfire, x1 crept round g3 at the separation limit for 79 ticks this way before
  anything decided.
- **Back-off.** If a replan did not free the walker, the next attempt waits 1, 2, 4, 8, 16 s (at most
  6 attempts, `MAX_PEOPLE_REPLANS`).
- **Squeeze (W15; replaces "fewer obstacles").** `routeAround` names the people and loads behind a failure
  in `diagnostic.subjects` (`RouteOpts.nameObstacles`, `spatial/path.ts`):
  - the people who crowd the start or goal within the snap distance;
  - the people who separate the region the search exhausted from other free space (walled in);
  - the people at the approach of a stair that would connect that region.

  If the failure names a person, the walker routes round the same people again, each planned as an
  octagon of inradius 0.22 m instead of a 0.3 m square (`SQUEEZE_HALF`):
  - with the 0.1 m raster, a person then blocks planning to 0.61–0.78 m from their centre instead of
    0.60–0.875 m, still outside the 0.54 m separation;
  - a diagonal gap between two people needs ≈ 1.56 m instead of 1.75 m.

  A structural failure (geometry, an unfinished stair) names nobody and is never searched twice.
  Before W15, `findRoute` only ever put link ids in `subjects`, so the old fallback (route round only the
  people who blocked this stretch) never ran. Where it would have run, it walked the walker into the
  people it left out: a campfire_circle walker routed round f5 alone went into f7. Test: `movement.test.ts`
  (squeezed people-replan), `navigation.test.ts` (naming).
- **Crowded start (W15).** `routeAround` lets the start snap up to 1 m (`RouteOpts.startTolerance`; default
  0.5), so a walker standing in a gap between people plans from the nearest standable spot and steps out
  first. The nearest cell is the same whatever the tolerance whenever one lies within 0.5 m.
- **Idle people** in the way are also asked to make way (`makeWay`), as before.
- **Geometry.** A `walk.obstacle` block forces a construction replan on the next tick.
- **Who counts as walking (W15).** `isActiveWalker` is false for a walk that is blocked, and now also for one
  at the end of its last leg (settling onto its goal, turning to face). Such a person is a standing obstacle
  for the look-ahead, sidesteps and people-replans, and a 'static' encounter. Before, their yaw, rotating
  in place, read as oncoming or crossing traffic, so walkers took a head-on passing offset into them.

**Sidesteps round standing people.** The lateral target is the offset (±0.8 m, 0.1 m steps) with the
most room at the encounter point: min(grid clearance − r, distance to every standing person −
0.54 m). So a walker threads the middle of a 1.22 m gap between two people instead of stepping
toward one of them. The sidestep is latched until the person is behind the walker, is released at
the goal, and is reset by a new corridor. If the hard layer cancels a step only because of its
lateral part, the forward part is kept and the offset holds. A new standing person met while the side is
latched may change the target but never flips the side while the latched person is still alongside (W15).
Two people flanking the way (a slot between neighbours in a ring) used to flip it every tick as each became
the nearer encounter; the walker jittered ±0.05 m and stopped on alternate ticks.

**Walker-walker encounters on the smoothed path (W15).** follow / head-on / crossing are measured against
the line the walker will actually walk: the smoothed path over the next 2.5 m (`LOOK`), sampled every
0.1 m, shifted by its current lateral offset and anchored at its body. A person's `along` is the arc length
to the nearest sample (plus the projection there), `lateral` is their distance from the path, and the kind
compares the other walker's heading with the path tangent where they meet. That heading is the chord of the
other walker's own smoothed path over its next ~1 s (`ENC_TIME`), or its yaw if it has no path. On a
straight path this is exactly the old measure. The head-on side choice (`onRight`), `roomToPass` (local
normals at both passing spots) and the pass latch (`stillPassing`) use the same geometry.
`encounterOf(rt, walkId)` exposes it for tests.
- A walker coming back along the path just past a bend is head-on, though it is outside the old
  straight-tangent band.
- A person dead ahead of the current tangent, where the path has already turned away, is no encounter.

Tests (`movement.test.ts`): head-on in the 1 m passage on curved approaches, crossing at a block corner (6
staggers; they meet at 0.71–1.06 m, pushes 0, stalls 0), and the two cases above.

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
  including stairs, settle and step-aside; deleted when the walk completes, fails or is cancelled, and by the
  runtime's cleanup whenever a task ends by failing, cancel or snapshot drop (W21: a dropped carry left idle
  people publishing 0.3–0.6 m/s). It is honest: never above the activity's cap (§7, `motion.overspeed`).
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
- **Walker-walker encounters.** They use the smoothed path ahead (W15). The other walker's heading is a 1 s
  chord of its path, not a prediction of where it will be when they meet: there is still no time-to-collision
  model. Head-on round a tight corner is decided by the single-file traffic rule, not by the encounter: a
  path hugging a wall runs through single-file cells.
- **Emergency stop.** Stopping at once when something appears inside ~0.8 m at walking speed is
  abrupt (velocity to 0 in one tick; position is continuous). It is what the spec asks for; a
  one-step physical stop is not modelled.
- **Vehicles.** A vehicle counts as "being driven" when its rider's action is active and not
  blocked. There is no velocity model.
- **Crowd jams.** When a walker is walled in by a crowd that never moves, and even the squeezed plan finds no
  gap, it waits with a named reason after the backed-off attempts. It never goes below the 0.54 m separation.
  With 0.1 m cells, a gap of 1.08–1.5 m between two people (enough for a body, e.g. neighbours on an
  8-place fire ring 1.22 m apart) cannot be planned through at some angles. The look-ahead and sidestep can
  still walk it, but a replan cannot.

## 7. No jumps (W21, 2026-09-28)

W20 found `walk_to` publishing one-tick speeds of 4–11 m/s: bodies moved 0.2–0.55 m in a tick. That passed the old
0.6 m `motion.teleport` bound, which was 12 m/s. A walker's top speed is 1.35 m/s, 0.0675 m per tick.

**The rule.** A `walk_to` body moves at most `min(speed, WALK_SPEED_CAP) × DT` per tick, with `WALK_SPEED_CAP` = 1.4 m/s
(`walk.ts`). `walk_to`'s `speed` param is capped at 1.4 too (it was 3). Forward progress along the corridor, the lateral
sidestep / passing offset and any pull back into line all come out of this one budget, never on top of it. Each tick:
1. **Fits.** If the full step fits (normal walking), it is taken.
2. **Largest fraction.** Otherwise the walker takes the largest fraction t of this tick's corridor progress and offset
   change that fits (bisection, 10 steps). It slows: `ex.v` drops to the progress actually made. Two cases need this:
   - an offset swept round the outside of a bend: a 0.8 m sidestep on a 0.6 m fillet sweeps 2.3× faster than the
     corridor point;
   - a sidestep taken while walking at full speed: 1.35 m/s forward + 0.9 m/s lateral = 1.62 m/s.
3. **Pull in first.** If less than half the progress fits because the offset must narrow ahead (the sidestep does not
   fit through the gap), the walker first pulls its offset in where it stands, by ≤ the budget. It moves straight
   towards its corridor point, on the segment its body was placed on, so it stays inside the clearance it already has.
   It walks on once the offset fits. With no progress at all it pulls in towards the corridor itself (no deadlock).
4. **Walk back.** A body away from its corridor point walks straight back to it at the budget, holding its progress.
   This happens only when a walk starts off its route. Routes already begin at the body: a crowded start's snap (≤ 1 m,
   W15) is the route's first segment, walked.

**Supporting fixes.**
- **Hold.** When the hard separation layer cancels a step (`pushes`), the offset stays with the body. Before, it kept
  moving towards the sidestep target while the body was held.
- **Narrowing.** An offset spot without clearance narrows the offset to the largest fraction that has room (bisection),
  instead of halving it in one step.
- **Stair entry.** A walk leg ends within 5 cm of a flight's standing entry point (its settle tolerance). The walker steps
  onto the entry point at walking pace before the climb starts.
- **Frame climb.** `climb_stance` (`construction/stance.ts`) starts its climb path from the body, stepping in at the
  frame's climb speed of 0.35 m/s. The walk to the stance foot may end up to 0.35 m off it: `walk_to`'s goal snap,
  because the foot beside the column has no standing room.

**Invariants** (`runtime/invariants.ts`, in `DEFAULT_INVARIANTS`, end of tick):
- **`motion.teleport`.** A person on foot moves ≤ `MAX_HUMAN_STEP_PER_TICK` = 0.15 m per tick (3 m/s, 3D).
  - That is twice the fastest walk.
  - It is above every carry / climb / sit / stance transition measured: ≤ 0.091 m after W21. The largest was a frame
    climb's first step, 0.121 m; it is now walked.
  - A rider (`human.riding`) moves with its vehicle and keeps `MAX_STEP_PER_TICK` = 0.6 m. EUC ≤ 5 m/s = 0.25 m/tick;
    the forklift rider measured 0.075 m/tick. Carried components keep 0.6 m, farthest point, rotation included.
- **`motion.overspeed`.** The published `human.speed` must be ≤ its activity's cap + 5 % (`SPEED_CAPS`):

  | activity | cap |
  | --- | --- |
  | `walk` | 1.4 m/s |
  | `climb-up` / `climb-down` | 0.45 m/s (`CLIMB_SPEED`) |
  | `idle` / `wait` / `climb-wait` | `WALK_MIN` = 0.08 m/s |

  An activity that publishes a speed but has no cap is a violation too.

Tests:
- `review.test.ts`: the bounds (0.20 m on foot is a teleport, 0.14 m is not, a rider's 0.5 m is not, 0.7 m is), and
  overspeed per activity.
- `movement.test.ts` "no jumps": max one-tick walker distance ≤ 1.4·DT with honest speeds over stress-30 (60 s) and the
  campfire evening. The measured maximum is 0.0675 m.
- Every rehearsal test now runs under both invariants with 0 violations.

**Spike classes found** (scratch spy over the pinned runs at `e8fb08a`: every person-tick, what `walk_to` was doing).
Each cell is *ticks faster than 1.47 m/s / of which > 0.1 m / max m per tick*:

| class | flagship | stress-30 | meal | v3 | 2022 bay 1 | 2022 whole house |
| --- | --- | --- | --- | --- | --- | --- |
| A. release after a hold ¹ | 8 / 8 / 0.550 | 1 / 1 / 0.550 | 1 / 1 / 0.180 | — | 2 / 2 / 0.540 | 8 / 8 / 0.550 |
| B. offset collapse ² | 7 / 3 / 0.211 | 13 / 11 / 0.292 | — | 6 / 6 / 0.360 | 38 / 21 / 0.315 | 260 / 132 / 0.550 |
| C. offset swept / sidestep at full speed ³ | 326 / 46 / 0.215 | 222 / 1 / 0.305 | 2 / 0 / 0.076 | 297 / 48 / 0.144 | 1092 / 140 / 0.186 | 3115 / 766 / 0.186 |
| stance climb entry ⁴ (not `walk_to`) | — | — | — | — | 22 / 5 / 0.121 | 37 / 14 / 0.121 |
| **max one-tick distance, before → after** | 0.550 → 0.0675 | 0.550 → 0.0675 | 0.180 → 0.0675 | 0.360 → 0.0675 | 0.540 → 0.0675 | 0.550 → 0.0675 |

¹ The step was cancelled by the hard layer while the offset drifted up to 0.8 m. The flagship count includes one walk
that completed on the release tick (0.17 m). Before this change, W20's "11 m/s" p6 @1092 and "6.3 m/s" p5 @2290 were
this class.
² `place()` halved the offset in one step when the offset spot lacked clearance. A 0.5–0.55 m case continued at the
old `MAX_CORRECTION`.
³ Mostly 1.5–1.6 m/s. The > 0.1 m ticks are 0.8 m offsets on tight fillets, and the stress-30 0.305 m is the catch-up
tick after a class-A release.
⁴ One whole-house run during this work hit 0.37 m (a goal snap), now walked.

After: 0 walker ticks faster than 1.47 m/s in all six runs. The maximum is 0.0675 m = 1.35 m/s, the walk speed. The
only person-ticks above 0.0735 m are other actions, all under 0.15 m:
- a sit-down transition: 0.087 m (meal);
- the forklift rider: 0.075 m;
- `climb_frame`'s first tick: 0.091 m (v3).

Pins moved once, with the same discrete outcomes (`PLANNING_BUDGET.md`).

**What is approximate.**
- **Pull-in path.** The pull-in / walk-back is a straight line: towards the corridor point, or towards the route's
  point. Both ends have clearance, and the pull-in lies on the segment the body was placed on. The walk-back (a walk
  started off its route) is not clearance-checked along the way; the static-clearance invariant would name it.
- **Honest but abrupt.** Sidestepping while walking at full speed now slows the forward speed for the ticks the offset
  changes. That is honest, but the look-ahead does not anticipate it: it predicts the offset at 0.9 m/s lateral, not the
  shared budget.
- **Other movers.** The 0.15 m bound and the overspeed caps cover `walk_to` exactly. Other movers publish no speed:
  carry formations, frame climbs, stance / sit transitions. They are bounded only by the 0.15 m teleport limit. Their own
  speeds are not asserted per activity: carry `CARRY_SPEED` 0.9 m/s, frame climb 0.35 m/s (`construction/frame.ts`).
  The exception is beam walking, which has its own `frame.beam-overspeed` (0.4 m/s).


## Persistent waits and bounded recovery (LM-024, staged)

`runtime/waits.ts` collects explicit dependencies by mover, not action id: a
carry's gathering walkers remain separate nodes, moving carries alias their crew
to the load, and rides alias their rider to the vehicle. Walk person/load/passage
waits, carry person/stair waits and ride person/vehicle waits publish concrete
identities. Static blockers and ambiguous aliases do not become invented mover
edges. Forklift-specific manipulation waits are not covered.

A cycle with unchanged dependencies and poses for 200 consecutive ticks (10 s)
gets `deadlock.cycle`; persistent acyclic waits get `deadlock.stalled`. Pose
progress uses a fixed anchor: translation over 1 mm or wrapped angular change
over 0.001 rad resets the episode. This is a reporting-only tolerance; collision,
support and movement rules are unchanged. Cumulative slow progress resets it;
bounded sub-millimetre steering jitter and alternating original wait codes do
not reset recovery caps. Changed blocker identity always starts a new episode.
Only mover aliases and their concrete blockers contribute poses, not unrelated
world entities.

Each mover episode requests at most one additional existing validated planner
attempt, within existing planner budgets/caps. Walker recovery shares the
person/load route-and-squeeze path; gathering carries address their specific
sub-walker; stopped floor carries share their augmented-grid formation planner;
stopped rides share their existing route planner. Unsupported stairs, occupied
goals, completed caps and active pull-over/resume phases explicitly report
`deadlock.recovery-unavailable`. Planner admission may defer for at most 200
ticks; budget starvation is named and never counted as an actual attempt.
Another 200 unchanged ticks after the attempt/refusal exhaust the episode.
Existing normal action retries remain active throughout. The detector never
forces a resource release; a successful validated replan follows its ordinary
route-ownership behavior.

SequenceRunner returns `blocked` early only if every live root, child and ambient
action explicitly certifies all internal movers as exhausted, every pending step
is completion-gated behind that work, and no live step has a future timeout. Unknown verbs prevent early stopping. A
cue/cancellation/timeout gets a full subsequent runtime tick before certification.
The runner does not cancel or settle the blocked actions: supports and
reservations remain live, the result is unsettled, and execute refuses to commit
it even with `commitOnFailure`. An explicit continuation can observe subsequent
external progress. A fixed-point proof follows mandatory `after` / `when: completed`
gates through pending tails; the tails remain pending, never skipped or cancelled.
Independent future cues/cancels, started-only gates, invalid/unknown dependencies
and dependency cycles prevent early stopping. See the
[dependent-tail proof](briefs/deadlock-tails.REPORT.md).

Episode anchors, recovery requests/results and the stopped runner diagnostic are
plain snapshot state. Older snapshots without those optional fields remain
valid. Waiting snapshot blob hashes change; the ordinary opposing passage keeps
its exact world/event hashes. See [stage 1](briefs/deadlock-detection.REPORT.md)
and [stage 2](briefs/deadlock-recovery.REPORT.md) for proofs and inspected captures.

LM-024 remains **partial**: genuine 0.1 m lateral oscillation in narrow ground
corridors resets pose progress, full gather quiescence is conservative, and
forklift-specific waits are not yet covered. The actual stairs-a closed wait and
supported held carry are proven; the generic forced three-cycle is not LM-043's
physical three-vehicle traffic proof. LM-020 co-planning and LM-025 back-out remain
separate.

### Live stair-link changes (LM076)

Routes copy planned link geometry. Every active link step checks the current scene link before movement, cancellation or replanning. A closed, missing or geometrically changed link returns `route.link-unusable`: before entry the action fails; between levels it remains blocked with actor and traffic ownership retained at the current pose. Deferred cancellation also waits for a usable original path. A future corridor invalidation cannot project the mid-flight body to its old floor; it waits until that route is valid. Recovery finishes by ordinary stair movement after the link/route is restored. These injected invalidation fixtures change navigation, not the physical stair mesh; the engine does not manufacture support after actual structure removal. Swept body collision on climb paths remains LM032.

Deferred stair cancellation also checks the chosen landing's current supported floor and clearance. A missing landing blocks as `route.landing-unavailable` with the climber and claims held; restoring it permits ordinary cancellation movement.
