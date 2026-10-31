# Year scenes and component ids

The engine loads one procedural scene per campus year (2020–2025) plus the CAD-derived 2026 scene. Each year is engine
data: `mars/viewer/public/engine/campus-<year>.json`, generated from the studio's kit scenes
(`app/history/scenes.ts`, `app/studio-2020/scene.ts`) by `node deploy/history-scenes.mjs` and published as the protected
canonical checkpoint `mars-<year>` by every loader (`publishCampusYear`, also the simulation rooms). Extraction is described
in [campus-scene.md](campus-scene.md).

## Component id scheme

Layouts, plans and replays address components by `component_id`. Procedural pieces get
`${assembly}-${kind}-${hash}`, for example `chiba-rack-upright-fd5a230a`:

- `assembly`: the `assembly_id` of the owning `Kit.assembly` group;
- `kind`: slug of the definition name (`'12 foot orange beam'` → `12-foot-orange-beam`);
- `hash`: FNV-1a (8 hex) of `kind | placement`, where placement is the transform relative to the assembly group, position
  quantized to 0.05 m and rotation-matrix entries to 0.0175 (about 1°), rounded off-centre so authored decimals never sit
  on a boundary;
- two pieces with the same kind and quantized placement in one assembly get `-2`, `-3`, … in build order (the only
  order-dependent case).

Ids are assigned by `Kit.finalize()` after the scene is built; 2020 goes through the same `assignStableIds`. Adding,
removing or reordering other pieces never changes an id; moving a piece ~2.5 cm, rotating it ~1° or changing its kind or
assembly does.

**Pinned names.** `k.named(piece, 'entry-sign')` gives `component_id === '<assembly>-entry-sign'`, stable however the piece
moves. Names are slugged, unique per scene (duplicates throw) and assigned before hashed ids. Plans should reference pinned
names, or hashed ids captured from the exact revision they were validated against.

## Legacy layouts

`app/history/id-migration.json` maps every legacy build-order serial id to its stable id
(`years[year][assembly] = { start, ids }`, `null` for a removed piece). `validateLayout(data, baseline, stock, year, migration)`
(`lib/layout.ts`) rewrites legacy ids before validating; a legacy id with no live target logs a warning and that edit is
dropped. **Never regenerate the table**: the old build order no longer exists. When a scene edit changes a targeted id,
point the entry at its successor (an alias) or set it to `null`. `deploy/history-ids.test.mjs` checks determinism,
uniqueness, pins and live table targets.

## Editing a protected year (re-seed)

A protected `mars-<year>` is re-published from its file by every loader, so a scene edit is a re-seed:

1. Edit the kit scene, keeping untouched pieces' kind and placement (including parent transforms) so their ids survive;
   pin names for anything a plan addresses.
2. `node deploy/history-scenes.mjs <year>`, then `--check` (all years deterministic).
3. Run `deploy/history-ids.test.mjs`; alias or null each vanished legacy target, editing only that assembly's line; update
   the live/null counts the test asserts. Run `deploy/history-geometry.test.mjs`.
4. In `engine/test/campus-history.test.ts`, freeze the pre-edit `contentHash` and prove that publishing the pre-edit
   canonical, forking it and committing the regenerated world as a `reconstruction-edit` checkpoint gives the same
   `physicalHash` as `publishCampusYear` on the new file.
5. A site-bearing change goes in `YEAR_NORTH_AZIMUTH_OFFSET` (`engine/env/sun.ts`); the year file then carries
   `northAzimuthOffset`.
6. Re-run affected generated builds and takes, re-pin under the rules in [planning-budget.md](planning-budget.md#pinned-hashes)
   (`node deploy/record-campus-take.mjs --scenario <name>` then `--check`), re-baseline the year's studio and Lab captures
   after looking at them, and run the full gate.

Generated builds use `yearBuildSetup(year, assembly, file, opts)` and `yearBuildHouseSetup(year, house, file, opts)`
(`engine/scenarios/year-build.ts`); whole-house runs are opt-in with `YEAR_BUILD_FULL=1`.
