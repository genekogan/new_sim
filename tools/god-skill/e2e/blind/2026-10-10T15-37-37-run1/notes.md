# Blind run 1 — notes

World: http://127.0.0.1:5156/w/blind1 (1000 m square). Register + pair worked first try.

## Prompt 1 — mountains east, lake west, river lake→south edge, bridge
- `place mountain --path [[360,-380],[400,-100],[380,150],[360,380]] --width 160 --param height=160 --name east-range`
- `place lake --circle -300,-60,80 --name west-lake`
- `place river --from west-lake --to s` worked but gave a dead-straight river; replaced with a meandering
  `--path` from the lake to z=500 (the south edge).
- `place bridge --across river --t 0.45 --span 4 --param width=5 --param material=stone --name bridge` (18 m, ok).
- No refusals.

## Prompt 2 — village of six houses around a plaza
- `plaza --rect -80,140,32,32`, `fountain --at plaza`, `cottage --near plaza --count 6 --dist 6 --facing plaza`
  (six cottages ringed around it), `bench --near fountain --count 4 --facing fountain --dist 3`, four
  `lamp-post`s at the plaza corners. No refusals. Look from s looked right.

## Prompt 3 — two-floor house, furnished bedroom upstairs
- `townhouse --at -25,140 --param floors=2 --facing plaza` (east of the village). `describe` gave
  bedroom on floor 1. `furnish townhouse/bedroom` placed bed, rug, wardrobe, dresser, floor lamp; added
  a chair in the se corner. `look --inside` showed the furnished bedroom. No refusals.

## Prompt 4 — road plaza→bridge lined with trees
- `place road --from plaza --to bridge` ran from the plaza **centre** (straight through the fountain) to
  the bridge **centre** (and auto-bridged a second time on top of the bridge). Removed it and placed
  `road --path` from the plaza's west edge to the bridge's east end (read off the cache).
- `tree --along main-road --row 12 --gap 12 --side both --offset 3` was REFUSED (overlap.solid: the
  row's last trees piled up on each other at the road's end). Retried with `--row 10 --gap 14`: committed,
  but the spacing did not follow `--gap` (~19 m apart, 2%…100%), and the 10th tree of each side was
  squeezed against the 9th at 98–100%, one standing on the river bank. Removed the 4 end trees → 8
  per side.

## Prompt 5 — look from the south, fix, export
- Look from s showed: the river was drawn as a dark stripe across the lake (it started at the lake's
  centre). Re-placed the river to start at the lake's south shore; the stripe is gone and the bridge
  still spans water. The townhouse stood alone with no way to it: added a cobble footpath from the plaza
  to its front door. Exported to work/world.genesis.json (45 things).

## Confusions / missing in SKILL.md or the CLI
- `--from <ref> --to <ref>` for roads: SKILL.md says "from/to refs' edges", but it used the centres
  (plaza centre, bridge midpoint). Path shapes are not printed by `describe` (only "2 points"); I had to
  read `.eden-god.cache.json` to get the bridge's end points.
- `--along … --row n --gap g`: gap is ignored (the row is spread over the whole path) and the end of the
  row clamps, piling trees together → overlap refusal or crowded trees at the end.
- `describe` of a path entity reports `near:` distances from pose (0,0), which is meaningless.
- `place mountain --path …` prints "point of 4 points"; `describe` shows radius 200 although width 160 was given.
- `river --from lake` starts at the lake's centre, so the river surface draws over the lake.
- `look --from above --dist 1100` took 626 s and showed only ~460 m of the world (no lake, no mountains
  visible); a whole-world overview look doesn't seem possible. Later looks were 36–211 s.
- `free 12x10 --near plaza` returns spots on the plaza itself (surface counted as free).
- Lamp posts placed on the plaza report y −0.2 (slightly sunk?).
