#!/usr/bin/env node
// A hillside village (SKILL.md example 6): a hill, a lane winding across it, cottages on both sides of
// the lane facing it (terraced automatically on the slope), trees lining the lane further out.
import { run } from './_harness.mjs';
import { STANDINS } from './_standins.mjs';
await run('hillside-village', {
  title: 'a hillside village',
  fallbacks: { road: STANDINS.road },
  steps: [
    'place hill --at 0,-60 --param height=18 --param radius=90 --name hill',
    "place road --path '[[-80,-20],[-30,-55],[30,-60],[80,-100]]' --width 5 --name lane",
    'place cottage --along lane --row 4 --gap 8 --side left --offset 2 --name north-house',
    'place cottage --along lane --row 4 --gap 8 --side right --offset 2 --name south-house',
    'place tree --along lane --row 7 --gap 14 --side both --offset 14',
    'place fountain --free --near lane --name village-well',
    'resolve',
  ],
  look: '--at hill --from s --dist 150',
});
