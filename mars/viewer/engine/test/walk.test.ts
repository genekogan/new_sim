// Runtime-level locomotion regressions: actors actually move through the
// proving ground on the fixed-step runtime with invariants enabled.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from '../runtime/runtime.ts';
import { DEFAULT_INVARIANTS } from '../runtime/invariants.ts';
import { Spatial } from '../spatial/service.ts';
import { provingGround, DECK_Y } from '../scenes/proving-ground.ts';
import { emptyWorld, human, addAll, component } from '../world/factory.ts';
import { walkTo } from '../locomotion/walk.ts';
import type { ActionDef } from '../actions/types.ts';

function setup(...people: ReturnType<typeof human>[]) {
  const base = provingGround();
  const w = addAll(emptyWorld('proving-ground', base), ...people);
  const rt = new Runtime(w, new Map<string, ActionDef>([['walk_to', walkTo]]), { spatial: new Spatial(base) }, DEFAULT_INVARIANTS);
  return rt;
}
const pos = (rt: Runtime, id: string) => rt.world.entities[id].pose.p;

/** Heading changes per tick while walking: detects jitter/dancing. */
function trackJitter(rt: Runtime, id: string) {
  const s = { flips: 0, last: 0, prevTurn: 0, maxStep: 0, prev: [...pos(rt, id)] };
  rt.observers.push({
    onTick() {
      const e = rt.world.entities[id];
      const d = e.pose.yaw - s.last;
      const turn = Math.sign(Math.abs(d) > 1e-3 ? d : 0);
      if (turn && s.prevTurn && turn !== s.prevTurn) s.flips++;
      if (turn) s.prevTurn = turn;
      s.last = e.pose.yaw;
      const p = e.pose.p;
      s.maxStep = Math.max(s.maxStep, Math.hypot(p[0] - s.prev[0], p[2] - s.prev[2]));
      s.prev = [...p];
    },
  });
  return s;
}

test('walk around wall: completes, no penetration, no teleport, little heading jitter', () => {
  const rt = setup(human('p1', -18, -15, { yaw: 0 }));
  const j = trackJitter(rt, 'p1');
  const a = rt.submit('walk_to', { actor: 'p1', x: -12, z: -15 });
  assert.equal(a.status, 'executing', a.diagnostic?.message);
  assert.ok(rt.runUntilIdle(20 * 60));
  assert.equal(a.status, 'completed');
  const p = pos(rt, 'p1');
  assert.ok(Math.hypot(p[0] + 12, p[2] + 15) < 0.05);
  assert.deepEqual(rt.violations, []);
  assert.ok(j.maxStep <= 1.4 / 20 + 1e-6, `max step ${j.maxStep}`);
  assert.ok(j.flips <= 6, `turn direction flips ${j.flips}`);
  assert.ok(rt.time < 14, `took ${rt.time}s`);
});

test('stairs: oblique start climbs real steps to the deck and ends on level 1', () => {
  const rt = setup(human('p1', 3.5, 12.5));
  const heights: number[] = [];
  rt.observers.push({ onTick: () => heights.push(pos(rt, 'p1')[1]) });
  const a = rt.submit('walk_to', { actor: 'p1', x: 10, z: 10, level: 1 });
  assert.equal(a.status, 'executing', a.diagnostic?.message);
  assert.ok(rt.runUntilIdle(20 * 120));
  assert.equal(a.status, 'completed');
  assert.equal(rt.world.entities.p1.human!.level, 1);
  assert.ok(Math.abs(pos(rt, 'p1')[1] - DECK_Y) < 1e-6);
  // height rises monotonically and continuously (no teleport up)
  for (let i = 1; i < heights.length; i++) {
    assert.ok(heights[i] >= heights[i - 1] - 1e-9);
    assert.ok(heights[i] - heights[i - 1] < 0.1);
  }
  assert.ok(a.history.some((h) => h.phase === 'align') && a.history.some((h) => h.phase === 'climb'));
  assert.deepEqual(rt.violations, []);
});

test('narrow passage: opposing walkers take turns, no overlap, no oscillation', () => {
  const rt = setup(human('n1', 15, -20, { yaw: Math.PI / 2 }), human('s1', 15, -10, { yaw: -Math.PI / 2 }));
  const a = rt.submit('walk_to', { actor: 'n1', x: 15, z: -10.5 });
  const b = rt.submit('walk_to', { actor: 's1', x: 15, z: -19.5 });
  assert.ok(rt.runUntilIdle(20 * 90), `still running: ${a.status}/${b.status} ${a.diagnostic?.message ?? ''} ${b.diagnostic?.message ?? ''}`);
  assert.equal(a.status, 'completed');
  assert.equal(b.status, 'completed');
  assert.deepEqual(rt.violations.map((v) => v.message), []);
  const yields = [a, b].map((r) => r.history.filter((h) => h.status === 'blocked').length);
  assert.ok(yields.some((y) => y >= 1), 'someone yielded');
  assert.ok(yields.every((y) => y <= 1), `no repeated yield/resume flip-flop: ${yields}`);
});

test('construction mid-walk: new obstacle on the route triggers one replan, no penetration', () => {
  const rt = setup(human('p1', 15, -22));
  const a = rt.submit('walk_to', { actor: 'p1', x: 15, z: -8 });
  for (let i = 0; i < 20; i++) rt.step();
  // a plywood sheet is installed across the gap
  rt.world.entities['panel'] = component('panel', 'plywood-4x8', [15, 0, -15], 0, { phase: 'installed', pose: { p: [15, 0, -15], yaw: 0, roll: Math.PI / 2 } });
  assert.ok(rt.runUntilIdle(20 * 120));
  assert.equal(a.status, 'completed', a.diagnostic?.message);
  assert.equal(a.outputs?.replans, 1);
  assert.deepEqual(rt.violations, []);
});

test('standing person on the route: brief pause at most, no turn/walk flicker, no overlap', () => {
  const rt = setup(human('w', -25, 20), human('idle', -20, 20));
  const a = rt.submit('walk_to', { actor: 'w', x: -15, z: 20 });
  assert.ok(rt.runUntilIdle(20 * 60));
  assert.equal(a.status, 'completed', a.diagnostic?.message);
  const blockedTicks = a.history.reduce((n, h, i, H) => (h.status === 'blocked' ? n + ((H[i + 1]?.tick ?? h.tick) - h.tick) : n), 0);
  assert.ok(blockedTicks <= 20, `blocked for ${blockedTicks} ticks`);
  const phaseFlips = a.history.filter((h) => h.phase === 'turn').length;
  assert.ok(phaseFlips <= 3, `turn phases ${phaseFlips}`);
  assert.deepEqual(rt.violations.map((v) => v.message), []);
});

test('unreachable goal is rejected before any movement', () => {
  const rt = setup(human('p1', 0, 0));
  rt.world.entities.p1.human!.level = 0;
  const base = provingGround({ stairsAUsable: false });
  rt.services.spatial = new Spatial(base);
  const a = rt.submit('walk_to', { actor: 'p1', x: 10, z: 10, level: 1 });
  assert.equal(a.status, 'failed');
  assert.equal(a.diagnostic?.code, 'route.link-unusable');
  assert.deepEqual(pos(rt, 'p1'), [0, 0, 0]);
});

test('determinism: same inputs → same final state hash', () => {
  const run = () => {
    const rt = setup(human('n1', 15, -20), human('s1', 15, -10), human('p1', -15, 12));
    rt.submit('walk_to', { actor: 'n1', x: 15, z: -10.5 });
    rt.submit('walk_to', { actor: 's1', x: 15, z: -19.5 });
    rt.submit('walk_to', { actor: 'p1', x: -15, z: 20 });
    rt.runUntilIdle(20 * 120);
    return rt.stateHash();
  };
  assert.equal(run(), run());
});

test('cancel mid-climb (review M2): the walker finishes at the nearer landing on its level, cancelled, no violations', () => {
  for (const [frac, level, y] of [[0.3, 0, 0], [0.7, 1, DECK_Y]] as const) {
    const rt = setup(human('p1', 3.5, 12.5));
    const a = rt.submit('walk_to', { actor: 'p1', x: 10, z: 10, level: 1 });
    assert.equal(a.status, 'executing', a.diagnostic?.message);
    let n = 0;
    while (pos(rt, 'p1')[1] < frac * DECK_Y && n++ < 20 * 60) rt.step();
    assert.equal(a.phase, 'climb');
    const at = pos(rt, 'p1')[1];
    const c = rt.cancel(a.id);
    assert.equal(c.status, 'executing', 'cancel is deferred while on the flight');
    assert.equal(c.phase, 'cancelling');
    assert.ok(rt.runUntilIdle(20 * 60, [a.id]), 'deferred cancel finishes');
    assert.equal(a.status, 'cancelled');
    const h = rt.world.entities.p1.human!;
    assert.equal(h.level, level, `cancelled at ${(at / DECK_Y).toFixed(2)} of the climb → ${level ? 'top' : 'bottom'} landing`);
    assert.ok(Math.abs(pos(rt, 'p1')[1] - y) < 1e-6, `stands at landing height ${y}, got ${pos(rt, 'p1')[1]}`);
    assert.equal(h.activity, 'idle');
    assert.equal(h.task, undefined);
    assert.equal([...((rt.services.traffic as Map<string, unknown>) ?? new Map()).keys()].filter((k) => k.startsWith('link:')).length, 0, 'stair released');
    for (let i = 0; i < 20; i++) rt.step();
    const codes = rt.violations.map((v) => v.code);
    assert.ok(!codes.includes('collision.human-static') && !codes.includes('motion.teleport'), codes.join(', '));
    assert.deepEqual(rt.violations.map((v) => v.message), []);
  }
});
