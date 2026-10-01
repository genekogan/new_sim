import test from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from '../runtime/runtime.ts';
import { createRegistry, servicesFor, ENGINE_INVARIANTS } from '../api/registry.ts';
import { SLEEP_BODY_MARGIN, readSleep, sleepEnvelope, bodyEnvelope, gapToSleep, gapToSleepEnvelope, sleepSafetyIssue, type SleepPose } from '../activities/sleep.ts';
import { groundSleepFixture } from '../scenarios/sleep.ts';
import { itemEntity } from '../items/model.ts';
import { human } from '../world/factory.ts';
import { dist2, obbOverlap, add2, rot2 } from '../core/math.ts';
import { HUMAN_PROFILE } from '../spatial/types.ts';
import { sleepGoal, sleepHands } from '../../app/engine-view/sleep.ts';
import type { Dims } from '../../app/engine-view/posture.ts';

function setup(yaw = 0) {
  const fixture = groundSleepFixture([0, 0], yaw);
  const rt = new Runtime(fixture.world, createRegistry(), servicesFor({ 'ground-sleep': fixture.scene })(fixture.world), ENGINE_INVARIANTS);
  return { ...fixture, rt };
}
function until(rt: Runtime, done: () => boolean, max = 2000, expectedCodes: string[] = []) {
  for (let n = 0; n < max && !done(); n++) rt.step();
  assert.ok(done(), JSON.stringify([...rt.records.values()]));
  if (expectedCodes.length) assert.ok(rt.violations.every(v => expectedCodes.includes(v.code)), JSON.stringify(rt.violations));
  else assert.deepEqual(rt.violations, []);
}
function start(rt: Runtime, p: unknown) { const r = rt.submit('sleep', p, { preempt: false }); assert.notEqual(r.status, 'failed', r.diagnostic?.message); return r; }
function control(rt: Runtime, id: string, intent: 'pause' | 'resume' | 'end') {
  const r = rt.submit('sleep_control', { sleep: id, intent }); assert.notEqual(r.status, 'failed', r.diagnostic?.message); return r;
}
function pose(rt: Runtime): SleepPose | undefined { return (rt.world.entities.sleeper.human as { sleepPose?: SleepPose }).sleepPose; }
function clean(rt: Runtime, id: string) {
  assert.deepEqual(rt.holder('actor:sleeper'), []); assert.deepEqual(rt.holder('sleep-mat:mat'), []);
  assert.deepEqual(rt.holder('sleep-purpose:sleeper'), []); assert.equal(pose(rt), undefined);
  assert.equal(rt.world.entities.sleeper.human!.task, undefined);
  for (const child of readSleep(rt, id)!.ownedActions) assert.equal(rt.isActive(child), false);
}
for (const yaw of [0, Math.PI / 2, 0.63]) test(`ground sleep at yaw ${yaw} walks, lies, sleeps, wakes and physically returns`, () => {
  const { rt, p, anchor } = setup(yaw), rec = start(rt, p);
  let lying = 0, sleeping = 0, waking = 0, lastFraction = 1;
  until(rt, () => {
    const h = rt.world.entities.sleeper.human!, state = pose(rt);
    if (state) {
      assert.ok(dist2([rt.world.entities.sleeper.pose.p[0], rt.world.entities.sleeper.pose.p[2]], anchor) < 0.03);
      assert.equal(rt.world.entities.sleeper.pose.p[1], 0); assert.equal(h.level, 0);
      assert.deepEqual(h.hands, undefined); assert.deepEqual(rt.holder('sleep-mat:mat').length, 1);
      assert.ok(state.standingFraction >= 0 && state.standingFraction <= 1);
      assert.equal('rise' in state, false, 'engine posture remains normalized and independent of prone rig coordinates');
      assert.ok(Math.abs(state.standingFraction - lastFraction) <= 0.05 / 2.1 + 1e-7); lastFraction = state.standingFraction;
      if (h.activity === 'sleep-lie-down') lying++;
      if (h.activity === 'sleep') { sleeping++; assert.equal(state.standingFraction, 0); }
      if (h.activity === 'sleep-wake-up') waking++;
    }
    return !rt.isActive(rec.id);
  });
  assert.equal(rec.status, 'completed'); assert.ok(lying > 30 && sleeping > 40 && waking > 30);
  assert.ok(dist2([rt.world.entities.sleeper.pose.p[0], rt.world.entities.sleeper.pose.p[2]], p.returnTo!) < 0.03);
  assert.equal(readSleep(rt, rec.id)!.elapsed, p.duration); assert.equal(rec.outputs!.returned, true); clean(rt, rec.id);
});
for (const invalid of ['missing', 'small', 'skewed', 'level', 'no-floor', 'wall', 'head-blocked', 'other-person', 'held', 'foreign']) test(`${invalid} mat admission refuses before owned effects`, () => {
  const { rt, p, scene } = setup();
  if (invalid === 'missing') p.mat = 'missing';
  if (invalid === 'small') rt.world.regions.mat.polygon = [[-1, -.7], [1, -.7], [1, .7], [-1, .7]];
  if (invalid === 'skewed') rt.world.regions.mat.polygon[2][0] += 0.1;
  if (invalid === 'level') rt.world.regions.mat.level = 1;
  if (invalid === 'no-floor') scene.surfaces[0].obb.half = [0.5, 0.5];
  if (invalid === 'wall' || invalid === 'head-blocked') scene.obstacles.push({ id: 'mat-blocker', obb: { c: [invalid === 'head-blocked' ? 1.3 : 0, 0], half: [0.1, 0.1], yaw: 0 }, y0: 0, y1: 2 });
  if (invalid === 'other-person') rt.world.entities.visitor.pose.p = [-1.1, 0, 0];
  if (invalid === 'held') { const bowl = itemEntity('bowl', 'bowl', [-5, 1, -3]); bowl.support = { kind: 'in-hand', by: 'sleeper', hand: 'left' }; rt.world.entities.bowl = bowl; }
  if (invalid === 'foreign') rt.submit('walk_to', { actor: 'sleeper', x: -8, z: -3 });
  const before = rt.stateHash(), r = rt.submit('sleep', p, { preempt: false });
  assert.equal(r.status, 'failed'); assert.match(r.diagnostic!.code, /^sleep\./); assert.equal(rt.stateHash(), before);
  assert.equal([...rt.records.values()].some(child => child.parent === r.id), false);
  assert.deepEqual(rt.holder('sleep-purpose:sleeper'), []); assert.deepEqual(rt.holder('sleep-mat:mat'), []);
});
test('occupied mat refuses a second sleeper and holds exclusive ownership through waking', () => {
  const { rt, p } = setup(), rec = start(rt, p);
  until(rt, () => readSleep(rt, rec.id)!.mode === 'sleeping');
  rt.world.entities.second = human('second', 7, -3);
  const rejected = rt.submit('sleep', { ...p, actor: 'second' }, { preempt: false });
  assert.equal(rejected.status, 'failed'); assert.match(rejected.diagnostic!.code, /^sleep\.(occupied|reserved)$/);
  control(rt, rec.id, 'end'); rt.step(); assert.ok(rt.holder('actor:sleeper').length); assert.ok(rt.holder('sleep-mat:mat').length);
  until(rt, () => !rt.isActive(rec.id)); clean(rt, rec.id);
});
for (const phase of ['lying-down', 'sleeping', 'waking', 'returning'] as const) test(`Pause in ${phase} wakes continuously, frees the mat and resumes only unfinished sleep/return`, () => {
  const { rt, p } = setup(), rec = start(rt, p);
  until(rt, () => readSleep(rt, rec.id)!.mode === phase);
  if (phase === 'sleeping') for (let i = 0; i < 12; i++) rt.step();
  const elapsed = readSleep(rt, rec.id)!.elapsed;
  control(rt, rec.id, 'pause'); until(rt, () => readSleep(rt, rec.id)!.mode === 'paused');
  assert.equal(readSleep(rt, rec.id)!.elapsed, elapsed); assert.equal(pose(rt), undefined);
  assert.deepEqual(rt.holder('actor:sleeper'), []); assert.deepEqual(rt.holder('sleep-mat:mat'), []);
  assert.deepEqual(readSleep(rt, rec.id)!.bindings.returnTo, p.returnTo);
  control(rt, rec.id, 'resume'); until(rt, () => !rt.isActive(rec.id));
  assert.equal(rec.status, 'completed'); assert.equal(readSleep(rt, rec.id)!.elapsed, p.duration); clean(rt, rec.id);
});
test('director movement waits for wake, then owns actor; unfinished rest/return needs explicit Resume', () => {
  const { rt, p } = setup(), rec = start(rt, p);
  until(rt, () => readSleep(rt, rec.id)!.mode === 'sleeping');
  for (let i = 0; i < 15; i++) rt.step();
  const elapsed = readSleep(rt, rec.id)!.elapsed, at = structuredClone(rt.world.entities.sleeper.pose.p);
  const walk = rt.submit('walk_to', { actor: 'sleeper', x: 4, z: -3 });
  assert.equal(walk.status, 'requested'); assert.ok(pose(rt));
  for (let i = 0; i < 20; i++) { rt.step(); assert.deepEqual(rt.world.entities.sleeper.pose.p, at); }
  until(rt, () => !rt.isActive(walk.id));
  until(rt, () => readSleep(rt, rec.id)!.mode === 'waiting');
  assert.equal(readSleep(rt, rec.id)!.elapsed, elapsed); assert.equal(pose(rt), undefined);
  control(rt, rec.id, 'resume'); until(rt, () => !rt.isActive(rec.id)); assert.equal(rec.status, 'completed'); clean(rt, rec.id);
});
test('End during approach cancels the actual child without stranding actor or mat leases', () => {
  const { rt, p } = setup(), rec = start(rt, p); rt.step(); rt.step(); control(rt, rec.id, 'end');
  until(rt, () => !rt.isActive(rec.id)); assert.equal(rec.status, 'cancelled'); clean(rt, rec.id);
});
test('Resume refuses a newly obstructed mat while retaining unfinished sleep and no physical leases', () => {
  const { rt, p } = setup(), rec = start(rt, p);
  until(rt, () => readSleep(rt, rec.id)!.elapsed >= .6);
  control(rt, rec.id, 'pause'); until(rt, () => readSleep(rt, rec.id)!.mode === 'paused');
  const elapsed = readSleep(rt, rec.id)!.elapsed;
  rt.world.entities.visitor.pose.p = [-1.3, 0, 0];
  const rejected = rt.submit('sleep_control', { sleep: rec.id, intent: 'resume' });
  assert.equal(rejected.status, 'failed'); assert.equal(rejected.diagnostic!.code, 'sleep.occupied');
  assert.equal(readSleep(rt, rec.id)!.elapsed, elapsed); assert.deepEqual(rt.holder('actor:sleeper'), []);
  assert.deepEqual(rt.holder('sleep-mat:mat'), []);
  rt.world.entities.visitor.pose.p = [6, 0, 4];
  control(rt, rec.id, 'resume'); until(rt, () => !rt.isActive(rec.id)); clean(rt, rec.id);
});
test('a moved mat blocks further posture change and wake keeps physical claims until the mat is restored', () => {
  const { rt, p } = setup(), rec = start(rt, p);
  until(rt, () => readSleep(rt, rec.id)!.mode === 'sleeping');
  const original = structuredClone(rt.world.regions.mat.polygon), elapsed = readSleep(rt, rec.id)!.elapsed;
  rt.world.regions.mat.polygon.forEach(q => { q[0] += 4; });
  rt.step(); rt.step(); assert.equal(pose(rt)!.standingFraction, 0);
  assert.equal(readSleep(rt, rec.id)!.diagnostic!.code, 'sleep.mat-moved');
  assert.equal(readSleep(rt, rec.id)!.elapsed, elapsed);
  control(rt, rec.id, 'pause'); for (let i = 0; i < 10; i++) rt.step();
  assert.equal(pose(rt)!.standingFraction, 0); assert.ok(rt.holder('actor:sleeper').length); assert.ok(rt.holder('sleep-mat:mat').length);
  rt.world.regions.mat.polygon = original;
  // Deliberate external invalid geometry is diagnosed by the integrated safety
  // invariant. Preserve that evidence; do not silently clear it for recovery.
  assert.ok(rt.violations.length > 0);
  assert.ok(rt.violations.every(v => v.code === 'sleep.anchor-support'));
  until(rt, () => readSleep(rt, rec.id)!.mode === 'paused', 2000, ['sleep.anchor-support']);
  control(rt, rec.id, 'end'); until(rt, () => !rt.isActive(rec.id), 2000, ['sleep.anchor-support']); clean(rt, rec.id);
});
test('two separated floor patches cannot masquerade as continuous body support', () => {
  const { rt, p, scene } = setup();
  scene.surfaces = [
    { id: 'left', level: 0, y: 0, obb: { c: [-.9, 0], half: [.7, 1], yaw: 0 } },
    { id: 'right', level: 0, y: 0, obb: { c: [.9, 0], half: [.7, 1], yaw: 0 } },
  ];
  const r = rt.submit('sleep', p, { preempt: false });
  assert.equal(r.status, 'failed'); assert.equal(r.diagnostic!.code, 'sleep.unsupported');
});
test('identical sleep/director/resume sequence hashes deterministically', () => {
  function run() { const { rt, p } = setup(.4), rec = start(rt, p); until(rt, () => readSleep(rt, rec.id)!.elapsed >= .7);
    control(rt, rec.id, 'pause'); until(rt, () => readSleep(rt, rec.id)!.mode === 'paused'); control(rt, rec.id, 'resume'); until(rt, () => !rt.isActive(rec.id)); return [rt.stateHash(), JSON.stringify([...rt.records.values()])]; }
  assert.deepEqual(run(), run());
});
test('sleep safety envelope covers head and feet beyond the unchanged anchor', () => {
  const { rt, anchor } = setup(), e = rt.world.entities.sleeper; e.pose.p = [anchor[0], 0, anchor[1]];
  (e.human as { sleepPose?: SleepPose }).sleepPose = { mat: 'mat', standingFraction: 0 };
  const o = sleepEnvelope(e)!; assert.deepEqual(o.half, [1.5, .6]);
  assert.equal(gapToSleep(e, [-1.2, 0]), 0); assert.equal(gapToSleep(e, [1.2, 0]), 0); assert.ok(gapToSleep(e, [0, 1])! > .3);
  assert.ok(obbOverlap(o, { c: [-1.2, 0], half: [.28, .28], yaw: 0 }));
});
test('small view adapter reuses existing prone frame with flat ground rest and continuous rise', () => {
  const d = { hipH: .9, thigh: .42, shin: .4, legLen: .82, shHalf: .2, armLen: .6, lieHip: .15,
    pivotF: 0, pivotUp: .12, chain: [{ f: 0, up: .16 }, { f: 0, up: .16 }, { f: 0, up: .19 }] } as Dims;
  const flat = sleepGoal({ mat: 'mat', standingFraction: 0 }, .4); assert.equal(flat.bend, Math.PI / 2); assert.equal(flat.r, 0); assert.equal(flat.yaw, .4);
  const standing = sleepGoal({ mat: 'mat', standingFraction: 1 }, .4); assert.equal(standing.bend, 0); assert.equal(standing.r, 3);
  for (const [fraction, renderedRise] of [[0, 0], [1 / 6, .5], [1 / 3, 1], [.5, 1.5], [2 / 3, 2], [5 / 6, 2.5], [1, 3]])
    assert.equal(sleepGoal({ mat: 'mat', standingFraction: fraction }, .4).r, renderedRise);
  for (let i = 0; i <= 120; i++) { const pr = sleepGoal({ mat: 'mat', standingFraction: i / 120 }, .4); assert.ok(Number.isFinite(pr.bend)); assert.ok(sleepHands(d, pr).every(t => t.up >= .04)); }
});
test('rotated corner uses one circular-person gap for admission, invariant and walker contact threshold', () => {
  const { rt, p, anchor } = setup(.63), box = bodyEnvelope(anchor, .63);
  const nearCorner = (offset: number) => add2(box.c, rot2([box.half[0] + offset, box.half[1] + offset], box.yaw));
  const outside = nearCorner(.236), inside = nearCorner(.23);
  assert.ok(gapToSleepEnvelope(box, outside) > HUMAN_PROFILE.radius + SLEEP_BODY_MARGIN);
  assert.ok(obbOverlap(box, { c: outside, half: [HUMAN_PROFILE.radius, HUMAN_PROFILE.radius], yaw: 0 }, SLEEP_BODY_MARGIN), 'old square approximation falsely collided at this rotated corner');
  rt.world.entities.sleeper.pose = { p: [anchor[0], 0, anchor[1]], yaw: .63 };
  rt.world.entities.visitor.pose.p = [outside[0], 0, outside[1]];
  const rec = start(rt, p); until(rt, () => readSleep(rt, rec.id)!.mode === 'sleeping');
  const sleeper = rt.world.entities.sleeper;
  assert.equal(gapToSleep(sleeper, outside), gapToSleepEnvelope(sleepEnvelope(sleeper)!, outside));
  assert.equal(sleepSafetyIssue(rt, sleeper), undefined);
  assert.ok(gapToSleep(sleeper, inside)! <= HUMAN_PROFILE.radius + SLEEP_BODY_MARGIN);
  rt.world.entities.visitor.pose.p = [inside[0], 0, inside[1]];
  assert.equal(sleepSafetyIssue(rt, sleeper)!.code, 'sleep.occupied', 'real circular-body overlap is refused');
  // Restore the unstepped safety probe to its original position. Moving it to
  // the fixture's distant default would itself be an authoritative teleport.
  rt.world.entities.visitor.pose.p = [outside[0], 0, outside[1]];
  control(rt, rec.id, 'end'); until(rt, () => !rt.isActive(rec.id)); clean(rt, rec.id);
});
for (const verb of ['sleep', 'sleep_on_mat']) test(`refused repeated ${verb} cannot wake/cancel the active sleep purpose`, () => {
  const { rt, p } = setup(), rec = start(rt, p); until(rt, () => readSleep(rt, rec.id)!.mode === 'sleeping');
  const state = structuredClone(pose(rt)), readout = readSleep(rt, rec.id)!, holder = rt.holder('actor:sleeper');
  const rejected = rt.submit(verb, { ...p, mat: 'missing-repeat-mat' });
  assert.equal(rejected.status, 'failed'); assert.equal(readSleep(rt, rec.id)!.mode, 'sleeping');
  assert.deepEqual(pose(rt), state); assert.deepEqual(rt.holder('actor:sleeper'), holder);
  assert.deepEqual(readSleep(rt, rec.id)!.ownedActions, readout.ownedActions);
  rt.step(); rt.step(); assert.equal(readSleep(rt, rec.id)!.mode, 'sleeping');
  assert.ok(readSleep(rt, rec.id)!.elapsed > readout.elapsed, 'original sleep keeps progressing after refusal');
  control(rt, rec.id, 'end'); until(rt, () => !rt.isActive(rec.id)); clean(rt, rec.id);
});
test('refused Resume and unknown controls leave the current owned physical sleep unchanged', () => {
  const { rt, p } = setup(), rec = start(rt, p); until(rt, () => readSleep(rt, rec.id)!.mode === 'sleeping');
  const state = structuredClone(pose(rt)), holder = rt.holder('actor:sleeper');
  const early = rt.submit('sleep_control', { sleep: rec.id, intent: 'resume' });
  assert.equal(early.status, 'failed'); assert.equal(early.diagnostic!.code, 'sleep.not-paused');
  const unknown = rt.submit('sleep_control', { sleep: 'foreign-or-missing', intent: 'pause' });
  assert.equal(unknown.status, 'failed'); assert.equal(unknown.diagnostic!.code, 'sleep.inactive');
  assert.equal(readSleep(rt, rec.id)!.mode, 'sleeping'); assert.deepEqual(pose(rt), state); assert.deepEqual(rt.holder('actor:sleeper'), holder);
  control(rt, rec.id, 'end'); until(rt, () => !rt.isActive(rec.id)); clean(rt, rec.id);
});
