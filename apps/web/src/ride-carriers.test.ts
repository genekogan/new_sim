// Offline: node --test apps/web/src/ride-carriers.test.ts
// D1: any native carrier is a ride (balloon, ferris wheel, carousel, punt), not only balloon-tagged things.
import test from 'node:test';
import assert from 'node:assert/strict';
import {isRideCarrierDef, carrierIdOf, recordedCarriers, carrierPoses} from './ride-carriers.ts';
import {isRideBalloonDef} from './gen-mesh/kits/ride-balloon.ts';
import {ridingCarrier} from './WorldBroadcast.ts';

test('a ferris wheel or carousel with a carrier component is a ride; it is not a ride balloon', () => {
  const wheel = {tags: ['ferris-wheel', 'attraction'], components: {carrier: {seats: 2}}};
  assert.equal(isRideCarrierDef(wheel), true); assert.equal(isRideBalloonDef(wheel), false);
  assert.equal(isRideCarrierDef({tags: ['balloon', 'carrier'], components: {hover: {}}}), true);
  assert.equal(isRideCarrierDef({tags: ['tree'], components: {}}), false);
  assert.equal(isRideCarrierDef(undefined), false);
});

test('a god ride\'s carrier id mirrors the server: its name when free, else ride-<thing id>', () => {
  const none = () => false;
  assert.equal(carrierIdOf({id: 'e_12AB', name: 'resort-ferris-wheel'}, none), 'resort-ferris-wheel');
  assert.equal(carrierIdOf({id: 'e_12AB', name: 'Big Wheel'}, none), 'ride-e_12ab');
  assert.equal(carrierIdOf({id: 'e_12AB'}, none), 'ride-e_12ab');
  assert.equal(carrierIdOf({id: 'e_12AB', name: 'wheel'}, id => id === 'wheel'), 'ride-e_12ab');
});

test('recorded carriers (a punt, a wheel car) are framed where the frame has them, so a rider in one counts as riding', () => {
  const records = {s1: {human: {}}, 'pond-punt': {def: 'rowing-punt', carrier: {phase: 'aloft'}}, 'resort-ferris-wheel': {def: 'hot-air-balloon', carrier: {phase: 'aloft'}}, 'eden-balloon': {carrier: {}}};
  const ids = recordedCarriers(records);
  assert.deepEqual(ids, ['eden-balloon', 'pond-punt', 'resort-ferris-wheel']);
  const frame = {'pond-punt': {p: [3, 0, 4], yaw: 1}, 'resort-ferris-wheel': {p: [-20, 9, -9], yaw: 0}};
  const poses = carrierPoses(ids, frame, new Set(['eden-balloon']));
  assert.deepEqual(poses.map(c => c.id), ['pond-punt', 'resort-ferris-wheel']);
  // a rider 9 m up at the wheel's car is riding it (the camera frames it with its car), one on the grass below is not
  assert.ok(ridingCarrier([-20, 9.3, -9], poses)); assert.equal(ridingCarrier([-20, 0, -9], poses), null);
});

test('the card names a ride pose, never the idle doing; the server\'s body line reads as written', async () => {
  const {doingText} = await import('./place-names.ts');
  assert.equal(doingText('standing around', 'ride'), 'Riding');
  assert.equal(doingText('standing around', 'row'), 'Rowing');
  assert.equal(doingText('standing around', 'board'), 'Boarding');
  assert.equal(doingText('riding the ferris wheel', 'ride'), 'Riding the ferris wheel');
});
