import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Runtime, DT } from '../runtime/runtime.ts';
import {
  createRegistry,
  servicesFor,
  ENGINE_INVARIANTS,
} from '../api/registry.ts';
import { classroomScene, classroomWorld } from '../scenarios/classroom.ts';
import {
  WORK_BREAK_BINDING as B,
  workBreakWorld,
  type WorkBreakParticipant,
} from '../scenarios/work-break.ts';
import { readWorkstation } from '../objects/workstation.ts';
import { heldBy, reachOf, BODY_REACH, surfaceSlot } from '../items/model.ts';
import { allSlots } from '../social/slots.ts';
import type { ActionRecord } from '../actions/types.ts';

type Command =
  | {
      tick: number;
      kind: 'submit';
      verb: string;
      params: unknown;
      action: string;
    }
  | { tick: number; kind: 'cancel'; action: string };
const commands = new WeakMap<Runtime, Command[]>();
function submit(rt: Runtime, verb: string, params: unknown) {
  const rec = rt.submit(verb, params);
  commands
    .get(rt)
    ?.push({
      tick: rt.tick,
      kind: 'submit',
      verb,
      params: structuredClone(params),
      action: rec.id,
    });
  return rec;
}
function cancel(rt: Runtime, action: string) {
  commands.get(rt)?.push({ tick: rt.tick, kind: 'cancel', action });
  return rt.cancel(action);
}
function replay(original: Runtime, count: 4 | 8) {
  const other = setup(count),
    ids = new Map<string, string>();
  for (const command of commands.get(original)!) {
    while (other.tick < command.tick) other.step();
    if (command.kind === 'submit')
      ids.set(
        command.action,
        other.submit(command.verb, structuredClone(command.params)).id,
      );
    else {
      const action = ids.get(command.action);
      assert.ok(action);
      other.cancel(action);
    }
  }
  while (other.tick < original.tick) other.step();
  assert.equal(
    other.stateHash(),
    original.stateHash(),
    'same timed owner commands reproduce authoritative world',
  );
  assert.deepEqual(
    [...other.records.values()],
    [...original.records.values()],
    'child outcomes and cleanup reproduce',
  );
  clean(other);
}

function setup(count: 4 | 8 = 4) {
  const world = workBreakWorld(count);
  const rt = new Runtime(
    world,
    createRegistry(),
    servicesFor({ classroom: classroomScene() })(world),
    ENGINE_INVARIANTS,
  );
  commands.set(rt, []);
  return rt;
}
function until(rt: Runtime, done: () => boolean, max = 5000) {
  for (let i = 0; i < max && !done(); i++) rt.step();
  assert.ok(
    done(),
    JSON.stringify([...rt.records.values()].filter((r) => rt.isActive(r.id))),
  );
  assert.deepEqual(rt.violations, []);
}
function complete(rt: Runtime, verb: string, params: unknown) {
  const rec = submit(rt, verb, params);
  assert.notEqual(rec.status, 'failed', rec.diagnostic?.message);
  until(rt, () => !rt.isActive(rec.id));
  assert.equal(rec.status, 'completed', rec.diagnostic?.message);
  return rec;
}
function work(rt: Runtime) {
  const state = readWorkstation(rt, B.work.station);
  assert.ok(!('code' in state));
  return state;
}
function takeAndServe(rt: Runtime, person: WorkBreakParticipant) {
  complete(rt, 'take_item', {
    actor: person.actor,
    item: person.bowl,
    hand: 'left',
  });
  complete(rt, 'take_item', {
    actor: person.actor,
    item: person.spoon,
    hand: 'right',
  });
  complete(rt, 'walk_to', {
    actor: person.actor,
    x: person.service[0],
    z: person.service[1],
  });
  assert.ok(
    reachOf(rt.world.entities[person.actor], rt.world.entities[B.pot].pose.p) <=
      BODY_REACH,
  );
  complete(rt, 'serve', { actor: person.actor, pot: B.pot, bowl: person.bowl });
}
function clean(rt: Runtime) {
  assert.deepEqual(
    [...rt.records.values()].filter((r) => rt.isActive(r.id)),
    [],
  );
  for (const person of B.people) {
    assert.deepEqual(heldBy(rt.world, person.actor), []);
    for (const resource of [
      `actor:${person.actor}`,
      `hand:${person.actor}:left`,
      `hand:${person.actor}:right`,
      `holds:${person.actor}`,
      `entity:${person.bowl}`,
      `entity:${person.spoon}`,
      ...person.returns.map((p) => `surface-slot:${p.surfaceSlot}`),
    ])
      assert.deepEqual(rt.holder(resource), [], resource);
  }
  for (const resource of [
    `workstation:${B.work.station}`,
    `entity:${B.work.station}`,
    'entity:work-chair',
    `entity:${B.pot}`,
  ])
    assert.deepEqual(rt.holder(resource), [], resource);
  for (const slot of allSlots(rt))
    assert.equal(slot.claimedBy, undefined, slot.id);
  assert.deepEqual(rt.violations, []);
}
function stop(rt: Runtime, rec: ActionRecord) {
  cancel(rt, rec.id);
  until(rt, () => !rt.isActive(rec.id));
  assert.equal(rec.status, 'cancelled');
}
for (const count of [4, 8] as const)
  test(`same-world ${count}: work → shared serving/talking/eating → explicit returns → same work`, () => {
    const rt = setup(count);
    const started = submit(rt, 'work_at', B.work);
    until(rt, () => work(rt).elapsed >= 1);
    const elapsed = work(rt).elapsed;
    const seated = [...rt.records.values()].find(
      (r) => r.parent === started.id && r.verb === 'sit',
    )!;
    cancel(rt, started.id);
    assert.ok(rt.isActive(started.id), 'safe stand-up retains parent');
    assert.ok(rt.isActive(seated.id));
    until(rt, () => !rt.isActive(started.id));
    assert.equal(work(rt).status, 'unfinished');
    assert.equal(work(rt).elapsed, elapsed);
    for (const person of B.people) takeAndServe(rt, person);
    assert.equal(rt.world.entities[B.pot].contents?.fraction, 0.5);
    const conversation = submit(rt, 'converse', B.conversation);
    until(rt, () => conversation.phase === 'talking');
    const eating = B.people.map((person) =>
      submit(rt, 'eat', {
        actor: person.actor,
        bowl: person.bowl,
        spoon: person.spoon,
      }),
    );
    for (const rec of eating)
      assert.notEqual(rec.status, 'failed', rec.diagnostic?.message);
    until(rt, () => eating.every((r) => !rt.isActive(r.id)));
    for (const person of B.people) {
      assert.equal(rt.world.entities[person.bowl].contents?.fraction, 0);
      assert.deepEqual(rt.holder(`actor:${person.actor}`), [conversation.id]);
      assert.equal(rt.world.entities[person.actor].human!.activity, 'talk');
    }
    assert.equal(work(rt).elapsed, elapsed, 'break never advances work');
    stop(rt, conversation);
    for (const person of B.people)
      complete(rt, 'stow_items', {
        actor: person.actor,
        placements: person.returns,
      });
    until(rt, () =>
      B.people.every((p) => !rt.holder(`holds:${p.actor}`).length),
    );
    const resumed = submit(rt, 'work_at', { ...B.work, resume: true });
    assert.notEqual(resumed.status, 'failed', resumed.diagnostic?.message);
    until(rt, () => resumed.phase === 'working');
    assert.ok(
      work(rt).elapsed >= elapsed && work(rt).elapsed <= elapsed + DT * 2,
    );
    assert.equal(work(rt).duration, B.work.duration);
    until(rt, () => !rt.isActive(resumed.id));
    assert.equal(resumed.status, 'completed');
    assert.equal(work(rt).elapsed, B.work.duration);
    assert.equal(work(rt).user, B.work.actor);
    assert.equal(work(rt).task, B.work.task);
    assert.equal(
      [...rt.records.values()].filter((r) => r.status === 'failed').length,
      0,
    );
    clean(rt);
    replay(rt, count);
  });

test('authored extension preserves classroom entities and validates returns/service geometry', () => {
  for (const count of [4, 8] as const) {
    const original = classroomWorld(count),
      world = workBreakWorld(count);
    for (const [id, entity] of Object.entries(original.entities))
      assert.deepEqual(world.entities[id], entity, id);
    const rt = setup(count);
    for (const person of B.people) {
      for (const placement of person.returns) {
        const slot = surfaceSlot(rt.world, placement.surfaceSlot);
        assert.ok(!('code' in slot));
      }
      complete(rt, 'walk_to', {
        actor: person.actor,
        x: person.service[0],
        z: person.service[1],
      });
      assert.ok(
        reachOf(
          rt.world.entities[person.actor],
          rt.world.entities[B.pot].pose.p,
        ) <= BODY_REACH,
      );
    }
    clean(rt);
  }
});

test('unavailable food and full hands refuse without replacing support or duplicating food', () => {
  const rt = setup(),
    person = B.people[0];
  complete(rt, 'take_item', {
    actor: person.actor,
    item: person.bowl,
    hand: 'left',
  });
  complete(rt, 'walk_to', {
    actor: person.actor,
    x: person.service[0],
    z: person.service[1],
  });
  const before = structuredClone(rt.world.entities[person.bowl]);
  const missing = submit(rt, 'serve', {
    actor: person.actor,
    pot: 'missing-pot',
    bowl: person.bowl,
  });
  assert.equal(missing.status, 'failed');
  assert.equal(missing.diagnostic?.code, 'entity.unknown');
  assert.ok(missing.diagnostic?.subjects?.includes('missing-pot'));
  assert.deepEqual(rt.world.entities[person.bowl], before);
  const full = submit(rt, 'take_item', {
    actor: person.actor,
    item: person.spoon,
    hand: 'left',
  });
  assert.equal(full.diagnostic?.code, 'item.hand-full');
  assert.deepEqual(rt.world.entities[person.bowl], before);
  assert.equal(rt.world.entities[B.pot].contents?.fraction, 1);
  complete(rt, 'stow_items', {
    actor: person.actor,
    placements: [person.returns[0]],
  });
  until(rt, () => !rt.holder(`holds:${person.actor}`).length);
  clean(rt);
});

test('serving/eating interruption keeps truthful partial food, companion group and hand support', () => {
  const rt = setup(),
    person = B.people[0];
  complete(rt, 'take_item', {
    actor: person.actor,
    item: person.bowl,
    hand: 'left',
  });
  complete(rt, 'take_item', {
    actor: person.actor,
    item: person.spoon,
    hand: 'right',
  });
  complete(rt, 'walk_to', {
    actor: person.actor,
    x: person.service[0],
    z: person.service[1],
  });
  const serve = submit(rt, 'serve', {
    actor: person.actor,
    pot: B.pot,
    bowl: person.bowl,
  });
  until(rt, () => serve.phase === 'to-bowl');
  stop(rt, serve);
  assert.equal(rt.world.entities[person.bowl].contents?.fraction, 0);
  assert.equal(rt.world.entities[B.pot].contents?.fraction, 1);
  complete(rt, 'serve', { actor: person.actor, pot: B.pot, bowl: person.bowl });
  takeAndServe(rt, B.people[1]);
  const conversation = submit(rt, 'converse', B.conversation);
  until(rt, () => conversation.phase === 'talking');
  const eat = submit(rt, 'eat', {
    actor: person.actor,
    bowl: person.bowl,
    spoon: person.spoon,
  });
  until(rt, () => eat.phase === 'lift');
  const remaining = rt.world.entities[person.bowl].contents?.fraction;
  stop(rt, eat);
  assert.equal(rt.world.entities[person.bowl].contents?.fraction, remaining);
  assert.equal(rt.world.entities[B.pot].contents?.fraction, 0.5);
  assert.ok(rt.isActive(conversation.id));
  assert.deepEqual(rt.holder('actor:visitor'), [conversation.id]);
  assert.equal(rt.world.entities.visitor.human!.activity, 'talk');
  assert.equal(heldBy(rt.world, person.actor).length, 2);
  stop(rt, conversation);
  for (const p of B.people)
    complete(rt, 'stow_items', { actor: p.actor, placements: p.returns });
  until(rt, () => B.people.every((p) => !rt.holder(`holds:${p.actor}`).length));
  clean(rt);
});

test('post-serving cancellation preserves transferred food; moving eat and held-item resume refuse', () => {
  const rt = setup(),
    person = B.people[0];
  const started = submit(rt, 'work_at', B.work);
  until(rt, () => work(rt).elapsed >= 0.5);
  stop(rt, started);
  const elapsed = work(rt).elapsed;
  complete(rt, 'take_item', {
    actor: person.actor,
    item: person.bowl,
    hand: 'left',
  });
  complete(rt, 'take_item', {
    actor: person.actor,
    item: person.spoon,
    hand: 'right',
  });
  complete(rt, 'walk_to', {
    actor: person.actor,
    x: person.service[0],
    z: person.service[1],
  });
  const serving = submit(rt, 'serve', {
    actor: person.actor,
    pot: B.pot,
    bowl: person.bowl,
  });
  until(rt, () => serving.phase === 'back');
  stop(rt, serving);
  assert.equal(rt.world.entities[person.bowl].contents?.fraction, 1);
  assert.equal(rt.world.entities[B.pot].contents?.fraction, 0.75);
  const resume = submit(rt, 'work_at', { ...B.work, resume: true });
  assert.equal(resume.diagnostic?.code, 'workstation.hands-occupied');
  assert.equal(work(rt).elapsed, elapsed);
  const walk = submit(rt, 'walk_to', { actor: person.actor, x: -5, z: -2 });
  assert.notEqual(walk.status, 'failed', walk.diagnostic?.message);
  const eat = submit(rt, 'eat', {
    actor: person.actor,
    bowl: person.bowl,
    spoon: person.spoon,
  });
  assert.equal(eat.diagnostic?.code, 'eat.not-still');
  assert.equal(rt.world.entities[person.bowl].contents?.fraction, 1);
  until(rt, () => !rt.isActive(walk.id));
  assert.equal(walk.status, 'completed');
  complete(rt, 'stow_items', {
    actor: person.actor,
    placements: person.returns,
  });
  until(rt, () => !rt.holder(`holds:${person.actor}`).length);
  complete(rt, 'work_at', { ...B.work, resume: true });
  assert.equal(work(rt).elapsed, B.work.duration);
  clean(rt);
});
