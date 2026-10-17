# Little Martians grotto approach, October 17

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
