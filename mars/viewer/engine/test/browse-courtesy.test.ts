// BROWSE-COURTESY (2026-10-23): an ambient make-way nudge (locomotion/walk.ts) leaves a short solo pose (a shelf browse) to
// finish instead of moving the body out of it (pose.moved); long solo poses, grouped poses and ordinary walks keep their rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from '../runtime/runtime.ts';
import { Spatial } from '../spatial/service.ts';
import { emptyWorld, addAll, human } from '../world/factory.ts';
import { makeWay, walkTo, POSE_DEFER_S } from '../locomotion/walk.ts';
import { poseV1 } from '../social/pose.ts';
import { openGround } from './frame-fixtures.ts';
import type { ActionDef } from '../actions/types.ts';

function setup() {
  const base = openGround();
  const rt = new Runtime(addAll(emptyWorld('browse-courtesy', base), human('p', 0, 0)), new Map<string, ActionDef>([[walkTo.verb, walkTo], [poseV1.verb, poseV1]]), { spatial: new Spatial(base) }, []);
  (rt.services.spatial as Spatial).sync(rt.world);
  return rt;
}
const nudges = (rt: Runtime) => [...rt.records.keys()].filter((id) => id.includes(':make-way:'));

test('a short solo browse is not nudged off its spot: it completes, then courtesy resumes', () => {
  const rt = setup(), browse = rt.submit('pose_v1', { actor: 'p', activity: 'browse', seconds: 4, prop: 'book' });
  assert.equal(browse.status, 'executing');
  for (let t = 0; t < 120 && rt.isActive(browse.id); t++) { makeWay(rt, 'p', [-1, 0]); rt.step(); }
  assert.equal(browse.status, 'completed', browse.diagnostic?.code);
  assert.deepEqual(nudges(rt), [], 'no make-way walk while the browse ran');
  makeWay(rt, 'p', [-1, 0]);
  assert.equal(nudges(rt).length, 1, 'the next nudge goes ahead once the browse is done');
});

test('a long solo pose is still nudged early (pose.moved as before), but not in its last seconds', () => {
  const rt = setup(), read = rt.submit('pose_v1', { actor: 'p', activity: 'read', seconds: 60, prop: 'book' });
  rt.step(); makeWay(rt, 'p', [-1, 0]);
  assert.equal(nudges(rt).length, 1);
  assert.ok(rt.runUntilIdle(1000));
  assert.equal(read.status, 'failed'); assert.equal(read.diagnostic?.code, 'pose.moved');
  const rt2 = setup(), late = rt2.submit('pose_v1', { actor: 'p', activity: 'read', seconds: 60, prop: 'book' });
  assert.ok(60 - 57 <= POSE_DEFER_S);
  while (rt2.tick < 57 * 20) rt2.step();   // 3 s left
  makeWay(rt2, 'p', [-1, 0]);
  assert.deepEqual(nudges(rt2), []);
  assert.ok(rt2.runUntilIdle(1000)); assert.equal(late.status, 'completed');
});

test('a grouped pose is still nudged and settles through the courtesy step (together/1 unchanged)', () => {
  const rt = setup(), jj = rt.submit('pose_v1', { actor: 'p', activity: 'jumping-jacks', seconds: 4, group: 'inv_g', waitSeconds: 5, alone: 'start', need: 1 });
  rt.step(); makeWay(rt, 'p', [-1, 0]);
  assert.equal(nudges(rt).length, 1, 'grouped poses keep accepting courtesy nudges');
  assert.ok(rt.runUntilIdle(2000));
  assert.equal(jj.status, 'completed', jj.diagnostic?.code);
});

test('an ordinary walk still refuses a pose (pose.not-still) and a pose never blocks the owner\'s own walk', () => {
  const rt = setup(), walk = rt.submit('walk_to', { actor: 'p', x: 3, z: 0 });
  rt.step();
  const pose = rt.submit('pose_v1', { actor: 'p', activity: 'browse', seconds: 4 });
  assert.equal(pose.status, 'failed'); assert.equal(pose.diagnostic?.code, 'pose.not-still');
  assert.ok(rt.runUntilIdle(1000)); assert.equal(walk.status, 'completed');
});
