#!/usr/bin/env node
// A hamlet in 8 commands (SKILL.md example 1): a knoll with a cottage facing south, a pond with a bench
// looking at it, trees around the cottage, a well with lamps. Ends with a look from the south-west.
import { run } from './_harness.mjs';
await run('hamlet', {
  title: 'a hamlet in 8 commands',
  steps: [
    'place knoll --at 40,10 --param height=5 --param radius=26 --name knoll',
    'place cottage --at knoll --facing s --name cottage',
    'place pond --circle 30,38,8 --name pond',
    'place bench --near pond --facing pond --dir n --name pond-bench',
    'place tree --near cottage --count 5 --dist 4',
    'place fountain --at 18,4 --name well',
    'place lamp-post --near well --count 4 --dist 2',
    'place dog --near cottage --dir s --dist 3 --name rex',
    'describe rex',
    'describe cottage',
  ],
  look: '--from sw',
});
