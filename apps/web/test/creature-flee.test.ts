// E2 #3: animals never fled. Shy creatures (deer, fox, rabbit, squirrel, badger, hedgehog) now carry
// components.behavior.flee: they bolt from a Soul who comes within that distance and walk back once it has gone.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fleeStep, type FleeState} from '../src/gen-mesh/motion.ts';
import {defSchema} from '../../../packages/world-compiler/src/schemas.ts';
import creatures from '../../../packages/world-compiler/src/core-kit/creatures.json' with {type: 'json'};
import vocabW2 from '../../../packages/world-compiler/src/core-kit/vocab-w2.json' with {type: 'json'};

const routine = {x: 0, z: 0, yaw: 0, speed: 0, dist: 0, rest: 1, activity: 'graze' as const, alt: 0, u: 1};
const open = () => true;

test('wild creatures are shy, livestock and pets are not', () => {
  const flee = (n: string) => (defSchema.parse([...creatures, ...vocabW2].find((d: {name: string}) => d.name === 'core-' + n)) as any).components.behavior?.flee;
  for (const n of ['deer', 'fox', 'rabbit', 'squirrel', 'badger', 'hedgehog']) assert.ok(flee(n) > 0, n);
  for (const n of ['sheep', 'cow', 'dog', 'cat']) assert.equal(flee(n), undefined, n);
});

test('a deer bolts directly away from a Soul inside its distance, then walks back to its routine', () => {
  const st: FleeState = {ox: 0, oz: 0, dist: 0, t: 0};
  let p = routine as any;
  for (let t = 0.1; t <= 2; t += 0.1) p = fleeStep(st, routine, [[-5, 0]], 12, 1, t, open);   // a Soul 5 m west
  assert.ok(p.x > 2.5 && Math.abs(p.z) < 1e-6, `ran east: ${p.x}`);
  assert.ok(Math.abs(p.yaw - Math.PI / 2) < 1e-6 && p.speed >= 3 && p.activity === 'walk');
  const far = p.x;
  for (let t = 2.1; t <= 60; t += 0.1) p = fleeStep(st, routine, [[-500, 0]], 12, 1, t, open);   // the Soul has gone
  assert.ok(far > 2.5 && Math.abs(p.x) < 1e-9 && p === routine, 'back on its routine');
});

test('it never runs through a wall, nor further than twice its distance, and ignores people far away', () => {
  const st: FleeState = {ox: 0, oz: 0, dist: 0, t: 0};
  let p: any = routine;
  for (let t = 0.1; t <= 30; t += 0.1) p = fleeStep(st, routine, [[-1, 0]], 4, 1, t, open);
  assert.ok(p.x <= 8 + 1e-9, `capped at 2 x 4 m: ${p.x}`);
  const walled: FleeState = {ox: 0, oz: 0, dist: 0, t: 0};
  for (let t = 0.1; t <= 5; t += 0.1) p = fleeStep(walled, routine, [[-1, 0]], 6, 1, t, (x) => x < 1.5);
  assert.ok(p.x < 1.5, `stopped at the wall: ${p.x}`);
  const calm: FleeState = {ox: 0, oz: 0, dist: 0, t: 0};
  assert.equal(fleeStep(calm, routine, [[20, 0]], 6, 1, 0.1, open), routine);
});
