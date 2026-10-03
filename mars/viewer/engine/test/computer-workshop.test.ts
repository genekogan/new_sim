import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Runtime } from '../runtime/runtime.ts';
import { allSlots } from '../social/slots.ts';
import { heldBy } from '../items/model.ts';
import { readWorkstation } from '../objects/workstation.ts';
import {
  readComputerWorkshop,
  type ComputerWorkshopControlParams,
} from '../activities/computer-workshop.ts';
import {
  computerWorkshopRuntime,
  computerWorkshopBinding,
} from '../scenarios/computer-workshop.ts';

function until(rt: Runtime, predicate: () => boolean, max = 8000) {
  for (let n = 0; n < max && !predicate(); n++) rt.step();
  assert.ok(
    predicate(),
    JSON.stringify([...rt.records.values()].filter((r) => rt.isActive(r.id))),
  );
  assert.deepEqual(rt.violations, []);
}
function start() {
  const rt = computerWorkshopRuntime(),
    p = computerWorkshopBinding();
  const r = rt.submit('computer_workshop', p, { preempt: false });
  assert.equal(r.status, 'executing', r.diagnostic?.message);
  const read = () => readComputerWorkshop(rt, r.id)!;
  return { rt, p, r, read };
}
function control(
  rt: Runtime,
  workshop: string,
  intent: ComputerWorkshopControlParams['intent'],
  actor?: string,
) {
  const r = rt.submit(
    'computer_workshop_control',
    { workshop, intent, ...(actor ? { actor } : {}) },
    { preempt: false },
  );
  assert.notEqual(r.status, 'failed', r.diagnostic?.message);
  return r;
}
function station(rt: Runtime, id = 'computer-a') {
  const s = readWorkstation(rt, id);
  assert.ok(!('code' in s));
  return s;
}
function clean(rt: Runtime, workshop: string, expectedRefusals: string[] = []) {
  const s = readComputerWorkshop(rt, workshop)!;
  for (const c of s.claims) assert.deepEqual(c.holders, [], c.resource);
  for (const q of allSlots(rt)) assert.equal(q.claimedBy, undefined, q.id);
  for (const a of ['facilitator', 'learner-a', 'learner-b']) {
    assert.deepEqual(heldBy(rt.world, a), []);
    assert.equal(rt.world.entities[a].human!.task, undefined);
    assert.equal(rt.world.entities[a].human!.activity, 'idle');
    assert.deepEqual(rt.holder(`actor:${a}`), []);
  }
  assert.deepEqual(rt.violations, []);
  assert.ok([...rt.records.values()].every((r) => !rt.isActive(r.id)));
  assert.deepEqual(
    [...rt.records.values()]
      .filter((r) => r.status === 'failed')
      .map((r) => r.id),
    expectedRefusals,
  );
  assert.equal(
    rt.world.entities['workshop-screen'].equipment!.config.mode,
    'off',
  );
}
function partial(s: ReturnType<typeof start>) {
  until(
    s.rt,
    () =>
      s.read().stage === 'practice' &&
      s.read().learners.every((l) => l.elapsed >= 2 && l.child),
  );
}
function finish(s: ReturnType<typeof start>) {
  until(s.rt, () => !s.rt.isActive(s.r.id));
  assert.equal(s.read().mode, 'completed');
  assert.equal(s.read().finished, true);
  clean(s.rt, s.r.id);
}

test('ordinary demonstration, question, distinct seated work and learner review complete', () => {
  const s = start();
  until(s.rt, () => s.read().current?.phase === 'presenting');
  assert.equal(s.read().current!.presenter, 'facilitator');
  assert.equal(
    s.rt.world.entities['workshop-screen'].equipment!.config.mode,
    'on',
  );
  control(s.rt, s.r.id, 'question', 'learner-b');
  until(s.rt, () => s.read().current?.phase === 'question');
  assert.equal(s.read().current!.floorHolder, 'learner-b');
  partial(s);
  const children = s.read().learners.map((l) => l.child!);
  assert.equal(s.rt.world.entities['learner-a'].human!.activity, 'sit');
  assert.equal(s.rt.world.entities['learner-b'].human!.activity, 'sit');
  assert.equal(station(s.rt).task, s.p.learners[0].task);
  assert.equal(station(s.rt, 'computer-b').task, s.p.learners[1].task);
  assert.notEqual(children[0], children[1]);
  until(
    s.rt,
    () =>
      s.read().stage === 'review' && s.read().current?.phase === 'presenting',
  );
  assert.equal(s.read().current!.presenter, 'learner-a');
  assert.deepEqual(
    s.read().learners.map((l) => [l.elapsed, l.completed]),
    [
      [12, true],
      [18, true],
    ],
  );
  finish(s);
  assert.deepEqual(
    s.read().history.map((h) => [h.stage, h.status]),
    [
      ['demonstration', 'completed'],
      ['review', 'completed'],
    ],
  );
  assert.deepEqual(
    s.read().learners.map((l) => l.actions),
    children.map((id) => [id]),
  );
  for (const [actor, p] of Object.entries(s.p.review.departure)) {
    const q = s.rt.world.entities[actor].pose.p;
    assert.ok(Math.abs(q[0] - p[0]) < 0.01 && Math.abs(q[2] - p[1]) < 0.01);
  }
});

test('individual Pause/Resume keeps exact task progress while peer remains active', () => {
  const s = start();
  partial(s);
  const a = s.read().learners[0].child!,
    b = s.read().learners[1].child!,
    elapsed = station(s.rt).elapsed;
  control(s.rt, s.r.id, 'pause-learner', 'learner-a');
  until(s.rt, () => !s.rt.isActive(a) && !s.read().learners[0].child);
  assert.equal(station(s.rt).elapsed, elapsed);
  const peer = station(s.rt, 'computer-b').elapsed;
  for (let n = 0; n < 20; n++) s.rt.step();
  assert.equal(station(s.rt).elapsed, elapsed);
  assert.ok(station(s.rt, 'computer-b').elapsed > peer);
  assert.ok(s.rt.isActive(b));
  control(s.rt, s.r.id, 'resume-learner', 'learner-a');
  until(s.rt, () => !!s.read().learners[0].child);
  const resumed = s.read().learners[0].child!;
  assert.notEqual(resumed, a);
  assert.deepEqual(s.rt.records.get(resumed)!.params, {
    ...s.p.learners[0],
    resume: true,
  });
  assert.equal(station(s.rt).elapsed, elapsed);
  finish(s);
  assert.deepEqual(s.read().learners[0].actions, [a, resumed]);
  assert.deepEqual(s.read().learners[1].actions, [b]);
});

test('ordinary direction preserves withdrawn learner progress and requires explicit Join/Resume', () => {
  const s = start();
  partial(s);
  const a = s.read().learners[0].child!,
    b = s.read().learners[1].child!,
    elapsed = station(s.rt).elapsed;
  const walk = s.rt.submit('walk_to', { actor: 'learner-a', x: -7, z: 9 });
  assert.notEqual(walk.status, 'failed', walk.diagnostic?.message);
  until(s.rt, () => !s.rt.isActive(walk.id) && !s.read().learners[0].child);
  assert.equal(station(s.rt).elapsed, elapsed);
  assert.equal(
    s.read().members.find((m) => m.actor === 'learner-a')!.present,
    false,
  );
  until(s.rt, () => s.read().learners[1].completed);
  for (let n = 0; n < 20; n++) s.rt.step();
  assert.equal(s.read().stage, 'practice');
  assert.equal(s.read().sessions.review, undefined);
  assert.deepEqual(s.read().learners[1].actions, [b]);
  const denied = s.rt.submit('computer_workshop_control', {
    workshop: s.r.id,
    intent: 'resume-learner',
    actor: 'learner-a',
  });
  assert.equal(
    denied.diagnostic?.code,
    'computer_workshop.learner-resume-busy',
  );
  control(s.rt, s.r.id, 'join', 'learner-a');
  control(s.rt, s.r.id, 'resume-learner', 'learner-a');
  // The expected refused control remains in the record history.
  until(s.rt, () => !s.rt.isActive(s.r.id));
  assert.equal(s.read().finished, true);
  assert.equal(s.read().learners[0].elapsed, 12);
  assert.equal(s.read().learners[0].actions[0], a);
  assert.deepEqual(s.rt.violations, []);
  assert.ok(s.read().claims.every((c) => !c.holders.length));
  clean(s.rt, s.r.id, [denied.id]);
});

test('Leave persists after ordinary departure, Join does not implicitly resume partial work', () => {
  const s = start();
  partial(s);
  control(s.rt, s.r.id, 'leave', 'learner-a');
  until(
    s.rt,
    () =>
      !!s.read().departures['learner-a'] &&
      !s.rt.isActive(s.read().departures['learner-a']),
  );
  const elapsed = station(s.rt).elapsed;
  until(s.rt, () => s.read().learners[1].completed);
  assert.equal(
    s.read().members.find((m) => m.actor === 'learner-a')!.present,
    false,
  );
  control(s.rt, s.r.id, 'join', 'learner-a');
  for (let n = 0; n < 20; n++) s.rt.step();
  assert.equal(station(s.rt).elapsed, elapsed);
  assert.equal(s.read().learners[0].paused, true);
  control(s.rt, s.r.id, 'resume-learner', 'learner-a');
  finish(s);
});

for (const phase of ['demonstration', 'practice', 'review'] as const)
  test(`End in ${phase} drains ordinary children once and retains session history`, () => {
    const s = start();
    if (phase === 'practice') partial(s);
    else
      until(
        s.rt,
        () =>
          s.read().stage === phase && s.read().current?.phase === 'presenting',
      );
    const session =
      s.read().sessions[phase === 'demonstration' ? 'demonstration' : 'review'];
    const previous = s.p.learners.map((l) => station(s.rt, l.station).elapsed);
    control(s.rt, s.r.id, 'end');
    assert.ok(s.rt.isActive(s.r.id));
    const accepted = s.rt.cancel(s.r.id);
    assert.equal(accepted.id, s.r.id);
    until(s.rt, () => !s.rt.isActive(s.r.id));
    assert.equal(s.read().mode, 'ended');
    assert.equal(s.read().finished, false);
    assert.deepEqual(
      s.read().learners.map((l) => l.elapsed),
      previous,
    );
    if (session)
      assert.equal(
        s.read().history.find((h) => h.session === session)!.status,
        'cancelled',
      );
    clean(s.rt, s.r.id);
    const count = s.rt.records.size;
    s.rt.cancel(s.r.id);
    for (let n = 0; n < 10; n++) s.rt.step();
    assert.equal(s.rt.records.size, count);
  });

for (const fault of ['service', 'display', 'computer', 'seat'] as const)
  test(`admission refuses ${fault} without children and unrelated world still advances`, () => {
    const rt = computerWorkshopRuntime(),
      p = computerWorkshopBinding();
    if (fault === 'service') delete rt.services.classroomDisplay;
    if (fault === 'display')
      rt.world.entities['workshop-screen'].equipment!.config.available = false;
    if (fault === 'computer') delete rt.world.entities['computer-a'];
    let occupied: string | undefined;
    if (fault === 'seat') {
      const r = rt.submit('sit', {
        actor: 'facilitator',
        slot: 'computer-chair-a#seat',
      });
      assert.notEqual(r.status, 'failed', r.diagnostic?.message);
      occupied = r.id;
    }
    const r = rt.submit('computer_workshop', p, { preempt: false });
    assert.equal(r.status, 'failed');
    assert.ok(r.diagnostic?.code);
    if (fault === 'service')
      assert.equal(r.diagnostic!.code, 'classroom.display-unavailable');
    assert.equal(
      [...rt.records.values()].filter((x) => x.parent === r.id).length,
      0,
    );
    if (occupied) {
      rt.cancel(occupied);
      until(rt, () => !rt.isActive(occupied!));
    }
    const tick = rt.tick,
      walk = rt.submit('walk_to', { actor: 'learner-b', x: 5, z: 11 });
    assert.notEqual(walk.status, 'failed', walk.diagnostic?.message);
    until(rt, () => !rt.isActive(walk.id));
    assert.equal(walk.status, 'completed');
    assert.ok(rt.tick > tick);
    assert.deepEqual(rt.violations, []);
  });

test('changed supported fixture binding waits honestly, restoring it and Resume retain tasks', () => {
  const s = start();
  partial(s);
  control(s.rt, s.r.id, 'pause');
  until(s.rt, () => s.read().mode === 'paused');
  const elapsed = s.read().learners.map((l) => l.elapsed),
    chair = s.rt.world.entities['gather-chair-a'];
  const original = structuredClone(chair.pose);
  chair.pose.p[0] -= 0.1;
  control(s.rt, s.r.id, 'resume');
  s.rt.step();
  assert.equal(s.read().diagnostic?.code, 'computer_workshop.binding-changed');
  assert.equal(s.read().mode, 'waiting');
  assert.deepEqual(
    s.read().learners.map((l) => l.elapsed),
    elapsed,
  );
  chair.pose = original;
  control(s.rt, s.r.id, 'resume');
  finish(s);
});

test('readout is detached and repeat execution has identical hashes and receipts', () => {
  function run() {
    const s = start();
    partial(s);
    const view = s.read();
    view.bindings.learners[0].task = 'mutated';
    view.learners[0].elapsed = 999;
    view.members[0].present = false;
    assert.equal(s.read().bindings.learners[0].task, s.p.learners[0].task);
    assert.notEqual(s.read().learners[0].elapsed, 999);
    assert.equal(s.read().members[0].present, true);
    finish(s);
    return { hash: s.rt.stateHash(), read: s.read(), events: s.rt.events };
  }
  assert.deepEqual(run(), run());
});

test('unavailable learner computer waits without retrying or cancelling peer, explicit remedy resumes exact task', () => {
  const s = start();
  partial(s);
  const a = s.read().learners[0].child!,
    b = s.read().learners[1].child!;
  control(s.rt, s.r.id, 'pause-learner', 'learner-a');
  until(s.rt, () => !s.read().learners[0].child);
  const elapsed = station(s.rt).elapsed;
  s.rt.world.entities['computer-a'].equipment!.config.available = false;
  control(s.rt, s.r.id, 'resume-learner', 'learner-a');
  s.rt.step();
  assert.equal(
    s.read().learners[0].diagnostic?.code,
    'workstation.unavailable',
  );
  assert.equal(s.read().learners[0].paused, true);
  const tick = s.rt.tick,
    actions = s.read().learners[0].actions.slice();
  until(s.rt, () => s.read().learners[1].completed);
  assert.ok(s.rt.tick > tick);
  assert.deepEqual(s.read().learners[0].actions, actions);
  assert.equal(station(s.rt).elapsed, elapsed);
  assert.equal(s.rt.records.get(b)!.status, 'completed');
  s.rt.world.entities['computer-a'].equipment!.config.available = true;
  control(s.rt, s.r.id, 'resume-learner', 'learner-a');
  finish(s);
  assert.equal(s.read().learners[0].actions[0], a);
  assert.equal(s.read().learners[0].elapsed, 12);
});

test('unsupported role binding and gathering Pause refuse truthfully; ordinary End remains available', () => {
  const rt = computerWorkshopRuntime(),
    p = computerWorkshopBinding();
  p.review.presenters = ['learner-a', 'learner-b'];
  const bad = rt.submit('computer_workshop', p);
  assert.equal(bad.diagnostic?.code, 'computer_workshop.session-binding');
  const s = start();
  until(s.rt, () => s.read().current?.phase === 'presenting');
  const paused = s.rt.submit('computer_workshop_control', {
    workshop: s.r.id,
    intent: 'pause',
  });
  assert.equal(
    paused.diagnostic?.code,
    'computer_workshop.session-pause-unsupported',
  );
  assert.equal(s.read().mode, 'running');
  control(s.rt, s.r.id, 'end');
  until(s.rt, () => !s.rt.isActive(s.r.id));
  clean(s.rt, s.r.id, [paused.id]);
});

for (const stop of ['end', 'cancel'] as const)
  test(`${stop} then Pause cannot downgrade accepted End cleanup`, () => {
    const s = start();
    partial(s);
    const elapsed = s.p.learners.map((l) => station(s.rt, l.station).elapsed);
    if (stop === 'end') control(s.rt, s.r.id, 'end');
    else s.rt.cancel(s.r.id);
    const pause = s.rt.submit('computer_workshop_control', {
      workshop: s.r.id,
      intent: 'pause',
    });
    assert.equal(pause.status, 'failed');
    assert.equal(pause.diagnostic?.code, 'computer_workshop.ending');
    assert.equal(s.read().mode, 'ending');
    until(s.rt, () => !s.rt.isActive(s.r.id));
    assert.equal(s.read().mode, 'ended');
    assert.deepEqual(
      s.read().learners.map((l) => l.elapsed),
      elapsed,
    );
    clean(s.rt, s.r.id, [pause.id]);
  });

test('external ordinary station reuse cannot restart a retained workshop task', () => {
  const s = start();
  partial(s);
  control(s.rt, s.r.id, 'pause-learner', 'learner-a');
  until(s.rt, () => !s.read().learners[0].child);
  const retained = structuredClone(s.read().learners[0]);
  const old = s.rt.submit('work_at', { ...s.p.learners[0], resume: true });
  assert.notEqual(old.status, 'failed', old.diagnostic?.message);
  until(s.rt, () => !s.rt.isActive(old.id));
  const replacement = s.rt.submit('work_at', {
    ...s.p.learners[0],
    task: 'External unrelated study',
    duration: 0.5,
  });
  assert.notEqual(
    replacement.status,
    'failed',
    replacement.diagnostic?.message,
  );
  until(s.rt, () => !s.rt.isActive(replacement.id));
  control(s.rt, s.r.id, 'join', 'learner-a');
  const records = s.rt.records.size,
    receipt = station(s.rt);
  const denied = s.rt.submit('computer_workshop_control', {
    workshop: s.r.id,
    intent: 'resume-learner',
    actor: 'learner-a',
  });
  assert.equal(denied.status, 'failed');
  assert.equal(
    denied.diagnostic?.code,
    'computer_workshop.retained-task-replaced',
  );
  for (let n = 0; n < 40; n++) s.rt.step();
  assert.equal(s.rt.records.size, records + 1);
  assert.deepEqual(station(s.rt), receipt);
  assert.equal(s.read().learners[0].elapsed, retained.elapsed);
  assert.deepEqual(s.read().learners[0].actions, retained.actions);
  assert.deepEqual(s.read().learners[0].receipt, retained.receipt);
  control(s.rt, s.r.id, 'end');
  until(s.rt, () => !s.rt.isActive(s.r.id));
  clean(s.rt, s.r.id, [denied.id]);
});

for (const withdrawal of ['direction', 'leave'] as const)
  test(`facilitator ${withdrawal} permits peer practice but review waits for explicit Join`, () => {
    const s = start();
    partial(s);
    const children = s.read().learners.map((l) => l.child);
    if (withdrawal === 'leave') control(s.rt, s.r.id, 'leave', 'facilitator');
    else {
      const walk = s.rt.submit('walk_to', {
        actor: 'facilitator',
        x: -5,
        z: 10,
      });
      assert.notEqual(walk.status, 'failed', walk.diagnostic?.message);
      until(s.rt, () => !s.rt.isActive(walk.id));
    }
    until(
      s.rt,
      () =>
        s.read().learners.every((l) => l.completed) &&
        s.read().ownedActions.every((id) => !s.rt.isActive(id)),
    );
    assert.equal(
      s.read().members.find((m) => m.actor === 'facilitator')!.present,
      false,
    );
    assert.equal(s.read().sessions.review, undefined);
    assert.equal(s.read().stage, 'practice');
    assert.equal(
      s.read().diagnostic?.code,
      'computer_workshop.insufficient-audience',
    );
    for (let n = 0; n < 30; n++) s.rt.step();
    assert.equal(s.read().sessions.review, undefined);
    assert.deepEqual(
      s.read().learners.map((l) => l.actions),
      children.map((id) => [id]),
    );
    control(s.rt, s.r.id, 'join', 'facilitator');
    finish(s);
  });
