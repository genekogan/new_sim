// Rack-structure access (owner feedback 2026-09-28 §5): installed uprights are climbable (climb links),
// connected beam pairs are narrow walkways (beam-walk ≤ 0.4 m/s, no carrying except small loads) —
// only what exists is usable, as with stairs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DT } from '../runtime/runtime.ts';
import { component } from '../world/factory.ts';
import { def } from '../world/catalog.ts';
import { beamWalkways, climbLinks, frameLinks, BEAM_SPEED, CLIMB_SPEED } from '../construction/frame.ts';
import { spatialOf } from '../construction/access.ts';
import { bay, run } from './frame-fixtures.ts';
import { hypot } from '../core/math.ts';

test('climb links exist only on installed uprights; one per column and beam seat', () => {
  const held = bay({ seat: 1.8, installed: false });
  assert.deepEqual(climbLinks(held.rt.world), [], 'a raised but held (placed) upright is not climbable');
  const { rt, top } = bay({ seat: 1.8 });
  const ids = climbLinks(rt.world).map((l) => l.id);
  assert.deepEqual(ids, ['climb:A:l@0.46', 'climb:A:l@1.83', 'climb:A:r@0.46', 'climb:A:r@1.83', 'climb:B:l@0.46', 'climb:B:l@1.83', 'climb:B:r@0.46', 'climb:B:r@1.83']);
  const l = climbLinks(rt.world).find((x) => x.id === 'climb:A:l@1.83')!;
  assert.equal(l.kind, 'climb');
  assert.equal(l.occupancy, 1);
  assert.equal(l.maxSpeed, CLIMB_SPEED);
  assert.ok(l.width < 0.56, 'narrower than a routing disc: walk_to never routes up a frame');
  assert.ok(Math.abs(l.to.y - top) < 1e-9 && l.from.y === 0);
  assert.ok(l.from.p[1] < 0 && l.to.p[1] > 0, 'climbs A on its outside face (z < 0) and steps onto the beam inside the bay');
  // the Spatial scene carries them (frameAccessContributor)
  const sp = spatialOf(rt);
  assert.ok(sp.scene.links.some((x) => x.id === 'climb:A:l@1.83'));
});

test('a beam walkway exists only when both beams connect the frames at that height', () => {
  const half = bay({ seat: 1.8, extra: [['b5', 1, 1.2]] });
  assert.deepEqual(beamWalkways(half.rt.world).map((l) => l.id), ['beam:b1', 'beam:b2', 'beam:b3', 'beam:b4'], 'b5 alone (no partner at 1.22 m) is not walkable');
  assert.ok(climbLinks(half.rt.world).some((l) => l.id === 'climb:A:l@1.22'), 'the frame is climbable to b5 …');
  const cl = half.rt.submit('climb_frame', { actor: 'p1', link: 'climb:A:l@1.22', dir: 'up' });
  assert.equal(cl.diagnostic?.code, 'climb.no-walkway', '… but there is no beam pair to step onto');
  assert.match(cl.diagnostic!.message, /b5 needs its partner beam/);
  const { rt, top } = bay({ seat: 1.8 });
  const ws = beamWalkways(rt.world);
  assert.deepEqual(ws.map((l) => l.id), ['beam:b1', 'beam:b2', 'beam:b3', 'beam:b4']);
  const b3 = ws.find((l) => l.id === 'beam:b3')!;
  assert.equal(b3.kind, 'beam');
  assert.ok(Math.abs(b3.width - 0.2) < 1e-9, 'flange 0.1 m + 2 × 0.05 m tolerance');
  assert.equal(b3.maxSpeed, BEAM_SPEED);
  assert.equal(b3.carry, 'small');
  assert.deepEqual(b3.members, ['b3', 'b4']);
  assert.ok(Math.abs(b3.from.y - top) < 1e-9);
  // taking the partner away (uninstalled): the 12 ft frames lose their second level on that column, so
  // nothing on them carries load any more — no walkway (and no climb) is left
  rt.world.entities.b4.phase = 'staged';
  assert.deepEqual(frameLinks(rt.world).map((l) => l.id), []);
});

test('climb up, walk a beam at ≤ 0.4 m/s; walk_to cannot reach a beam; too fast is refused', () => {
  const { rt, E, top } = bay({ seat: 1.8 });
  // walk_to cannot put anyone on a beam: it is not a floor (and the frame links are too narrow for routing)
  const w = rt.submit('walk_to', { actor: 'p1', x: 0.61, z: 1.4, level: 4 });
  if (w.status !== 'failed') rt.runUntilIdle(20 * 60, [w.id]);
  assert.equal(w.status, 'failed', `walk_to onto a beam must be refused: ${w.status} ${w.diagnostic?.code}`);
  const t0 = rt.tick;
  run(rt, 'climb_frame', { actor: 'p1', link: 'climb:A:l@1.83', dir: 'up' });
  assert.equal(E.p1.human!.on, 'beam:b3');
  assert.ok(Math.abs(E.p1.pose.p[1] - top) < 1e-9);
  assert.ok(rt.tick - t0 > (top / CLIMB_SPEED) / DT, 'the climb takes at least height / 0.35 m/s');
  const fast = rt.submit('beam_walk', { actor: 'p1', x: 0.61, z: 2.0, speed: 0.6 });
  assert.equal(fast.status, 'failed');
  assert.equal(fast.diagnostic?.code, 'beam.too-fast');
  assert.match(fast.diagnostic!.message, /beam b3 at 0\.60 m\/s: balance-limited to 0\.4 m\/s/);
  const off = rt.submit('beam_walk', { actor: 'p1', x: 0, z: 1.2 });
  assert.equal(off.diagnostic?.code, 'beam.off-walkway');
  let maxV = 0;
  let last = [E.p1.pose.p[0], E.p1.pose.p[2]];
  const r = rt.submit('beam_walk', { actor: 'p1', x: 0.61, z: 2.2 });
  while (r.status !== 'completed' && r.status !== 'failed' && rt.tick < t0 + 20 * 120) {
    rt.step();
    const p = [E.p1.pose.p[0], E.p1.pose.p[2]];
    maxV = Math.max(maxV, hypot(p[0] - last[0], p[1] - last[1]) / DT);
    last = p;
  }
  assert.equal(r.status, 'completed', `${r.diagnostic?.message}`);
  assert.ok(maxV <= BEAM_SPEED + 1e-9, `beam walking at ${maxV} m/s`);
  assert.ok(maxV > BEAM_SPEED - 1e-6);
  assert.ok(Math.abs(E.p1.pose.p[2] - 2.2) < 1e-9 && E.p1.human!.on === 'beam:b3');
  // and back down the other frame
  run(rt, 'climb_frame', { actor: 'p1', link: 'climb:B:r@1.83', dir: 'down' });
  assert.equal(E.p1.human!.on, undefined);
  assert.equal(E.p1.human!.level, 0);
  assert.ok(Math.abs(E.p1.pose.p[1]) < 1e-9);
  assert.deepEqual(rt.violations, [], JSON.stringify(rt.violations.slice(0, 3)));
});

test('no carrying a sheet on a beam or up a frame (small loads only); the diagnostic names the beam', () => {
  const { rt, E } = bay({ seat: 1.8 }, [component('s1', 'plywood-4x6', [3, 0, 3], 0, { phase: 'staged' }), component('j9', '2x4-6ft', [3, 0, 5], 0, { phase: 'staged' })]);
  run(rt, 'climb_frame', { actor: 'p2', link: 'climb:A:r@1.83', dir: 'up' });
  assert.equal(E.p2.human!.on, 'beam:b4');
  // hand the sheet to p2 by state (as if taken from below) and try to walk off with it
  Object.assign(E.s1, { phase: 'carried', support: { kind: 'held', by: ['p2'] }, pose: { p: [E.p2.pose.p[0] + 0.4, E.p2.pose.p[1] + 0.8, E.p2.pose.p[2]], yaw: 0 } });
  E.p2.human!.grip = { entity: 's1', slot: 'mid' };
  const r = rt.submit('beam_walk', { actor: 'p2', x: -0.61, z: 2.0 });
  assert.equal(r.status, 'failed');
  assert.equal(r.diagnostic?.code, 'beam.no-carry');
  assert.match(r.diagnostic!.message, /p2 cannot walk beam b4 carrying s1 \(.*20 kg\)/);
  assert.ok(r.diagnostic!.subjects!.includes('b4'));
  const c = rt.submit('climb_frame', { actor: 'p1', link: 'climb:A:l@1.83', dir: 'up' });
  assert.notEqual(c.status, 'failed', 'p1 climbs empty-handed: accepted');
  rt.cancel(c.id);
  // a small load (a 6 ft 2x4, 3.5 kg) may be held on the beam
  Object.assign(E.s1, { phase: 'staged', support: { kind: 'ground' }, pose: { p: [3, 0, 3], yaw: 0 } });
  Object.assign(E.j9, { phase: 'carried', support: { kind: 'held', by: ['p2'] }, pose: { p: [E.p2.pose.p[0] + 0.4, E.p2.pose.p[1] + 0.8, E.p2.pose.p[2]], yaw: 0 } });
  E.p2.human!.grip = { entity: 'j9', slot: 'mid' };
  const ok = rt.submit('beam_walk', { actor: 'p2', x: -0.61, z: 1.0 });
  assert.notEqual(ok.status, 'failed', `${ok.diagnostic?.message}`);
  // climbing with a sheet is refused
  const E2 = bay({ seat: 1.8 }, [component('s1', 'plywood-4x6', [0.5, 0.8, -1], 0, { phase: 'carried' })]);
  E2.E.s1.support = { kind: 'held', by: ['p1'] };
  E2.E.p1.human!.grip = { entity: 's1', slot: 'mid' };
  const cl = E2.rt.submit('climb_frame', { actor: 'p1', link: 'climb:A:l@1.83', dir: 'up' });
  assert.equal(cl.diagnostic?.code, 'climb.no-carry');
  assert.match(cl.diagnostic!.message, /only small loads/);
});

test('someone on a beam whose partner beam is removed is flagged (frame.link-gone)', () => {
  const { rt, E } = bay({ seat: 1.8 });
  run(rt, 'climb_frame', { actor: 'p1', link: 'climb:A:l@1.83', dir: 'up' });
  E.b4.phase = 'staged';
  rt.step();
  assert.ok(rt.violations.some((v) => v.code === 'frame.link-gone' && v.subjects?.includes('p1')), JSON.stringify(rt.violations));
});

test('nobody walks a beam under a deck; stepping off onto the deck goes from an open spot on the beam', () => {
  const { rt, E, top } = bay({ seat: 1.8, joists: [0.25, 0.71, 1.17, 1.6] });
  // a sheet installed on the three southern joists (by state): deck over the beams at z 0.1–1.32
  const s = component('s1', 'plywood-4x6', [0, top + def('2x4-6ft').size[1], 0.71], 0, { phase: 'installed' });
  s.support = { kind: 'resting-on', on: 'j1' };
  s.connections = ['j1', 'j2', 'j3'].map((j) => ({ socket: 'bears-on', to: j, toSocket: 'deck' }));
  rt.world.entities.s1 = s;
  run(rt, 'climb_frame', { actor: 'p1', link: 'climb:B:r@1.83', dir: 'up' });
  run(rt, 'beam_walk', { actor: 'p1', x: 0.61, z: 1.8 }); // b3 (x +D/2 in this fixture)
  const under = rt.submit('beam_walk', { actor: 'p1', x: 0.61, z: 0.6 });
  assert.equal(under.diagnostic?.code, 'beam.under-deck');
  assert.match(under.diagnostic!.message, /under deck .* nobody stands on a beam beneath a deck/);
  run(rt, 'beam_walk', { actor: 'p1', x: 0.3, z: 0.9 });
  assert.equal(E.p1.human!.on, undefined);
  assert.equal(E.p1.human!.level, 4);
  assert.ok(Math.abs(E.p1.pose.p[1] - (top + def('2x4-6ft').size[1] + def('plywood-4x6').size[1])) < 1e-9, 'standing on the deck');
  assert.deepEqual(rt.violations, [], JSON.stringify(rt.violations.slice(0, 3)));
});
