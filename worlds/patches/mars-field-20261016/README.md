# Mars M2 gap table and field patch, October 16

**Reference:** sim.mars.college. Its source is `<mars-campus-repo>`, the same lineage as `mars/` in this repo.
**Sim's Mars:** world `my-mars-college-2026-3`, built from `worlds/templates/mars-two.json`. That is 167 entities in 8 batches. The live public snapshot on 2026-10-16 had the same 167 entities and no later builds.

"Cheap" means a world patch made of `define` and `place` operations. "Medium" means a new def/asset or a small viewer control. "Big" means an engine or viewer feature.

## Gap table

### Places

| Reference | Sim's Mars | Gap and what closes it |
|---|---|---|
| Eight campus years, `/studio/2020`–`/studio/2027`, with a Year selector on `/`. Examples: 2020 tire ring; 2022 four-house pinwheel; 2023 Chiba seven-bay, Rotapolis, Hexapod; 2024/25 solarium, Bodywork dojo, Freeside pods. | 2026 only. | **Big.** Each year needs building defs, none of which exist yet, plus a year switch in the viewer, or one world per year. |
| 2026 campus: Mimos, Chiba kitchen and diner, Chiba auditorium, showers, dojo, Tool camp, Freeside, west racks, tool-library stair. | Yes. All 9 buildings and their rooms, near item-for-item (see `team/lanes/marsland-parity.md`). | None. |
| "Go inside" rooms: Mimos, kitchen, dining room, Chiba auditorium, gallery, field. | Partial. Souls walk into every room by name (`walk:mimos/floor` …), but visitors have no room picker. | **Medium** (viewer): a room jump list built from the places layer. |

### Buildings and furniture

| Reference | Sim's Mars | Gap and what closes it |
|---|---|---|
| 2026 furniture and carryable kitchen items. | Yes: 16 Mimos, 17 kitchen, 18 Chiba/field, 32 Freeside/CoLab/Tool camp/OG, 15 carryables. | None. |
| Chiba field fire bowl and gray beanbag (`details-2026-ground-life.ts`). | Drawn (baked into the Chiba mesh) but inert: no fire, no seat. | **Closed by this patch:** the bowl burns (light / put out, light and fire sound) and the beanbag is a seat. |
| Gallery screens with the logo; neon flower installation. | Missing (`marsland-parity.md` residuals). The Mimos giraffe toy is present. | **Medium:** new defs or assets from the reference meshes. |
| Freeside hydroponic cart. | Yes (`freeside-hydro-cart-chrome`). | No water to carry: see `../mars-water-20261016` (W5 tank, two beds and a can beside it). |
| Lighting and materials: warmer light, faceted spool tables, white mattress reads tan. | Known residuals. | **Medium** (viewer/assets). See `marsland-parity.md`. |

### Activities

The reference `/lab` has 65 scenarios. Sim's Souls use generic verbs (sit, lie, walk/stroll/wander, talk, carry / put-on / give, eat, drink, read, dance, yoga, wave) plus the actions of god things.

| Reference | Sim's Mars | Gap and what closes it |
|---|---|---|
| Campfire evening (`campfire_circle`, `set_fire`). | Not possible before: the bowl was scenery. | **Closed by this patch.** A Soul lights the bowl; others sit on the beanbag and field chairs round it. |
| `garden-care`, `garden-circuit`, `seed-planting`. | No garden and no watering. | **Watering closed by W5** (`mars-water-20261016`): fill a can at the tank, water a bed. Sowing and growth: **big** (new verbs, growth state over time). |
| Meals (prep, communal supper, cleanup); classroom-4/8; reading circle; chess; music/jam; gallery tour. | Partial: sit, talk, carry a bowl to a table and lunch in the diner (mars-lived e2e); reading and dancing are generic. | **Medium:** cooking/serving steps, a classroom display. Chess: a `core-chess-table` could be placed, but the reference's chess is a hypothetical lab set, so it is not added here. |
| Build-bay and year-build (crews carrying beams), solar install and paint, drawing with marks. | No. | **Big:** multi-person carry, construction phases, persistent marks. |
| Navigation tests (wall, u-trap, stairs, decks) and year walkabouts. | The engine has these (walk lane). There is no visitor preset. | Not a world gap. |

### What visitors can do

| Reference | Sim's Mars | Gap and what closes it |
|---|---|---|
| Year switch. | No. | **Big** (see Places). |
| Time-of-day slider and day–night; `set_weather`. | The world clock and weather exist, but only the creator sets them. | **Medium:** a visitor-side preview control (view only, not a world edit). |
| Director panel, chapter takes, "watch it being built", follow camera. | Partial: Sim's own camera and Souls. | **Big.** |
| EUC rider mode; `/photo` drone frames vs model. | No. | **Big** / out of scope for a lived world. |
| MCP rooms: `move_person`, `start_activity`, `set_fire`, `set_screens`. | Souls act through the agent CLI, which is a richer interface. | `set_fire` is now `object:<bowl>:light`. Screens: **medium.** |
| Chat. | The reference has none; Sim's Souls talk. | Sim is ahead. |

Signage that would invent names absent from the reference was not added. Neither were chess, solar rows or tents, which the reference shows only in hypothetical or other-year scenes.

## This patch: `mars-field-20261016`

It contains two world-local defs (`defs.json`, generated by `tools/mars-rotation/field-defs.mjs`) and two Chiba children:

- **`chiba/field-fire-bowl`** (`mars-fire-bowl-fire@1`). An ash bed, logs and flames sit inside the baked bowl, which is at world (-1.7, -49.1) at bearing 90. It starts unlit.
- **`chiba/field-beanbag`** (`mars-beanbag-seat@1`). One seat sits inside the baked beanbag at world (0.2, -49.6) and faces the bowl.

Both are placed in Chiba's frame, so they turn with the campus. Apply before or after `mars-rotation-20261016`.

## Apply and rollback (release owner)

Use Node 22.20.0. The god credential is read **by path only**. Keep the receipt outside Git. These are pure reads until `--apply`.

```sh
N=~/.nvm/versions/node/v22.20.0/bin/node; T=<worktrees>/lane-mars/tools/mars-rotation/add-patch.mjs
S=<worktrees>/lane-mars/worlds/patches/mars-field-20261016/spec.json; B=https://sim.eden.art/worlds/w/my-mars-college-2026-3
$N $T --spec $S --base $B --receipt /ABS/PRIVATE/mars-field.receipt.json                                  # review (no token)
EDEN_GOD_TOKEN_FILE=<path> $N $T --spec $S --base $B --receipt /ABS/PRIVATE/mars-field.receipt.json          # preview
EDEN_GOD_TOKEN_FILE=<path> $N $T --spec $S --base $B --receipt /ABS/PRIVATE/mars-field.receipt.json --apply  # one atomic batch
```

- **Uncertain apply:** run again with the same receipt and `--recover`.
- **Rollback:** use the same receipt with `--rollback` to review, then `--rollback --apply`. It is one guarded batch that removes exactly the things the patch placed, by id (`expect` versions).
  - It refuses if a patch thing is held or has moved elsewhere.
  - Residents' use (a lit fire) does not block it, and it works however much history came after (a group undo only reaches the last 500 edits).
  - The world-local defs stay defined, unused.
- **Refusals:**
  - Apply refuses a different world (no Mimos / Chiba / field chairs).
  - Apply refuses names that already exist.
  - The world's own preview refuses any overlap or bad def.

**Local proof:** a fake-mind world on :5868 from the template. It is not live.
- Apply was accepted (seq 24).
- A scripted resident walked to `chiba/field-fire-bowl`, lit it (`lit: true`) and sat in the beanbag.
- Rollback: see `team/scratch/mars/water/proof.log`.

Screenshots: `team/lanes/t3-mars-shots/w5-field-fire-dpr{1,2}.png`.

**Not live-proven:** after applying, L1 must walk the site, light the fire and sit.
