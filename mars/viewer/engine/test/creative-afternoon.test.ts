import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  creativeAfternoonRuntime,
  startCreativeAfternoon,
  tickCreativeAfternoon,
  readCreativeAfternoon,
  controlCreativeAfternoon,
} from '../scenarios/creative-afternoon.ts';
import { readDrawing } from '../objects/drawing.ts';
import { readBook } from '../objects/reading.ts';
import { readGarden } from '../objects/garden.ts';
import { hashOf } from '../core/hash.ts';
import type { Runtime } from '../runtime/runtime.ts';
function until(rt: Runtime, done: () => boolean, limit = 6000) {
  for (let n = 0; n < limit && !done(); n++) {
    rt.step();
    tickCreativeAfternoon(rt);
    assert.deepEqual(rt.violations, []);
  }
  assert.ok(
    done(),
    JSON.stringify({
      stage: readCreativeAfternoon(rt)?.phase,
      active: [...rt.records.values()]
        .filter((r) => rt.isActive(r.id))
        .map((r) => ({
          verb: r.verb,
          phase: r.phase,
          code: r.diagnostic?.code,
        })),
    }),
  );
}
test('produce, share and finish the same actual drawing alongside independent reading and care', () => {
  const rt = creativeAfternoonRuntime(),
    ids = Object.keys(rt.world.entities).sort(),
    pad = structuredClone(rt.world.entities['sketch-pad']);
  const started = startCreativeAfternoon(rt);
  assert.ok(!('code' in started));
  assert.notEqual(started.status, 'failed', started.diagnostic?.message);
  until(rt, () => readCreativeAfternoon(rt)?.phase === 'sharing');
  const partial = readDrawing(rt, 'sketch-pad');
  assert.ok(!('code' in partial));
  assert.equal(partial.ticks, 60);
  assert.equal(partial.completedMarks.length, 3);
  until(rt, () => readCreativeAfternoon(rt)?.phase === 'music');
  assert.deepEqual(rt.world.entities['sketch-pad'].pose, pad.pose);
  assert.deepEqual(rt.world.entities['sketch-pad'].support, pad.support);
  until(rt, () => readCreativeAfternoon(rt)?.phase === 'completed');
  const complete = readDrawing(rt, 'sketch-pad');
  assert.ok(!('code' in complete));
  assert.equal(complete.ticks, 160);
  assert.equal(complete.pencil, partial.pencil);
  assert.equal(complete.user, partial.user);
  const book = readBook(rt, 'book');
  assert.ok(!('code' in book));
  assert.equal(book.status, 'completed');
  assert.equal(book.elapsed, 20);
  const cared = readGarden(rt, 'plant-a');
  assert.ok(!('code' in cared));
  assert.equal(cared.cycles, 1);
  assert.deepEqual(Object.keys(rt.world.entities).sort(), ids);
  assert.ok([...rt.records.values()].every((r) => !rt.isActive(r.id)));
});
test('player direction pauses only the unfinished sketch; Resume completes the combined afternoon', () => {
  const rt = creativeAfternoonRuntime();
  startCreativeAfternoon(rt);
  until(rt, () => {
    const d = readDrawing(rt, 'sketch-pad');
    return !('code' in d) && d.ticks === 29;
  });
  const r = rt.submit('walk_to', { actor: 'sketcher', x: 4, z: -5 });
  until(
    rt,
    () =>
      r.status === 'completed' &&
      readCreativeAfternoon(rt)?.intention?.mode === 'paused',
  );
  const saved = readDrawing(rt, 'sketch-pad');
  assert.ok(!('code' in saved));
  assert.equal(saved.status, 'unfinished');
  const resume = controlCreativeAfternoon(rt, 'resume');
  assert.ok(!('code' in resume));
  assert.notEqual(resume.status, 'failed', resume.diagnostic?.message);
  until(rt, () => readCreativeAfternoon(rt)?.phase === 'completed');
});
for (const phase of ['sharing', 'music'] as const)
  test(`${phase} Pause/Resume retains child identity and final artwork`, () => {
    const rt = creativeAfternoonRuntime();
    startCreativeAfternoon(rt);
    until(
      rt,
      () =>
        readCreativeAfternoon(rt)?.phase === phase &&
        (phase === 'sharing'
          ? readCreativeAfternoon(rt)?.sharing?.mode === 'sharing'
          : readCreativeAfternoon(rt)?.jam?.mode === 'playing'),
    );
    const id = readCreativeAfternoon(rt)!.current;
    const p = controlCreativeAfternoon(rt, 'pause');
    assert.ok(!('code' in p));
    assert.notEqual(p.status, 'failed', p.diagnostic?.message);
    until(rt, () =>
      phase === 'sharing'
        ? readCreativeAfternoon(rt)?.sharing?.mode === 'paused'
        : readCreativeAfternoon(rt)?.jam?.mode === 'paused',
    );
    for (let i = 0; i < 20; i++) {
      rt.step();
      tickCreativeAfternoon(rt);
      assert.deepEqual(rt.violations, []);
    }
    assert.equal(readCreativeAfternoon(rt)?.current, id);
    const r = controlCreativeAfternoon(rt, 'resume');
    assert.ok(!('code' in r));
    assert.notEqual(r.status, 'failed', r.diagnostic?.message);
    until(rt, () => readCreativeAfternoon(rt)?.phase === 'completed');
  });
test('End drains safely without replacement props or discarded marks', () => {
  const rt = creativeAfternoonRuntime();
  startCreativeAfternoon(rt);
  until(rt, () => readCreativeAfternoon(rt)?.phase === 'sharing');
  const d = readDrawing(rt, 'sketch-pad'),
    ids = Object.keys(rt.world.entities).sort();
  controlCreativeAfternoon(rt, 'end');
  until(rt, () => readCreativeAfternoon(rt)?.phase === 'ended');
  assert.deepEqual(readDrawing(rt, 'sketch-pad'), d);
  assert.deepEqual(Object.keys(rt.world.entities).sort(), ids);
  assert.ok([...rt.records.values()].every((r) => !rt.isActive(r.id)));
});
test('recorded afternoon decisions produce the same deterministic world', () => {
  function run() {
    const rt = creativeAfternoonRuntime();
    startCreativeAfternoon(rt);
    until(rt, () => readCreativeAfternoon(rt)?.phase === 'completed');
    return hashOf(rt.world);
  }
  assert.equal(run(), run());
});
test('unstarted or repeated afternoon control gives useful refusal', () => {
  const rt = creativeAfternoonRuntime();
  assert.equal(
    (controlCreativeAfternoon(rt, 'resume') as { code: string }).code,
    'afternoon.inactive',
  );
  startCreativeAfternoon(rt);
  assert.equal(
    (startCreativeAfternoon(rt) as { code: string }).code,
    'afternoon.already-started',
  );
});
test('an occupied artwork viewing place waits without cancelling its owner or spawning failed circles', () => {
  const rt = creativeAfternoonRuntime();
  const owner = rt.submit('take_slot', {
    actor: 'art-visitor3',
    slot: 'art-left#r1c0',
    activity: 'listen',
  });
  until(rt, () => owner.phase === 'occupied');
  startCreativeAfternoon(rt);
  until(rt, () => !!readCreativeAfternoon(rt)?.diagnostic);
  const day = readCreativeAfternoon(rt)!;
  assert.equal(day.phase, 'sketch');
  assert.ok(rt.isActive(owner.id));
  assert.equal(
    [...rt.records.values()].filter((r) => r.verb === 'art_sharing').length,
    0,
  );
  for (let n = 0; n < 50; n++) {
    rt.step();
    tickCreativeAfternoon(rt);
    assert.deepEqual(rt.violations, []);
  }
  rt.cancel(owner.id);
  until(rt, () => !rt.isActive(owner.id));
  // Releasing a logical slot does not remove the real body from its place.
  const exit = rt.submit('walk_to', { actor: 'art-visitor3', x: 6, z: -6 });
  until(rt, () => exit.status === 'completed');
  until(rt, () => readCreativeAfternoon(rt)?.phase === 'completed');
});
test('unavailable music equipment retains the partial artwork and retries only its permitted binding', () => {
  const rt = creativeAfternoonRuntime();
  rt.world.entities['music-computer'].equipment = {
    kind: 'workstation',
    config: { available: false },
  };
  startCreativeAfternoon(rt);
  until(rt, () => readCreativeAfternoon(rt)?.phase === 'sharing');
  until(rt, () => !!readCreativeAfternoon(rt)?.diagnostic);
  assert.equal(readCreativeAfternoon(rt)?.phase, 'sharing');
  assert.equal(
    [...rt.records.values()].filter((r) => r.verb === 'open_jam').length,
    0,
  );
  const d = readDrawing(rt, 'sketch-pad');
  assert.ok(!('code' in d));
  assert.equal(d.ticks, 60);
  rt.world.entities['music-computer'].equipment!.config.available = true;
  until(rt, () => readCreativeAfternoon(rt)?.phase === 'completed');
});
