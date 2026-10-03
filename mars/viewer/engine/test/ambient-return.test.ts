import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { Runtime } from '../runtime/runtime.ts';
import { DEFAULT_INVARIANTS } from '../runtime/invariants.ts';
import { Spatial } from '../spatial/service.ts';
import { provingGround } from '../scenes/proving-ground.ts';
import { addAll, emptyWorld, human, component, FIXTURE } from '../world/factory.ts';
import { walkTo } from '../locomotion/walk.ts';
import { SOCIAL_ACTIONS } from '../social/actions.ts';
import { pointInPolygon } from '../social/slots.ts';
import { decode, encode } from '../runtime/codec.ts';
import { SnapshotError } from '../runtime/snapshot.ts';
import type { ActionDef } from '../actions/types.ts';

const base = provingGround(), polygon: [number, number][] = [[-10,-10],[-3,-10],[-3,-3],[-10,-3]];
function setup(walking = true) {
  const registry = new Map<string, ActionDef>([['walk_to', walkTo], ...SOCIAL_ACTIONS.map((a) => [a.verb, a] as [string, ActionDef])]);
  const world = addAll(emptyWorld('ambient-return', base), human('person', -6, -6));
  world.regions.lawn = { id: 'lawn', label: 'lawn', kind: 'place', polygon, provenance: FIXTURE };
  const rt = new Runtime(world, registry, { spatial: new Spatial(base) }, DEFAULT_INVARIANTS);
  const ambient = rt.submit('ambient_wander', { actors: ['person'], region: 'lawn', seed: 7 });
  if (walking) for (let i = 0; i < 80 && !rt.holder('actor:person').length; i++) rt.step();
  return { rt, ambient, registry };
}
const adopted = (rt: Runtime) => rt.events.find((e) => e.type === 'mark' && e.name === 'ambient.readopted');
function wait(rt: Runtime, done: () => boolean) {
  for (let i = 0; i < 1000 && !done(); i++) rt.step();
  assert.ok(done());
}

test('directed ambient participant physically walks back into its region after successful work', () => {
  const { rt, ambient } = setup();
  const states = [{ label: 'ambient', tick: rt.tick, actor: structuredClone(rt.world.entities.person) }];
  const directive = rt.submit('walk_to', { actor: 'person', x: -11, z: -6 });
  assert.equal(directive.status, 'executing', directive.diagnostic?.message);
  wait(rt, () => !rt.isActive(directive.id));
  assert.equal(directive.status, 'completed');
  assert.equal(adopted(rt), undefined);
  states.push({ label: 'directive-completed', tick: rt.tick, actor: structuredClone(rt.world.entities.person) });
  wait(rt, () => !!adopted(rt));
  const event = adopted(rt)!;
  assert.equal(event.type, 'mark');
  const child = rt.records.get((event.data as { walk: string }).walk)!;
  assert.equal(child.parent, ambient.id);
  wait(rt, () => child.status === 'completed');
  assert.ok(pointInPolygon([rt.world.entities.person.pose.p[0], rt.world.entities.person.pose.p[2]], polygon));
  assert.deepEqual(rt.violations, []);
  assert.ok(rt.holder('actor:person').length <= 1);
  states.push({ label: 'physically-returned', tick: rt.tick, actor: structuredClone(rt.world.entities.person) });
  if (process.env.AMBIENT_RETURN_CAPTURE) writeFileSync(process.env.AMBIENT_RETURN_CAPTURE, JSON.stringify({ states, records: [...rt.records.values()], marks: rt.events.filter((e) => e.type === 'mark'), violations: rt.violations }, null, 2) + '\n');
});

test('ambient return refuses failed/cancelled/newer directives, held items, groups and missing region', () => {
  for (const mode of ['failed', 'cancelled', 'newer', 'held', 'held-item', 'group', 'region']) {
    const { rt, ambient } = setup();
    const directive = rt.submit('walk_to', { actor: 'person', x: mode === 'failed' ? 499 : -11, z: -6 });
    if (mode === 'cancelled') rt.cancel(directive.id);
    if (mode === 'newer') rt.submit('walk_to', { actor: 'person', x: -12, z: -6 });
    wait(rt, () => !rt.isActive(directive.id));
    if (mode === 'held') {
      // Explicit post-directive invalidation fixture, not a pickup physics claim.
      rt.world.entities.load = component('load', 'beam-9ft', [-11,1,-6], 0, { phase: 'carried', support: { kind: 'held', by: ['person'] } });
      rt.world.entities.person.human!.grip = { entity: 'load', slot: 'left' };
    }
    if (mode === 'held-item') rt.world.entities.cup = component('cup', 'cup', [-11, 1, -6], 0, { phase: 'carried', support: { kind: 'in-hand', by: 'person', hand: 'left' } });
    if (mode === 'region') delete rt.world.regions.lawn;
    if (mode === 'group') {
      rt.world.entities.other = human('other', -12, -8);
      const group = rt.submit('converse', { actors: ['person', 'other'], at: [-11, -7] });
      assert.equal(group.status, 'executing', group.diagnostic?.message);
    }
    for (let i = 0; i < 220; i++) rt.step();
    assert.equal(adopted(rt), undefined, mode);
    assert.ok(rt.events.some((e) => e.type === 'mark' && e.name === 'ambient.return-skipped'), mode);
    assert.equal(ambient.status, 'completed', mode);
    if (mode === 'held-item') assert.deepEqual(rt.world.entities.cup.support, { kind: 'in-hand', by: 'person', hand: 'left' });
    if (mode === 'held') assert.deepEqual(rt.world.entities.load.support, { kind: 'held', by: ['person'] });
  }
});

test('ambient snapshots continue tick-exact before intervention, awaiting work and physically returning', () => {
  for (const stage of ['ordinary', 'waiting', 'returning', 'pause']) {
    const { rt, registry } = setup(stage !== 'pause');
    if (stage === 'waiting' || stage === 'returning') {
      rt.submit('walk_to', { actor: 'person', x: -11, z: -6 });
      if (stage === 'returning') wait(rt, () => !!adopted(rt));
    }
    const snap = rt.snapshot(), cursor = rt.events.length;
    const restored = Runtime.restore(snap, registry, { spatial: new Spatial(base) }, DEFAULT_INVARIANTS);
    for (let i = 0; i < 400; i++) { rt.step(); restored.step(); assert.equal(restored.stateHash(), rt.stateHash()); assert.ok(restored.holder('actor:person').length <= 1); }
    assert.deepEqual(restored.events, rt.events.slice(cursor));
    assert.deepEqual(restored.violations, []);
    if (stage === 'waiting') {
      const bad = structuredClone(snap);
      const graph = decode(bad.data) as { live: { exec: { who?: { resume?: { directive: string } }[] } }[] };
      graph.live.find((l) => l.exec.who)!.exec.who![0].resume!.directive = 'missing';
      bad.data = encode(graph);
      assert.throws(() => Runtime.restore(bad, registry, { spatial: new Spatial(base) }), (e: unknown) => e instanceof SnapshotError && e.code === 'snapshot.ambient-invalid');
    }
  }
});


test('ambient return payload omission and duplicate membership refuse snapshot restore', () => {
  const { rt, registry } = setup(false);
  rt.submit('walk_to', { actor: 'person', x: -11, z: -6 });
  const snap = rt.snapshot();
  for (const mutation of ['omitted', 'duplicate']) {
    const bad = structuredClone(snap);
    const graph = decode(bad.data) as { live: { exec: { who?: { resume?: unknown }[] } }[] };
    const who = graph.live.find((l) => l.exec.who)!.exec.who!;
    if (mutation === 'omitted') delete who[0].resume;
    else who.push(who[0]);
    bad.data = encode(graph);
    assert.throws(() => Runtime.restore(bad, registry, { spatial: new Spatial(base) }), (e: unknown) => e instanceof SnapshotError && e.code === 'snapshot.ambient-invalid');
  }
});

test('an explicit manual cancellation of an ambient walk remains a permanent release', () => {
  const { rt, ambient } = setup();
  const child = rt.holder('actor:person')[0];
  rt.cancel(child);
  const directive = rt.submit('walk_to', { actor: 'person', x: -11, z: -6 });
  wait(rt, () => !rt.isActive(directive.id));
  for (let i = 0; i < 160; i++) rt.step();
  assert.equal(adopted(rt), undefined);
  assert.equal(ambient.status, 'completed');
});

test('a directive during an ambient pause blocks new background walks until successful completion', () => {
  const { rt, ambient } = setup(false);
  const directive = rt.submit('walk_to', { actor: 'person', x: -11, z: -6 });
  while (rt.isActive(directive.id)) {
    assert.ok(![...rt.records.values()].some((r) => r.parent === ambient.id));
    rt.step();
  }
  wait(rt, () => !!adopted(rt));
  assert.ok(rt.holder('actor:person').length <= 1);
  assert.deepEqual(rt.violations, []);
});
