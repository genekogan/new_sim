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
  const q = (x: Parameters<typeof runQuery>[1]) => runQuery(god.model, x) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const R = q({ bake: { def: 'test-house@1' } }).bake.rooms[0].id as string;   // building/1's first ground-floor room (L2 plans name rooms)
  return { god, act, q, R };
}

test('layout: world-frame poses, bounds, solid colliders, room and surface slots', () => {
  const { act, q, R } = world();
  act([{ op: 'place', tmp: '$h', def: 'test-house@1', name: 'house', p: [20, 0], r: Math.PI / 2 }, { op: 'place', def: 'core/table@1', name: 'table', in: { parent: '$h', slot: R }, p: [0, 0] }, { op: 'place', def: 'core/pond@1', name: 'pond', shape: { area: [[-30, -30], [-10, -30], [-10, -10], [-30, -10]] } }]);
  const lay = q({ layout: true }).layout;
  const house = lay.entities.find((e: { path: string }) => e.path === 'house'), table = lay.entities.find((e: { path: string }) => e.path === 'house/table'), pond = lay.entities.find((e: { path: string }) => e.path === 'pond');
  assert.equal(house.pose[0], 20); assert.ok(house.obbs.length >= 4, 'wall segments, not a block');
  const room = house.slots.find((s: { kind: string; id: string }) => s.kind === 'room' && s.id === R);
  assert.ok(room.polygon.length >= 4); assert.equal(room.used, 1);
  assert.equal(table.parent, house.id); assert.equal(table.slot, R); assert.ok(Math.abs(table.pose[0] - 20) < 0.01);
  assert.ok(table.slots.some((s: { kind: string }) => s.kind === 'surface'));
  assert.equal(typeof pond.water, 'number'); assert.deepEqual(pond.aabb, [-30, -30, -10, -10]);
});

test('bake: a def at params without placing it', () => {
  const { q } = world();
  const b = q({ bake: { def: 'test-house@1', params: { w: 12, floors: 2 } } }).bake;
  assert.equal(b.box[0], 12); assert.ok(b.rooms.length >= 2 && b.rooms.some((r: { floor: number }) => r.floor === 1)); assert.ok(b.slots.some((s: { kind: string }) => s.kind === 'room'));
  assert.match(q({ bake: { def: 'nope' } }).bake.error, /def.unknown/);
  const bench = q({ bake: { def: 'bench' } }).bake;
  assert.equal(bench.box.length, 3); assert.equal(bench.box[0], 1.6);   // L4's library bench (with a back)
});

test('describe: rooms with occupants and doors, openings in the world frame, constraints checked, behaviours', () => {
  const { act, q, R } = world();
  act([{ op: 'place', tmp: '$h', def: 'test-house@1', name: 'house', p: [0, 0] }, { op: 'place', def: 'core/chair@1', name: 'chair', in: { parent: '$h', slot: R }, p: [0, 0] }, { op: 'place', def: 'core/fountain@1', name: 'fountain', p: [0, 20] }]);
  act([{ op: 'place', def: 'core/bench@1', name: 'bench', p: [0, 14], constraints: [{ kind: 'facing', ref: 'fountain' }, { kind: 'near', ref: 'fountain', dist: 5 }, { kind: 'inside', ref: `house/${R}` }] }]);
  const d = q({ describe: 'house' }).describe;
  const room = d.rooms.find((r: { id: string }) => r.id === R);
  assert.ok(d.rooms.length >= 1); assert.equal(room.occupants[0].name, 'chair');
  assert.ok(d.rooms.some((r: { doors: string[] }) => r.doors.length >= 1), 'doors belong to rooms');
  const front = d.openings.find((o: { kind: string; faces?: string }) => o.kind === 'door' && o.faces === 's'); assert.ok(front, JSON.stringify(d.openings.slice(0, 3)));
  const b = q({ describe: 'bench' }).describe;
  const byKind = Object.fromEntries(b.constraints.map((c: { kind: string; ok: boolean }) => [c.kind, c.ok]));
  assert.deepEqual(byKind, { facing: true, near: true, inside: false });
  assert.ok(b.behaviours.supported.length === 0 || Array.isArray(b.behaviours.supported));
  assert.match(q({ describe: 'ghost' }).describe.error, /no such entity/);
});

test('where: ground, water, containing things, the room, nearest', () => {
  const { act, q, R } = world();
  act([{ op: 'place', def: 'test-house@1', name: 'house', p: [0, 0] }, { op: 'place', def: 'core/pond@1', name: 'pond', shape: { area: [[-30, -30], [-10, -30], [-10, -10], [-30, -10]] } }]);
  const c = q({ describe: 'house' }).describe.rooms.find((r: { id: string }) => r.id === R);
  const inHouse = q({ where: c.centre ?? c.center ?? [0.5, 0.5] }).where;
  assert.equal(inHouse.room.building, 'house'); assert.ok(inHouse.room.room, JSON.stringify(inHouse.room));
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

test('prepare: roads freeze their grade, rivers their flow, through the same prepare step the compiler uses', () => {
  const { act, q } = world();
  act([{ op: 'define', def: { schema: 'def/1', name: 'q-road', form: 'path', layer: 'surface', make: { kind: 'gen', gen: 'road/1' }, size: { box: [6, 0.1, 6] } } }]);
  act([{ op: 'place', def: 'core/hill@1', name: 'hill', p: [0, 0], params: { height: 12, radius: 40 } }]);
  const r = q({ prepare: { def: 'q-road@1', shape: { path: [[-60, 0], [60, 0]], width: 6 }, params: {} } }).prepare;
  assert.ok(r && r.params && Object.keys(r.params).length > 0, JSON.stringify(r));
  assert.equal(q({ prepare: { def: 'core/bench@1', shape: { path: [[0, 0], [1, 1]] } } }).prepare, null);
  assert.match(q({ prepare: { def: 'nope@1', shape: { path: [[0, 0], [1, 1]] } } }).prepare.error, /def.unknown/);
});

test('bake/describe behaviours: kit creatures report what their roles allow (L4 creatureAbilities)', () => {
  const { act, q } = world();
  const dog = q({ bake: { def: 'core/dog@1' } }).bake.behaviours;
  assert.ok(dog.supported.includes('wander'), JSON.stringify(dog)); assert.match(dog.missing.fly, /wings/);
  const fish = q({ bake: { def: 'core/fish@1' } }).bake.behaviours;
  assert.ok(fish.supported.includes('swim'), JSON.stringify(fish)); assert.match(fish.missing.wander, /legs/);
  act([{ op: 'place', def: 'core/duck@1', name: 'duck', p: [5, 5] }]);
  const duck = q({ describe: 'duck' }).describe.behaviours;
  assert.ok(duck.supported.includes('wander') && duck.gait, JSON.stringify(duck));
});

test('furnish: L2 recipes run on the server and their ops are accepted', () => {
  const { act, q } = world();
  act([{ op: 'place', def: 'core/cottage@1', name: 'home', p: [0, 0], params: { floors: 2 } }]);
  const f = q({ furnish: { ref: 'home' } }).furnish;
  assert.ok(f.ops?.length > 3, JSON.stringify(f).slice(0, 300));
  act(f.ops);
  const beds = q({ describe: 'home' }).describe.rooms.filter((r: { floor: number; occupants: { name: string }[] }) => r.floor === 1 && r.occupants.length);
  assert.ok(beds.length >= 1, 'something upstairs');
  assert.match(q({ furnish: { ref: 'nope' } }).furnish.error, /no such building/);
});

test('free: plots avoid plazas and roads (paved), not just solids and water', () => {
  const { act, q } = world();
  act([{ op: 'place', def: 'core/plaza@1', name: 'square', shape: { area: [[-16, -16], [16, -16], [16, 16], [-16, 16]] } }]);
  const plots = q({ free: { size: [8, 6], near: [0, 0], count: 3 } }).free as { at: [number, number] }[];
  assert.equal(plots.length, 3);
  for (const p of plots) assert.ok(Math.abs(p.at[0]) > 16 || Math.abs(p.at[1]) > 16, JSON.stringify(p));
});
