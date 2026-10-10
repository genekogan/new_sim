// /v1/god/query extensions for the skill (L7): layout, bake, describe, where, resolve.
//   node --test apps/server/src/god/query.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Db } from '../db.ts';
import { GodMode } from './god.ts';
import { runQuery } from './query.ts';

function world() {
  let tick = 1;
  const god = new GodMode(new Db(':memory:'), { worldId: 'q-1', ownerId: null, tick: () => tick++, emit: () => {} });
  const act = (ops: unknown[]) => { const r = god.act({ ops }); assert.equal(r.accepted, true, JSON.stringify(r)); return r; };
  act([{ op: 'define', def: { schema: 'def/1', name: 'test-house', make: { kind: 'gen', gen: 'building/1' }, size: { box: [8, 4, 6] }, tags: ['building'] } }]);
  return { god, act, q: (x: Parameters<typeof runQuery>[1]) => runQuery(god.model, x) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

test('layout: world-frame poses, bounds, solid colliders, room and surface slots', () => {
  const { act, q } = world();
  act([{ op: 'place', tmp: '$h', def: 'test-house@1', name: 'house', p: [20, 0], r: Math.PI / 2 }, { op: 'place', def: 'core/table@1', name: 'table', in: { parent: '$h', slot: 'ground' }, p: [0, 0] }, { op: 'place', def: 'core/pond@1', name: 'pond', shape: { area: [[-30, -30], [-10, -30], [-10, -10], [-30, -10]] } }]);
  const lay = q({ layout: true }).layout;
  const house = lay.entities.find((e: { path: string }) => e.path === 'house'), table = lay.entities.find((e: { path: string }) => e.path === 'house/table'), pond = lay.entities.find((e: { path: string }) => e.path === 'pond');
  assert.equal(house.pose[0], 20); assert.ok(house.obbs.length >= 4, 'wall segments, not a block');
  const room = house.slots.find((s: { kind: string }) => s.kind === 'room');
  assert.equal(room.id, 'ground'); assert.equal(room.polygon.length, 4); assert.equal(room.used, 1);
  assert.equal(table.parent, house.id); assert.equal(table.slot, 'ground'); assert.ok(Math.abs(table.pose[0] - 20) < 0.01);
  assert.ok(table.slots.some((s: { kind: string }) => s.kind === 'surface'));
  assert.equal(typeof pond.water, 'number'); assert.deepEqual(pond.aabb, [-30, -30, -10, -10]);
});

test('bake: a def at params without placing it', () => {
  const { q } = world();
  const b = q({ bake: { def: 'test-house@1', params: { w: 12, floors: 2 } } }).bake;
  assert.equal(b.box[0], 12); assert.equal(b.rooms.length, 2); assert.ok(b.slots.some((s: { kind: string }) => s.kind === 'room'));
  assert.match(q({ bake: { def: 'nope' } }).bake.error, /def.unknown/);
  const bench = q({ bake: { def: 'bench' } }).bake;
  assert.deepEqual(bench.box, [1.6, 0.45, 0.5]);
});

test('describe: rooms with occupants and doors, openings in the world frame, constraints checked, behaviours', () => {
  const { act, q } = world();
  act([{ op: 'place', tmp: '$h', def: 'test-house@1', name: 'house', p: [0, 0] }, { op: 'place', def: 'core/chair@1', name: 'chair', in: { parent: '$h', slot: 'ground' }, p: [1, 0] }, { op: 'place', def: 'core/fountain@1', name: 'fountain', p: [0, 20] }]);
  act([{ op: 'place', def: 'core/bench@1', name: 'bench', p: [0, 14], constraints: [{ kind: 'facing', ref: 'fountain' }, { kind: 'near', ref: 'fountain', dist: 5 }, { kind: 'inside', ref: 'house/ground' }] }]);
  const d = q({ describe: 'house' }).describe;
  assert.equal(d.rooms.length, 1); assert.equal(d.rooms[0].occupants[0].name, 'chair');
  assert.ok(d.rooms[0].doors.length >= 1, 'the front door belongs to the ground room');
  assert.equal(d.openings[0].kind, 'door'); assert.equal(d.openings[0].faces, 's');
  const b = q({ describe: 'bench' }).describe;
  const byKind = Object.fromEntries(b.constraints.map((c: { kind: string; ok: boolean }) => [c.kind, c.ok]));
  assert.deepEqual(byKind, { facing: true, near: true, inside: false });
  assert.ok(b.behaviours.supported.length === 0 || Array.isArray(b.behaviours.supported));
  assert.match(q({ describe: 'ghost' }).describe.error, /no such entity/);
});

test('where: ground, water, containing things, the room, nearest', () => {
  const { act, q } = world();
  act([{ op: 'place', def: 'test-house@1', name: 'house', p: [0, 0] }, { op: 'place', def: 'core/pond@1', name: 'pond', shape: { area: [[-30, -30], [-10, -30], [-10, -10], [-30, -10]] } }]);
  const inHouse = q({ where: [0.5, 0.5] }).where;
  assert.equal(inHouse.room.building, 'house'); assert.equal(inHouse.room.room, 'ground');
  const wet = q({ where: [-20, -20] }).where;
  assert.ok(wet.water && wet.water.depth > 0); assert.ok(wet.inside.some((x: { path: string }) => x.path === 'pond'));
  assert.equal(q({ where: [100, 100] }).where.near[0].path, 'house');
});

test('resolve: violated advisory constraints are listed with reasons', () => {
  const { act, q } = world();
  act([{ op: 'place', def: 'core/fountain@1', name: 'fountain', p: [0, 0] }, { op: 'place', def: 'core/bench@1', name: 'far', p: [40, 0], constraints: [{ kind: 'near', ref: 'fountain', dist: 3 }] }, { op: 'place', def: 'core/rock@1', name: 'rock', p: [-20, -20] }, { op: 'place', def: 'core/flag@1', name: 'square', p: [-20, -20], constraints: [{ kind: 'clear', area: [[-25, -25], [-15, -25], [-15, -15], [-25, -15]] }] }]);
  const r = q({ resolve: true }).resolve;
  assert.equal(r.checked, 2);
  assert.deepEqual(r.violated.map((x: { path: string; kind: string }) => `${x.path}:${x.kind}`).sort(), ['far:near', 'square:clear']);
  assert.match(r.violated.find((x: { kind: string }) => x.kind === 'clear').why, /rock/);
});
