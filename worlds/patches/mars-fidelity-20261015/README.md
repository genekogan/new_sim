# Mars fidelity, October 15

This is a world patch for **my-mars-college-2026-3**, rebuilt locally from the shipped `mars-two` definition. It changes seven visual mesh kinds and the atmosphere selection. It replaces eight mesh entities (buildings, two toilet groups and the elevated bookcase) at the same named paths and poses, retaining every descendant ID and local/world pose (including seats, tables and carryable items). No footprint, room, seat, stair or campus rotation changes. It spends no model/generation budget. Undo restores the original mesh entity IDs too.

## Findings and bounded changes

The sofa clash in the October 11 MARSLAND report predates the October 12 true-compass correction. Both the October 15 public snapshot and the current template put the group in `mimos/main-south` at ground level. In Mimos-local metres the red sofa's box is x[.9415,1.8265], z[1.417,3.697]; the nearest rack starts at x2.1528, giving .3263m clearance. The table has .832m clearance along z; the recliner is clear too. The matched top view corroborates this. Retain these corrected positions; the available drone exterior views do not justify another interior furniture move.

The brown cloth over the south-facing glazing now has a sagged upper edge and diagonal gathered folds, fitted to `team/lanes/marsland-frames/f_040.jpg` and `f_117.jpg`. The folds billow outward by up to 9 cm and taper into the attachment edges, using the existing lit cloth material. Only the named cloth geometry changes; the other Mimos edits correct UVs. The whole building bounds and footprint remain exact. Mimos grows by 3,068 triangles (7,446 total); exact byte counts are in the asset receipt.

Nineteen verified recipe photo surfaces now use V=1−V, matching their upright source image bytes and the original Three TextureLoader presentation. These cover Chiba's gallery/portrait/pixel/upper-wall photos, the kitchen's plywood/tread photos, Mimos's rug/wall, Freeside's LOTA BREAD sign/curtain/entry paint, shower plywood, sanitation labels and book spines. Source pixels, U, mounting geometry, CAD textures and footprints remain unchanged. The three Mimos sign/gallery/Portuguese-poster quads already corrected geometrically in October 12 are explicitly excluded. The asset receipt enumerates every changed node and verifies unchanged decoded geometry/transforms.

The seven variants use the Mars world's existing 200k-triangle/6MB per-definition budget; Freeside is grandfathered at 152,802 triangles/~4.64MB. No geometry grows except Mimos's cloth (+3,068 triangles). Assets under `worlds/core-assets/mars/` remain byte-exact. `worlds/core-assets/mars-fidelity/RECEIPT.json` records measured sizes and hashes.

## Dust

Any world selects this presentation profile with `sky.palette: "mars-desert"` and `weather.kind: "auto"`. Explicit owner weather takes precedence. The patch clears stale storm channels and strike metadata when selecting auto. No server weather schema or behavior is changed.

The shared world clock and seed 4126 select 100-world-hour correlated cycles: 90 hours clear, 8 hours faint, 2 hours heavy, including transition time. Faint peaks vary 2–5%, heavy 30–50%. Faint fades take 20 world minutes each way; heavy 10 minutes each way. This is artistic intensity, not a guaranteed pixel opacity. The patch uses ground-biased spatial noise in the existing fog shader, warm light/sky attenuation, and the existing 700 dust motes. It adds no render pass or mesh; clear dust skips the shader noise fetch. Rooms suppress dust 94%; maps suppress it entirely; reduced motion suppresses moving particles. Rain, wetness, dawn mist, leaves and lush fauna are suppressed in the scheduled desert presentation.

Review overrides are `?dust=clear`, `?dust=faint`, `?dust=heavy` (0/.035/.4). They use the same clock/camera and do not alter the world. `window.__simLiving.atmosphere().dust` reports the rendered state. Natural samples (UTC): 2026-10-13T01:25:43.474 faint, 2026-10-13T17:25:43.474 clear, 2026-10-14T22:25:43.474 heavy. Unit tests cover ten full cycles, ramps, reload/rewind, interiors/maps and other worlds.

## Release-owner apply

L1 ships Godmode first, as the tranche common rules require. Its public API correctly rejects redefining a shared core library definition (`constant.immutable`). The patch therefore creates seven **world-local** cosmetic definitions and swaps only the eight emptied target mesh entities. It temporarily detaches direct children at their current world poses, replaces the parents at the same names/poses, then reattaches the same children to the same room slots. All operations form one atomic admitted batch. Untargeted furniture and carryable items are not recreated. Body descendants refuse the patch; normal active-use guards remain enabled.

The eight forward mesh entity IDs change. Old explicit references to those IDs may need to resolve the named path again. This is a normal authoring edit, not a rewrite of world or resident history. The original library definitions and all old assets remain untouched. The saved receipt and the exact public undo restore the original parents and child bindings.

1. Merge `lane/mars-20261015` after the Godmode integration and deploy through the normal release procedure. Include the viewer, `worlds/core-assets/mars-fidelity.index.json` and its seven GLBs. Keep original assets and footprints available. No CDN credentials or new source-media export is needed.
2. Use Node 22.20.0, the qualified runtime. Use the existing paired god credential **by path**. Do not paste it into a command or report. Set `EDEN_GOD_TOKEN_FILE` in the operator environment to the existing CLI identity JSON path (or token file path). Pick an absolute receipt path outside Git. The receipt contains no credential.
3. From the qualified lane source, dry-run (the following URL is the intended live target; this lane did not write to it):

   ```sh
   ~/.nvm/versions/node/v22.20.0/bin/node <worktrees>/lane-mars/tools/mars-fidelity/patch.mjs --base https://sim.eden.art/worlds/w/my-mars-college-2026-3 --receipt /ABSOLUTE/PRIVATE-OPS/mars-fidelity.receipt.json
   ```

   The script checks source definitions, instances and new asset availability, obtains actual IDs/poses and builds the child-preserving swap. If the source or occupied state changed, investigate the refusal. **Do not POST `apply.json`**: it contains local fixture IDs, versions and a fixed clientRef. Its reference metadata is descriptive, not an API-enforced guard. Use the guarded script for live execution.
4. Apply with the same command plus `--apply`. Save its receipt. The script verifies the selected meshes, named parents and retained descendants.
5. L1 reloads and walks the site: enter Mimos, inspect the sofa group and drape, visit Chiba's gallery, sit on the red sofa, inspect clear/faint/heavy dust outdoors and suppressed dust indoors. Check DPR 1 and 2. Local proof is not live acceptance.

If apply is interrupted or its result is uncertain, reuse the **same receipt** with `--recover`. The script looks up its clientRef and verifies the accepted edit against the current snapshot. Do not choose a new receipt and blindly reapply. A missing or changed request needs operator review.

## Rollback

Keep the viewer release and immutable assets while reverting world state; deleting files is unnecessary. Use the same base, token path and saved receipt, adding `--rollback --apply`:

```sh
~/.nvm/versions/node/v22.20.0/bin/node <worktrees>/lane-mars/tools/mars-fidelity/patch.mjs --base https://sim.eden.art/worlds/w/my-mars-college-2026-3 --receipt /ABSOLUTE/PRIVATE-OPS/mars-fidelity.receipt.json --rollback --apply
```

This uses the exact guarded public undo of the saved patch, restoring original parent IDs, child bindings, sky and weather while retaining history. It refuses a different world, intervening owner edits, or later changes to touched descendants. After such a refusal, review and adapt the inverse through the normal authoring interface. Apply and rollback need a quiet owner window: the public undo endpoint has no atomic revision parameter, so keep other authoring/agent activity paused through the final check and undo. Unused local definitions may remain after undo; they are not instantiated. Verify after reload/restart. Code rollback alone leaves accepted world patches in place, so retain both old and new immutable assets.

## Little Martians route note (W2)

At the laptop move, `/w/littlemartians` should select the existing `little-martians-arium` world. Visitors get 113 named places, 111 library defs and 109 optimized GLBs (~76MB): Madmaraca/Minarete/Celadon scan landmarks, 96 exhibits, gallery panels, glazed basins, garden/grotto/mountains, and the walkable 7 m Tharsis Overlook. New Souls use humanoid bodies; the seven named cast are ceramic scenery heads. The legacy world remains reachable with its own residents and histories; no automatic history migration is implied. Madmaraca interior, wall-video gallery and original grotto content remain upstream gaps. This lane changes no route and does not repeat historical LM qualification; L1 must walk the selected Arium route before promotion.

## Reproduce and evidence

`node <worktrees>/lane-mars/tools/mars-fidelity/build-assets.mjs --check` verifies byte-exact asset reproduction, unchanged non-target geometry/transforms and original texture bytes/bounds. `node --test <worktrees>/lane-mars/tools/mars-fidelity/patch.test.mjs` checks guarded patch construction and retained shape/identity/inverse.

The lane's final evidence, measured results and screenshots are recorded in `<team>/lanes/t3-mars.md`. Scratch proof is under `<team>/scratch/mars/`; no live database was copied. No server-core files or Godmode-owned source files are edited by this branch. Rotation and provisioning remain later deliverables.
