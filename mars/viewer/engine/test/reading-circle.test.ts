import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readingCircleRuntime,
  readingCircleBinding,
} from '../scenarios/reading-circle.ts';
import { readReadingCircle } from '../activities/reading-circle.ts';
import { readBook } from '../objects/reading.ts';
import type { SocialRegion } from '../social/slots.ts';
import { slotById } from '../social/slots.ts';
import { human } from '../world/factory.ts';
import { hashOf } from '../core/hash.ts';
import type { Runtime } from '../runtime/runtime.ts';
function until(rt: Runtime, done: () => boolean, max = 6000) {
  for (let i = 0; i < max && !done(); i++) rt.step();
  assert.ok(
    done(),
    JSON.stringify(
      [...rt.records.values()]
        .filter((r) => rt.isActive(r.id))
        .map((r) => [r.verb, r.phase, r.diagnostic]),
    ),
  );
  assert.deepEqual(rt.violations, []);
}
function read(rt: Runtime, id: string) {
  const r = readReadingCircle(rt, id);
  assert.ok(r);
  return r;
}
function book(rt: Runtime) {
  const r = readBook(rt, 'book');
  assert.ok(!('code' in r));
  return r;
}
function start(yaw = 0) {
  const rt = readingCircleRuntime(yaw),
    a = rt.submit('reading_circle', readingCircleBinding());
  assert.notEqual(a.status, 'failed', a.diagnostic?.message);
  return { rt, a };
}
function control(rt: Runtime, session: string, intent: unknown) {
  const r = rt.submit('reading_circle_control', { session, intent });
  assert.notEqual(r.status, 'failed', r.diagnostic?.message);
  return r;
}
function clean(rt: Runtime, id: string) {
  for (const child of read(rt, id).ownedActions)
    assert.equal(rt.isActive(child), false);
  for (const actor of ['reader', 'listener-1', 'listener-2', 'listener-3'])
    assert.deepEqual(rt.holder(`actor:${actor}`), []);
  assert.deepEqual(rt.holder('entity:book'), []);
  assert.deepEqual(rt.holder('reading:book'), []);
  assert.deepEqual(rt.holder('reading-circle:book'), []);
  for (const slot of [
    'reading-chair#seat',
    ...read(rt, id).participants.map((m) => m.slot),
  ])
    assert.deepEqual(rt.holder(`slot:${slot}`), []);
  for (const actor of ['reader', 'listener-1', 'listener-2', 'listener-3'])
    assert.deepEqual(rt.holder(`reading-circle-member:${actor}`), []);
  assert.deepEqual(rt.violations, []);
}
for (const yaw of [0, Math.PI / 2])
  test(`real supported book reading intervals and physical questions/answers at ${yaw}`, () => {
    const { rt, a } = start(yaw),
      original = structuredClone(rt.world.entities.book);
    until(rt, () => book(rt).phase === 'reading' && book(rt).elapsed >= 1);
    const r = read(rt, a.id);
    assert.equal(r.attentionTarget?.entity, 'book');
    assert.equal(r.floorHolder, 'reader');
    for (const m of r.participants.filter((m) => m.active)) {
      assert.equal(m.state, 'listening');
      const s = slotById(rt, m.slot);
      assert.ok(!('code' in s));
      const h = rt.world.entities[m.actor];
      assert.ok(Math.hypot(h.pose.p[0] - s.p[0], h.pose.p[2] - s.p[1]) < 0.05);
    }
    until(rt, () => read(rt, a.id).effects.length >= 2);
    const effects = read(rt, a.id).effects;
    assert.equal(effects[0].kind, 'question');
    assert.equal(effects[1].kind, 'answer');
    assert.equal(effects[1].replyTo, 0);
    assert.ok(effects.every((e) => e.book === 'book' && e.readSeconds >= 4));
    until(rt, () => !rt.isActive(a.id));
    assert.equal(a.outputs?.finished, true);
    assert.equal(a.outputs?.readSeconds, 12);
    assert.equal(book(rt).status, 'completed');
    assert.equal(book(rt).elapsed, 12);
    assert.deepEqual(rt.world.entities.book.pose, original.pose);
    assert.deepEqual(rt.world.entities.book.support, original.support);
    assert.equal(rt.world.entities.book.id, original.id);
    assert.equal(rt.world.entities.book.def, original.def);
    clean(rt, a.id);
  });
test('Pause safely retains same reader bookmark and explicit Resume finishes', () => {
  const { rt, a } = start();
  until(rt, () => book(rt).phase === 'reading' && book(rt).elapsed >= 1.25);
  const before = book(rt).elapsed;
  control(rt, a.id, { kind: 'pause' });
  until(rt, () => read(rt, a.id).mode === 'paused');
  assert.equal(book(rt).status, 'unfinished');
  assert.equal(book(rt).elapsed, before);
  assert.equal(book(rt).user, 'reader');
  const effects = read(rt, a.id).effects;
  control(rt, a.id, { kind: 'resume' });
  until(rt, () => book(rt).elapsed > before);
  assert.deepEqual(read(rt, a.id).effects, effects);
  until(rt, () => !rt.isActive(a.id));
  assert.equal(book(rt).elapsed, 12);
  clean(rt, a.id);
});
test('Leave/late Join and requested question keep real participant and artifact state', () => {
  const { rt, a } = start();
  until(rt, () => book(rt).phase === 'reading' && book(rt).elapsed >= 1);
  control(rt, a.id, { kind: 'join', actor: 'listener-3' });
  until(
    rt,
    () =>
      read(rt, a.id).participants.find((m) => m.actor === 'listener-3')
        ?.state === 'listening' &&
      read(rt, a.id).mode === 'reading' &&
      read(rt, a.id).elapsed >= 4,
  );
  control(rt, a.id, { kind: 'ask', actor: 'listener-3' });
  control(rt, a.id, { kind: 'leave', actor: 'listener-2', to: [4, -4] });
  until(rt, () =>
    read(rt, a.id).effects.some(
      (e) => e.kind === 'question' && e.actor === 'listener-3',
    ),
  );
  assert.equal(
    read(rt, a.id).participants.find((m) => m.actor === 'listener-2')?.active,
    false,
  );
  until(rt, () => !rt.isActive(a.id) && !rt.holder('actor:listener-2').length);
  assert.ok(
    read(rt, a.id).effects.some(
      (e) => e.kind === 'answer' && e.replyTo !== undefined,
    ),
  );
  clean(rt, a.id);
});
test('reader directive safely pauses, preserves book and resumes only after director releases', () => {
  const { rt, a } = start();
  until(rt, () => book(rt).phase === 'reading' && book(rt).elapsed >= 1);
  const before = book(rt).elapsed,
    direct = rt.submit('walk_to', { actor: 'reader', x: -4, z: -4, level: 0 });
  assert.notEqual(direct.status, 'failed', direct.diagnostic?.message);
  until(rt, () => read(rt, a.id).mode === 'waiting' && !rt.isActive(direct.id));
  assert.equal(book(rt).elapsed, before);
  assert.equal(
    read(rt, a.id).diagnostic?.code,
    'reading_circle.reader-directed',
  );
  control(rt, a.id, { kind: 'resume' });
  until(rt, () => !rt.isActive(a.id));
  assert.equal(book(rt).elapsed, 12);
  clean(rt, a.id);
});
test('rapid Pause then End before next tick dispatches no orphan reading child', () => {
  const { rt, a } = start();
  control(rt, a.id, { kind: 'pause' });
  control(rt, a.id, { kind: 'end' });
  until(rt, () => !rt.isActive(a.id));
  assert.equal(a.outputs?.finished, false);
  assert.equal(read(rt, a.id).ownedActions.length, 0);
  clean(rt, a.id);
});
test('End during real reading retains unfinished progress and drains claims', () => {
  const { rt, a } = start();
  until(rt, () => book(rt).phase === 'reading' && book(rt).elapsed >= 1);
  const before = book(rt).elapsed;
  control(rt, a.id, { kind: 'end' });
  until(rt, () => !rt.isActive(a.id));
  assert.equal(a.outputs?.finished, false);
  assert.equal(a.outputs?.readSeconds, before);
  assert.equal(book(rt).status, 'unfinished');
  clean(rt, a.id);
  const later = rt.submit('reading_circle', {
    ...readingCircleBinding(),
    resume: true,
  });
  assert.notEqual(later.status, 'failed', later.diagnostic?.message);
  until(rt, () => !rt.isActive(later.id));
  assert.equal(book(rt).elapsed, 12);
  clean(rt, later.id);
});
test('missing book, occupied listener and unsupported book reject without fabricated progress', () => {
  for (const kind of ['missing', 'occupied', 'unsupported'] as const) {
    const rt = readingCircleRuntime();
    if (kind === 'missing') delete rt.world.entities.book;
    else if (kind === 'unsupported')
      rt.world.entities.book.support = { kind: 'ground' };
    else {
      const s = slotById(rt, 'reading-listener-1#r1c0');
      assert.ok(!('code' in s));
      rt.world.entities.bystander = human('bystander', s.p[0], s.p[1]);
    }
    const before = hashOf(rt.world),
      a = rt.submit('reading_circle', readingCircleBinding());
    assert.equal(a.status, 'failed');
    assert.ok(
      a.diagnostic?.subjects?.includes(
        kind === 'occupied' ? 'listener-1' : 'book',
      ),
    );
    assert.equal(hashOf(rt.world), before);
  }
});
test('unfinished book rejects reader replacement rather than resetting bookmark', () => {
  const { rt, a } = start();
  until(rt, () => book(rt).phase === 'reading' && book(rt).elapsed >= 1);
  control(rt, a.id, { kind: 'end' });
  until(rt, () => !rt.isActive(a.id));
  rt.world.entities.other = human('other', -4, -4);
  const before = book(rt).elapsed,
    b = rt.submit('reading_circle', {
      ...readingCircleBinding(),
      reader: 'other',
      resume: true,
    });
  assert.equal(b.status, 'failed');
  assert.equal(b.diagnostic?.code, 'reading.unfinished-task');
  assert.equal(book(rt).elapsed, before);
  clean(rt, a.id);
});
test('same decisions replay exact world and discussion history', () => {
  const run = () => {
    const { rt, a } = start();
    until(rt, () => book(rt).phase === 'reading' && book(rt).elapsed >= 1);
    control(rt, a.id, { kind: 'ask', actor: 'listener-2' });
    until(rt, () => !rt.isActive(a.id));
    clean(rt, a.id);
    return {
      world: hashOf(rt.world),
      effects: read(rt, a.id).effects,
      outputs: a.outputs,
    };
  };
  assert.deepEqual(run(), run());
});
test('Pause within final discussion preserves unfinished turn rather than resetting completed book', () => {
  const { rt, a } = start();
  until(
    rt,
    () =>
      book(rt).status === 'completed' &&
      read(rt, a.id).mode === 'discussion' &&
      read(rt, a.id).turn.elapsed >= 0.5,
  );
  const prior = read(rt, a.id),
    effects = structuredClone(prior.effects);
  control(rt, a.id, { kind: 'pause' });
  until(rt, () => read(rt, a.id).mode === 'paused');
  assert.equal(book(rt).elapsed, 12);
  assert.equal(book(rt).status, 'completed');
  assert.equal(read(rt, a.id).turn.elapsed, prior.turn.elapsed);
  control(rt, a.id, { kind: 'resume' });
  until(rt, () => !rt.isActive(a.id));
  assert.equal(book(rt).elapsed, 12);
  assert.deepEqual(read(rt, a.id).effects.slice(0, effects.length), effects);
  assert.equal(a.outputs?.finished, true);
  clean(rt, a.id);
});
test('unavailable book pauses explicitly and restores remaining same-book reading', () => {
  const { rt, a } = start();
  until(rt, () => book(rt).phase === 'reading' && book(rt).elapsed >= 1);
  rt.world.entities.book.equipment!.config.available = false;
  until(rt, () => read(rt, a.id).mode === 'waiting');
  const prior = book(rt).elapsed,
    refused = rt.submit('reading_circle_control', {
      session: a.id,
      intent: { kind: 'resume' },
    });
  assert.equal(refused.status, 'failed');
  rt.world.entities.book.equipment!.config.available = true;
  control(rt, a.id, { kind: 'resume' });
  until(rt, () => book(rt).elapsed > prior);
  until(rt, () => !rt.isActive(a.id));
  clean(rt, a.id);
});
test('Pause at final completed answer boundary resumes completion without reading reset', () => {
  const { rt, a } = start();
  until(
    rt,
    () =>
      read(rt, a.id).mode === 'turn-release' &&
      read(rt, a.id).elapsed === 12 &&
      read(rt, a.id).effects.at(-1)?.kind === 'answer',
  );
  const effects = read(rt, a.id).effects;
  control(rt, a.id, { kind: 'pause' });
  until(rt, () => read(rt, a.id).mode === 'paused');
  control(rt, a.id, { kind: 'resume' });
  until(rt, () => !rt.isActive(a.id));
  assert.equal(book(rt).elapsed, 12);
  assert.equal(book(rt).status, 'completed');
  assert.deepEqual(read(rt, a.id).effects, effects);
  assert.equal(a.outputs?.finished, true);
  clean(rt, a.id);
});
test('blocked listening place and facing error refuse exact declared resources', () => {
  for (const kind of ['blocked', 'facing']) {
    const rt = readingCircleRuntime();
    const s = slotById(rt, 'reading-listener-1#r1c0');
    assert.ok(!('code' in s));
    if (kind === 'blocked') {
      rt.world.entities.block = {
        id: 'block',
        kind: 'fixture',
        def: 'camp-chair',
        pose: { p: [s.p[0], 0, s.p[1]], yaw: 0 },
        support: { kind: 'ground' },
        provenance: rt.world.entities['reading-chair'].provenance,
      };
    } else
      (rt.world.regions['reading-listener-1'] as SocialRegion).layout!.focus = [
        -6, -6,
      ];
    const a = rt.submit('reading_circle', readingCircleBinding());
    assert.equal(a.status, 'failed');
    assert.ok(a.diagnostic?.message);
    assert.deepEqual(rt.holder('actor:reader'), []);
  }
});
test('all listeners Leave names waiting intervention; declared Join permits explicit Resume', () => {
  const { rt, a } = start();
  until(rt, () => book(rt).phase === 'reading' && book(rt).elapsed >= 1);
  control(rt, a.id, { kind: 'leave', actor: 'listener-1', to: [-4, -3] });
  control(rt, a.id, { kind: 'leave', actor: 'listener-2', to: [4, -3] });
  until(
    rt,
    () =>
      read(rt, a.id).mode === 'waiting' &&
      !rt.holder('actor:listener-1').length &&
      !rt.holder('actor:listener-2').length,
  );
  const refused = rt.submit('reading_circle_control', {
    session: a.id,
    intent: { kind: 'resume' },
  });
  assert.equal(refused.status, 'failed');
  assert.equal(refused.diagnostic?.code, 'reading_circle.audience-left');
  control(rt, a.id, { kind: 'join', actor: 'listener-3' });
  control(rt, a.id, { kind: 'resume' });
  until(rt, () => !rt.isActive(a.id));
  assert.equal(book(rt).elapsed, 12);
  clean(rt, a.id);
});
test('requested floor yields completed ordinary occupied contribution about actual book', () => {
  const { rt, a } = start();
  until(rt, () => book(rt).phase === 'reading' && book(rt).elapsed >= 1);
  control(rt, a.id, { kind: 'floor', actor: 'listener-2' });
  until(
    rt,
    () =>
      read(rt, a.id).mode === 'discussion' &&
      read(rt, a.id).floorHolder === 'listener-2',
  );
  assert.equal(
    read(rt, a.id).participants.find((m) => m.actor === 'listener-2')?.state,
    'speaking',
  );
  until(rt, () =>
    read(rt, a.id).effects.some(
      (e) => e.kind === 'comment' && e.actor === 'listener-2',
    ),
  );
  control(rt, a.id, { kind: 'end' });
  until(rt, () => !rt.isActive(a.id));
  clean(rt, a.id);
});
for (const stage of ['pausing', 'paused', 'waiting'] as const)
  test(`listener directed during ${stage} stays withdrawn through explicit Resume and Join`, () => {
    const { rt, a } = start();
    until(rt, () => book(rt).phase === 'reading' && book(rt).elapsed >= 1);
    if (stage === 'waiting') {
      const readerWalk = rt.submit('walk_to', {
        actor: 'reader',
        x: -4,
        z: -4,
        level: 0,
      });
      assert.notEqual(readerWalk.status, 'failed');
      until(
        rt,
        () => read(rt, a.id).mode === 'waiting' && !rt.isActive(readerWalk.id),
      );
    } else {
      control(rt, a.id, { kind: 'pause' });
      if (stage === 'paused') until(rt, () => read(rt, a.id).mode === 'paused');
    }
    const walk = rt.submit('walk_to', {
      actor: 'listener-1',
      x: -6,
      z: -6,
      level: 0,
    });
    assert.notEqual(walk.status, 'failed', walk.diagnostic?.message);
    assert.equal(
      read(rt, a.id).participants.find((m) => m.actor === 'listener-1')?.active,
      false,
    );
    until(rt, () => ['paused', 'waiting'].includes(read(rt, a.id).mode));
    control(rt, a.id, { kind: 'resume' });
    assert.equal(rt.isActive(walk.id), true);
    assert.equal(
      read(rt, a.id).participants.find((m) => m.actor === 'listener-1')?.active,
      false,
    );
    const refused = rt.submit('reading_circle_control', {
      session: a.id,
      intent: { kind: 'join', actor: 'listener-1' },
    });
    assert.equal(refused.status, 'failed');
    assert.equal(rt.isActive(walk.id), true);
    until(rt, () => !rt.isActive(walk.id));
    assert.equal(walk.status, 'completed');
    assert.equal(
      read(rt, a.id).participants.find((m) => m.actor === 'listener-1')?.active,
      false,
    );
    assert.equal(
      read(rt, a.id).participants.find((m) => m.actor === 'listener-1')?.hold,
      undefined,
    );
    control(rt, a.id, { kind: 'join', actor: 'listener-1' });
    until(
      rt,
      () =>
        read(rt, a.id).participants.find((m) => m.actor === 'listener-1')
          ?.state === 'listening',
    );
    assert.equal(
      read(rt, a.id).participants.find((m) => m.actor === 'listener-1')?.active,
      true,
    );
    control(rt, a.id, { kind: 'end' });
    until(rt, () => !rt.isActive(a.id));
    clean(rt, a.id);
  });
test('directing every active listener retains withdrawals while waiting, and Join plus Resume restores only selected listener', () => {
  const { rt, a } = start();
  until(rt, () => book(rt).phase === 'reading' && book(rt).elapsed >= 1);
  const first = rt.submit('walk_to', {
      actor: 'listener-1',
      x: -6,
      z: -6,
      level: 0,
    }),
    second = rt.submit('walk_to', {
      actor: 'listener-2',
      x: 6,
      z: -6,
      level: 0,
    });
  assert.notEqual(first.status, 'failed');
  assert.notEqual(second.status, 'failed');
  until(rt, () => read(rt, a.id).mode === 'waiting');
  assert.equal(read(rt, a.id).diagnostic?.code, 'reading_circle.audience-left');
  assert.equal(read(rt, a.id).participants.filter((m) => m.active).length, 0);
  const refused = rt.submit('reading_circle_control', {
    session: a.id,
    intent: { kind: 'resume' },
  });
  assert.equal(refused.status, 'failed');
  assert.equal(refused.diagnostic?.code, 'reading_circle.audience-left');
  assert.equal(rt.isActive(first.id), true);
  assert.equal(rt.isActive(second.id), true);
  control(rt, a.id, { kind: 'join', actor: 'listener-3' });
  control(rt, a.id, { kind: 'resume' });
  assert.deepEqual(
    read(rt, a.id)
      .participants.filter((m) => m.active)
      .map((m) => m.actor),
    ['listener-3'],
  );
  until(
    rt,
    () =>
      !rt.isActive(a.id) && !rt.isActive(first.id) && !rt.isActive(second.id),
  );
  assert.equal(first.status, 'completed');
  assert.equal(second.status, 'completed');
  assert.equal(book(rt).elapsed, 12);
  assert.equal(
    read(rt, a.id).participants.find((m) => m.actor === 'listener-1')?.active,
    false,
  );
  assert.equal(
    read(rt, a.id).participants.find((m) => m.actor === 'listener-2')?.active,
    false,
  );
  clean(rt, a.id);
});
