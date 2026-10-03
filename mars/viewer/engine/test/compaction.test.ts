import test from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from '../runtime/runtime.ts';
import { compactRuntime, compactionIssue } from '../runtime/compact.ts';
import { createRegistry, servicesFor, ENGINE_INVARIANTS } from '../api/registry.ts';
import { provingGround } from '../scenes/proving-ground.ts';
import { mealWorld, runMeal } from '../scenarios/meal.ts';

const services = servicesFor({ 'proving-ground': provingGround() });
function start() { const w = mealWorld(); return new Runtime(w, createRegistry(), services(w), ENGINE_INVARIANTS); }
function leaveSeats(rt: Runtime) {
  for (const id of ['p1', 'p2', 'p3', 'p4']) {
    const r = rt.submit('stand', { actor: id }, { id: `quiet-${rt.tick}-${id}` });
    assert.notEqual(r.status, 'failed', r.diagnostic?.message);
  }
  rt.runUntilIdle(1000, [...rt.records.values()].filter(r => r.verb === 'stand').map(r => r.id));
  for (const prefix of ['bowl', 'spoon']) {
    const ids = ['p1', 'p2', 'p3', 'p4'].map((actor, i) => {
      const r = rt.submit('put_item', { actor, item: `${prefix}${i + 1}`, surfaceSlot: 'ground' });
      assert.notEqual(r.status, 'failed', r.diagnostic?.message);
      return r.id;
    });
    rt.runUntilIdle(1000, ids);
  }
  rt.runUntilIdle(10);
  assert.equal(compactionIssue(rt), null);
}

test('standalone completed supper compacts from WorldState alone and continues identically', () => {
  const original = start();
  runMeal(original);
  leaveSeats(original);
  const before = structuredClone(original.world), fresh = compactRuntime(original, services);
  assert.deepEqual(fresh.world, before);
  assert.equal(fresh.records.size, 0);
  assert.equal(fresh.events.length, 0);
  // Food, bowls and spoons retain their exact identities and conserved quantities.
  for (const rt of [original, fresh]) rt.submit('walk_to', { actor: 'p1', x: -10, z: -4 }, { id: 'after-compaction-walk' });
  for (let i = 0; i < 400; i++) {
    original.step(); fresh.step();
    assert.equal(fresh.stateHash(), original.stateHash(), `continuation tick ${i}`);
  }
  assert.deepEqual(fresh.violations, []);
});

test('mid-supper refuses compaction without mutating the world; quiet snapshot replay reaches identical supper', () => {
  const reference = start();
  const snap = reference.snapshot(), transcript: { tick: number; id: string; verb: string; params: unknown }[] = [];
  const submit = reference.submit.bind(reference);
  let depth = 0;
  const step = reference.step.bind(reference);
  reference.step = () => { depth++; try { return step(); } finally { depth--; } };
  reference.submit = (verb, params, opts) => {
    const outer = depth++ === 0;
    try {
      const r = submit(verb, params, opts);
      if (outer) transcript.push({ tick: reference.tick, id: r.id, verb, params: structuredClone(params) });
      return r;
    } finally { depth--; }
  };
  let checked = false;
  runMeal(reference, { onTick(rt) {
    if (checked || ![...rt.records.values()].some(r => r.verb === 'eat' && rt.isActive(r.id))) return;
    checked = true;
    const before = structuredClone(rt.world);
    assert.throws(() => compactRuntime(rt, services), /not-quiet/);
    assert.deepEqual(rt.world, before);
    const resumed = Runtime.restore(snap, createRegistry(), services(mealWorld()), ENGINE_INVARIANTS);
    for (const input of transcript) {
      while (resumed.tick < input.tick) resumed.step();
      assert.equal(resumed.submit(input.verb, input.params).id, input.id);
    }
    while (resumed.tick < rt.tick) resumed.step();
    assert.equal(resumed.stateHash(), rt.stateHash());
  } });
  assert.equal(checked, true);
  assert.deepEqual(reference.violations, []);
});
