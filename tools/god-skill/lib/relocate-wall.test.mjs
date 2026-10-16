// r2.1: `move <facade mount> --by dx,dz` dropped the mount out of its building to the ground at the world root
// (relocate() only kept surface slots and rooms). A wall mount now stays on its wall frame and slides within it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relocate } from './solver.mjs';

function fixture() {
  const house = { id: 'e_h', path: 'house', parent: 'world', pose: [10, 0, 5, 0, 1], box: [8, 3, 6],
    slots: [
      { id: 'living', kind: 'room', p: [10, 0, 5], yaw: 0, polygon: [[6, 2], [14, 2], [14, 8], [6, 8]] },
      { id: 'facade-f0-s-1', kind: 'wall', p: [13.175, 1.4, 8.1], yaw: 0 },
    ] };
  const lantern = { id: 'e_l', path: 'house/lan', parent: 'e_h', slot: 'facade-f0-s-1', pose: [13.175, 1.4, 8.1, 0, 1], box: [0.3, 0.4, 0.3] };
  const rows = [house, lantern], byId = new Map(rows.map((r) => [r.id, r]));
  return { v: { rows, byId, get: (ref) => rows.find((r) => r.path === ref || r.id === ref) }, lantern };
}

test('a facade mount moved --by stays on its wall frame (not dropped to the root)', () => {
  const { v, lantern } = fixture();
  const L = relocate(v, lantern, lantern.pose[0] + 0.5, lantern.pose[2], lantern.pose[3]);
  assert.deepEqual(L.in, { parent: 'house', slot: 'facade-f0-s-1' });
  assert.deepEqual(L.p, [0.5, 0]);
  assert.equal(L.left, undefined);
});

test('a facade mount on a rotated house slides along its frame in the house frame', () => {
  const { v, lantern } = fixture();
  v.byId.get('e_h').pose[3] = Math.PI / 2;
  const L = relocate(v, lantern, lantern.pose[0] + 1, lantern.pose[2], undefined);
  assert.deepEqual(L.in, { parent: 'house', slot: 'facade-f0-s-1' });
  assert.ok(Math.hypot(L.p[0], L.p[1]) > 0.99 && Math.hypot(L.p[0], L.p[1]) < 1.01, JSON.stringify(L.p));
});
