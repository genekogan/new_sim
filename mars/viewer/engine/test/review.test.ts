// Regressions for the independent engine review (docs/engineering/REVIEW.md,
// findings C1–C3, H1, H2). Each test is derived from the review's proof script
// and asserts both that the physically impossible outcome no longer happens
// and that the correct diagnostic / behaviour occurs instead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from '../runtime/runtime.ts';
import { Spatial } from '../spatial/service.ts';
import { emptyWorld, human, addAll, component } from '../world/factory.ts';
import { createRegistry, ENGINE_INVARIANTS } from '../api/registry.ts';
import { forgetMotion, DEFAULT_INVARIANTS, MAX_HUMAN_STEP_PER_TICK, MAX_STEP_PER_TICK, SPEED_CAPS } from '../runtime/invariants.ts';
import { planWalk, traffic, walkTo } from '../locomotion/walk.ts';
import { holdStations } from '../construction/rules.ts';
import { entityFrame, formationFor, worldDiscs } from '../carry/formation.ts';
import { canonicalLying } from '../construction/lying.ts';
import { z } from 'zod';
import type { ActionDef } from '../actions/types.ts';
import { progressiveContributor } from '../construction/index.ts';
import { def } from '../world/catalog.ts';
import { clearanceAt } from '../spatial/grid.ts';
import type { SpatialScene } from '../spatial/types.ts';
import type { Entity } from '../world/types.ts';
import { hypot } from '../core/math.ts';

const open = (half: number, obstacles: SpatialScene['obstacles'] = []): SpatialScene => ({
  bounds: [-half, -half, half, half],
  levels: [{ id: 0, y: 0, label: 'ground' }],
  surfaces: [{ id: 'ground', level: 0, y: 0, obb: { c: [0, 0], half: [half, half], yaw: 0 } }],
  obstacles,
  links: [],
});
function engine(base: SpatialScene, ...es: Entity[]) {
  const w = addAll(emptyWorld('open', base), ...es);
  return new Runtime(w, createRegistry(), { spatial: new Spatial(base) }, ENGINE_INVARIANTS);
}
const codes = (rt: Runtime) => [...new Set(rt.violations.map((v) => v.code))];

test('C1: a mid-carry replan never flips the formation (no carrier teleports); teleports are an invariant violation', () => {
  const rt = engine(open(20), component('b', 'beam-12ft', [0, 0, 0], 0, { phase: 'staged' }), human('p1', -1, 2), human('p2', 1, -2));
  const rec = rt.submit('carry', { crew: ['p1', 'p2'], item: 'b', to: { x: 12, z: 0, yaw: 0 } });
  assert.equal(rec.status, 'executing');
  let n = 0;
  while (rt.isActive(rec.id) && !(rec.phase === 'move' && rt.world.entities.b.pose.p[0] > 1.0) && n++ < 4000) rt.step();
  const bx = rt.world.entities.b.pose.p[0];
  // construction elsewhere: a U of test-wall blocks ahead, open behind the crew
  let k = 0;
  const wall = (x: number, z: number) => {
    const id = `w${k++}`;
    rt.world.entities[id] = { ...component(id, 'test-wall', [x, 0, z], 0, { phase: 'stored' }), kind: 'fixture' };
  };
  for (let z = -4; z <= 4; z++) wall(bx + 4.5, z);
  for (let x = Math.floor(bx - 3); x <= bx + 4; x++) { wall(x, -4); wall(x, 4); }
  const pos = () => ['p1', 'p2'].map((id) => rt.world.entities[id].pose.p);
  let prev = pos(), worst = 0, replanned = false;
  for (let t = 0; t < 2400 && rt.isActive(rec.id); t++) {
    rt.step();
    if (rec.phase === 'replan') replanned = true;
    const cur = pos();
    worst = Math.max(worst, ...cur.map((p, i) => hypot(p[0] - prev[i][0], p[2] - prev[i][2])));
    prev = cur;
  }
  assert.ok(replanned, 'construction forced a replan');
  assert.ok(worst < 0.2, `max carrier displacement per tick ${worst.toFixed(2)} m`);
  assert.equal(rec.status, 'completed');
  assert.deepEqual(codes(rt), []);

  // the generic invariant: a hand-made teleport is recorded as motion.teleport
  const rt2 = engine(open(10), human('p1', 0, 0));
  rt2.step();
  rt2.world.entities.p1.pose.p = [3, 0, 0];
  rt2.step();
  assert.deepEqual(codes(rt2), ['motion.teleport']);
  assert.match(rt2.violations[0].message, /p1 moved 3\.00 m in one tick/);
});

test('no jumps (W21): a person on foot moves ≤ 0.15 m per tick (riders and carried loads keep 0.6 m); a published speed above its activity cap + 5 % is motion.overspeed', () => {
  assert.equal(MAX_HUMAN_STEP_PER_TICK, 0.15);
  assert.equal(MAX_STEP_PER_TICK, 0.6);
  const base = open(10);
  const rt = new Runtime(addAll(emptyWorld('open', base), human('p1', 0, 0), human('p2', 0, 3), human('r1', 0, -3)), new Map(), { spatial: new Spatial(base) }, DEFAULT_INVARIANTS);
  rt.world.entities.r1.human!.riding = 'euc-1'; // a rider moves with its vehicle (its own bound)
  rt.step();
  const E = rt.world.entities;
  // 0.2 m in one tick on foot (the smallest W20 spike was 0.2 m): a teleport; 0.14 m is not
  E.p1.pose.p = [0.2, 0, 0];
  E.p2.pose.p = [0.14, 0, 3];
  E.r1.pose.p = [0.5, 0, -3];
  rt.step();
  assert.deepEqual(rt.violations.map((v) => `${v.code}:${(v.subjects ?? []).join()}`), ['motion.teleport:p1']);
  assert.match(rt.violations[0].message, /p1 moved 0\.20 m in one tick \(max 0\.15 m, activity idle\)/);
  E.r1.pose.p = [1.2, 0, -3]; // 0.7 m: past a vehicle's bound too
  rt.step();
  assert.deepEqual(rt.violations.slice(1).map((v) => `${v.code}:${(v.subjects ?? []).join()}`), ['motion.teleport:r1']);
  // published speed per activity: walk ≤ 1.4 m/s (+ 5 %), climbing ≤ 0.45, idle / wait under WALK_MIN; no cap → violation
  const over = (activity: string, speed: number) => {
    const r = new Runtime(addAll(emptyWorld('open', base), human('p', 0, 0)), new Map(), { spatial: new Spatial(base) }, DEFAULT_INVARIANTS);
    Object.assign(r.world.entities.p.human!, { activity, speed });
    r.step();
    return r.violations.map((v) => v.code);
  };
  assert.deepEqual(over('walk', 1.35), []);
  assert.deepEqual(over('walk', 1.47), []);
  assert.deepEqual(over('walk', 1.5), ['motion.overspeed']);
  assert.deepEqual(over('climb-up', 0.45), []);
  assert.deepEqual(over('climb-down', 0.6), ['motion.overspeed']);
  assert.deepEqual(over('idle', 0.08), []);
  assert.deepEqual(over('wait', 0.3), ['motion.overspeed']);
  assert.deepEqual(over('sit', 0.1), ['motion.overspeed'], 'a published speed in an activity with no cap fails loudly');
  assert.deepEqual(Object.keys(SPEED_CAPS).sort(), ['climb-down', 'climb-up', 'climb-wait', 'idle', 'jog', 'run', 'wait', 'walk']);
  assert.deepEqual(over('jog', 2.5), []);
  assert.deepEqual(over('run', 4), []);
  assert.deepEqual(over('jog', 2.7), ['motion.overspeed']);
  assert.deepEqual(over('run', 4.3), ['motion.overspeed']);
});

const REST_Y12 = def('upright-12ft').size[2] / 2;
function raisedFrame() {
  const base = open(15);
  const w = addAll(
    emptyWorld('open', base),
    component('A', 'upright-12ft', [0, 0, 0], Math.PI, { phase: 'staged', pose: { p: [0, REST_Y12, 0], yaw: Math.PI, pitch: Math.PI / 2 } }),
    component('bx', 'beam-9ft', [8, 0, -8], 0, { phase: 'staged' }),
    human('p1', -6, -6), human('p2', -4.8, -6),
  );
  const rt = new Runtime(w, createRegistry(), { spatial: new Spatial(base, { contributors: [progressiveContributor] }) }, ENGINE_INVARIANTS);
  const r1 = rt.submit('raise_upright', { crew: ['p1', 'p2'], item: 'A' });
  rt.runUntilIdle(20 * 120, [r1.id]);
  assert.equal(r1.status, 'completed');
  return rt;
}

test('C2: people holding up a frame cannot be assigned to carry (nor walk off by any start path); absent holders are a violation', () => {
  const rt = raisedFrame();
  assert.deepEqual(rt.world.entities.A.support, { kind: 'held', by: ['p1', 'p2'] });
  const c = rt.submit('carry', { crew: ['p1', 'p2'], item: 'bx', to: { x: 8, z: 8, yaw: 0 } });
  assert.equal(c.status, 'failed');
  assert.equal(c.diagnostic?.code, 'actor.holding');
  assert.match(c.diagnostic!.message, /p1 is holding A/);
  // the direct child-walk start path (walkTo.start, as carry's gather uses) fails on its first step
  const route = planWalk(rt, rt.world.entities.p1, { level: 0, p: [5, 5] });
  assert.ok(route.ok);
  const ex = walkTo.start(rt, { actor: 'p1', x: 5, z: 5 }, route.ok ? route.route : (null as never), 'direct');
  const st = walkTo.step(rt, ex, 1 / 20);
  assert.equal(st.status, 'failed');
  assert.equal(st.status === 'failed' && st.diagnostic.code, 'actor.holding');
  rt.world.entities.p1.human!.task = undefined;
  for (let i = 0; i < 20; i++) rt.step();
  assert.deepEqual(codes(rt), [], 'the frame stays held by both holders');
  assert.ok(hypot(rt.world.entities.p1.pose.p[0], rt.world.entities.p1.pose.p[2]) < 2, 'p1 stayed at the frame');

  // the invariant: a holder whose grip is gone, or who stands away from the frame, is flagged
  rt.world.entities.p2.human!.grip = undefined;
  rt.step();
  assert.deepEqual(codes(rt), ['support.holder-missing']);
  assert.match(rt.violations[0].message, /A is marked held by \[p1, p2\] but p2 is not gripping it/);
  rt.world.entities.p2.human!.grip = { entity: 'A', slot: 'hold-1' };
  rt.world.entities.p1.pose.p = [4, 0, 0];
  forgetMotion(rt);
  rt.step();
  assert.match(rt.violations[rt.violations.length - 1].message, /but p1 stands [\d.]+ m from it \(reach 1.2 m\)/);
});

test('H1: an unreachable hold station is refused at plan time; a failed/cancelled action leaves no reservations, tasks, children or traffic behind', () => {
  // review proof p4: a post stands on hold station 2
  const A0 = component('A', 'upright-12ft', [0, 0, 0], Math.PI, { phase: 'staged', pose: { p: [0, REST_Y12, 0], yaw: Math.PI, pitch: Math.PI / 2 } });
  const st = holdStations({ ...A0, pose: canonicalLying(A0, 0) }, 2);
  const base = open(15, [{ id: 'post', label: 'post', kind: 'solid', y0: 0, y1: 2, obb: { c: st[1].p, half: [0.15, 0.15], yaw: 0 } }]);
  const rt = new Runtime(addAll(emptyWorld('open', base), A0, human('p1', -6, -6), human('p2', -4.8, -6), human('p3', -3.6, -6)), createRegistry(), { spatial: new Spatial(base) }, ENGINE_INVARIANTS);
  const r = rt.submit('raise_upright', { crew: ['p1', 'p2'], item: 'A' });
  assert.equal(r.status, 'failed');
  assert.equal(r.diagnostic?.code, 'raise.station-unreachable');
  assert.match(r.diagnostic!.message, /p2 cannot reach their station/);
  assert.equal(rt.world.entities.A.phase, 'staged');
  assert.equal(rt.world.entities.A.reservedBy, undefined);
  assert.equal([...rt.records.values()].filter((x) => x.parent === r.id).length, 0, 'no child walks were started');
  const c = rt.submit('carry', { crew: ['p1', 'p3'], item: 'A', to: { x: 5, z: 5, yaw: 0 } });
  assert.notEqual(c.diagnostic?.code, 'carry.item-unavailable', 'the frame is still available');

  // generic runtime cleanup, exercised through a verb that reserves, delegates and then fails
  const probe: ActionDef<{ fail: boolean }, null, { id: string; t: number; fail: boolean }> = {
    verb: 'probe',
    description: 'test verb',
    schema: z.strictObject({ fail: z.boolean() }),
    reservations: () => [{ resource: 'actor:p1', mode: 'exclusive' }, { resource: 'entity:bx', mode: 'exclusive' }],
    plan: () => ({ ok: true, program: null }),
    start(rt2, p, _prog, id) {
      const bx = rt2.world.entities.bx;
      bx.phase = 'reserved';
      bx.reservedBy = id;
      Object.assign(rt2.world.entities.p1.human!, { task: id, activity: 'walk' });
      traffic(rt2).set('narrow:test', { actors: new Set(['p1']), entry: [0, 0], dir: [1, 0] });
      rt2.submit('walk_to', { actor: 'p2', x: 8, z: 8 }, { parent: id });
      return { id, t: 0, fail: p.fail };
    },
    step: (_rt, ex) => (++ex.t >= 3 && ex.fail ? { status: 'failed', diagnostic: { code: 'probe.failed', message: 'probe failed' } } : { status: 'running' }),
    cancel: () => ({ ok: true }),
  };
  for (const mode of ['fail', 'cancel'] as const) {
    const b = open(15);
    const w = addAll(emptyWorld('open', b), component('bx', 'beam-9ft', [3, 0, 3], 0, { phase: 'stored' }), human('p1', -3, -3), human('p2', -1.8, -3));
    const rt2 = new Runtime(w, createRegistry([probe]), { spatial: new Spatial(b) }, ENGINE_INVARIANTS);
    const pr = rt2.submit('probe', { fail: mode === 'fail' });
    assert.equal(pr.status, 'executing');
    const child = [...rt2.records.values()].find((x) => x.parent === pr.id)!;
    assert.equal(child.status, 'executing');
    if (mode === 'cancel') { rt2.step(); rt2.cancel(pr.id); }
    rt2.runUntilIdle(100, [pr.id]);
    assert.equal(pr.status, mode === 'fail' ? 'failed' : 'cancelled');
    assert.equal(child.status, 'cancelled', 'live child cancelled with its parent');
    assert.equal(rt2.isActive(child.id), false);
    const bx = rt2.world.entities.bx;
    assert.equal(bx.phase, 'stored', 'never picked up: back to its prior phase');
    assert.equal(bx.reservedBy, undefined);
    for (const id of ['p1', 'p2']) {
      assert.equal(rt2.world.entities[id].human!.task, undefined, `${id} task cleared`);
      assert.equal(rt2.world.entities[id].human!.activity, 'idle');
    }
    assert.equal(traffic(rt2).size, 0, 'no ghost single-file entries');
    const p2 = [...rt2.world.entities.p2.pose.p];
    rt2.runUntilIdle(40);
    assert.deepEqual(rt2.world.entities.p2.pose.p, p2, 'the orphaned walk no longer moves p2');
    assert.equal(rt2.submit('carry', { crew: ['p1', 'p2'], item: 'bx', to: { x: -5, z: 5, yaw: 0 } }).status, 'executing');
    assert.deepEqual(codes(rt2), []);
  }
});

test('C3: a walker crossing a carry waits for the load to pass (traffic.load), never walks through it; overlap is a violation', () => {
  const f = formationFor('beam-12ft', 2);
  let waited = 0;
  for (const [startX, side] of [[3.0, 3], [2.0, 2], [4.0, 3], [2.0, 1.5]] as const) {
    const rt = engine(open(20), component('b', 'beam-12ft', [0, 0, 0], 0, { phase: 'staged' }), human('p1', -1, 2), human('p2', 1, -2), human('p3', 6, side));
    const c = rt.submit('carry', { crew: ['p1', 'p2'], item: 'b', to: { x: 12, z: 0, yaw: 0 } });
    let walk: ReturnType<Runtime['submit']> | null = null;
    let worst = Infinity;
    for (let t = 0; t < 4000 && (rt.isActive(c.id) || (walk && rt.isActive(walk.id))); t++) {
      if (!walk && c.phase === 'move' && rt.world.entities.b.pose.p[0] > startX) walk = rt.submit('walk_to', { actor: 'p3', x: 6, z: -side });
      rt.step();
      const b = rt.world.entities.b;
      if (b.phase !== 'carried') continue;
      const p = rt.world.entities.p3.pose.p;
      for (const d of worldDiscs(f, entityFrame(b).q)) if (d.d.part === 'load') worst = Math.min(worst, hypot(d.p[0] - p[0], d.p[1] - p[2]) - d.d.r);
    }
    assert.equal(c.status, 'completed', `carry (walk starts at load x ${startX})`);
    assert.equal(walk?.status, 'completed', `walk ${walk?.diagnostic?.code}`);
    assert.ok(worst >= 0.28 - 0.03, `p3 body centre ${worst.toFixed(2)} m from the load cover (needs ≥ 0.25)`);
    assert.deepEqual(codes(rt), []);
    if (walk!.history.some((h) => h.code === 'traffic.load')) waited++;
  }
  assert.ok(waited >= 2, `walkers waited for the load (traffic.load) in ${waited} of 4 crossings`);
  // the invariant: a person inside a carried load's cover is flagged
  const rt = engine(open(20), component('b', 'beam-12ft', [0, 0, 0], 0, { phase: 'staged' }), human('p1', -1, 2), human('p2', 1, -2), human('p3', 6, 6));
  const c = rt.submit('carry', { crew: ['p1', 'p2'], item: 'b', to: { x: 12, z: 0, yaw: 0 } });
  while (rt.isActive(c.id) && c.phase !== 'move') rt.step();
  const q = entityFrame(rt.world.entities.b).q;
  rt.world.entities.p3.pose.p = [q.x, 0, q.z];
  forgetMotion(rt);
  rt.step();
  assert.ok(codes(rt).includes('collision.human-load'), JSON.stringify(codes(rt)));
  assert.match(rt.violations.find((v) => v.code === 'collision.human-load')!.message, /p3 overlaps the carried b/);
});

test('H2: a snapped walk_to goal ends at the snapped standable point, reports outputs.snapped, and fails beyond the tolerance', () => {
  const wall = { id: 'wall-e', label: 'east wall', kind: 'wall' as const, y0: 0, y1: 2.4, obb: { c: [5, 0] as [number, number], half: [0.1, 6] as [number, number], yaw: 0 } };
  const base = open(10, [wall]);
  const sp = new Spatial(base);
  const rt = new Runtime(addAll(emptyWorld('open', base), human('p1', 0, 0)), createRegistry(), { spatial: sp }, ENGINE_INVARIANTS);
  const r = rt.submit('walk_to', { actor: 'p1', x: 4.75, z: 0 }); // body edge would be 0.15 m inside the wall face at 4.9
  rt.runUntilIdle(2000, [r.id]);
  assert.equal(r.status, 'completed');
  const p = rt.world.entities.p1.pose.p;
  assert.ok(clearanceAt(sp.level(0)!, [p[0], p[2]]) >= 0.28, `arrival clearance ${clearanceAt(sp.level(0)!, [p[0], p[2]]).toFixed(2)} m`);
  const snapped = r.outputs?.snapped as number;
  assert.ok(snapped > 0.05 && snapped <= 0.35, `snapped ${snapped}`);
  assert.ok(Math.abs(hypot(p[0] - 4.75, p[2]) - snapped) < 0.01, 'the body stands at the reported snapped point');
  assert.deepEqual(codes(rt), [], 'no collision on arrival');
  // an exactly standable goal is reached exactly
  const ok = rt.submit('walk_to', { actor: 'p1', x: 2, z: 1 });
  rt.runUntilIdle(2000, [ok.id]);
  assert.equal(ok.outputs?.snapped, 0);
  assert.deepEqual([rt.world.entities.p1.pose.p[0], rt.world.entities.p1.pose.p[2]], [2, 1]);
  // beyond the snap tolerance: refused before any movement
  const far = rt.submit('walk_to', { actor: 'p1', x: 5.0, z: 0 });
  assert.equal(far.status, 'failed');
  assert.equal(far.diagnostic?.code, 'route.goal-blocked');
});
