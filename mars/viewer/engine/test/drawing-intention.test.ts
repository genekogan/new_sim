import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  drawingWorkRuntime,
  drawingWorkParams,
} from '../scenarios/drawing-work.ts';
import { readDrawing } from '../objects/drawing.ts';
import { readLivingIntention } from '../activities/living-intention.ts';
import type { Runtime } from '../runtime/runtime.ts';
function until(rt: Runtime, done: () => boolean) {
  for (let i = 0; i < 5000 && !done(); i++) {
    rt.step();
    assert.deepEqual(rt.violations, []);
  }
  assert.ok(done());
}
test('an authored sketch purpose retains exact partial marks through a digression and return', () => {
  const rt = drawingWorkRuntime(),
    params = drawingWorkParams(),
    r = rt.submit('living_intention', {
      actor: params.actor,
      objectives: [
        {
          purpose: 'study',
          label: 'First sketch block',
          sliceSeconds: 3,
          alternatives: [{ verb: 'drawing_work', params }],
        },
        {
          purpose: 'courtyard',
          label: 'Courtyard digression',
          alternatives: [
            { verb: 'walk_to', params: { actor: params.actor, x: 4, z: 3 } },
          ],
        },
        {
          purpose: 'study',
          label: 'Finish the same shelter study',
          alternatives: [{ verb: 'drawing_work', params }],
        },
      ],
    });
  assert.notEqual(r.status, 'failed', r.diagnostic?.message);
  until(rt, () => readLivingIntention(rt, r.id)?.purpose === 'courtyard');
  const partial = readDrawing(rt, params.pad);
  assert.ok(!('code' in partial));
  assert.equal(partial.status, 'unfinished');
  assert.equal(partial.ticks, 60);
  assert.equal(partial.completedMarks.length, 3);
  until(rt, () => !rt.isActive(r.id));
  assert.equal(r.status, 'completed');
  const complete = readDrawing(rt, params.pad);
  assert.ok(!('code' in complete));
  assert.equal(complete.status, 'completed');
  assert.equal(complete.ticks, 160);
  assert.equal(complete.pencil, partial.pencil);
  assert.equal(complete.user, partial.user);
  assert.equal(rt.world.entities[params.pencil].support?.kind, 'resting-on');
  assert.ok([...rt.records.values()].every((a) => !rt.isActive(a.id)));
});
test('player direction pauses the stable sketch purpose and explicit Resume continues it', () => {
  const rt = drawingWorkRuntime(),
    params = drawingWorkParams(),
    r = rt.submit('living_intention', {
      actor: params.actor,
      objectives: [
        {
          purpose: 'study',
          label: 'Shelter study',
          alternatives: [{ verb: 'drawing_work', params }],
        },
      ],
    });
  until(rt, () => {
    const s = readDrawing(rt, params.pad);
    return !('code' in s) && s.ticks >= 31;
  });
  const walk = rt.submit('walk_to', { actor: params.actor, x: 4, z: 3 });
  until(
    rt,
    () =>
      walk.status === 'completed' &&
      readLivingIntention(rt, r.id)?.mode === 'paused',
  );
  const partial = readDrawing(rt, params.pad);
  assert.ok(!('code' in partial));
  assert.equal(partial.status, 'unfinished');
  assert.ok(partial.ticks < 160);
  const control = rt.submit('living_intention_control', {
    intention: r.id,
    intent: 'resume',
  });
  assert.notEqual(control.status, 'failed', control.diagnostic?.message);
  until(rt, () => !rt.isActive(r.id));
  assert.equal(r.status, 'completed');
  const complete = readDrawing(rt, params.pad);
  assert.ok(!('code' in complete));
  assert.equal(complete.ticks, 160);
});
