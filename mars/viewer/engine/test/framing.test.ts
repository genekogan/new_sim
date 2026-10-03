// 2x4 roof framing (construction/framing.ts, FRAMING.md): a two-frame bay of 16 ft reconstruction frames (beams at the
// Kit's 0.22 / 2.48 / 4.757 m, like 2022) on open ground gets two top plates, four rafters and four blocks — plates along
// the column lines across both frames, rafters plate to plate across the bay's width, blocking between the rafter pairs
// over the plates — every member handed up givers → relay (bracing, 0.95 m) → installers (bracing, 3.05 m); 0 violations,
// exact poses, pinned hash. Refusals: rafter before its plates, nobody able to reach the top, a rafter longer than the
// plate span, a mid-bay rafter out of every stance's reach, a pitch that does not match the plates, blocking that does not fit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from '../runtime/runtime.ts';
import { DEFAULT_INVARIANTS } from '../runtime/invariants.ts';
import { CARRY_INVARIANTS } from '../carry/invariants.ts';
import { Spatial } from '../spatial/service.ts';
import { walkTo } from '../locomotion/walk.ts';
import { carry } from '../carry/actions.ts';
import { CONSTRUCTION_ACTIONS, FRAMING_ACTIONS, FRAMING_INVARIANTS, uprightsSupported } from '../construction/index.ts';
import { stanceAccessOk, STANCE_ACTIONS } from '../construction/stance.ts';
import { kitPartHandsInReach, setPartHands } from '../construction/setpart.ts';
import { placeRafter } from '../construction/framing.ts';
import { cutPlan, offcutDef } from '../construction/cut.ts';
import { RAFTER_SPACING_MAX } from '../construction/rules.ts';
import { addAll, emptyWorld, human } from '../world/factory.ts';
import { def } from '../world/catalog.ts';
import { framingRole } from '../world/catalog-framing.ts';
import { angleDelta, datan2, hypot, IN } from '../core/math.ts';
import { hashOf } from '../core/hash.ts';
import { createRegistry, ENGINE_INVARIANTS } from '../api/registry.ts';
import type { ActionDef } from '../actions/types.ts';
import type { Entity } from '../world/types.ts';
import type { SpatialScene } from '../spatial/types.ts';

const U = 'upright-16ft-kit';
const H = def(U).size[1], D = def(U).size[0], L = def('beam-12ft').size[0];
const SEATS = [0.22, 2.48, 4.7568];
const PLATE_T = 1.5 * IN;
const ground = (): SpatialScene => ({ bounds: [-15, -15, 15, 15], levels: [{ id: 0, y: 0, label: 'ground' }], surfaces: [{ id: 'ground', level: 0, y: 0, obb: { c: [0, 0], half: [15, 15], yaw: 0 } }], obstacles: [], links: [] });
const registry = () => new Map<string, ActionDef>([['walk_to', walkTo], ['carry', carry], ...[...CONSTRUCTION_ACTIONS, ...STANCE_ACTIONS, ...FRAMING_ACTIONS].map((a) => [a.verb, a] as [string, ActionDef])]);
const INV = [...DEFAULT_INVARIANTS, ...CARRY_INVARIANTS, uprightsSupported, stanceAccessOk, kitPartHandsInReach, ...FRAMING_INVARIANTS];
const FIX = { origin: 'test-fixture', confidence: 'hypothetical' } as const;
const lying = (id: string, defId: string, x: number, z: number, yaw: number): Entity => ({ id, def: defId, kind: 'component', pose: { p: [x, 0, z], yaw }, provenance: FIX, phase: 'stored', support: { kind: 'ground' } });

/** The bay by state: frames A (z 0) and B (z L), both yaw 0, beam-stable with beams on both columns at the Kit's three levels. */
function bay(): Entity[] {
  const frame = (id: string, z: number): Entity => ({ id, def: U, kind: 'component', pose: { p: [0, 0, z], yaw: 0 }, provenance: FIX, phase: 'installed', support: { kind: 'connected', to: [] }, connections: [] });
  const A = frame('A', 0), B = frame('B', L);
  const beams: Entity[] = [];
  for (const col of ['l', 'r'] as const)
    for (const [i, seat] of SEATS.entries()) {
      const id = `b${col}${i}`, key = `col${col}@${seat.toFixed(3)}`;
      beams.push({ id, def: 'beam-12ft', kind: 'component', pose: { p: [col === 'l' ? -D / 2 : D / 2, seat - def('beam-12ft').size[1] / 2, L / 2], yaw: Math.PI / 2 }, provenance: FIX, phase: 'installed',
        support: { kind: 'connected', to: ['A', 'B'] }, connections: [{ socket: 'end-l', to: 'A', toSocket: key }, { socket: 'end-r', to: 'B', toSocket: key }] });
      A.connections!.push({ socket: key, to: id, toSocket: 'end-l' });
      B.connections!.push({ socket: key, to: id, toSocket: 'end-r' });
      (A.support as { to: string[] }).to.push(id);
      (B.support as { to: string[] }).to.push(id);
    }
  return [A, B, ...beams];
}

// crews: one person per frame face per height band (two on both columns of one 3 ft face would stand 0.31 m apart):
// the l-column crews on the frames' OUTER faces (A: face b, −z; B: face f, +z), the r-column crews on the INNER faces;
// installers at 3.05 m (the top bracing node of a 16 ft frame), relays below them at 0.95 m
const STANCES: [string, string, 'l' | 'r', 'f' | 'b', number][] = [
  ['ia-l', 'A', 'l', 'b', 3.05], ['ia-r', 'A', 'r', 'f', 3.05], ['ib-l', 'B', 'l', 'f', 3.05], ['ib-r', 'B', 'r', 'b', 3.05],
  ['ra-l', 'A', 'l', 'b', 0.95], ['ra-r', 'A', 'r', 'f', 0.95], ['rb-l', 'B', 'l', 'f', 0.95], ['rb-r', 'B', 'r', 'b', 0.95],
];
function world(extra: Entity[] = []) {
  const people = [
    human('g1', -5, 1), human('g2', -5, 2.6), human('x1', 5, 1), human('x2', 5, 2.6),
    human('ia-l', -3.5, -3.5), human('ia-r', 3.5, -3.5), human('ra-l', -4.5, -3.5), human('ra-r', 4.5, -3.5),
    human('ib-l', -3.5, L + 3.5), human('ib-r', 3.5, L + 3.5), human('rb-l', -4.5, L + 3.5), human('rb-r', 4.5, L + 3.5),
  ];
  const parts = [
    lying('tp-l', '2x4-top-plate-16ft', -1.8, L / 2, Math.PI / 2), lying('tp-r', '2x4-top-plate-16ft', 1.8, L / 2, Math.PI / 2),
    lying('ra1', '2x4-rafter-4ft', 0, -2.0, 0), lying('ra2', '2x4-rafter-4ft', 0, -2.7, 0),
    lying('rb1', '2x4-rafter-4ft', 0, L + 2.0, 0), lying('rb2', '2x4-rafter-4ft', 0, L + 2.7, 0),
    lying('rm', '2x4-rafter-4ft', 0, -4.0, 0), lying('r16', '2x4-rafter-16ft', 0, -4.6, 0),
    lying('bk-al', '2x4-blocking-24oc', -2.5, -1.5, Math.PI / 2), lying('bk-ar', '2x4-blocking-24oc', 2.5, -1.5, Math.PI / 2),
    lying('bk-bl', '2x4-blocking-24oc', -2.5, L + 1.5, Math.PI / 2), lying('bk-br', '2x4-blocking-24oc', 2.5, L + 1.5, Math.PI / 2),
    lying('bk16', '2x4-blocking-16oc', -2.5, -2.4, Math.PI / 2),
  ];
  return new Runtime(addAll(emptyWorld('open-ground', ground()), ...bay(), ...people, ...parts, ...extra), registry(), { spatial: new Spatial(ground()) }, INV);
}
function run(rt: Runtime, verb: string, params: unknown) {
  const t0 = rt.tick;
  const r = rt.submit(verb, params);
  assert.notEqual(r.status, 'failed', `${verb} ${JSON.stringify(params)}: ${JSON.stringify(r.diagnostic)}`);
  rt.runUntilIdle(20 * 900, [r.id]);
  assert.equal(r.status, 'completed', `${verb} ${JSON.stringify(params)}: ${JSON.stringify(r.diagnostic)}`);
  assert.deepEqual(rt.violations, [], `${verb}: ${JSON.stringify(rt.violations.slice(0, 2))}`);
  if (process.env.FRAMING_TRACE) console.log(verb, (params as { part?: string; actor?: string }).part ?? (params as { actor?: string }).actor, rt.tick - t0, JSON.stringify((r.outputs as { handoffs?: number[] } | undefined)?.handoffs ?? null));
  return r;
}
const refuse = (rt: Runtime, verb: string, params: unknown, code: string, re?: RegExp) => {
  const r = rt.submit(verb, params);
  assert.equal(r.status, 'failed', `${verb} should be refused (${code})`);
  assert.equal(r.diagnostic?.code, code, JSON.stringify(r.diagnostic));
  if (re) assert.match(r.diagnostic!.message, re);
  return r.diagnostic!;
};

const A_OUT = -0.8, B_OUT = L + 0.8; // rafters / A-side and B-side go up outside the end frames, beyond the plates' ends and the crews
const plate = (part: string, col: 'l' | 'r') => ({ part, onto: ['A', 'B'], at: { x: col === 'l' ? -D / 2 : D / 2, z: L / 2, yaw: Math.PI / 2 }, givers: ['g1', 'g2'], relay: [`ra-${col}`, `rb-${col}`], installers: [`ia-${col}`, `ib-${col}`], raise: { x: col === 'l' ? -0.9 : 0.9, z: L / 2 } });
// a 4 ft rafter is light enough for one person per stage: the outer-face relay, then the outer-face installer
const rafter = (part: string, end: 'a' | 'b', at: number) => ({ part, from: 'tp-l', to: 'tp-r', at, givers: ['g1', 'g2'], relay: [`r${end}-l`], installers: [`i${end}-l`], raise: { x: 0, z: end === 'a' ? A_OUT : B_OUT } });
const block = (part: string, end: 'a' | 'b', col: 'l' | 'r', between: [string, string]) => ({ part, between, on: `tp-${col}`, givers: [col === 'l' ? 'g1' : 'g2'], relay: [`r${end}-${col}`], installers: [`i${end}-${col}`], raise: { x: col === 'l' ? -0.8 : 0.8, z: end === 'a' ? 0 : L } });
// `at` along plate tp-l (yaw π/2: its +x is world +z, centre z = L/2)
const along = (z: number) => z - L / 2;
const S = 24 * IN / 2; // rafters at ±12 in about each end frame's plane: 24 in centres

function scenario(rt: Runtime, checks: boolean) {
  for (const [a, u, column, face, feet] of STANCES) run(rt, 'climb_stance', { actor: a, upright: u, column, face, feet });
  if (checks) {
    // a rafter before its plates
    refuse(rt, 'install_rafter', rafter('ra1', 'a', along(S)), 'framing.plate-not-installed', /needs both top plates installed first: tp-l is stored/);
    // nobody who can reach the top: two people on the ground as installers
    refuse(rt, 'install_top_plate', { ...plate('tp-l', 'l'), relay: undefined, installers: ['x1', 'x2'] }, 'framing.out-of-reach', /x[12] on the ground \(feet 0\.00 m\) cannot reach 16 ft 2x4 top plate tp-l where it goes, at 4\.88 m .*use a stance\/deck/);
    // the top plate without a relay: the givers cannot hand it to people standing at 3.05 m
    refuse(rt, 'install_top_plate', { ...plate('tp-l', 'l'), relay: undefined }, 'framing.gap', /add a relay/);
  }
  run(rt, 'install_top_plate', plate('tp-l', 'l'));
  run(rt, 'install_top_plate', plate('tp-r', 'r'));
  if (checks) {
    refuse(rt, 'install_rafter', rafter('r16', 'a', along(S)), 'framing.rafter-long', /16 ft 2x4 rafter r16 is 4\.877 m but plates tp-l and tp-r are 0\.914 m apart centre to centre: a rafter there is 0\.902–1\.613 m long/);
    // the middle of the 12 ft bay: out of reach of every stance on the end frames
    refuse(rt, 'install_rafter', rafter('rm', 'a', along(L / 2)), 'framing.out-of-reach', /cannot reach 4 ft 2x4 rafter rm where it goes, at 4\.91 m .*use a stance\/deck/);
  }
  // the inner rafter of each pair first (the outer one would be slid over it otherwise)
  run(rt, 'install_rafter', rafter('ra1', 'a', along(S)));
  run(rt, 'install_rafter', rafter('ra2', 'a', along(-S)));
  run(rt, 'install_rafter', rafter('rb1', 'b', along(L - S)));
  run(rt, 'install_rafter', rafter('rb2', 'b', along(L + S)));
  if (checks) {
    refuse(rt, 'install_blocking', block('bk16', 'a', 'l', ['ra1', 'ra2']), 'framing.blocking-length', /blocking bk16 \(0\.362 m\) would leave 0\.210 m of play between rafters ra1 and ra2 \(0\.572 m between their faces/);
    // a flat roof: the pitch is the plates' height difference (0°)
    refuse(rt, 'install_rafter', { ...rafter('rm', 'a', along(S)), pitch: 0.2 }, 'framing.pitch-mismatch', /give a pitch of 0\.0°, not the 11\.5° asked/);
  }
  run(rt, 'install_blocking', block('bk-al', 'a', 'l', ['ra1', 'ra2']));
  run(rt, 'install_blocking', block('bk-ar', 'a', 'r', ['ra1', 'ra2']));
  run(rt, 'install_blocking', block('bk-bl', 'b', 'l', ['rb1', 'rb2']));
  run(rt, 'install_blocking', block('bk-br', 'b', 'r', ['rb1', 'rb2']));
}

const TARGETS: [string, [number, number, number], number][] = [
  ['tp-l', [-D / 2, H, L / 2], Math.PI / 2], ['tp-r', [D / 2, H, L / 2], Math.PI / 2],
  ['ra1', [0, H + PLATE_T, S], 0], ['ra2', [0, H + PLATE_T, -S], 0], ['rb1', [0, H + PLATE_T, L - S], 0], ['rb2', [0, H + PLATE_T, L + S], 0],
  ['bk-al', [-D / 2, H + PLATE_T, 0], Math.PI / 2], ['bk-ar', [D / 2, H + PLATE_T, 0], Math.PI / 2],
  ['bk-bl', [-D / 2, H + PLATE_T, L], Math.PI / 2], ['bk-br', [D / 2, H + PLATE_T, L], Math.PI / 2],
];
const PIN: string = '935bfceee135813ecf7a07114f3314a07af45b47e494c8f0ef02a1194cfd4643';

test('framing: a 16 ft bay gets 2 top plates, 4 rafters, 4 blocks by hand-up to the bracing — exact poses, 0 violations, refusals named, pinned', () => {
  const rt = world();
  let handTicks = 0;
  const step0 = rt.step.bind(rt);
  rt.step = () => {
    step0();
    // independent per-tick hand check (the invariant does it too): every framing holder's hands rebuild from their slot
    for (const h of Object.values(rt.world.entities)) {
      const g = h.human?.grip;
      if (!g || !framingRole(rt.world.entities[g.entity]?.def ?? '') || !g.slot.startsWith('setpart-')) continue;
      const hs = setPartHands(rt.world.entities[g.entity], rt.world.entities[g.entity].pose, h, g.slot);
      const pub = h.human!.hands;
      assert.ok(hs && pub?.left && pub.right, `${h.id} publishes hands for ${g.slot}`);
      // once the grip is taken (not while the hands come up from the hips), the published hands are the slot's hands
      if (!['crouch', 'reach_down'].includes(h.human!.activity)) {
        const d = Math.min(hypot(pub.left[0] - hs[0][0], pub.left[1] - hs[0][1], pub.left[2] - hs[0][2]) + hypot(pub.right[0] - hs[1][0], pub.right[1] - hs[1][1], pub.right[2] - hs[1][2]),
          hypot(pub.left[0] - hs[1][0], pub.left[1] - hs[1][1], pub.left[2] - hs[1][2]) + hypot(pub.right[0] - hs[0][0], pub.right[1] - hs[0][1], pub.right[2] - hs[0][2]));
        assert.ok(d < 1e-6, `${h.id} (${h.human!.activity}) hands ${d} m off their slot ${g.slot}`);
      }
      handTicks++;
    }
  };
  scenario(rt, true);
  const E = rt.world.entities;
  for (const [id, p, yaw] of TARGETS) {
    const e = E[id];
    assert.equal(e.phase, 'installed', id);
    const d = hypot(e.pose.p[0] - p[0], e.pose.p[1] - p[1], e.pose.p[2] - p[2]);
    assert.ok(d < 0.01, `${id} at ${e.pose.p.map((v) => v.toFixed(4))} vs ${p.map((v) => v.toFixed(4))} (${d.toFixed(4)} m)`);
    const dy = Math.abs(angleDelta(e.pose.yaw, yaw));
    assert.ok(Math.min(dy, Math.PI - dy) < Math.PI / 180, `${id} yaw ${e.pose.yaw}`);
    assert.ok(Math.abs(e.pose.roll ?? 0) < Math.PI / 180 && Math.abs(e.pose.pitch ?? 0) < Math.PI / 180, `${id} level`);
  }
  // supports recorded: plates on both frames, rafters on both plates, blocks on the plate + both rafters
  assert.deepEqual(E['tp-l'].connections!.map((c) => c.to), ['A', 'B']);
  assert.deepEqual(E.ra1.connections!.map((c) => c.to), ['tp-l', 'tp-r']);
  assert.deepEqual(E['bk-al'].connections!.map((c) => c.to), ['tp-l', 'ra1', 'ra2']);
  // rafter centres ≤ 24 in (the sheet rule's number)
  assert.ok(Math.abs(E.ra1.pose.p[2] - E.ra2.pose.p[2]) <= RAFTER_SPACING_MAX + 1e-9);
  assert.ok(handTicks > 1000, `hands checked on ${handTicks} holder-ticks`);
  assert.deepEqual(rt.violations, []);
  for (const h of Object.values(E)) if (h.human) { assert.equal(h.human.grip, undefined, h.id); assert.equal(h.human.task, undefined, h.id); }
  const hash = hashOf(rt.world);
  console.log(`framing bay: ${rt.tick} ticks, hash ${hash}`);
  assert.equal(hash, PIN);
});

test('framing: determinism — the same scenario twice gives the same world hash', () => {
  const a = world(), b = world();
  scenario(a, false);
  scenario(b, false);
  assert.equal(a.tick, b.tick);
  assert.equal(hashOf(a.world), hashOf(b.world));
});

test('framing: catalog — plates / rafters / blocking are 2x4 sections cut to order from 16 ft stock; registry + invariants', () => {
  assert.equal(framingRole('2x4-top-plate-12ft'), 'top-plate');
  assert.equal(framingRole('2x4-rafter-12ft'), 'rafter');
  assert.equal(framingRole('2x4-blocking-24oc'), 'blocking');
  assert.equal(framingRole('2x4-12ft'), undefined);
  const r = cutPlan('2x4-16ft', ['2x4-rafter-12ft', '2x4-blocking-24oc']);
  assert.ok(r.ok && r.cuts === 2 && r.offcut?.id === '2x4-2ft', JSON.stringify(r));
  const two = cutPlan('2x4-16ft', ['2x4-top-plate-8ft', '2x4-top-plate-8ft']);
  assert.ok(two.ok && two.offcut === null);
  const no = cutPlan('2x4-16ft', ['2x4-rafter-12ft', '2x4-rafter-5ft']);
  assert.ok(!no.ok && no.code === 'cut.insufficient');
  // an offcut is never a framing piece (cut to order): 0.58 m left would otherwise be a 22.25 in block (0.565 m)
  assert.equal(offcutDef(def('2x4-16ft'), 0.58)?.id, '2x4-1ft');
  const reg = createRegistry();
  for (const v of ['install_top_plate', 'install_rafter', 'install_blocking']) assert.ok(reg.has(v), v);
  for (const inv of FRAMING_INVARIANTS) assert.ok(ENGINE_INVARIANTS.includes(inv));
});

test('framing: a sloped rafter — plates at different heights give the pitch; a wrong pitch is refused', () => {
  const rt = world();
  scenario(rt, false);
  // a second plate stacked on tp-r (by state): the rafter from tp-l to it rises 1.5 in over 0.914 m
  const w = rt.world;
  w.entities['tp-r2'] = { id: 'tp-r2', def: '2x4-top-plate-16ft', kind: 'component', pose: { p: [D / 2, H + PLATE_T, L / 2], yaw: Math.PI / 2 }, provenance: FIX, phase: 'installed', support: { kind: 'resting-on', on: 'tp-r' }, connections: [{ socket: 'bears-on', to: 'tp-r', toSocket: 'framing' }] };
  const e = w.entities.rm;
  const ok = placeRafter(w, e, 'tp-l', 'tp-r2', 0, datan2(PLATE_T, D));
  assert.ok(!('code' in ok), JSON.stringify(ok));
  if (!('code' in ok)) {
    assert.ok(Math.abs((ok.pose.roll ?? 0) - datan2(PLATE_T, D)) < 1e-9);
    assert.ok(Math.abs(ok.pose.p[1] - (H + PLATE_T + PLATE_T / 2)) < 1e-9);
  }
  const no = placeRafter(w, e, 'tp-l', 'tp-r2', 0, 0);
  assert.ok('code' in no && no.code === 'framing.pitch-mismatch' && /pitch of 2\.4°, not the 0\.0° asked/.test(no.message), JSON.stringify(no));
});
