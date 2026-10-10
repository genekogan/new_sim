#!/usr/bin/env node
// A two-floor house with a furnished bedroom upstairs (SKILL.md example 2): L2's townhouse, its rooms
// read with describe, the bedroom furnished by hand (room words: --inside townhouse/bedroom), the
// kitchen by recipe (furnish), a look inside with the roofs and upper storeys hidden.
import { run } from './_harness.mjs';
await run('two-floor-house', {
  title: 'a two-floor house, bedroom upstairs',
  steps: [
    'defs house',
    'place townhouse --at 0,0 --param floors=2 --facing s --name townhouse',
    'describe townhouse',
    'place bed --inside townhouse/bedroom --wall n --name bed',
    'place chair --inside townhouse/bedroom --corner se --name reading-chair',
    'place bookshelf --inside townhouse/bedroom --wall w --name bookshelf',
    'place rug --inside townhouse/bedroom --name rug',
    'place table --inside townhouse/parlour --name table',
    'place chair --inside townhouse/parlour --count 2 --facing townhouse/table --name dining-chair',
    'place bowl --on townhouse/table --name bowl',
    'furnish townhouse/kitchen',
    'place bench --near townhouse --dir s --facing s --name porch-bench',
    'describe townhouse',
  ],
  look: '--at townhouse --inside --from s',
});
