// hand_up follow-ups (owner feedback 2026-09-28 §5/§6, W8): the receivers' edge rule (load within
// EDGE_REACH of the beam / deck edge they kneel at: `handup.receiver-reach` names the distance), the
// long-load balance rule (one giver holding a board by one end: a two-handed lever grip, and a free end
// farther than FREE_END_MAX from the inner hand is `handup.unbalanced`), and the frame-access
// contributor in the API's spatial scene by default.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { component, human } from '../world/factory.ts';
import { def } from '../world/catalog.ts';
import { balance, EDGE_REACH, ENVELOPE_TOL, envelopeGap, FREE_END_MAX, handsOf, handupHands, LEVER } from '../construction/handup.ts';
import { beamWalkways } from '../construction/frame.ts';
import { bay, openGround, run } from './frame-fixtures.ts';
import { forklift, FORKLIFT_ACTIONS, FORKLIFT_INVARIANTS } from '../vehicles/forklift.ts';
import { VEHICLE_ACTIONS, VEHICLE_INVARIANTS } from '../vehicles/index.ts';
import { CARRY_INVARIANTS } from '../carry/invariants.ts';
import { servicesFor } from '../api/registry.ts';
import type { Runtime } from '../runtime/runtime.ts';

const W = def('plywood-4x6').size[2];
const JZ = (L: number) => [L / 2 - 0.75, L / 2 - 0.25, L / 2 + 0.25, L / 2 + 0.75];

function forkBay() {
  const L = def('beam-12ft').size[0];
  const b = bay({ seat: 2.29, beam: 'beam-12ft', joists: JZ(L), actions: [...VEHICLE_ACTIONS, ...FORKLIFT_ACTIONS], invariants: [...CARRY_INVARIANTS, ...VEHICLE_INVARIANTS, ...FORKLIFT_INVARIANTS] }, [
    component('s1', 'plywood-4x6', [5.6, 0, L / 2], Math.PI / 2, { phase: 'staged' }),
    forklift('f1', 10, L / 2, Math.PI),
    human('op', 10, L / 2 + 0.95),
  ]);
  run(b.rt, 'mount', { actor: 'op', vehicle: 'f1' }, 400);
  run(b.rt, 'forklift_pick', { operator: 'op', item: 's1' });
  return { ...b, to: { x: 0, z: L / 2, yaw: Math.PI / 2 } };
}

/** Step until the action ends; every hand-up holder's hands reproducible from the take and inside the envelope. */
function watch(rt: Runtime, id: string, max = 20 * 400) {
  const r = rt.records.get(id)!;
  const slots = new Set<string>();
  let ticks = 0;
  while (r.status !== 'completed' && r.status !== 'failed' && ticks++ < max) {
    rt.step();
    for (const h of Object.values(rt.world.entities)) {
      const slot = h.human?.grip?.slot;
      if (!slot?.startsWith('handup-')) continue;
      slots.add(slot);
      const hs = handsOf(h)!;
      const part = rt.world.entities[h.human!.grip!.entity];
      assert.deepEqual(handupHands(part, part.pose, h, slot), hs, `${h.id} hands not reproducible from ${slot}`);
      for (const p of hs) assert.ok(envelopeGap(h.human!.activity, h.pose.p, p) <= ENVELOPE_TOL, `${h.id} (${h.human!.activity}) hand outside the envelope at tick ${rt.tick}`);
    }
  }
  return { r, slots };
}

test('hand_up receiver rule: a sheet presented 0.7 m out from the beam edge is refused (handup.receiver-reach names the distance)', () => {
  const b = forkBay();
  const { rt, to } = b;
  const walk = beamWalkways(rt.world).find((l) => l.id === 'beam:b3')!;
  // the sheet's near edge 0.70 m beyond b3's walkway edge (the beam top the receivers kneel on)
  const x = walk.from.p[0] + walk.width / 2 + 0.7 + W / 2;
  run(rt, 'forklift_present', { operator: 'op', at: { x, z: b.L / 2, y: b.top + def('2x4-6ft').size[1] + 0.05, yaw: Math.PI / 2 } });
  const r = rt.submit('hand_up', { part: 's1', via: 'forklift', operator: 'op', receivers: ['p3', 'p4'], to });
  assert.equal(r.status, 'failed');
  assert.equal(r.diagnostic?.code, 'handup.receiver-reach', r.diagnostic?.message);
  assert.match(r.diagnostic!.message, new RegExp(`hands would be 0\\.70 m beyond the edge of beam b3 they kneel at \\(max ${EDGE_REACH} m\\)`));
  assert.ok(r.diagnostic!.subjects!.includes('s1') && r.diagnostic!.subjects!.includes('b3'));
});

test('hand_up balance: a joist handed up end-first by one giver uses a two-handed lever grip (hands LEVER apart along it), 0 violations', () => {
  const L = def('beam-12ft').size[0];
  const b = bay({ seat: 1.8, beam: 'beam-12ft' }, [component('j9', '2x4-6ft', [2.6, 0, L / 2], 0, { phase: 'staged' })]);
  const { rt, E } = b;
  const r = rt.submit('hand_up', { part: 'j9', givers: ['p1'], receivers: ['p3'], to: { x: 0, z: L / 2, yaw: 0 }, edge: 'b3' });
  assert.notEqual(r.status, 'failed', `${r.diagnostic?.code} ${r.diagnostic?.message}`);
  let lever = false;
  const orig = rt.step.bind(rt);
  rt.step = () => {
    orig();
    const hs = E.p1.human?.grip?.slot?.endsWith(':lever') ? handsOf(E.p1) : undefined;
    if (hs) {
      lever = true;
      assert.ok(Math.abs(Math.sqrt((hs[0][0] - hs[1][0]) ** 2 + (hs[0][2] - hs[1][2]) ** 2) - LEVER) < 1e-6, 'the two hands LEVER apart along the joist');
    }
  };
  const w = watch(rt, r.id);
  rt.step = orig;
  assert.equal(w.r.status, 'completed', `${w.r.diagnostic?.code} ${w.r.diagnostic?.message}`);
  assert.ok(lever, `the giver held it with a lever grip (${[...w.slots]})`);
  assert.deepEqual(rt.violations, [], JSON.stringify(rt.violations.slice(0, 3)));
  assert.equal(E.j9.phase, 'staged');
  const bal = balance(E.j9, { g: [0.45 * def('2x4-6ft').size[0], 0], out: [1, 0] });
  assert.ok(bal.lever && bal.free <= FREE_END_MAX, `6 ft 2x4 free end ${bal.free}`);
});

test('hand_up balance: an 8 ft 2x4 held by one end by one giver is refused (handup.unbalanced names the free end)', () => {
  const L = def('beam-12ft').size[0];
  const b = bay({ seat: 1.8, beam: 'beam-12ft' }, [component('j9', '2x4-8ft', [2.9, 0, L / 2], 0, { phase: 'staged' })]);
  const r = b.rt.submit('hand_up', { part: 'j9', givers: ['p1'], receivers: ['p3'], to: { x: 0, z: L / 2, yaw: 0 }, edge: 'b3' });
  assert.equal(r.status, 'failed');
  assert.equal(r.diagnostic?.code, 'handup.unbalanced', r.diagnostic?.message);
  assert.match(r.diagnostic!.message, /8 ft 2x4 j9 \(2\.44 m\) cannot be handed up by p1 alone holding it by one end: its free end would be 1\.92 m from the grip \(max 1\.5 m\)/);
  // held at the middle (side-on) it is balanced
  assert.deepEqual(balance(b.E.j9, { g: [0, 0.02], out: [0, 1] }), { lever: false, free: 0 });
});

test('API spatial scene: frame climb links / beam walkways are in it by default, opt-out with frameAccess: false', () => {
  const world = bay({ seat: 1.8, beam: 'beam-12ft' }).rt.world;
  const on = servicesFor({ 'open-ground': openGround() })(world).spatial;
  on.sync(world);
  const kinds = new Set(on.scene.links.map((l) => l.kind));
  assert.ok(kinds.has('climb') && kinds.has('beam'), `links: ${[...kinds]}`);
  assert.ok(on.scene.links.some((l) => l.id === 'beam:b3'), 'walkway beam:b3');
  const off = servicesFor({ 'open-ground': openGround() }, { frameAccess: false })(world).spatial;
  off.sync(world);
  assert.equal(off.scene.links.filter((l) => l.kind === 'climb' || l.kind === 'beam').length, 0);
});
