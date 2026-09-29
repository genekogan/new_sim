import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { writeFileSync } from 'node:fs';
import { Runtime } from '../runtime/runtime.ts';
import { DEFAULT_INVARIANTS } from '../runtime/invariants.ts';
import { Spatial } from '../spatial/service.ts';
import { provingGround } from '../scenes/proving-ground.ts';
import { addAll, emptyWorld, human, component } from '../world/factory.ts';
import { walkTo } from '../locomotion/walk.ts';
import { SOCIAL_ACTIONS } from '../social/actions.ts';
import { decode, encode } from '../runtime/codec.ts';
import { SnapshotError } from '../runtime/snapshot.ts';
import type { ActionDef } from '../actions/types.ts';

const base = provingGround();
function setup(duration?: number) {
  const registry = new Map<string, ActionDef>([['walk_to', walkTo], ...SOCIAL_ACTIONS.map((a) => [a.verb, a] as [string, ActionDef])]);
  const rt = new Runtime(addAll(emptyWorld('converse-return', base), human('a', -5, -6), human('b', -6, -4), human('c', -4, -4)), registry, { spatial: new Spatial(base) }, DEFAULT_INVARIANTS);
  const group = rt.submit('converse', { actors: ['a', 'b', 'c'], at: [-5, -5], ...(duration ? { duration } : {}) });
  for (let i = 0; i < 500 && group.phase !== 'talking'; i++) rt.step();
  assert.equal(group.phase, 'talking', group.diagnostic?.message);
  return { rt, group, registry, original: structuredClone(rt.world.entities.a.pose), others: ['b', 'c'].map((id) => structuredClone(rt.world.entities[id])) };
}
function wait(rt: Runtime, done: () => boolean) {
  for (let i = 0; i < 700 && !done(); i++) rt.step();
  assert.ok(done());
}
const rejoined = (rt: Runtime) => rt.events.some((e) => e.type === 'mark' && e.name === 'converse.rejoined');

test('three-person conversation retains two talking while one walks a directive and physically rejoins', () => {
  const { rt, group, original, others } = setup();
  const states = [{ label: 'formed', tick: rt.tick, world: structuredClone(rt.world) }];
  const walk = rt.submit('walk_to', { actor: 'a', x: -9, z: -8 });
  assert.equal(walk.status, 'executing', walk.diagnostic?.message);
  assert.equal(group.status, 'executing');
  for (let i = 0; i < 700 && !rejoined(rt); i++) {
    rt.step();
    for (const other of others) { assert.deepEqual(rt.world.entities[other.id].pose, other.pose); assert.equal(rt.world.entities[other.id].human!.activity, 'talk'); assert.deepEqual(rt.holder(`actor:${other.id}`), [group.id]); }
    if (rt.records.get(walk.id)?.status === 'completed' && states.length === 1) states.push({ label: 'directive-completed', tick: rt.tick, world: structuredClone(rt.world) });
  }
  assert.ok(rejoined(rt));
  assert.ok(Math.hypot(rt.world.entities.a.pose.p[0] - original.p[0], rt.world.entities.a.pose.p[2] - original.p[2]) <= 0.05, 'returns to the same circle station within ordinary walk arrival tolerance');
  assert.equal(rt.world.entities.a.pose.yaw, original.yaw);
  assert.deepEqual(rt.holder('actor:a'), [group.id]);
  assert.deepEqual(rt.violations, []);
  states.push({ label: 'rejoined', tick: rt.tick, world: structuredClone(rt.world) });
  if (process.env.CONVERSE_RETURN_CAPTURE) writeFileSync(process.env.CONVERSE_RETURN_CAPTURE, JSON.stringify({ states, records: [...rt.records.values()], marks: rt.events.filter((e) => e.type === 'mark') }, null, 2) + '\n');
});

test('conversation return skips failed/cancelled/newer directives and ended/deleted/occupied/held cases', () => {
  for (const mode of ['failed', 'cancelled', 'newer', 'ended', 'deleted', 'occupied', 'held']) {
    const { rt, group, original } = setup();
    const walk = rt.submit('walk_to', { actor: 'a', x: mode === 'failed' ? 499 : -9, z: -8 });
    if (mode === 'cancelled') rt.cancel(walk.id);
    if (mode === 'newer') rt.submit('walk_to', { actor: 'a', x: -10, z: -9 });
    if (mode === 'ended') rt.cancel(group.id);
    wait(rt, () => !rt.isActive(walk.id));
    // Explicit world-invalidation fixtures after the successful directive, before return admission.
    if (mode === 'deleted') delete rt.world.entities.a;
    if (mode === 'occupied') rt.world.entities.visitor = human('visitor', original.p[0], original.p[2]);
    if (mode === 'held') {
      rt.world.entities.load = component('load', 'beam-9ft', [-9, 1, -8], 0, { phase: 'carried', support: { kind: 'held', by: ['a'] } });
      rt.world.entities.a.human!.grip = { entity: 'load', slot: 'left' };
    }
    for (let i = 0; i < 400; i++) rt.step();
    assert.ok(!rejoined(rt), mode);
    if (mode !== 'ended') { assert.equal(group.status, 'executing', mode); assert.deepEqual(rt.holder('actor:b'), [group.id]); }
    if (mode === 'held') assert.deepEqual(rt.world.entities.load.support, { kind: 'held', by: ['a'] });
  }
});

test('conversation departure and returning walk snapshots continue identically and corrupt queues refuse', () => {
  for (const stage of ['away', 'returning']) {
    const { rt, registry } = setup();
    const walk = rt.submit('walk_to', { actor: 'a', x: -9, z: -8 });
    if (stage === 'returning') { wait(rt, () => walk.status === 'completed'); rt.step(); rt.step(); }
    const snap = rt.snapshot(), cursor = rt.events.length;
    const restored = Runtime.restore(snap, registry, { spatial: new Spatial(base) }, DEFAULT_INVARIANTS);
    for (let i = 0; i < 400; i++) { rt.step(); restored.step(); assert.equal(restored.stateHash(), rt.stateHash()); }
    assert.deepEqual(restored.events, rt.events.slice(cursor));
    assert.ok(rejoined(restored));
    const bad = structuredClone(snap);
    const graph = decode(bad.data) as { live: { exec: { departures?: { actor: string; directive: string }[] } }[] };
    const ex = graph.live.find((l) => l.exec.departures)!.exec;
    ex.departures![0].directive = 'missing'; bad.data = encode(graph);
    assert.throws(() => Runtime.restore(bad, registry, { spatial: new Spatial(base) }), (e: unknown) => e instanceof SnapshotError && e.code === 'snapshot.converse-return-invalid');
  }
});


test('all directive conflicts are checked before detaching any group member', () => {
  const { rt, group } = setup();
  rt.world.entities.busy = human('busy', -10, -8);
  const busy = rt.submit('walk_to', { actor: 'busy', x: -10, z: -10 });
  assert.equal(busy.status, 'executing', busy.diagnostic?.message);
  rt.registry.set('two_claims', { ...walkTo, verb: 'two_claims', reservations: () => [{ resource: 'actor:a', mode: 'exclusive' }, { resource: 'actor:busy', mode: 'exclusive' }] });
  const before = structuredClone(rt.world);
  const action = rt.submit('two_claims', { actor: 'a', x: -9, z: -8 });
  assert.equal(action.status, 'failed');
  assert.equal(action.diagnostic?.code, 'reservation.conflict');
  assert.deepEqual(rt.world, before);
  assert.deepEqual(rt.holder('actor:a'), [group.id]);
  assert.ok(!rt.events.some((e) => e.type === 'mark' && e.name === 'converse.member-left'));
});

test('a newer instruction during return never cancels or steals the remaining group', () => {
  const { rt, group } = setup();
  const walk = rt.submit('walk_to', { actor: 'a', x: -9, z: -8 });
  wait(rt, () => walk.status === 'completed'); rt.step(); rt.step();
  const newer = rt.submit('walk_to', { actor: 'a', x: -11, z: -8 });
  assert.equal(newer.status, 'executing', newer.diagnostic?.message);
  wait(rt, () => newer.status === 'completed');
  assert.equal(group.status, 'executing');
  assert.deepEqual(rt.holder('actor:b'), [group.id]);
  assert.ok(!rejoined(rt));
  assert.deepEqual(rt.violations, []);
  assert.doesNotThrow(() => Runtime.restore(rt.snapshot(), rt.registry, { spatial: new Spatial(base) }, DEFAULT_INVARIANTS));
});

test('missing or duplicated conversation member-return state refuses restoration', () => {
  const { rt, registry } = setup();
  rt.submit('walk_to', { actor: 'a', x: -9, z: -8 });
  const snap = rt.snapshot();
  for (const mutation of ['omit', 'duplicate', 'actor', 'station']) {
    const bad = structuredClone(snap);
    const graph = decode(bad.data) as { live: { exec: { departures?: { actor: string; station: unknown }[] } }[] };
    const ex = graph.live.find((l) => l.exec.departures)!.exec;
    if (mutation === 'omit') delete ex.departures;
    if (mutation === 'duplicate') ex.departures!.push(ex.departures![0]);
    if (mutation === 'actor') ex.departures![0].actor = 'unknown';
    if (mutation === 'station') ex.departures![0].station = {};
    bad.data = encode(graph);
    assert.throws(() => Runtime.restore(bad, registry, { spatial: new Spatial(base) }), (e: unknown) => e instanceof SnapshotError && e.code === 'snapshot.converse-return-invalid', mutation);
  }
});


test('finite conversation duration cancels a still-walking return and leaves no orphaned claim', () => {
  const { rt, group } = setup(8);
  rt.submit('walk_to', { actor: 'a', x: -9, z: -8 });
  wait(rt, () => rt.events.some((e) => e.type === 'mark' && e.name === 'converse.return-started'));
  wait(rt, () => group.status === 'completed');
  assert.ok(!rejoined(rt), 'duration expires before the return finishes');
  for (const rec of rt.records.values()) if (rec.parent === group.id) assert.ok(!rt.isActive(rec.id));
  for (const actor of ['a', 'b', 'c']) assert.deepEqual(rt.holder(`actor:${actor}`), []);
  assert.deepEqual(rt.violations, []);
});


test('member return waits for the outer directive and does not mistake its child work for a newer instruction', () => {
  const { rt } = setup();
  const parent: ActionDef<{ actor: string }, null, { child: string; after: number }> = {
    verb: 'group-directive', description: 'Walk then finish independent parent work', schema: z.object({ actor: z.string() }),
    reservations: () => [], plan: () => ({ ok: true, program: null }),
    start(r, p, _program, id) { return { child: r.submit('walk_to', { actor: p.actor, x: -9, z: -8 }, { parent: id }).id, after: 0 }; },
    step(r, ex) { if (r.isActive(ex.child)) return { status: 'running' }; return ++ex.after < 20 ? { status: 'running' } : { status: 'completed' }; },
    cancel: () => ({ ok: true }),
  };
  rt.registry.set(parent.verb, parent);
  const action = rt.submit(parent.verb, { actor: 'a' });
  for (let i = 0; i < 300 && rt.isActive(action.id); i++) {
    assert.ok(!rt.events.some((e) => e.type === 'mark' && e.name === 'converse.return-started')); rt.step();
  }
  assert.equal(action.status, 'completed');
  wait(rt, () => rejoined(rt));
  assert.deepEqual(rt.violations, []);
});


test('a refusing social cancellation leaves selective conversation membership and ownership unchanged', () => {
  const { rt, group } = setup();
  rt.world.entities.busy = human('busy', -10, -8);
  const refusal: ActionDef<{ actor: string }, null, null> = {
    verb: 'refusal-hold', description: 'Explicit invariant fixture: cancellation refuses', schema: z.object({ actor: z.string() }),
    reservations: (_w, p) => [{ resource: `actor:${p.actor}`, mode: 'exclusive' }],
    plan: () => ({ ok: true, program: null }), start: () => null, step: () => ({ status: 'running' }),
    cancel: () => ({ ok: false, diagnostic: { code: 'fixture.cancel-unsafe', message: 'held support cannot be released' } }),
    yieldTo: (_r, self) => [self.id],
  };
  rt.registry.set(refusal.verb, refusal); rt.submit(refusal.verb, { actor: 'busy' });
  rt.registry.set('mixed-directive', { ...walkTo, verb: 'mixed-directive', reservations: () => [{ resource: 'actor:a', mode: 'exclusive' }, { resource: 'actor:busy', mode: 'exclusive' }] });
  const before = structuredClone(rt.world);
  const action = rt.submit('mixed-directive', { actor: 'a', x: -9, z: -8 });
  assert.equal(action.status, 'failed'); assert.equal(action.diagnostic?.code, 'reservation.conflict');
  assert.deepEqual(rt.world, before);
  assert.deepEqual(rt.holder('actor:a'), [group.id]);
  assert.ok(!rt.events.some((e) => e.type === 'mark' && e.name === 'converse.member-left'));
  assert.equal(rt.world.entities.a.human!.activity, 'talk');
});
