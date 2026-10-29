import test from 'node:test';
import assert from 'node:assert/strict';
import {marsFactory, GREEN_FIELD_WORLD, type MarsEngine} from './engine.ts';
import {assetFromDef, assetIdFor, type DefFacts} from './catalog-adapter.ts';
import {nextEntityPhysics, type WorldEditV1} from './entity-physics.ts';

const factory = await marsFactory(GREEN_FIELD_WORLD);
const chair: DefFacts = {ref: 'occupied-landing-chair@1', hash: 'c'.repeat(64), name: 'occupied-landing-chair', tags: [], layer: 'solid',
  box: [.6, .18, .46], components: {seat: {height: .18}}, slots: [{id: 'seat', kind: 'seat', p: [0, .18, 0], yaw: 0}]};
const chairAsset = assetIdFor(chair, '{}');

function until(e: MarsEngine, done: () => boolean, limit = 900) {
  for (let i = 0; i < limit; i++) {e.step(); if (done()) return i + 1;}
  assert.fail('native physical condition not reached within 45 simulated seconds');
}
function use(e: MarsEngine, actor: string, steps: {verb: string; params: Record<string, unknown>}[]) {
  const p = e.perform({actor, label: 'occupied landing regression', steps});
  assert.equal(p.ok, true, JSON.stringify(p)); return p.id;
}
async function fixture({policy = false, both = false} = {}) {
  const e = factory.create(factory.genesis('occupied-link-routing')) as MarsEngine;
  const link = (id: string, x: number) => ({id, kind: 'stairs' as const, from: {level: 0, p: [x, -4] as [number, number], y: 0},
    to: {level: 1, p: [x, -1] as [number, number], y: 1.2}, heading: Math.PI / 2, width: .9, usable: true,
    path: [[x, 0, -4], [x, 1.2, -1]] as [number, number, number][]});
  const edit: WorldEditV1 = {contract: 'world-edit/1', seq: 1, hash: '', levels: [{id: 1, y: 1.2, label: 'upper'}],
    assets: {[chairAsset]: assetFromDef(chairAsset, chair)}, set: {
      upper: {surfaces: [{id: 'upper-floor', level: 1, y: 1.2, obb: {c: [4, 1], half: [6, 3], yaw: 0}}]},
      flights: {links: [link('left-stair', 1), link('right-stair', 7)]},
      leftSeat: {fixture: {def: chairAsset, kind: 'fixture', label: 'left landing seat', p: [1, 1.2, -1.1], yaw: 0, level: 1}},
      ...(both ? {rightSeat: {fixture: {def: chairAsset, kind: 'fixture' as const, label: 'right landing seat', p: [7, 1.2, -1.1] as [number, number, number], yaw: 0, level: 1}}} : {}),
    }};
  edit.hash = nextEntityPhysics(undefined, edit).hash; e.applyWorldEditV1(edit);
  for (const [actor, seat, x] of [['h_left000', 'leftSeat', 1], ...(both ? [['h_right00', 'rightSeat', 7]] : [])] as [string, string, number][]) {
    e.spawnHuman({id: actor, soul: `s_${actor}`, label: actor, near: {at: [x, -5], first: true}});
    use(e, actor, [{verb: 'mars:sit', params: {slot: `${seat}#seat`}}, {verb: 'rest', params: {seconds: 600}}]);
    until(e, () => e.world.entities[actor].human!.activity === 'sit');
    assert.equal(e.bodyUsesV1(seat)?.body, actor);
  }
  if (policy) e.configureRuntimePolicy({sleepBlockTicks: 1200, occupiedLinkRoutingV1: true});
  e.spawnHuman({id: 'h_walker0', soul: 's_walker0', label: 'walker', near: {at: [1, -5], first: true}});
  const program = use(e, 'h_walker0', [{verb: 'mars:walk_to', params: {x: 2, z: 2, level: 1}}]);
  return {e, program};
}

test('default behavior remains an occupied-flight wait; opt-in reroutes from supported entry without moving its sitter', async () => {
  const old = await fixture();
  until(old.e, () => old.e.world.entities.h_walker0.human!.activity === 'climb-wait');
  for (let i = 0; i < 100; i++) old.e.step();
  assert.equal(old.e.world.entities.h_walker0.human!.activity, 'climb-wait');
  assert.equal((old.e as any).rt.services.occupiedLinkRoutingV1, undefined);

  const {e} = await fixture({policy: true}), sitter = structuredClone(e.world.entities.h_left000.pose);
  let alternate = false;
  until(e, () => {
    const body = e.world.entities.h_walker0;
    if (body.pose.p[1] > .1 && body.pose.p[0] > 6) alternate = true;
    return e.programOf('h_walker0') === null;
  });
  assert(alternate, 'the walker physically uses the other flight');
  assert.equal(e.world.entities.h_walker0.human!.level, 1);
  assert.deepEqual(e.world.entities.h_left000.pose, sitter, 'the held sitter is never evicted');
  assert.equal(e.bodyUsesV1('leftSeat')?.body, 'h_left000');
  assert.deepEqual(e.runtime.violations, []); assert.deepEqual(old.e.runtime.violations, []);
});

test('waiting state and opt-in survive snapshot continuation; planning obeys existing retry bounds', async () => {
  const {e} = await fixture({policy: true, both: true});
  until(e, () => [...(e as any).rt.services.walkExecs.values()].some((x: any) => x.actor === 'h_walker0' && x.linkWait));
  const copy = factory.restore(e.snapshot()) as MarsEngine;
  assert.equal((copy as any).rt.services.occupiedLinkRoutingV1, true);
  for (let i = 0; i < 850; i++) {
    e.step(); copy.step(); assert.equal(copy.stateHash(), e.stateHash());
    assert.equal(e.world.entities.h_walker0.human!.level, 0);
    assert.equal(e.world.entities.h_walker0.pose.p[1], 0, 'no mid-flight projection or stepping through either occupied landing');
  }
  const ex = [...(e as any).rt.services.walkExecs.values()].find((x: any) => x.actor === 'h_walker0') as any;
  assert.equal(ex.peopleReplans, 6, 'bounded existing person-avoidance attempts');
  assert.equal(e.bodyUsesV1('leftSeat')?.body, 'h_left000'); assert.equal(e.bodyUsesV1('rightSeat')?.body, 'h_right00');
  assert.deepEqual(e.runtime.violations, []);
});

test('activating the policy cannot replan or project a walker already between floors', async () => {
  const {e} = await fixture();
  until(e, () => e.world.entities.h_walker0.human!.activity === 'climb-wait');
  const pose = structuredClone(e.world.entities.h_walker0.pose), holders = e.nativeSeatHoldsV1('h_left000');
  e.configureRuntimePolicy({sleepBlockTicks: 1200, occupiedLinkRoutingV1: true});
  for (let i = 0; i < 100; i++) e.step();
  assert.deepEqual(e.world.entities.h_walker0.pose, pose);
  assert.deepEqual(e.nativeSeatHoldsV1('h_left000'), holders);
  assert.deepEqual(e.runtime.violations, []);
});

test('a historical snapshot keeps legacy behavior until the explicit prospective activation', async () => {
  const {e} = await fixture(), snapshot = e.snapshot() as any;
  assert.equal(Object.hasOwn(snapshot.cfg, 'occupiedLinkRoutingV1'), false);
  const copy = factory.restore(snapshot) as MarsEngine;
  assert.equal((copy as any).rt.services.occupiedLinkRoutingV1, undefined);
  assert.equal(copy.stateHash(), e.stateHash());
  for (let i = 0; i < 100; i++) {e.step(); copy.step(); assert.equal(copy.stateHash(), e.stateHash());}
  e.configureRuntimePolicy({sleepBlockTicks: 1200, occupiedLinkRoutingV1: true});
  copy.configureRuntimePolicy({sleepBlockTicks: 1200, occupiedLinkRoutingV1: true});
  for (let i = 0; i < 100; i++) {e.step(); copy.step(); assert.equal(copy.stateHash(), e.stateHash());}
  assert.equal((copy.snapshot() as any).cfg.occupiedLinkRoutingV1, true);
});

test('refused policy admission preserves canonical state and default absence', () => {
  const e = factory.create(factory.genesis('occupied-link-policy-atomic')) as MarsEngine;
  const hash = e.stateHash(), snapshot = JSON.stringify(e.snapshot());
  for (const policy of [
    {sleepBlockTicks: 0, occupiedLinkRoutingV1: true},
    {sleepBlockTicks: 1200, occupiedLinkRoutingV1: true, quietSeatCourtesy: 'bad'},
    {sleepBlockTicks: 1200, occupiedLinkRoutingV1: 'bad'},
  ]) {
    assert.throws(() => e.configureRuntimePolicy(policy as any), /runtime-policy\./);
    assert.equal(e.stateHash(), hash); assert.equal(JSON.stringify(e.snapshot()), snapshot);
    assert.equal((e as any).rt.services.occupiedLinkRoutingV1, undefined);
  }
  e.configureRuntimePolicy({sleepBlockTicks: 1200, occupiedLinkRoutingV1: true});
  assert.notEqual(e.stateHash(), hash);
});
