import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kitArgs, kitPhysics } from './kit.ts';
import { expandKitProgram } from './kit-program.ts';
import { footprintToBaked, kitFootprintIssues, type LmFootprint } from './kit-footprint.ts';

const roof = { kind: 'box', at: [0, 3.1, 0], size: [6, 0.2, 6], collide: true };
const posts = [-2.8, 2.8].flatMap(x => [-2.8, 2.8].map(z => ({ kind: 'box', at: [x, 1.5, z], size: [0.2, 3, 0.2] })));
const bake = (extra: Record<string, unknown> = {}) => kitPhysics(kitArgs.parse({ shapes: [...posts, roof], footprint: 'open', ...extra }));
const inline = (): LmFootprint => ({
  schema: 'lm-building-footprint/1', levels: [{ id: 0, y: 0 }],
  rooms: [{ id: 'hall', label: 'Hall', level: 0, y0: 0, y1: 3, polygon: [[-3, -3], [3, -3], [3, 3], [-3, 3]] }],
  portals: [{ id: 'front-door', kind: 'door', level: 0, center: [0, 1, 3], normal: [0, 0, 1], width: 1.5, y0: 0, y1: 2.4 }],
});

test('open kit has one ground room, four outside entrances and an outside stand', () => {
  const b = bake();
  assert.equal(b.rooms?.length, 1); assert.equal(b.rooms![0].id, 'ground');
  assert.deepEqual(b.rooms![0].polygon, [[-3, -3], [3, -3], [3, 3], [-3, 3]]);
  assert.equal(b.surfaces?.length, 1); assert.equal(b.openings?.length, 4);
  assert.ok(b.openings!.every(o => o.from === 'ground' && o.to === 'outside'));
  assert.ok(b.slots.some(s => s.id === 'front' && s.kind === 'stand'));
  assert.deepEqual(kitFootprintIssues(b), []);
});

test('omitting footprint preserves the old bake; opt-in keeps a many-post interior hollow', () => {
  const shapes = [...Array.from({ length: 16 }, (_, i) => ({ kind: 'box', at: [-3 + i * 0.4, 1.5, -3], size: [0.1, 3, 0.1] })), roof];
  const old = kitPhysics(kitArgs.parse({ shapes }));
  assert.equal(old.colliders.length, 1); assert.equal(old.rooms, undefined);
  const open = bake({ shapes }); assert.equal(open.colliders.length, 17);
  assert.deepEqual(kitFootprintIssues(open), []);
});

test('v2 programs preserve and validate authored footprints after expansion', () => {
  for (const footprint of ['open', inline()] as const) {
    const args = { v: 2, footprint, shapes: [
      { kind: 'box', at: [-2.8, 1.5, -2.8], size: [0.2, 3, 0.2], repeat: { n: '$count', step: [5.6, 0, 0] } },
      roof,
    ] };
    const expanded = expandKitProgram(args, { count: 2 });
    assert.equal(expanded.v, 2);
    assert.deepEqual(expanded.footprint, footprint);
    const b = kitPhysics(args, { count: 2 });
    assert.equal(b.rooms?.length, 1);
    assert.deepEqual(kitFootprintIssues(b), []);
    assert.equal(kitArgs.safeParse({ ...args, footprint: { ...inline(), levels: [{ id: 1, y: 3 }] } }).success, false);
  }
});

test('off-centre kits keep the room and its slot in the actual shape frame', () => {
  const b = bake({ shapes: [{ kind: 'box', at: [8, 3, -7], size: [6, 0.2, 4] }] });
  assert.deepEqual(b.rooms![0].origin, [8, -7]);
  assert.deepEqual(b.slots.find(s => s.kind === 'room')!.p, [8, 0, -7]);
  assert.deepEqual(kitFootprintIssues(b), []);
});

test('inline footprints use the existing converter and add obstacles without erasing kit solids or seats', () => {
  const fp = inline(); fp.obstacles = [{ id: 'pillar', kind: 'post', obb: { c: [-2, 0], half: [0.2, 0.2], yaw: 0.3 }, y0: 0, y1: 3 }];
  const converted = footprintToBaked(fp), b = bake({ footprint: fp, slots: [{ id: 'bench', kind: 'seat', p: [0, 0.5, 0] }] });
  assert.deepEqual(b.rooms, converted.rooms);
  assert.equal(b.colliders.length, posts.length + 2); assert.ok(b.slots.some(s => s.id === 'bench'));
  assert.equal(b.openings![0].from, 'hall'); assert.equal(b.openings![0].to, 'outside');
  assert.deepEqual(kitFootprintIssues(b), []);
});

test('sealed rooms, falsely declared doors and low clearHeight/headroom are refused', () => {
  const closed = inline(); closed.portals = [];
  assert.equal(kitFootprintIssues(bake({ footprint: closed }))[0].code, 'architecture.sealed');
  const blocked = bake({ footprint: inline(), shapes: [...posts, roof, { kind: 'box', at: [0, 1.5, 3], size: [6, 3, 0.2] }] });
  assert.equal(kitFootprintIssues(blocked)[0].code, 'architecture.sealed');
  const low = inline(); low.rooms![0].clearHeight = 1.8;
  assert.equal(kitFootprintIssues(bake({ footprint: low }))[0].code, 'architecture.headroom');
  assert.equal(kitFootprintIssues(bake(), 0.5)[0].code, 'architecture.headroom');
});

test('a wall enclosing the walk target is unreachable despite an exterior opening', () => {
  const shapes = [roof, ...[-1, 1].flatMap(x => [
    { kind: 'box', at: [x, 1.5, 0], size: [0.1, 3, 2.1] },
    { kind: 'box', at: [0, 1.5, x], size: [2.1, 3, 0.1] },
  ])];
  assert.equal(kitFootprintIssues(bake({ shapes }))[0].code, 'architecture.unreachable');
});

test('ground rooms connect through real internal doors, including reversed exterior normals', () => {
  const fp = inline();
  fp.rooms = [
    { ...fp.rooms![0], id: 'west', polygon: [[-3, -3], [0, -3], [0, 3], [-3, 3]] },
    { ...fp.rooms![0], id: 'east', polygon: [[0, -3], [3, -3], [3, 3], [0, 3]] },
  ];
  fp.portals = [
    { ...fp.portals![0], id: 'front', center: [-3, 1, 0], normal: [1, 0, 0] },
    { ...fp.portals![0], id: 'between', center: [0, 1, 0], normal: [1, 0, 0] },
  ];
  const b = bake({ footprint: fp }); assert.deepEqual(kitFootprintIssues(b), []);
  assert.equal(b.openings![0].from, 'west'); assert.equal(b.openings![0].to, 'outside');
  const blocked = bake({ footprint: fp, shapes: [roof, { kind: 'box', at: [-1.25, 1.5, 0], size: [0.1, 3, 6.1] }] });
  assert.ok(kitFootprintIssues(blocked).some(i => i.code === 'architecture.unreachable' && i.detail.startsWith('east:')));
});

test('room claims cannot extend beyond the kit floor to bypass its measured bounds', () => {
  const fp = inline(); fp.rooms![0].polygon[0][0] = -300;
  assert.throws(() => bake({ footprint: fp }), /outside the kit floor bounds/);
});

test('inline input rejects malformed numbers, duplicate room ids and unsupported upper levels', () => {
  for (const footprint of [false, null, {}, { ...inline(), schema: 'other' },
    { ...inline(), levels: [{ id: 1, y: 3 }] },
    { ...inline(), rooms: [...inline().rooms!, ...inline().rooms!] },
    { ...inline(), portals: [{ ...inline().portals![0], width: NaN }] },
    { ...inline(), rooms: [{ ...inline().rooms![0], polygon: [[0, 0], [0, 0], [0, 0]] }] },
  ]) assert.equal(kitArgs.safeParse({ shapes: [roof], footprint }).success, false, JSON.stringify(footprint));
  assert.throws(() => bake({ slots: [{ id: 'ground', kind: 'seat', p: [0, 0.5, 0] }] }), /conflicts with a footprint room/);
});
