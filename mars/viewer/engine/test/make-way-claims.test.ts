import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { Runtime } from '../runtime/runtime.ts';
import { Spatial } from '../spatial/service.ts';
import { emptyWorld, addAll, human } from '../world/factory.ts';
import { makeWay, walkTo } from '../locomotion/walk.ts';
import { openGround } from './frame-fixtures.ts';
import type { ActionDef } from '../actions/types.ts';

function setup() {
  const base = openGround();
  const wait: ActionDef = { verb: 'reserved_parent', description: 'waiting parent with an actor claim', schema: z.object({}), reservations: () => [{ resource: 'actor:p', mode: 'exclusive' }], plan: () => ({ ok: true, program: {} }), start: () => ({}), step: () => ({ status: 'running' }), cancel: () => ({ ok: true }) };
  const rt = new Runtime(addAll(emptyWorld('make-way-claims', base), human('p', 0, 0)), new Map<string, ActionDef>([['walk_to', walkTo], [wait.verb, wait]]), { spatial: new Spatial(base) }, []);
  (rt.services.spatial as Spatial).sync(rt.world);
  return rt;
}

test('LM105: an actor reserved by a waiting parent never receives conflicting ambient make-way submissions', () => {
  const rt = setup(), hold = rt.submit('reserved_parent', {}), original = structuredClone(rt.world.entities.p);
  assert.equal(hold.status, 'executing');
  assert.equal(rt.world.entities.p.human!.task, undefined, 'waiting owners need not have published an activity task');
  for (let t = 0; t < 120; t++) { makeWay(rt, 'p', [-1, 0]); rt.step(); }
  assert.equal(rt.records.size, 1);
  assert.deepEqual(rt.world.entities.p, original);
  assert.ok(rt.holder('actor:p').includes(hold.id));
  rt.cancel(hold.id);
  makeWay(rt, 'p', [-1, 0]);
  assert.equal(rt.records.size, 2);
  assert.ok(rt.runUntilIdle(1000));
  assert.notDeepEqual(rt.world.entities.p.pose.p, original.pose.p);
  assert.equal([...rt.records.values()].some(r => r.diagnostic?.code === 'reservation.conflict'), false);
});

