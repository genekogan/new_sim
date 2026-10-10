#!/usr/bin/env node
// A lake, a river leaving it to the south, a bridge across the river, a road over the bridge, ducks
// floating on the lake (SKILL.md example 3).
import { run } from './_harness.mjs';
import { STANDINS } from './_standins.mjs';
await run('river-bridge', {
  title: 'a river with a bridge',
  fallbacks: { river: STANDINS.river, bridge: STANDINS.bridge, road: STANDINS.road, duck: STANDINS.duck },
  steps: [
    'place lake --circle -60,-70,32 --name lake',
    "place river --path '[[-45,-42],[-20,0],[0,40],[6,120]]' --width 8 --name river",
    'place bridge --across river --t 0.45 --span 3 --width 4 --name bridge',
    'place road --from -60,30 --to bridge --width 4 --name west-road',
    'place road --from bridge --to 60,0 --width 4 --name east-road',
    'place duck --float --at lake --count 4',
    'place tree --along river --row 4 --gap 14 --side left --offset 4',
    'describe bridge',
  ],
  look: '--at bridge --from se --dist 70',
});
