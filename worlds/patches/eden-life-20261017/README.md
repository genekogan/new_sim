# eden-life-20261017: what old Eden residents used that Eden 2026 lacks

Lane E-life, 2026-10-17. One batch (`batch.json`, `eden-2026-patch/1`): 12 `define` ops and 29 `place` ops. E-look folds it
into `worlds/templates/eden-2026.json` (template edits are E-look's).

- **Outdoor gym** on the south lawn, at old Eden's coordinates: 3 pull-up bars, dip bars, 2 sit-up benches, a bench press,
  a dumbbell rack, a yoga mat. **Courts:** a beach volleyball net and a pétanque piste (proposed spots west of the clubhouse;
  move them to free ground if needed). **Music:** bandstand music stands (2 violins, cello), 2 stage microphones and a drum kit
  at the performance stage, a microphone in the amphitheatre. **Post boxes:** old Eden's 8, same coordinates. **Easels:** 3 on
  the artists' village green.
- The engine needs no names: each thing becomes activity spots through its tags (`pull-up-bar`, `dip-bars`, `weight-bench`,
  `exercise-mat`, `dumbbells`, `yoga-mat`, `volleyball-net`, `petanque`, `microphone`, `violin`, `cello`, `drum-kit`; core
  `postbox`, `easel`) in `apps/server/src/god/activity-spots.ts`.
- Checked: the batch applies to the 725db85c template in memory with no refusal and adds sing 1→4, play-music 3→7, paint 0→3,
  post-letter 0→8, pull-ups 0→3, dips 0→1, situps 0→2, bench-press 0→1, lift-weights 0→1, yoga 0→1, play-volleyball 0→4,
  play-petanque 0→2 spots (`team/scratch/n2-life/patch-check.mjs`). Residents use the defs: test `eden-life` "B5/B3".
- Gym benches and mats draw without colliders (`collide:false`), so a resident lies on them as on old Eden's scenery benches.

## schedules.json (B9)
Old Eden's 28 place schedule entries (`worlds/eden/places.v1.json`): open mic, kitchen preps, fire-circle times, shared meals,
swims, the classroom skill share and study hour, the library reading hour, the dome circle, crafts in the pergola court,
the amphitheatre/bandstand/stage music, afternoon tea, the woods walk and the night on the mats. They become `set` ops
with `schedule.events` on the 16 matching Eden 2026 places (`at` HH:MM, `minutes`). Checked: they apply to 725db85c with no
refusal and read back on the places exactly as old Eden's (`g-place-commons-deck` → open-mic `0 17 * * *` 45 min).
