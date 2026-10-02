import test from 'node:test';
import assert from 'node:assert/strict';
import {
  gardenCircuitRuntime,
  gardenCircuitBinding,
} from '../scenarios/garden-circuit.ts';
import { readGardenCircuit } from '../activities/garden-circuit.ts';
import { readGarden, type GardenEntity } from '../objects/garden.ts';
import {
  heldBy,
  itemEntity,
  placeOnSlot,
  surfaceSlot,
} from '../items/model.ts';
import { hashOf } from '../core/hash.ts';
import type { Runtime } from '../runtime/runtime.ts';
const view = (rt: Runtime, id: string) => readGardenCircuit(rt, id)!;
function checked(rt: Runtime) {
  rt.step();
  assert.deepEqual(rt.violations, []);
  const received = ['plant-a', 'plant-b', 'plant-c'].reduce(
    (n, id) =>
      n + (rt.world.entities[id] as GardenEntity).gardenCare!.waterReceived,
    0,
  );
  assert.equal(
    rt.world.entities['water-pot'].contents!.fraction * 4 +
      rt.world.entities['water-bowl'].contents!.fraction +
      received,
    2,
  );
  assert.deepEqual(rt.world.entities['water-pot'].support, {
    kind: 'resting-on',
    on: 'water-table',
    slot: 'r1c2',
  });
}
function until(rt: Runtime, done: () => boolean, max = 5000) {
  for (let i = 0; i < max && !done(); i++) checked(rt);
  assert.ok(
    done(),
    JSON.stringify([...rt.records.values()].filter((r) => rt.isActive(r.id))),
  );
}
function begin() {
  const rt = gardenCircuitRuntime(),
    r = rt.submit('garden_circuit', gardenCircuitBinding());
  assert.notEqual(r.status, 'failed', r.diagnostic?.message);
  return { rt, r };
}
function control(rt: Runtime, id: string, intent: 'pause' | 'resume' | 'end') {
  const c = rt.submit('garden_circuit_control', { circuit: id, intent });
  assert.notEqual(c.status, 'failed', c.diagnostic?.message);
  return c;
}
function clean(rt: Runtime, id: string) {
  until(rt, () => !rt.isActive(id));
  assert.equal(heldBy(rt.world, 'carer').length, 0);
  assert.deepEqual(rt.world.entities['water-bowl'].support, {
    kind: 'resting-on',
    on: 'water-table',
    slot: 'r0c2',
  });
  assert.ok(view(rt, id).claims.every((c) => !c.holders.length));
  assert.equal(
    [...rt.records.values()].filter((r) => rt.isActive(r.id)).length,
    0,
  );
}
function finish(rt: Runtime, id: string) {
  clean(rt, id);
  assert.equal(rt.records.get(id)!.status, 'completed');
  assert.equal(view(rt, id).finished, true);
  assert.equal(rt.world.entities['water-pot'].contents!.fraction, 0);
  assert.equal(rt.world.entities['water-bowl'].contents!.fraction, 0.5);
  for (const id of gardenCircuitBinding().plants) {
    const s = readGarden(rt, id);
    assert.ok(!('code' in s));
    assert.equal(s.cycles, 2);
    assert.equal(s.waterReceived, 0.5);
  }
}
function pause(rt: Runtime, id: string) {
  control(rt, id, 'pause');
  until(rt, () => view(rt, id).mode === 'paused');
  assert.equal(heldBy(rt.world, 'carer').length, 0);
}
const serves = (rt: Runtime) =>
  [...rt.records.values()].filter((r) => r.verb === 'serve');
test('six real care cycles, two real resupplies, original identities and deterministic replay', () => {
  const results = [];
  for (let i = 0; i < 2; i++) {
    const { rt, r } = begin(),
      ids = Object.keys(rt.world.entities).sort();
    finish(rt, r.id);
    assert.deepEqual(Object.keys(rt.world.entities).sort(), ids);
    assert.equal(serves(rt).length, 2);
    assert.equal(
      [...rt.records.values()].filter((r) => r.verb === 'garden_care').length,
      6,
    );
    assert.ok([...rt.records.values()].some((r) => r.verb === 'walk_to'));
    results.push({
      tick: rt.tick,
      hash: rt.stateHash(),
      records: hashOf([...rt.records.values()]),
    });
  }
  assert.deepEqual(results[0], results[1]);
});
test('Pause after serve deposit before back completes never serves the nonempty bowl again', () => {
  const { rt, r } = begin();
  until(rt, () =>
    serves(rt).some((c) => rt.isActive(c.id) && c.phase === 'back'),
  );
  assert.equal(rt.world.entities['water-pot'].contents!.fraction, 0.25);
  assert.equal(rt.world.entities['water-bowl'].contents!.fraction, 1);
  pause(rt, r.id);
  assert.equal(serves(rt)[0].status, 'cancelled');
  assert.equal(rt.world.entities['water-bowl'].contents!.fraction, 1);
  control(rt, r.id, 'resume');
  finish(rt, r.id);
  assert.equal(serves(rt).length, 2);
});
test('Pause before serving deposit retains empty bowl and exactly retries unfinished resupply', () => {
  const { rt, r } = begin();
  until(rt, () => serves(rt).some((c) => c.phase === 'to-pot'));
  pause(rt, r.id);
  assert.equal(rt.world.entities['water-pot'].contents!.fraction, 0.5);
  assert.equal(rt.world.entities['water-bowl'].contents!.fraction, 0);
  control(rt, r.id, 'resume');
  finish(rt, r.id);
  assert.equal(serves(rt).length, 3);
  assert.equal(serves(rt).filter((c) => c.status === 'completed').length, 2);
});
test('partial care purpose and material survive safe Pause, ordinary direction and explicit Resume', () => {
  const { rt, r } = begin();
  until(
    rt,
    () =>
      !!(rt.world.entities['plant-a'] as GardenEntity).gardenCare!.pending
        ?.delivered,
  );
  const before = structuredClone(
    (rt.world.entities['plant-a'] as GardenEntity).gardenCare!,
  );
  pause(rt, r.id);
  const w = rt.submit('walk_to', { actor: 'carer', x: -5, z: 3 });
  assert.notEqual(w.status, 'failed', w.diagnostic?.message);
  until(rt, () => !rt.isActive(w.id) && view(rt, r.id).mode === 'paused');
  assert.equal(w.status, 'completed');
  assert.deepEqual(
    (rt.world.entities['plant-a'] as GardenEntity).gardenCare,
    before,
  );
  control(rt, r.id, 'resume');
  finish(rt, r.id);
});
test('active care directive drains ordinary care before walking and does not resurrect circuit', () => {
  const { rt, r } = begin();
  until(
    rt,
    () =>
      !!(rt.world.entities['plant-a'] as GardenEntity).gardenCare!.pending
        ?.delivered,
  );
  const w = rt.submit('walk_to', { actor: 'carer', x: -5, z: 3 });
  assert.notEqual(w.status, 'failed', w.diagnostic?.message);
  until(rt, () => view(rt, r.id).mode === 'paused' && !rt.isActive(w.id));
  assert.equal(w.status, 'completed');
  const records = rt.records.size;
  for (let i = 0; i < 40; i++) checked(rt);
  assert.equal(rt.records.size, records);
  control(rt, r.id, 'resume');
  finish(rt, r.id);
});
test('due wait preserves original 600 tick interval without failed child spam', () => {
  const { rt, r } = begin();
  until(rt, () => r.diagnostic?.code === 'garden_circuit.not-due');
  const count = rt.records.size,
    plant = view(rt, r.id).plants[0];
  assert.ok(!('code' in plant));
  assert.equal(plant.intervalTicks, 600);
  assert.ok(plant.remainingTicks > 0);
  for (let i = 0; i < Math.min(20, plant.remainingTicks - 1); i++) checked(rt);
  assert.equal(rt.records.size, count);
  finish(rt, r.id);
});
for (const stage of ['before-step', 'serve', 'care', 'due'])
  test(`End in ${stage} safely returns actual bowl and keeps finite history`, () => {
    const { rt, r } = begin();
    if (stage === 'serve')
      until(rt, () => serves(rt).some((c) => c.phase === 'back'));
    if (stage === 'care')
      until(
        rt,
        () =>
          !!(rt.world.entities['plant-a'] as GardenEntity).gardenCare!.pending
            ?.delivered,
      );
    if (stage === 'due')
      until(rt, () => r.diagnostic?.code === 'garden_circuit.not-due');
    const contents = structuredClone(rt.world.entities['water-bowl'].contents);
    control(rt, r.id, 'end');
    clean(rt, r.id);
    assert.equal(view(rt, r.id).mode, 'ended');
    assert.equal(view(rt, r.id).finished, false);
    assert.deepEqual(rt.world.entities['water-bowl'].contents, contents);
  });
test('occupied return retains real hand/support, waits without children spam, restoration permits ordinary release', () => {
  const { rt, r } = begin();
  until(rt, () => serves(rt).some((c) => c.phase === 'back'));
  const foreign = itemEntity('blocker', 'spoon', [0, 0, 0]);
  const s = surfaceSlot(rt.world, gardenCircuitBinding().returnSlot);
  assert.ok(!('code' in s));
  placeOnSlot(foreign, s, 0);
  rt.world.entities[foreign.id] = foreign;
  control(rt, r.id, 'end');
  until(rt, () => r.diagnostic?.code === 'garden_circuit.return-occupied');
  assert.equal(heldBy(rt.world, 'carer')[0].item.id, 'water-bowl');
  const count = rt.records.size;
  for (let i = 0; i < 40; i++) checked(rt);
  assert.equal(rt.records.size, count);
  const other = surfaceSlot(rt.world, 'water-table#r0c4');
  assert.ok(!('code' in other));
  placeOnSlot(foreign, other, 0);
  clean(rt, r.id);
});
test('unavailable planter waits until explicit restored Resume; no automatic child failures', () => {
  const { rt, r } = begin();
  pause(rt, r.id);
  rt.world.entities['plant-a'].equipment = {
    kind: 'garden',
    config: { available: false },
  };
  control(rt, r.id, 'resume');
  until(rt, () => view(rt, r.id).mode === 'waiting');
  assert.equal(r.diagnostic?.code, 'garden.unavailable');
  const count = rt.records.size;
  for (let i = 0; i < 40; i++) checked(rt);
  assert.equal(rt.records.size, count);
  delete rt.world.entities['plant-a'].equipment;
  control(rt, r.id, 'resume');
  finish(rt, r.id);
});
test('changed source support refuses and exact restoration permits continuation', () => {
  const { rt, r } = begin();
  pause(rt, r.id);
  const p = structuredClone(rt.world.entities['water-pot'].pose);
  rt.world.entities['water-pot'].pose.p[0] += 0.01;
  control(rt, r.id, 'resume');
  until(rt, () => view(rt, r.id).mode === 'waiting');
  assert.equal(r.diagnostic?.code, 'garden_circuit.source-support');
  rt.world.entities['water-pot'].pose = p;
  control(rt, r.id, 'resume');
  finish(rt, r.id);
});
for (const kind of [
  'missing-source',
  'exhausted-source',
  'missing-plant',
  'unsupported-plant',
  'duplicate-plant',
  'bad-return',
  'nonempty-bowl',
])
  test(`${kind} refuses admission with no physical effects/claims`, () => {
    const rt = gardenCircuitRuntime(),
      p = gardenCircuitBinding();
    if (kind === 'missing-source') p.source = 'missing';
    if (kind === 'exhausted-source')
      rt.world.entities[p.source].contents!.fraction = 0;
    if (kind === 'missing-plant') p.plants[0] = 'missing';
    if (kind === 'unsupported-plant')
      rt.world.entities[p.plants[0]].support = { kind: 'none' };
    if (kind === 'duplicate-plant') p.plants[1] = p.plants[0];
    if (kind === 'bad-return') p.returnSlot = 'missing#r0c2';
    if (kind === 'nonempty-bowl')
      rt.world.entities[p.water].contents!.fraction = 0.5;
    const hash = rt.stateHash(),
      r = rt.submit('garden_circuit', p);
    assert.equal(r.status, 'failed');
    assert.ok(r.diagnostic?.code);
    assert.equal(rt.stateHash(), hash);
    assert.deepEqual(rt.holder(`garden-circuit:${p.water}`), []);
  });
test('readout is detached and repeat End during active ordinary return is idempotent', () => {
  const { rt, r } = begin();
  until(rt, () => serves(rt).some((c) => c.phase === 'back'));
  control(rt, r.id, 'end');
  until(rt, () => view(rt, r.id).current?.verb === 'put_item');
  const returnID = view(rt, r.id).current!.id;
  control(rt, r.id, 'end');
  assert.equal(view(rt, r.id).current!.id, returnID);
  const read = view(rt, r.id);
  read.source.contents!.fraction = 100;
  read.bindings.plants[0] = 'fake';
  assert.equal(rt.world.entities['water-pot'].contents!.fraction, 0.25);
  clean(rt, r.id);
});

test('stopped ordinary End return requires explicit retry, retains source history, no child spam', () => {
  const { rt, r } = begin();
  until(rt, () => serves(rt).some((c) => c.phase === 'back'));
  control(rt, r.id, 'end');
  until(rt, () => view(rt, r.id).current?.verb === 'put_item');
  const put = view(rt, r.id).current!;
  rt.cancel(put.id);
  until(rt, () => r.diagnostic?.code === 'garden_circuit.return-stopped');
  const count = rt.records.size;
  for (let i = 0; i < 20; i++) checked(rt);
  assert.equal(rt.records.size, count);
  control(rt, r.id, 'end');
  clean(rt, r.id);
  assert.equal(rt.records.get(put.id)!.status, 'cancelled');
  assert.equal(
    view(rt, r.id).ownedActions.filter(
      (id) => rt.records.get(id)?.verb === 'put_item',
    ).length,
    2,
  );
});

test('independent ordinary return satisfies stopped End physically without rewriting failed history', () => {
  const { rt, r } = begin();
  until(rt, () => serves(rt).some((c) => c.phase === 'back'));
  control(rt, r.id, 'end');
  until(rt, () => view(rt, r.id).current?.verb === 'put_item');
  const id = view(rt, r.id).current!.id;
  rt.cancel(id);
  until(rt, () => r.diagnostic?.code === 'garden_circuit.return-stopped');
  const put = rt.submit('put_item', {
    actor: 'carer',
    item: 'water-bowl',
    surfaceSlot: gardenCircuitBinding().returnSlot,
  });
  assert.notEqual(put.status, 'failed', put.diagnostic?.message);
  clean(rt, r.id);
  assert.equal(rt.records.get(id)!.status, 'cancelled');
  assert.equal(put.status, 'completed');
});
test('changed finite material waits for explicit restoration and never manufactures resupply', () => {
  const { rt, r } = begin();
  pause(rt, r.id);
  rt.world.entities['water-pot'].contents!.fraction = 0.25;
  control(rt, r.id, 'resume');
  rt.step();
  assert.equal(r.diagnostic?.code, 'garden_circuit.material-changed');
  assert.deepEqual(rt.violations, []);
  const count = rt.records.size;
  for (let i = 0; i < 20; i++) rt.step();
  assert.equal(rt.records.size, count);
  assert.equal(serves(rt).length, 0);
  rt.world.entities['water-pot'].contents!.fraction = 0.5;
  control(rt, r.id, 'resume');
  finish(rt, r.id);
});

test('missing serve after actual empty-bowl take waits by name without throw or failed-record spam', () => {
  const { rt, r } = begin();
  const original = rt.registry.get('serve')!;
  until(rt, () => rt.world.entities['water-bowl'].support?.kind === 'in-hand');
  rt.registry.delete('serve');
  assert.doesNotThrow(() =>
    until(rt, () => r.diagnostic?.code === 'garden_circuit.action-missing'),
  );
  assert.equal(view(rt, r.id).mode, 'waiting');
  assert.equal(rt.world.entities['water-pot'].contents!.fraction, 0.5);
  assert.equal(rt.world.entities['water-bowl'].contents!.fraction, 0);
  assert.equal(heldBy(rt.world, 'carer')[0].item.id, 'water-bowl');
  const count = rt.records.size;
  for (let i = 0; i < 40; i++) checked(rt);
  assert.equal(rt.records.size, count);
  assert.equal(
    [...rt.records.values()].filter((r) => r.status === 'failed').length,
    0,
  );
  rt.registry.set('serve', original);
  control(rt, r.id, 'resume');
  finish(rt, r.id);
  assert.equal(serves(rt).length, 2);
});
test('six committed deposits still require physical release after final-care Pause and ordinary bowl take', () => {
  const { rt, r } = begin();
  until(
    rt,
    () =>
      (rt.world.entities['plant-c'] as GardenEntity).gardenCare!.cycles === 2,
  );
  pause(rt, r.id);
  assert.equal(view(rt, r.id).index, 6);
  assert.equal(view(rt, r.id).finished, false);
  const take = rt.submit('take_item', {
    actor: 'carer',
    item: 'water-bowl',
    hand: 'right',
  });
  assert.notEqual(take.status, 'failed', take.diagnostic?.message);
  until(rt, () => rt.world.entities['water-bowl'].support?.kind === 'in-hand');
  assert.equal(view(rt, r.id).finished, false);
  assert.ok(rt.isActive(r.id));
  until(rt, () => view(rt, r.id).mode === 'paused' && !rt.isActive(take.id));
  assert.equal(take.status, 'completed');
  assert.equal(heldBy(rt.world, 'carer').length, 0);
  assert.equal(view(rt, r.id).finished, false);
  assert.ok(
    view(rt, r.id).history.some(
      (c) => c?.verb === 'put_item' && c.status === 'completed',
    ),
  );
  control(rt, r.id, 'resume');
  finish(rt, r.id);
});
