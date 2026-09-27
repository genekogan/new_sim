# Lift crew plan — crew accompanies lifted parts (spec §7/§8)

Scope: construction lifts sharing `LiftExec` / `beginLift` / `liftStep` (access.ts):
connect_beam, install_joist, install_plywood, install_tread.

1. **Hand points** (new `engine/construction/liftcrew.ts`): per crew member i, a point on the
   part in its current pose — 1 holder: part centre; 2 holders: the two ends (±0.45·length on
   local x) for beams/joists/treads, the long-edge midpoints (±half-width on local z) for
   sheets. Height = part underside (`pose.p[1]`). Ground target = hand point + 0.35 m outward
   (away from the part centre), on the holder's current level.
2. **Gather**: after `approach` arrives, crew step (same stepper) from their stations to the
   pickup targets around the staged part; `beginLift` (support → held) only once every holder
   is within reach — so `held` never starts with a holder 3 m away.
3. **Follow** (`liftStep`): each tick the part advances only if, after the crew step, every
   holder would stay ≤ 0.9 m from its hand point; else the part holds (waits for the crew).
   Crew step ≤ 0.9 m/s·dt (cap 0.6 m/tick), yaw faces the hand point, y = level floor. A step
   is refused (hold) when clearance at the next or target cell < 0.28 m or another person is
   within 0.56 m; > 2 s of continuous hold → `blocked`, diagnostic `lift.crew-blocked` naming
   the nearest blocker / person. Lift ends when the part is seated and crew caught up.
4. **Apex rule**: `LIFT_APEX_MAX = 2.4` m (hand-point height above holder floor). `SweepOpts`
   gains `floor?: number`; sweptLiftPath's lift-over fails `reach.too-high` if
   `yL − floor > LIFT_APEX_MAX`. Plans pass the staging floor (part rests on ground).
5. **Invariant** `lift.hands-out-of-reach` in `construction/invariants.ts` (registered with the
   other construction invariants): held-by-lift component ⇒ each holder ≤ 1.0 m ground
   distance from its hand point and hand point ≤ 2.4 m above the holder's floor.
6. **Tests** (test/progressive.test.ts): joist lift + plywood lift-over sampled per tick
   (1.0 m / 2.4 m); a crate in the crew path ⇒ `lift.crew-blocked`. Flagship tests re-run,
   new simulated seconds reported. Then ≤ 10 lines in PROGRESSIVE.md.

Risk: crew working from a deck while the part is staged on the ground below (hand point
below their floor, target off the deck edge). Check flagship scenes before step 3; if hit,
such holders follow only within their level (clamped, no block) and the invariant uses the
3-D reach rule for them — documented as an approximation.
