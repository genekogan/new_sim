import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GENERATORS, kitPhysics, kitArgs, scatterPoints, segmentColliders } from './index.ts';

test('every generator bakes with defaults and returns finite bounds', () => {
  for (const g of Object.values(GENERATORS)) {
    const params = Object.fromEntries(Object.entries(g.params).filter(([, f]) => (f as { default?: unknown }).default !== undefined).map(([k, f]) => [k, (f as { default: unknown }).default])) as never;
    const shape = g.form === 'path' ? { path: [[-10, 0], [10, 0]] as [number, number][], width: 4 } : g.form === 'area' ? { area: [[-5, -5], [5, -5], [5, 5], [-5, 5]] as [number, number][] } : undefined;
    const args = g.id === 'kit/2' ? { shapes: [{ kind: 'box', at: [0, 0.5, 0], size: [1, 1, 1] }] } : {};
    const b = g.physics({ params, args, seed: 1, shape });
    assert.ok(b.box.every((v) => Number.isFinite(v) && v > 0), `${g.id} box ${b.box}`);
  }
});
test('kit physics: bounds include rotated parts; tall boxes collide, roles and small parts do not', () => {
  const b = kitPhysics(kitArgs.parse({ shapes: [{ kind: 'rbox', at: [0, 0.4, 0], size: [1, 0.8, 0.5] }, { kind: 'capsule', at: [0.3, 0.2, 0.2], r: 0.05, h: 0.3, role: 'leg.fl' }, { kind: 'sphere', at: [0, 1, 0.4], r: 0.1 }] }));
  assert.equal(b.colliders.length, 1);
  assert.ok(b.box[1] >= 1.1 && Math.abs(b.box[2] - 0.75) < 1e-9, JSON.stringify(b.box));
});
test('segment colliders split at gaps; scatter is deterministic and spaced', () => {
  const c = segmentColliders([[0, 0], [10, 0]], 0.3, 0, 2, [{ from: 4, to: 6 }]);
  assert.equal(c.length, 2); assert.ok(Math.abs(c[0].half[0] - 2) < 1e-9);
  const a = scatterPoints([[0, 0], [20, 0], [20, 20], [0, 20]], 0.2, 2, 42), b = scatterPoints([[0, 0], [20, 0], [20, 20], [0, 20]], 0.2, 2, 42);
  assert.deepEqual(a, b); assert.ok(a.length > 20);
  for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) assert.ok(Math.hypot(a[i][0] - a[j][0], a[i][1] - a[j][1]) >= 2 - 1e-9);
});
