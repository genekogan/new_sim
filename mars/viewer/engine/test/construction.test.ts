// Supported rack bay (spec §28 "Raise tall frame", premature release) —
// raise two 12 ft uprights, hold them, seat beams, release only when stable.
import { test } from 'node:test';
import { checkInstallCancellation } from './install-cancel-assertions.ts';
import assert from 'node:assert/strict';
import { Runtime } from '../runtime/runtime.ts';
import { DEFAULT_INVARIANTS } from '../runtime/invariants.ts';
import { Spatial } from '../spatial/service.ts';
import { emptyWorld, human, addAll, component } from '../world/factory.ts';
import { walkTo } from '../locomotion/walk.ts';
import { CONSTRUCTION_ACTIONS, liftHandsInReach, uprightsSupported } from '../construction/index.ts';
import { groupStability, holdStations } from '../construction/rules.ts';
import { liftHandPoint, raiseRoles } from '../construction/raise.ts';
import { entityCorners } from '../spatial/service.ts';
import type { Entity } from '../world/types.ts';
import { def } from '../world/catalog.ts';
import { angleDelta, dsin, hypot } from '../core/math.ts';
import type { ActionDef } from '../actions/types.ts';
import type { Obstacle, SpatialScene } from '../spatial/types.ts';

const L9 = def('beam-9ft').size[0];
const D12 = def('upright-12ft').size[0];
const LYING = Math.PI / 2;
/** A lying frame rests on its face: origin (base centre) raised by half the column thickness (canonicalLying). */
const REST_Y = def('upright-12ft').size[2] / 2;

function openGround(extra: Obstacle[] = []): SpatialScene {
  return {
    bounds: [-15, -15, 15, 15],
    levels: [{ id: 0, y: 0, label: 'ground' }],
    surfaces: [{ id: 'ground', level: 0, y: 0, obb: { c: [0, 0], half: [15, 15], yaw: 0 } }],
    obstacles: extra,
    links: [],
  };
}

function setup(extra: Obstacle[] = []) {
  const base = openGround(extra);
  const w = addAll(
    emptyWorld('open-ground', base),
    // A lies toward −z (yaw π), B lies toward +z (yaw 0); bases L9 apart so the bay is between them
    component('A', 'upright-12ft', [0, 0, 0], Math.PI, { phase: 'staged', pose: { p: [0, REST_Y, 0], yaw: Math.PI, pitch: LYING } }),
    component('B', 'upright-12ft', [0, 0, L9], 0, { phase: 'staged', pose: { p: [0, REST_Y, L9], yaw: 0, pitch: LYING } }),
    ...['p1', 'p2', 'p3', 'p4', 'p5', 'p6'].map((id, i) => human(id, -6 + i * 1.2, -6)),
  );
  const reg = new Map<string, ActionDef>([['walk_to', walkTo], ...CONSTRUCTION_ACTIONS.map((a) => [a.verb, a] as [string, ActionDef])]);
  return new Runtime(w, reg, { spatial: new Spatial(base) }, [...DEFAULT_INVARIANTS, uprightsSupported, liftHandsInReach]);
}

function run(rt: Runtime, verb: string, params: unknown) {
  const r = rt.submit(verb, params);
  if (r.status === 'failed') return r;
  rt.runUntilIdle(20 * 120, [r.id]);
  return r;
}

function stageBeams(rt: Runtime) {
  // beams lie on the ground under their seats, along the bay (beam local x → world +z ⇒ yaw π/2)
  const x = D12 / 2;
  rt.world.entities.b1 = component('b1', 'beam-9ft', [-x, 0, L9 / 2], Math.PI / 2, { phase: 'staged' });
  rt.world.entities.b2 = component('b2', 'beam-9ft', [x, 0, L9 / 2], Math.PI / 2, { phase: 'staged' });
  rt.world.entities.b3 = component('b3', 'beam-9ft', [-x + 0.25, 0, L9 / 2], Math.PI / 2, { phase: 'staged' });
  rt.world.entities.b4 = component('b4', 'beam-9ft', [x - 0.25, 0, L9 / 2], Math.PI / 2, { phase: 'staged' });
}

test('supported bay: raise, hold, premature release refused, beams, stable release', () => {
  const rt = setup();
  const rA = run(rt, 'raise_upright', { crew: ['p1', 'p2'], item: 'A' });
  assert.equal(rA.status, 'completed', rA.diagnostic?.message);
  const A = rt.world.entities.A;
  assert.equal(A.pose.pitch, 0);
  assert.deepEqual(A.support, { kind: 'held', by: ['p1', 'p2'] });
  assert.equal(rt.world.entities.p1.human!.activity, 'support');
  assert.ok(rA.history.some((h) => h.phase === 'raise'));

  // holders cannot wander off; premature release refused with the missing connections named
  assert.equal(rt.submit('walk_to', { actor: 'p1', x: 5, z: 5 }).diagnostic?.code, 'actor.holding');
  const early = rt.submit('release_support', { item: 'A' });
  assert.equal(early.diagnostic?.code, 'support.release-premature');
  assert.match(early.diagnostic!.message, /not joined by beams/);

  assert.equal(run(rt, 'raise_upright', { crew: ['p3', 'p4'], item: 'B' }).status, 'completed');
  stageBeams(rt);
  // lower level on both columns
  // A has yaw π so its local "l" column is world +x; B's is world −x; planBeam matches columns across the flip
  for (const [beam, col] of [['b1', 'r'], ['b2', 'l']] as const) {
    const r = run(rt, 'connect_beam', { crew: ['p5', 'p6'], beam, a: 'A', b: 'B', column: col, height: 0.5 });
    assert.equal(r.status, "completed", `${r.status} ${r.phase} ${r.diagnostic?.message} ${JSON.stringify([...rt.records.values()].filter((x) => x.parent === r.id).map((x) => [x.status, x.phase, x.diagnostic?.message]))}`);
  }
  const mid = rt.submit('release_support', { item: 'A' });
  assert.equal(mid.diagnostic?.code, 'support.release-premature', 'one beam level is not enough for 12 ft frames');
  assert.match(mid.diagnostic!.message, /≥2 heights/);
  for (const [beam, col] of [['b3', 'r'], ['b4', 'l']] as const) {
    const r = run(rt, 'connect_beam', { crew: ['p5', 'p6'], beam, a: 'A', b: 'B', column: col, height: 1.8 });
    assert.equal(r.status, "completed", `${r.status} ${r.phase} ${r.diagnostic?.message} ${JSON.stringify([...rt.records.values()].filter((x) => x.parent === r.id).map((x) => [x.status, x.phase, x.diagnostic?.message]))}`);
  }
  assert.ok(groupStability(rt.world, A).stable);
  assert.equal(run(rt, 'release_support', { item: 'A' }).status, 'completed');
  assert.equal(run(rt, 'release_support', { item: 'B' }).status, 'completed');
  assert.equal(rt.world.entities.A.phase, 'installed');
  assert.equal(rt.world.entities.p1.human!.grip, undefined);
  assert.equal(run(rt, 'walk_to', { actor: 'p1', x: 5, z: -5 }).status, 'completed', 'released holders are free again');
  assert.deepEqual(rt.violations.map((v) => v.message), []);
});

test('connect_beam lifts a symmetric beam without spinning it end-for-end; ends map to a/b by geometry', () => {
  const rt = setup();
  assert.equal(run(rt, 'raise_upright', { crew: ['p1', 'p2'], item: 'A' }).status, 'completed');
  assert.equal(run(rt, 'raise_upright', { crew: ['p3', 'p4'], item: 'B' }).status, 'completed');
  stageBeams(rt);
  // A has yaw π ⇒ its frame normal gives a nominal beam yaw of −π/2, exactly π from the staged yaw π/2
  const yaws: number[] = [];
  rt.observers.push({ onTick: (r) => { if (r.world.entities.b1.phase === 'carried') yaws.push(r.world.entities.b1.pose.yaw); } });
  const r = run(rt, 'connect_beam', { crew: ['p5', 'p6'], beam: 'b1', a: 'A', b: 'B', column: 'r', height: 0.5 });
  assert.equal(r.status, 'completed', r.diagnostic?.message);
  assert.ok(yaws.length > 10, `lift observed over ${yaws.length} ticks`);
  const all = [Math.PI / 2, ...yaws, rt.world.entities.b1.pose.yaw];
  let total = 0;
  for (let i = 1; i < all.length; i++) total += Math.abs(angleDelta(all[i - 1], all[i]));
  assert.ok(total < Math.PI / 2, `beam yawed ${total.toFixed(3)} rad during the lift`);
  const b1 = rt.world.entities.b1;
  assert.deepEqual(b1.connections!.map((c) => c.to), ['A', 'B']);
  // A sits at −z, B at +z; the beam's local +x (end-r) points along its yaw
  const endOf = (id: string) => b1.connections!.find((c) => c.to === id)!.socket;
  const ux = dsin(b1.pose.yaw);
  assert.equal(endOf('B'), ux > 0 ? 'end-r' : 'end-l');
  assert.equal(endOf('A'), ux > 0 ? 'end-l' : 'end-r');
  assert.equal(rt.world.entities.A.connections!.find((c) => c.to === 'b1')!.toSocket, endOf('A'));
  assert.equal(rt.world.entities.B.connections!.find((c) => c.to === 'b1')!.toSocket, endOf('B'));
});

test('raising arc blocked by an overhead obstacle is rejected and names it', () => {
  const roof: Obstacle = { id: 'shade', obb: { c: [0, -2], half: [2, 1], yaw: 0 }, y0: 2.4, y1: 2.6, kind: 'solid', label: 'shade structure' };
  const rt = setup([roof]);
  const r = rt.submit('raise_upright', { crew: ['p1', 'p2'], item: 'A' });
  assert.equal(r.diagnostic?.code, 'raise.arc-blocked');
  assert.match(r.diagnostic!.message, /shade structure/);
});

test('crew too small for a 19 ft upright; misaligned bay; unreachable seat height', () => {
  const rt = setup();
  rt.world.entities.T = component('T', 'upright-19ft', [8, 0, 8], 0, { phase: 'staged', pose: { p: [8, def('upright-19ft').size[2] / 2, 8], yaw: 0, pitch: LYING } });
  const t = rt.submit('raise_upright', { crew: ['p1', 'p2'], item: 'T' });
  assert.equal(t.diagnostic?.code, 'raise.crew-too-small');
  assert.match(t.diagnostic!.message, /at least 3/);
  run(rt, 'raise_upright', { crew: ['p1', 'p2'], item: 'A' });
  rt.world.entities.B.pose.p = [0.3, 0, L9]; // shifted sideways
  rt.world.entities.B.pose.pitch = 0;
  rt.world.entities.B.support = { kind: 'held', by: ['p3', 'p4'] };
  stageBeams(rt);
  assert.equal(rt.submit('connect_beam', { crew: ['p5', 'p6'], beam: 'b1', a: 'A', b: 'B', column: 'r', height: 0.5 }).diagnostic?.code, 'beam.misaligned');
  rt.world.entities.B.pose.p = [0, 0, L9];
  assert.equal(rt.submit('connect_beam', { crew: ['p5', 'p6'], beam: 'b1', a: 'A', b: 'B', column: 'r', height: 3.0 }).diagnostic?.code, 'reach.too-high');
});

test('cancel mid-raise continuously lowers to supported lying instead of abandoning the frame', () => {
  const rt = setup();
  const r = rt.submit('raise_upright', { crew: ['p1', 'p2'], item: 'A' });
  while (r.phase !== 'raise' && rt.isActive(r.id)) rt.step();
  for (let i = 0; i < 20; i++) rt.step();
  const c = rt.cancel(r.id);
  assert.equal(c.diagnostic, undefined);
  assert.ok(rt.isActive(r.id));
  rt.runUntilIdle(2000, [r.id]);
  assert.equal(r.status, 'cancelled');
  assert.equal(rt.world.entities.A.pose.pitch, Math.PI / 2);
  assert.deepEqual(rt.world.entities.A.support, { kind: 'ground' });
  assert.deepEqual(rt.violations, []);
});

// ---- raise choreography: footers brace the base, lifters walk the frame up ----

/** Closest horizontal distance from p to a point of either column that is ≤ 2.0 m above the ground. */
function reachToFrame(u: Entity, p: [number, number]): number {
  const c = entityCorners(u);
  const avg = (i: number, j: number) => [0, 1, 2].map((k) => (c[i][k] + c[j][k]) / 2);
  let best = Infinity;
  for (const xi of [0, 1]) {
    const a = avg(xi * 4, xi * 4 + 1), b = avg(xi * 4 + 2, xi * 4 + 3);
    for (let k = 0; k <= 400; k++) {
      const q = a.map((v, i) => v + ((b[i] - v) * k) / 400);
      if (q[1] > 2.0) continue;
      best = Math.min(best, hypot(q[0] - p[0], q[2] - p[1]));
    }
  }
  return best;
}

/** Watch a raise: lifter hand/reach, lifter ground speed, slots seen. */
function watchRaise(rt: Runtime, rec: { id: string; phase?: string }, item: string, lifters: string[]) {
  const seen = { maxHandY: 0, maxHandDist: 0, maxReach: 0, maxSpeed: 0, slots: new Map<string, string[]>(), ticks: 0 };
  const last = new Map<string, [number, number]>();
  rt.observers.push({
    onTick: (r) => {
      if (!r.isActive(rec.id) || rec.phase === 'approach') return;
      const u = r.world.entities[item];
      for (const id of new Set([...lifters, ...(u.support?.kind === 'held' ? u.support.by : [])])) {
        const h = r.world.entities[id];
        const slot = h.human!.grip?.slot;
        const list = seen.slots.get(id) ?? [];
        if (slot && list[list.length - 1] !== slot) list.push(slot);
        seen.slots.set(id, list);
      }
      for (const id of lifters) {
        const h = r.world.entities[id];
        const p: [number, number] = [h.pose.p[0], h.pose.p[2]];
        const q = last.get(id);
        if (q) seen.maxSpeed = Math.max(seen.maxSpeed, hypot(p[0] - q[0], p[1] - q[1]) * 20);
        last.set(id, p);
        if (h.human!.grip?.slot !== 'lift-far') continue;
        seen.ticks++;
        seen.maxReach = Math.max(seen.maxReach, reachToFrame(u, p));
        // the engine's own hand point (on the lifter's column)
        const side = raiseRoles((rt.records.get(rec.id)!.params as { crew: string[] }).crew).find((x) => x.actor === id)!.side;
        const hand = liftHandPoint(u, 0, def(u.def).size[2] / 2, side);
        seen.maxHandY = Math.max(seen.maxHandY, hand[1]);
        seen.maxHandDist = Math.max(seen.maxHandDist, hypot(hand[0] - p[0], hand[2] - p[1]));
      }
    },
  });
  return seen;
}

test('raise choreography (2 people): lifter walks the frame up, hands ≤ 2.0 m and within reach, ≤ 0.6 m/s; footer braces the base', () => {
  const rt = setup();
  const r = rt.submit('raise_upright', { crew: ['p1', 'p2'], item: 'A' });
  assert.notEqual(r.status, 'failed', r.diagnostic?.message);
  const seen = watchRaise(rt, r, 'A', ['p2']);
  rt.runUntilIdle(20 * 120, [r.id]);
  assert.equal(r.status, 'completed', r.diagnostic?.message);
  assert.ok(seen.ticks > 40, `lifter walked the frame up over ${seen.ticks} ticks`);
  assert.ok(seen.maxHandY <= 2.0 + 1e-9, `lifter hands at most ${seen.maxHandY.toFixed(3)} m up`);
  assert.ok(seen.maxHandDist <= 0.9, `hands within ${seen.maxHandDist.toFixed(3)} m of the lifter`);
  assert.ok(seen.maxReach <= 0.9, `frame (≤ 2.0 m up) within ${seen.maxReach.toFixed(3)} m of the lifter throughout`);
  assert.ok(seen.maxSpeed <= 0.6 + 1e-6, `lifter ground speed ≤ 0.6 m/s (max ${seen.maxSpeed.toFixed(3)})`);
  assert.deepEqual(seen.slots.get('p1'), ['foot-l', 'hold-0']);
  assert.deepEqual(seen.slots.get('p2'), ['lift-far', 'hold-1']);
  const A = rt.world.entities.A;
  assert.equal(A.pose.pitch, 0);
  assert.deepEqual(A.support, { kind: 'held', by: ['p1', 'p2'] });
  const st = holdStations(A, 2);
  for (const [i, id] of ['p1', 'p2'].entries()) {
    const h = rt.world.entities[id];
    assert.ok(hypot(h.pose.p[0] - st[i].p[0], h.pose.p[2] - st[i].p[1]) < 1e-6, `${id} ends at hold station ${i}`);
  }
  assert.deepEqual(rt.violations.map((v) => `${v.code}: ${v.message}`), []);
});

test('raise choreography (4 people): two lifters step around the footers to the stations behind the base', () => {
  const rt = setup();
  const r = rt.submit('raise_upright', { crew: ['p1', 'p2', 'p3', 'p4'], item: 'A' });
  assert.notEqual(r.status, 'failed', r.diagnostic?.message);
  const seen = watchRaise(rt, r, 'A', ['p3', 'p4']);
  rt.runUntilIdle(20 * 120, [r.id]);
  assert.equal(r.status, 'completed', r.diagnostic?.message);
  assert.ok(r.history.some((h) => h.phase === 'step'), 'lifters stepped to their base stations');
  assert.ok(seen.maxHandY <= 2.0 + 1e-9 && seen.maxReach <= 0.9 && seen.maxSpeed <= 0.6 + 1e-6, JSON.stringify(seen));
  const st = holdStations(rt.world.entities.A, 4);
  for (const [i, id] of ['p1', 'p2', 'p3', 'p4'].entries()) {
    const h = rt.world.entities[id];
    assert.ok(hypot(h.pose.p[0] - st[i].p[0], h.pose.p[2] - st[i].p[1]) < 1e-6, `${id} ends at hold station ${i}`);
    assert.equal(h.human!.grip?.slot, `hold-${i}`);
  }
  assert.deepEqual(rt.violations.map((v) => `${v.code}: ${v.message}`), []);
});

test('raise choreography: an obstacle on the lifter\'s walk is refused at plan time, or blocks mid-raise without clipping', () => {
  // A lies toward −z; the lifter (p2, crew[1]) walks along x = −(depth/2 + 0.42) from z = −H to the base
  const lx = -(D12 / 2 + 0.42);
  const crate: Obstacle = { id: 'crate', obb: { c: [lx, -1.5], half: [0.15, 0.15], yaw: 0 }, y0: 0, y1: 1.2, kind: 'solid', label: 'tool crate' };
  const early = setup([crate]).submit('raise_upright', { crew: ['p1', 'p2'], item: 'A' });
  assert.equal(early.status, 'failed');
  assert.equal(early.diagnostic?.code, 'raise.station-blocked');
  assert.match(early.diagnostic!.message, /p2 .*tool crate/);

  // appears mid-raise (a wall block set down ahead of the lifter): the raise holds and reports blocked
  const rt = setup();
  const r = rt.submit('raise_upright', { crew: ['p1', 'p2'], item: 'A' });
  while (rt.isActive(r.id) && !(r.phase === 'raise' && (rt.world.entities.A.pose.pitch ?? 0) < 1.0)) rt.step();
  const p2 = rt.world.entities.p2;
  rt.world.entities.wall = component('wall', 'test-wall', [lx - 0.3, 0, p2.pose.p[2] + 1.0], 0, { phase: 'staged' });
  const pitch = rt.world.entities.A.pose.pitch!;
  for (let i = 0; i < 60; i++) rt.step();
  assert.equal(r.status, 'blocked');
  assert.equal(r.diagnostic?.code, 'raise.station-blocked');
  assert.match(r.diagnostic!.message, /p2 cannot walk A up.*proving-ground wall block/);
  assert.ok(rt.world.entities.A.pose.pitch! < pitch && rt.world.entities.A.pose.pitch! > 0.3, 'frame held part-raised');
  assert.deepEqual(rt.world.entities.A.support, { kind: 'held', by: ['p1', 'p2'] });
  assert.deepEqual(rt.violations.map((v) => `${v.code}: ${v.message}`), [], 'no clipping while blocked');
  // cleared: the raise resumes and completes
  delete rt.world.entities.wall;
  rt.runUntilIdle(20 * 60, [r.id]);
  assert.equal(r.status, 'completed', r.diagnostic?.message);
  assert.deepEqual(rt.violations.map((v) => `${v.code}: ${v.message}`), []);
});

test('raise choreography (1 person, 8 ft frame): the lifter walks it up and ends as the footer', () => {
  const rt = setup();
  const T8 = def('upright-8ft').size[2] / 2;
  rt.world.entities.E = component('E', 'upright-8ft', [6, 0, 0], 0, { phase: 'staged', pose: { p: [6, T8, 0], yaw: 0, pitch: LYING } });
  const r = rt.submit('raise_upright', { crew: ['p1'], item: 'E' });
  assert.notEqual(r.status, 'failed', r.diagnostic?.message);
  const seen = watchRaise(rt, r, 'E', ['p1']);
  rt.runUntilIdle(20 * 120, [r.id]);
  assert.equal(r.status, 'completed', r.diagnostic?.message);
  assert.ok(seen.ticks > 20 && seen.maxHandY <= 2.0 + 1e-9 && seen.maxReach <= 0.9 && seen.maxSpeed <= 0.6 + 1e-6, JSON.stringify({ ...seen, slots: [...seen.slots] }));
  assert.deepEqual(seen.slots.get('p1'), ['lift-far', 'hold-0']);
  const E = rt.world.entities.E, h = rt.world.entities.p1;
  assert.equal(E.pose.pitch, 0);
  assert.deepEqual(E.support, { kind: 'held', by: ['p1'] });
  const st = holdStations(E, 1)[0];
  assert.ok(hypot(h.pose.p[0] - st.p[0], h.pose.p[2] - st.p[1]) < 1e-6, 'ends at the base station');
  assert.deepEqual(rt.violations.map((v) => `${v.code}: ${v.message}`), []);
});

// ---- 19 ft frames (catalog: raiseCrew 3, holdCrew 2): a successful raise, not only the refusal ----

test('19 ft bay: 3 people raise each 19 ft frame (hands ≤ 1.9 m, ≤ 0.6 m/s), premature release refused, 12 ft beams at 0.5 m + 1.8 m, stable release', () => {
  const T19 = def('upright-19ft'), L12 = def('beam-12ft').size[0], D19 = T19.size[0], R19 = T19.size[2] / 2;
  assert.equal(T19.handling?.raiseCrew, 3);
  assert.equal(T19.handling?.holdCrew, 2);
  const base = openGround();
  const w = addAll(
    emptyWorld('open-ground', base),
    // A lies toward −z (yaw π), B toward +z (yaw 0); bases one 12 ft beam apart
    component('A', 'upright-19ft', [0, 0, 0], Math.PI, { phase: 'staged', pose: { p: [0, R19, 0], yaw: Math.PI, pitch: LYING } }),
    component('B', 'upright-19ft', [0, 0, L12], 0, { phase: 'staged', pose: { p: [0, R19, L12], yaw: 0, pitch: LYING } }),
    ...['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'].map((id, i) => human(id, -6 + i * 1.2, -9)),
  );
  const reg = new Map<string, ActionDef>([['walk_to', walkTo], ...CONSTRUCTION_ACTIONS.map((a) => [a.verb, a] as [string, ActionDef])]);
  const rt = new Runtime(w, reg, { spatial: new Spatial(base) }, [...DEFAULT_INVARIANTS, uprightsSupported, liftHandsInReach]);

  for (const [item, crew] of [['A', ['p1', 'p2', 'p3']], ['B', ['p4', 'p5', 'p6']]] as const) {
    const r = rt.submit('raise_upright', { crew: [...crew], item });
    assert.notEqual(r.status, 'failed', r.diagnostic?.message);
    const lifters = raiseRoles([...crew]).filter((x) => x.lifter).map((x) => x.actor);
    assert.deepEqual(lifters, crew.slice(1), 'one footer, two lifters');
    const seen = watchRaise(rt, r, item, lifters);
    rt.runUntilIdle(20 * 180, [r.id]);
    assert.equal(r.status, 'completed', r.diagnostic?.message);
    assert.ok(seen.ticks > 40, `lifters walked ${item} up over ${seen.ticks} ticks`);
    assert.deepEqual(crew.map((id) => seen.slots.get(id)), [['foot-l', 'hold-0'], ['lift-far', 'hold-1'], ['lift-far', 'hold-2']]);
    assert.ok(seen.maxHandY <= 1.9 + 1e-9, `lifter hands at most ${seen.maxHandY.toFixed(3)} m up`);
    assert.ok(seen.maxHandDist <= 0.9 && seen.maxReach <= 0.9, `hands/frame within reach: ${seen.maxHandDist.toFixed(3)} / ${seen.maxReach.toFixed(3)} m`);
    assert.ok(seen.maxSpeed <= 0.6 + 1e-6, `lifter ground speed ≤ 0.6 m/s (max ${seen.maxSpeed.toFixed(3)})`);
    assert.ok(r.history.some((h) => h.phase === 'step'), 'the station-2 lifter stepped around the footer');
    const u = rt.world.entities[item];
    assert.equal(u.pose.pitch, 0);
    assert.deepEqual(u.support, { kind: 'held', by: [...crew] });
    const st = holdStations(u, 3);
    for (const [i, id] of crew.entries()) {
      const h = rt.world.entities[id];
      assert.ok(hypot(h.pose.p[0] - st[i].p[0], h.pose.p[2] - st[i].p[1]) < 1e-6, `${id} ends at hold station ${i}`);
      assert.equal(h.human!.grip?.slot, `hold-${i}`);
    }
    const early = rt.submit('release_support', { item });
    assert.equal(early.diagnostic?.code, 'support.release-premature');
  }
  // beams lie on the ground under their seats, along the bay
  const x = D19 / 2;
  rt.world.entities.b1 = component('b1', 'beam-12ft', [-x, 0, L12 / 2], Math.PI / 2, { phase: 'staged' });
  rt.world.entities.b2 = component('b2', 'beam-12ft', [x, 0, L12 / 2], Math.PI / 2, { phase: 'staged' });
  rt.world.entities.b3 = component('b3', 'beam-12ft', [-x + 0.25, 0, L12 / 2], Math.PI / 2, { phase: 'staged' });
  rt.world.entities.b4 = component('b4', 'beam-12ft', [x - 0.25, 0, L12 / 2], Math.PI / 2, { phase: 'staged' });
  const connect = (beam: string, column: 'l' | 'r', height: number) => {
    const r = run(rt, 'connect_beam', { crew: ['p7', 'p8'], beam, a: 'A', b: 'B', column, height });
    assert.equal(r.status, 'completed', `${beam}: ${r.status} ${r.phase} ${r.diagnostic?.message}`);
  };
  connect('b1', 'r', 0.5);
  connect('b2', 'l', 0.5);
  const mid = rt.submit('release_support', { item: 'A' });
  assert.equal(mid.diagnostic?.code, 'support.release-premature', 'one beam level is not enough for 19 ft frames');
  assert.match(mid.diagnostic!.message, /≥2 heights/);
  connect('b3', 'r', 1.8);
  connect('b4', 'l', 1.8);
  assert.ok(groupStability(rt.world, rt.world.entities.A).stable, JSON.stringify(groupStability(rt.world, rt.world.entities.A).missing));
  assert.equal(run(rt, 'release_support', { item: 'A' }).status, 'completed');
  assert.equal(run(rt, 'release_support', { item: 'B' }).status, 'completed');
  assert.equal(rt.world.entities.A.phase, 'installed');
  assert.equal(rt.world.entities.B.phase, 'installed');
  assert.deepEqual(rt.violations.map((v) => `${v.code}: ${v.message}`), []);
});


test('connect_beam mid-lift cancellation retains the supported load, hands and reservations until installation (LM-038)', () => {
  const rt = setup();
  assert.equal(run(rt, 'raise_upright', { crew: ['p1', 'p2'], item: 'A' }).status, 'completed');
  assert.equal(run(rt, 'raise_upright', { crew: ['p3', 'p4'], item: 'B' }).status, 'completed');
  stageBeams(rt);
  checkInstallCancellation(rt, 'connect_beam', { crew: ['p5', 'p6'], beam: 'b1', a: 'A', b: 'B', column: 'r', height: 0.5 }, 'b1', 'beam.cancel-unsafe');
});
