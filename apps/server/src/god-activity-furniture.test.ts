// Real authored Mars furniture, projected through the production catalog and native body engine.
// The extra bookcase is a bounded activity fixture; Mimos itself has no supported reading shelf.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WorldModel, applyBatch, coreLibrary } from '@sim/world-compiler';
import { marsFactory, GREEN_FIELD_WORLD, type MarsEngine } from '../../../packages/engine-mars/src/engine.ts';
import { assetFromDef, assetIdFor } from '../../../packages/engine-mars/src/catalog-adapter.ts';
import { nextEntityPhysics } from '../../../packages/engine-mars/src/entity-physics.ts';
import { CATALOG } from '../../../mars/viewer/engine/world/catalog.ts';
import type { Entity as NativeEntity } from '../../../mars/viewer/engine/world/types.ts';
import { GodActivitySpots } from './god/activity-spots.ts';
import { activityCapabilities, type ActivityWorld } from './edge/ledger/activities.ts';
import { EdgeLedger } from './edge/ledger/ledger.ts';

const template = JSON.parse(readFileSync(new URL('../../../worlds/templates/mars-two.json', import.meta.url), 'utf8'));
const authored = template.batches.flatMap((b: { ops: Record<string, unknown>[] }) => b.ops) as { op: string; def: string; name: string; p: [number, number]; r: number; in?: unknown }[];

async function fixture(t: test.TestContext, chairName: string, context = 'read', variant?: string) {
  const original = authored.find(op => op.op === 'place' && op.name === chairName)!;
  assert.ok(original, `existing authored ${chairName}`);
  const { in: _parent, ...chair } = original;
  // Retain the authored chair's local position/yaw and immutable mesh def. Remove only the containing building,
  // so this focused fixture isolates classification from already-qualified Mimos floor/stair navigation.
  const model = new WorldModel({ constants: { ground: 'land' }, seed: 'authored-furniture' }); model.library = coreLibrary();
  if (variant === 'tag-only') {
    const tagged = model.defineDef({ ...model.resolvedDef(chair.def)!, name: 'chair-decoration', slots: [], components: { surface: { height: 0.488 } } }, 'god', 0);
    chair.def = tagged.ref;
  } else if (variant) chair.def = variant;
  const nearby = context === 'read'
    ? { op: 'place', def: 'core/bookcase@1', name: 'books', p: [chair.p[0], chair.p[1] + 3] }
    : { op: 'place', def: 'core/office-desk@2', name: 'computer', p: [chair.p[0] - 1, chair.p[1]] };
  const placed = applyBatch(model, { ops: [chair, ...(context === 'none' ? [] : [nearby])] } as never, 'god', 1);
  assert.equal(placed.result.accepted, true, JSON.stringify(placed.result));
  const assets: Record<string, ReturnType<typeof assetFromDef>> = {}, set: Record<string, unknown> = {};
  for (const entity of model.entities.values()) {
    const def = model.resolvedDef(entity.def)!, baked = model.bake(def, entity.params ?? {}, entity.seed ?? 7), p = model.worldPose(entity);
    const facts = { ref: def.ref, hash: def.hash, name: def.name, description: def.description, tags: def.tags, layer: def.layer, components: def.components, slots: baked.slots, box: baked.box, palette: def.palette };
    const id = assetIdFor(facts, JSON.stringify(entity.params)); assets[id] = assetFromDef(id, facts);
    set[entity.id] = { fixture: { def: id, kind: 'fixture', label: entity.name, p: [p.x, p.y, p.z], yaw: -p.yaw } };
  }
  t.after(() => { for (const id of Object.keys(assets)) delete CATALOG[id]; });
  const factory = await marsFactory(GREEN_FIELD_WORLD), engine = factory.create(factory.genesis('authored-furniture')) as MarsEngine;
  const edit = { contract: 'world-edit/1' as const, seq: 1, hash: '', levels: [], set, assets }; edit.hash = nextEntityPhysics(undefined, edit as never).hash;
  engine.applyWorldEditV1(edit as never);
  const actor = 'h_reader'; engine.spawnHuman({ id: actor, label: 'Reader', soul: 's_reader' });
  const spots = new GodActivitySpots({ model, engine, version: () => 1, levelAt: () => 0, placeAt: () => 'reading-room', placeName: () => 'Reading room' }).data();
  const data = activityCapabilities(spots, { me: [0, 0], seated: false, level: 0, clearance: () => 1, open: at => at, taken: () => false, enterable: () => true, seat: () => null, placeName: () => 'Reading room', ancestors: () => [], groupSize: () => 0 });
  return { model, engine, actor, original, spots, data, chair: model.get(chairName)! };
}

for (const chairName of ['study-chair-4', 'study-chair-6', 'study-chair-7']) {
  test(`authored Mars ${chairName} offers and completes native seated reading on its exact chair`, { timeout: 90_000 }, async t => {
    const f = await fixture(t, chairName), spot = f.spots.spots.find(s => s.activity === 'read' && s.seat === f.chair.id);
    assert.ok(spot, `authored ${f.original.def} at ${f.original.p}/${f.original.r} must offer seated reading`);
    assert.equal(spot.base, 'sit'); assert.equal(spot.seatHeight, 0.488);
    const plan = f.data.plans.get(`read:${spot.id}`)!; assert.ok(plan);
    assert.ok(plan.steps.some(s => s.verb === 'sit' && (s.params as { on?: string }).on === f.chair.id));
    // Native execution at the supported five-second minimum. Browse/return remain the real generated steps.
    const steps = plan.steps.map(s => s.verb === 'mars:pose_v1' && (s.params as { activity?: string }).activity === 'read' ? { ...s, params: { ...s.params, seconds: 5 } } : s);
    const started = f.engine.perform({ actor: f.actor, label: plan.label, steps }); assert.equal(started.ok, true, JSON.stringify(started));
    let observed: unknown, ticks = 0, terminal: { kind: string; code?: string } | undefined;
    for (; ticks < 2400; ticks++) {
      const update = f.engine.step(); terminal = update.programs.find(p => p.id === started.id && p.kind !== 'step') ?? terminal;
      const body = f.engine.world.entities[f.actor] as unknown as NativeEntity;
      if (body.human?.activity === 'read') {
        assert.equal(body.human.baseActivity, 'sit');
        assert.deepEqual(f.engine.bodyUsesV1(f.chair.id), { body: f.actor, how: 'occupied' });
        observed ??= structuredClone(body);
      }
      if (observed && !f.engine.programOf(f.actor)) break;
    }
    assert.ok(observed, 'native reading actually ran'); assert.ok(ticks < 2400, 'normal plan completed');
    assert.equal(terminal?.kind, 'completed', JSON.stringify(terminal));
    assert.equal(f.engine.bodyUsesV1(f.chair.id), null, 'book returned after ordinary stand cleanup');
    assert.deepEqual(f.engine.runtime.violations, []);
    console.log(JSON.stringify({ schema: 'authored-furniture-native/1', authored: f.original, chair: f.chair.id, spot, started, terminal, ticks, observed, final: f.engine.world.entities[f.actor], violations: f.engine.runtime.violations }));
  });
}

test('authored Mars study chair pairs with a computer rather than offering standing computer use', async t => {
  const f = await fixture(t, 'study-chair-4', 'computer'), spot = f.spots.spots.find(s => s.activity === 'use-computer');
  assert.ok(spot); assert.equal(spot.seat, f.chair.id); assert.equal(spot.base, 'sit');
  assert.deepEqual(f.data.plans.get(`use-computer:${spot.id}`)!.steps[0], { verb: 'sit', params: { on: f.chair.id, seconds: 1 } });
});

test('read here keeps an already occupied authored study chair when no shelf or other free seat exists', async t => {
  const f = await fixture(t, 'study-chair-4', 'none');
  const sitting = f.engine.perform({ actor: f.actor, label: 'Sit', steps: [{ verb: 'sit', params: { on: f.chair.id, seconds: 1 } }] });
  assert.equal(sitting.ok, true, JSON.stringify(sitting));
  for (let n = 0; n < 1600 && f.engine.programOf(f.actor); n++) f.engine.step();
  assert.equal(f.engine.programOf(f.actor), null);
  assert.deepEqual(f.engine.bodyUsesV1(f.chair.id), { body: f.actor, how: 'occupied' });
  const before = structuredClone(f.engine.world.entities[f.actor]);
  const ledger = Object.assign(Object.create(EdgeLedger.prototype), { host: { engine: f.engine, minds: new Map(), kernel: { things: {} } }, places: { byId: new Map() } }) as { activityWorld(...args: unknown[]): ActivityWorld };
  // Real ledger adapter observes the native current-chair state. No free sit capability is offered for the occupied seat.
  const w = ledger.activityWorld({ entityId: f.actor, soulId: 's_reader' }, f.engine.world.entities[f.actor], [], new Map());
  assert.equal(w.seated, true); assert.equal(w.seat(30), null);
  const data = activityCapabilities(f.spots, w), plan = data.plans.get('read:here')!;
  console.log(JSON.stringify({ schema: 'occupied-chair-read-plan/1', before, plan }));
  const steps = plan.steps.map(s => s.verb === 'mars:pose_v1' ? { ...s, params: { ...s.params, seconds: 5 } } : s);
  const started = f.engine.perform({ actor: f.actor, label: plan.label, steps }); assert.equal(started.ok, true, JSON.stringify(started));
  let observed = false, terminal: { kind: string; code?: string } | undefined;
  for (let n = 0; n < 500 && f.engine.programOf(f.actor); n++) {
    const update = f.engine.step(); terminal = update.programs.find(p => p.id === started.id && p.kind !== 'step') ?? terminal;
    const body = f.engine.world.entities[f.actor] as unknown as NativeEntity;
    if (body.human?.activity === 'read') {
      if (!observed) console.log(JSON.stringify({ schema: 'occupied-chair-native-read/1', body, claim: f.engine.bodyUsesV1(f.chair.id) }));
      assert.equal(body.human.baseActivity, 'sit');
      assert.deepEqual(f.engine.bodyUsesV1(f.chair.id), { body: f.actor, how: 'occupied' });
      assert.deepEqual(body.pose, before.pose, 'reading stays on the same authored seat pose');
      observed = true;
    }
  }
  assert.equal(observed, true); assert.equal(f.engine.programOf(f.actor), null);
  assert.equal(terminal?.kind, 'completed', JSON.stringify(terminal));
  assert.deepEqual(f.engine.bodyUsesV1(f.chair.id), { body: f.actor, how: 'occupied' });
  assert.equal(f.engine.world.entities[f.actor].human?.activity, 'sit');
  assert.deepEqual(f.engine.runtime.violations, []);
  console.log(JSON.stringify({ schema: 'occupied-chair-read-terminal/1', actor: f.actor, terminal, final: f.engine.world.entities[f.actor], claim: f.engine.bodyUsesV1(f.chair.id), violations: f.engine.runtime.violations }));
});

for (const variant of ['tag-only', 'core/bed@1', 'core/office-chair@1']) test(`${variant} does not become a shelf reading seat`, async t => {
  const f = await fixture(t, 'study-chair-4', 'read', variant);
  assert.equal(f.spots.spots.some(s => s.activity === 'read' && s.seat === f.chair.id), false);
});

test('generic armchair keeps its supported shelf reading seat', async t => {
  const f = await fixture(t, 'study-chair-4', 'read', 'core/armchair@1');
  assert.equal(f.spots.spots.some(s => s.activity === 'read' && s.seat === f.chair.id), true);
});

