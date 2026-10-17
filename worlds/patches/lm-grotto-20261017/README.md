# Little Martians (Arium) gap table and grotto patch, October 17

**Source:** the Arium-era lm/map world at sim commit `953613972438` (`worlds/littlemartians/`: `design/world-layout.json`,
`places.v1.json` (113 places), `experiences.json`, `world.json` cast, `scene.json`) and its canon cast homes.
**New engine:** `little-martians-arium` on /worlds, born from `worlds/templates/littlemartians-two.json` (432 things) plus
three later god additions (summit-castle, verdelis-longplant, moat) = 435 things in its public snapshot (seq 39, Oct 17).
Measured on local fake-mind copies (`tools/mars-m2/lm-copy.mjs`; live-like = template + the god additions, names equal
to the snapshot) with a scripted resident (`tools/mars-m2/probe-places.mjs`). "Cheap" = a world patch; "medium" = a
new def/asset or a small viewer/engine change; "big" = an engine/viewer feature.

## Places

| Source | New engine | Gap and what closes it |
|---|---|---|
| 113 places: Commons, 3 sculpture courts, Eden Garden, grotto, overlook, 2 arch passages, 7 auxiliary rooms, 98 exhibit viewing courts | All 113 mapped (template `places`) | None. |
| Residents reach every court by name | From Madmaraca's court `walk:minarete-court` was refused (`place.unwalkable`): 236 paving tiles and 96 exhibits filled the nearest-120 walk offer (`jog-around:` was still offered) | **Closed in code** (`apps/server/src/god/nav.ts`): court-size area places (>= 300 m2) stay offered within 400 m. Resident: Madmaraca -> Minarete court 69 s. |
| Grotto: dry causeway into the vault (`experiences.json`: observe the grotto from its causeway) | `walk:grotto-court` refused `ground.unreachable`: the vault's foundation pad sits at the pools' 0.8 m depth, doorway a 34-degree step | **Closed by this patch** (template too): resident walks in. **Live: blocked by the moat** (see below). |
| Tharsis Overlook: 8 m plateau, declared ramp | 7 m walkable hill | None for residents (reached at 0, 7, 70). Shape differs (design call in lm-two). |
| Arrival at the Ceramic Commons ([0, 18]) | First view frames the whole 270 m map from up to 110 m | **Medium** (viewer): frame an `arrival` flag when a world has one (LM's template has it). Not done. |

## Landmarks

| Source | New engine | Gap |
|---|---|---|
| Madmaraca, Minarete, Celadon beacon (Vanessa's scans) | Same scans (`core/lm-*`) at the same places | None. Madmaraca interior unqualified in both. |
| Minarete and Celadon 2 m ground arches | Admitted; resident walks through both | None. |
| Auxiliary ceramic tower and minaret temple, rooms and shafts | Same, half scale; all rooms reached (`walk:auxiliary-temple` then `/temple-l1`, `/temple-l2`) | Rooms of a building more than 80 m away are offered only after heading for it (same as Mars; by design). |
| Grotto of Painted Worlds: basalt barrel vault, 2 turquoise pools, causeway, hanging pale flowers, red blossoms, a panel | Kit vault with all of these | None in the template. Live: flooded by the moat. |
| Olympus caldera with an 11 m crater, three mountain ranges | 13 peaks, caldera without crater; live: the god put a castle (fey-castle scan, x3) on the summit | Crater: **cheap** carve, but it would undercut the god's summit castle on live; not done. |
| 3 gallery panels | Same 3 panels | Credits for the three images are still an open source question (SOURCE-GAPS.md). |

## Characters and their homes

| Source | New engine | Gap |
|---|---|---|
| 7 cast are Souls with floater bodies (scanned heads) | 7 heads are scenery; Souls bring humanoid bodies | **Big:** floater-body Souls (body minting) not in the new engine. |
| Verdelis: Eden Dome at the base of Olympus Mons; the map's "Verdelis's Eden Garden" | Verdelis's head stands in the Eden Garden; live adds her long-plant by the beacon | None. |
| Kalama (magma chamber), Kweku (lava tubes under Tharsis), Mycos (comet Sporion), Ada (Venus castle), Shuijing (Enceladus ocean) | Not homes in the source map either; new heads stand at Minarete court (Kalama), Madmaraca court (Kweku), Eden Garden (Mycos), the grotto pool (Ada), the beacon court (Shuijing), the overlook (Nyx) | No source gap. Canon homes would be new places (product call). |
| 6 kin heads in the Commons | Same 6 at the same spots | None. |

## Activities

| Source | New engine | Gap |
|---|---|---|
| 4 experiences: observe Madmaraca glazes, observe the Minarete, rest in Verdelis's garden, observe the grotto | `walk:` / `hang-out:` / `stroll:` / `sit-ground` / `read` / `lie` / `nap` at each court | Equivalent once reachable (fixes above). |
| No swimming claimed | `swim:` in the four glazed basins and grotto pools | New engine does more. |
| Floater glide; humanoid walk | Humanoid walk, jog, run | Floater bodies: big (see cast). |

## Live-only finding (FOR GENE)

The god's `moat` on live (a 6 m river, path (-34,76) -> (-82,76) -> (-82,244) -> (82,244) -> (82,76) -> (34,45)) ends inside
the grotto: the grotto floor drops to -1.8 m and the vault fills with 1.5 m of water round Ada's head; residents get
`ground.deep-water`. Shot: comparison page `littlemartians.html`, view "New · Inside the painted grotto".

## The grotto patch

**Bug:** residents could not walk into the Grotto of Painted Worlds (`walk:grotto-court` / `walk:painted-grotto` ->
`ground.unreachable`). The vault's foundation pad settles to the floor of the two grotto pools (0.8 m down) and its
1.5 m edge makes the doorway a 34-degree step. In lm/map (the source) a dry causeway leads in, and the lm-two e2e of
Oct 11 walked in.

**Fix:** one world-local landform (`lm-grotto-approach@1`, a plateau lowered 0.8 m in front of the doorway with a 7 m
soft edge) at world (45, 34.5): the path now eases down at about 9 degrees. Also folded into
`worlds/templates/littlemartians-two.json` for new worlds. Tool: `tools/mars-rotation/add-patch.mjs` (spec `frame: world`),
same review -> preview -> `--apply` / `--recover` / `--rollback [--apply]` as the Mars patches.

**Local proof** (fresh world from the template, `tools/mars-m2/lm-copy.mjs --no-later`): ground at the doorway 0 -> -0.16
-> -0.49 -> -0.8 (slopes 9, 9, 21, 5 degrees); a scripted resident walks Madmaraca court -> grotto court (stands at
45, -0.8, 47) -> Minarete court.

**Live (`little-martians-arium`) — HOLD, see FOR GENE:** the god's later `moat` (a river from (-34,76) round the gallery
fields to (82,76) and on to (34,45)) runs through the grotto: its bed sets the vault floor to -1.8 m and floods the inside
with 1.5 m of water (`ground.deep-water`). This patch does not change that; applying it live only helps once the moat no
longer ends inside the grotto.
