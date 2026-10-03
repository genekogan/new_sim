# Lift crew plan — crew accompanies lifted parts (spec §7/§8) — DONE, see PROGRESSIVE.md

Scope: lifts sharing `LiftExec`/`beginLift`/`liftStep` (joist, plywood, tread) + `connect_beam`.

1. **Hand points** (`construction/liftcrew.ts`): grip slot → point on the part in its current
   pose (underside height) + outward direction: `lift-end-0/1` (±0.45·length), `lift-edge-0/1`
   (long-edge midpoints), `lift-corner-EK` (two corners of one short end, for sheets).
   Ground target = hand point + 0.35 m outward on the holder's level (fallback ring 0.35–0.85 m).
2. **Pickup** (`approach` → `pickupPlan`): holders on the part's floor walk to the targets
   beside the part where it lies; slot pair chosen so each can walk a straight line pickup →
   seat (else one follows, one waits at its station). Deck workers keep `lift-station`.
3. **Follow** (`liftStep`): part paced so no hand point outruns 0.9 m/s; holders step ≤ 0.9 m/s
   (cap 0.6 m/tick), clearance ≥ 0.28 m, ≥ 0.56 m from anyone, facing the part; the part waits
   while a holder would end > 0.9 m away; stuck > 2 s → `blocked` / `lift.crew-blocked`.
4. **Apex rule**: `LIFT_APEX_MAX = 2.4` m; `SweepOpts.floor` = lowest station floor (stations
   are now found before the swept path); lift-over above it → `reach.too-high`.
5. **Invariant** `lift.hands-out-of-reach` (`construction/invariants.ts`, registered in
   api/registry.ts, scenarios/build-bay.ts and the construction/progressive test runtimes).
6. **Tests** (test/progressive.test.ts): joist lift, plywood lift-over (per tick ≤ 1.0 m /
   ≤ 2.4 m, crew ≤ 0.9 m/s), crates dropped on the holder's way → `lift.crew-blocked`.
