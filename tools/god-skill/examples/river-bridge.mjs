#!/usr/bin/env node
// A lake, a river leaving it to the south, a road crossing the river (roads bridge water by
// themselves: autoBridge), a footbridge across further down, ducks floating on the lake, trees on the
// east bank (SKILL.md example 3).
import { run } from './_harness.mjs';
await run('river-bridge', {
  title: 'a river with a bridge',
  steps: [
    'place lake --circle -60,-70,32 --name lake',
    "place river --path '[[-45,-42],[-20,0],[0,40],[6,120]]' --width 8 --name river",
    'place road --from -70,10 --to 70,30 --width 5 --name crossing',
    'describe crossing',
    'place bridge --across river --t 0.8 --span 2 --width 2 --name footbridge',
    'place duck --float --at lake --count 4',
    'place tree --along river --row 4 --gap 14 --side left --offset 4',
  ],
  look: '--at crossing --from se --dist 80',
});
