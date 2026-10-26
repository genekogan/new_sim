import test from 'node:test';
import assert from 'node:assert/strict';
import { MarsEngine } from './engine.ts';
import { legacyPreviewCarrier } from './carrier-preview-reference.fixture.ts';
import { nextEntityPhysics, type WorldEditV1 } from './entity-physics.ts';
import { Spatial } from '../../../mars/viewer/engine/spatial/service.ts';
import { entityPhysicsContribution } from '../../../mars/viewer/engine/spatial/edits.ts';
import { G_WALK, G_SWIM, G_STEEP, G_OUTSIDE, type GroundField } from '../../../mars/viewer/engine/spatial/ground.ts';
import type { SpatialScene, Obstacle } from '../../../mars/viewer/engine/spatial/types.ts';
import { cellOf } from '../../../mars/viewer/engine/spatial/grid.ts';
import { emptyWorld, human, component } from '../../../mars/viewer/engine/world/factory.ts';
import { carrierEntity, type CarrierInstallSpec } from '../../../mars/viewer/engine/vehicles/carrier.ts';
import { canonicalEntityOrder } from '../../../mars/viewer/engine/runtime/runtime.ts';
import { HUMAN_RADIUS, CATALOG } from '../../../mars/viewer/engine/world/catalog.ts';
import { hashOf } from '../../../mars/viewer/engine/core/hash.ts';
import { dcos, dsin, type Vec2 } from '../../../mars/viewer/engine/core/math.ts';

const spec = (at: Vec2 = [320, 0], extra: Partial<CarrierInstallSpec> = {}): CarrierInstallSpec =>
  ({ id: 'test-balloon', def: 'hot-air-balloon', at, route: 'commons-hop', ...extra });
function field(wet = false): GroundField {
  const medium = (x: number, z: number) => x < -128 || x >= 512 || z < -128 || z >= 128 ? G_OUTSIDE
    : wet && x >= 310 && x < 330 ? G_SWIM : z >= 60 ? G_STEEP : G_WALK;
  return { id: `carrier-point-${wet}`, extent: [-128, -128, 512, 128], wadeMax: .6, maxSlope: 1,
    height: () => 0, waterLevel: (x, z) => medium(x, z) === G_SWIM ? 2 : null, medium,
    mediaTile: (tx, tz) => Uint8Array.from({ length: 4096 }, (_, i) => medium(tx * 64 + i % 64 + .5, tz * 64 + Math.floor(i / 64) + .5)) };
}
function fixture(paged = true, legacy = false, wet = false) {
  const scene: SpatialScene = { bounds: [-64, -64, 64, 64], levels: [{ id: 0, y: 0, label: 'ground' }],
    surfaces: [{ id: 'base', level: 0, y: 0, obb: { c: [0, 0], half: [64, 64], yaw: 0 } }], obstacles: [], links: [] };
  const world = emptyWorld('carrier-preview', scene); world.entities.anchor = human('anchor', 0, 0);
  const spatial = new Spatial(scene, { cell: .25, source: { scene, id: 'carrier-preview-base' }, contributors: [entityPhysicsContribution] });
  if (paged) spatial.setGround(field(wet), world, [], { paged: true }); else spatial.sync(world);
  // Exercise actual adapter methods with their real geometry, catalogue, physics fold and world dependencies.
  // No engine loop/factory/HTTP is needed for this synchronous admission boundary.
  const engine = Object.create(MarsEngine.prototype) as MarsEngine;
  Object.assign(engine, { rt: { world, tick: 0, services: { spatial } }, m: { carrierEntity, canonicalEntityOrder },
    out: { changes: [] }, renderScene: () => undefined });
  if (legacy) engine.previewCarrierV1 = legacyPreviewCarrier.bind(engine);
  return { engine, world, spatial };
}
function pair(paged = true, wet = false) { return { now: fixture(paged, false, wet), old: fixture(paged, true, wet) }; }
function compare(p: ReturnType<typeof pair>, s: CarrierInstallSpec) {
  const before = hashOf(p.now.world), expectedBefore = hashOf(p.old.world);
  const actual = p.now.engine.previewCarrierV1(structuredClone(s)); // Candidate always runs first on its own caches.
  const expected = p.old.engine.previewCarrierV1(structuredClone(s));
  assert.deepEqual(actual, expected, JSON.stringify(s));
  assert.equal(hashOf(p.now.world), before); assert.equal(hashOf(p.old.world), expectedBefore);
  return actual;
}
function edit(f: ReturnType<typeof fixture>, set: WorldEditV1['set']) {
  const event: WorldEditV1 = { contract: 'world-edit/1', seq: (f.world.entityPhysicsV1?.seq ?? 0) + 1, hash: '', levels: [], set };
  event.hash = nextEntityPhysics(f.world.entityPhysicsV1, event).hash;
  f.engine.applyWorldEditV1(event);
}
const wall = (x: number, z: number, yaw = 0): Obstacle => ({ id: 'wall', kind: 'wall', obb: { c: [x, z], half: [.2, .2], yaw }, y0: 0, y1: 4, raster: 'centre' });

test('carrier preview retains full refusal priority, existing ids, and the independent rowing-punt branch', () => {
  const p = pair();
  for (const f of [p.now, p.old]) {
    f.world.entities.taken = component('taken', 'bowl', [40, 0, 0]);
    const existing = carrierEntity(spec([40, 0], { id: 'existing' }), 0); assert.ok(!('code' in existing)); f.world.entities.existing = existing;
  }
  const cases: [CarrierInstallSpec, string | null][] = [
    [spec([NaN, 0], { id: 'BAD!', def: 'bad' }), 'carrier.bad-id'],
    [spec([NaN, 0], { id: 'taken', def: 'bad' }), 'carrier.id-taken'],
    [spec([NaN, 0], { id: 'existing', def: 'bad' }), null],
    [spec([NaN, 0], { def: 'bad' }), 'carrier.bad-home'],
    [spec([320, 0], { def: 'bad' }), 'carrier.unknown-def'],
    [spec([320, 0], { route: 'bad' }), 'carrier.unknown-route'],
    [spec([320, 0], { yaw: NaN }), 'carrier.bad-route'],
  ];
  for (const [s, code] of cases) assert.equal(compare(p, s)?.code ?? null, code);
  const punt = compare(p, spec([320, 0], { def: 'rowing-punt' }));
  assert.ok(punt, 'no valid bank/water route was supplied');
  assert.notEqual(punt.code, 'carrier.home-blocked', 'punt keeps its own diagnostics before ordinary clearance');
});

test('cold off-window carrier reads avoid full rasters; warm, inside-window and flat decisions match', () => {
  for (const paged of [true, false]) {
    const p = pair(paged), at: Vec2 = paged ? [320, 0] : [20, 0];
    const built = p.now.spatial.ground?.stats.fineBuilds ?? 0;
    assert.equal(compare(p, spec(at)), null);
    if (paged) {
      assert.equal(p.now.spatial.ground!.stats.fineBuilds, built, 'cold point reads do not construct distant whole fine tiles');
      assert.ok(p.old.spatial.ground!.stats.fineBuilds > built, 'frozen preview really constructs the old outside grid');
      // Explicitly warm the candidate too; subsequent reads must agree through the cached-tile path.
      p.now.spatial.levelAt(0, at); assert.equal(compare(p, spec(at)), null);
      assert.equal(compare(p, spec([20, 0])), null);
      assert.equal(compare(p, spec([63.75, 0], { yaw: Math.PI }))?.code, 'carrier.door-blocked',
        'home is inside the anchor window ending at 64, but rotated exits must remain clipped to that same window');
    }
    assert.equal(compare(p, spec([0, 0]))?.code, 'carrier.home-occupied');
    for (const x of paged ? [-128.00001, -128, 511.99999, 512] : [-64.00001, -64, 63.99999, 64]) compare(p, spec([x, 0]));
  }
});

test('live physics walls, rotated exits, terrain changes and deck surfaces keep exact home/door decisions', () => {
  const p = pair();
  assert.equal(compare(p, spec()), null);
  for (const f of [p.now, p.old]) edit(f, { blocker: { solids: [wall(320, 0, .37)] } });
  assert.equal(compare(p, spec())?.code, 'carrier.home-blocked');
  for (const f of [p.now, p.old]) edit(f, { blocker: { solids: [wall(318, -.9, .37)] } });
  assert.equal(compare(p, spec())?.code, 'carrier.door-blocked');
  for (const yaw of [0, .31, Math.PI / 2, Math.PI]) for (const x of [319.999999, 320, 320.000001]) compare(p, spec([x, 0], { yaw }));
  for (const f of [p.now, p.old]) { edit(f, { blocker: null }); f.spatial.setGround(field(true), f.world, [], { paged: true }); }
  assert.equal(compare(p, spec())?.code, 'carrier.home-blocked');
  for (const f of [p.now, p.old]) edit(f, { deck: { surfaces: [{ id: 'dry-deck', level: 0, y: 2.2, obb: { c: [320, 0], half: [8, 8], yaw: .17 } }] } });
  assert.equal(compare(p, spec()), null, 'real entity-physics contributor raises a dry deck over the water');
  for (const x of [309.999999, 310, 310.000001, 311.999999, 312, 327.999999, 330, 330.000001]) compare(p, spec([x, 0], { yaw: .31 }));
  assert.equal(compare(p, spec([350, 61]))?.code, 'carrier.home-blocked');
  for (const f of [p.now, p.old]) { edit(f, { deck: null }); f.spatial.setGround(field(false), f.world, [], { paged: true }); }
  assert.equal(compare(p, spec()), null, 'a later ground replacement is read live');
});

test('Float32 values immediately around each threshold preserve strict comparisons', () => {
  const p = pair(false), s = spec([20, 0]), homeNeed = Math.hypot(.75, .6) + .3, doorNeed = HUMAN_RADIUS + .3;
  const door = CATALOG[s.def].capabilities!.carrier!.door;
  const point: Vec2 = [s.at[0] + door[0] * dcos(0) - door[1] * dsin(0), s.at[1] + door[0] * dsin(0) + door[1] * dcos(0)];
  for (const which of ['home', 'door'] as const) {
    const threshold = which === 'home' ? homeNeed : doorNeed;
    for (const value of [Math.fround(threshold - 1e-7), Math.fround(threshold), Math.fround(threshold + 1e-7)]) {
      for (const f of [p.now, p.old]) {
        const grid = f.spatial.levelAt(0, s.at)!; grid.clearance.fill(10);
        grid.clearance[cellOf(grid, which === 'home' ? s.at : point)] = value;
      }
      assert.equal(compare(p, s)?.code ?? null, value < threshold ? `carrier.${which}-blocked` : null);
    }
  }
});

test('actual install and reroute previews retain own-carrier removal and restoration semantics', () => {
  const p = pair(); const s = spec();
  for (const f of [p.now, p.old]) assert.equal(f.engine.installCarrierV1(structuredClone(s)), true);
  assert.deepEqual(p.now.world, p.old.world);
  for (const target of [[320, 0], [322, 0], [512, 0]] as Vec2[]) {
    const next = spec(target), before = p.now.world.entities[s.id], oldBefore = p.old.world.entities[s.id];
    assert.deepEqual(p.now.engine.previewCarrierRerouteV1(next), p.old.engine.previewCarrierRerouteV1(next));
    assert.strictEqual(p.now.world.entities[s.id], before); assert.strictEqual(p.old.world.entities[s.id], oldBefore);
    assert.deepEqual(p.now.world, p.old.world);
  }
});
