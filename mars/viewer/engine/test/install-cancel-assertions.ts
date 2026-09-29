import assert from 'node:assert/strict';
import { hypot } from '../core/math.ts';
import type { Runtime } from '../runtime/runtime.ts';
import { entityFootprint } from '../spatial/service.ts';

/** Exercise actual lifting and ownership; a diagnostic alone is not proof of a safe refusal. */
export function checkInstallCancellation(rt: Runtime, verb: string, params: { crew: string[] } & Record<string, unknown>, item: string, code: string, groundTranslation = false) {
  const e = rt.world.entities[item];
  const original = structuredClone(e);
  const resources = rt.registry.get(verb)!.reservations(rt.world, params).map((r) => r.resource);
  const early = rt.submit(verb, params);
  assert.ok(rt.isActive(early.id), early.diagnostic?.message);
  assert.equal(rt.cancel(early.id).status, 'cancelled', 'pre-lift cancellation remains available');
  assert.deepEqual(e.pose, original.pose);
  assert.deepEqual(e.support, original.support);
  for (const resource of resources) assert.ok(!rt.holder(resource).includes(early.id), `${resource} released before pickup`);

  const r = rt.submit(verb, params);
  const floor = entityFootprint(e).y0;
  const moved = () => groundTranslation ? hypot(e.pose.p[0] - original.pose.p[0], e.pose.p[2] - original.pose.p[2]) > 0.05 : entityFootprint(e).y0 > floor + 0.05;
  for (let tick = 0; tick < 3600 && rt.isActive(r.id) && !(e.phase === 'carried' && moved()); tick++) rt.step();
  assert.ok(rt.isActive(r.id), `${verb} did not reach mid-lift: ${r.status} ${r.diagnostic?.message}`);
  assert.equal(e.phase, 'carried');
  assert.ok(moved(), 'cancellation occurs after physical displacement, not at a phase boundary');
  if (groundTranslation) assert.equal(entityFootprint(e).y0, floor, 'stair flight stays on the floor during its carried translation');
  else assert.ok(entityFootprint(e).y0 > floor + 0.05, 'load is genuinely above its initial support');
  assert.deepEqual(e.support, { kind: 'held', by: params.crew });
  for (const actor of params.crew) assert.equal(rt.world.entities[actor].human?.grip?.entity, item);
  const before = structuredClone(rt.world);
  const owners = resources.map((resource) => rt.holder(resource));
  for (const holders of owners) assert.ok(holders.includes(r.id), 'lift owns every reserved resource');
  for (let attempt = 0; attempt < 2; attempt++) {
    const cancelled = rt.cancel(r.id);
    assert.equal(cancelled.diagnostic?.code, code);
    assert.ok(cancelled.diagnostic?.subjects?.includes(item));
    assert.ok(rt.isActive(r.id), 'unsafe cancel leaves the lift active');
    assert.deepEqual(rt.world, before, 'refusal cannot move the load, release hands or change support');
    assert.deepEqual(resources.map((resource) => rt.holder(resource)), owners, 'refusal retains every resource');
  }
  const competing = rt.submit('walk_to', { actor: params.crew[0], x: -6, z: -6 });
  assert.equal(competing.status, 'failed');
  assert.equal(competing.diagnostic?.code, 'actor.holding');
  assert.deepEqual(rt.world, before, 'a competing walk cannot steal or move the load holder');
  rt.runUntilIdle(3600, [r.id]);
  assert.equal(r.status, 'completed', r.diagnostic?.message);
  assert.equal(e.phase, 'installed');
  const support = rt.world.entities[item].support;
  assert.ok(support?.kind === 'connected' || support?.kind === 'resting-on', 'completion has physical support');
  assert.ok(e.connections?.length, 'completion records its supports');
  for (const actor of params.crew) {
    assert.equal(rt.world.entities[actor].human?.grip, undefined);
    assert.equal(rt.world.entities[actor].human?.task, undefined);
  }
  for (const resource of resources) assert.ok(!rt.holder(resource).includes(r.id), `${resource} released at completion`);
  assert.deepEqual(rt.violations, []);
}
