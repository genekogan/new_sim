// Solar (owner feedback 2026-09-28 §9, W8): rails on a deck, a panel handed up to a 2.4 m deck and
// mounted on two rails at 20°, equipment placed and configured; refusals: a single rail, rails on
// nothing, a fragile panel carried up a stair (tilt named), a panel above standing reach without a
// hand-up / forklift.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { component, human, emptyWorld, addAll } from '../world/factory.ts';
import { def } from '../world/catalog.ts';
import { dsin } from '../core/math.ts';
import { PANEL_MAX_TILT } from '../world/catalog-solar.ts';
import { SOLAR_ACTIONS, partHands } from '../construction/solar.ts';
import { envelopeGap, ENVELOPE_TOL, handsOf } from '../construction/handup.ts';
import { deckSurfaces } from '../construction/contributor.ts';
import { levelFor } from '../construction/access.ts';
import { CARRY_INVARIANTS } from '../carry/invariants.ts';
import { fragileLoadsOk, tiltOf } from '../carry/fragile.ts';
import { bay, run } from './frame-fixtures.ts';
import { HandupHandsCheck } from './hands-check.ts';
import { Runtime } from '../runtime/runtime.ts';
import { DEFAULT_INVARIANTS } from '../runtime/invariants.ts';
import { Spatial } from '../spatial/service.ts';
import { provingGround } from '../scenes/proving-ground.ts';
import { walkTo } from '../locomotion/walk.ts';
import { carry } from '../carry/actions.ts';
import type { ActionDef } from '../actions/types.ts';
import type { Entity } from '../world/types.ts';

const L = def('beam-12ft').size[0];
const ZC = L / 2;
const PANEL = 'solar-panel-100x170';
const JH = def('2x4-4ft').size[1];

/**
 * A 12 ft bay (beams at 2.29 m) decked with two 4x6 sheets along it on 4 ft joists (which end at the
 * beams, so nothing sticks out past the edge), deck top ≈ 2.45 m; p3 / p4 already up on the deck,
 * rails r1 / r2 lying on it, panel pv1 on the ground east of b3, battery bat1 on the ground south-east.
 */
function roofBay(extra: Entity[] = []) {
  const b = bay({ seat: 2.29, beam: 'beam-12ft', actions: SOLAR_ACTIONS, invariants: [...CARRY_INVARIANTS] }, []);
  const w = b.rt.world;
  const jz = [0.3, 0.9, 1.5, 2.16, 2.76, 3.36];
  jz.forEach((z, k) => {
    const j = component(`k${k + 1}`, '2x4-4ft', [0, b.top, z], Math.PI, { phase: 'installed' });
    j.support = { kind: 'resting-on', on: 'b4' };
    j.connections = ['b4', 'b3'].map((x) => ({ socket: 'bears-on', to: x, toSocket: `joist@${z.toFixed(2)}` }));
    w.entities[j.id] = j;
  });
  const PW = def('plywood-4x6').size[0] / 2;
  for (const [id, z, under] of [['s1', ZC - PW, ['k1', 'k2', 'k3']], ['s2', ZC + PW, ['k4', 'k5', 'k6']]] as const) {
    const s = component(id, 'plywood-4x6', [0, b.top + JH, z], Math.PI / 2, { phase: 'installed' });
    s.support = { kind: 'resting-on', on: under[0] };
    s.connections = under.map((x) => ({ socket: 'bears-on', to: x, toSocket: 'sheet' }));
    w.entities[id] = s;
  }
  const deckY = b.top + JH + def('plywood-4x6').size[1];
  const lvl = levelFor(deckY);
  const onDeck = (id: string, x: number, z: number) => {
    const h = w.entities[id];
    h.pose = { p: [x, deckY, z], yaw: 0 };
    h.human!.level = lvl;
  };
  onDeck('p3', 0.2, ZC + 1.35);
  onDeck('p4', 0.2, ZC - 1.35);
  const lying = (id: string, defId: string, x: number, z: number, yaw: number) => {
    const e = component(id, defId, [x, deckY, z], yaw, { phase: 'staged' });
    e.support = { kind: 'resting-on', on: z < ZC ? 's1' : 's2' };
    w.entities[id] = e;
  };
  lying('r1', 'panel-rail', 0.3, ZC + 0.5, Math.PI / 2);
  lying('r2', 'panel-rail', -0.3, ZC + 0.5, Math.PI / 2);
  const bat = component('bat1', 'battery', [3.0, 0, -1.0], 0, { phase: 'staged' });
  w.entities.bat1 = bat;
  w.entities.pv1 = component('pv1', PANEL, [2.6, 0, ZC], Math.PI / 2, { phase: 'staged' });
  for (const e of extra) w.entities[e.id] = e;
  const rt = new Runtime(w, b.rt.registry, b.rt.services, b.rt.invariants);
  return { ...b, rt, E: rt.world.entities, deckY, lvl };
}

/** Step to the end; every published hand point inside the handler's envelope. */
function watch(rt: Runtime, id: string, max = 20 * 400) {
  const r = rt.records.get(id)!;
  let ticks = 0, worst = -Infinity;
  const hc = new HandupHandsCheck();
  while (r.status !== 'completed' && r.status !== 'failed' && ticks++ < max) {
    rt.step();
    hc.check(rt); // hand-up holders (reproducible at the grip, continuous on the way to it)
    for (const h of Object.values(rt.world.entities)) {
      const hs = handsOf(h);
      const slot = h.human?.grip?.slot;
      if (!hs || !slot) continue;
      const part = rt.world.entities[h.human!.grip!.entity];
      if (slot === 'place' || slot === 'mount') assert.deepEqual(partHands(part, part.pose, h.pose.p), hs, `${h.id} hands reproducible from the pose`);
      const act = slot.startsWith('handup-') ? h.human!.activity : 'crouch';
      for (const p of hs) {
        const g = envelopeGap(act, h.pose.p, p);
        worst = Math.max(worst, g);
        assert.ok(g <= ENVELOPE_TOL, `${h.id} (${h.human!.activity}) hand ${g.toFixed(3)} m outside the envelope at tick ${rt.tick}`);
      }
    }
  }
  return { r, ticks, worst };
}

test('solar green: rails fastened on a 2.4 m deck, a panel handed up onto them and mounted at 20°, a battery placed and configured — 0 violations', () => {
  const { rt, E, deckY } = roofBay();
  assert.equal(deckSurfaces(rt.world).length, 2, 'two deck sheets');
  assert.ok(Math.abs(deckY - 2.445) < 0.01, `deck top ${deckY}`);
  for (const [a, r, x] of [['p3', 'r1', 0.3], ['p4', 'r2', -0.3]] as const) {
    const s = rt.submit('install_rail', { actor: a, rail: r, onto: 's1', at: { x, z: ZC, yaw: Math.PI / 2 } });
    assert.notEqual(s.status, 'failed', `${s.diagnostic?.code} ${s.diagnostic?.message}`);
    const w = watch(rt, s.id);
    assert.equal(w.r.status, 'completed', `${w.r.diagnostic?.code} ${w.r.diagnostic?.message}`);
    assert.equal(E[r].phase, 'installed');
    assert.deepEqual(E[r].connections!.map((c) => c.to), ['s1', 's2'], `${r} rests on both deck sheets`);
    assert.ok(Math.abs(E[r].pose.p[1] - deckY) < 1e-9 && Math.abs(E[r].pose.p[2] - ZC) < 1e-9);
  }
  // the panel goes up by hand: two on the ground raise it at the east edge, the two on the deck lay it on the rails
  const hu = rt.submit('hand_up', { part: 'pv1', givers: ['p1', 'p2'], receivers: ['p3', 'p4'], to: { x: 0, z: ZC, yaw: Math.PI / 2 }, edge: 'b3', stations: [{ x: 0.2, z: ZC + 1.18 }, { x: 0.2, z: ZC - 1.18 }] });
  assert.notEqual(hu.status, 'failed', `${hu.diagnostic?.code} ${hu.diagnostic?.message}`);
  const w1 = watch(rt, hu.id);
  assert.equal(w1.r.status, 'completed', `${w1.r.diagnostic?.code} ${w1.r.diagnostic?.message}`);
  assert.equal(E.pv1.phase, 'staged');
  assert.deepEqual(E.pv1.support, { kind: 'resting-on', on: 'r1' });
  const top = deckY + def('panel-rail').size[1];
  assert.ok(Math.abs(E.pv1.pose.p[1] - top) < 1e-9, 'laid flat on the rails');
  // mounted at the reconstruction's tilt
  const ip = rt.submit('install_panel', { crew: ['p3', 'p4'], panel: 'pv1', rails: ['r1', 'r2'], tilt: 20 });
  assert.notEqual(ip.status, 'failed', `${ip.diagnostic?.code} ${ip.diagnostic?.message}`);
  let maxTilt = 0;
  const orig = rt.step.bind(rt);
  rt.step = () => { orig(); maxTilt = Math.max(maxTilt, tiltOf(E.pv1.pose)); };
  const w2 = watch(rt, ip.id);
  rt.step = orig;
  assert.equal(w2.r.status, 'completed', `${w2.r.diagnostic?.code} ${w2.r.diagnostic?.message}`);
  assert.equal(E.pv1.phase, 'installed');
  assert.ok(Math.abs((E.pv1.pose.pitch ?? 0) - (20 * Math.PI) / 180) < 1e-9, `pitch ${E.pv1.pose.pitch}`);
  assert.ok(Math.abs(maxTilt - (20 * Math.PI) / 180) < 1e-6, 'never tilted past its mount tilt');
  assert.deepEqual(E.pv1.connections!.map((c) => c.to), ['r1', 'r2']);
  // its low edge sits on the rails
  const low = E.pv1.pose.p[1] - (def(PANEL).size[2] / 2) * dsin((20 * Math.PI) / 180);
  assert.ok(Math.abs(low - top) < 1e-9, `low edge ${low} on the rails ${top}`);
  // a battery set down on the ground and configured (0.36 m from where it lies: one crouched person slides it
  // within a 0.62 m arm — BODY_MODEL; it was 0.67 m under the old 0.75 m arm)
  const pe = rt.submit('place_equipment', { actor: 'p1', item: 'bat1', at: { x: 3.3, z: -1.2, yaw: 0.3 }, config: { label: 'bank A' } });
  assert.notEqual(pe.status, 'failed', `${pe.diagnostic?.code} ${pe.diagnostic?.message}`);
  const w3 = watch(rt, pe.id);
  assert.equal(w3.r.status, 'completed', `${w3.r.diagnostic?.code} ${w3.r.diagnostic?.message}`);
  assert.deepEqual(E.bat1.equipment, { kind: 'battery', config: { capacityAh: 200, chemistry: 'LiFePO4', label: 'bank A', voltage: 12 } });
  assert.deepEqual(E.bat1.support, { kind: 'ground' });
  assert.ok(Math.abs(E.bat1.pose.p[0] - 3.3) < 1e-9 && Math.abs(E.bat1.pose.yaw - 0.3) < 1e-9);
  assert.equal(E.bat1.phase, 'placed');
  for (const p of ['p1', 'p2', 'p3', 'p4']) assert.equal(E[p].human!.hands, undefined, `${p} let go`);
  assert.deepEqual(rt.violations, [], JSON.stringify(rt.violations.slice(0, 3)));
});

test('solar refusals: a panel on a single rail / an uninstalled rail; rails on nothing; equipment off the deck', () => {
  const { rt } = roofBay([component('loose', '2x4-6ft', [3, 0, -2], 0, { phase: 'staged' })]);
  run(rt, 'install_rail', { actor: 'p3', rail: 'r1', onto: 's1', at: { x: 0.3, z: ZC, yaw: Math.PI / 2 } });
  const one = rt.submit('install_panel', { crew: ['p3', 'p4'], panel: 'pv1', rails: ['r1', 'r1'], tilt: 20 });
  assert.equal(one.diagnostic?.code, 'solar.panel-rails');
  assert.match(one.diagnostic!.message, /needs two different installed rails; got r1, r1/);
  const half = rt.submit('install_panel', { crew: ['p3', 'p4'], panel: 'pv1', rails: ['r1', 'r2'], tilt: 20 });
  assert.equal(half.diagnostic?.code, 'solar.rail-not-installed');
  assert.match(half.diagnostic!.message, /rail r2 is staged, not installed/);
  // rails on nothing: past the deck's edge, on a 2x4 lying on the ground, on the ground itself
  const over = rt.submit('install_rail', { actor: 'p4', rail: 'r2', onto: 's1', at: { x: 0.9, z: ZC, yaw: Math.PI / 2 } });
  assert.equal(over.diagnostic?.code, 'solar.rail-no-support');
  assert.match(over.diagnostic!.message, /would overhang deck sheet s1 by 0\.31 m/);
  const loose = rt.submit('install_rail', { actor: 'p4', rail: 'r2', onto: 'loose', at: { x: -0.3, z: ZC, yaw: Math.PI / 2 } });
  assert.equal(loose.diagnostic?.code, 'solar.rail-no-support');
  assert.match(loose.diagnostic!.message, /would rest on nothing: loose is staged, not installed/);
  const ground = rt.submit('install_rail', { actor: 'p4', rail: 'r2', onto: 'ground', at: { x: -0.3, z: ZC, yaw: Math.PI / 2 } });
  assert.equal(ground.diagnostic?.code, 'solar.rail-no-support');
  // one framing member alone does not hold a rail
  const single = rt.submit('install_rail', { actor: 'p4', rail: 'r2', onto: 'k3', at: { x: -0.3, z: 1.5, yaw: 0 } });
  assert.equal(single.diagnostic?.code, 'solar.rail-no-support');
  assert.match(single.diagnostic!.message, /would rest on k3 alone/);
  // equipment must sit on the floor its carrier stands on: off the deck's edge is refused
  const eq = rt.world.entities.bat1;
  Object.assign(eq, { pose: { p: [0.1, rt.world.entities.p3.pose.p[1], ZC + 1.6], yaw: 0 }, support: { kind: 'resting-on', on: 's2' } });
  const off = rt.submit('place_equipment', { actor: 'p3', item: 'bat1', at: { x: 0.8, z: ZC + 1.6, yaw: 0 } });
  assert.equal(off.diagnostic?.code, 'solar.no-surface');
  assert.match(off.diagnostic!.message, /would not sit on the deck p3 stands on/);
  const beam = rt.submit('place_equipment', { actor: 'p3', item: 'b3', at: { x: 0, z: ZC, yaw: 0 } });
  assert.equal(beam.diagnostic?.code, 'solar.not-equipment');
});

test('solar refusal: a panel lying on the ground cannot be mounted on rails 2.48 m up without a hand-up or the forklift', () => {
  const { rt } = roofBay();
  run(rt, 'install_rail', { actor: 'p3', rail: 'r1', onto: 's1', at: { x: 0.3, z: ZC, yaw: Math.PI / 2 } });
  run(rt, 'install_rail', { actor: 'p4', rail: 'r2', onto: 's1', at: { x: -0.3, z: ZC, yaw: Math.PI / 2 } });
  const r = rt.submit('install_panel', { crew: ['p3', 'p4'], panel: 'pv1', rails: ['r1', 'r2'], tilt: 20 });
  assert.equal(r.status, 'failed');
  assert.equal(r.diagnostic?.code, 'solar.panel-too-high');
  assert.match(r.diagnostic!.message, /rails r1 \/ r2 are 2\.48 m above pv1 where it lies \(standing reach 2\.06 m\): hand it up/);
});

test('fragile: two people carrying a solar panel up a 37° stair are refused with the tilt named; the invariant flags a tilted held panel', () => {
  const base = provingGround();
  const reg = new Map<string, ActionDef>([['walk_to', walkTo], ['carry', carry]]);
  const w = addAll(emptyWorld('solar-stairs', base), component('pv', PANEL, [-3, 0, 10], 0, { phase: 'staged' }), human('a', -4, 12), human('b', -2, 12));
  const rt = new Runtime(w, reg, { spatial: new Spatial(base) }, [...DEFAULT_INVARIANTS, ...CARRY_INVARIANTS]);
  const r = rt.submit('carry', { crew: ['a', 'b'], item: 'pv', to: { x: 10, z: 10, yaw: 0, level: 1 } });
  assert.equal(r.status, 'failed');
  assert.equal(r.diagnostic?.code, 'carry.fragile-tilt');
  assert.match(r.diagnostic!.message, /solar panel 1\.0 × 1\.7 m \(330 W\) pv is fragile \(never tilted past 30°\): carried up stairs stairs-a it would tilt 36\.9° with the flight/);
  assert.ok(r.diagnostic!.subjects!.includes('stairs-a'));
  // on its own level the same pair carries it level
  const ok = rt.submit('carry', { crew: ['a', 'b'], item: 'pv', to: { x: -3, z: 4, yaw: 0 } });
  assert.notEqual(ok.status, 'failed', `${ok.diagnostic?.code} ${ok.diagnostic?.message}`);
  // per tick: a held panel tilted past 30° is flagged
  const pv = rt.world.entities.pv;
  const saved = structuredClone({ pose: pv.pose, phase: pv.phase, support: pv.support });
  Object.assign(pv, { phase: 'carried', support: { kind: 'held', by: ['a', 'b'] }, pose: { ...pv.pose, pitch: PANEL_MAX_TILT + 0.05 } });
  const v = fragileLoadsOk(rt);
  assert.equal(v[0]?.code, 'carry.fragile-tilt');
  assert.match(v[0].message, /tilted 32\.9° while held by a, b \(fragile: max 30°\)/);
  Object.assign(pv, saved);
});
