import test from 'node:test'; import assert from 'node:assert/strict';
import { godRoomViews, godTourViews } from './world-env.ts';
// M2 (lane M, 2026-10-17): Explore's "go inside" views come from a building's labelled room polygons.
const room = (id: string, p: number[], polygon: [number, number][], label?: string) => ({ id, kind: 'room', p, polygon, ...(label ? { label } : {}) });
function model(rooms: ReturnType<typeof room>[], pose = { x: 10, y: 0, z: -5, yaw: Math.PI / 2, s: 1 }, editSeq = 1) {
  const e = { id: 'e_1', name: 'mess-hall', def: 'd@1', in: { parent: 'world' } };
  return { model: { editSeq, entities: new Map([[e.id, e]]), resolvedDef: () => ({}), footprint: () => [], worldPose: () => pose, slotsOf: () => [...rooms, { id: 'door', kind: 'stand', p: [0, 0, 0] }] } };
}
test('one view per labelled room big enough to stand in, camera inside the room at eye height', () => {
  const rooms = [room('dining', [0, 0.5, 0], [[-5, -2], [5, -2], [5, 2], [-5, 2]], 'Dining hall (blue wall, bus seats)'), room('wc', [6, 0, 0], [[-1, -1], [1, -1], [1, 1], [-1, 1]], 'Toilet')];
  const v = godRoomViews(model(rooms), () => 2);
  assert.deepEqual(v.map((x) => x.label), ['Inside: Dining hall']);
  const [x] = v; assert.equal(x.p[1], 2 + 0.5 + 1.65); assert.ok(x.target[1] < x.p[1]);
  // yaw π/2: building-local +x runs to world -z; the room's long side (local x, 10 m) maps to world z ∈ [-10, 0]
  for (const q of [x.p, x.target]) { assert.ok(Math.abs(q[0] - 10) < 2.01, `x ${q[0]}`); assert.ok(q[2] >= -10 && q[2] <= 0, `z ${q[2]}`); }
  assert.ok(Math.abs(x.p[2] - x.target[2]) > 5, 'looks down the long side');
});
test('unlabelled rooms are named after their building, duplicates and non-room slots skipped', () => {
  const v = godRoomViews(model([room('ground', [0, 0, 0], [[-3, -3], [3, -3], [3, 3], [-3, 3]]), room('ground-2', [0, 0, 0], [[-3, -3], [3, -3], [3, 3], [-3, 3]], 'Mess hall ground')], undefined, 2), () => 0);
  assert.deepEqual(v.map((x) => x.label), ['Inside: mess hall ground']);
});
test('a one-room building (a classroom hall) is pictured from inside its room at eye height; travel keeps the outside view', () => {
  const hall = (rooms: ReturnType<typeof room>[], editSeq: number) => { const l = model(rooms, undefined, editSeq); return { model: { ...l.model, footprint: () => [{ c: [10, -5] as [number, number], half: [8, 9.5] as [number, number], y0: 0, y1: 2.6 }] } }; };
  const one = hall([room('classroom', [0, 0.1, 0], [[-7.8, -9.3], [7.8, -9.3], [7.8, 9.3], [-7.8, 9.3]], 'Classroom')], 101);
  const [v] = godTourViews(one, () => 0), [r] = godRoomViews(one, () => 0);
  assert.ok(v.inside, 'one-room building has an inside eye');
  assert.deepEqual(v.inside, { p: r.p, target: r.target }, 'same eye as its "Inside:" room view');
  assert.ok(v.p[1] > 5, 'travel/broadcast view stays the elevated outside one');
  const two = hall([room('a', [0, 0.1, 0], [[-7.8, -9.3], [7.8, -9.3], [7.8, 9.3], [-7.8, 9.3]]), room('b', [0, 3.7, 0], [[-7.8, -9.3], [7.8, -9.3], [7.8, 9.3], [-7.8, 9.3]])], 102);
  assert.equal(godTourViews(two, () => 0)[0].inside, undefined, 'a building of several rooms keeps its outside picture');
});
