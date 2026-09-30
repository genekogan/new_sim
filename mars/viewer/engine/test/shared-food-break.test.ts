import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from '../runtime/runtime.ts';
import {
  createRegistry,
  ENGINE_INVARIANTS,
  servicesFor,
} from '../api/registry.ts';
import { classroomScene } from '../scenarios/classroom.ts';
import {
  WORK_BREAK_BINDING as B,
  workBreakWorld,
} from '../scenarios/work-break.ts';
import {
  sharedFoodBreak,
  readSharedFoodBreak,
  type SharedFoodBreakParams,
} from '../activities/shared-food-break.ts';
import { heldBy } from '../items/model.ts';
import { readWorkstation } from '../objects/workstation.ts';
const params = (): SharedFoodBreakParams => ({
  pot: B.pot,
  participants: structuredClone(B.people),
  at: [...B.conversation.at],
});
function setup(count: 4 | 8 = 4, pot = 1, bowls = 0, elevated = false) {
  const world = workBreakWorld(count);
  world.entities[B.pot].contents!.fraction = pot;
  for (const person of B.people)
    world.entities[person.bowl].contents!.fraction = bowls;
  if (elevated) world.entities[B.table].pose.p[1] = 2;
  const registry = createRegistry();
  assert.equal(registry.get(sharedFoodBreak.verb), sharedFoodBreak);
  return new Runtime(
    world,
    registry,
    servicesFor({ classroom: classroomScene() })(world),
    ENGINE_INVARIANTS,
  );
}
function until(rt: Runtime, done: () => boolean, limit = 6000) {
  for (let n = 0; n < limit && !done(); n++) rt.step();
  assert.ok(
    done(),
    JSON.stringify([...rt.records.values()].filter((r) => rt.isActive(r.id))),
  );
  assert.deepEqual(rt.violations, []);
}
function complete(rt: Runtime, verb: string, p: unknown) {
  const rec = rt.submit(verb, p);
  assert.notEqual(rec.status, 'failed', rec.diagnostic?.message);
  until(rt, () => !rt.isActive(rec.id));
  assert.equal(rec.status, 'completed', rec.diagnostic?.message);
  return rec;
}
function assertStopped(rt: Runtime, action: string) {
  assert.deepEqual(rt.holder(`shared-food:${B.pot}`), []);
  for (const r of rt.records.values())
    if (r.parent === action) assert.ok(!rt.isActive(r.id), `${r.verb} ${r.id}`);
  for (const p of B.people) {
    for (const key of [
      `actor:${p.actor}`,
      `hand:${p.actor}:left`,
      `hand:${p.actor}:right`,
      `entity:${p.bowl}`,
      `entity:${p.spoon}`,
      ...p.returns.map((q) => `surface-slot:${q.surfaceSlot}`),
    ])
      assert.deepEqual(rt.holder(key), [], key);
    for (const { item } of heldBy(rt.world, p.actor)) {
      assert.equal(item.support?.kind, 'in-hand');
      assert.ok(rt.holder(`holds:${p.actor}`).length);
    }
  }
  assert.deepEqual(rt.violations, []);
}
for (const count of [4, 8] as const)
  test(`registered ${count}-room shared food cleans up and deterministic one-command replay`, () => {
    const rt = setup(count),
      stationBefore = structuredClone(rt.world.entities.workstation);
    const action = rt.submit(sharedFoodBreak.verb, params());
    assert.notEqual(action.status, 'failed', action.diagnostic?.message);
    let sawFloor = false;
    until(rt, () => {
      const state = readSharedFoodBreak(rt, action.id)!;
      if (state.floorHolder) {
        sawFloor = true;
        assert.ok(B.people.some((p) => p.actor === state.floorHolder));
        assert.equal(rt.records.get(state.group!)!.phase, 'talking');
        assert.ok(
          rt.holder(`actor:${state.floorHolder}`).includes(state.group!),
        );
      }
      return !rt.isActive(action.id);
    });
    assert.equal(action.status, 'completed', action.diagnostic?.message);
    assert.ok(sawFloor);
    assert.deepEqual(rt.world.entities.workstation, stationBefore);
    assert.equal(rt.world.entities[B.pot].contents!.fraction, 0.5);
    const state = readSharedFoodBreak(rt, action.id)!;
    assert.equal(state.floorHolder, undefined);
    for (const person of state.participants) {
      assert.deepEqual(person.held, []);
      assert.equal(person.returned.length, 2);
      assert.equal(person.food, 0);
    }
    assertStopped(rt, action.id);
    assert.deepEqual(
      [...rt.records.values()].filter((r) => rt.isActive(r.id)),
      [],
    );
    const other = setup(count);
    other.submit(sharedFoodBreak.verb, params());
    while (other.tick < rt.tick) other.step();
    assert.equal(other.stateHash(), rt.stateHash());
    assert.deepEqual([...other.records.values()], [...rt.records.values()]);
    assert.deepEqual(other.violations, []);
  });
for (const phase of ['taking', 'serving', 'gathering', 'eating', 'stowing'])
  test(`cancel ${phase} drains owned children and preserves supported partial state`, () => {
    const rt = setup(),
      action = rt.submit(sharedFoodBreak.verb, params());
    until(rt, () => readSharedFoodBreak(rt, action.id)?.phase === phase);
    const pot = rt.world.entities[B.pot].contents!.fraction;
    rt.cancel(action.id);
    assert.ok(rt.isActive(action.id));
    until(rt, () => !rt.isActive(action.id));
    assert.equal(action.status, 'cancelled');
    assert.equal(rt.world.entities[B.pot].contents!.fraction, pot);
    assertStopped(rt, action.id);
    assert.equal(readSharedFoodBreak(rt, action.id)?.floorHolder, undefined);
  });
test('cancel after stow release preserves placement', () => {
  const rt = setup(),
    action = rt.submit(sharedFoodBreak.verb, params());
  until(rt, () =>
    [...rt.records.values()].some(
      (r) =>
        r.verb === 'put_item' && r.phase === 'withdraw' && rt.isActive(r.id),
    ),
  );
  rt.cancel(action.id);
  until(rt, () => !rt.isActive(action.id));
  assertStopped(rt, action.id);
  assert.ok(
    readSharedFoodBreak(rt, action.id)!.participants.some(
      (p) => p.returned.length,
    ),
  );
  assert.equal(rt.world.entities[B.pot].contents!.fraction, 0.5);
});
test('held own utensils and partially eaten bowls retry without re-serving; work remains unfinished', () => {
  const rt = setup(),
    work = rt.submit('work_at', B.work);
  until(rt, () => {
    const s = readWorkstation(rt, B.work.station);
    return !('code' in s) && s.elapsed >= 1;
  });
  rt.cancel(work.id);
  until(rt, () => !rt.isActive(work.id));
  const saved = structuredClone(rt.world.entities.workstation);
  const first = rt.submit(sharedFoodBreak.verb, params());
  until(rt, () =>
    [...rt.records.values()].some(
      (r) => r.parent === first.id && r.verb === 'eat' && r.phase === 'lift',
    ),
  );
  rt.cancel(first.id);
  until(rt, () => !rt.isActive(first.id));
  assertStopped(rt, first.id);
  const fraction = rt.world.entities[B.pot].contents!.fraction,
    takes = [...rt.records.values()].filter(
      (r) => r.verb === 'take_item',
    ).length;
  assert.ok(B.people.every((p) => heldBy(rt.world, p.actor).length === 2));
  const retry = complete(rt, sharedFoodBreak.verb, params());
  assert.equal(rt.world.entities[B.pot].contents!.fraction, fraction);
  assert.equal(
    [...rt.records.values()].filter((r) => r.verb === 'take_item').length,
    takes,
  );
  assert.deepEqual(rt.world.entities.workstation, saved);
  assertStopped(rt, retry.id);
});
test('empty pot, occupied actor, full hands, malformed roles/returns refuse before dispatch', () => {
  const empty = setup(4, 0),
    before = empty.stateHash(),
    refused = empty.submit(sharedFoodBreak.verb, params());
  assert.equal(refused.diagnostic?.code, 'shared_food.food-unavailable');
  assert.equal(empty.stateHash(), before);
  const rt = setup(),
    work = rt.submit('work_at', B.work),
    busy = rt.submit(sharedFoodBreak.verb, params());
  assert.equal(busy.diagnostic?.code, 'shared_food.actor-busy');
  assert.ok(rt.isActive(work.id));
  rt.cancel(work.id);
  until(rt, () => !rt.isActive(work.id));
  complete(rt, 'take_item', {
    actor: 'worker',
    item: 'break-bowl',
    hand: 'left',
  });
  const full = rt.submit(sharedFoodBreak.verb, params());
  assert.equal(full.diagnostic?.code, 'shared_food.hands-full');
  assert.equal(heldBy(rt.world, 'worker')[0].item.id, 'break-bowl');
  const malformed = rt.submit(sharedFoodBreak.verb, {
    ...params(),
    participants: [],
  });
  assert.equal(malformed.status, 'failed');
  const p = params();
  p.participants[1].actor = 'worker';
  assert.equal(rt.submit(sharedFoodBreak.verb, p).status, 'failed');
  complete(rt, 'stow_items', {
    actor: 'worker',
    placements: [{ item: 'break-bowl', surfaceSlot: 'belongings-table#r2c1' }],
  });
  const badReturns = params();
  badReturns.participants[0].returns[1].item = badReturns.participants[0].bowl;
  assert.equal(
    rt.submit(sharedFoodBreak.verb, badReturns).diagnostic?.code,
    'shared_food.returns',
  );
  assert.equal(readSharedFoodBreak(rt, malformed.id), undefined);
  assert.deepEqual(rt.holder(`shared-food:${B.pot}`), []);
  assert.deepEqual(rt.violations, []);
});
test('external serving-child cancel halts dispatch; independent walking remains untouched', () => {
  for (const independent of [false, true]) {
    const rt = setup(),
      action = rt.submit(sharedFoodBreak.verb, params());
    until(rt, () => readSharedFoodBreak(rt, action.id)?.phase === 'serving');
    const child = readSharedFoodBreak(rt, action.id)!.current!;
    const directive = independent
      ? rt.submit('walk_to', { actor: 'worker', x: 8, z: 10 })
      : undefined;
    if (!independent) rt.cancel(child);
    until(rt, () => !rt.isActive(action.id));
    assert.equal(action.status, 'failed');
    assert.equal(
      action.diagnostic?.code,
      independent ? 'shared_food.interrupted' : 'shared_food.child-stopped',
    );
    assert.equal(
      [...rt.records.values()].filter(
        (r) => r.parent === action.id && r.verb === 'converse',
      ).length,
      0,
    );
    if (directive) {
      assert.ok(rt.isActive(directive.id));
      until(rt, () => !rt.isActive(directive.id));
      assert.equal(directive.status, 'completed');
    }
    assertStopped(rt, action.id);
  }
});

test('foreign utensils and occupied approved returns refuse without mutating their support', () => {
  const rt = setup();
  complete(rt, 'take_item', {
    actor: 'visitor',
    item: B.people[0].bowl,
    hand: 'left',
  });
  const before = rt.stateHash();
  assert.equal(
    rt.submit(sharedFoodBreak.verb, params()).diagnostic?.code,
    'shared_food.foreign-item',
  );
  assert.equal(rt.stateHash(), before);
  complete(rt, 'stow_items', {
    actor: 'visitor',
    placements: [
      {
        item: B.people[0].bowl,
        surfaceSlot: B.people[0].returns[0].surfaceSlot,
      },
    ],
  });
  complete(rt, 'take_item', {
    actor: 'worker',
    item: 'break-bowl',
    hand: 'left',
  });
  complete(rt, 'put_item', {
    actor: 'worker',
    item: 'break-bowl',
    surfaceSlot: B.people[0].returns[1].surfaceSlot,
  });
  until(rt, () => !rt.holder('holds:worker').length);
  const occupied = rt.stateHash();
  assert.equal(
    rt.submit(sharedFoodBreak.verb, params()).diagnostic?.code,
    'shared_food.returns-occupied',
  );
  assert.equal(rt.stateHash(), occupied);
  assert.deepEqual(rt.holder(`shared-food:${B.pot}`), []);
});

test('deadline drains a nonprogressing ground child; active snapshot explicitly refuses', () => {
  const rt = setup(),
    original = rt.registry.get('walk_to')!;
  rt.registry.set('walk_to', {
    ...original,
    step: () => ({
      status: 'blocked',
      diagnostic: {
        code: 'walk.test-blocked',
        message: 'worker waits for authored test obstruction',
        subjects: ['worker'],
      },
    }),
  });
  const action = rt.submit(sharedFoodBreak.verb, params());
  until(
    rt,
    () =>
      readSharedFoodBreak(rt, action.id)?.diagnostic?.code ===
      'walk.test-blocked',
  );
  assert.equal(
    readSharedFoodBreak(rt, action.id)?.waitingReason,
    'worker waits for authored test obstruction',
  );
  assert.throws(
    () => rt.snapshot(),
    (e: unknown) =>
      e instanceof Error && 'code' in e && e.code === 'snapshot.non-resumable',
  );
  until(rt, () => !rt.isActive(action.id), 4000);
  assert.equal(action.status, 'failed');
  assert.equal(action.diagnostic?.code, 'shared_food.timeout');
  assertStopped(rt, action.id);
  assert.equal(rt.world.entities[B.pot].contents!.fraction, 1);
});

test('actual group release and parent cancellation wait for terminal child before stow/cleanup', () => {
  for (const cancelled of [false, true]) {
    const rt = setup(),
      original = rt.registry.get('converse')!,
      waits = new Map<unknown, number>();
    rt.registry.set('converse', {
      ...original,
      cancel: (_rt, ex) => {
        if (!waits.has(ex)) waits.set(ex, 12);
        return { ok: true, deferred: true };
      },
      step: (runtime, ex, dt) => {
        const n = waits.get(ex);
        if (n !== undefined) {
          if (n > 0) {
            waits.set(ex, n - 1);
            return original.step(runtime, ex, dt);
          }
          original.cancel(runtime, ex);
          return { status: 'completed' };
        }
        return original.step(runtime, ex, dt);
      },
    });
    const action = rt.submit(sharedFoodBreak.verb, params());
    until(
      rt,
      () =>
        readSharedFoodBreak(rt, action.id)?.phase ===
        (cancelled ? 'eating' : 'releasing'),
    );
    const group = readSharedFoodBreak(rt, action.id)!.group!;
    if (cancelled) rt.cancel(action.id);
    for (let i = 0; i < 8; i++) {
      rt.step();
      assert.ok(rt.isActive(group));
      assert.ok(rt.isActive(action.id));
      assert.deepEqual(rt.holder(`shared-food:${B.pot}`), [action.id]);
      for (const p of B.people)
        assert.deepEqual(rt.holder(`actor:${p.actor}`), [group]);
      assert.equal(readSharedFoodBreak(rt, action.id)?.floorHolder, undefined);
      assert.equal(
        [...rt.records.values()].filter(
          (r) => r.parent === action.id && r.verb === 'stow_items',
        ).length,
        0,
      );
    }
    until(rt, () => !rt.isActive(action.id));
    assert.equal(
      action.status,
      cancelled ? 'cancelled' : 'completed',
      action.diagnostic?.message,
    );
    assertStopped(rt, action.id);
  }
});

test('already filled bowls need no pot portions; elevated returns refuse in preflight', () => {
  const rt = setup(4, 0, 0.4),
    action = complete(rt, sharedFoodBreak.verb, params());
  assert.equal(
    [...rt.records.values()].filter(
      (r) => r.parent === action.id && r.verb === 'serve',
    ).length,
    0,
  );
  assert.equal(rt.world.entities[B.pot].contents!.fraction, 0);
  assertStopped(rt, action.id);
  const elevated = setup(4, 1, 0, true),
    before = elevated.stateHash();
  assert.equal(
    elevated.submit(sharedFoodBreak.verb, params()).diagnostic?.code,
    'shared_food.returns-elevated',
  );
  assert.equal(elevated.stateHash(), before);
});
