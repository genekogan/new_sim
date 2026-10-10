// Solver unit tests (29 WP5): near / facing / against / inside / on / along / between / row / grid / float.
//   node --test tools/god-skill/lib/solver.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solve, refPoint, blockers, yawOf, compassOfYaw, circleArea, pointAlong } from './solver.mjs';

const row = (o) => ({ parent: 'world', layer: 'solid', form: 'point', tags: [], pose: [0, 0, 0, 0, 1], box: [1, 1, 1], ...o, aabb: o.aabb ?? aabb(o), obbs: o.obbs ?? (o.layer === 'decor' || (o.form ?? 'point') !== 'point' ? undefined : [[o.pose?.[0] ?? 0, o.pose?.[2] ?? 0, (o.box?.[0] ?? 1) / 2, (o.box?.[2] ?? 1) / 2, o.pose?.[3] ?? 0, 0, o.box?.[1] ?? 1]]) });
function aabb(o) { const p = o.pose ?? [0, 0, 0, 0, 1], b = o.box ?? [1, 1, 1]; const c = Math.abs(Math.cos(p[3])), s = Math.abs(Math.sin(p[3])); const hx = (b[0] / 2) * c + (b[2] / 2) * s, hz = (b[0] / 2) * s + (b[2] / 2) * c; return [p[0] - hx, p[2] - hz, p[0] + hx, p[2] + hz]; }
const mkView = (rows, extent = 1000) => { const byId = new Map(rows.map((r) => [r.id, r])), byPath = new Map(rows.map((r) => [r.path, r])); return { rows, byId, byPath, extent, get: (ref) => byId.get(ref) ?? byPath.get(String(ref).replace(/^flag:/, '')) ?? rows.find((r) => r.name === String(ref).replace(/^flag:/, '')) ?? null }; };
const first = (s, k = 0) => s.items[k].candidates[0];

const fountain = row({ id: 'e_f', path: 'fountain', name: 'fountain', def: 'core-fountain@1', pose: [10, 0, 10, 0, 1], box: [4, 1.2, 4] });
const house = row({ id: 'e_h', path: 'house', name: 'house', def: 'core/house@1', pose: [40, 0, 0, Math.PI / 2, 1], box: [8, 5, 6], slots: [{ id: 'kitchen', kind: 'room', p: [40, 0.05, 0], yaw: Math.PI / 2, capacity: 64, used: 0, local: [[-3.8, -2.8], [3.8, -2.8], [3.8, 2.8], [-3.8, 2.8]] }] });
const table = row({ id: 'e_t', path: 'house/table', name: 'table', parent: 'e_h', slot: 'kitchen', def: 'core-table@1', pose: [40, 0.05, 0, Math.PI / 2, 1], box: [1.2, 0.75, 0.8], slots: [{ id: 'top', kind: 'surface', p: [40, 0.8, 0], yaw: 0, capacity: 4, used: 1 }] });
const road = row({ id: 'e_r', path: 'road', name: 'road', def: 'core/road@1', form: 'path', layer: 'surface', shape: { path: [[-50, 30], [50, 30]], width: 6 }, aabb: [-53, 27, 53, 33] });
const pond = row({ id: 'e_p', path: 'pond', name: 'pond', def: 'core-pond@1', form: 'area', layer: 'volume', shape: { area: [[-40, -40], [-20, -40], [-20, -20], [-40, -20]] }, aabb: [-40, -40, -20, -20], water: -0.3 });
const flagA = row({ id: 'e_a', path: 'a', name: 'a', def: 'core-flag@1', layer: 'decor', pose: [-10, 0, 0, 0, 1], box: [0.1, 3, 0.1] });
const flagB = row({ id: 'e_b', path: 'b', name: 'b', def: 'core-flag@1', layer: 'decor', pose: [10, 0, 0, 0, 1], box: [0.1, 3, 0.1] });
const v = mkView([fountain, house, table, road, pond, flagA, flagB]);
const bench = { def: 'core/bench@1', form: 'point', layer: 'solid', box: [1.6, 0.45, 0.5] };

test('yaw convention: front +z at 0; atan2(dx, dz); compass words', () => {
  assert.equal(compassOfYaw(0), 's'); assert.equal(compassOfYaw(Math.PI / 2), 'e'); assert.equal(compassOfYaw(Math.PI), 'n'); assert.equal(compassOfYaw(-Math.PI / 2), 'w');
  assert.ok(Math.abs(yawOf(1, 0) - Math.PI / 2) < 1e-9);
  assert.deepEqual(refPoint(v, '3,4'), { x: 3, z: 4, kind: 'point' });
  const east = refPoint(v, 'east'); assert.ok(east.x > 300 && east.z === 0);
});

test('near + facing: outside the ref footprint, clear of it, turned toward it, constraints written', () => {
  const s = solve(v, bench, { near: 'fountain', facing: 'fountain' });
  const c = first(s);
  const d = Math.hypot(c.p[0] - 10, c.p[1] - 10);
  assert.ok(d > 2 + 0.25 && d < 2 + 6, `distance ${d}`);
  assert.equal(blockers(v, { c: c.p, half: [0.8, 0.25], yaw: c.r }).length, 0);
  const want = Math.atan2(10 - c.p[0], 10 - c.p[1]);
  const dd = Math.abs(Math.atan2(Math.sin(want - c.r), Math.cos(want - c.r))); assert.ok(dd < 0.02, `faces the fountain (${want} vs ${c.r})`);
  assert.ok(c.constraints.some((k) => k.kind === 'facing' && k.ref === 'fountain'));
  assert.ok(c.constraints.some((k) => k.kind === 'near' && k.ref === 'fountain'));
});

test('near with count: evenly around the ref, all distinct and free', () => {
  const s = solve(v, bench, { near: 'fountain', count: 4, facing: 'fountain', dist: 1 });
  assert.equal(s.items.length, 4);
  const ps = s.items.map((it) => it.candidates[0].p);
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) assert.ok(Math.hypot(ps[i][0] - ps[j][0], ps[i][1] - ps[j][1]) > 2);
});

test('against: back flush to the named side, facing away', () => {
  const s = solve(v, { def: 'shed', form: 'point', layer: 'solid', box: [2, 2, 2] }, { against: 'fountain.n' });
  const c = first(s);
  assert.ok(Math.abs(c.p[0] - 10) < 0.01 && Math.abs(c.p[1] - (10 - 2 - 1 - 0.05)) < 0.01, JSON.stringify(c.p));
  assert.equal(compassOfYaw(c.r), 'n');
});

test('inside a room: local frame, inside the polygon, corner and wall placement, clear of the table', () => {
  const chair = { def: 'core/chair@1', form: 'point', layer: 'solid', box: [0.5, 0.45, 0.5] };
  const c = first(solve(v, chair, { inside: 'house/kitchen' }));
  assert.deepEqual(c.in, { parent: 'house', slot: 'kitchen' });
  assert.ok(Math.abs(c.p[0]) < 3.5 && Math.abs(c.p[1]) < 2.5);
  assert.ok(Math.hypot(c.p[0], c.p[1]) > 0.5, `not on top of the table at the room centre ${JSON.stringify(c)}`);
  // ne corner in world terms: house yaw π/2 → room local axes rotated; world NE = (+x, −z)
  const k = first(solve(v, chair, { inside: 'house/kitchen', corner: 'ne' }));
  const [wx, wz] = [40 + k.p[0] * Math.cos(Math.PI / 2) + k.p[1] * Math.sin(Math.PI / 2), 0 - k.p[0] * Math.sin(Math.PI / 2) + k.p[1] * Math.cos(Math.PI / 2)];
  assert.ok(wx > 40 && wz < 0, `world ${wx},${wz}`);
  const w = first(solve(v, { def: 'shelf', form: 'point', layer: 'solid', box: [1.6, 2, 0.4] }, { inside: 'house/kitchen', wall: 'n' }));
  assert.ok(w.constraints.some((x) => x.kind === 'inside'));
  assert.throws(() => solve(v, chair, { inside: 'house/attic' }), /no room attic/);
  assert.throws(() => solve(v, chair, { inside: 'fountain' }), /no rooms/);
});

test('on: a free surface slot', () => {
  const c = first(solve(v, { def: 'core/bowl@1', form: 'point', layer: 'solid', box: [0.25, 0.1, 0.25] }, { on: 'house/table' }));
  assert.deepEqual(c.in, { parent: 'house/table', slot: 'top' });
});

test('along a road: left/right sides, setback, facing the road, along constraint; rows step along it', () => {
  const s = solve(v, { def: 'house', form: 'point', layer: 'solid', box: [8, 5, 6] }, { along: 'road', t: 0.5, side: 'left', setback: 3 });
  const c = first(s);
  // road runs west→east at z=30; walker's left is north (−z): 3 m half-width + 3 m half-depth + 3 setback = 9
  assert.ok(Math.abs(c.p[0]) < 0.01 && Math.abs(c.p[1] - (30 - 9)) < 0.01, JSON.stringify(c.p));
  assert.equal(compassOfYaw(c.r), 's', 'faces the road');
  assert.ok(c.constraints.some((k) => k.kind === 'along' && k.side === 'right' && k.offset === 6), JSON.stringify(c.constraints));
  const trees = solve(v, { def: 'tree', form: 'point', layer: 'solid', box: [0.6, 7, 0.6] }, { along: 'road', side: 'both', row: 5, gap: 10 });
  assert.equal(trees.items.length, 10);
  assert.ok(trees.items.slice(0, 5).every((it) => it.candidates[0].p[1] < 30) && trees.items.slice(5).every((it) => it.candidates[0].p[1] > 30));
  assert.equal(pointAlong([[0, 0], [10, 0]], 0.3).p[0], 3);
});

test('between two flags; path defs get a shape from ref edges', () => {
  const c = first(solve(v, bench, { between: ['a', 'b'] }));
  assert.deepEqual(c.p, [0, 0]);
  const p = first(solve(v, { def: 'road', form: 'path', layer: 'surface', box: [1, 1, 1] }, { from: 'fountain', to: 'b', width: 4 }));
  assert.equal(p.shape.path.length, 2); assert.equal(p.shape.width, 4);
  assert.ok(Math.hypot(p.shape.path[0][0] - 10, p.shape.path[0][1] - 10) > 2, 'starts at the fountain edge, not its centre');
});

test('row and grid around a point; float spreads inside a pond', () => {
  const r = solve(v, { def: 'house', form: 'point', layer: 'solid', box: [8, 5, 6] }, { at: '0,-100', row: 3, gap: 4, yaw: 0 });
  assert.deepEqual(r.items.map((it) => it.candidates[0].p[0]), [-12, 0, 12]);
  const g = solve(v, bench, { at: '0,-200', grid: '2x2', gap: 1 });
  assert.equal(g.items.length, 4);
  const ducks = solve(v, { def: 'duck', form: 'point', layer: 'solid', box: [0.4, 0.4, 0.6] }, { at: 'pond', float: true, count: 5 });
  assert.equal(ducks.items.length, 5);
  for (const it of ducks.items) { const [x, z] = it.candidates[0].p; assert.ok(x > -40 && x < -20 && z > -40 && z < -20); assert.equal(it.candidates[0].anchor, 'float'); }
  assert.equal(circleArea('0,0,10').length, 10);
});
