# Little Martians world

Characters, ceramic scans, buildings and lore are by Vanessa Rosa (Little Martians), used with permission and not
covered by the repository licence (see [ASSETS.md](../../ASSETS.md)). The GLBs are media: fetch them with
`node tools/assets/pull.mjs`.

Seven owner-bound Souls use the scanned ceramic heads in `characters/`; six kin
are scenery. The two clean procedural buildings and their footprint provenance
live in `buildings/`. Their generators use the source scans only as read-only
references/textures; no source archive is copied here.

Run `python3 worlds/littlemartians/build-scene.py` from the repository to reproduce
`scene.json` from the committed footprints. It assembles the garden, seven rooms,
two humanoid ground entries and five floater-only shafts. Geometry and navigation
share coordinates; movement, clearance and admission remain engine operations.
`world.json` holds place customs and character descriptions, not action order.
The server requires the verified owner before seeding; one day is 72,000 ticks.

Activity admission: `tools/floaters/POLICY.md`. Continuous movement/restart tests:
`packages/engine-mars/src/worlds.test.ts`. Long fake qualification:
`SOAK_DIR=<isolated-directory> BRAIN_MODE=fake node --expose-gc infra/soak-worlds.ts`.
This starts no HTTP listener and rejects physical recovery as a failed soak.
Lab `/l/littlemartians` is a separate paused browser-only snapshot.
