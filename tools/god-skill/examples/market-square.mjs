#!/usr/bin/env node
// A market square as one undoable group (SKILL.md example 4): a plaza, a fountain, benches facing it,
// parasol-table stalls with crates and barrels (all library things), lamps.
import { run } from './_harness.mjs';
await run('market-square', {
  title: 'a market square',
  steps: [
    'group market',
    'place plaza --rect 0,0,36,28 --name square',
    'place fountain --at square --name fountain',
    'place bench --near fountain --count 4 --facing fountain --dist 2.5',
    'place parasol-table --at 0,-11 --row 4 --gap 3 --facing fountain --name stall',
    'place parasol-table --at 0,11 --row 4 --gap 3 --facing fountain --name south-stall',
    'place crate --near stall-1 --count 3 --dist 0.6',
    'place barrel --near south-stall-2 --count 2 --dist 0.6',
    'place lamp-post --at -16,-12 --name lamp-nw',
    'place lamp-post --at 16,-12 --name lamp-ne',
    'place lamp-post --at -16,12 --name lamp-sw',
    'place lamp-post --at 16,12 --name lamp-se',
    'group --off',
    'history 3',
  ],
  look: '--at square --from s',
});
