// Carrying up a stair flight (spec §7 "materials to upper levels"; CARRY.md "Between levels"): one
// carrier takes a small part from the ground up the proving ground's complete stairs A (1.0 m wide,
// 3 m rise) onto the deck (level 1) and sets it down there. Geometry is re-audited independently
// every tick: the load's box against the flight's steps (exact per-tread boxes, not the planner's
// profile), carrier continuity, and people it must not touch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { Runtime } from '../runtime/runtime.ts';
import { DEFAULT_INVARIANTS, forgetMotion } from '../runtime/invariants.ts';
import { Spatial } from '../spatial/service.ts';
import { provingGround, DECK_Y } from '../scenes/proving-ground.ts';
import { emptyWorld, human, addAll, component } from '../world/factory.ts';
import { walkTo } from '../locomotion/walk.ts';
import { carry } from '../carry/actions.ts';
import { CARRY_INVARIANTS } from '../carry/invariants.ts';
import { boxEdgeSamples } from '../carry/climb.ts';
import { entityFrame } from '../carry/formation.ts';
import { stagedCheck } from '../construction/access.ts';
import type { ActionDef } from '../actions/types.ts';
import type { Entity } from '../world/types.ts';
import type { SpatialScene } from '../spatial/types.ts';

const REG = new Map<string, ActionDef>([['walk_to', walkTo], ['carry', carry]]);
function setup(base: SpatialScene, ...es: Entity[]) {
  const w = addAll(emptyWorld('carry-stairs-test', base), ...es);
  return new Runtime(w, REG, { spatial: new Spatial(base) }, [...DEFAULT_INVARIANTS, ...CARRY_INVARIANTS]);
}

/**
 * Independent audit of stairs A (x ∈ [2, 6] at z = 10, rise 3 m over 16 steps of 0.25 m × 0.1875 m):
 * tread k (1–16) is the box x ∈ [2 + 0.25(k − 0.5), 2 + 0.25(k + 0.5)] ∩ [2, 6], top 0.1875 k; the deck
 * top is 3 m from x = 6. Every sampled point of the carried box above the flight must be ≥ the
 * surface under it − 0.02 m.
 */
function stairSurface(x: number): number {
  if (x < 2) return 0;
  if (x >= 6 - 0.125) return DECK_Y;
  return 0.1875 * Math.round((x - 2) / 0.25);
}
function audit(rt: Runtime, item: string, carrier: string, watch: string[] = []) {
  const s = { climbTicks: 0, minGap: Infinity, maxTilt: 0, personGap: Infinity, waits: 0 };
  rt.observers.push({
    onTick() {
      const e = rt.world.entities[item];
      if (e.phase !== 'carried') return;
      const h = rt.world.entities[carrier];
      if (h.human!.activity.startsWith('climb')) s.climbTicks++;
      if (h.human!.activity === 'climb-wait') s.waits++;
      s.maxTilt = Math.max(s.maxTilt, Math.abs(e.pose.roll ?? 0));
      const pts = boxEdgeSamples(e.def, e.pose);
      for (const p of pts) if (Math.abs(p[2] - 10) < 0.6 && p[0] > 1.5 && p[0] < 7) s.minGap = Math.min(s.minGap, p[1] - stairSurface(p[0]));
      // watched people: plan distance from their body axis to any point of the load at body height
      for (const id of watch) {
        const o = rt.world.entities[id];
        for (const p of pts) if (p[1] >= o.pose.p[1] && p[1] <= o.pose.p[1] + 1.8) s.personGap = Math.min(s.personGap, Math.hypot(p[0] - o.pose.p[0], p[2] - o.pose.p[2]));
      }
    },
  });
  return s;
}

const tread = (id: string, x: number, z: number) => component(id, 'stair-tread', [x, 0, z], 0);

test('carry-stairs: one person carries a stair tread from the ground up stairs A onto the deck (and back down)', () => {
  const rt = setup(provingGround(), tread('t1', -3, 10), human('p1', -4, 12));
  const t0 = performance.now();
  const a = rt.submit('carry', { crew: ['p1'], item: 't1', to: { x: 10, z: 10, yaw: Math.PI / 2, level: 1 } });
  const planMs = performance.now() - t0;
  assert.equal(a.status, 'executing', a.diagnostic?.message);
  const s = audit(rt, 't1', 'p1');
  const w0 = performance.now();
  assert.ok(rt.runUntilIdle(20 * 180));
  console.log(`  tread up stairs A: plan ${planMs.toFixed(0)} ms, run ${(performance.now() - w0).toFixed(0)} ms, ${(rt.tick / 20).toFixed(1)} s simulated, min gap ${s.minGap.toFixed(2)} m, tilt ${(s.maxTilt * 57.3).toFixed(0)}°`);
  assert.equal(a.status, 'completed', a.diagnostic?.message);
  assert.deepEqual(rt.violations.map((v) => v.message), []);
  const t = rt.world.entities.t1;
  assert.equal(t.phase, 'staged');
  assert.deepEqual(t.support, { kind: 'ground' });
  assert.ok(Math.abs(entityFrame(t).bottom - DECK_Y) < 1e-6, `resting on the deck (bottom ${entityFrame(t).bottom})`);
  assert.equal(rt.world.entities.p1.human!.level, 1);
  assert.equal(a.outputs!.level, 1);
  assert.equal(a.outputs!.via, 'stairs-a');
  assert.ok(s.climbTicks > 100, `climbed for ${s.climbTicks} ticks`);
  assert.ok(s.minGap >= -0.02, `load above the steps (min gap ${s.minGap})`);
  // staged on the deck: install_* can take it (stagedCheck: lying on its support near the target)
  assert.equal(stagedCheck(t, [10.5, 10], 'x'), null);
  // and back down (descending: the same traversal reversed)
  const d = rt.submit('carry', { crew: ['p1'], item: 't1', to: { x: -3, z: 6, yaw: 0, level: 0 } });
  assert.equal(d.status, 'executing', d.diagnostic?.message);
  assert.ok(rt.runUntilIdle(20 * 180));
  assert.equal(d.status, 'completed', d.diagnostic?.message);
  assert.deepEqual(rt.violations.map((v) => v.message), []);
  assert.equal(rt.world.entities.p1.human!.level, 0);
  assert.ok(Math.abs(entityFrame(rt.world.entities.t1).bottom) < 1e-6, 'back on the ground');
});

const board = (id: string, def: string, x: number, z: number) => component(id, def, [x, 0, z], 0);

test('carry-stairs: an 8 ft 2x4 goes up too (tilted along the flight); cancelling on the flight is refused', () => {
  const rt = setup(provingGround(), board('b', '2x4-8ft', -3, 10), human('p1', -4, 12));
  const t0 = performance.now();
  const a = rt.submit('carry', { crew: ['p1'], item: 'b', to: { x: 10, z: 10, yaw: Math.PI / 2, level: 1 } });
  const planMs = performance.now() - t0;
  assert.equal(a.status, 'executing', a.diagnostic?.message);
  const s = audit(rt, 'b', 'p1');
  let refused = false;
  for (let t = 0; t < 20 * 180 && rt.isActive(a.id); t++) {
    rt.step();
    if (!refused && rt.world.entities.p1.pose.p[1] > 1.5) {
      const r = rt.cancel(a.id);
      assert.equal(r.status, 'executing');
      assert.equal(r.diagnostic?.code, 'carry.cancel-unsafe');
      assert.match(r.diagnostic!.message, /stairs-a/);
      refused = true;
    }
  }
  console.log(`  8 ft 2x4 up stairs A: plan ${planMs.toFixed(0)} ms, ${(rt.tick / 20).toFixed(1)} s simulated, min gap ${s.minGap.toFixed(2)} m, tilt ${(s.maxTilt * 57.3).toFixed(0)}°`);
  assert.ok(refused);
  assert.equal(a.status, 'completed', a.diagnostic?.message);
  assert.deepEqual(rt.violations.map((v) => v.message), []);
  assert.ok(s.maxTilt > 0.6, 'tilted along the 37° flight');
  assert.ok(s.minGap >= -0.02, `load above the steps (min gap ${s.minGap})`);
  const b = rt.world.entities.b;
  assert.equal(b.phase, 'staged');
  assert.ok(Math.abs(entityFrame(b).bottom - DECK_Y) < 1e-6);
  assert.ok(Math.abs(b.pose.roll ?? 0) < 1e-9, 'no tilt left once laid');
});

test('carry-stairs: a 4x6 plywood panel on the 1.0 m stairs is refused (carry.stairs-too-narrow); incomplete stairs B → route.link-unusable', () => {
  const rt = setup(provingGround(), board('ply', 'plywood-4x6', -3, 10), tread('t1', 21, 10), human('p1', -4, 12), human('p2', 22, 12));
  const before = rt.stateHash();
  const a = rt.submit('carry', { crew: ['p1'], item: 'ply', to: { x: 10, z: 10, yaw: 0, level: 1 } });
  assert.equal(a.status, 'failed');
  assert.equal(a.diagnostic!.code, 'carry.stairs-too-narrow');
  assert.match(a.diagnostic!.message, /4x6 plywood sheet ply .*stairs-a is 1\.00 m wide/);
  assert.deepEqual(a.diagnostic!.subjects, ['ply', 'stairs-a']);
  // explicitly up stairs B (treads 6–9 missing)
  const b = rt.submit('carry', { crew: ['p2'], item: 't1', to: { x: 12, z: 10, yaw: 0, level: 1 }, via: 'stairs-b' });
  assert.equal(b.status, 'failed');
  assert.equal(b.diagnostic!.code, 'route.link-unusable');
  assert.match(b.diagnostic!.message, /stairs-b.*treads 6–9 not installed/);
  // the only flight in reach is incomplete: the person's own route names it
  const rt2 = setup(provingGround({ stairsAUsable: false }), tread('t1', 21, 10), human('p2', 22, 12));
  const c = rt2.submit('carry', { crew: ['p2'], item: 't1', to: { x: 12, z: 10, yaw: 0, level: 1 } });
  assert.equal(c.diagnostic?.code, 'route.link-unusable');
  assert.match(c.diagnostic!.message, /stairs-b \(treads 6–9 not installed\)/);
  // a head-height beam across the flight: the tilted load would hit it (walk_to has no head clearance; the load does)
  const low = { id: 'low-beam', label: 'low beam over stairs A', kind: 'solid' as const, obb: { c: [4, 10] as [number, number], half: [0.1, 0.8] as [number, number], yaw: 0 }, y0: 2.3, y1: 2.5 };
  const rt4 = setup(provingGround({ extra: [low] }), tread('t1', -3, 10), human('p1', -4, 12));
  const d = rt4.submit('carry', { crew: ['p1'], item: 't1', to: { x: 10, z: 10, yaw: 0, level: 1 } });
  assert.equal(d.diagnostic?.code, 'carry.stairs-clearance');
  assert.match(d.diagnostic!.message, /would hit 'low beam over stairs A'/);
  // crews between levels stay deferred
  const rt3 = setup(provingGround(), component('beam', 'beam-12ft', [-3, 0, 10], 0), human('p1', -4, 12), human('p2', -2, 8));
  assert.equal(rt3.submit('carry', { crew: ['p1', 'p2'], item: 'beam', to: { x: 10, z: 10, yaw: 0, level: 1 } }).diagnostic?.code, 'carry.level-change');
  assert.equal(rt.stateHash(), before, 'rejected before anything moved');
});

test('carry-stairs invariant: a load pushed into the steps mid-climb is reported (carry.stairs-clearance)', () => {
  const rt = setup(provingGround(), tread('t1', -3, 10), human('p1', -4, 12));
  const a = rt.submit('carry', { crew: ['p1'], item: 't1', to: { x: 10, z: 10, yaw: 0, level: 1 } });
  for (let t = 0; t < 20 * 90 && rt.world.entities.p1.pose.p[1] < 1.5; t++) rt.step();
  assert.equal(a.phase, 'climb');
  assert.deepEqual(rt.violations, []);
  const inv = CARRY_INVARIANTS[2];
  assert.deepEqual(inv(rt), []);
  const t1 = rt.world.entities.t1;
  t1.pose.p[1] -= 0.9; // shove the load down into the treads
  const v = inv(rt);
  assert.deepEqual(v.map((d) => d.code), ['carry.stairs-clearance']);
  assert.match(v[0].message, /step surface of stairs-a/);
  t1.pose.p[1] += 0.9;
});

test('carry-stairs: determinism — the same stair carry gives the same final state hash', () => {
  const run = () => {
    const rt = setup(provingGround(), tread('t1', -3, 10), human('p1', -4, 12));
    const a = rt.submit('carry', { crew: ['p1'], item: 't1', to: { x: 10, z: 10, yaw: Math.PI / 2, level: 1 } });
    rt.runUntilIdle(20 * 180);
    assert.equal(a.status, 'completed');
    return rt.stateHash();
  };
  const h1 = run(), h2 = run();
  console.log(`  stair carry hash ${h1.slice(0, 12)}…`);
  assert.equal(h1, h2);
});

test('carry-stairs: someone on the flight or at its top makes the carrier wait (climb-wait), never pass through', () => {
  // (a) p2 stands on the flight (a walker paused there): the carrier waits below until p2 is gone
  const rt = setup(provingGround(), board('b', '2x4-8ft', -3, 10), human('p1', -4, 12), human('p2', 4.5, 10, { level: 0, y: 0.75 * 2.5 }));
  const p2 = rt.world.entities.p2; // on the step path at x = 4.5
  p2.human!.activity = 'climb-wait'; // a walker paused on a flight (exempt from the floor grid, as walk_to's)
  const a = rt.submit('carry', { crew: ['p1'], item: 'b', to: { x: 10, z: 10, yaw: Math.PI / 2, level: 1 } });
  assert.equal(a.status, 'executing', a.diagnostic?.message);
  const s = audit(rt, 'b', 'p1', ['p2']);
  let blocked = 0;
  for (let t = 0; t < 20 * 60; t++) {
    rt.step();
    if ((a.status as string) === 'blocked') {
      blocked++;
      assert.equal(a.diagnostic!.code, 'traffic.person');
      assert.equal(rt.world.entities.p1.human!.activity, 'climb-wait');
    }
  }
  assert.ok(blocked > 20 * 20, `carrier waited ${blocked} ticks`);
  assert.equal(a.status, 'blocked');
  assert.ok(s.personGap > 0.28, `load kept ${s.personGap.toFixed(2)} m from p2`);
  // p2 leaves the flight (moved by hand onto the deck): the carrier goes on
  p2.pose = { p: [12, DECK_Y, 8], yaw: 0 };
  p2.human!.level = 1;
  p2.human!.activity = 'idle';
  forgetMotion(rt);
  assert.ok(rt.runUntilIdle(20 * 120));
  assert.equal(a.status, 'completed', a.diagnostic?.message);
  assert.deepEqual(rt.violations.map((v) => v.message), []);

  // (b) p3 idles on the deck right where the flight lands: the carrier waits, asks p3 to step aside, finishes
  const rt2 = setup(provingGround(), board('b', '2x4-8ft', -3, 10), human('p1', -4, 12), human('p3', 6.9, 10, { level: 1, y: DECK_Y }));
  const c = rt2.submit('carry', { crew: ['p1'], item: 'b', to: { x: 10, z: 10, yaw: Math.PI / 2, level: 1 } });
  assert.equal(c.status, 'executing', c.diagnostic?.message);
  const s2 = audit(rt2, 'b', 'p1', ['p3']);
  let sawWait = false;
  rt2.observers.push({ onTick: () => { if (c.status === 'blocked' && c.diagnostic?.code === 'traffic.person') sawWait = true; } });
  assert.ok(rt2.runUntilIdle(20 * 180));
  assert.equal(c.status, 'completed', c.diagnostic?.message);
  assert.ok(sawWait && s2.waits > 0, 'the carrier waited for p3');
  assert.ok(s2.personGap > 0.28, `load kept ${s2.personGap.toFixed(2)} m from p3`);
  assert.deepEqual(rt2.violations.map((v) => v.message), []);
  assert.ok([...rt2.records.values()].some((r) => r.verb === 'walk_to' && (r.params as { actor: string }).actor === 'p3' && r.status === 'completed'), 'p3 stepped aside');
});

test('carry-stairs: a walker heading up behind the carrier waits at the foot (the loaded flight is exclusive)', () => {
  const rt = setup(provingGround(), tread('t1', -3, 10), human('p1', -4, 12), human('w', -1, 7));
  const a = rt.submit('carry', { crew: ['p1'], item: 't1', to: { x: 10, z: 10, yaw: Math.PI / 2, level: 1 } });
  assert.equal(a.status, 'executing', a.diagnostic?.message);
  const s = audit(rt, 't1', 'p1', ['w']);
  for (let t = 0; t < 20 * 60 && rt.world.entities.p1.pose.p[1] < 0.5; t++) rt.step();
  const w = rt.submit('walk_to', { actor: 'w', x: 12, z: 11, level: 1 });
  assert.equal(w.status, 'executing', w.diagnostic?.message);
  let yielded = false;
  rt.observers.push({ onTick: () => { if (w.status === 'blocked' && w.diagnostic?.code === 'traffic.yield') yielded = true; } });
  assert.ok(rt.runUntilIdle(20 * 180));
  assert.equal(a.status, 'completed', a.diagnostic?.message);
  assert.equal(w.status, 'completed', w.diagnostic?.message);
  assert.ok(yielded, 'the walker yielded the loaded flight');
  assert.ok(s.personGap > 0.28, `load kept ${s.personGap.toFixed(2)} m from the walker`);
  assert.deepEqual(rt.violations.map((v) => v.message), []);
});
