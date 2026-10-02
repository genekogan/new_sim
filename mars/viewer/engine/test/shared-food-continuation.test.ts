import test from 'node:test';
import assert from 'node:assert/strict';
import { hashOf } from '../core/hash.ts';
import { q6 } from '../core/math.ts';
import { itemEntity, placeOnSlot, surfaceSlot } from '../items/model.ts';
import { Runtime } from '../runtime/runtime.ts';
import { createRegistry, ENGINE_INVARIANTS } from '../api/registry.ts';
import { Spatial } from '../spatial/service.ts';
import { classroomScene } from '../scenarios/classroom.ts';
import {
  workBreakWorld,
  WORK_BREAK_BINDING as B,
} from '../scenarios/work-break.ts';
import {
  sharedFoodBreak,
  readSharedFoodBreak,
  type SharedFoodBreakParams,
} from '../activities/shared-food-break.ts';
const params = (): SharedFoodBreakParams => ({
  pot: B.pot,
  participants: structuredClone(B.people),
  at: [...B.conversation.at],
});
function fixture(portions: [number, number] = [0, 0]) {
  const w = workBreakWorld();
  w.entities[B.pot].contents!.fraction = portions.some((x) => x > 0) ? 0 : 0.5;
  B.people.forEach(
    (p, i) => (w.entities[p.bowl].contents!.fraction = portions[i]),
  );
  return new Runtime(
    w,
    createRegistry(),
    { spatial: new Spatial(classroomScene()) },
    ENGINE_INVARIANTS,
  );
}
function until(rt: Runtime, predicate: () => boolean, max = 6000) {
  for (let i = 0; i < max && !predicate(); i++) {
    rt.step();
    assert.deepEqual(rt.violations, []);
  }
  assert.ok(
    predicate(),
    JSON.stringify([...rt.records.values()].filter((r) => rt.isActive(r.id))),
  );
}
function start(rt: Runtime, p = params()) {
  const a = rt.submit('shared_food_break', p);
  assert.notEqual(a.status, 'failed', a.diagnostic?.message);
  return a;
}
function stop(rt: Runtime, id: string) {
  rt.cancel(id);
  until(rt, () => !rt.isActive(id));
  assert.equal(rt.records.get(id)!.status, 'cancelled');
}
function clean(rt: Runtime) {
  assert.deepEqual(rt.violations, []);
  assert.deepEqual(
    [...rt.records.values()].filter((r) => rt.isActive(r.id)),
    [],
  );
  for (const p of B.people) {
    for (const k of [
      `actor:${p.actor}`,
      `holds:${p.actor}`,
      `hand:${p.actor}:left`,
      `hand:${p.actor}:right`,
      `entity:${p.bowl}`,
      `entity:${p.spoon}`,
      ...p.returns.map((r) => `surface-slot:${r.surfaceSlot}`),
    ])
      assert.deepEqual(rt.holder(k), []);
    for (const q of p.returns)
      assert.deepEqual(rt.world.entities[q.item].support, {
        kind: 'resting-on',
        on: q.surfaceSlot.split('#')[0],
        slot: q.surfaceSlot.split('#')[1],
      });
  }
  assert.deepEqual(rt.holder(`shared-food:${B.pot}`), []);
}
test('consumed empty bowls continue same cancelled meal without another serving, then ordinary stow releases resources', () => {
  const rt = fixture(),
    a = start(rt);
  until(
    rt,
    () =>
      readSharedFoodBreak(rt, a.id)?.phase === 'eating' &&
      B.people.every((p) => rt.world.entities[p.bowl].contents!.fraction === 0),
  );
  stop(rt, a.id);
  const count = [...rt.records.values()].filter(
    (r) => r.verb === 'serve',
  ).length;
  const b = start(rt, { ...params(), resumeFrom: a.id });
  until(rt, () => !rt.isActive(b.id));
  assert.equal(b.status, 'completed');
  assert.equal(rt.world.entities[B.pot].contents!.fraction, 0);
  assert.equal(
    [...rt.records.values()].filter((r) => r.verb === 'serve').length,
    count,
  );
  clean(rt);
});

function receipts(rt: Runtime, id: string) {
  const s = readSharedFoodBreak(rt, id);
  assert.ok(s?.receipts);
  return s.receipts;
}
function finish(rt: Runtime, id: string) {
  until(rt, () => !rt.isActive(id));
  assert.equal(
    rt.records.get(id)!.status,
    'completed',
    rt.records.get(id)!.diagnostic?.message,
  );
  clean(rt);
}
function conservation(rt: Runtime, id: string, initial = 0.5) {
  const r = receipts(rt, id);
  assert.equal(
    q6(
      rt.world.entities[B.pot].contents!.fraction +
        r.reduce(
          (n, r) =>
            n + (rt.world.entities[r.bowl].contents!.fraction + r.consumed) / 4,
          0,
        ),
    ),
    initial,
  );
}
for (const point of [
  'before-first-step',
  'taking',
  'before-serve-deposit',
  'after-one-serving',
  'partial-eating',
  'after-first-return',
] as const)
  test(`${point} cancellation resumes exact remaining serving/food and returns same utensils`, () => {
    const rt = fixture(),
      a = start(rt),
      ids = Object.keys(rt.world.entities).sort();
    if (point === 'taking')
      until(rt, () => readSharedFoodBreak(rt, a.id)?.phase === 'taking');
    if (point === 'before-serve-deposit')
      until(rt, () =>
        [...rt.records.values()].some(
          (r) =>
            r.parent === a.id && r.verb === 'serve' && r.phase === 'to-bowl',
        ),
      );
    if (point === 'after-one-serving')
      until(rt, () => rt.world.entities[B.pot].contents!.fraction === 0.25);
    if (point === 'partial-eating')
      until(rt, () =>
        B.people.every(
          (p) => rt.world.entities[p.bowl].contents!.fraction === 0.8,
        ),
      );
    if (point === 'after-first-return')
      until(
        rt,
        () =>
          B.people[0].returns.some(
            (p) => rt.world.entities[p.item].support?.kind === 'resting-on',
          ) && readSharedFoodBreak(rt, a.id)?.phase === 'stowing',
      );
    stop(rt, a.id);
    conservation(rt, a.id);
    const saved = structuredClone(receipts(rt, a.id)),
      beforePot = rt.world.entities[B.pot].contents!.fraction;
    const b = start(rt, { ...params(), resumeFrom: a.id });
    assert.equal(readSharedFoodBreak(rt, b.id)!.purpose, a.id);
    while (rt.isActive(b.id)) {
      rt.step();
      assert.deepEqual(rt.violations, []);
      conservation(rt, b.id);
    }
    assert.equal(b.status, 'completed', b.diagnostic?.message);
    assert.deepEqual(
      receipts(rt, a.id),
      saved,
      'old completed receipt never follows the continuation live material',
    );
    assert.deepEqual(Object.keys(rt.world.entities).sort(), ids);
    assert.equal(rt.world.entities[B.pot].contents!.fraction, 0);
    assert.ok(beforePot >= rt.world.entities[B.pot].contents!.fraction);
    assert.equal(
      [...rt.records.values()].filter(
        (r) => r.verb === 'serve' && r.history.some((h) => h.phase === 'back'),
      ).length,
      2,
    );
    assert.ok(
      receipts(rt, b.id).every(
        (r) =>
          r.served &&
          r.consumptionCompleted &&
          r.consumed === 1 &&
          r.remaining === 0,
      ),
    );
    clean(rt);
  });
test('one consumed participant and one retained partial serving continue without topping up either', () => {
  const rt = fixture([0.2, 1]),
    a = start(rt);
  until(
    rt,
    () =>
      rt.world.entities[B.people[0].bowl].contents!.fraction === 0 &&
      rt.world.entities[B.people[1].bowl].contents!.fraction === 0.8,
  );
  stop(rt, a.id);
  conservation(rt, a.id, 0.3);
  assert.deepEqual(
    receipts(rt, a.id).map((r) => [r.remaining, r.consumptionCompleted]),
    [
      [0, true],
      [0.8, false],
    ],
  );
  const b = start(rt, { ...params(), resumeFrom: a.id });
  finish(rt, b.id);
  conservation(rt, b.id, 0.3);
  assert.equal(
    [...rt.records.values()].filter((r) => r.verb === 'serve').length,
    0,
  );
  assert.deepEqual(
    [...rt.records.values()]
      .filter((r) => r.parent === b.id && r.verb === 'eat')
      .map((r) => (r.params as { actor: string }).actor),
    [B.people[1].actor],
  );
  assert.deepEqual(
    receipts(rt, b.id).map((r) => r.consumed),
    [0.2, 1],
  );
});
test('repeated safe continuation uses latest cancellation checkpoint and original purpose without duplicate serving', () => {
  const rt = fixture(),
    a = start(rt);
  until(rt, () => rt.world.entities[B.pot].contents!.fraction === 0.25);
  stop(rt, a.id);
  const b = start(rt, { ...params(), resumeFrom: a.id });
  until(rt, () =>
    B.people.every((p) => rt.world.entities[p.bowl].contents!.fraction === 0.8),
  );
  stop(rt, b.id);
  assert.equal(
    sharedFoodBreak.plan(rt, { ...params(), resumeFrom: a.id }).ok,
    false,
  );
  const c = start(rt, { ...params(), resumeFrom: b.id });
  until(rt, () =>
    B.people.every((p) => rt.world.entities[p.bowl].contents!.fraction === 0.4),
  );
  stop(rt, c.id);
  const d = start(rt, { ...params(), resumeFrom: c.id });
  finish(rt, d.id);
  conservation(rt, d.id);
  assert.equal(readSharedFoodBreak(rt, d.id)!.purpose, a.id);
  assert.equal(
    [...rt.records.values()].filter(
      (r) => r.verb === 'serve' && r.history.some((h) => h.phase === 'back'),
    ).length,
    2,
  );
});
test('voluntary cancellation then ordinary player direction permits continuation after the independent walk finishes', () => {
  const rt = fixture(),
    a = start(rt);
  until(rt, () => readSharedFoodBreak(rt, a.id)?.phase === 'eating');
  rt.cancel(a.id);
  const walk = rt.submit('walk_to', { actor: B.people[0].actor, x: -9, z: 1 });
  assert.notEqual(walk.status, 'failed');
  until(rt, () => !rt.isActive(a.id));
  assert.equal(a.status, 'cancelled');
  const blocked = sharedFoodBreak.plan(rt, { ...params(), resumeFrom: a.id });
  assert.equal(blocked.ok, false);
  until(rt, () => !rt.isActive(walk.id));
  assert.equal(walk.status, 'completed');
  const b = start(rt, { ...params(), resumeFrom: a.id });
  finish(rt, b.id);
  conservation(rt, b.id);
});
function refuse(rt: Runtime, p: SharedFoodBreakParams, code: string) {
  const before = rt.stateHash(),
    count = rt.records.size,
    plan = sharedFoodBreak.plan(rt, p);
  assert.ok(!plan.ok);
  assert.equal(plan.diagnostic.code, code);
  assert.equal(rt.stateHash(), before);
  assert.equal(rt.records.size, count);
  return plan;
}
test('missing, active, completed and wrong-verb sources refuse without state writes', () => {
  const rt = fixture();
  refuse(
    rt,
    { ...params(), resumeFrom: 'absent' },
    'shared_food.resume-missing',
  );
  const walk = rt.submit('walk_to', { actor: B.people[0].actor, x: -6, z: -9 });
  until(rt, () => !rt.isActive(walk.id));
  refuse(
    rt,
    { ...params(), resumeFrom: walk.id },
    'shared_food.resume-missing',
  );
  const a = start(rt);
  refuse(
    rt,
    { ...params(), resumeFrom: a.id },
    'shared_food.resume-not-cancelled',
  );
  finish(rt, a.id);
  refuse(
    rt,
    { ...params(), resumeFrom: a.id },
    'shared_food.resume-not-cancelled',
  );
});
for (const mutation of [
  'ordered-actors',
  'return-order',
  'service',
  'pot',
  'at',
] as const)
  test(`explicit continuation refuses changed ${mutation} binding`, () => {
    const rt = fixture(),
      a = start(rt);
    stop(rt, a.id);
    const p = { ...params(), resumeFrom: a.id };
    if (mutation === 'ordered-actors') p.participants.reverse();
    if (mutation === 'return-order') p.participants[0].returns.reverse();
    if (mutation === 'service') p.participants[0].service[0] += 1;
    if (mutation === 'pot') p.pot = 'other-pot';
    if (mutation === 'at') p.at[0] += 1;
    refuse(rt, p, 'shared_food.resume-binding');
  });
for (const mutation of [
  'quantity',
  'material',
  'definition',
  'support',
  'anchored-pose',
  'fixture',
] as const)
  test(`retained material checkpoint rejects ${mutation} tampering`, () => {
    const rt = fixture(),
      a = start(rt);
    until(rt, () =>
      B.people.every(
        (p) => rt.world.entities[p.bowl].contents!.fraction === 0.8,
      ),
    );
    stop(rt, a.id);
    const bowl = rt.world.entities[B.people[0].bowl];
    if (mutation === 'quantity') bowl.contents!.fraction = 0.6;
    if (mutation === 'material') bowl.contents!.food = 'replacement';
    if (mutation === 'definition') bowl.def = 'cup';
    if (mutation === 'support') bowl.support = { kind: 'ground' };
    if (mutation === 'anchored-pose') rt.world.entities[B.pot].pose.p[0] += 0.1;
    if (mutation === 'fixture') rt.world.entities[B.table].pose.p[0] += 0.1;
    refuse(
      rt,
      { ...params(), resumeFrom: a.id },
      mutation === 'fixture'
        ? 'shared_food.resume-support'
        : 'shared_food.resume-material',
    );
  });
test('unrelated later material use cannot restore then reuse an older cancelled purpose', () => {
  const rt = fixture(),
    originalPose = structuredClone(rt.world.entities[B.people[0].bowl].pose),
    a = start(rt);
  stop(rt, a.id);
  const person = B.people[0],
    take = rt.submit('take_item', {
      actor: person.actor,
      item: person.bowl,
      hand: 'left',
    });
  until(rt, () => !rt.isActive(take.id));
  assert.equal(take.status, 'completed');
  const put = rt.submit('put_item', {
    actor: person.actor,
    item: person.bowl,
    surfaceSlot: `${B.table}#r0c0`,
  });
  until(rt, () => !rt.isActive(put.id));
  assert.equal(put.status, 'completed');
  assert.deepEqual(rt.world.entities[person.bowl].pose, originalPose);
  refuse(rt, { ...params(), resumeFrom: a.id }, 'shared_food.resume-reused');
});
test('return destination occupancy preserves same checkpoint; ordinary removal permits explicit continuation', () => {
  const rt = fixture(),
    a = start(rt);
  until(rt, () => readSharedFoodBreak(rt, a.id)?.phase === 'eating');
  stop(rt, a.id);
  const foreign = itemEntity('foreign', 'bowl', [0, 0, 0]),
    slot = surfaceSlot(rt.world, B.people[0].returns[0].surfaceSlot);
  assert.ok(!('code' in slot));
  placeOnSlot(foreign, slot, 0);
  rt.world.entities.foreign = foreign;
  refuse(rt, { ...params(), resumeFrom: a.id }, 'shared_food.returns-occupied');
  delete rt.world.entities.foreign;
  const b = start(rt, { ...params(), resumeFrom: a.id });
  finish(rt, b.id);
});
test('same chained cancellations replay world, actions, own receipts and events', () => {
  const run = () => {
    const rt = fixture(),
      a = start(rt);
    until(rt, () => rt.world.entities[B.pot].contents!.fraction === 0.25);
    stop(rt, a.id);
    const b = start(rt, { ...params(), resumeFrom: a.id });
    until(rt, () =>
      B.people.every(
        (p) => rt.world.entities[p.bowl].contents!.fraction === 0.8,
      ),
    );
    stop(rt, b.id);
    const c = start(rt, { ...params(), resumeFrom: b.id });
    finish(rt, c.id);
    return hashOf([
      rt.world,
      [...rt.records.values()],
      rt.events,
      readSharedFoodBreak(rt, c.id),
    ]);
  };
  assert.equal(run(), run());
});

test('legacy uncancelled directive fails the parent and cannot become a continuation source', () => {
  const rt = fixture(),
    a = start(rt);
  until(rt, () => readSharedFoodBreak(rt, a.id)?.phase === 'eating');
  const walk = rt.submit('walk_to', { actor: B.people[0].actor, x: -9, z: 1 });
  until(rt, () => !rt.isActive(a.id) && !rt.isActive(walk.id));
  assert.equal(a.status, 'failed');
  assert.equal(walk.status, 'completed');
  refuse(
    rt,
    { ...params(), resumeFrom: a.id },
    'shared_food.resume-not-cancelled',
  );
});

test('same world in a different Runtime has no material checkpoint provenance', () => {
  const rt = fixture(),
    a = start(rt);
  stop(rt, a.id);
  const other = new Runtime(
    structuredClone(rt.world),
    createRegistry(),
    { spatial: new Spatial(classroomScene()) },
    ENGINE_INVARIANTS,
  );
  refuse(
    other,
    { ...params(), resumeFrom: a.id },
    'shared_food.resume-missing',
  );
});
test('a later unrelated meal cannot reuse the older cancelled receipts or recreate food', () => {
  const rt = fixture(),
    a = start(rt);
  stop(rt, a.id);
  const fresh = start(rt);
  finish(rt, fresh.id);
  assert.equal(rt.world.entities[B.pot].contents!.fraction, 0);
  refuse(rt, { ...params(), resumeFrom: a.id }, 'shared_food.resume-material');
});
test('accepted continuation cancelled before its first step produces no phantom serving or orphan children', () => {
  const rt = fixture(),
    a = start(rt);
  stop(rt, a.id);
  const b = start(rt, { ...params(), resumeFrom: a.id });
  stop(rt, b.id);
  assert.equal(
    [...rt.records.values()].filter((r) => r.verb === 'serve').length,
    0,
  );
  assert.equal(rt.world.entities[B.pot].contents!.fraction, 0.5);
  assert.deepEqual(receipts(rt, b.id), receipts(rt, a.id));
  const c = start(rt, { ...params(), resumeFrom: b.id });
  finish(rt, c.id);
  conservation(rt, c.id);
});
test('corrupted retained contents during a running continuation stop with a material diagnostic rather than consume replacement food', () => {
  const rt = fixture(),
    a = start(rt);
  until(rt, () =>
    B.people.every((p) => rt.world.entities[p.bowl].contents!.fraction === 0.8),
  );
  stop(rt, a.id);
  const b = start(rt, { ...params(), resumeFrom: a.id });
  const bowl = rt.world.entities[B.people[0].bowl];
  bowl.contents!.food = 'replacement';
  until(rt, () => !rt.isActive(b.id));
  assert.equal(b.status, 'failed');
  assert.equal(
    readSharedFoodBreak(rt, b.id)?.diagnostic?.code,
    'shared_food.resume-material',
  );
  assert.equal(bowl.contents!.fraction, 0.8);
  assert.deepEqual(bowl.support, {
    kind: 'in-hand',
    by: B.people[0].actor,
    hand: 'left',
  });
  assert.ok(
    ![...rt.records.values()].some(
      (r) => rt.isActive(r.id) && r.parent === b.id,
    ),
  );
});
