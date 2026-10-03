import test from 'node:test';
import assert from 'node:assert/strict';
import {
  tidyTableRuntime,
  tidyTableBinding,
  tidyTableScene,
} from '../scenarios/table-cleanup.ts';
import { readTidyTable } from '../activities/table-cleanup.ts';
import type { Runtime } from '../runtime/runtime.ts';
import { itemEntity, placeOnSlot, surfaceSlot } from '../items/model.ts';
import { Spatial } from '../spatial/service.ts';
function until(rt: Runtime, done: () => boolean) {
  for (let i = 0; i < 5000 && !done(); i++) rt.step();
  assert.ok(done(), 'bounded cleanup drains');
}
function read(rt: Runtime, id: string) {
  const r = readTidyTable(rt, id);
  assert.ok(r);
  return r;
}
function clean(rt: Runtime) {
  rt.step();
  assert.deepEqual(rt.violations, []);
  assert.deepEqual(
    [...rt.records.values()]
      .filter((a) => rt.isActive(a.id))
      .map((a) => [a.verb, a.phase]),
    [],
  );
  assert.equal(rt.world.entities.tidier.human!.activity, 'idle');
  for (const resource of [
    'actor:tidier',
    'hand:tidier:right',
    'entity:meal-bowl',
    'entity:work-book',
    'entity:source-table',
    'entity:destination-table',
    'tidy-task:tidier',
  ])
    assert.deepEqual(rt.holder(resource), [], resource);
}
function intruder(rt: Runtime, id: string, slot: string) {
  const e = itemEntity(id, 'bowl', [0, 0, 0]),
    s = surfaceSlot(rt.world, slot);
  assert.ok(!('code' in s));
  placeOnSlot(e, s, rt.world.entities[s.owner].pose.yaw);
  rt.world.entities[id] = e;
}
for (const yaw of [0, Math.PI / 2])
  for (const count of [2, 3, 4] as const)
    test(`physical ${count}-item transfer retains identities, payloads and support at yaw ${yaw}`, () => {
      const rt = tidyTableRuntime(yaw, count),
        ids = Object.keys(rt.world.entities),
        before = tidyTableBinding(count).transfers.map((q) =>
          structuredClone(rt.world.entities[q.item]),
        ),
        a = rt.submit('tidy_table', tidyTableBinding(count));
      until(rt, () => !rt.isActive(a.id));
      assert.equal(a.status, 'completed', a.diagnostic?.message);
      assert.equal(read(rt, a.id).finished, true);
      assert.equal(read(rt, a.id).completed.length, count);
      assert.deepEqual(Object.keys(rt.world.entities), ids);
      for (const e of before) {
        const after = rt.world.entities[e.id];
        assert.equal(after.def, e.def);
        assert.deepEqual(after.contents, e.contents);
        assert.deepEqual(after.provenance, e.provenance);
        assert.equal(after.support?.kind, 'resting-on');
        assert.equal(
          after.support?.kind === 'resting-on' && after.support.on,
          'destination-table',
        );
      }
      const verbs = [...rt.records.values()].map((a) => a.verb);
      assert.equal(verbs.filter((v) => v === 'take_item').length, count);
      assert.equal(verbs.filter((v) => v === 'put_item').length, count);
      assert.ok(verbs.includes('walk_to'));
      const detached = read(rt, a.id);
      detached.completed[0].item = 'fake';
      assert.notEqual(read(rt, a.id).completed[0].item, 'fake');
      clean(rt);
    });
test('pause while second item is held retains first transfer and resumes same remaining objects', () => {
  const rt = tidyTableRuntime(),
    a = rt.submit('tidy_table', tidyTableBinding());
  until(rt, () => rt.world.entities['work-book'].support?.kind === 'in-hand');
  rt.submit('tidy_table_control', { task: a.id, intent: 'pause' });
  until(rt, () => read(rt, a.id).mode === 'paused');
  assert.deepEqual(
    read(rt, a.id).completed.map((q) => q.item),
    ['meal-bowl'],
  );
  assert.equal(rt.world.entities['work-book'].support?.kind, 'resting-on');
  assert.equal(
    rt.world.entities['work-book'].support?.kind === 'resting-on' &&
      rt.world.entities['work-book'].support.on,
    'source-table',
  );
  const resume = rt.submit('tidy_table_control', {
    task: a.id,
    intent: 'resume',
  });
  assert.notEqual(resume.status, 'failed', resume.diagnostic?.message);
  until(rt, () => !rt.isActive(a.id));
  assert.equal(read(rt, a.id).completed.length, 3);
  clean(rt);
});
test('repeated End/cancel drains held object once without active leaks', () => {
  const rt = tidyTableRuntime(),
    a = rt.submit('tidy_table', tidyTableBinding());
  until(rt, () => rt.world.entities['meal-bowl'].support?.kind === 'in-hand');
  rt.submit('tidy_table_control', { task: a.id, intent: 'end' });
  until(rt, () => {
    rt.cancel(a.id);
    return !rt.isActive(a.id);
  });
  assert.equal(read(rt, a.id).finished, false);
  assert.equal(read(rt, a.id).completed.length, 0);
  assert.equal(rt.world.entities['meal-bowl'].support?.kind, 'resting-on');
  assert.equal(
    [...rt.records.values()].filter((r) => r.verb === 'put_item').length,
    1,
  );
  clean(rt);
});
test('ordinary player walk takes precedence after supported release and explicit resume succeeds', () => {
  const rt = tidyTableRuntime(),
    a = rt.submit('tidy_table', tidyTableBinding());
  until(rt, () => rt.world.entities['meal-bowl'].support?.kind === 'in-hand');
  const walk = rt.submit('walk_to', { actor: 'tidier', x: -4, z: -3 });
  until(rt, () => !rt.isActive(walk.id));
  assert.equal(walk.status, 'completed', walk.diagnostic?.message);
  assert.equal(read(rt, a.id).mode, 'waiting');
  assert.equal(read(rt, a.id).diagnostic?.code, 'tidy_table.directed-away');
  assert.equal(rt.world.entities['meal-bowl'].support?.kind, 'resting-on');
  assert.equal(
    rt.submit('tidy_table_control', { task: a.id, intent: 'resume' }).status,
    'executing',
  );
  until(rt, () => !rt.isActive(a.id));
  assert.equal(read(rt, a.id).finished, true);
  clean(rt);
});
test('both permitted supports occupied preserves true held ownership until explicit intervention', () => {
  const rt = tidyTableRuntime(),
    p = tidyTableBinding(),
    q = p.transfers[0],
    a = rt.submit('tidy_table', p);
  until(rt, () => rt.world.entities[q.item].support?.kind === 'in-hand');
  intruder(rt, 'source-intruder', q.from);
  intruder(rt, 'destination-intruder', q.to);
  rt.submit('tidy_table_control', { task: a.id, intent: 'pause' });
  until(
    rt,
    () =>
      read(rt, a.id).diagnostic?.code === 'tidy_table.safe-return-unavailable',
  );
  assert.deepEqual(rt.world.entities[q.item].support, {
    kind: 'in-hand',
    by: 'tidier',
    hand: 'right',
  });
  assert.ok(rt.holder('actor:tidier').length);
  assert.ok(rt.holder(`entity:${q.item}`).length);
  assert.ok(read(rt, a.id).diagnostic?.subjects?.includes('source-intruder'));
  assert.ok(
    read(rt, a.id).diagnostic?.subjects?.includes('destination-intruder'),
  );
  const n = rt.records.size;
  for (let i = 0; i < 20; i++) rt.step();
  assert.equal(rt.records.size, n);
  assert.deepEqual(rt.violations, []);
  delete rt.world.entities['source-intruder'];
  until(rt, () => read(rt, a.id).mode === 'paused');
  assert.equal(rt.world.entities[q.item].support?.kind, 'resting-on');
  delete rt.world.entities['destination-intruder'];
  rt.submit('tidy_table_control', { task: a.id, intent: 'resume' });
  until(rt, () => !rt.isActive(a.id));
  clean(rt);
});
test('source occupied during pause uses only declared destination fallback and retains its completed transfer', () => {
  const rt = tidyTableRuntime(),
    p = tidyTableBinding(),
    q = p.transfers[0],
    a = rt.submit('tidy_table', p);
  until(rt, () => rt.world.entities[q.item].support?.kind === 'in-hand');
  intruder(rt, 'source-intruder', q.from);
  rt.submit('tidy_table_control', { task: a.id, intent: 'pause' });
  until(rt, () => read(rt, a.id).mode === 'paused');
  assert.deepEqual(
    read(rt, a.id).completed.map((q) => q.item),
    [q.item],
  );
  rt.submit('tidy_table_control', { task: a.id, intent: 'resume' });
  until(rt, () => !rt.isActive(a.id));
  clean(rt);
});
test('invalid resources and ground routes name actual failing items/supports', () => {
  for (const [change, code, subject] of [
    [
      (rt: Runtime) => delete rt.world.entities['meal-bowl'],
      'tidy_table.item-missing',
      'meal-bowl',
    ],
    [
      (rt: Runtime) => {
        rt.world.entities['meal-bowl'].def = 'table-6ft';
      },
      'tidy_table.not-small-item',
      'meal-bowl',
    ],
    [
      (rt: Runtime) => {
        rt.world.entities['meal-bowl'].support = { kind: 'ground' };
      },
      'tidy_table.item-source',
      'meal-bowl',
    ],
    [
      (rt: Runtime) => {
        rt.world.entities['source-table'].support = {
          kind: 'resting-on',
          on: 'destination-table',
        };
      },
      'tidy_table.table-support',
      'source-table',
    ],
    [
      (rt: Runtime) => intruder(rt, 'occupied', 'destination-table#r1c1'),
      'tidy_table.destination-occupied',
      'occupied',
    ],
    [
      (rt: Runtime) => {
        const scene = tidyTableScene();
        scene.obstacles.push({
          id: 'wall',
          obb: { c: [0, 0], half: [0.2, 10], yaw: 0 },
          y0: 0,
          y1: 3,
          kind: 'wall',
        });
        rt.services.spatial = new Spatial(scene);
      },
      'tidy_table.route-blocked',
      'tidier',
    ],
  ] as const) {
    const rt = tidyTableRuntime();
    change(rt);
    const a = rt.submit('tidy_table', tidyTableBinding());
    assert.equal(a.status, 'failed');
    assert.equal(a.diagnostic?.code, code, a.diagnostic?.message);
    assert.ok(a.diagnostic?.subjects?.includes(subject));
    assert.equal(
      [...rt.records.values()].filter((a) => rt.isActive(a.id)).length,
      0,
    );
  }
});
test('same pause/resume decisions replay identically', () => {
  const run = () => {
    const rt = tidyTableRuntime(),
      a = rt.submit('tidy_table', tidyTableBinding());
    until(rt, () => rt.world.entities['work-book'].support?.kind === 'in-hand');
    rt.submit('tidy_table_control', { task: a.id, intent: 'pause' });
    until(rt, () => read(rt, a.id).mode === 'paused');
    rt.submit('tidy_table_control', { task: a.id, intent: 'resume' });
    until(rt, () => !rt.isActive(a.id));
    clean(rt);
    return { hash: rt.stateHash(), readout: read(rt, a.id), events: rt.events };
  };
  assert.deepEqual(run(), run());
});
test('paused item contents change refuses resume, preserves source and names item intervention', () => {
  const rt = tidyTableRuntime(),
    a = rt.submit('tidy_table', tidyTableBinding());
  until(rt, () => rt.world.entities['meal-bowl'].support?.kind === 'in-hand');
  rt.submit('tidy_table_control', { task: a.id, intent: 'pause' });
  until(rt, () => read(rt, a.id).mode === 'paused');
  rt.world.entities['meal-bowl'].contents!.fraction = 0.2;
  const r = rt.submit('tidy_table_control', { task: a.id, intent: 'resume' });
  assert.equal(r.status, 'failed');
  assert.equal(r.diagnostic?.code, 'tidy_table.item-changed');
  assert.ok(r.diagnostic?.subjects?.includes('meal-bowl'));
  assert.equal(rt.world.entities['meal-bowl'].support?.kind, 'resting-on');
  rt.submit('tidy_table_control', { task: a.id, intent: 'end' });
  until(rt, () => !rt.isActive(a.id));
  clean(rt);
});
test('held return refusal remains coherent during End, then drains when declared support restored', () => {
  const rt = tidyTableRuntime(),
    p = tidyTableBinding(),
    q = p.transfers[0],
    a = rt.submit('tidy_table', p);
  until(rt, () => rt.world.entities[q.item].support?.kind === 'in-hand');
  intruder(rt, 'source-intruder', q.from);
  intruder(rt, 'destination-intruder', q.to);
  rt.submit('tidy_table_control', { task: a.id, intent: 'end' });
  until(
    rt,
    () =>
      read(rt, a.id).diagnostic?.code === 'tidy_table.safe-return-unavailable',
  );
  assert.equal(read(rt, a.id).mode, 'ending');
  assert.equal(rt.isActive(a.id), true);
  assert.equal(rt.world.entities[q.item].support?.kind, 'in-hand');
  for (let i = 0; i < 20; i++) {
    rt.cancel(a.id);
    rt.step();
  }
  assert.deepEqual(rt.violations, []);
  delete rt.world.entities['source-intruder'];
  until(rt, () => !rt.isActive(a.id));
  assert.equal(read(rt, a.id).finished, false);
  clean(rt);
});
test('occupied task is exclusive while approved fixture claims remain shared', () => {
  const rt = tidyTableRuntime(),
    p = tidyTableBinding(),
    a = rt.submit('tidy_table', p);
  const b = rt.submit('tidy_table', p, { preempt: false });
  assert.equal(b.status, 'failed');
  assert.equal(b.diagnostic?.code, 'tidy_table.resource-occupied');
  assert.ok(b.diagnostic?.subjects?.includes('tidy-task:tidier'));
  rt.cancel(a.id);
  until(rt, () => !rt.isActive(a.id));
  clean(rt);
});
test('actual overhanging source and destination footprints refuse admission', () => {
  for (const source of [true, false]) {
    const rt = tidyTableRuntime(),
      p = tidyTableBinding();
    if (source) {
      p.transfers[0].from = 'source-table#r0c1';
      const s = surfaceSlot(rt.world, p.transfers[0].from);
      assert.ok(!('code' in s));
      placeOnSlot(rt.world.entities['meal-bowl'], s, 0);
    } else p.transfers[0].to = 'destination-table#r0c1';
    const a = rt.submit('tidy_table', p);
    assert.equal(a.status, 'failed');
    assert.equal(
      a.diagnostic?.code,
      source ? 'tidy_table.source-capacity' : 'tidy_table.surface-capacity',
    );
    assert.ok(a.diagnostic?.subjects?.includes('meal-bowl'));
    assert.equal(
      [...rt.records.values()].filter((a) => rt.isActive(a.id)).length,
      0,
    );
  }
});
test('rapid accepted controls before a tick cannot dispatch orphan physical children', () => {
  const rt = tidyTableRuntime(),
    a = rt.submit('tidy_table', tidyTableBinding());
  const pause = rt.submit('tidy_table_control', {
      task: a.id,
      intent: 'pause',
    }),
    end = rt.submit('tidy_table_control', { task: a.id, intent: 'end' });
  assert.notEqual(pause.status, 'failed');
  assert.notEqual(end.status, 'failed');
  until(rt, () => !rt.isActive(a.id));
  assert.equal(
    [...rt.records.values()].filter((r) => r.verb === 'tidy_table_transfer')
      .length,
    0,
  );
  clean(rt);
  const next = rt.submit('tidy_table', tidyTableBinding());
  rt.submit('tidy_table_control', { task: next.id, intent: 'pause' });
  until(rt, () => read(rt, next.id).mode === 'paused');
  rt.submit('tidy_table_control', { task: next.id, intent: 'resume' });
  rt.submit('tidy_table_control', { task: next.id, intent: 'end' });
  until(rt, () => !rt.isActive(next.id));
  assert.equal(
    [...rt.records.values()].filter((r) => r.verb === 'tidy_table_transfer')
      .length,
    0,
  );
  clean(rt);
});
test('player direction before first tick followed by End leaves the player walk independent', () => {
  const rt = tidyTableRuntime(),
    a = rt.submit('tidy_table', tidyTableBinding()),
    walk = rt.submit('walk_to', { actor: 'tidier', x: -4, z: -3 });
  rt.submit('tidy_table_control', { task: a.id, intent: 'end' });
  until(rt, () => !rt.isActive(a.id) && !rt.isActive(walk.id));
  assert.equal(walk.status, 'completed', walk.diagnostic?.message);
  assert.equal(
    [...rt.records.values()].filter((r) => r.verb === 'tidy_table_transfer')
      .length,
    0,
  );
  clean(rt);
});
