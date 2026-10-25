import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { MarsEngine } from './engine.ts';
import { Spatial } from '../../../mars/viewer/engine/spatial/service.ts';
import { NavConnectivity, type ConnPoint } from '../../../mars/viewer/engine/spatial/connectivity.ts';
import { GROUND_TILE_M, G_WALK, type GroundField } from '../../../mars/viewer/engine/spatial/ground.ts';
import type { SpatialScene } from '../../../mars/viewer/engine/spatial/types.ts';
import { addAll, component, emptyWorld, human } from '../../../mars/viewer/engine/world/factory.ts';

const field: GroundField = {
  id: 'nav-warm-budget-flat', extent: [-64, -64, 64, 64], wadeMax: .6, maxSlope: 1,
  height: () => 0, waterLevel: () => null, medium: () => G_WALK,
  mediaTile: () => new Uint8Array(GROUND_TILE_M * GROUND_TILE_M),
};
const points: ConnPoint[] = [
  { id: 'arrival', p: [0, 0], tol: 1 }, { id: 'across', p: [8, 0], tol: 1 },
  { id: 'wall', p: [4, 0], tol: .1 }, { id: 'upper', level: 1, p: [8, 8], tol: 1 },
];
function fixture(paged: boolean) {
  const base: SpatialScene = {
    bounds: [-16, -16, 16, 16], levels: [{ id: 0, y: 0, label: 'ground' }, { id: 1, y: 3, label: 'upper' }],
    surfaces: [
      { id: 'base', level: 0, y: 0, obb: { c: [0, 0], half: [16, 16], yaw: 0 } },
      { id: 'upper', level: 1, y: 3, obb: { c: [8, 8], half: [3, 3], yaw: 0 } },
    ],
    obstacles: [{ id: 'wall', kind: 'wall', obb: { c: [4, 0], half: [.5, 6], yaw: 0 }, y0: 0, y1: 3 }],
    links: [{ id: 'stairs', kind: 'stairs', from: { level: 0, p: [8, 3], y: 0 }, to: { level: 1, p: [8, 6], y: 3 },
      width: 1.2, heading: Math.PI / 2, path: [[8, 0, 3], [8, 3, 6]], usable: true }],
  };
  const world = addAll(emptyWorld('nav-warm-budget', base), human('person', 0, 0));
  const spatial = new Spatial(base, { cell: 1 }); spatial.sync(world);
  if (paged) spatial.setGround(field, world, [[0, 0]], { paged: true });
  // Exercise the actual adapter method against real spatial/connectivity services without unrelated engine startup.
  const engine = Object.create(MarsEngine.prototype) as MarsEngine;
  Object.assign(engine, { rt: { world, services: { spatial } }, cfg: { arrival: [0, 0] } });
  const connection = () => (engine as unknown as { conn: NavConnectivity }).conn;
  return { engine, world, spatial, connection };
}
function clock(t: TestContext, spatial: Spatial) {
  let now = 0, syncCost = 0;
  t.mock.method(performance, 'now', () => now++);
  const sync = spatial.sync;
  t.mock.method(spatial, 'sync', function (this: Spatial, world: Parameters<Spatial['sync']>[0]) {
    const result = sync.call(this, world); now += syncCost; return result;
  });
  return { cost: (ms: number) => { syncCost = ms; } };
}
function answers(conn: NavConnectivity) {
  return { verdicts: conn.check(points), summary: conn.summary(),
    roots: points.filter(p => !p.level).map(p => conn.rootAt(p.p, p.tol)), rescue: conn.nearestMain([4, 0], 12) };
}
function resume(engine: MarsEngine) {
  let turns = 0;
  while (!engine.navWarmV1(5)) assert.ok(++turns < 10000, 'positive remaining budgets eventually finish');
}

for (const paged of [false, true]) test(`nav warm counts real spatial sync before compilation (${paged ? 'paged' : 'flat'})`, t => {
  const w = fixture(paged), ref = fixture(paged), timer = clock(t, w.spatial);
  timer.cost(25);
  const builds = w.spatial.ground?.stats.fineBuilds;
  assert.equal(w.engine.navWarmV1(20), false);
  const conn = w.connection();
  assert.equal(conn.ready, false);
  assert.equal(conn.stats.updates, 0, 'an expensive sync leaves no compilation allowance');
  assert.equal(w.spatial.ground?.stats.fineBuilds, builds, 'no background fine tiles were built');
  assert.equal(conn.version, '', 'an unbuilt graph is not published');
  for (const budget of [0, -1, NaN]) assert.equal(w.engine.navWarmV1(budget), false);
  assert.equal(conn.stats.updates, 0, 'zero/nonpositive budgets remain polls');
  timer.cost(0); resume(w.engine);
  assert.equal(w.connection(), conn, 'resumption retains the connection');
  assert.ok(conn.stats.updates > 0, 'the real graph compiled');
  assert.equal(ref.engine.navWarmV1(Infinity), true);
  assert.deepEqual(answers(conn), answers(ref.connection()));
  assert.equal(conn.check(points)[2].code, 'nav.no-standing-room', 'the fixture exercises actual obstacles');
  const updates = conn.stats.updates;
  timer.cost(25);
  assert.equal(w.engine.navWarmV1(20), true, 'a current ready graph stays ready even if sync consumes the allowance');
  assert.equal(w.engine.navWarmV1(0), true);
  assert.equal(conn.stats.updates, updates);
});

for (const paged of [false, true]) test(`exhausted nav warm invalidates a changed epoch before resuming (${paged ? 'paged' : 'flat'})`, t => {
  const w = fixture(paged), ref = fixture(paged), timer = clock(t, w.spatial);
  w.engine.navWarmV1(0);
  const conn = w.connection();
  assert.equal(conn.update(Number.MIN_VALUE), false, 'start a real incomplete builder');
  const pending = () => (conn as unknown as { pending?: unknown }).pending;
  assert.ok(pending());
  const epoch = w.spatial.epoch, updates = conn.stats.updates;
  for (const f of [w, ref]) f.world.entities.edit = component('edit', 'test-wall', [0, 0, 4]);
  timer.cost(25);
  assert.equal(w.engine.navWarmV1(20), false);
  assert.ok(w.spatial.epoch > epoch, 'the real spatial sync incorporates the edit');
  assert.equal(pending(), undefined, 'update(0) cancels the stale builder rather than leaving it suspended');
  assert.equal(conn.stats.updates, updates, 'no replacement graph was compiled with an exhausted budget');
  assert.equal(conn.ready, false); assert.equal(conn.version, '');
  timer.cost(0); resume(w.engine);
  assert.equal(ref.engine.navWarmV1(Infinity), true);
  assert.deepEqual(answers(conn), answers(ref.connection()));
  // Invalidate a previously published graph as well: an exhausted poll must not report stale readiness.
  delete w.world.entities.edit; delete ref.world.entities.edit;
  timer.cost(25);
  assert.equal(w.engine.navWarmV1(20), false); assert.equal(conn.ready, false);
  assert.equal(w.engine.navWarmV1(Infinity), true, 'Infinity drains despite the expensive sync');
  assert.equal(ref.engine.navWarmV1(Infinity), true);
  assert.deepEqual(answers(conn), answers(ref.connection()));
});

test('ground replacement remains invalid at zero allowance and public reads still drain the current graph', t => {
  const w = fixture(true), ref = fixture(true), timer = clock(t, w.spatial);
  assert.equal(w.engine.navWarmV1(Infinity), true);
  const conn = w.connection();
  for (const f of [w, ref]) f.spatial.setGround({ ...field, id: 'nav-warm-budget-replaced' }, f.world, [[0, 0]], { paged: true });
  timer.cost(25);
  assert.equal(w.engine.navWarmV1(20), false); assert.equal(conn.ready, false);
  assert.deepEqual(w.engine.navCheckV1(points), ref.engine.navCheckV1(points));
  assert.equal(conn.ready, true, 'the synchronous public reader still finishes current connectivity');
  assert.deepEqual(answers(conn), answers(ref.connection()));
});
