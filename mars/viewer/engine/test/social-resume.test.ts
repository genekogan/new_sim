import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { z } from 'zod';
import { encode, decode } from '../runtime/codec.ts';
import { SnapshotError } from '../runtime/snapshot.ts';
import { Runtime } from '../runtime/runtime.ts';
import { DEFAULT_INVARIANTS } from '../runtime/invariants.ts';
import { Spatial } from '../spatial/service.ts';
import { provingGround } from '../scenes/proving-ground.ts';
import { emptyWorld, addAll, human, component, FIXTURE } from '../world/factory.ts';
import { walkTo } from '../locomotion/walk.ts';
import { SOCIAL_ACTIONS } from '../social/actions.ts';
import { allSlots } from '../social/slots.ts';
import type { ActionDef } from '../actions/types.ts';

const base = provingGround();
function setup(verb = 'sit') {
  const registry = new Map<string, ActionDef>([['walk_to', walkTo], ...SOCIAL_ACTIONS.map((a) => [a.verb, a] as [string, ActionDef])]);
  const chair = { id: 'chair', kind: 'fixture' as const, def: 'camp-chair', pose: { p: [0, 0, -5] as [number, number, number], yaw: 0 }, provenance: FIXTURE };
  const rt = new Runtime(addAll(emptyWorld('social-resume', base), chair, human('p1', -2, -5), human('p2', -3, -7)), registry, { spatial: new Spatial(base) }, DEFAULT_INVARIANTS);
  const sit = rt.submit(verb, verb === 'sit' ? { actor: 'p1', fixture: 'chair' } : { actor: 'p1', owner: 'chair' });
  for (let i = 0; i < 600 && sit.phase !== 'occupied'; i++) rt.step();
  assert.equal(sit.phase, 'occupied', sit.diagnostic?.message);
  const slot = allSlots(rt).find((s) => s.claimedBy === sit.id)!.id;
  return { rt, sit, slot, registry };
}
const returned = (rt: Runtime, source: string) => [...rt.records.values()].find((r) => r.id.startsWith(`${source}:resume:`));
function finishReturn(rt: Runtime, source: string) {
  for (let i = 0; i < 1000 && returned(rt, source)?.phase !== 'occupied'; i++) rt.step();
  assert.equal(returned(rt, source)?.phase, 'occupied', returned(rt, source)?.diagnostic?.message);
}

test('standalone sit and seated take_slot physically return to the exact resolved seat after a successful directive', () => {
  const captures = [];
  for (const verb of ['sit', 'take_slot']) {
    const { rt, sit, slot } = setup(verb);
    const states = [{ label: 'seated', tick: rt.tick, actor: structuredClone(rt.world.entities.p1) }];
    const w = rt.submit('walk_to', { actor: 'p1', x: -4, z: -7 });
    assert.equal(w.phase, 'pre-empting');
    rt.observers.push({ onTick() {
      if (w.status === 'executing' && !states.some((s) => s.label === 'directive-started')) states.push({ label: 'directive-started', tick: rt.tick, actor: structuredClone(rt.world.entities.p1) });
      if (w.status === 'completed' && !states.some((s) => s.label === 'directive-completed')) states.push({ label: 'directive-completed', tick: rt.tick, actor: structuredClone(rt.world.entities.p1) });
    } });
    finishReturn(rt, sit.id);
    const resume = returned(rt, sit.id)!;
    assert.equal(w.status, 'completed'); assert.equal(sit.status, 'cancelled');
    assert.deepEqual(rt.holder(`slot:${slot}`), [resume.id]);
    assert.equal((resume.params as { slot: string }).slot, slot);
    assert.equal(rt.world.entities.p1.human!.activity, 'sit');
    assert.deepEqual(rt.violations, []);
    states.push({ label: 'returned', tick: rt.tick, actor: structuredClone(rt.world.entities.p1) });
    captures.push({ verb, states, source: sit, directive: w, returned: resume, entities: rt.world.entities, slot, marks: rt.events.filter((e) => e.type === 'mark') });
  }
  if (process.env.SOCIAL_RESUME_CAPTURE) writeFileSync(process.env.SOCIAL_RESUME_CAPTURE, JSON.stringify(captures, null, 2) + '\n');
});

test('a newer explicit directive supersedes the queued return, including a refused newer instruction', () => {
  for (const newer of ['walk_to', 'stand']) {
    const { rt, sit } = setup();
    const w = rt.submit('walk_to', { actor: 'p1', x: -4, z: -7 });
    for (let i = 0; i < 30 && w.phase === 'pre-empting'; i++) rt.step();
    const n = rt.submit(newer, newer === 'walk_to' ? { actor: 'p1', x: -8, z: -7 } : { actor: 'p1' });
    assert.equal(n.status, 'failed');
    assert.ok(rt.runUntilIdle(600));
    assert.equal(w.status, 'completed'); assert.equal(returned(rt, sit.id), undefined);
    assert.ok(rt.events.some((e) => e.type === 'mark' && e.name === 'social.resume-skipped' && (e.data as { reason: string }).reason === 'newer-directive'));
  }
});

test('cancelled or failed directives explicitly skip returning, including cancellation during stand-up', () => {
  for (const mode of ['cancel-waiting', 'cancel-running', 'failed']) {
    const { rt, sit } = setup();
    const w = rt.submit('walk_to', { actor: 'p1', x: mode === 'failed' ? 499 : -4, z: -7 });
    if (mode === 'cancel-waiting') rt.cancel(w.id);
    else {
      for (let i = 0; i < 30 && w.phase === 'pre-empting'; i++) rt.step();
      if (mode === 'cancel-running') rt.cancel(w.id);
    }
    assert.ok(rt.runUntilIdle(600));
    assert.equal(returned(rt, sit.id), undefined);
    assert.ok(rt.events.some((e) => e.type === 'mark' && e.name === 'social.resume-skipped'));
    assert.deepEqual(rt.violations, []);
  }
});

test('return refuses an occupied or deleted exact seat instead of selecting another seat', () => {
  for (const mode of ['occupied', 'deleted']) {
    const { rt, sit, slot } = setup();
    const w = rt.submit('walk_to', { actor: 'p1', x: -9, z: -9 });
    for (let i = 0; i < 40 && w.phase === 'pre-empting'; i++) rt.step();
    if (mode === 'occupied') {
      const other = rt.submit('sit', { actor: 'p2', slot });
      assert.equal(other.status, 'executing', other.diagnostic?.message);
    } else delete rt.world.entities.chair; // explicit invalidation fixture, after sitter stands off it
    assert.ok(rt.runUntilIdle(600, [w.id]));
    const resume = returned(rt, sit.id)!;
    assert.equal(resume.status, 'failed');
    assert.ok(resume.diagnostic?.code.startsWith('slot.') || resume.diagnostic?.code === 'reservation.conflict' || resume.diagnostic?.code === 'entity.unknown', resume.diagnostic?.message);
    assert.ok(rt.events.some((e) => e.type === 'mark' && e.name === 'social.resume-refused'));
  }
});

test('snapshot while the directive walks preserves exactly one queued return and identical continuation', () => {
  const { rt, sit, registry } = setup();
  const w = rt.submit('walk_to', { actor: 'p1', x: -4, z: -7 });
  for (let i = 0; i < 40 && w.phase === 'pre-empting'; i++) rt.step();
  rt.step();
  const snap = JSON.parse(JSON.stringify(rt.snapshot())), cursor = rt.events.length;
  const restored = Runtime.restore(snap, registry, { spatial: new Spatial(base) }, DEFAULT_INVARIANTS);
  for (let i = 0; i < 400; i++) { rt.step(); restored.step(); }
  assert.equal(restored.stateHash(), rt.stateHash());
  assert.deepEqual(restored.events, rt.events.slice(cursor));
  assert.equal([...restored.records.values()].filter((r) => r.id.startsWith(`${sit.id}:resume:`)).length, 1);
  assert.equal(returned(restored, sit.id)?.phase, 'occupied');
});

test('return refuses an unreachable seat and never releases a held load to resume', () => {
  {
    const { rt, sit } = setup();
    const w = rt.submit('walk_to', { actor: 'p1', x: -9, z: -9 });
    rt.observers.push({ onEvent(_rt, e) {
      if (e.type === 'action' && e.id === w.id && e.status === 'completed') {
        // Explicit geometry-invalidation fixture after the directive has left the seat.
        rt.services.spatial = new Spatial({ ...base, obstacles: [...base.obstacles, { id: 'seat-enclosure', obb: { c: [0, -5], half: [2.5, 2.5], yaw: 0 }, y0: 0, y1: 3 }] });
      }
    } });
    assert.ok(rt.runUntilIdle(600, [w.id]));
    assert.equal(returned(rt, sit.id)?.status, 'failed');
    assert.equal(returned(rt, sit.id)?.diagnostic?.code, 'slot.unreachable');
  }
  {
    const { rt, sit } = setup();
    // A fixture directive establishes a supported hand-held object, then completes. Return must
    // go through readyActor's normal holding refusal, never clear that support to regain the seat.
    const hold: ActionDef<{ actor: string }, null, { actor: string }> = {
      verb: 'fixture-hold', description: 'Establish a held support for the return refusal control', schema: z.object({ actor: z.string() }),
      reservations: (_w, p) => [{ resource: `actor:${p.actor}`, mode: 'exclusive' }, { resource: 'entity:load', mode: 'exclusive' }],
      plan: () => ({ ok: true, program: null }), start: (_rt, p) => p,
      step(worldRt, ex) {
        const a = worldRt.world.entities[ex.actor];
        a.human!.grip = { entity: 'load', slot: 'fixture-grip' };
        worldRt.world.entities.load.support = { kind: 'held', by: [ex.actor] };
        worldRt.world.entities.load.phase = 'carried';
        return { status: 'completed' };
      }, cancel: () => ({ ok: true }),
    };
    rt.world.entities.load = component('load', '2x4-8ft', [4, 0, -5], 0);
    rt.registry.set(hold.verb, hold);
    const d = rt.submit(hold.verb, { actor: 'p1' });
    assert.ok(rt.runUntilIdle(100, [d.id]));
    assert.equal(returned(rt, sit.id)?.diagnostic?.code, 'actor.holding');
    assert.deepEqual(rt.world.entities.load.support, { kind: 'held', by: ['p1'] });
    assert.equal(rt.world.entities.p1.human!.grip?.entity, 'load');
  }
});


test('a queue-free old-format snapshot restores normally without inventing a return', () => {
  const { rt, registry } = setup();
  assert.equal(rt.services.socialReturns, undefined);
  const restored = Runtime.restore(JSON.parse(JSON.stringify(rt.snapshot())), registry, { spatial: new Spatial(base) }, DEFAULT_INVARIANTS);
  const cursor = rt.events.length;
  for (let i = 0; i < 5; i++) { rt.step(); restored.step(); }
  assert.equal(restored.services.socialReturns, undefined);
  assert.equal(restored.stateHash(), rt.stateHash());
  assert.deepEqual(restored.events, rt.events.slice(cursor));
});


test('a pre-empting child returns only after its outer directive completes, not between that directive’s children', () => {
  const { rt, sit } = setup();
  const parent: ActionDef<{ actor: string }, null, { child: string; after: number }> = {
    verb: 'directed-parent', description: 'Parent with work after its walking child', schema: z.object({ actor: z.string() }),
    reservations: () => [], plan: () => ({ ok: true, program: null }),
    start(worldRt, p, _program, id) { return { child: worldRt.submit('walk_to', { actor: p.actor, x: -4, z: -7 }, { parent: id }).id, after: 0 }; },
    step(worldRt, ex) {
      if (worldRt.isActive(ex.child)) return { status: 'running' };
      return ++ex.after < 10 ? { status: 'running' } : { status: 'completed' };
    }, cancel: () => ({ ok: true }),
  };
  rt.registry.set(parent.verb, parent);
  const p = rt.submit(parent.verb, { actor: 'p1' });
  while (rt.isActive(p.id) && rt.tick < 600) {
    assert.equal(returned(rt, sit.id), undefined, 'return cannot run ahead of parent completion'); rt.step();
  }
  assert.equal(p.status, 'completed');
  finishReturn(rt, sit.id);
  assert.equal(returned(rt, sit.id)?.id, `${sit.id}:resume:${p.id}`);
  assert.deepEqual(rt.violations, []);
});

test('waiting snapshots resume tick-exact before/mid stand-up with cancel and newer-directive controls', () => {
  const captures = [];
  for (const ticks of [0, 5]) for (const control of ['continue', 'cancel', 'newer']) {
    const { rt, sit, registry } = setup();
    const w = rt.submit('walk_to', { actor: 'p1', x: -4, z: -7 });
    for (let i = 0; i < ticks; i++) rt.step();
    assert.equal(w.phase, 'pre-empting');
    const snap = JSON.parse(JSON.stringify(rt.snapshot())), cursor = rt.events.length;
    const restored = Runtime.restore(snap, registry, { spatial: new Spatial(base) }, DEFAULT_INVARIANTS);
    assert.equal(restored.records.get(w.id)?.status, 'requested');
    assert.deepEqual(restored.holder('actor:p1'), [sit.id]);
    for (const r of [rt, restored]) {
      if (control === 'cancel') r.cancel(w.id);
      if (control === 'newer') r.submit('walk_to', { actor: 'p1', x: -8, z: -7 });
    }
    for (let i = 0; i < 420; i++) { rt.step(); restored.step(); assert.equal(restored.stateHash(), rt.stateHash()); }
    assert.deepEqual(restored.events, rt.events.slice(cursor));
    assert.deepEqual([...restored.records], [...rt.records]);
    assert.deepEqual(restored.violations, []);
    assert.equal(returned(restored, sit.id)?.phase, control === 'continue' ? 'occupied' : undefined);
    if (control === 'cancel') assert.ok(!restored.records.get(w.id)!.history.some((h) => h.status === 'executing'));
    captures.push({ ticks, control, pause: { tick: snap.tick, hash: snap.stateHash }, result: { world: restored.world, records: [...restored.records.values()], violations: restored.violations } });
  }
  if (process.env.PREEMPT_SNAPSHOT_CAPTURE) writeFileSync(process.env.PREEMPT_SNAPSHOT_CAPTURE, JSON.stringify(captures, null, 2) + '\n');
});

test('waiting snapshot rejects invalid provenance, unknown registry and discarded stand-up dependencies', () => {
  const { rt, sit, registry } = setup();
  const w = rt.submit('walk_to', { actor: 'p1', x: -4, z: -7 });
  const snap = rt.snapshot();
  const noWalk = new Map(registry); noWalk.delete('walk_to');
  assert.throws(() => Runtime.restore(snap, noWalk, { spatial: new Spatial(base) }), (e: unknown) => e instanceof SnapshotError && e.code === 'snapshot.unknown-verb');
  for (const mutation of ['missing-hold', 'self-parent', 'params', 'duplicate', 'reserved', 'omitted-array', 'omitted-entry']) {
    const bad = structuredClone(snap);
    const graph = decode(bad.data) as { waiting: { id: string; holds: string[]; parent?: string; params: unknown }[]; records: { id: string; parent?: string }[]; owners: [string, { action: string; mode: string }[]][] };
    const waiting = graph.waiting[0];
    if (mutation === 'missing-hold') waiting.holds = ['missing'];
    if (mutation === 'self-parent') { waiting.parent = w.id; graph.records.find((r) => r.id === w.id)!.parent = w.id; }
    if (mutation === 'params') waiting.params = { actor: 'p1', x: 99, z: 99 };
    if (mutation === 'duplicate') graph.waiting.push(waiting);
    if (mutation === 'reserved') graph.owners.push(['extra', [{ action: w.id, mode: 'exclusive' }]]);
    if (mutation === 'omitted-array') delete (graph as { waiting?: unknown }).waiting;
    if (mutation === 'omitted-entry') graph.waiting = [];
    bad.data = encode(graph);
    assert.throws(() => Runtime.restore(bad, registry, { spatial: new Spatial(base) }), (e: unknown) => e instanceof SnapshotError && e.code === 'snapshot.waiting-invalid', mutation);
  }
  const def = registry.get(sit.verb)!;
  const original = def.resumable;
  try {
    def.resumable = 'test-only unsupported stand-up';
    assert.throws(() => rt.snapshot({ allowDrop: true }), (e: unknown) => e instanceof SnapshotError && e.code === 'snapshot.waiting-dependency');
  } finally { def.resumable = original; }
});


test('restored social return intents cannot become arbitrary deferred commands or change source seat/person', () => {
  const { rt, registry } = setup();
  rt.submit('walk_to', { actor: 'p1', x: -4, z: -7 });
  const snap = rt.snapshot();
  for (const mutation of ['shape', 'verb', 'actor', 'source', 'directive', 'slot', 'duplicate']) {
    const bad = structuredClone(snap);
    const graph = decode(bad.data) as { services: { socialReturns: { source: string; directive: string; actor: string; verb: string; params: { actor: string; slot: string } }[] | object } };
    const queue = graph.services.socialReturns as { source: string; directive: string; actor: string; verb: string; params: { actor: string; slot: string } }[];
    if (mutation === 'shape') graph.services.socialReturns = {};
    if (mutation === 'verb') { queue[0].verb = 'walk_to'; queue[0].params = { actor: 'p1', x: 2, z: 2 } as unknown as typeof queue[0]['params']; }
    if (mutation === 'actor') { queue[0].actor = 'p2'; queue[0].params.actor = 'p2'; }
    if (mutation === 'source') queue[0].source = queue[0].directive;
    if (mutation === 'directive') queue[0].directive = 'absent';
    if (mutation === 'slot') queue[0].params.slot = 'different-chair#seat';
    if (mutation === 'duplicate') queue.push(queue[0]);
    bad.data = encode(graph);
    assert.throws(() => Runtime.restore(bad, registry, { spatial: new Spatial(base) }), (e: unknown) => e instanceof SnapshotError && e.code === 'snapshot.return-invalid', mutation);
  }
});

test('take_slot return snapshot preserves its original activity and rejects an altered activity', () => {
  const { rt, registry } = setup('take_slot');
  rt.submit('walk_to', { actor: 'p1', x: -4, z: -7 });
  const snap = rt.snapshot(), cursor = rt.events.length;
  const restored = Runtime.restore(snap, registry, { spatial: new Spatial(base) }, DEFAULT_INVARIANTS);
  for (let i = 0; i < 360; i++) { rt.step(); restored.step(); }
  assert.equal(restored.stateHash(), rt.stateHash());
  assert.deepEqual(restored.events, rt.events.slice(cursor));
  const bad = structuredClone(snap);
  const graph = decode(bad.data) as { services: { socialReturns: { params: { activity: string } }[] } };
  graph.services.socialReturns[0].params.activity = 'watch';
  bad.data = encode(graph);
  assert.throws(() => Runtime.restore(bad, registry, { spatial: new Spatial(base) }), (e: unknown) => e instanceof SnapshotError && e.code === 'snapshot.return-invalid');
});
