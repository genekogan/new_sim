import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { Runtime } from '../runtime/runtime.ts';
import { DEFAULT_INVARIANTS } from '../runtime/invariants.ts';
import { Spatial, entityFootprint } from '../spatial/service.ts';
import { addAll, emptyWorld, component, human } from '../world/factory.ts';
import { carry } from '../carry/actions.ts';
import { walkTo } from '../locomotion/walk.ts';
import { CARRY_INVARIANTS } from '../carry/invariants.ts';
import { hypot, rot2 } from '../core/math.ts';
import type { ActionDef } from '../actions/types.ts';
import type { SpatialScene } from '../spatial/types.ts';
const captures: unknown[] = [];
function fixture() {
  const scene: SpatialScene = { bounds: [-12, -12, 12, 12], levels: [{ id: 0, y: 0, label: 'ground' }, { id: 1, y: 4, label: 'upper deck' }], surfaces: [{ id: 'ground', level: 0, y: 0, obb: { c: [0, 0], half: [12, 12], yaw: 0 } }, { id: 'upper', level: 1, y: 4, obb: { c: [0, 0], half: [12, 12], yaw: 0 } }], obstacles: [], links: [] };
  const world = addAll(emptyWorld('hypothetical-cancel-people', scene), component('sheet', 'plywood-4x8', [0, 0, 0], 0), human('p1', -1, -2), human('p2', 1, 2));
  const registry = new Map<string, ActionDef>([['carry', carry], ['walk_to', walkTo]]);
  const rt = new Runtime(world, registry, { spatial: new Spatial(scene) }, [...DEFAULT_INVARIANTS, ...CARRY_INVARIANTS]);
  const action = rt.submit('carry', { crew: ['p1', 'p2'], item: 'sheet', to: { x: 8, z: 0, yaw: 0 } });
  assert.equal(action.status, 'executing', action.diagnostic?.message);
  return { rt, action };
}
function until(rt: Runtime, condition: () => boolean) {
  for (let i = 0; i < 2400 && !condition(); i++) rt.step();
  assert.ok(condition());
}
function addBystander(rt: Runtime, y = 0) {
  // Fault-injected arrival into the future lowering footprint, clear of the current edge-carried
  // sheet and both carriers. This does not authorize edit_world to teleport an actor into a load.
  const c = entityFootprint(rt.world.entities.sheet).obb.c;
  const h = human('visitor', c[0], c[1] + 0.86);
  h.pose.p[1] = y;
  if (y) h.human!.level = 1;
  addAll(rt.world, h);
  return h;
}
function retained(rt: Runtime, id: string) {
  assert.equal(rt.world.entities.sheet.phase, 'carried');
  assert.deepEqual(rt.world.entities.sheet.support, { kind: 'held', by: ['p1', 'p2'] });
  for (const resource of ['actor:p1', 'actor:p2', 'entity:sheet']) assert.ok(rt.holder(resource).includes(id));
}
function capture(label: string, rt: Runtime, id: string) {
  captures.push({ label, tick: rt.tick, action: structuredClone(rt.records.get(id)), entities: structuredClone(rt.world.entities), violations: structuredClone(rt.violations) });
}

test('LM078: cancelling a moving sheet refuses a person in the future set-down sweep atomically', () => {
  const { rt, action } = fixture();
  until(rt, () => action.phase === 'move' && entityFootprint(rt.world.entities.sheet).obb.c[0] > 1);
  const visitor = addBystander(rt);
  const before = structuredClone(rt.world);
  for (let i = 0; i < 2; i++) {
    rt.cancel(action.id);
    assert.equal(action.diagnostic?.code, 'carry.cancel-unsafe');
    assert.deepEqual(action.diagnostic?.subjects, ['sheet', 'visitor']);
    assert.deepEqual(rt.world, before);
    retained(rt, action.id);
  }
  capture('move-refused', rt, action.id);
  const leave = rt.submit('walk_to', { actor: visitor.id, x: visitor.pose.p[0], z: 2 });
  until(rt, () => leave.status === 'completed');
  rt.cancel(action.id);
  assert.equal(action.diagnostic, undefined, 'safe retry clears stale refusal');
  assert.ok(rt.runUntilIdle(100));
  assert.equal(action.status, 'cancelled');
  assert.deepEqual(rt.world.entities.sheet.support, { kind: 'ground' });
  assert.deepEqual(rt.violations, []);
  capture('move-retry-grounded', rt, action.id);
});

test('LM078: cancelling during lift checks the return footprint and retains support on refusal', () => {
  const { rt, action } = fixture();
  until(rt, () => action.phase === 'lift');
  for (let i = 0; i < 18; i++) rt.step();
  assert.equal(action.phase, 'lift');
  addBystander(rt);
  const before = structuredClone(rt.world);
  rt.cancel(action.id);
  assert.equal(action.diagnostic?.code, 'carry.cancel-unsafe');
  assert.deepEqual(rt.world, before);
  retained(rt, action.id);
  capture('lift-refused', rt, action.id);
});

for (const delay of [0, 6]) test(`LM078: a person arriving after ${delay} lowering ticks blocks before further motion and walking clear resumes safely`, () => {
  const { rt, action } = fixture();
  until(rt, () => action.phase === 'move' && entityFootprint(rt.world.entities.sheet).obb.c[0] > 1);
  rt.cancel(action.id);
  for (let i = 0; i < delay; i++) rt.step();
  const visitor = addBystander(rt);
  const pose = structuredClone(rt.world.entities.sheet.pose);
  const crew = ['p1', 'p2'].map((id) => structuredClone(rt.world.entities[id].pose));
  for (let i = 0; i < 40; i++) {
    rt.step();
    assert.equal(action.diagnostic?.code, 'carry.setdown-occupied');
    assert.deepEqual(rt.world.entities.sheet.pose, pose);
    assert.deepEqual(['p1', 'p2'].map((id) => rt.world.entities[id].pose), crew);
    retained(rt, action.id);
    const fp = entityFootprint(rt.world.entities.sheet).obb;
    const local = rot2([visitor.pose.p[0] - fp.c[0], visitor.pose.p[2] - fp.c[1]], -fp.yaw);
    assert.ok(hypot(Math.max(0, Math.abs(local[0]) - fp.half[0]), Math.max(0, Math.abs(local[1]) - fp.half[1])) >= 0.28);
  }
  assert.deepEqual(rt.violations, []);
  capture(`late-arrival-${delay}-held`, rt, action.id);
  const leave = rt.submit('walk_to', { actor: visitor.id, x: visitor.pose.p[0], z: 2 });
  assert.equal(leave.status, 'executing', leave.diagnostic?.message);
  assert.ok(rt.runUntilIdle(200));
  assert.equal(leave.status, 'completed');
  assert.equal(action.status, 'cancelled');
  assert.deepEqual(rt.world.entities.sheet.support, { kind: 'ground' });
  for (const resource of ['actor:p1', 'actor:p2', 'entity:sheet']) assert.deepEqual(rt.holder(resource), []);
  assert.deepEqual(rt.violations, []);
  capture(`late-arrival-${delay}-cleared`, rt, action.id);
});


test('LM078: a person clear of the load but on a carrier retreat segment prevents cancellation', () => {
  const { rt, action } = fixture();
  until(rt, () => action.phase === 'move' && entityFootprint(rt.world.entities.sheet).obb.c[0] > 1);
  const c = entityFootprint(rt.world.entities.sheet).obb.c;
  const visitor = human('visitor', c[0] - 1.67, c[1] + 0.84);
  addAll(rt.world, visitor);
  const before = structuredClone(rt.world);
  rt.cancel(action.id);
  assert.equal(action.diagnostic?.code, 'carry.cancel-unsafe');
  assert.match(action.diagnostic!.message, /carrier set-down sweep/);
  assert.deepEqual(rt.world, before);
  retained(rt, action.id);
  capture('carrier-retreat-refused', rt, action.id);
});

test('LM078: a person above the lowering and carrier bands does not prevent safe cancellation', () => {
  const { rt, action } = fixture();
  until(rt, () => action.phase === 'move' && entityFootprint(rt.world.entities.sheet).obb.c[0] > 1);
  addBystander(rt, 4);
  rt.cancel(action.id);
  assert.equal(action.diagnostic, undefined);
  assert.ok(rt.runUntilIdle(100));
  assert.equal(action.status, 'cancelled');
  assert.deepEqual(rt.violations, []);
  capture('vertical-clearance-control', rt, action.id);
  if (process.env.MARS_CARRY_CANCEL_CAPTURE) writeFileSync(process.env.MARS_CARRY_CANCEL_CAPTURE, JSON.stringify(captures, null, 2) + '\n');
});
