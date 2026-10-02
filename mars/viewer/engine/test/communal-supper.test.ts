import test from 'node:test';
import assert from 'node:assert/strict';
import {
  communalSupperRuntime,
  communalSupperBinding,
} from '../scenarios/communal-supper.ts';
import {
  readCommunalSupper,
  communalSupperControl,
} from '../activities/communal-supper.ts';
import type { Runtime } from '../runtime/runtime.ts';
const read = (rt: Runtime, id: string) => {
  const r = readCommunalSupper(rt, id);
  assert.ok(r);
  return r;
};
function until(rt: Runtime, done: () => boolean, max = 10000) {
  for (let i = 0; i < max && !done(); i++) {
    rt.step();
    assert.deepEqual(rt.violations, []);
    for (const id of [
      'pot',
      'beans',
      'greens',
      'spoon',
      'cook-bowl',
      'guest-bowl',
      'guest-spoon',
    ])
      assert.ok(
        ['resting-on', 'in-hand'].includes(
          rt.world.entities[id]?.support?.kind ?? '',
        ),
        id,
      );
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
  const rt = communalSupperRuntime(),
    p = communalSupperBinding(),
    a = rt.submit('communal_supper', p);
  assert.equal(a.status, 'executing', a.diagnostic?.message);
  return { rt, p, a };
}
function control(rt: Runtime, id: string, intent: 'pause' | 'resume' | 'end') {
  const r = rt.submit('communal_supper_control', { supper: id, intent });
  assert.notEqual(r.status, 'failed', r.diagnostic?.message);
  return r;
}
function clean(rt: Runtime) {
  assert.deepEqual(rt.violations, []);
  assert.deepEqual(
    [...rt.records.values()].filter((r) => rt.isActive(r.id)),
    [],
  );
  for (const e of Object.values(rt.world.entities)) {
    assert.notEqual(e.support?.kind, 'in-hand');
    assert.deepEqual(rt.holder(`entity:${e.id}`), []);
    if (e.human) {
      assert.ok(!e.human.task);
      assert.ok(!e.human.hands);
      for (const r of [
        `actor:${e.id}`,
        `hand:${e.id}:right`,
        `hand:${e.id}:left`,
        `tidy-task:${e.id}`,
      ])
        assert.deepEqual(rt.holder(r), []);
    }
  }
  assert.deepEqual(rt.holder('communal-supper'), []);
  assert.deepEqual(rt.holder('shared-food:pot'), []);
  for (const r of rt.records.values())
    if (r.verb === 'communal_supper')
      assert.deepEqual(read(rt, r.id).claims, []);
}
function complete(rt: Runtime, id: string) {
  until(rt, () => !rt.isActive(id));
  assert.equal(read(rt, id).finished, true);
  clean(rt);
}
function pause(rt: Runtime, id: string) {
  control(rt, id, 'pause');
  until(rt, () => read(rt, id).mode === 'paused');
  const n = rt.records.size;
  for (let i = 0; i < 20; i++) rt.step();
  assert.equal(rt.records.size, n);
}
test('same seven vessels prepare once, converse/eat and store empty with exact replay and detached readout', () => {
  const run = () => {
    const { rt, p, a } = start(),
      original = Object.values(rt.world.entities).map((e) => [
        e.id,
        e.def,
        e.provenance,
      ]);
    let talking = false,
      eating = false;
    const remaining = () =>
      (rt.world.entities.beans.contents!.fraction +
        rt.world.entities.greens.contents!.fraction +
        rt.world.entities['cook-bowl'].contents!.fraction +
        rt.world.entities['guest-bowl'].contents!.fraction) /
        4 +
      rt.world.entities.pot.contents!.fraction;
    let last = 0.5;
    until(rt, () => {
      const r = read(rt, a.id);
      talking ||= !!r.meal?.floorHolder;
      eating ||= r.meal?.phase === 'eating';
      const q = remaining();
      assert.ok(q <= last + 1e-9);
      const consumed =
        r.meal?.receipts?.reduce((n, person) => n + person.consumed / 4, 0) ??
        0;
      assert.equal(q + consumed, 0.5);
      last = q;
      return !rt.isActive(a.id);
    });
    assert.ok(talking && eating);
    assert.equal(read(rt, a.id).finished, true);
    assert.equal(remaining(), 0);
    assert.deepEqual(
      Object.values(rt.world.entities).map((e) => [e.id, e.def, e.provenance]),
      original,
    );
    for (const batch of p.cleanup)
      for (const t of batch.transfers)
        assert.deepEqual(rt.world.entities[t.item].support, {
          kind: 'resting-on',
          on: t.to.split('#')[0],
          slot: t.to.split('#')[1],
        });
    assert.equal(
      [...rt.records.values()].filter((r) => r.verb === 'prepare_food').length,
      1,
    );
    assert.equal(
      [...rt.records.values()].filter((r) => r.status === 'failed').length,
      0,
    );
    const frozen = read(rt, a.id);
    frozen.items[0].pose.p[0] = 999;
    assert.notEqual(rt.world.entities.pot.pose.p[0], 999);
    clean(rt);
    return {
      hash: rt.stateHash(),
      records: [...rt.records.values()],
      read: read(rt, a.id),
    };
  };
  assert.deepEqual(run(), run());
});
test('partial preparation Pause/Resume retains deposited material and retries existing pot recipe', () => {
  const { rt, a } = start();
  until(
    rt,
    () => read(rt, a.id).preparation?.ingredients[0].deposited === 0.25,
  );
  pause(rt, a.id);
  const partial = structuredClone(read(rt, a.id).preparation);
  assert.equal(partial!.complete, false);
  const quantities = ['beans', 'greens', 'pot'].map(
    (id) => rt.world.entities[id].contents,
  );
  for (let i = 0; i < 20; i++) rt.step();
  assert.deepEqual(read(rt, a.id).preparation, partial);
  assert.deepEqual(
    ['beans', 'greens', 'pot'].map((id) => rt.world.entities[id].contents),
    quantities,
  );
  control(rt, a.id, 'resume');
  complete(rt, a.id);
  assert.equal(
    [...rt.records.values()].filter((r) => r.verb === 'prepare_food').length,
    2,
  );
});
for (const boundary of ['partial', 'consumed', 'stowing'] as const)
  test(`meal ${boundary} safe Pause resumes same purpose and receipts without preparing or serving eaten bowls again`, () => {
    const { rt, a } = start();
    until(rt, () => {
      const r = read(rt, a.id).meal;
      if (!r) return false;
      return boundary === 'partial'
        ? r.phase === 'eating' &&
            r.participants.some((q) => q.food > 0 && q.food < 1)
        : boundary === 'consumed'
          ? r.receipts!.every((q) => q.consumptionCompleted) &&
            r.participants.every((q) => q.food === 0) &&
            r.phase !== 'completed'
          : r.phase === 'stowing';
    });
    pause(rt, a.id);
    const first = read(rt, a.id).meal!,
      prepCount = [...rt.records.values()].filter(
        (r) => r.verb === 'prepare_food',
      ).length,
      serves = [...rt.records.values()].filter(
        (r) => r.verb === 'serve',
      ).length;
    assert.equal(first.status, 'cancelled');
    assert.ok(first.receipts!.every((q) => q.served));
    control(rt, a.id, 'resume');
    complete(rt, a.id);
    const last = read(rt, a.id).meal!;
    assert.equal(last.purpose, first.purpose);
    assert.equal(last.resumeFrom, first.action);
    assert.equal(
      [...rt.records.values()].filter((r) => r.verb === 'serve').length,
      serves,
    );
    assert.equal(
      [...rt.records.values()].filter((r) => r.verb === 'prepare_food').length,
      prepCount,
    );
    assert.ok(
      last.receipts!.every((q) => q.consumptionCompleted && q.consumed === 1),
    );
  });
for (const stage of ['storing-mealware', 'storing-prepware'])
  test(`${stage} partial cleanup safe Pause retains same persistent task`, () => {
    const { rt, a } = start();
    until(rt, () => {
      const r = read(rt, a.id),
        t = r.cleanup.at(-1);
      return (
        r.stage === stage &&
        t?.completed.length === 1 &&
        t.current?.held === true
      );
    });
    const first = read(rt, a.id).cleanup.at(-1)!,
      stored = structuredClone(rt.world.entities[first.completed[0].item]);
    pause(rt, a.id);
    assert.deepEqual(rt.world.entities[stored.id], stored);
    assert.equal(read(rt, a.id).cleanup.at(-1)!.task, first.task);
    control(rt, a.id, 'resume');
    complete(rt, a.id);
    assert.equal(
      read(rt, a.id).cleanup.find((t) => t!.task === first.task)!.task,
      first.task,
    );
  });
for (const stage of [
  'before',
  'preparing',
  'sharing',
  'storing-mealware',
  'storing-prepware',
])
  test(`End ${stage} drains all physical work without claiming finished`, () => {
    const { rt, a } = start(),
      original = structuredClone(rt.world.entities);
    if (stage === 'preparing')
      until(
        rt,
        () => read(rt, a.id).preparation?.ingredients[0].deposited === 0.25,
      );
    else if (stage === 'sharing')
      until(rt, () => read(rt, a.id).meal?.phase === 'eating');
    else if (stage !== 'before')
      until(
        rt,
        () =>
          read(rt, a.id).stage === stage &&
          read(rt, a.id).cleanup.at(-1)?.current?.held === true,
      );
    control(rt, a.id, 'end');
    until(rt, () => !rt.isActive(a.id));
    assert.equal(a.status, 'cancelled');
    assert.equal(read(rt, a.id).finished, false);
    if (stage === 'before') {
      assert.deepEqual(rt.world.entities, original);
      assert.deepEqual(read(rt, a.id).ownedActions, []);
    }
    clean(rt);
  });
test('ordinary cleanup direction preserves independent walk and yields retained task until explicit Resume', () => {
  const { rt, a } = start();
  until(
    rt,
    () =>
      read(rt, a.id).stage === 'storing-mealware' &&
      read(rt, a.id).cleanup[0]?.current?.held === true,
  );
  const task = read(rt, a.id).cleanup[0]!.task,
    w = rt.submit('walk_to', { actor: 'cook', x: -5, z: 5 });
  assert.notEqual(w.status, 'failed', w.diagnostic?.message);
  until(rt, () => !rt.isActive(w.id) && read(rt, a.id).mode === 'waiting');
  assert.deepEqual(rt.world.entities.cook.pose.p, [-5, 0, 5]);
  const n = rt.records.size;
  for (let i = 0; i < 30; i++) rt.step();
  assert.equal(rt.records.size, n);
  control(rt, a.id, 'resume');
  complete(rt, a.id);
  assert.equal(read(rt, a.id).cleanup[0]!.task, task);
});
test('safe cancelled meal permits ordinary direction then same receipt explicit Resume', () => {
  const { rt, a } = start();
  until(rt, () => read(rt, a.id).meal?.phase === 'eating');
  pause(rt, a.id);
  const w = rt.submit('walk_to', { actor: 'cook', x: -5, z: 5 });
  assert.notEqual(w.status, 'failed', w.diagnostic?.message);
  until(rt, () => !rt.isActive(w.id));
  control(rt, a.id, 'resume');
  complete(rt, a.id);
});
test('changed fixture binding and unavailable cleanup surface wait without failed child spam; explicit restoration', () => {
  const { rt, a } = start();
  pause(rt, a.id);
  const old = structuredClone(rt.world.entities['ware-store'].pose);
  rt.world.entities['ware-store'].pose.p[0] += 1;
  const plan = communalSupperControl.plan(rt, {
    supper: a.id,
    intent: 'resume',
  });
  assert.equal(plan.ok, false);
  if (!plan.ok)
    assert.equal(plan.diagnostic.code, 'communal_supper.binding-changed');
  rt.world.entities['ware-store'].pose = old;
  control(rt, a.id, 'resume');
  until(rt, () => read(rt, a.id).stage === 'sharing');
  const support = structuredClone(rt.world.entities['ware-store'].support);
  rt.world.entities['ware-store'].support = { kind: 'none' };
  until(rt, () => read(rt, a.id).mode === 'paused');
  const n = rt.records.size;
  for (let i = 0; i < 30; i++) rt.step();
  assert.equal(rt.records.size, n);
  assert.equal(
    read(rt, a.id).diagnostic?.code,
    'communal_supper.binding-changed',
  );
  rt.world.entities['ware-store'].support = support;
  control(rt, a.id, 'resume');
  complete(rt, a.id);
});
test('missing ingredient and malformed storage coverage refuse before any physical child', () => {
  for (const missing of [true, false]) {
    const rt = communalSupperRuntime(),
      p = communalSupperBinding();
    if (missing) delete rt.world.entities.beans;
    else p.cleanup[1].transfers[0].item = 'pot';
    const a = rt.submit('communal_supper', p);
    assert.equal(a.status, 'failed');
    assert.equal(
      [...rt.records.values()].filter((r) => r.parent === a.id).length,
      0,
    );
  }
});
test('exact completed preparation Pause boundary advances checkpoint rather than rerunning recipe', () => {
  const { rt, a } = start();
  until(
    rt,
    () =>
      read(rt, a.id).preparation?.complete === true &&
      read(rt, a.id).stage === 'preparing' &&
      !rt.isActive(read(rt, a.id).current!),
  );
  pause(rt, a.id);
  control(rt, a.id, 'resume');
  complete(rt, a.id);
  assert.equal(
    [...rt.records.values()].filter((r) => r.verb === 'prepare_food').length,
    1,
  );
});
test('exact completed meal Pause boundary advances receipts without trying a fresh empty-pot meal', () => {
  const { rt, a } = start();
  until(
    rt,
    () =>
      read(rt, a.id).meal?.phase === 'completed' &&
      read(rt, a.id).stage === 'sharing',
  );
  pause(rt, a.id);
  control(rt, a.id, 'resume');
  complete(rt, a.id);
  assert.equal(
    [...rt.records.values()].filter((r) => r.verb === 'shared_food_break')
      .length,
    1,
  );
});
test('preparation safe Pause then ordinary cook direction uses same ingredients and explicit retained retry', () => {
  const { rt, a } = start();
  until(
    rt,
    () => read(rt, a.id).preparation?.ingredients[0].deposited === 0.25,
  );
  pause(rt, a.id);
  const partial = structuredClone(read(rt, a.id).preparation),
    w = rt.submit('walk_to', { actor: 'cook', x: -4, z: -3 });
  assert.notEqual(w.status, 'failed', w.diagnostic?.message);
  until(rt, () => !rt.isActive(w.id));
  assert.deepEqual(rt.world.entities.cook.pose.p, [-4, 0, -3]);
  assert.deepEqual(read(rt, a.id).preparation, partial);
  control(rt, a.id, 'resume');
  complete(rt, a.id);
});
test('uncancelled ordinary meal direction preserves player action but failed meal source is an explicit continuation refusal', () => {
  const { rt, a } = start();
  until(rt, () => read(rt, a.id).meal?.phase === 'eating');
  const w = rt.submit('walk_to', { actor: 'cook', x: -4, z: -3 });
  assert.notEqual(w.status, 'failed', w.diagnostic?.message);
  until(rt, () => !rt.isActive(w.id) && read(rt, a.id).mode === 'waiting');
  assert.deepEqual(rt.world.entities.cook.pose.p, [-4, 0, -3]);
  const plan = communalSupperControl.plan(rt, {
    supper: a.id,
    intent: 'resume',
  });
  assert.equal(plan.ok, false);
  if (!plan.ok) {
    assert.equal(plan.diagnostic.code, 'communal_supper.stage-unavailable');
    assert.equal(
      (plan.diagnostic.details as { cause: { code: string } }).cause.code,
      'shared_food.resume-not-cancelled',
    );
  }
  control(rt, a.id, 'end');
  until(rt, () => !rt.isActive(a.id));
  clean(rt);
});
test('occupied storage waits with named admission and never preempts foreign vessel or emits repeated failed children', () => {
  const { rt, p, a } = start();
  until(
    rt,
    () =>
      read(rt, a.id).meal?.phase === 'completed' &&
      read(rt, a.id).stage === 'sharing',
  );
  pause(rt, a.id);
  const e = rt.world.entities.beans,
    original = structuredClone(e); // deliberate foreign supported placement supplied by test, not coordinator
  const target = rt.world.entities['ware-store'];
  e.support = { kind: 'resting-on', on: 'ware-store', slot: 'r1c0' };
  e.pose = { p: [target.pose.p[0] - 0.75, 0.75, target.pose.p[2]], yaw: 0 };
  control(rt, a.id, 'resume');
  until(rt, () => read(rt, a.id).mode === 'waiting');
  assert.equal(
    read(rt, a.id).diagnostic?.code,
    'communal_supper.stage-unavailable',
  );
  assert.match(read(rt, a.id).diagnostic!.message, /occup/i);
  const n = rt.records.size;
  for (let i = 0; i < 30; i++) rt.step();
  assert.equal(rt.records.size, n);
  assert.equal(
    [...rt.records.values()].filter((r) => r.status === 'failed').length,
    0,
  );
  rt.world.entities.beans = original;
  control(rt, a.id, 'resume');
  complete(rt, a.id);
  assert.equal(rt.world.entities.beans.support?.kind, 'resting-on');
  assert.equal(p.cleanup.length, 2);
});
test('End refuses occupied utensil return truthfully with held claims, then drains after actual support restored', () => {
  const { rt, a } = start();
  until(rt, () => read(rt, a.id).meal?.phase === 'eating');
  pause(rt, a.id);
  const e = rt.world.entities.beans,
    original = structuredClone(e);
  e.support = { kind: 'resting-on', on: 'meal-table', slot: 'r1c0' };
  e.pose = { p: [4.25, 0.75, 0], yaw: 0 };
  control(rt, a.id, 'end');
  until(
    rt,
    () =>
      read(rt, a.id).diagnostic?.code === 'communal_supper.return-unavailable',
  );
  assert.ok(rt.isActive(a.id));
  assert.ok(read(rt, a.id).held.some((q) => q.items.length));
  assert.ok(read(rt, a.id).claims.length);
  const n = rt.records.size;
  for (let i = 0; i < 20; i++) rt.step();
  assert.equal(rt.records.size, n);
  rt.world.entities.beans = original;
  until(rt, () => !rt.isActive(a.id));
  assert.equal(a.status, 'cancelled');
  assert.equal(read(rt, a.id).finished, false);
  clean(rt);
});
test('external material refill during safe meal Pause is a named conservation refusal, never a fresh serving', () => {
  const { rt, a } = start();
  until(rt, () => read(rt, a.id).meal?.phase === 'eating');
  pause(rt, a.id);
  const original = rt.world.entities.pot.contents!.fraction;
  rt.world.entities.pot.contents!.fraction += 0.25;
  const plan = communalSupperControl.plan(rt, {
    supper: a.id,
    intent: 'resume',
  });
  assert.equal(plan.ok, false);
  if (!plan.ok)
    assert.equal(
      plan.diagnostic.code,
      'communal_supper.material-conservation-changed',
    );
  rt.world.entities.pot.contents!.fraction = Number.NaN;
  const invalid = communalSupperControl.plan(rt, {
    supper: a.id,
    intent: 'resume',
  });
  assert.equal(invalid.ok, false);
  if (!invalid.ok)
    assert.equal(
      invalid.diagnostic.code,
      'communal_supper.material-conservation-changed',
    );
  rt.world.entities.pot.contents!.fraction = original;
  const food = rt.world.entities.pot.contents!.food;
  rt.world.entities.pot.contents!.food = 'substituted';
  const relabelled = communalSupperControl.plan(rt, {
    supper: a.id,
    intent: 'resume',
  });
  assert.equal(relabelled.ok, false);
  if (!relabelled.ok)
    assert.equal(
      relabelled.diagnostic.code,
      'communal_supper.material-label-changed',
    );
  rt.world.entities.pot.contents!.food = food;
  control(rt, a.id, 'resume');
  complete(rt, a.id);
});
test('completed first storage cannot drift while later cleanup runs; safe wait and explicit exact restoration', () => {
  const { rt, a } = start();
  until(
    rt,
    () =>
      read(rt, a.id).stage === 'storing-prepware' &&
      read(rt, a.id).cleanup.at(-1)?.current?.held === true,
  );
  const e = rt.world.entities['cook-bowl'],
    pose = structuredClone(e.pose);
  e.pose.p[0] += 0.02;
  until(rt, () => read(rt, a.id).mode === 'paused');
  assert.equal(
    read(rt, a.id).diagnostic?.code,
    'communal_supper.stored-item-changed',
  );
  const plan = communalSupperControl.plan(rt, {
    supper: a.id,
    intent: 'resume',
  });
  assert.equal(plan.ok, false);
  e.pose = pose;
  control(rt, a.id, 'resume');
  complete(rt, a.id);
});
function activeEndReturn() {
  const { rt, a } = start();
  until(rt, () => read(rt, a.id).meal?.phase === 'eating');
  control(rt, a.id, 'end');
  let stow: string | undefined;
  until(rt, () => {
    stow = [...rt.records.values()].find(
      (r) =>
        r.parent === a.id &&
        r.verb === 'stow_items' &&
        rt.isActive(r.id) &&
        r.phase === 'stowing',
    )?.id;
    return !!stow;
  });
  return { rt, a, stow: stow! };
}
test('repeated End while ordinary return active is idempotent and direct walk honestly refuses stow ownership', () => {
  const { rt, a, stow } = activeEndReturn();
  const returned = read(rt, a.id).returnAttempts.map((r) => r!.id),
    before = structuredClone(rt.records.get(stow));
  control(rt, a.id, 'end');
  control(rt, a.id, 'end');
  assert.deepEqual(
    read(rt, a.id).returnAttempts.map((r) => r!.id),
    returned,
  );
  assert.deepEqual(rt.records.get(stow), before);
  const w = rt.submit('walk_to', { actor: 'cook', x: -4, z: -3 });
  assert.equal(w.status, 'failed');
  assert.ok(rt.isActive(stow));
  until(rt, () => !rt.isActive(a.id));
  assert.equal(a.status, 'cancelled');
  clean(rt);
});
test('cancelled End return drains, preserves ordinary walk, then explicit End retries only actual remaining held utensils', () => {
  const { rt, a, stow } = activeEndReturn();
  assert.notEqual(rt.cancel(stow).status, 'failed');
  until(
    rt,
    () =>
      !rt.isActive(stow) &&
      read(rt, a.id).diagnostic?.code === 'communal_supper.return-stopped',
  );
  const old = structuredClone(rt.records.get(stow)),
    w = rt.submit('walk_to', { actor: 'cook', x: -4, z: -3 });
  assert.notEqual(w.status, 'failed', w.diagnostic?.message);
  const busy = communalSupperControl.plan(rt, { supper: a.id, intent: 'end' });
  assert.equal(busy.ok, false);
  if (!busy.ok)
    assert.equal(
      busy.diagnostic.code,
      'communal_supper.return-retry-unavailable',
    );
  until(rt, () => !rt.isActive(w.id));
  assert.deepEqual(rt.world.entities.cook.pose.p, [-4, 0, -3]);
  const n = rt.records.size;
  for (let i = 0; i < 25; i++) rt.step();
  assert.equal(rt.records.size, n);
  assert.ok(rt.isActive(a.id));
  control(rt, a.id, 'end');
  until(rt, () => !rt.isActive(a.id));
  assert.equal(a.status, 'cancelled');
  assert.equal(read(rt, a.id).finished, false);
  assert.deepEqual(rt.records.get(stow), old);
  assert.ok(read(rt, a.id).returnAttempts.length >= 3);
  clean(rt);
});
test('cancelled return Retry End refuses occupied destination without child spam and requires explicit restored retry', () => {
  const { rt, a, stow } = activeEndReturn();
  assert.notEqual(rt.cancel(stow).status, 'failed');
  until(
    rt,
    () =>
      !rt.isActive(stow) &&
      read(rt, a.id).diagnostic?.code === 'communal_supper.return-stopped',
  );
  const e = rt.world.entities.beans,
    original = structuredClone(e);
  e.support = { kind: 'resting-on', on: 'meal-table', slot: 'r1c0' };
  e.pose = { p: [4.25, 0.75, 0], yaw: 0 };
  const count = rt.records.size;
  for (let i = 0; i < 3; i++) {
    const p = communalSupperControl.plan(rt, { supper: a.id, intent: 'end' });
    assert.equal(p.ok, false);
    if (!p.ok)
      assert.equal(
        p.diagnostic.code,
        'communal_supper.return-retry-unavailable',
      );
  }
  for (let i = 0; i < 25; i++) rt.step();
  assert.equal(rt.records.size, count);
  assert.ok(read(rt, a.id).held.some((q) => q.items.length));
  rt.world.entities.beans = original;
  for (let i = 0; i < 10; i++) rt.step();
  assert.equal(rt.records.size, count);
  control(rt, a.id, 'end');
  until(rt, () => !rt.isActive(a.id));
  clean(rt);
});
test('independent ordinary return physically satisfies cancelled history; End waits foreign withdrawal then completes honestly', () => {
  const { rt, a, stow } = activeEndReturn();
  assert.notEqual(rt.cancel(stow).status, 'failed');
  until(
    rt,
    () =>
      !rt.isActive(stow) &&
      read(rt, a.id).diagnostic?.code === 'communal_supper.return-stopped',
  );
  const original = structuredClone(rt.records.get(stow)),
    p = communalSupperBinding().meal.participants[0];
  const own = rt.submit('stow_items', {
    actor: p.actor,
    placements: p.returns.filter(
      (t) => rt.world.entities[t.item].support?.kind === 'in-hand',
    ),
  });
  assert.notEqual(own.status, 'failed', own.diagnostic?.message);
  until(rt, () => !rt.isActive(a.id) && !rt.isActive(own.id));
  assert.equal(own.status, 'completed');
  assert.deepEqual(rt.records.get(stow), original);
  assert.equal(a.status, 'cancelled');
  clean(rt);
});
test('failed End return child retains its failed record and explicitly retries normal remaining stow', () => {
  const { rt, a, stow } = activeEndReturn();
  const put = [...rt.records.values()].find(
    (r) => r.parent === stow && r.verb === 'put_item' && rt.isActive(r.id),
  );
  assert.ok(put);
  rt.cancel(put.id);
  until(
    rt,
    () =>
      !rt.isActive(stow) &&
      read(rt, a.id).diagnostic?.code === 'communal_supper.return-stopped',
  );
  assert.equal(rt.records.get(stow)!.status, 'failed');
  const original = structuredClone(rt.records.get(stow)),
    w = rt.submit('walk_to', { actor: 'cook', x: -4, z: -3 });
  assert.notEqual(w.status, 'failed', w.diagnostic?.message);
  until(rt, () => !rt.isActive(w.id));
  control(rt, a.id, 'end');
  until(rt, () => !rt.isActive(a.id));
  assert.deepEqual(rt.records.get(stow), original);
  clean(rt);
});
