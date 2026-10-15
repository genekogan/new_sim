import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CORE_KIT, WorldModel, applyBatch, type Refused } from './index.ts';

function fresh(two = false) {
  const w = new WorldModel({ constants: { ground: 'land' }, seed: 'seal' });
  for (const d of CORE_KIT) w.defineDef(d, 'core', 0);
  if (two) w.defineDef({ ...CORE_KIT.find(d => d.name === 'core-church')!, name: 'two-door-church', contents: [] }, 'god', 0);
  const params = two ? { w: 10, d: 12, plan: { floors: [{ rooms: [{ id: 'nave', rect: [0, 0, 10, 12] }], exterior: [{ room: 'nave', wall: 's', kind: 'door' }, { room: 'nave', wall: 'n', kind: 'door' }] }] } } : {};
  const r = applyBatch(w, { ops: [{ op: 'place', def: two ? 'two-door-church@1' : 'core/church@1', name: 'church', p: [0, 0], params }] }, 'god', 0);
  assert.equal(r.result.accepted, true, JSON.stringify(r.result));
  const e = w.get('church')!, b = w.bake(w.resolvedDef(e.def)!, e.params ?? {}, 0), door = b.openings!.find(o => o.to === 'outside' && o.kind !== 'window')!;
  const wp = w.worldPose(e), p = [wp.x + door.at[0] + Math.sin(door.yaw) * 0.75, wp.y + 0.1, wp.z + door.at[1] + Math.cos(door.yaw) * 0.75];
  // A plain solid kit, deliberately wide enough to span the entrance.
  const def = { schema: 'def/1', name: 'door-crate', layer: 'solid', size: { box: [2.5, 2, 1] }, make: { kind: 'gen', gen: 'kit/2', args: { shapes: [{ kind: 'box', at: [0, 1, 0], size: [2.5, 2, 1], collide: true }] } } };
  const defined = applyBatch(w, { ops: [{ op: 'define', def }] }, 'god', 0).result;
  assert.equal(defined.accepted, true, JSON.stringify(defined));
  return { w, p, door };
}

test('church last exterior door: crate refused with building, room, opening and repair', () => {
  const { w, p, door } = fresh();
  const r = applyBatch(w, { ops: [{ op: 'place', def: 'door-crate@1', p }] }, 'god', 1);
  assert.equal(r.result.accepted, false);
  const f = (r.result as Refused).failures[0];
  assert.equal(f.code, 'architecture.sealed');
  assert.match(f.detail, /church.*room nave/); assert.ok(f.detail.includes(door.id)); assert.match(f.fix!, /0.75 m wide/);
});

test('same crate three metres aside leaves the exterior route open', () => {
  const { w, p } = fresh(); p[0] += 3;
  const first = applyBatch(w, { ops: [{ op: 'place', def: 'door-crate@1', p }] }, 'god', 1).result;
  assert.equal(first.accepted, true, JSON.stringify(first));
});

test('two exterior doors: one blocked is allowed, the last one is refused', () => {
  const { w, p } = fresh(true);
  const first = applyBatch(w, { ops: [{ op: 'place', def: 'door-crate@1', p }] }, 'god', 1).result;
  assert.equal(first.accepted, true, JSON.stringify(first));
  const opposite = [p[0], p[1], -p[2]];
  const r = applyBatch(w, { ops: [{ op: 'place', def: 'door-crate@1', p: opposite }] }, 'god', 2);
  assert.equal((r.result as Refused).failures?.[0].code, 'architecture.sealed');
});

test('moving an existing solid into the last entrance is refused atomically', () => {
  const { w, p } = fresh();
  assert.equal(applyBatch(w, { ops: [{ op: 'place', def: 'door-crate@1', name: 'crate', p: [p[0] + 3, p[1], p[2]] }] }, 'god', 1).result.accepted, true);
  const before = w.snapshot();
  const r = applyBatch(w, { ops: [{ op: 'move', id: 'crate', p }] }, 'god', 2);
  assert.equal((r.result as Refused).failures?.[0].code, 'architecture.sealed'); assert.deepEqual(w.snapshot(), before);
});
test('solid colliders on the surface layer also protect the last entrance', () => {
  const { w, p } = fresh();
  const d = w.def('door-crate@1')!;
  w.defineDef({ ...d, name: 'surface-crate', layer: 'surface' }, 'god', 0);
  const r = applyBatch(w, { ops: [{ op: 'place', def: 'surface-crate@1', p }] }, 'god', 2).result;
  assert.equal((r as Refused).failures?.[0].code, 'architecture.sealed');
});

test('far-away batch evaluates no unrelated building or surface footprints', t => {
  const {w} = fresh();
  const placed = applyBatch(w, {ops: [
    {op: 'place', def: 'core/church@1', name: 'far-church', p: [150, 150]},
    {op: 'place', def: 'core/plaza@1', name: 'far-surface', shape: {area: [[100,100],[110,100],[110,110],[100,110]]}},
  ]}, 'god', 1).result;
  assert.equal(placed.accepted, true, JSON.stringify(placed));
  const originalBake = WorldModel.prototype.bake, originalFootprint = WorldModel.prototype.footprint;
  let buildings = 0, surfaces = 0;
  t.mock.method(WorldModel.prototype, 'bake', function(this: WorldModel, ...args: Parameters<WorldModel['bake']>) {if (args[0].ref === 'core-church@1') buildings++; return originalBake.apply(this, args);});
  t.mock.method(WorldModel.prototype, 'footprint', function(this: WorldModel, ...args: Parameters<WorldModel['footprint']>) {if (args[0].name === 'far-surface') surfaces++; return originalFootprint.apply(this, args);});
  const r = applyBatch(w, {ops: [{op: 'place', def: 'door-crate@1', p: [-200, -200]}]}, 'god', 2).result;
  assert.equal(r.accepted, true, JSON.stringify(r)); assert.equal(buildings, 0); assert.equal(surfaces, 0);
  const next = applyBatch(w, {ops: [{op: 'place', def: 'door-crate@1', p: [-190, -200]}]}, 'god', 3).result;
  assert.equal(next.accepted, true, JSON.stringify(next)); assert.equal(buildings, 0); assert.equal(surfaces, 0);
});

test('upserted building moving onto an existing doorway blocker still refuses', () => {
  const {w, p} = fresh();
  assert.equal(applyBatch(w, {ops: [{op: 'place', def: 'door-crate@1', p: [p[0]+30, p[1], p[2]]}]}, 'god', 1).result.accepted, true);
  const r = applyBatch(w, {ops: [{op: 'move', id: 'church', p: [30, 0]}]}, 'god', 2).result as Refused;
  assert.equal(r.failures?.[0].code, 'architecture.sealed');
});

test('legacy sealed room remains editable and removing its blocker repairs the cached route', () => {
  const {w, p} = fresh();
  const e = {id: 'legacy-blocker', def: 'door-crate@1', in: {parent: 'world'}, p: p as [number,number,number], by: 'fixture', born: 0, v: 1};
  w.insert(e); w.index(e.id, w.footprint(e));
  assert.equal(applyBatch(w, {ops: [{op: 'set', id: 'church', name: 'legacy-church'}]}, 'god', 1).result.accepted, true);
  assert.equal(applyBatch(w, {ops: [{op: 'remove', id: e.id}]}, 'god', 2).result.accepted, true);
  const r = applyBatch(w, {ops: [{op: 'place', def: e.def, p}]}, 'god', 3).result as Refused;
  assert.equal(r.failures?.[0].code, 'architecture.sealed');
});
