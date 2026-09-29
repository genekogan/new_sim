import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { Runtime } from '../runtime/runtime.ts';
import { Spatial } from '../spatial/service.ts';
import { emptyWorld, addAll, human } from '../world/factory.ts';
import { provingGround } from '../scenes/proving-ground.ts';
import { walkTo } from '../locomotion/walk.ts';
import { DEFAULT_INVARIANTS } from '../runtime/invariants.ts';

const captures: unknown[] = [];
function setup() {
  const scene = provingGround(), sp = new Spatial(scene);
  const rt = new Runtime(addAll(emptyWorld('live-link', scene), human('p1', 1.55, 10)), new Map([['walk_to', walkTo]]), { spatial: sp }, DEFAULT_INVARIANTS);
  const action = rt.submit('walk_to', { actor: 'p1', x: 9, z: 10, level: 1 });
  return { rt, sp, action };
}
test('a replaced unusable link refuses before stair entry without following its stale plan', () => {
  const { rt, sp, action } = setup();
  const original = sp.scene.links.find((l) => l.id === 'stairs-a')!;
  sp.scene.links = sp.scene.links.map((l) => l.id === original.id ? { ...l, usable: false, reason: 'test closure' } : l);
  const pose = structuredClone(rt.world.entities.p1.pose);
  for (let i = 0; i < 100 && rt.isActive(action.id); i++) rt.step();
  assert.equal(original.usable, true);
  assert.equal(action.status, 'failed'); assert.equal(action.diagnostic?.code, 'route.link-unusable');
  assert.deepEqual(rt.world.entities.p1.pose, pose);
  assert.deepEqual(rt.violations, []);
  captures.push({ case: 'before entry', action, pose, violations: rt.violations });
});
test('closed or removed live stair blocks in place with ownership, including deferred cancel, then safely resumes', () => {
  for (const mode of ['closed', 'removed', 'geometry', 'in-place', 'cancel']) {
    const { rt, sp, action } = setup();
    for (let i = 0; i < 500 && rt.world.entities.p1.pose.p[1] < 0.5; i++) rt.step();
    assert.equal(action.phase, 'climb');
    const original = sp.scene.links.find((l) => l.id === 'stairs-a')!;
    const links = structuredClone(sp.scene.links);
    const pose = structuredClone(rt.world.entities.p1.pose);
    const holders = rt.holder('actor:p1');
    const traffic = structuredClone(rt.services.traffic);
    sp.scene.links = mode === 'removed' ? links.filter((l) => l.id !== original.id) : links.map((l) => l.id === original.id ? mode === 'geometry' ? { ...l, path: l.path.map(([x, y, z]) => [x, y + 0.1, z]) } : { ...l, usable: false, reason: 'missing tread ahead' } : l);
    if (mode === 'in-place') {
      sp.scene.links = sp.scene.links.map((l) => l.id === original.id ? original : l);
      original.path[2][1] += 0.1;
    }
    sp.epoch++; // exercises invalidation too: no planner may snap from mid-flight to a floor
    if (mode === 'cancel') rt.cancel(action.id);
    for (let i = 0; i < 20; i++) {
      rt.step(); assert.equal(action.status, 'blocked');
      assert.equal(action.diagnostic?.code, 'route.link-unusable');
      assert.deepEqual(rt.world.entities.p1.pose, pose);
      assert.deepEqual(rt.holder('actor:p1'), holders); assert.deepEqual(rt.services.traffic, traffic);
    }
    assert.deepEqual(rt.violations, []);
    captures.push({ case: mode, tick: rt.tick, pose, holders, diagnostic: action.diagnostic, violations: rt.violations });
    sp.scene.links = links; sp.epoch++;
    assert.ok(rt.runUntilIdle(1000));
    assert.equal(action.status, mode === 'cancel' ? 'cancelled' : 'completed');
    assert.deepEqual(rt.violations, []);
  }
});
after(() => { if (process.env.LIVE_LINK_CAPTURE) writeFileSync(process.env.LIVE_LINK_CAPTURE, JSON.stringify(captures, null, 2) + '\n'); });

test('an invalid future corridor cannot replan a climber onto its lower floor', () => {
  const { rt, sp, action } = setup();
  for (let i = 0; i < 500 && rt.world.entities.p1.pose.p[1] < 0.5; i++) rt.step();
  const pose = structuredClone(rt.world.entities.p1.pose), holders = rt.holder('actor:p1');
  const grid = sp.level(1)!, distance = grid.clearance.slice();
  grid.clearance.fill(0); // explicit corridor invalidation fixture while the flight still exists
  sp.epoch++;
  for (let i = 0; i < 10; i++) {
    rt.step(); assert.equal(action.status, 'blocked');
    assert.equal(action.diagnostic?.code, 'route.invalidated');
    assert.deepEqual(rt.world.entities.p1.pose, pose); assert.deepEqual(rt.holder('actor:p1'), holders);
  }
  grid.clearance.set(distance); sp.epoch++;
  assert.ok(rt.runUntilIdle(1000)); assert.equal(action.status, 'completed');
  assert.deepEqual(rt.violations, []);
  captures.push({ case: 'future corridor invalidation', heldPose: pose, holders, final: action.status, violations: rt.violations });
});
