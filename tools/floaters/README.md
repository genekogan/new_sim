# Floaters — the Little Martians body family

Static scanned heads that float: no rig, no skins, no morph targets. Bob, tilt and yaw are computed in
code from the **sampled tick** (never wall time), so a replay draws the same head at the same tick.

## What is here

| Path | What |
|---|---|
| `worlds/littlemartians/characters/*.glb` | the seven floaters: Verdelis, Kalama, Kweku, Mycos, Ada, Shuijing (the six scanned Little Martians) + Nyx |
| `worlds/littlemartians/characters/kin/*.glb` | six background ceramic-head kin (scenery, not Souls) |
| `worlds/littlemartians/characters/manifest.json` | per model: source, process, licence, bytes, sha256, facing, lore, geometry facts |
| `mars/viewer/engine/bodies/` | `Entity.body` helpers, model table, drawn pose, per-verb policy + admission, float planner, take helper |
| `mars/viewer/engine/world/types.ts` | one optional field: `Entity.body?: { family: 'humanoid' \| 'floater'; model?; radius?; hoverHeight? }` |
| `mars/viewer/app/engine-view/floaters.ts` | `FloaterView` (add / update / remove / sync) and `KinScenery` for three.js |
| `mars/viewer/engine/test/floaters.test.ts` | 10 tests (see below) |
| `tools/floaters/POLICY.md` | the verdict for every Mars verb (generated) |
| `tools/floaters/shots/` | renders used to check facing, scale, hover and bob |

Tools (isolated npm package; `npm install` here, nothing in the workspace):
`node build-assets.mjs [--force]` rebuilds the models from `<lm-3d-models>` (read-only);
`node policy-table.mjs` regenerates POLICY.md; `node preview.mjs [mode[:tick[:model]] …]` bundles a preview
and screenshots it with the system Chrome (`lineup`, `side`, `kin`, `axes:0:<model>`).

## Integration notes for the lead

1. **Seeding.** A Little Martian is an ordinary person entity (`kind: 'human'`, `human` state) with
   `body: { family: 'floater', model: 'verdelis' }` (`withBody(human(...), body)`). Absent `body` =
   humanoid; every existing world, take and hash is unchanged (test pins the pre-fork engine's hashes).
2. **Admission.** Before submitting a card's verb: `admitFloaters(verb, params, id => world.entities[id]?.body)`.
   `refuses` carries `blockedBy` (id, role, reason); `approximates` names the approximation. Composite
   verbs are role-aware (a floater may listen to a reading circle but not read); `living_intention`
   returns which alternatives per objective a floater may be bound to.
3. **Movement.** `walk_to` itself is untouched and still plans with `HUMAN_PROFILE` (radius 0.28) and
   uses stairs. For floaters use `new FloatPlanner(scene, { openings, contributors })` →
   `plan(world, body, start, goal)`: the same ground planner on a link-filtered copy of the scene with the
   floater's radius. Stairs/ladders/climbs/beams are refused by name (`floater.stairs-unsupported`, …,
   with the link ids); level changes only through link ids declared in `openings` (or `ramp` links),
   glided continuously. `sampleFloat(track, s)` gives ground point (for `pose.p`), hover point and yaw.
   Final locomotion wiring (a float verb or a walk_to profile hook) is yours.
4. **Rendering.** `const v = new FloaterView(scene, { baseUrl: '/worlds/littlemartians/characters/', dracoDecoderPath })`;
   `v.sync(floaterBodiesOfTake(take))`; each redraw `v.update(frame.entities, take.startTick + frame.tick, take.dt)`.
   Pass the **absolute** tick so the bob is continuous across streamed take chunks. TakePeople must skip
   floater ids (it would draw a humanoid rig). The GLBs use `KHR_draco_mesh_compression` +
   `EXT_texture_webp`: serve three's `examples/jsm/libs/draco/gltf/` decoder and pass its URL, or pass
   your own configured `loader`. The app's existing `loadGltf` only sets a Meshopt decoder.
   Hierarchy: holder (pose, `rotation.y = -yaw`) → tilt → turn (+π/2) → facing offset → model scaled to
   2 × radius. `v.object(id)` is the holder for selection rays / follow cameras.
5. **Kin.** `new KinScenery(scene, opts).place([{ model: 'chebel', p: [x, y, z] }, …])`, then `update(tick)`.

## Decisions made here (review)

- **Facing offsets are measured, not flock.html's ORIENT.** Six-axis renders (`shots/axes-*.png`) show
  every scan upright with its face exactly along +Z (Verdelis, Mycos, Nyx) or −Z (Kalama, Kweku, Ada,
  Shuijing). ORIENT (Verdelis 0.5, Nyx 0.6, the rest 0) was tuned for a starfield flock and would leave
  four heads facing backwards; the manifest records both.
- **Kalama is cropped.** The archive scan includes the cloth/table it sat on; the web file is cropped to
  the head (box recorded in the manifest). Some tiny base specks remain.
- **Verdelis is rebuilt from the canonical scan**, not the web file: morph targets (104) and animations
  (2) stripped, then the archive's `optimize.mjs` pipeline re-implemented with output here (the original
  script always writes into the archive). Its basis shape is used, not the default morph weights.
- Defaults: radius 0.35 m, hover 1.45 m (head centre; face to face with a standing person).

## Limitations

- The scans are hollow shells open underneath; a camera below hover height sees inside.
- No talking faces, no expressions; the only motion is the whole-head bob/tilt/yaw.
- `sit`/`take_slot` approximations hover over the slot; the renderer lowers the hover a little for
  `activity: 'sit'` and settles to the mat for `sleepPose`. No seated posture exists.
- Openings must be declared by the building author (link ids); a building with only stairs is
  unreachable upstairs for floaters, by design.
- The licence of the scans is not recorded in the archive (manifest `license: null`); they are Vanessa
  Rosa's work, included on Gene's authorization for this private project.
