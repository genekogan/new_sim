// E2: a big wheel's gondolas (kit roles `wheel-hang-*`) go round with the turning wheel and keep hanging upright.
//   node --test apps/web/src/gen-mesh/motion-hang.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { animate, hangPosition } from './motion.ts';

test('hangPosition turns a hanger point about the hub', () => {
  const [x, y] = hangPosition([5, 0], Math.PI / 2);
  assert.ok(Math.abs(x) < 1e-9 && Math.abs(y - 5) < 1e-9);
});

test('a gondola rides round with the wheel and stays upright', () => {
  const obj = new THREE.Group(), wheel = new THREE.Group(), gondola = new THREE.Group(), other = new THREE.Group();
  wheel.name = 'role:wheel'; wheel.position.set(0, 10, 0);
  gondola.name = 'role:wheel-hang-1'; gondola.position.set(5, 10, 0);
  other.name = 'role:door'; other.position.set(5, 10, 0);
  obj.add(wheel, gondola, other);
  const def = { components: { spin: { axis: 'z', rpm: 15, role: 'wheel' } }, tags: [] } as never;
  const t = 1e9 + 1; // a quarter turn at 15 rpm (one turn in 4 s)
  animate(obj, { id: 'w', def: 'x', p: [0, 0, 0] } as never, def, t, { y: 0, yaw: 0 });
  assert.ok(Math.abs(wheel.rotation.z - (t * 0.25 * Math.PI * 2)) < 1e-6);
  assert.ok(Math.abs(gondola.position.x) < 1e-3 && Math.abs(gondola.position.y - 15) < 1e-3, `at the top: ${gondola.position.toArray()}`);
  assert.equal(gondola.rotation.z, 0, 'hangs upright');
  assert.deepEqual(other.position.toArray(), [5, 10, 0], 'other roles stay put');
});
