#!/usr/bin/env node
// A two-floor house with a furnished bedroom upstairs (SKILL.md example 2): read the rooms with
// describe, furnish by room, look inside with the roofs hidden.
import { run } from './_harness.mjs';
import { STANDINS } from './_standins.mjs';
const upstairs = (d) => d.rooms.find((r) => r.floor >= 1 && /bed/i.test(r.id + r.name)) ?? d.rooms.find((r) => r.floor >= 1);
const kitchen = (d) => d.rooms.find((r) => r.floor === 0 && /kitchen|living|ground/i.test(r.id + r.name)) ?? d.rooms.find((r) => r.floor === 0);
await run('two-floor-house', {
  title: 'a two-floor house, bedroom upstairs',
  fallbacks: { townhouse: STANDINS.house },   // L2's core/townhouse once buildings merge
  steps: [
    'place townhouse --at 0,0 --param floors=2 --facing s --name townhouse',
    'describe townhouse',
    (c) => `place bed --inside townhouse/${upstairs(c.json('describe townhouse --json')).id} --wall n --name bed`,
    (c) => `place chair --inside townhouse/${upstairs(c.json('describe townhouse --json')).id} --corner se --name reading-chair`,
    (c) => `place bookshelf --inside townhouse/${upstairs(c.json('describe townhouse --json')).id} --wall w --name bookshelf`,
    (c) => `place table --inside townhouse/${kitchen(c.json('describe townhouse --json')).id} --name table`,
    (c) => `place chair --inside townhouse/${kitchen(c.json('describe townhouse --json')).id} --count 2 --facing townhouse/table --name dining-chair`,
    'place bowl --on townhouse/table --name bowl',
    'place bench --near townhouse --dir s --facing s --name porch-bench',
    'describe townhouse',
  ],
  look: '--at townhouse --inside --from s',
});
