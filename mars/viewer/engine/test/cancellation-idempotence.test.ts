import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { Runtime } from '../runtime/runtime.ts';
import type { ActionDef } from '../actions/types.ts';
import { emptyWorld } from '../world/factory.ts';
import { READING_SCENE } from '../scenarios/reading.ts';
import { gardenCareRuntime, gardenCareParams } from '../scenarios/garden-care.ts';
import { preparationRuntime, preparationParams } from '../scenarios/preparation.ts';
function until(rt: Runtime, done: () => boolean, ticks = 2000) {
  for (let i = 0; i < ticks && !done(); i++) { rt.step(); assert.deepEqual(rt.violations, []); }
  assert.ok(done(), JSON.stringify([...rt.records.values()].filter(r => rt.isActive(r.id)).map(r => ({ verb: r.verb, phase: r.phase, code: r.diagnostic?.code }))));
}
test('an accepted deferred cancellation starts safe cleanup once, despite repeated parent requests', () => {
  let cancellations = 0;
  const action: ActionDef<Record<string, never>, null, { remaining: number; stopping: boolean }> = {
    verb: 'controlled_stop', description: 'Test controlled stop', schema: z.strictObject({}),
    reservations: () => [{ resource: 'test:stop', mode: 'exclusive' }],
    plan: () => ({ ok: true, program: null }), start: () => ({ remaining: 10, stopping: false }),
    step: (_rt, ex) => ex.stopping && --ex.remaining === 0 ? { status: 'completed' } : { status: 'running' },
    cancel: (_rt, ex) => { cancellations++; ex.stopping = true; ex.remaining = 10; return { ok: true, deferred: true }; },
  };
  const rt = new Runtime(emptyWorld('test', READING_SCENE), new Map([[action.verb, action]]), {}, []), r = rt.submit(action.verb, {});
  for (let i = 0; i < 30 && rt.isActive(r.id); i++) { rt.cancel(r.id); rt.step(); }
  assert.equal(r.status, 'cancelled'); assert.equal(cancellations, 1);
  assert.deepEqual(rt.holder('test:stop'), []);
});
test('a refused cancellation remains retryable, and later accepted cleanup preserves its reason', () => {
  let safe = false, calls = 0;
  const action: ActionDef<Record<string, never>, null, { remaining: number }> = {
    verb: 'unsafe_stop', description: 'Test refused stop', schema: z.strictObject({}), reservations: () => [],
    plan: () => ({ ok: true, program: null }), start: () => ({ remaining: 2 }),
    step: (_rt, ex) => safe && --ex.remaining === 0 ? { status: 'completed' } : { status: 'running' },
    cancel: () => { calls++; return safe ? { ok: true, deferred: true } : { ok: false, diagnostic: { code: 'test.unsafe', message: 'Support is not safe yet' } }; },
  };
  const rt = new Runtime(emptyWorld('test', READING_SCENE), new Map([[action.verb, action]]), {}, []), r = rt.submit(action.verb, {});
  rt.cancel(r.id); assert.equal(r.diagnostic?.code, 'test.unsafe'); assert.ok(rt.isActive(r.id));
  safe = true;
  rt.cancel(r.id, { code: 'test.owner-ended', message: 'Owner ended after support became safe' });
  rt.cancel(r.id); until(rt, () => !rt.isActive(r.id));
  assert.equal(calls, 2); assert.equal(r.status, 'cancelled'); assert.equal(r.diagnostic?.code, 'test.owner-ended');
});
for (const family of ['garden', 'preparation'] as const)
  test(`repeated parent Cancel preserves ${family} ownership until ordinary item cleanup finishes`, () => {
    const rt = family === 'garden' ? gardenCareRuntime() : preparationRuntime(),
      p = family === 'garden' ? gardenCareParams() : preparationParams(),
      r = rt.submit(family === 'garden' ? 'garden_care' : 'prepare_food', p),
      item = family === 'garden' ? 'water-bowl' : 'spoon';
    until(rt, () => r.phase === (family === 'garden' ? 'watering' : 'mixing'));
    const ids = Object.keys(rt.world.entities).sort();
    for (let i = 0; i < 400 && rt.isActive(r.id); i++) { rt.cancel(r.id); rt.step(); assert.deepEqual(rt.violations, []); }
    assert.equal(r.status, 'cancelled');
    assert.equal(rt.world.entities[item].support?.kind === (family === 'garden' ? 'resting-on' : 'in-hand'), true);
    assert.deepEqual(Object.keys(rt.world.entities).sort(), ids);
    assert.deepEqual(rt.holder(`actor:${family === 'garden' ? 'carer' : 'cook'}`), []);
    // Preparation's documented Pause intentionally retains the spoon; garden
    // returns its bowl. Both must preserve their distinct existing contracts.
    if (family === 'preparation') {
      const active = [...rt.records.values()].filter(q => rt.isActive(q.id));
      assert.equal(active.length, 1);
      assert.equal(active[0].verb, 'hold_items');
      assert.deepEqual(rt.holder('holds:cook'), [active[0].id]);
      const put = rt.submit('put_item', { actor: 'cook', item: 'spoon', surfaceSlot: 'table#r0c4' });
      assert.notEqual(put.status, 'failed', put.diagnostic?.message);
      until(rt, () => !rt.isActive(put.id)); assert.equal(put.status, 'completed');
    }
    assert.ok([...rt.records.values()].every(q => !rt.isActive(q.id)));
  });
