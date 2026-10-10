#!/usr/bin/env node
// A market square as one undoable group (SKILL.md example 4): a plaza, a fountain, benches facing it,
// stalls around the plaza edge, lamps.
import { run } from './_harness.mjs';
import { STANDINS } from './_standins.mjs';
await run('market-square', {
  title: 'a market square',
  fallbacks: { plaza: STANDINS.plaza, stall: STANDINS.stall },
  steps: [
    'group market',
    'place plaza --rect 0,0,36,28 --name square',
    'place fountain --at square --name fountain',
    'place bench --near fountain --count 4 --facing fountain --dist 2.5',
    'place stall --at 0,-11 --row 4 --gap 3 --facing fountain --name stall',
    'place stall --at 0,11 --row 4 --gap 3 --facing fountain --name south-stall',
    'place lamp-post --at -16,-12 --name lamp-nw',
    'place lamp-post --at 16,-12 --name lamp-ne',
    'place lamp-post --at -16,12 --name lamp-sw',
    'place lamp-post --at 16,12 --name lamp-se',
    'group --off',
    'history 3',
  ],
  look: '--at square --from s',
});
