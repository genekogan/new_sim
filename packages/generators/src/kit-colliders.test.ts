import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CREATION_LIMITS, kitArgs, kitPhysics } from './index.ts';
import type { LocalOBB, Vec3 } from './types.ts';

const contains = (b: LocalOBB, [x, y, z]: Vec3) => {
  const dx = x - b.c[0], dz = z - b.c[1], c = Math.cos(b.yaw), s = Math.sin(b.yaw);
  return y >= b.y0 - 1e-7 && y <= b.y1 + 1e-7 && Math.abs(dx * c - dz * s) <= b.half[0] + 1e-7 && Math.abs(dx * s + dz * c) <= b.half[1] + 1e-7;
};
test('45 degree ramp plank leaves space underneath its high end; the plank remains solid', () => {
  const b = kitPhysics(kitArgs.parse({ shapes: [{ kind: 'box', at: [0, 2.2, 0], size: [1, 0.15, 6], pitch: Math.PI / 4, collide: true }] }));
  assert.ok(!b.colliders.some(o => contains(o, [0, 0.8, -1.7])));
  for (let z = -2.9; z < 3; z += 0.1) assert.ok(b.colliders.some(o => contains(o, [0, 2.2 - z / Math.SQRT2, z / Math.SQRT2])), `plank at ${z}`);
  assert.ok(b.colliders.length <= CREATION_LIMITS.kitColliderSlices);
});
test('upright kit part retains its original collider exactly', () => {
  const b = kitPhysics(kitArgs.parse({ shapes: [{ kind: 'box', at: [1, 1.5, 2], size: [2, 3, 4], collide: true }] }));
  assert.deepEqual(b.colliders, [{ c: [1, 2], half: [1, 2], yaw: 0, y0: 0, y1: 3 }]);
});
test('many tilted parts stay bounded without collapsing the empty space back into one box', () => {
  const b = kitPhysics(kitArgs.parse({ shapes: Array.from({ length: 96 }, (_, i) => ({ kind: 'box', at: [i * 2, 2.2, 0], size: [1, 0.15, 6], pitch: Math.PI / 4, roll: 0.1, yaw: 0.4, collide: true })) }));
  assert.ok(b.colliders.length > 12); assert.ok(b.colliders.length <= 96 * CREATION_LIMITS.kitColliderSlices);
});
