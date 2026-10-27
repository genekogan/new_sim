import test from 'node:test';
import assert from 'node:assert/strict';
import {groundFootLift} from './ground-foot-fit.ts';

test('foot contact follows a small nearby rise without moving an airborne swing foot', () => {
  assert.ok(Math.abs(groundFootLift(2, 2.01, 2.05) - .043) < 1e-9);
  assert.equal(groundFootLift(2, 2.16, 2.05), 0);
});
test('a slab remains support when the terrain sampler sees the ground below it', () => {
  assert.ok(Math.abs(groundFootLift(.374, .36, 0) - .017) < 1e-9);
  assert.equal(groundFootLift(.374, .42, 0), 0);
});
test('large surfaces and broken samplers cannot pull feet onto a shelf or change root height', () => {
  assert.equal(groundFootLift(0, -.1, 1), .08);
  assert.equal(groundFootLift(0, .1, 1), 0);
  assert.equal(groundFootLift(0, Infinity, 0), 0);
  assert.equal(groundFootLift(NaN, 0, 0), 0);
});
