import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NavConnectivity, type ConnPoint } from '../spatial/connectivity.ts';
import { Spatial } from '../spatial/service.ts';
import { GroundNav } from '../spatial/tiled.ts';
import { GROUND_TILE_M, G_WALK, type GroundField } from '../spatial/ground.ts';
import type { Obstacle, SpatialScene } from '../spatial/types.ts';
import { addAll, component, emptyWorld, human } from '../world/factory.ts';

const flat: GroundField = {
  id: 'connectivity-sliced-flat', extent: [-128, -128, 128, 128], wadeMax: 0.6, maxSlope: 1,
  height: () => 0, waterLevel: () => null, medium: () => G_WALK,
  mediaTile: () => new Uint8Array(GROUND_TILE_M * GROUND_TILE_M),
};
function scene(): SpatialScene {
  const wall = (id: string, x: number, z: number, hx: number, hz: number): Obstacle =>
    ({ id, obb: { c: [x, z], half: [hx, hz], yaw: 0 }, y0: 0, y1: 3, kind: 'wall' });
  return {
    bounds: [-128, -128, 128, 128],
    levels: [{ id: 0, y: 0, label: 'ground' }, { id: 1, y: 3, label: 'upper' }],
    surfaces: [
      { id: 'landing', level: 1, y: 3, obb: { c: [10, 11], half: [4, 4], yaw: 0 } },
      { id: 'unreachable-loft', level: 1, y: 3, obb: { c: [-80, -80], half: [4, 4], yaw: 0 } },
    ],
    obstacles: [wall('pocket-n', 30, 35, 5.5, .5), wall('pocket-s', 30, 25, 5.5, .5),
      wall('pocket-e', 35, 30, .5, 5.5), wall('pocket-w', 25, 30, .5, 5.5),
      // More than eight nonuniform tiles exercise eviction before the stairs graph reads its patches.
      ...[-96, -32, 32, 96].flatMap((x, i) => [-96, -32, 96].map((z, j) => wall(`rock-${i}-${j}`, x, z, 1, 1)))],
    links: [{ id: 'stairs', kind: 'stairs', from: { level: 0, p: [10, 3], y: 0 }, to: { level: 1, p: [10, 8], y: 3 },
      width: 1.2, heading: Math.PI / 2, path: [[10, 0, 3], [10, 3, 8]], usable: true }],
  };
}
export function fixture(ground = true, cell = .5) {
  const base = scene(), world = addAll(emptyWorld('connectivity-sliced', base), human('person', 0, 0));
  if (!ground) base.surfaces.unshift({ id: 'base', level: 0, y: 0, obb: { c: [0, 0], half: [128, 128], yaw: 0 } });
  const spatial = new Spatial(base, { cell }); spatial.sync(world);
  if (ground) spatial.setGround(flat, world, [[0, 0]], { paged: true });
  const conn = new NavConnectivity(spatial, { anchors: () => [[0, 0]] });
  return { world, spatial, conn };
}
const points: ConnPoint[] = [
  { id: 'open', p: [0, 0], tol: 1 }, { id: 'pocket', p: [30, 30], tol: 1 },
  { id: 'wall', p: [30, 35], tol: .1 }, { id: 'upstairs', level: 1, p: [10, 11], tol: 1 },
  { id: 'loft', level: 1, p: [-80, -80], tol: 1 }, { id: 'far', p: [110, 110], tol: 1 },
];
export function answers(c: NavConnectivity) {
  return { verdicts: c.check(points), summary: c.summary(), roots: points.filter(p => !p.level).map(p => c.rootAt(p.p, p.tol)),
    rescue: c.nearestMain([30, 30], 20), avoidRescue: c.nearestMain([30, 30], 20, undefined, q => q[0] < 30) };
}
function drainSlices(c: NavConnectivity, between: () => void = () => {}) {
  let slices = 0;
  // Tiny positive budgets force progress one coarse work unit at a time; zero is explicitly a poll.
  while (!c.update(Number.MIN_VALUE)) {
    assert.equal(c.ready, false); between();
    assert.ok(++slices < 10000, 'bounded fixture finishes without restarting its progress');
  }
  return slices;
}

// Frozen from the pre-change d90696fab implementation, executed on Modal focus03 (2026-10-25).
// This is independent of the new synchronous builder; do not regenerate it from the implementation under test.
const legacyGroundHalfMetre = {
  verdicts: [
    { id: 'open', level: 0, ok: true, area: '0:0' },
    { id: 'pocket', level: 0, ok: false, code: 'nav.disconnected', area: '0:11', pocket: 64 },
    { id: 'wall', level: 0, ok: false, code: 'nav.no-standing-room' },
    { id: 'upstairs', level: 1, ok: true, area: 'uddc7cbbfc10dab8e:1:0' },
    { id: 'loft', level: 1, ok: false, code: 'nav.disconnected', area: 'u6623e5918f74cf18:1:0', floor: 'unreachable-loft' },
    { id: 'far', level: 0, ok: true, area: '0:0' },
  ],
  summary: { components: 2, mainArea: 65297, tiles: 16, clusters: 2, connected: 2 },
  roots: [0, 11, -1, 0], rescue: [36.25, 29.75], avoidRescue: [36.25, 29.75],
};
test('connectivity: exact legacy ground verdicts, roots, areas and rescue tie breaking remain fixed', () => {
  const { conn } = fixture(); drainSlices(conn);
  assert.deepEqual(answers(conn), legacyGroundHalfMetre);
});

for (const ground of [true, false]) test(`connectivity ${ground ? 'ground' : 'flat'}: sliced and synchronous builds give identical verdicts, rescue and summary`, () => {
  const sync = fixture(ground), sliced = fixture(ground);
  assert.equal(sync.conn.update(Infinity), true);
  assert.ok(drainSlices(sliced.conn) > 1);
  assert.deepEqual(answers(sliced.conn), answers(sync.conn));
  const v = sliced.conn.check(points);
  assert.equal(v[0].ok, true); assert.equal(v[1].code, 'nav.disconnected');
  assert.equal(v[3].ok, true, 'stairs join the reachable upper floor');
  assert.equal(v[4].code, 'nav.disconnected'); assert.ok(sliced.conn.nearestMain([30, 30], 20));
});

test('connectivity: update(0) does not compile, and public reads drain unfinished work', () => {
  const { conn, spatial } = fixture();
  const before = spatial.ground!.stats.fineBuilds;
  for (let i = 0; i < 3; i++) assert.equal(conn.update(0), false);
  assert.equal(conn.stats.updates, 0); assert.equal(spatial.ground!.stats.fineBuilds, before);
  assert.equal(conn.update(Number.MIN_VALUE), false);
  assert.equal(conn.version, '', 'partial labels are not published'); assert.equal(conn.main, -1);
  const ref = fixture(); ref.conn.update(Infinity);
  assert.deepEqual(conn.check(points), ref.conn.check(points));
  assert.equal(conn.ready, true); assert.equal(conn.update(0), true);
  assert.deepEqual(answers(conn), answers(ref.conn));
});

test('connectivity: static epoch interruption discards partial work without publishing it', () => {
  const w = fixture(), ref = fixture();
  w.conn.update(Infinity); const oldVersion = w.conn.version, oldMain = w.conn.main;
  const move = (f: ReturnType<typeof fixture>, z: number) => {
    f.world.entities.edit = component('edit', 'test-wall', [0, 0, z]); f.spatial.sync(f.world);
  };
  move(w, 4); assert.equal(w.conn.ready, false); assert.equal(w.conn.update(Number.MIN_VALUE), false);
  assert.equal(w.conn.version, oldVersion); assert.equal(w.conn.main, oldMain);
  move(w, 8); move(ref, 8);
  assert.equal(w.conn.update(0), false, 'poll invalidates stale work without starting a new build');
  drainSlices(w.conn); ref.conn.update(Infinity);
  assert.deepEqual(answers(w.conn), answers(ref.conn));
  assert.equal(w.conn.ready, true);
});

test('connectivity: body window movement at the same epoch preserves an in-progress build', () => {
  const w = fixture(), ref = fixture(), epoch = w.spatial.epoch;
  let turns = 0;
  const count = drainSlices(w.conn, () => {
    w.world.entities.person.pose.p = ++turns % 2 ? [100, 0, 100] : [-100, 0, -100];
    w.spatial.sync(w.world); assert.equal(w.spatial.epoch, epoch);
  });
  assert.ok(count > 2); ref.conn.update(Infinity);
  assert.deepEqual(answers(w.conn), answers(ref.conn));
  const builds = w.conn.stats.relabelled;
  w.world.entities.person.pose.p = [70, 0, -70]; w.spatial.sync(w.world);
  assert.equal(w.conn.update(0), true); assert.equal(w.conn.stats.relabelled, builds);
});

test('connectivity: replacing the ground during a pending graph cannot publish the old build', () => {
  const w = fixture(), ref = fixture();
  // Finish the tile stage but interrupt before the graph is complete.
  while (w.conn.stats.clusterBuilds === 0) assert.equal(w.conn.update(Number.MIN_VALUE), false);
  const next = { ...flat, id: 'connectivity-sliced-replacement' };
  w.spatial.setGround(next, w.world, [[0, 0]], { paged: true });
  ref.spatial.setGround(next, ref.world, [[0, 0]], { paged: true });
  assert.equal(w.conn.ready, false); drainSlices(w.conn); ref.conn.update(Infinity);
  assert.deepEqual(answers(w.conn), answers(ref.conn));
});

test('connectivity: same field id with a new cell size cannot reuse old tile labels or link verdicts', () => {
  const w = fixture(), ref = fixture(true, .25);
  w.conn.update(Infinity);
  const prior = w.spatial.ground!;
  // This is a service replacement, not a new terrain recipe: field.id and all static scene inputs stay the same.
  w.spatial.ground = new GroundNav(flat, .25, { paged: true });
  w.spatial.ground.setFloors([]); w.spatial.ground.setSolids(w.spatial.scene.obstacles);
  assert.equal(w.spatial.ground.field.id, prior.field.id);
  assert.notEqual(w.spatial.ground.per, prior.per);
  assert.equal(w.conn.ready, false); drainSlices(w.conn); ref.conn.update(Infinity);
  assert.deepEqual(answers(w.conn), answers(ref.conn));
});
