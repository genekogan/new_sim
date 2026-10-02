import test from 'node:test';
import assert from 'node:assert/strict';
import {
  roomPreparationRuntime,
  roomPreparationBinding,
} from '../scenarios/room-preparation.ts';
import {
  roomPreparationControl,
  readRoomPreparation,
} from '../activities/room-preparation.ts';
import { classroomWorld, classroomScene } from '../scenarios/classroom.ts';
import {
  createRegistry,
  ENGINE_INVARIANTS,
  servicesFor,
} from '../api/registry.ts';
import { Runtime } from '../runtime/runtime.ts';
import type { Runtime as RuntimeType } from '../runtime/runtime.ts';
const read = (rt: RuntimeType, id: string) => {
  const s = readRoomPreparation(rt, id);
  assert.ok(s);
  return s;
};
function until(rt: RuntimeType, done: () => boolean, max = 14000) {
  for (let i = 0; i < max && !done(); i++) {
    rt.step();
    assert.deepEqual(rt.violations, []);
    for (const id of ['break-bowl', 'break-spoon']) {
      const e = rt.world.entities[id];
      assert.ok(e);
      assert.ok(
        ['resting-on', 'in-hand'].includes(e.support?.kind ?? ''),
        `${id} unsupported`,
      );
      assert.equal(e.def, id === 'break-bowl' ? 'bowl' : 'spoon');
    }
  }
  assert.ok(
    done(),
    JSON.stringify(
      [...rt.records.values()]
        .filter((r) => rt.isActive(r.id))
        .map((r) => [r.verb, r.phase, r.diagnostic]),
    ),
  );
}
function start() {
  const rt = roomPreparationRuntime(),
    p = roomPreparationBinding(),
    a = rt.submit('room_preparation', p);
  assert.equal(a.status, 'executing', a.diagnostic?.message);
  return { rt, p, a };
}
function control(
  rt: RuntimeType,
  id: string,
  intent: 'pause' | 'resume' | 'end',
) {
  const r = rt.submit('room_preparation_control', { preparation: id, intent });
  assert.notEqual(r.status, 'failed', r.diagnostic?.message);
  return r;
}
function clean(rt: RuntimeType) {
  assert.deepEqual(rt.violations, []);
  assert.deepEqual(rt.holder('room-preparation'), []);
  for (const r of rt.records.values())
    assert.ok(!rt.isActive(r.id), `${r.verb} ${r.id} active`);
  for (const e of Object.values(rt.world.entities)) {
    if (e.human) {
      assert.ok(e.human.task == null);
      assert.ok(!e.human.hands);
      for (const r of [
        `actor:${e.id}`,
        `hand:${e.id}:left`,
        `hand:${e.id}:right`,
        `tidy-task:${e.id}`,
      ])
        assert.deepEqual(rt.holder(r), []);
    }
    assert.deepEqual(rt.holder(`entity:${e.id}`), []);
  }
  for (const s of [
    'seat8#seat',
    'belongings-table#r1c1',
    'belongings-table#r1c2',
    'storage-table#r1c1',
    'storage-table#r1c2',
  ]) {
    assert.deepEqual(rt.holder(`slot:${s}`), []);
    assert.deepEqual(rt.holder(`surface-slot:${s}`), []);
  }
}
function gather(rt: RuntimeType, id: string) {
  until(rt, () => read(rt, id).session?.phase === 'presenting');
}
function complete(rt: RuntimeType, id: string) {
  until(rt, () => !rt.isActive(id));
  assert.equal(read(rt, id).finished, true);
  clean(rt);
}
function payload(rt: RuntimeType) {
  return ['break-bowl', 'break-spoon'].map((id) => {
    const e = rt.world.entities[id];
    return {
      id,
      def: e.def,
      provenance: e.provenance,
      contents: e.contents,
      equipment: e.equipment,
    };
  });
}

test('connected whole session uses same stored items, physically moved table and late visitor chair/question; replay is exact', () => {
  const run = () => {
    const { rt, p, a } = start(),
      original = structuredClone(payload(rt)),
      ids = Object.keys(rt.world.entities);
    gather(rt, a.id);
    const s = read(rt, a.id);
    assert.equal(s.tidy!.finished, true);
    assert.equal(s.setup!.ready, true);
    assert.deepEqual(payload(rt), original);
    assert.deepEqual(Object.keys(rt.world.entities), ids);
    for (const t of p.tidy.transfers)
      assert.deepEqual(rt.world.entities[t.item].support, {
        kind: 'resting-on',
        on: 'storage-table',
        slot: t.to.split('#')[1],
      });
    assert.equal(
      Object.values(rt.world.entities).filter(
        (e) =>
          e.support?.kind === 'resting-on' &&
          e.support.on === 'belongings-table',
      ).length,
      0,
    );
    assert.deepEqual(rt.world.entities['belongings-table'].pose.p, [12, 0, -2]);
    assert.deepEqual(rt.world.entities.seat8.pose.p, [7.5, 0, 3]);
    const session = s.session!.session;
    const join = rt.submit('classroom_control', {
      session,
      intent: {
        kind: 'join',
        actor: p.late.actor,
        departure: p.late.departure,
      },
    });
    assert.notEqual(join.status, 'failed');
    until(
      rt,
      () =>
        read(rt, a.id).session!.participants.find((m) => m.actor === 'visitor')
          ?.arrival === 'seated',
    );
    assert.equal(
      read(rt, a.id).session!.participants.find((m) => m.actor === 'visitor')!
        .seat,
      'seat8#seat',
    );
    const question = rt.submit('classroom_control', {
      session,
      intent: { kind: 'question', actor: 'visitor' },
    });
    assert.notEqual(question.status, 'failed');
    until(
      rt,
      () =>
        read(rt, a.id).session?.phase === 'question' &&
        read(rt, a.id).session?.floorHolder === 'visitor',
    );
    const frozen = read(rt, a.id);
    frozen.bindings.tidy.transfers[0].item = 'fake';
    frozen.storedItems[0].actual!.pose.p[0] = 999;
    assert.equal(read(rt, a.id).bindings.tidy.transfers[0].item, 'break-bowl');
    assert.notEqual(rt.world.entities['break-bowl'].pose.p[0], 999);
    complete(rt, a.id);
    assert.deepEqual(payload(rt), original);
    return {
      hash: rt.stateHash(),
      records: [...rt.records.values()],
      readout: read(rt, a.id),
    };
  };
  assert.deepEqual(run(), run());
});
test('End before first physical tick releases parent with no children or purpose resurrection', () => {
  const { rt, a } = start(),
    before = structuredClone(rt.world.entities);
  control(rt, a.id, 'end');
  until(rt, () => !rt.isActive(a.id));
  assert.equal(a.status, 'cancelled');
  assert.equal(read(rt, a.id).finished, false);
  assert.deepEqual(rt.world.entities, before);
  assert.equal(read(rt, a.id).ownedActions.length, 0);
  clean(rt);
});
test('Pause while second item held drains safely, retains first storage and explicitly continues same tidy child', () => {
  const { rt, a } = start();
  until(
    rt,
    () =>
      read(rt, a.id).tidy?.completed.length === 1 &&
      read(rt, a.id).tidy?.current?.held === true,
  );
  const before = read(rt, a.id).tidy!,
    stored = structuredClone(rt.world.entities[before.completed[0].item]);
  control(rt, a.id, 'pause');
  until(rt, () => read(rt, a.id).mode === 'paused');
  const paused = read(rt, a.id);
  assert.deepEqual(rt.world.entities[before.completed[0].item], stored);
  assert.equal(paused.tidy!.task, before.task);
  assert.ok(!paused.tidy!.current?.held);
  assert.ok(
    !Object.values(rt.world.entities).some(
      (e) => e.support?.kind === 'in-hand',
    ),
  );
  assert.equal(paused.tidy!.completed.length, 1);
  const tick = rt.tick;
  for (let i = 0; i < 30; i++) rt.step();
  assert.equal(rt.tick, tick + 30);
  assert.deepEqual(read(rt, a.id).tidy, paused.tidy);
  control(rt, a.id, 'resume');
  complete(rt, a.id);
  assert.equal(read(rt, a.id).tidy!.task, before.task);
});
test('ordinary tidier direction waits with retained transfers until explicit Resume, without failed record spam', () => {
  const { rt, a } = start();
  until(
    rt,
    () =>
      read(rt, a.id).tidy?.completed.length === 1 &&
      read(rt, a.id).tidy?.current?.held === true,
  );
  const remembered = read(rt, a.id).tidy!.completed;
  const walk = rt.submit('walk_to', { actor: 'worker', x: 13, z: 10 });
  assert.notEqual(walk.status, 'failed');
  until(rt, () => !rt.isActive(walk.id) && read(rt, a.id).mode === 'waiting');
  assert.deepEqual(read(rt, a.id).tidy!.completed, remembered);
  const n = rt.records.size;
  for (let i = 0; i < 30; i++) rt.step();
  assert.equal(rt.records.size, n);
  assert.deepEqual(rt.world.entities.worker.pose.p, [13, 0, 10]);
  assert.equal(rt.records.get(walk.id)?.status, 'completed');
  control(rt, a.id, 'resume');
  complete(rt, a.id);
});
test('Pause held table safely grounds partial placement; explicit retry starts at real pose without retidying', () => {
  const { rt, a } = start();
  until(rt, () => read(rt, a.id).setup?.current?.phase === 'move');
  for (let i = 0; i < 20; i++) rt.step();
  const tidy = read(rt, a.id).tidy!.task,
    old = read(rt, a.id).setup!.action;
  control(rt, a.id, 'pause');
  until(rt, () => read(rt, a.id).mode === 'paused');
  assert.equal(rt.world.entities['belongings-table'].support?.kind, 'ground');
  assert.equal(read(rt, a.id).setup!.partial, true);
  const partial = structuredClone(rt.world.entities['belongings-table'].pose),
    n = rt.records.size;
  for (let i = 0; i < 30; i++) rt.step();
  assert.deepEqual(rt.world.entities['belongings-table'].pose, partial);
  assert.equal(rt.records.size, n);
  control(rt, a.id, 'resume');
  complete(rt, a.id);
  assert.equal(read(rt, a.id).tidy!.task, tidy);
  assert.notEqual(read(rt, a.id).setup!.action, old);
});
test('completed table placement remains retained when chair move stops and explicit retry skips the table', () => {
  const { rt, a } = start();
  until(
    rt,
    () =>
      read(rt, a.id).setup?.completed.length === 1 &&
      read(rt, a.id).setup?.current?.fixture === 'seat8' &&
      read(rt, a.id).setup?.current?.phase === 'move',
  );
  control(rt, a.id, 'pause');
  until(rt, () => read(rt, a.id).mode === 'paused');
  const table = structuredClone(rt.world.entities['belongings-table'].pose);
  control(rt, a.id, 'resume');
  gather(rt, a.id);
  const setups = [...rt.records.values()].filter(
    (r) => r.verb === 'setup_room',
  );
  assert.equal(setups.length, 2);
  assert.deepEqual(
    (setups[1].params as { moves: { fixture: string }[] }).moves.map(
      (m) => m.fixture,
    ),
    ['seat8'],
  );
  assert.deepEqual(rt.world.entities['belongings-table'].pose, table);
  complete(rt, a.id);
});
for (const stage of ['clearing', 'arranging', 'gathering'] as const)
  test(`End during ${stage} drains all actual children and preserves supported same objects`, () => {
    const { rt, a } = start(),
      original = structuredClone(payload(rt));
    if (stage === 'clearing')
      until(rt, () => read(rt, a.id).tidy?.current?.held === true);
    if (stage === 'arranging')
      until(rt, () => read(rt, a.id).setup?.current?.held === true);
    if (stage === 'gathering') gather(rt, a.id);
    control(rt, a.id, 'end');
    until(rt, () => !rt.isActive(a.id));
    assert.equal(a.status, 'cancelled');
    assert.equal(read(rt, a.id).finished, false);
    assert.deepEqual(payload(rt), original);
    assert.equal(rt.world.entities['belongings-table'].support?.kind, 'ground');
    assert.equal(rt.world.entities.seat8.support?.kind, 'ground');
    clean(rt);
  });
test('session local Pause is a named honest refusal; existing participant direction/exclusion and explicit rejoin still work', () => {
  const { rt, p, a } = start();
  gather(rt, a.id);
  const plan = roomPreparationControl.plan(rt, {
    preparation: a.id,
    intent: 'pause',
  });
  assert.equal(plan.ok, false);
  if (!plan.ok)
    assert.equal(
      plan.diagnostic.code,
      'room_preparation.session-pause-unsupported',
    );
  const session = read(rt, a.id).session!.session,
    walk = rt.submit('walk_to', { actor: 'guest1', x: 13, z: 10 });
  assert.notEqual(walk.status, 'failed');
  until(rt, () => !rt.isActive(walk.id));
  assert.equal(
    read(rt, a.id).session!.participants.find((m) => m.actor === 'guest1')!
      .state,
    'excluded',
  );
  const join = rt.submit('classroom_control', {
    session,
    intent: {
      kind: 'join',
      actor: 'guest1',
      departure: p.session.departure.guest1,
    },
  });
  assert.notEqual(join.status, 'failed', join.diagnostic?.message);
  complete(rt, a.id);
});
test('occupied moved chair causes named wait without dispatch spam/preemption, then explicit restored retry', () => {
  const { rt, a } = start();
  const sit = rt.submit('sit', { actor: 'visitor', slot: 'seat8#seat' });
  assert.notEqual(sit.status, 'failed');
  until(
    rt,
    () =>
      read(rt, a.id).stage === 'arranging' && read(rt, a.id).mode === 'waiting',
  );
  assert.equal(
    read(rt, a.id).diagnostic!.code,
    'room_preparation.setup-unavailable',
  );
  assert.ok(rt.isActive(sit.id));
  const count = rt.records.size;
  for (let i = 0; i < 40; i++) rt.step();
  assert.equal(rt.records.size, count);
  assert.equal(
    [...rt.records.values()].filter((r) => r.status === 'failed').length,
    0,
  );
  rt.cancel(sit.id);
  until(rt, () => !rt.isActive(sit.id));
  control(rt, a.id, 'resume');
  complete(rt, a.id);
});
test('changed destination support after storage waits and safely stops setup; explicit restoration continues same items', () => {
  const { rt, a } = start();
  until(rt, () => read(rt, a.id).setup?.current?.phase === 'move');
  const support = structuredClone(rt.world.entities['storage-table'].support);
  rt.world.entities['storage-table'].support = { kind: 'none' };
  until(rt, () => read(rt, a.id).mode === 'waiting');
  assert.equal(
    read(rt, a.id).diagnostic!.code,
    'room_preparation.stored-item-changed',
  );
  assert.equal(rt.world.entities['belongings-table'].support?.kind, 'ground');
  const refused = roomPreparationControl.plan(rt, {
    preparation: a.id,
    intent: 'resume',
  });
  assert.equal(refused.ok, false);
  rt.world.entities['storage-table'].support = support;
  control(rt, a.id, 'resume');
  complete(rt, a.id);
});
test('original classroom edge-slot capacity limit is unchanged; malformed definition and missing item refuse before dispatch', () => {
  const original = classroomWorld(4);
  original.entities['storage-table'] = {
    ...structuredClone(original.entities['belongings-table']),
    id: 'storage-table',
    pose: { p: [12, 0, 4], yaw: 0 },
  };
  const rt = new Runtime(
      original,
      createRegistry(),
      servicesFor({ classroom: classroomScene() })(original),
      ENGINE_INVARIANTS,
    ),
    p = roomPreparationBinding();
  p.tidy.transfers[0].from = 'belongings-table#r0c1';
  p.tidy.transfers[1].from = 'belongings-table#r0c2';
  const d = rt.registry.get('tidy_table')!.plan(rt, p.tidy);
  assert.equal(d.ok, false);
  if (!d.ok) assert.equal(d.diagnostic.code, 'tidy_table.source-capacity');
  for (const missing of [true, false]) {
    const { rt, p } = start();
    control(rt, [...rt.records.values()][0].id, 'end');
    until(rt, () => !rt.isActive([...rt.records.values()][0].id));
    if (missing) delete rt.world.entities['break-bowl'];
    else p.setup.moves[1].fixture = 'belongings-table';
    const r = rt.submit('room_preparation', p);
    assert.equal(r.status, 'failed');
    assert.equal(
      r.diagnostic?.code,
      missing ? 'tidy_table.item-missing' : 'room_preparation.definition',
    );
    assert.equal(
      [...rt.records.values()].filter((c) => c.parent === r.id).length,
      0,
    );
  }
});

test('pre-tick Pause and exact tidy completion boundary preserve original payload and require explicit restored Resume', () => {
  const { rt, a } = start();
  control(rt, a.id, 'pause');
  until(rt, () => read(rt, a.id).mode === 'paused');
  assert.equal(read(rt, a.id).ownedActions.length, 0);
  control(rt, a.id, 'resume');
  until(
    rt,
    () =>
      read(rt, a.id).tidy?.finished === true &&
      read(rt, a.id).stage === 'clearing',
  );
  const tidy = read(rt, a.id).tidy!.task,
    original = structuredClone(rt.world.entities['break-bowl'].contents);
  control(rt, a.id, 'pause');
  until(rt, () => read(rt, a.id).mode === 'paused');
  rt.world.entities['break-bowl'].contents = {
    food: 'substituted',
    fraction: 1,
  };
  const refused = roomPreparationControl.plan(rt, {
    preparation: a.id,
    intent: 'resume',
  });
  assert.equal(refused.ok, false);
  if (!refused.ok)
    assert.equal(
      refused.diagnostic.code,
      'room_preparation.item-payload-changed',
    );
  rt.world.entities['break-bowl'].contents = original;
  control(rt, a.id, 'resume');
  complete(rt, a.id);
  assert.equal(read(rt, a.id).tidy!.task, tidy);
});
test('completed setup changed during boundary Pause waits for explicit remaining-fixture retry rather than repeating tidy/table', () => {
  const { rt, a } = start();
  until(
    rt,
    () =>
      read(rt, a.id).setup?.ready === true &&
      read(rt, a.id).stage === 'arranging',
  );
  control(rt, a.id, 'pause');
  until(rt, () => read(rt, a.id).mode === 'paused');
  const table = structuredClone(rt.world.entities['belongings-table'].pose),
    tidy = read(rt, a.id).tidy!.task;
  // A declared external placement change; the coordinator never writes it itself.
  rt.world.entities.seat8.pose.p[0] += 1;
  control(rt, a.id, 'resume');
  complete(rt, a.id);
  assert.deepEqual(rt.world.entities['belongings-table'].pose, table);
  assert.equal(read(rt, a.id).tidy!.task, tidy);
  const setups = [...rt.records.values()].filter(
    (r) => r.verb === 'setup_room',
  );
  assert.equal(setups.length, 2);
  assert.deepEqual(
    (setups[1].params as { moves: { fixture: string }[] }).moves.map(
      (m) => m.fixture,
    ),
    ['seat8'],
  );
});
