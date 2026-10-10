# Blind run 2 — god notes (world blind2-1, http://127.0.0.1:5156/w/blind2)

Setup: `register` + `pair` worked first time (owner approved within seconds). World 1000 m (±500), empty.
Final state: 61 entities, journal seq 42, exported to `work/world.genesis.json` (35 KB).
Looks: 9 total. All but one took ~3–6 s with `--keep`; one took 602 s and came back "not fully settled"
(drawn 2/6) — it was the first look after placing two new mountain peaks.

## Prompt 1 — mountains east, lake west, river lake→south edge, bridge
- `place mountain --path [[390,-360],[420,-100],[400,150],[380,380]] --width 160 --param height=180` (group `terrain`).
  Looked at it: a sheer wall. `where` showed 50–70° slopes. `set --param height=140 peak=1.3 edge=60` was still
  ~55°. Removed it and re-placed wider/lower: path x≈370–400, `--width 300 height=150 peak=1.5 edge=40` (≈35–44°,
  rounded ridge). Added two alpine point peaks `north-peak` (410,-220, h110 r130 peak3) and `south-peak` (400,180, h90 r120 peak3).
- `place lake --circle -290,-60,75 --name west-lake`.
- `place river --path [[-260,-5],[-215,120],[-170,280],[-150,500]] --width 12 --name river` — snapped into the lake, runs to the south edge.
- `place bridge --across river --t 0.4 --span 4 --param width=5 --param material=stone --name bridge` (~(-195,192)).
- Refusals: none.

## Prompt 2 — village of six houses around a plaza (fountain, lamps, benches)
- `place plaza --rect -60,60,32,32 --param pattern=radial --name square`; `place fountain --at square`.
- `place cottage --near square --count 6 --dist 5 --facing square --name house` → house-1..6 ringed round the square, each facing it.
  Varied them with `set` (wall colours, hip roofs, a stone one, a porch).
- `place bench --near fountain --count 4 --facing fountain --dist 3`; four `lamp-post`s at the plaza corners.
- `place footpath --from house-N --to square` for each house (starts at the front door automatically).
- Refusals: none. (My own shell loop broke on zsh word-splitting — "REFUSED by the CLI: --at needs a value" — not the CLI's fault.)

## Prompt 3 — two-floor house with a furnished bedroom upstairs
- `place townhouse --at -14,60 --param floors=2 --param balcony=true --facing w --name townhouse` (east of the plaza, door toward it).
  `describe` gave rooms per floor: hall/parlour/kitchen, landing/bedroom/bath.
- Bedroom (floor 1): bed `--wall back`, wardrobe `--corner back-left`, dresser `--wall left`, armchair `--corner front-right`
  (CLI kept the balcony doorway clear), rug, floor-lamp `--corner back-right`.
- Looked with `--inside`: the wardrobe had come out turned diagonally (facing nw) in its corner; fixed with
  `move townhouse/wardrobe --facing n` then `--by 0,0.3` to sit flush to the wall.
- Refusals: none.

## Prompt 4 — road from the plaza to the bridge, lined with trees
- Dry-run of `place road --from square --to bridge --via -110,120` started at the plaza's SW corner, right on top of lamp-sw,
  so I gave an explicit path instead: `--path [[-66,76],[-90,100],[-115,128],[-150,162],[-185.03,189.62]] --width 6 --name main-road`
  (ends at the bridge's east end; flat, no grading needed).
- `place tree --along main-road --row 12 --spacing 12 --side both --offset 3 --name roadside-tree` → 24 trees.
- Refusals: none.

## Prompt 5 — look from the south, fix, export
- `resolve`: all 40 constraints hold. Look from the south showed: roadside-tree-13 jammed against house-6's corner (3.6 m)
  and the townhouse standing alone with no path. Fixes (group `fixes`): removed roadside-tree-13, added
  `footpath --from townhouse --to square` and a flower-bed by the townhouse. Re-looked: fine.
- `export world.genesis.json` (61 things).

## What confused me / was missing
1. **Mountain range shape params are opaque.** `defs mountain` lists height/radius/peak but the range's real cross-section
   is governed by `--width` and an undocumented-in-`defs` `edge` param (it appears in `describe` params and in `schema --md`
   as "edge 0.5…200 = 8" with no explanation). It is unclear what `radius` does for a path range. The SKILL example
   (`--width 150 height=180`) yields ~60–70° walls; a hint like "keep height ≲ width/2 for walkable slopes" would help.
   There's no way to change a path's width with `set` that I could see — I had to remove and re-place.
2. **`look --from w` with a big `--at` thing put the camera outside the world** (x=-543) looking at the range; the frame was
   dominated by a brown wall (the mountain flank seen edge-on / world skirt). `--dist` helped. A far-range look is hard to read.
3. **`--near <area> --count n` positions** are on a circle around the area's centre, so for a square plaza the corner
   houses (diagonals) and the edge houses sit at different distances from the plaza edge. Works, but not "evenly 5 m from the rim".
4. `--facing square` on the house set was accepted but the op's constraints only listed `near` (no `facing`) — the yaw was right,
   but it isn't kept as a constraint as the docs imply.
5. `place road --from square --to bridge` picks the nearest plaza edge point regardless of what stands there (here a lamp);
   the road is a surface so it was not refused, but the lamp would have sat in the road. A warning would help.
6. `where` on trees placed `--offset 3` back from the road edge reports them "within: main-road [surface]" — the road's
   footprint (verges?) seems wider than its 6 m; slightly confusing.
7. `--corner back-left` for a wardrobe gave a diagonal (45°) orientation; I expected back-to-wall like `--wall`.
8. `describe townhouse/bedroom` → "no such entity"; rooms are slots, not entities, so you can't describe one room directly
   (`describe townhouse` covers it, but the room ref works for `--inside` and `furnish`, so I expected it to work here too).
9. Look timing was very uneven: ~3 s normally with `--keep`, but once 602 s and "not fully settled". The SKILL's warning
   was accurate; the 10-minute timeout was barely enough.
10. Lamp-posts on the plaza report y = -0.2 (the plaza seems to sink the ground slightly); harmless but surprising.
