// Real native engine and ledger-generated activity steps. No services, models, forced state or body teleport.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldModel, applyBatch } from '../../packages/world-compiler/src/index.ts';
import { coreLibrary } from '../../packages/world-compiler/src/library.ts';
import { marsFactory, GREEN_FIELD_WORLD } from '../../packages/engine-mars/src/engine.ts';
import { assetFromDef, assetIdFor } from '../../packages/engine-mars/src/catalog-adapter.ts';
import { nextEntityPhysics } from '../../packages/engine-mars/src/entity-physics.ts';
import { GodActivitySpots } from '../../apps/server/src/god/activity-spots.ts';
import { activityCapabilities } from '../../apps/server/src/edge/ledger/activities.ts';
import { CATALOG } from '../../mars/viewer/engine/world/catalog.ts';

test('real v2 computer activity derives the retained office chair, seats natively, completes and keeps its seat claim', { timeout: 90_000 }, async t => {
  const model = new WorldModel({ constants: { ground: 'land' }, seed: 'native-v2-computer' }); model.library = coreLibrary();
  const placed = applyBatch(model, { ops: [
    { op: 'place', def: 'core/office-desk@2', name: 'library-desk-east', p: [4, 0] },
    { op: 'place', def: 'core/office-chair@1', name: 'library-desk-chair-east', p: [4, 1], r: Math.PI },
  ] }, 'god', 1); assert.ok(placed.result.accepted, JSON.stringify(placed.result));
  const desk = model.get('library-desk-east'), chair = model.get('library-desk-chair-east'), assets = {}, set = {};
  for (const entity of model.entities.values()) {
    const def = model.resolvedDef(entity.def), baked = model.bake(def, entity.params, entity.seed ?? 7), pose = model.worldPose(entity);
    const facts = { ref: def.ref, hash: def.hash, name: def.name, description: def.description, tags: def.tags, layer: def.layer, components: def.components, slots: baked.slots, box: baked.box, palette: def.palette };
    const assetId = assetIdFor(facts, JSON.stringify(entity.params)); assets[assetId] = assetFromDef(assetId, facts);
    set[entity.id] = { fixture: { def: assetId, kind: 'fixture', label: entity.name, p: [pose.x, pose.y, pose.z], yaw: -pose.yaw } };
  }
  t.after(() => { for (const id of Object.keys(assets)) delete CATALOG[id]; });
  const factory = await marsFactory(GREEN_FIELD_WORLD), engine = factory.create(factory.genesis('native-v2-computer'));
  const edit = { contract: 'world-edit/1', seq: 1, hash: '', levels: [], set, assets }; edit.hash = nextEntityPhysics(undefined, edit).hash;
  engine.applyWorldEditV1(edit);
  const actor = 'h_computer1'; engine.spawnHuman({ id: actor, label: 'Reader', soul: 's_computer1' });
  const spots = new GodActivitySpots({ model, engine, version: () => 1, levelAt: () => 0, placeAt: () => null, placeName: () => null }).data();
  const spot = spots.spots.find(spot => spot.activity === 'use-computer');
  assert.ok(spot); assert.equal(spot.seat, chair.id); assert.equal(spot.base, 'sit'); assert.deepEqual(spot.at, [4, 1]);
  assert.deepEqual(spot.faceTo, [4, 0]); assert.ok(!spots.spots.some(spot => spot.seat === desk.id), 'no removed scenery chair is offered');
  const data = activityCapabilities(spots, { me: [0, 0], seated: false, level: 0, clearance: () => 1, open: at => at, taken: () => false, enterable: () => true, seat: () => null, placeName: () => null, ancestors: () => [], groupSize: () => 0 });
  const plan = data.plans.get(`use-computer:${spot.id}`); assert.ok(plan);
  assert.deepEqual(plan.steps[0], { verb: 'sit', params: { on: chair.id, seconds: 1 } });
  const steps = plan.steps.map(step => step.verb === 'mars:pose_v1' ? { ...step, params: { ...step.params, seconds: 5 } } : step);
  const started = engine.perform({ actor, label: plan.label, steps }); assert.ok(started.ok, JSON.stringify(started));
  let observed = null, ticks = 0;
  for (; ticks < 2400; ticks++) {
    engine.step(); const body = engine.world.entities[actor];
    if (body.human?.activity === 'use-computer') {
      assert.equal(body.human.baseActivity, 'sit'); assert.deepEqual(engine.bodyUsesV1(chair.id), { body: actor, how: 'occupied' });
      assert.equal(engine.bodyUsesV1(desk.id), null); observed ??= structuredClone(body);
    }
    if (observed && !engine.programOf(actor)) break;
  }
  assert.ok(observed, 'native seated computer activity actually ran'); assert.ok(ticks < 2400, 'normal native program completed');
  assert.equal(engine.world.entities[actor].human.activity, 'sit');
  assert.deepEqual(engine.bodyUsesV1(chair.id), { body: actor, how: 'occupied' }, 'completion preserves actual lasting seat claim');
  assert.deepEqual(engine.runtime.violations, []);
  console.log(JSON.stringify({ schema: 'native-computer-chair/1', deskId: desk.id, chairId: chair.id, deskHash: model.resolvedDef(desk.def).hash, spot, started, ticks, observed, final: engine.world.entities[actor], claim: engine.bodyUsesV1(chair.id), violations: engine.runtime.violations }));
});
