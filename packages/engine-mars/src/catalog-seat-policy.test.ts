import test from 'node:test';
import assert from 'node:assert/strict';
import { assetFromDef, assetIdFor, registerAssets, type DefFacts } from './catalog-adapter.ts';
import { fixtureSlots } from '../../../mars/viewer/engine/social/slots.ts';
import { CATALOG } from '../../../mars/viewer/engine/world/catalog.ts';
import type { Runtime } from '../../../mars/viewer/engine/runtime/runtime.ts';
import type { Entity } from '../../../mars/viewer/engine/world/types.ts';
import { marsFactory, GREEN_FIELD_WORLD, type MarsEngine } from './engine.ts';
import { nextEntityPhysics, type WorldEditV1 } from './entity-physics.ts';

const facts: DefFacts = { ref: 'policy-chair@1', hash: 'a'.repeat(64), name: 'policy-chair', tags: [], layer: 'solid',
  components: { seat: { height: 0.45 } }, box: [0.6, 0.45, 0.6],
  slots: [{ id: 'seat', kind: 'seat', p: [0, 0.45, 0], yaw: 0 }, { id: 'front', kind: 'stand', p: [0, 0, 1], yaw: 0 }] };

test('reachable seat policy gets a distinct logged asset identity; old assets and serialized slots keep old semantics', (t) => {
  const { ref, hash, box } = facts;
  const legacyId = assetIdFor({ ref, hash, box }, '{}'), nextId = assetIdFor(facts, '{}');
  assert.notEqual(nextId, legacyId, 'new policy cannot reinterpret an existing registered asset id');
  const oldAsset = assetFromDef(legacyId, facts);
  for (const slot of oldAsset.slots!) delete slot.approachPolicy;
  const nextAsset = assetFromDef(nextId, facts);
  registerAssets({ [legacyId]: oldAsset, [nextId]: nextAsset });
  t.after(() => { delete CATALOG[legacyId]; delete CATALOG[nextId]; });
  const rt = { services: { spatial: { base: { levels: [{ id: 0, y: 0 }] } } }, holder: () => [] } as unknown as Runtime;
  const slots = (def: string) => fixtureSlots(rt, { id: 'chair', def, pose: { p: [0, 0, 0], yaw: 0 } } as Entity);
  assert.equal(slots(legacyId)[0].approachPolicy, undefined);
  assert.equal(slots(nextId)[0].approachPolicy, 'reachable/1');
  assert.equal(slots(nextId)[1].approachPolicy, undefined, 'stand slots do not acquire seat policy');
  assert.equal(JSON.parse(JSON.stringify(slots(nextId)))[0].approachPolicy, 'reachable/1', 'planned slot snapshots retain the policy');
  assert.equal(JSON.parse(JSON.stringify(slots(legacyId)))[0].approachPolicy, undefined);
  registerAssets({ [legacyId]: nextAsset });
  assert.equal(slots(legacyId)[0].approachPolicy, undefined, 'registration never overwrites a historical asset');
});

test('non-seat assets retain their identity and ordinary slots', () => {
  const nonSeat = { ...facts, slots: facts.slots.filter((s) => s.kind !== 'seat'), components: {} };
  assert.equal(assetIdFor(nonSeat, '{}'), assetIdFor({ ref: facts.ref, hash: facts.hash, box: facts.box }, '{}'));
  assert.equal(assetFromDef('stand-policy-control', nonSeat).slots![0].approachPolicy, undefined);
});

test('an upstairs seat checks its transition on the target floor, above ground-floor furniture', async () => {
  const f = await marsFactory(GREEN_FIELD_WORLD), e = f.create(f.genesis('upstairs-seat-policy')) as unknown as MarsEngine;
  const id = assetIdFor(facts, '{}');
  const edit: WorldEditV1 = { contract: 'world-edit/1', seq: 1, hash: '', levels: [{ id: 1, y: 3, label: 'upstairs' }],
    assets: { [id]: assetFromDef(id, facts) }, set: {
      upper: { surfaces: [{ id: 'upper-floor', level: 1, y: 3, obb: { c: [4, 0], half: [4, 4], yaw: 0 } }] },
      below: { solids: [{ id: 'downstairs-cabinet', obb: { c: [4, 0], half: [2, 2], yaw: 0 }, y0: 0, y1: 2, kind: 'fixture' }] },
      stairs: { links: [{ id: 'upstairs-flight', kind: 'stairs', from: { level: 0, p: [7, 3], y: 0 }, to: { level: 1, p: [7, -2], y: 3 },
        heading: -Math.PI / 2, width: 1.2, usable: true, path: Array.from({ length: 21 }, (_, i) => [7, 3 * i / 20, 3 - 5 * i / 20]) }] },
      chair: { fixture: { def: id, kind: 'fixture', label: 'upstairs chair', p: [4, 3, 0], yaw: 0.37 } },
    } };
  edit.hash = nextEntityPhysics(undefined, edit).hash;
  e.applyWorldEditV1(edit);
  e.spawnHuman({ id: 'h_policy001', label: 'Walker', soul: 's_policy001' });
  const program = { actor: 'h_policy001', label: 'sit upstairs', steps: [{ verb: 'sit', params: { on: 'chair', seconds: 1 } }] };
  assert.equal(e.canPerform(program), null, 'ground-floor solids do not block an upstairs sit/stand sweep');
  assert.equal(e.perform(program).ok, true);
  for (let i = 0; i < 3000 && e.world.entities.h_policy001.human?.activity !== 'sit'; i++) e.step();
  assert.equal(e.world.entities.h_policy001.human?.activity, 'sit');
  assert.equal(e.world.entities.h_policy001.human?.level, 1);
  assert.deepEqual(e.runtime.violations, []);
});

// L3 (V6-party S8 knock-on): "sit in the canoe" chose the nearest free seat and refused when that seat's slide was
// blocked (slot.transition-blocked), though the other seat was free and reachable. A reachable/1 asset's other free
// seats are now tried nearest first; the nearest seat is still the one taken whenever it works.
const bench: DefFacts = { ref: 'policy-bench@1', hash: 'b'.repeat(64), name: 'policy-bench', tags: [], layer: 'solid',
  components: { seat: { height: 0.45 } }, box: [2.4, 0.45, 0.45],
  slots: [{ id: 'left', kind: 'seat', p: [-0.6, 0.45, 0], yaw: 0 }, { id: 'right', kind: 'seat', p: [0.6, 0.45, 0], yaw: 0 }] };
async function benchWorld(name: string, boxIn: boolean) {
  const f = await marsFactory(GREEN_FIELD_WORLD), e = f.create(f.genesis(name)) as unknown as MarsEngine;
  e.spawnHuman({ id: 'h_bench0001', label: 'Sitter', soul: 's_bench0001' });
  const at = e.world.entities.h_bench0001.pose.p, c: [number, number] = [at[0] + 3, at[2] - 2];   // her left seat is nearer
  const id = assetIdFor(bench, '{}');
  const wall = (k: string, x: number, z: number, hx: number, hz: number) => ({ id: k, obb: { c: [c[0] + x, c[1] + z], half: [hx, hz], yaw: 0 }, y0: 0, y1: 2, kind: 'fixture' });
  const edit: WorldEditV1 = { contract: 'world-edit/1', seq: 1, hash: '', levels: [], assets: { [id]: assetFromDef(id, bench) }, set: {
    bench: { fixture: { def: id, kind: 'fixture', label: 'bench', p: [c[0], 0, c[1]], yaw: 0 } },
    // the left seat boxed in on three sides (the bench is the fourth): no clear slide onto it from anywhere
    ...(boxIn ? { pen: { solids: [wall('pen-front', -0.75, 0.55, 0.65, 0.05), wall('pen-back', -0.75, -0.55, 0.65, 0.05), wall('pen-side', -1.45, 0, 0.05, 0.6)] } } : {}),
  } } as unknown as WorldEditV1;
  edit.hash = nextEntityPhysics(undefined, edit).hash;
  e.applyWorldEditV1(edit);
  return { e, c };
}
for (const boxIn of [false, true]) test(`sit on a two-seat bench: ${boxIn ? 'the nearer seat boxed in, she takes the other' : 'both clear, she takes the nearer'}`, async () => {
  const { e, c } = await benchWorld(`bench-${boxIn}`, boxIn);
  const program = { actor: 'h_bench0001', label: 'sit on the bench', steps: [{ verb: 'sit', params: { on: 'bench', seconds: 1 } }] };
  assert.equal(e.canPerform(program), null);
  assert.equal(e.perform(program).ok, true);
  for (let i = 0; i < 3000 && e.world.entities.h_bench0001.human?.activity !== 'sit'; i++) e.step();
  const h = e.world.entities.h_bench0001;
  assert.equal(h.human?.activity, 'sit');
  const x = h.pose.p[0] - c[0];
  assert.ok(boxIn ? x > 0.3 : x < -0.3, `she sits on the ${boxIn ? 'right' : 'left'} seat (x ${x.toFixed(2)} from the bench centre)`);
  assert.deepEqual(e.runtime.violations, []);
});
