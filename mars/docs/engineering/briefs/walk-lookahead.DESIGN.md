# LM-049 / LM-053: shared movement forecast, bounded investigation

Design only. No movement changes, pins, historical content, broad suites or claim
that either row is fixed. Read against integrated main during the release-10 gate;
worktree documentation commit deliberately remains separate from runtime work.

## Confirmed mismatch

Actual movement in walk.ts advances the offset once, then combines forward and
lateral movement under one min(speed, WALK_SPEED_CAP) * DT displacement budget.
Its placement uses the FACE_LOOK chord normal, segment clearance, eight clearance
bisections and ten budget bisections, with special pull-in/off-corridor handling.
`hazardAhead` starts from that already-advanced speculative offset, then predicts
another 0.9 * elapsed-time offset independently. It uses a tangent normal and six
clearance halvings instead. Fixing only the lateral speed formula misses two
other sources of prediction error.

Analytical straight-leg example: speed=v=1.35 m/s, old offset=0, target=+0.8,
DT=0.05. Desired movement is (0.0675 forward, 0.045 lateral) m; budget scaling
makes approximately (0.0562, 0.0374). At that forward distance, the old predictor
starts at +0.045 and adds about +0.0374, yielding +0.0824: roughly 45 mm more
lateral clearance than the real body achieves. This is a predictor mismatch,
not yet a reproduced physical push failure.

## Bounded baseline experiment

Read-only Node experiment, no repository files changed: empty ground with bounds
[-6,-6,6,6], walker a starts (-3,0), yaw=0, goal=(3,0). Run 40 ticks, then insert
an idle person with task `holding-position` at the walker's current position plus
(ahead,lateral). Speeds {0.3,1.35}; ahead {0.6,0.8,1,1.2}; lateral
{-0.4,-0.2,0,0.2,0.4}; run at most another 140 ticks per case.

All **40 cases found zero pushes**. Measured combined stepping time was 62.1 ms;
this small open-ground search does not establish behavior in bends or narrowing
corridors. It must not be cited as a failing physical regression.

One exact repeat: speed=1.35, after tick40 a=(-1.026,0), b=(-0.026,0).
Ground speeds at ticks41–47: 1.350,1.323,1.238,1.158,1.087,1.024,1.006 m/s.
The action completes with zero pushes and zero invariant violations. The tight
encounter rule deliberately caps forward speed at 0.45 m/s; this observed speed
drop is therefore **not evidence of an LM-049 defect**. Acceptance concerns
unnecessary loss of total ground speed, not impossible preservation of forward
speed while lateral motion consumes the same budget.

Opt-in profile for this repeat, 85 walker steps: walk_to.step 4.432 ms total,
0.052 ms mean, 0.484 ms max; invariants 0.369 ms; spatial.sync 0.125 ms over 170
calls. These are small-fixture measurements, not stress-30 benchmarks. The
PLANNING_BUDGET historical isolated hazardAhead estimate (~0.03 ms/tick) was not
remeasured; there is no current isolated hazard profile.

## Proposed minimal implementation, pending review

1. Extract pure placement and budget transition from the actual mover, preserving
   arithmetic/order and special pull-in behavior first. Prove the extraction
   hash-neutral before changing prediction. No Runtime service or WorldState cache.
2. Start forecast from actual pre-tick position/progress/offset; use the same
   transition for forecast and final proposed movement. Unit regression requires
   first forecast position to equal the proposed physical position in the exact
   numerical case above, plus bend/clearance/pull-in cases.
3. Forecast only when relevant nearby candidates or stale geometry exist. A naive
   DT rollout is at least 30 transitions over 1.5 seconds, each potentially invoking
   clearance and budget bisections, versus roughly 10–21 cheap probes today.
   Establish an explicit maximum work bound and measured cost before adoption.
   The existing minimum 1 m distance horizon versus 1.5 s time horizon at low speed
   needs a deliberate policy; do not silently truncate safety look-ahead or add
   hundreds of extrapolation steps. Keep planner replan admission unchanged.
4. Before claiming LM-049 fixed, freeze a physical curved/narrowing sidestep
   fixture where old prediction misses (push or unnecessary stop), with exact
   coordinates and before/after metrics. Require zero violations, no overspeed,
   honest walk activity, zero pushes for the identified fixture, and safe named
   blocking for truly obstructed/invalid cases. The open-ground case above is a
   control, not the required failing fixture.

LM-053 explicitly permits striking the cache as unnecessary. Prefer that outcome
unless profiling the corrected predictor demonstrates repeatable expensive work.
An exact cache key includes progress, velocity, offsets, route/grid epoch and all
relevant body poses; these generally change each tick. Any cache must be bounded,
external to semantic snapshot state, and have cache-on/off hash-identical and
measured hit/cost proof. Do not add caching based on presumed benefits.

## Ownership, cost and pin window

Primary ownership: engine/locomotion/walk.ts, a small pure movement helper if
justified, focused movement tests and MOVEMENT/PLANNING_BUDGET documentation.
No planner admission changes, shared runtime edits, historical content or pins.
Complexity is medium with broad regression impact: bends, narrowing, acceleration,
held offsets and gather sub-walks. First extraction should be neutral; prediction
changes can move all walker, year-build and take pins. Lead must batch verified
changes into the single wave-2 pin window with zero violations and unchanged
intended outcomes, then record takes once. No independent repinning.

Investigation and documentation estimate: about 25 minutes / 10k tokens; no new
helper spawned and no full suite. Further work awaits a physical failing fixture
and forecast cost proof, rather than a quick pin replacement.
