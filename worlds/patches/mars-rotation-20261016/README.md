# Mars true rotation, October 16

World patch for **my-mars-college-2026-3**: turns the campus from compass bearing 90 to **82** (the old viewer's drone fit; DJI fits give 75-86). Needs lane `walk` (any-angle walking, merged into this branch) in the release.

What it does: 116 ordinary public Godmode `move` edits in one atomic batch. Every world-root campus placement of `worlds/templates/mars-two.json` outside its `land` batch is rotated 8 degrees about the Mimos origin (world 0,-30) and gets the same yaw added. Children (furniture, rooms, items) are parent-local and follow. Land, tyre tracks and the far backdrop are geographic and stay. `frame.mjs` has `MARS_BEARING` and `template.mjs` has `MARS_TEMPLATE_OUT` to generate other bearings (verified: patched poses equal the 82 template exactly).

Apply (Node 22.20.0; credential by path, never pasted; receipt outside Git). Apply AFTER `mars-fidelity-20261015`; roll back in reverse order.
```sh
N=~/.nvm/versions/node/v22.20.0/bin/node; P=<worktrees>/lane-mars/tools/mars-rotation/patch.mjs
B=https://sim.eden.art/worlds/w/my-mars-college-2026-3
$N $P --base $B --receipt /ABS/PRIVATE/mars-rotation.receipt.json --bearing 82                  # review (no token = pure reads)
EDEN_GOD_TOKEN_FILE=<path> $N $P --base $B --receipt /ABS/mars-rotation.receipt.json --bearing 82           # preview via API
EDEN_GOD_TOKEN_FILE=<path> $N $P --base $B --receipt /ABS/mars-rotation.receipt.json --bearing 82 --apply
```
Interrupted/uncertain apply: same receipt with `--recover`. Rollback: same receipt with `--rollback` (review) then `--rollback --apply`. It refuses if any later authored edit exists or a moved entity changed.

Guards: refuses if any resident body stands within the campus radius (they would end up inside moved walls; apply when Souls are away or paused), if more than 10 percent of campus names are missing, or on a bearing outside 70-90. Entities moved off the world root since genesis are skipped and listed in `missing`.

Evidence (local fixtures, fake minds, no live write): `team/scratch/mars/rot/` (`walk-90|82|75.json`, `patch-local.json`). A scripted resident through the CLI walks into and sits in Mimos floor, main-south and the raised main, and walks the kitchen dining hall and working kitchen at 90 (control), 82 and 75; identical results, except sitting on a bus seat from the dining hall returns `slot.transition-blocked` at all three angles including 90 (pre-existing, not rotation). Patch applied to a fresh 90 world, residents walk and sit afterward, rollback with a resident present verified. Screenshots `team/lanes/t3-mars-shots/rot82-*`. Not live-proven; L1 must apply and walk. One CLI call exited non-zero transiently in two runs; a retry passed.
