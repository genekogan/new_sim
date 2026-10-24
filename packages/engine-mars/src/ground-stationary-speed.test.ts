import test from 'node:test';
import assert from 'node:assert/strict';
import {groundInvariants} from './ground-bridge.ts';
import {speedWithinCap, SPEED_CAPS} from '../../../mars/viewer/engine/runtime/invariants.ts';

const check = groundInvariants([speedWithinCap])[0];
const faults = (activity: string, speed: number) => check({world: {entities: {
  h_test: {id: 'h_test', kind: 'human', pose: {p: [0, 0, 0]}, human: {activity, speed}},
}}} as any);

test('stationary ground activities do not trigger overspeed recovery', () => {
  for (const activity of ['dance', 'read', 'sit', 'wave']) assert.deepEqual(faults(activity, 0), [], activity);
});

test('moving without an activity cap and exceeding a ground gait cap remain violations', () => {
  assert.equal(faults('dance', 0.01)[0]?.code, 'motion.overspeed');
  assert.equal(faults('walk', SPEED_CAPS.walk * 1.06)[0]?.code, 'motion.overspeed');
  assert.deepEqual(faults('walk', SPEED_CAPS.walk), []);
  assert.equal(faults('dance', NaN)[0]?.code, 'motion.overspeed');
});
