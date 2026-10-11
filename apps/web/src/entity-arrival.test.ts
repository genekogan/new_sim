// node --test apps/web/src/entity-arrival.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { ARRIVAL_MAX, ARRIVAL_MIN, entityArrivalPose } from './entity-arrival.ts';
const flat = () => 0;
const d = (p: { eye: number[]; target: number[] }) => Math.hypot(p.eye[0] - p.target[0], p.eye[1] - p.target[1], p.eye[2] - p.target[2]);
test('an empty plain: the middle of the world at the near distance, low enough to keep the horizon (not 320 m away)', () => {
  const p = entityArrivalPose([-120, -120, 120, 120], 0, flat, 45, 1280 / 860);
  assert.deepEqual(p.target, [0, 0, 0]);
  assert.ok(Math.abs(d(p) - ARRIVAL_MIN) < 1e-6, String(d(p)));
  assert.ok(Math.abs(p.eye[1] - ARRIVAL_MIN * Math.sin(16 * Math.PI / 180)) < 1e-6);
});
test('a built world: centred on what was built, distance fits it but stays within the human range', () => {
  const small = entityArrivalPose([-8, -8, 8, 8], 3, flat, 45, 1.5);
  assert.deepEqual(small.target, [0, 0, 0]); assert.equal(small.distance, ARRIVAL_MIN);
  const mid = entityArrivalPose([0, -30, 40, 10], 6, () => 2, 45, 1.5);
  assert.deepEqual(mid.target, [20, 2, -10]); assert.ok(mid.distance > ARRIVAL_MIN && mid.distance <= ARRIVAL_MAX, String(mid.distance));
  const huge = entityArrivalPose([-500, -500, 500, 500], 40, flat, 45, 1.5);
  assert.equal(huge.distance, ARRIVAL_MAX);
  for (const p of [small, mid, huge]) { assert.ok(Math.abs(d(p) - p.distance) < 1e-6); assert.ok(p.eye[1] > p.target[1]); }
});
test('ground height and bad input', () => {
  const hill = entityArrivalPose([10, 10, 20, 20], 1, () => 7);
  assert.equal(hill.target[1], 7); assert.ok(hill.eye[1] > 7);
  const off = entityArrivalPose([NaN, 0, 1, 1] as unknown as [number, number, number, number], 2, () => null);
  assert.ok(off.eye.every(Number.isFinite) && off.target.every(Number.isFinite));
});
test('the god panel covers the right of the view: what was built lands in the uncovered middle, not under the panel', () => {
  const full = entityArrivalPose([-10, -10, 10, 10], 4, flat, 45, 1.5, 1), covered = entityArrivalPose([-10, -10, 10, 10], 4, flat, 45, 1.5, 0.7);
  assert.deepEqual(full.target, [0, 0, 0]);
  // the target moved to the camera's right: right = forward × up, forward = target − eye (horizontal)
  const fx = covered.target[0] - covered.eye[0], fz = covered.target[2] - covered.eye[2], rx = -fz, rz = fx;
  assert.ok(covered.target[0] * rx + covered.target[2] * rz > 0);
  // and the built centre (0,0,0) projects left of the screen centre by about (1 − 0.7)/2 of the view width
  const n = Math.hypot(rx, rz), along = -(covered.target[0] * rx + covered.target[2] * rz) / n;
  const width = 2 * covered.distance * Math.tan(22.5 * Math.PI / 180) * 1.5;
  assert.ok(Math.abs(along / width + 0.15) < 0.01, String(along / width));
});
