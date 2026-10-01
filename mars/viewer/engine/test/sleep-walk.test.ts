// Source-only integration regressions authored 2026-10-01; execution awaits
// the root's serial validation slot. Uses the production registry/invariants.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Runtime, DT } from '../runtime/runtime.ts';
import { createRegistry, servicesFor, ENGINE_INVARIANTS } from '../api/registry.ts';
import { supportedSleepSafety } from '../runtime/invariants.ts';
import { groundSleepFixture } from '../scenarios/sleep.ts';
import { gapToSleep, readSleep, sleepEnvelope, sleepSafetyIssue, SLEEP_BODY_MARGIN } from '../activities/sleep.ts';
import { HUMAN_PROFILE } from '../spatial/types.ts';
import type { Spatial } from '../spatial/service.ts';
import { WALK_SPEED_CAP } from '../locomotion/walk.ts';
import { dist2, heading, rot2, sub2, type Vec2 } from '../core/math.ts';

function setup(yaw: number, visitor: Vec2, to: Vec2) {
  const f = groundSleepFixture([0, 0], yaw);
  f.world.entities.visitor.pose = { p: [visitor[0], 0, visitor[1]], yaw: heading(sub2(to, visitor)) };
  f.world.entities.sleeper.pose = { p: [f.anchor[0], 0, f.anchor[1]], yaw };
  f.p.duration = 600; delete f.p.returnTo;
  const rt = new Runtime(f.world, createRegistry(), servicesFor({ 'ground-sleep': f.scene })(f.world), ENGINE_INVARIANTS);
  return { ...f, rt };
}
function until(rt: Runtime, done: () => boolean, max = 3000) {
  for (let i = 0; i < max && !done(); i++) rt.step();
  assert.ok(done(), JSON.stringify([...rt.records.values()]));
  assert.deepEqual(rt.violations, []);
}
function beginSleep(rt: Runtime, p: ReturnType<typeof groundSleepFixture>['p']) {
  const rec = rt.submit('sleep', p, { preempt: false });
  assert.notEqual(rec.status, 'failed', rec.diagnostic?.message);
  until(rt, () => readSleep(rt, rec.id)?.mode === 'sleeping');
  return rec;
}
function endSleep(rt: Runtime, id: string) {
  const control = rt.submit('sleep_control', { sleep: id, intent: 'end' });
  assert.notEqual(control.status, 'failed', control.diagnostic?.message);
  until(rt, () => !rt.isActive(id));
  const h = rt.world.entities.sleeper.human!;
  assert.equal(h.sleepPose, undefined); assert.equal(h.task, undefined); assert.equal(h.speed, undefined);
  for (const resource of ['actor:sleeper', 'sleep-mat:mat', 'sleep-purpose:sleeper']) assert.deepEqual(rt.holder(resource), []);
  for (const record of rt.records.values()) if (record.parent === id || record.verb === 'sleep_on_mat') assert.equal(rt.isActive(record.id), false);
}
function trackVisitor(rt: Runtime) {
  let previous: Vec2 = [rt.world.entities.visitor.pose.p[0], rt.world.entities.visitor.pose.p[2]];
  let minimum = Infinity;
  rt.observers.push({ onTick() {
    const e = rt.world.entities.visitor, p: Vec2 = [e.pose.p[0], e.pose.p[2]];
    assert.ok(dist2(p, previous) <= WALK_SPEED_CAP * DT + 1e-6, 'ordinary mover retains its step budget');
    previous = p;
    const gap = gapToSleep(rt.world.entities.sleeper, p);
    if (gap !== null) {
      minimum = Math.min(minimum, gap);
      assert.ok(gap > HUMAN_PROFILE.radius + SLEEP_BODY_MARGIN - 1e-7, `visitor overlaps full sleep body at gap ${gap}`);
    }
  } });
  return () => minimum;
}

for (const yaw of [0, Math.PI / 2, 0.63]) {
  for (const forward of [-1.25, 1.25]) test(`ordinary walker passes ${forward < 0 ? 'feet' : 'head'} outside old disc at yaw ${yaw}`, () => {
    const from = rot2([forward, -3], yaw), to = rot2([forward, 3], yaw);
    const { rt, p } = setup(yaw, from, to), sleep = beginSleep(rt, p);
    const minimum = trackVisitor(rt);
    const walk = rt.submit('walk_to', { actor: 'visitor', x: to[0], z: to[1], level: 0 });
    assert.notEqual(walk.status, 'failed', walk.diagnostic?.message);
    until(rt, () => !rt.isActive(walk.id));
    assert.equal(walk.status, 'completed', walk.diagnostic?.message);
    assert.ok(dist2([rt.world.entities.visitor.pose.p[0], rt.world.entities.visitor.pose.p[2]], to) < 0.03);
    assert.ok(Number.isFinite(minimum()));
    assert.equal(walk.outputs?.pushes, 0, 'look-ahead stops smoothly before contact, without hard-layer cancelled steps');
    assert.equal(readSleep(rt, sleep.id)?.mode, 'sleeping');
    endSleep(rt, sleep.id);
  });

  test(`rotated corner route stays clear at yaw ${yaw}`, () => {
    // Both endpoints are clear; the direct segment cuts through the expanded
    // head/right corner, requiring ordinary steering or OBB rerouting.
    const from = rot2([2.5, -0.5], yaw), to = rot2([0.5, 2.5], yaw);
    const { rt, p } = setup(yaw, from, to), sleep = beginSleep(rt, p);
    trackVisitor(rt);
    const walk = rt.submit('walk_to', { actor: 'visitor', x: to[0], z: to[1] });
    assert.notEqual(walk.status, 'failed', walk.diagnostic?.message);
    until(rt, () => !rt.isActive(walk.id));
    assert.equal(walk.status, 'completed', walk.diagnostic?.message);
    assert.equal(walk.outputs?.pushes, 0);
    endSleep(rt, sleep.id);
  });

  test(`destination inside head volume refuses without acquiring visitor at yaw ${yaw}`, () => {
    const from = rot2([1.25, -3], yaw), to = rot2([1.25, 0], yaw);
    const { rt, p } = setup(yaw, from, to), sleep = beginSleep(rt, p);
    const before = structuredClone(rt.world.entities.visitor);
    const walk = rt.submit('walk_to', { actor: 'visitor', x: to[0], z: to[1] });
    assert.equal(walk.status, 'failed'); assert.equal(walk.diagnostic?.code, 'walk.goal-occupied');
    assert.deepEqual(rt.world.entities.visitor, before); assert.deepEqual(rt.holder('actor:visitor'), []);
    endSleep(rt, sleep.id);
  });

  test(`mat activates after route planning, then walker safely recovers at yaw ${yaw}`, () => {
    const from = rot2([-1.25, -5], yaw), to = rot2([-1.25, 3], yaw);
    const { rt, p } = setup(yaw, from, to);
    const walk = rt.submit('walk_to', { actor: 'visitor', x: to[0], z: to[1] });
    assert.notEqual(walk.status, 'failed', walk.diagnostic?.message);
    trackVisitor(rt);
    const sleep = beginSleep(rt, p);
    until(rt, () => !rt.isActive(walk.id));
    assert.equal(walk.status, 'completed', walk.diagnostic?.message);
    assert.equal(walk.outputs?.pushes, 0);
    endSleep(rt, sleep.id);
  });
}

test('temporary sleep rectangle is never squeezed or cached as the old standing disc', () => {
  const { rt, p } = setup(0.63, [6, 4], [6, 5]), sleep = beginSleep(rt, p);
  const sp = rt.services.spatial as Spatial, sleeper = rt.world.entities.sleeper;
  const around = [{ id: sleeper.id, p: [sleeper.pose.p[0], sleeper.pose.p[2]] as Vec2, half: 0.01 }];
  const lying = sp.gridsAround(rt.world, around);
  const envelope = sleepEnvelope(sleeper)!;
  assert.deepEqual(lying.scene.obstacles.find(o => o.id === sleeper.id)?.obb, {
    ...envelope, half: [envelope.half[0] + SLEEP_BODY_MARGIN, envelope.half[1] + SLEEP_BODY_MARGIN],
  });
  assert.equal(sp.scene.obstacles.some(o => o.id === sleeper.id), false, 'no static self obstacle');
  endSleep(rt, sleep.id);
  const standing = sp.gridsAround(rt.world, around);
  assert.notEqual(standing, lying);
  assert.deepEqual(standing.scene.obstacles.find(o => o.id === sleeper.id)?.obb.half, [0.01, 0.01]);
  assert.equal(sp.gridsAround(rt.world, around), standing, 'bounded existing cache can reuse the upright state');
});

test('read-only sleep invariant rejects invalid progress, missing active owner and changed mat binding', () => {
  const { rt, p } = setup(0, [6, 4], [6, 5]), sleep = beginSleep(rt, p);
  const e = rt.world.entities.sleeper, h = e.human!, original = structuredClone(h);
  const worldBefore = rt.stateHash();
  assert.deepEqual(supportedSleepSafety(rt), []); assert.equal(rt.stateHash(), worldBefore);
  for (const invalid of [NaN, Infinity, -0.01, 1.01]) {
    h.sleepPose!.standingFraction = invalid;
    assert.equal(sleepSafetyIssue(rt, e)?.code, 'sleep.pose-range');
  }
  h.sleepPose = structuredClone(original.sleepPose);
  h.task = 'missing'; assert.equal(sleepSafetyIssue(rt, e)?.code, 'sleep.ownership');
  h.task = original.task;
  h.sleepPose!.mat = 'foreign-mat'; assert.equal(sleepSafetyIssue(rt, e)?.code, 'sleep.ownership');
  h.sleepPose = structuredClone(original.sleepPose);
  assert.equal(sleepSafetyIssue(rt, e), undefined);
  endSleep(rt, sleep.id);
});

test('late occupied destination waits at full body boundary and cancellation releases visitor', () => {
  const from: Vec2 = [1.25, -5], to: Vec2 = [1.25, 0];
  const { rt, p } = setup(0, from, to);
  const walk = rt.submit('walk_to', { actor: 'visitor', x: to[0], z: to[1] });
  trackVisitor(rt);
  const sleep = beginSleep(rt, p);
  until(rt, () => walk.status === 'blocked' && walk.diagnostic?.code === 'walk.goal-occupied');
  const held = structuredClone(rt.world.entities.sleeper.human!.sleepPose);
  rt.cancel(walk.id); until(rt, () => !rt.isActive(walk.id));
  assert.equal(walk.status, 'cancelled'); assert.deepEqual(rt.holder('actor:visitor'), []);
  assert.deepEqual(rt.world.entities.sleeper.human!.sleepPose, held);
  endSleep(rt, sleep.id);
});
