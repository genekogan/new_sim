// hand_up (owner feedback 2026-09-28 §5 + §6): two on the ground lift a sheet overhead at the edge,
// two standing on the rack beams reach down, take it and lay it in place (staged, then fastened by
// install_plywood). Reach rules are engine rules: a geometry that allows no genuine hand-off is refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { component } from '../world/factory.ts';
import { def } from '../world/catalog.ts';
import { ENVELOPE_TOL, envelopeGap, GIVE_MAX, handsOf, REACH_DOWN } from '../construction/handup.ts';
import { deckSurfaces } from '../construction/contributor.ts';
import { bay, run } from './frame-fixtures.ts';
import { HAND_STEP_MAX, HandupHandsCheck } from './hands-check.ts';
import { restHands } from '../body/model.ts';
import type { Runtime } from '../runtime/runtime.ts';
import { human } from '../world/factory.ts';
import { forklift, FORKLIFT_ACTIONS, FORKLIFT_INVARIANTS } from '../vehicles/forklift.ts';
import { VEHICLE_ACTIONS, VEHICLE_INVARIANTS } from '../vehicles/index.ts';
import { CARRY_INVARIANTS } from '../carry/invariants.ts';

const W = def('plywood-4x6').size[2]; // 1.22 m
const JZ = (L: number) => [L / 2 - 0.75, L / 2 - 0.25, L / 2 + 0.25, L / 2 + 0.75]; // four joists under a sheet laid along the bay

/** A 12 ft-beam bay with joists at seat `seat`, sheet s1 on the ground east of the bay (long side facing the edge). */
function sheetBay(seat: number, extra: Parameters<typeof bay>[1] = []) {
  const L = def('beam-12ft').size[0];
  const b = bay({ seat, beam: 'beam-12ft', joists: JZ(L) }, [component('s1', 'plywood-4x6', [2.6, 0, L / 2], Math.PI / 2, { phase: 'staged' }), ...extra]);
  return { ...b, to: { x: 0, z: L / 2, yaw: Math.PI / 2 } };
}

/** Step until the action ends; check every hand-up holder's hand points each tick. */
function watch(rt: Runtime, id: string, max = 20 * 400) {
  const r = rt.records.get(id)!;
  let ticks = 0, worst = -Infinity, holders = new Set<string>();
  const roles = new Map<string, string>();
  const hc = new HandupHandsCheck();
  while (r.status !== 'completed' && r.status !== 'failed' && ticks < max) {
    rt.step();
    ticks++;
    hc.check(rt); // at the grip = rebuildable from the slot; crouch / reach_down on their way from the hips; hands.teleport
    for (const h of Object.values(rt.world.entities)) {
      const slot = h.human?.grip?.slot;
      if (!slot?.startsWith('handup-')) continue;
      holders.add(h.id);
      roles.set(h.id, slot);
      const hs = handsOf(h);
      assert.ok(hs, `${h.id} publishes no hand points at tick ${rt.tick}`);
      for (const p of hs!) {
        const g = envelopeGap(h.human!.activity, h.pose.p, p);
        worst = Math.max(worst, g);
        assert.ok(g <= ENVELOPE_TOL, `${h.id} (${h.human!.activity}) hand ${g.toFixed(3)} m outside the envelope at tick ${rt.tick}`);
        if (slot.includes('give')) assert.ok(p[1] - h.pose.p[1] <= GIVE_MAX + 1e-9, `${h.id} hands above floor + ${GIVE_MAX}`);
        else assert.ok(h.pose.p[1] - p[1] <= REACH_DOWN + 1e-9, `${h.id} hands more than ${REACH_DOWN} m below feet`);
      }
    }
  }
  return { r, ticks, worst, holders, roles, hc };
}

test('hand_up green: a sheet from the ground to staged on a 2.4 m deck (two givers, two receivers on the beams), 0 violations, hands in reach every tick', () => {
  const { rt, E, top, to } = sheetBay(2.29);
  assert.ok(Math.abs(top - 2.337) < 0.01, `receivers stand at ${top}`);
  assert.ok(Math.abs(top + def('2x4-6ft').size[1] + def('plywood-4x6').size[1] - 2.445) < 0.01, 'deck top ≈ 2.4 m');
  const r = rt.submit('hand_up', { part: 's1', givers: ['p1', 'p2'], receivers: ['p3', 'p4'], to });
  assert.notEqual(r.status, 'failed', `${r.diagnostic?.code} ${r.diagnostic?.message}`);
  const acts = new Map<string, Set<string>>();
  // §6: hands travel — the first tick of a crouch / reach_down has them just below the hips, not on the part
  const firstApproach = new Map<string, number>();
  const orig = rt.step.bind(rt);
  rt.step = () => {
    orig();
    for (const id of ['p1', 'p2', 'p3', 'p4']) {
      const a = E[id].human!.activity;
      (acts.get(id) ?? acts.set(id, new Set()).get(id)!).add(a);
      if ((a === 'crouch' || a === 'reach_down') && !firstApproach.has(`${id}:${a}`)) {
        const hs = handsOf(E[id])!, rest = restHands(E[id]);
        firstApproach.set(`${id}:${a}`, Math.max(...[0, 1].map((i) => Math.sqrt((hs[i][0] - rest[i][0]) ** 2 + (hs[i][1] - rest[i][1]) ** 2 + (hs[i][2] - rest[i][2]) ** 2))));
      }
    }
  };
  const w = watch(rt, r.id);
  rt.step = orig;
  assert.equal(w.r.status, 'completed', `${w.r.diagnostic?.code} ${w.r.diagnostic?.message}`);
  assert.deepEqual([...firstApproach.keys()].sort(), ['p1:crouch', 'p2:crouch', 'p3:reach_down', 'p4:reach_down']);
  for (const [k, d] of firstApproach) assert.ok(d < 0.05, `${k}: hands ${d.toFixed(3)} m from the hips on the first tick`);
  assert.ok(w.hc.approachTicks >= 4 * 12 && w.hc.worstStep <= HAND_STEP_MAX, `approach ticks ${w.hc.approachTicks}, worst hand step ${w.hc.worstStep.toFixed(3)} m/tick`);
  assert.deepEqual([...w.holders].sort(), ['p1', 'p2', 'p3', 'p4'], 'all four held it');
  assert.deepEqual(rt.violations, [], JSON.stringify(rt.violations.slice(0, 3)));
  const s1 = E.s1;
  assert.equal(s1.phase, 'staged');
  assert.equal(s1.support?.kind, 'resting-on');
  assert.ok(Math.abs(s1.pose.p[1] - (top + def('2x4-6ft').size[1])) < 1e-9, 'laid on the joists');
  assert.ok(Math.abs(s1.pose.p[0] - to.x) < 1e-9 && Math.abs(s1.pose.p[2] - to.z) < 1e-9);
  for (const g of ['p1', 'p2']) for (const a of ['crouch', 'lift', 'walk-load', 'reach_up']) assert.ok(acts.get(g)!.has(a), `${g} never ${a}: ${[...acts.get(g)!]}`);
  for (const q of ['p3', 'p4']) for (const a of ['climb-up', 'reach_down', 'take', 'stand_with_load', 'lay', 'set_down']) assert.ok(acts.get(q)!.has(a), `${q} never ${a}: ${[...acts.get(q)!]}`);
  assert.ok(['p3', 'p4'].some((q) => acts.get(q)!.has('beam-walk')), 'one receiver walks the beam to a station beyond the climb');
  for (const q of ['p3', 'p4']) assert.equal(E[q].human!.on, 'beam:b3', `${q} received it standing on the edge beam`);
  assert.equal(E.p1.human!.hands, undefined, 'hands are cleared when they let go');
  // the two up there fasten it: install_plywood (aloft) → a deck appears at 2.50 m
  run(rt, 'install_plywood', { crew: ['p3', 'p4'], sheet: 's1', x: to.x, z: to.z, yaw: to.yaw });
  assert.equal(s1.phase, 'installed');
  assert.equal(deckSurfaces(rt.world).length, 1);
  assert.deepEqual(rt.violations, []);
});

test('hand_up refuses a deck too high for a genuine hand-off (receivers at 3.25 m, deck 3.36 m): use the forklift', () => {
  const { rt, to } = sheetBay(3.2);
  const r = rt.submit('hand_up', { part: 's1', givers: ['p1', 'p2'], receivers: ['p3', 'p4'], to });
  assert.equal(r.status, 'failed');
  assert.equal(r.diagnostic?.code, 'handup.too-high');
  assert.match(r.diagnostic!.message, /givers can raise it to 2\.06 m .* reach 1\.17 m below their feet \(max 1 m\); use the forklift/);
});

test('hand_up refuses receivers who are not on a walkable beam or deck, and a beam without its partner', () => {
  const { rt, to, L } = sheetBay(2.29);
  const off = rt.submit('hand_up', { part: 's1', givers: ['p1', 'p2'], receivers: ['p3', 'p4'], to, stations: [{ x: 0, z: 0.3 }, { x: 0.61, z: 0.4 }] });
  assert.equal(off.status, 'failed');
  assert.equal(off.diagnostic?.code, 'handup.receiver-not-aloft');
  assert.match(off.diagnostic!.message, /\(0\.00, 0\.30\) is not on a walkable beam or a deck/);
  // a beam at 2.29 m on one column only: nobody can stand on it
  const one = bay({ seat: 1.8, beam: 'beam-12ft', extra: [['b5', 1, 2.29]] }, [component('s1', 'plywood-4x6', [2.6, 0, L / 2], Math.PI / 2, { phase: 'staged' })]);
  const r = one.rt.submit('hand_up', { part: 's1', givers: ['p1', 'p2'], receivers: ['p3', 'p4'], to, edge: 'b5' });
  assert.equal(r.status, 'failed');
  assert.equal(r.diagnostic?.code, 'handup.no-walkway');
  assert.match(r.diagnostic!.message, /beam b5 is not a walkable beam \(it needs its partner beam/);
});

test('hand_up refuses a giver standing on a beam (nobody walks a beam with a sheet)', () => {
  const { rt, to } = sheetBay(2.29);
  run(rt, 'climb_frame', { actor: 'p1', link: 'climb:A:l@2.29', dir: 'up' });
  const r = rt.submit('hand_up', { part: 's1', givers: ['p1', 'p2'], receivers: ['p3', 'p4'], to });
  assert.equal(r.status, 'failed');
  assert.equal(r.diagnostic?.code, 'handup.giver-aloft');
  assert.match(r.diagnostic!.message, /giver p1 stands on beam:b3; .* only small loads \(≤ 10 kg\) are carried on a beam/);
  assert.ok(r.diagnostic!.subjects!.includes('b3'));
});

test('hand points: the invariant flags a receiver whose hands are out of reach (both ends covered)', () => {
  const { rt, E } = sheetBay(2.29);
  // fake a receiver holding the sheet far below their feet
  Object.assign(E.p3.human!, { activity: 'reach_down', grip: { entity: 's1', slot: 'handup-take-0' }, hands: { left: [0.6, 0.5, 0.3], right: [0.6, 0.5, 0.6] } });
  E.p3.pose.p = [0.61, 2.337, 0.45];
  Object.assign(E.p1.human!, { activity: 'reach_up', grip: { entity: 's1', slot: 'handup-give-0' }, hands: { left: [E.p1.pose.p[0], 2.4, E.p1.pose.p[2]], right: [E.p1.pose.p[0], 2.4, E.p1.pose.p[2] + 0.2] } });
  rt.step();
  const v = rt.violations.filter((x) => x.code === 'lift.hands-out-of-reach');
  assert.ok(v.some((x) => x.subjects?.includes('p3') && /below their feet/.test(x.message)), JSON.stringify(v));
  assert.ok(v.some((x) => x.subjects?.includes('p1') && /above their floor/.test(x.message)), JSON.stringify(v));
});

/** The 2.4 m bay with a forklift east of it and s1 on the ground in front of its forks. */
function forkBay() {
  const L = def('beam-12ft').size[0];
  const b = bay({ seat: 2.29, beam: 'beam-12ft', joists: JZ(L), actions: [...VEHICLE_ACTIONS, ...FORKLIFT_ACTIONS], invariants: [...CARRY_INVARIANTS, ...VEHICLE_INVARIANTS, ...FORKLIFT_INVARIANTS] }, [
    component('s1', 'plywood-4x6', [5.6, 0, L / 2], Math.PI / 2, { phase: 'staged' }),
    forklift('f1', 10, L / 2, Math.PI),
    human('op', 10, L / 2 + 0.95),
  ]);
  const to = { x: 0, z: L / 2, yaw: Math.PI / 2 };
  run(b.rt, 'mount', { actor: 'op', vehicle: 'f1' }, 400);
  run(b.rt, 'forklift_pick', { operator: 'op', item: 's1' });
  return { ...b, to };
}
// the sheet's inner edge EDGE_GAP outside b3's face, at the height it is fed in (joist top + 5 cm)
const presentAt = (b: { top: number; L: number }) => ({ x: def('upright-12ft').size[0] / 2 + def('beam-12ft').size[2] / 2 + 0.08 + W / 2, z: b.L / 2, y: b.top + def('2x4-6ft').size[1] + 0.05, yaw: Math.PI / 2 });

test('hand_up via forklift: the forks present the sheet at deck height, two on the beams take it off the forks and lay it, 0 violations', () => {
  const b = forkBay();
  const { rt, E, to } = b;
  run(rt, 'forklift_present', { operator: 'op', at: presentAt(b) });
  assert.equal(E.s1.support?.kind, 'forks');
  assert.ok(Math.abs(E.s1.pose.p[1] - presentAt(b).y) < 1e-6, `presented at ${E.s1.pose.p[1]}`);
  const r = rt.submit('hand_up', { part: 's1', via: 'forklift', operator: 'op', receivers: ['p3', 'p4'], to });
  assert.notEqual(r.status, 'failed', `${r.diagnostic?.code} ${r.diagnostic?.message}`);
  const w = watch(rt, r.id);
  assert.equal(w.r.status, 'completed', `${w.r.diagnostic?.code} ${w.r.diagnostic?.message}`);
  assert.deepEqual([...w.holders].sort(), ['p3', 'p4']);
  assert.deepEqual(rt.violations, [], JSON.stringify(rt.violations.slice(0, 3)));
  assert.equal(E.s1.phase, 'staged');
  assert.equal(E.s1.support?.kind, 'resting-on');
  run(rt, 'install_plywood', { crew: ['p3', 'p4'], sheet: 's1', x: to.x, z: to.z, yaw: to.yaw });
  assert.equal(E.s1.phase, 'installed');
  // the empty truck drives off
  run(rt, 'ride_to', { actor: 'op', x: 12, z: b.L / 2 });
  assert.deepEqual(rt.violations, []);
});

test('hand_up via forklift is refused when the forks hold it too low, or it is not on the forks', () => {
  const b = forkBay();
  const { rt, to } = b;
  run(rt, 'forklift_present', { operator: 'op', at: { ...presentAt(b), y: 1.2 } });
  const low = rt.submit('hand_up', { part: 's1', via: 'forklift', operator: 'op', receivers: ['p3', 'p4'], to });
  assert.equal(low.diagnostic?.code, 'handup.too-high');
  assert.match(low.diagnostic!.message, /below the receivers' feet \(max 1 m\); raise the forks/);
  const b2 = sheetBay(2.29);
  const none = b2.rt.submit('hand_up', { part: 's1', via: 'forklift', operator: 'p5', receivers: ['p3', 'p4'], to: b2.to });
  assert.equal(none.diagnostic?.code, 'forklift.no-operator');
});
