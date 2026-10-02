import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FixtureViews } from '../app/engine-view/fixtures.ts';
import { CATALOG } from '../engine/world/catalog.ts';
import { GARDEN_PLANTER_ASSET } from '../engine/world/catalog-garden.ts';

CATALOG['garden-planter'] ??= GARDEN_PLANTER_ASSET;
const fixture = (yaw = 0) => ({
  id: 'plot', def: 'garden-planter', kind: 'fixture',
  pose: { p: [2, 0, 3], yaw }, support: { kind: 'ground' },
  planting: { kind: 'seedbed-v1', deposited: 0 },
});

for (const yaw of [0, Math.PI / 2]) {
  test(`seedbed render retains supported deposit markers at yaw ${yaw} without world writes`, () => {
    const entity = fixture(yaw), world = { entities: { plot: entity } }, view = new FixtureViews();
    view.reset(world);
    for (let deposits = 0; deposits <= 4; deposits++) {
      entity.planting.deposited = deposits / 16;
      const before = structuredClone(world);
      view.onTick(world);
      view.render(100);
      const actual = view.seedMarkers();
      assert.equal(actual.length, 1);
      assert.equal(actual[0].count, deposits);
      assert.equal(actual[0].deposits, deposits);
      assert.equal(actual[0].decorativePlantVisible, false);
      assert.equal(actual[0].positions.length, deposits);
      for (const [x, y, z] of actual[0].positions) {
        assert.equal(y, 0.8);
        assert.ok(Math.abs(Math.abs(x - 2) - 0.12) < 1e-12);
        assert.ok(Math.abs(Math.abs(z - 3) - 0.12) < 1e-12);
      }
      assert.deepEqual(world, before);
      actual[0].positions.push([99, 99, 99]);
      assert.equal(view.seedMarkers()[0].positions.length, deposits);
    }
    view.dispose();
    assert.deepEqual(view.seedMarkers(), []);
  });
}

test('seedbed rendering does not invent material for invalid quantities', () => {
  const entity = fixture(), world = { entities: { plot: entity } }, view = new FixtureViews();
  view.reset(world);
  for (const deposited of [-0.0625, 0.01, 0.5, NaN, Infinity]) {
    entity.planting.deposited = deposited;
    view.onTick(world);
    assert.equal(view.seedMarkers()[0].count, 0);
    assert.equal(view.seedMarkers()[0].deposits, 0);
  }
  view.dispose();
});

test('seedbed reset removes retained marker geometry and ordinary care retains its appearance', () => {
  const entity = fixture(), world = { entities: { plot: entity } }, view = new FixtureViews();
  view.reset(world);
  entity.planting.deposited = 0.25;
  view.onTick(world);
  assert.equal(view.seedMarkers()[0].count, 4);
  const initial = { entities: { plot: fixture() } };
  let geometry;
  for (let reset = 0; reset < 25; reset++) {
    view.reset(initial);
    assert.equal(view.seedMarkers()[0].count, 0);
    assert.equal(view.group.children.length, 1);
    const mesh = view.group.children[0].children[0];
    geometry ??= mesh.geometry;
    assert.equal(mesh.geometry, geometry);
  }
  const care = fixture();
  delete care.planting;
  view.reset({ entities: { plot: care } });
  assert.deepEqual(view.seedMarkers(), []);
  assert.equal(view.group.children[0].children.length, 7);
  view.reset({ entities: {} });
  assert.deepEqual(view.seedMarkers(), []);
  assert.equal(view.group.children.length, 0);
  view.dispose();
});
