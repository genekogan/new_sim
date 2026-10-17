import { test } from 'node:test';
import assert from 'node:assert/strict';
import { marsFactory, GREEN_FIELD_WORLD, type MarsEngine } from './engine.ts';
import { groundFact, groundField } from './ground-bridge.ts';
import { emptyGround } from '../../ground/src/index.ts';
import { nextEntityPhysics, type WorldEditV1 } from './entity-physics.ts';

const factory = await marsFactory(GREEN_FIELD_WORLD);

test('ground reclaim lands on the knoll tiles and survives snapshot/restore without falling below ground', () => {
  const g = emptyGround(256);
  g.landforms.push({ id: 'hill', kind: 'bump', c: [30, 0], r: 25, h: 5, peak: 1 });
  const fact = groundFact(g, 1, { paged: true }), field = groundField(fact.recipeHash);
  const e = factory.create(factory.genesis('reclaim-hill')) as MarsEngine;
  e.installGroundV1(fact);
  e.enableGroundReclaimV1();
  e.spawnHuman({ id: 'h_ada', label: 'Ada', soul: 's_ada' });
  assert.equal(e.relocateHumanV1('h_ada', [30, 0]), true);
  const p = e.world.entities.h_ada.pose.p;
  assert.equal(p[1], field.height(p[0], p[2]));
  assert.ok(p[1] > 4.9, `landed at hilltop: ${p}`);
  const restored = factory.restore(e.snapshot());
  for (let i = 0; i < 40; i++) { e.step(); restored.step(); }
  assert.equal(restored.stateHash(), e.stateHash());
  assert.deepEqual(e.runtime.violations, []);
});

test('ground reclaim uses the ground-floor slab support instead of the terrain below it', () => {
  const e = factory.create(factory.genesis('reclaim-slab')) as MarsEngine;
  e.installGroundV1(groundFact(emptyGround(256), 1, { paged: true }));
  const edit: WorldEditV1 = { contract: 'world-edit/1', seq: 1, hash: '', levels: [], assets: {}, set: {
    e_slab: { surfaces: [{ id: 'slab', level: 0, y: 0.3, obb: { c: [20, 20], half: [3, 3], yaw: 0 } }] },
  } };
  edit.hash = nextEntityPhysics(undefined, edit).hash;
  e.applyWorldEditV1(edit);
  e.enableGroundReclaimV1();
  e.spawnHuman({ id: 'h_ada', label: 'Ada', soul: 's_ada' });
  assert.equal(e.relocateHumanV1('h_ada', [20, 20]), true);
  assert.deepEqual(e.world.entities.h_ada.pose.p, [20, 0.3, 20]);
  e.step();
  assert.deepEqual(e.runtime.violations, []);
});


test('ground reclaim keeps its historical flat landing before the accepted policy; no-ground worlds remain unchanged after it', () => {
  for (const withGround of [true, false]) {
    const e = factory.create(factory.genesis('reclaim-policy-' + withGround)) as MarsEngine;
    if (withGround) {
      const g = emptyGround(256);
      g.landforms.push({ id: 'hill', kind: 'bump', c: [30, 0], r: 25, h: 5, peak: 1 });
      e.installGroundV1(groundFact(g, 1, { paged: true }));
    }
    e.spawnHuman({ id: 'h_ada', label: 'Ada', soul: 's_ada' });
    assert.equal(e.relocateHumanV1('h_ada', [30, 0]), true);
    assert.equal(e.world.entities.h_ada.pose.p[1], 0, 'old contract before policy');
    e.enableGroundReclaimV1();
    assert.equal(e.relocateHumanV1('h_ada', [30, 0]), true);
    assert.equal(e.world.entities.h_ada.pose.p[1], withGround ? 5 : 0);
  }
});
