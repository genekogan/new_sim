// LM-012 deterministic regression proxy; synthetic world, not the parked historical D2 take.
import test from 'node:test';
import assert from 'node:assert/strict';
import { directCamera } from '../camera/synth.ts';
import { personAt, yardScene } from './camera-direct-fixtures.ts';

test('synthetic long lead-in never samples take subjects before the directed shot', () => {
  const { scene, world } = yardScene();
  const run = (at: number) => {
    const times: number[] = [];
    const result = directCamera([{ subject: { kind: 'group', ref: 'talk' }, motion: { verb: 'hold' }, at, duration: 20 }], {
      scene, world, duration: at + 20, facts: () => ({ p1: { task: 'talk', activity: 'talk' } }),
      sampler: (t) => { times.push(t); return { p1: personAt([0, 0, 0]) }; },
    });
    assert.ok(result.ok, JSON.stringify(result));
    assert.ok(times.length > 0);
    assert.ok(times.every((t) => t >= at), 'fixed subject-free lead-in makes zero sampler calls');
    return { count: times.length, samples: result.plan.samples.length };
  };
  const short = run(0), long = run(2728.8);
  assert.equal(long.count, short.count, 'sampling work depends on the directed shot, not the lead-in length');
  assert.ok(long.samples > short.samples + 27000, 'the long result still contains the complete lead-in track');
});
