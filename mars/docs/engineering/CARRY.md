# Coordinated carrying (`carry`) — engine notes

Spec: SPEC.md §11, §13, §28 (long load around corner, reservation conflict,
graceful cancellation). Code `viewer/engine/carry/`; tests `engine/test/carry.test.ts`.

## Modules
| File | Role |
| --- | --- |
| `formation.ts` | Formation model from catalog `handling`: crew checks, carried/laid poses, carrier slots, disc cover, entity ↔ SE(2) frame |
| `sweep.ts` | Swept collision checks against the level clearance field (EDT), motion primitives' geometry, goal distance field, deterministic heap |
| `planner.ts` | Hybrid-A* over (x, z, θ), shortcut smoothing, failure diagnostics naming the blocker |
| `validate.ts` | Plan-time validation (`plan()`): crew, item state, pickup, target, route, approach walks |
| `actions.ts` | The `carry` ActionDef: gather → lift → move → set-down → release; cancellation |
| `invariants.ts` | `carryIntegrity` end-of-tick invariant (`CARRY_INVARIANTS`) |
| `scenes.ts` | Carry proving scene: yard + 2.5 m L corridor (A), yard + 1.5 m L corridor + far yard (B) |

## Formation model
- Frame: SE(2) pose `(x, z, θ)`; origin = load centre on the ground, +along = the
  load's long axis = direction of travel. Uprights lie on their height axis;
  everything else on local x.
- Carried orientation comes from `handling.carryPose` (`flat` = smaller cross
  dimension vertical, `edge` = larger vertical). Laid orientation (`place: 'lay'`)
  is always `flat`. Poses are solved generically so the box centre sits at
  `(x, z)` at `carryHeight` (carried) or with its bottom on the floor (laid).
- Carriers: `handling.grips[n]` in slot order. Each carrier stands beside the
  grip's along-position, on the load edge's side, `REACH = 0.35 m` outward from
  the edge, facing θ. Grips with a lateral offset (> 5 cm, e.g. the 4-person
  upright) pick their side; centreline grips alternate sides by slot.
- Footprint set: the load rectangle covered by discs (rows ≤ 0.6 m wide, along
  spacing 0.2–0.5 m, radius = half-diagonal of each cell) + one 0.28 m disc per
  carrier. Covers are conservative (they contain the rectangle).
- Crew rules: `handling.carryCrew` range and `MAX_KG_PER_CARRIER = 30` kg, e.g.
  `carry.crew-too-small`: "the 19 ft upright (61 kg, 5.8 m) needs at least 3
  carriers at ≤ 30 kg per person; 2 assigned". Also `carry.crew-too-large` and
  `carry.no-grips`.

## Collision checks
- A pose is clear iff every disc centre has `clearance ≥ r + margin` on the
  level grid (the grid's obstacles are the 0.22–1.8 m body band, conservatively
  rasterised, so loads at 0.75–0.9 m hand height are covered).
- Motions are sampled so that no point of the formation moves more than
  `SAMPLE = 0.08 m` between samples (bound = centre displacement + extent·|Δθ|,
  so rotations of long loads get more samples). The planning margin
  `PLAN_MARGIN = SAMPLE/2 + 0.02` covers the motion between samples plus EDT
  cell error. The invariant uses a −0.03 m tolerance, so any executed
  (interpolated) pose sits strictly inside what the planner verified.
- Set-down / cancel spots are checked **exactly**: the laid footprint (SAT)
  against every scene obstacle and component it would occupy at any height
  (including low things the walk grid ignores, e.g. a stack of 2x4s), footprint
  corners on floor, and standing room for every carrier.

## Planner (hybrid-A*)
- State: continuous (x, z), θ on a 32-heading lattice anchored at the pickup
  heading; closed set binned at 0.25 m × 32 headings. Starts: the lying load's
  axis θ₀ and θ₀+π (crew may lift facing either way). Goals: requested yaw and
  yaw+π (yaw is the long-axis direction).
- Primitives and costs (per primitive):

| Primitive | Geometry | Cost |
| --- | --- | --- |
| forward | 0.5 m straight | 0.5 |
| arc left/right | Δθ = 11.25°, radius R = max(1.5, 0.6·L) m | 1.2·R·Δθ + 0.05 |
| rotate left/right | in place about the load centre, Δθ | 0.3 + 1.5·(L/2)·Δθ |
| reverse | 0.5 m straight back | 1.7 |

- Heuristic: 8-connected Dijkstra distance from the goal over cells whose
  clearance admits the load centre, bounded to 15 m beyond the start's
  distance (limits wandering; also bounds the exhaustive search when no route
  exists). Weighted A* (ε = 1.3), 150 k expansion budget.
- Goal: within 1 m of the goal, a direct "settle" motion to the exact pose
  (≤ 1.5 heading bins of residual rotation, bounded crabbing) must pass the
  same swept check.
- Smoothing: greedy shortcutting replaces primitive runs by one straight
  motion with uniform rotation, only if curvature ≤ 1/R, crab angle ≤ 20°, and
  the swept check passes. Output: dense poses (≤ 8 cm point motion apart) with
  a progress coordinate u = Σ(|Δcentre| + (L/2)|Δθ|).
- Failure diagnostic: from the node that got closest to the goal, face along
  the distance field's descent ("the way on") and advance; the first failing
  disc names the part (load / carrier) and `nearestBlocker` names the obstacle:
  > the 19 ft upright (5.8 m; formation 2.2 m wide with 4 carriers) cannot turn
  > toward the way on at (16.0, 4.0) (route heading 45°): carrier q2 would
  > intersect 'corridor A south wall' — the formation gets no closer than 7.3 m
  > to the target (18.0, 11.0) (5636 poses searched)
- If the planner fails but every crew member could walk to the target alone
  (`findRoute` per person), the code is `carry.clearance` (message prefixed
  "every crew member could walk to … alone, but the carrying formation
  cannot: …"); otherwise `carry.no-route`.

## Action contract (`carry`)
- Params: `{ crew: string[] (distinct), item, to: { x, z, yaw, level? }, place?: 'lay' }`.
- Reservations: `actor:<id>` exclusive per crew member, `entity:<item>` exclusive.
- Validation (all before anything moves): known humans on one level; item is a
  component lying on the ground (`stored|staged`, support `ground`); crew rules;
  same-level target (`carry.level-change` otherwise); pickup (carriers can stand
  beside the lying item and the lifted formation is clear: `carry.pickup-blocked`);
  target (`carry.target-blocked` for exact laid-footprint problems); the
  whole-formation route; approach walks on a grid where the lying item is an
  obstacle (`carry.gather-unreachable`).
- Phases: **gather** (each carrier runs `walk_to` machinery to its grip spot,
  then turns to face along the load; 120 s timeout → `carry.gather-stuck`),
  **lift** (1.2 s; item → `carried`, support `held` by exactly the crew, grips
  set; load and carriers interpolate lying → carried), **move** (u advanced at
  ≤ 0.9 m/s, accel 0.5 m/s², decel to the end; because u counts load-tip
  motion under rotation, the crew slows automatically in turns; carriers are
  re-derived from the load pose every tick), **set-down** (1.2 s; item →
  `staged`, support `ground`), **release** (0.4 s).
- Construction mid-carry: on a spatial epoch change the rest of the trajectory
  is re-checked; if blocked the action reports `blocked` / `carry.route-blocked`
  and the crew holds the load (no replan yet).
- Cancellation: gather → immediate. Lift → deferred: the load is lowered back
  onto its original pose. Move → if the laid footprint at the current pose is
  clear, deferred controlled set-down there (record ends `cancelled`), else
  refused with `carry.cancel-unsafe` and the carry continues. Set-down/release →
  deferred (already stopping). Never drops or teleports a load.

## Invariant `carryIntegrity`
For every component in phase `carried`: support must be `held` by humans who
are exactly the set gripping it (`carry.support`); while the crew's activity is
`carry` (not lifting/setting down), every carrier is within 0.05 m of its
slot-derived spot (`carry.grip-drift`) and the load's disc cover clears static geometry (`carry.load-static`).

## Shared-file edits (additive)
- `actions/types.ts`: `CancelResult` gains `deferred?: boolean`.
- `runtime/runtime.ts`: a deferred cancel marks the live action `cancelling`
  (emits phase `cancelling`); its later `completed` is recorded as `cancelled`.

## Measured (M-series laptop, Node 22)
| Case | Result |
| --- | --- |
| 12 ft beam, 2 people, 2.5 m L corridor (19.5 m, 90° turn) | planner 10 ms, 53 expansions; submit incl. approach walks 45–46 ms; 32.6 s simulated (gather 3.4, lift 1.2, move 26.5, set-down 1.2, release 0.4); 0 violations; exact SAT audit finds no wall overlap; reach error ≤ 0.05 m |
| 19 ft upright, 4 people, 1.5 m corridor | rejected `carry.clearance` in ~60 ms (5.3 k poses); the 4 people walk the corridor individually |
| 19 ft upright, 4 people, 2.5 m corridor | straight run accepted; around the corner rejected `carry.clearance` in ~65 ms |
| 12 ft beam, 2 people, 1.5 m corridor | fits straight, cannot turn the corner (~110 ms) |
| Determinism | identical final state hash across runs |

<sub>Submit timing re-measured 2026-09-27 (two runs) with `cd viewer && node --test --test-name-pattern="12 ft beam around the L corner" engine/test/carry.test.ts` (prints `plan+validate`); other rows not re-measured.</sub>

## Known limitations
- Loads stay level: no tilting/pitching a load to clear an obstacle or to
  swing it over a rail; no carrying on stairs, ladders or between levels.
- The formation is rigid: carriers never shift along the load, change sides,
  or re-grip mid-route; a 2-person crew cannot "pivot around the rear man".
- Other people are not part of the plan: bystanders are not avoided or yielded
  to by a moving formation (the human–human invariant would flag contact).
- Height is only the 0.22–1.8 m body band: overhead obstacles below 1.8 m
  block, low obstacles (< 0.22 m) are ignored while moving (they only matter
  for set-down, checked exactly).
- Route blocked mid-carry → hold and wait; no replanning yet.
- Lift/set-down interpolate Euler angles (visual only; e.g. plywood tilting
  from flat to edge); no ground-contact modelling during the tilt.
- `walk_to` issues seen (not changed here): `face` oscillates with turn-in-place
  (gather turns carriers itself); two walkers arriving close can deadlock.
