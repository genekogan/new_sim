# Floaters helper — status

Owner: floaters helper (Opus), worktree `.merge-work/floaters`, branch `merge/floaters`.

## Now (2026-10-03)
- DONE, committed f0c0116 (branch merge/floaters).
- Full Mars engine suite NOT completed here (worktree lacks restored alpha takes/baselines; failures seen were ENOENT on public/engine/takes/*.json). Lead ran the full suite in canonical Sim.

## Delivered
- `worlds/littlemartians/characters/`: 7 floaters + 6 kin GLBs (14.3 MB), `manifest.json` (source,
  process, licence, bytes, sha256, facing, lore, geometry). Rebuild is byte-deterministic.
- `mars/viewer/engine/world/types.ts`: optional `Entity.body` (+ `Body` type). Nothing else shared touched.
- `mars/viewer/engine/bodies/`: body helpers, model table, `floaterPose` (tick-pure bob/tilt/yaw),
  `FLOATER_POLICY` + `admitFloaters` (all 89 registry verbs + 2 sequence built-ins), `FloatPlanner`
  (ground planner on a link-filtered scene; stairs refused by name; openings glided), `floaterBodiesOfTake`.
- `mars/viewer/app/engine-view/floaters.ts`: `FloaterView` add/update/remove/sync, `KinScenery`.
- `mars/viewer/engine/test/floaters.test.ts`: 10 tests, pass.
- `tools/floaters/`: build-assets, policy-table, preview (+ shots/), POLICY.md, README.md (integration notes).

## Notes for lead
See README.md "Integration notes" and "Decisions made here" (measured facings instead of flock ORIENT;
Kalama cloth crop; Verdelis rebuilt). Draco + WebP decoders needed at runtime. TakePeople must skip
floater ids. walk_to is unchanged (human radius, uses stairs): wire floaters through FloatPlanner.
