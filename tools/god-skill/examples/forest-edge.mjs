#!/usr/bin/env node
// A forest edge (SKILL.md example 5): an old wood beside a meadow, a trail from the meadow into the
// wood, rocks along it, a bench halfway, and a check that the meadow stays clear.
import { run } from './_harness.mjs';
import { STANDINS } from './_standins.mjs';
await run('forest-edge', {
  title: 'a forest edge',
  fallbacks: { path: STANDINS.path },
  steps: [
    'place forest --rect -70,0,80,90 --name old-wood',
    'place meadow --rect 30,0,60,90 --name meadow',
    "place path --path '[[45,40],[10,20],[-20,5],[-55,-10]]' --width 1.6 --name trail",
    'place rock --along trail --row 4 --gap 10 --side right --offset 1.5',
    'place bench --along trail --t 0.3 --side left --offset 1.2 --name rest',
    'place tree --near rest --count 3 --dist 3',
    'where rest',
  ],
  look: '--at trail --from s --dist 90',
});
