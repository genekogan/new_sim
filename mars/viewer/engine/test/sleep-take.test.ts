// Real supported lie/wake execution records semantic pose, not a synthetic rig probe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from '../runtime/runtime.ts';
import { createRegistry, ENGINE_INVARIANTS, servicesFor } from '../api/registry.ts';
import { groundSleepFixture } from '../scenarios/sleep.ts';
import { TakeRecorder } from '../take/recorder.ts';
import { sampleTake, replayFinalState } from '../take/replay.ts';
import { hashOf } from '../core/hash.ts';
for (const yaw of [0, 0.63]) test(`supported sleep semantic take/replay and cleanup yaw=${yaw}`, () => {
  const f = groundSleepFixture([0,0], yaw);
  const rt = new Runtime(f.world, createRegistry(), servicesFor({ 'ground-sleep': f.scene })(f.world), ENGINE_INVARIANTS);
  const rec = new TakeRecorder(rt, { rulesVersion: 'sleep-regression' });
  const action = rt.submit('sleep', f.p);
  assert.notEqual(action.status, 'failed', action.diagnostic?.message);
  const observed: { tick: number; pose: unknown }[] = [];
  for (let n=0; n<2000 && rt.isActive(action.id); n++) {
    rt.step();
    const pose = rt.world.entities.sleeper.human!.sleepPose;
    if (pose) observed.push({ tick: rt.tick, pose: structuredClone(pose) });
  }
  assert.equal(action.status, 'completed');
  assert.deepEqual(rt.violations, []);
  assert.ok(observed.some(s => (s.pose as { standingFraction: number }).standingFraction === 0));
  assert.ok(observed.some(s => { const v=(s.pose as { standingFraction: number }).standingFraction; return v>0 && v<1; }));
  const take = rec.finish();
  for (const s of observed) assert.deepEqual(sampleTake(take, (s.tick+0.25)*take.dt).entities.sleeper.state.sleepPose, s.pose);
  assert.equal(take.changes.some(c => c[1]==='visitor' && c[2]==='sleepPose'), false);
  assert.ok(take.changes.some(c => c[1]==='sleeper' && c[2]==='sleepPose' && c[3]===null));
  assert.equal(rt.world.entities.sleeper.human!.sleepPose, undefined);
  assert.equal(hashOf(replayFinalState(take)), take.finalStateHash);
  assert.deepEqual(rt.holder('actor:sleeper'), []);
  assert.deepEqual(rt.holder('sleep-mat:mat'), []);
});
