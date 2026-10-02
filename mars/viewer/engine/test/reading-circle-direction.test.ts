import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readingCircleRuntime,
  readingCircleBinding,
} from '../scenarios/reading-circle.ts';
import { readReadingCircle } from '../activities/reading-circle.ts';
import { readBook } from '../objects/reading.ts';
import { rot2 } from '../core/math.ts';
import type { Runtime } from '../runtime/runtime.ts';
function until(rt: Runtime, done: () => boolean) {
  for (let i = 0; i < 6000 && !done(); i++) rt.step();
  assert.ok(done());
  assert.deepEqual(rt.violations, []);
}
function setup(yaw: number, phase: 'reading' | 'discussion') {
  const rt = readingCircleRuntime(yaw),
    a = rt.submit('reading_circle', readingCircleBinding());
  until(rt, () => {
    const s = readReadingCircle(rt, a.id),
      b = readBook(rt, 'book');
    if (!s || 'code' in b) return false;
    return phase === 'reading'
      ? b.phase === 'reading' && b.elapsed >= 1
      : s.mode === 'discussion' && s.reader.state === 'listening';
  });
  return { rt, a };
}
for (const yaw of [0, Math.PI / 2])
  for (const phase of ['reading', 'discussion'] as const)
    test(`reader handoff from occupied ${phase} at ${yaw} plans only after ordinary stand-up`, () => {
      const { rt, a } = setup(yaw, phase),
        target = rot2([-0.15, -5], yaw),
        params = { actor: 'reader', x: target[0], z: target[1] },
        before = readBook(rt, 'book');
      assert.ok(!('code' in before));
      const physical = structuredClone({
        pose: rt.world.entities.book.pose,
        support: rt.world.entities.book.support,
      });
      const speculative = rt.registry.get('walk_to')!.plan(rt, params);
      assert.equal(speculative.ok, false);
      if (!speculative.ok)
        assert.equal(speculative.diagnostic.code, 'route.start-blocked');
      const direction = rt.submit('walk_to', params);
      assert.equal(direction.status, 'requested');
      assert.equal(direction.phase, 'pre-empting');
      until(
        rt,
        () =>
          !rt.isActive(direction.id) &&
          readReadingCircle(rt, a.id)?.mode === 'waiting',
      );
      assert.equal(
        direction.status,
        'completed',
        direction.diagnostic?.message,
      );
      const after = readBook(rt, 'book');
      assert.ok(!('code' in after));
      assert.equal(after.elapsed, before.elapsed);
      assert.equal(after.status, 'unfinished');
      assert.deepEqual(rt.world.entities.reader.pose.p, [
        target[0],
        0,
        target[1],
      ]);
      assert.deepEqual(
        {
          pose: rt.world.entities.book.pose,
          support: rt.world.entities.book.support,
        },
        physical,
      );
      assert.deepEqual(rt.holder('slot:reading-chair#seat'), []);
      rt.submit('reading_circle_control', {
        session: a.id,
        intent: { kind: 'resume' },
      });
      until(rt, () => !rt.isActive(a.id));
      const finished = readBook(rt, 'book');
      assert.ok(!('code' in finished));
      assert.equal(finished.elapsed, 12);
      assert.deepEqual(rt.holder('actor:reader'), []);
    });
for (const yaw of [0, Math.PI / 2])
  test(`infeasible directed destination still refuses after supported release at ${yaw}`, () => {
    const { rt, a } = setup(yaw, 'discussion'),
      before = readBook(rt, 'book');
    assert.ok(!('code' in before));
    const direction = rt.submit('walk_to', { actor: 'reader', x: 99, z: 99 });
    assert.equal(direction.status, 'requested');
    assert.equal(direction.phase, 'pre-empting');
    until(
      rt,
      () =>
        !rt.isActive(direction.id) &&
        readReadingCircle(rt, a.id)?.mode === 'waiting',
    );
    assert.equal(direction.status, 'failed');
    assert.match(direction.diagnostic?.code ?? '', /^route\./);
    const after = readBook(rt, 'book');
    assert.ok(!('code' in after));
    assert.equal(after.elapsed, before.elapsed);
    assert.notDeepEqual(rt.world.entities.reader.pose.p, [99, 0, 99]);
    assert.deepEqual(rt.holder('slot:reading-chair#seat'), []);
    assert.deepEqual(rt.holder('actor:reader'), []);
    rt.submit('reading_circle_control', {
      session: a.id,
      intent: { kind: 'end' },
    });
    until(rt, () => !rt.isActive(a.id));
  });
