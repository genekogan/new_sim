import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import type { ActionDef } from '../actions/types.ts';
import { Runtime } from '../runtime/runtime.ts';
import { SnapshotError, type RuntimeSnapshot } from '../runtime/snapshot.ts';
import { emptyWorld, human } from '../world/factory.ts';
import { provingGround } from '../scenes/proving-ground.ts';

const fixture: ActionDef<unknown, unknown, { remaining: number }> = {
  verb: 'capture_fixture', description: 'snapshot capture fixture', schema: z.strictObject({}), resumable: true,
  reservations: () => [], plan: () => ({ ok: true, program: null }),
  start(rt) { const exec = { remaining: 10 }; rt.services.active = exec; return exec; },
  step: (_rt, exec) => --exec.remaining > 0 ? { status: 'running' } : { status: 'completed' },
  cancel: () => ({ ok: true }),
};
const registry = new Map([[fixture.verb, fixture]]);
function setup() {
  const world = emptyWorld('proving-ground', provingGround()); world.entities.a = human('a', 0, 0);
  return new Runtime(world, registry, { values: Array.from({ length: 700 }, (_, i) => i) });
}
function finish(steps: Generator<void, RuntimeSnapshot, void>): RuntimeSnapshot {
  let result = steps.next(), n = 0;
  while (!result.done) { assert.ok(++n < 10000); result = steps.next(); }
  return result.value;
}

test('native capture fixes graph, live exec, hash, events, IDs and violations before deferred emission', () => {
  const rt = setup(), action = rt.submit(fixture.verb, {}); rt.step();
  const expected = rt.snapshot(), capture = rt.captureSnapshot(), iterator = capture.steps();
  assert.equal(capture.tick, expected.tick); assert.equal(capture.stateHash, expected.stateHash);
  assert.ok(Object.isFrozen(capture)); assert.equal(iterator.next().done, false);
  const reference = Runtime.restore(JSON.parse(JSON.stringify(expected)), registry, {});
  for (let i = 0; i < 3; i++) rt.step();
  rt.services.values.length = 0;
  rt.violations.push({ tick: rt.tick, code: 'later', message: 'after capture' });
  const deferred = finish(iterator);
  assert.equal(JSON.stringify(deferred), JSON.stringify(expected));
  assert.equal(JSON.stringify(capture.finish()), JSON.stringify(expected));
  const restored = Runtime.restore(JSON.parse(JSON.stringify(deferred)), registry, {});
  assert.equal(restored.services.active.remaining, 9, 'exec alias retains the capture-time value');
  for (let i = 0; i < 12; i++) {
    reference.step(); restored.step();
    assert.equal(restored.stateHash(), reference.stateHash());
    assert.deepEqual(restored.events, reference.events);
    assert.deepEqual(restored.records.get(action.id), reference.records.get(action.id));
    assert.equal(restored.services.active.remaining, reference.services.active.remaining);
  }
  assert.equal(restored.submit(fixture.verb, {}).id, reference.submit(fixture.verb, {}).id);
  deferred.violations.push({ tick: 0, code: 'output', message: 'only this output' });
  (deferred.data as { world: { tick: number } }).world.tick = 999;
  assert.equal(JSON.stringify(finish(capture.steps())), JSON.stringify(expected));
});

test('capture refuses synchronously with the existing diagnostic and preserves explicit allowDrop semantics', () => {
  const rt = setup();
  rt.services.bad = { fn() {} };
  const error = (operation: () => unknown): SnapshotError => {
    try { operation(); assert.fail('snapshot must refuse'); }
    catch (e) { assert.ok(e instanceof SnapshotError); return e; }
  };
  const regular = error(() => rt.snapshot()), captured = error(() => rt.captureSnapshot());
  assert.equal(captured.code, 'snapshot.unencodable'); assert.deepEqual(captured.diagnostic, regular.diagnostic);

  const def = { ...fixture, resumable: 'fixture deliberately cannot resume' };
  const dropping = new Runtime(emptyWorld('proving-ground', provingGround()), new Map([[def.verb, def]]), {});
  const action = dropping.submit(def.verb, {});
  const strict = error(() => dropping.captureSnapshot());
  assert.equal(strict.code, 'snapshot.non-resumable'); assert.deepEqual(strict.subjects, [action.id]);
  const expected = dropping.snapshot({ allowDrop: true }), capture = dropping.captureSnapshot({ allowDrop: true });
  assert.equal(capture.droppedCount, 1);
  dropping.step();
  assert.equal(JSON.stringify(finish(capture.steps())), JSON.stringify(expected));
  const restored = Runtime.restore(capture.finish(), new Map([[def.verb, def]]), {});
  assert.equal(restored.records.get(action.id)?.status, 'cancelled');
  assert.equal(restored.records.get(action.id)?.diagnostic?.code, 'snapshot.dropped');
});
