// Flagship reference sequence (spec §7): people collect rack parts, 2x4s and
// plywood from material piles, carry them to a build site, raise and hold two
// uprights, seat beams, release only when stable, frame and deck the bay, build
// the stair, and someone walks up onto the new deck.
//
// HYPOTHETICAL: an illustrative Mars-style build on open ground. It is not a
// documented historical construction sequence (spec §4).
//
// Everything is authored in a site-local frame (bay origin at upright A's base,
// bay running along +z) and placed into the world with `Site` (origin + yaw),
// so the same template can be staged in the proving ground or a fork of 2026.
import { rot2, type Vec2 } from '../core/math.ts';
import type { ActionDef } from '../actions/types.ts';
import type { Entity, Provenance } from '../world/types.ts';
import { def } from '../world/catalog.ts';
import { component, human } from '../world/factory.ts';
import { layTargetForStanding } from '../construction/lying.ts';
import { SEQUENCE_SCHEMA, type SequenceTemplate, type StepSpec } from '../sequence/types.ts';
import { walkTo } from '../locomotion/walk.ts';
import { carry } from '../carry/actions.ts';
import { CARRY_INVARIANTS } from '../carry/invariants.ts';
import { CONSTRUCTION_ACTIONS, liftHandsInReach, progressiveContributor, progressiveSupported, uprightsSupported } from '../construction/index.ts';
import { DEFAULT_INVARIANTS } from '../runtime/invariants.ts';

export type Site = { origin: Vec2; yaw: number; groundY?: number };

const HYPO: Provenance = { origin: 'design-edit', confidence: 'hypothetical', note: 'flagship build scenario inventory — not historical' };
const L9 = def('beam-9ft').size[0];
const D12 = def('upright-12ft').size[0];
const PANEL_Z = def('plywood-4x6').size[2];
const JOISTS: [string, number][] = [['j1', 0.2], ['j2', 0.8], ['j3', 1.37], ['j4', 1.95], ['j5', 2.55]];
const PANELS: [string, number][] = [['s1', 0.15 + PANEL_Z / 2], ['s2', 0.15 + PANEL_Z * 1.5]];

/** Site-local → world. */
export function place(site: Site, x: number, z: number, yaw = 0) {
  const w = rot2([x, z], site.yaw);
  return { x: site.origin[0] + w[0], z: site.origin[1] + w[1], yaw: yaw + site.yaw };
}

function at(site: Site, id: string, defId: string, x: number, z: number, yaw: number, extra: Partial<Entity> = {}): Entity {
  const q = place(site, x, z, yaw);
  const { pose: _p, ...rest } = extra;
  return component(id, defId, [q.x, site.groundY ?? 0, q.z], q.yaw, { phase: 'stored', provenance: HYPO, ...rest });
}

/** Material piles + crew for the scenario, in world coordinates. */
export function buildBayEntities(site: Site): Entity[] {
  const out: Entity[] = [];
  // rack pile (west): two 12 ft uprights lying flat, four 9 ft beams
  out.push(at(site, 'A', 'upright-12ft', -12, -3.0, 0));
  out.push(at(site, 'B', 'upright-12ft', -12, -0.5, 0));
  ['b1', 'b2', 'b3', 'b4'].forEach((id, k) => out.push(at(site, id, 'beam-9ft', -6.5 + 0.35 * k, -4.5, Math.PI / 2)));
  // timber + plywood pile (south-west)
  JOISTS.forEach(([id], k) => out.push(at(site, id, '2x4-6ft', -7 + 0.2 * k, 5.2, Math.PI / 2)));
  PANELS.forEach(([id], k) => out.push(at(site, id, 'plywood-4x6', -11.5, 5 + 1.6 * k, 0)));
  // stair flight + treads delivered next to the site (carrying stair modules is not yet modelled)
  out.push(at(site, 'st', 'stair-flight-10', 5.0, 0.75, Math.PI, { phase: 'staged' }));
  for (let i = 1; i <= 10; i++) out.push(at(site, `t${i}`, 'stair-tread', 0.94 + 1.25 - (-1.25 + (i - 0.5) * 0.25), 3.3, Math.PI / 2, { phase: 'staged' }));
  // crew on a muster line + one visitor
  for (let i = 0; i < 6; i++) {
    const q = place(site, -6 + 1.2 * i, -7);
    out.push(human(`p${i + 1}`, q.x, q.z, { provenance: HYPO, y: site.groundY ?? 0 }));
  }
  const v = place(site, 6, 5);
  out.push(human('visitor', v.x, v.z, { provenance: HYPO, y: site.groundY ?? 0 }));
  // fix upright poses (lying flat, long axis along local −x toward the pile's west)
  for (const e of out) if (e.id === 'A' || e.id === 'B') e.pose.pitch = Math.PI / 2;
  return out;
}

/** The build as a sequence template (spec §14): barriers express construction dependencies. */
export function buildBayTemplate(site: Site): SequenceTemplate {
  const S: StepSpec[] = [];
  const step = (id: string, verb: string, params: Record<string, unknown>, after: string[] = [], label?: string) => S.push({ id, verb, params, after: after.length ? after : undefined, label });
  const to = (x: number, z: number, yaw: number) => place(site, x, z, yaw);
  const tA = layTargetForStanding('upright-12ft', [0, 0], -Math.PI / 2), tB = layTargetForStanding('upright-12ft', [0, L9], Math.PI / 2); // tops point away from the bay
  // 1. uprights to their raise positions (bases where they will stand), beams to the bay
  step('carryA', 'carry', { crew: ['$crew[0]', '$crew[1]'], item: 'A', to: to(tA.x, tA.z, tA.yaw) }, [], 'carry upright A to its raise position');
  // B is brought in last: its lay position and the staged beams share the strip beside the bay
  step('carryB', 'carry', { crew: ['$crew[2]', '$crew[3]'], item: 'B', to: to(tB.x, tB.z, tB.yaw) }, ['carry_b4'], 'carry upright B (after the beams are staged)');
  // beams are staged beside the bay, outside the band the lying frames sweep when raised
  // (a 9 ft beam is exactly the bay length, so it cannot lie *between* the two footings)
  const x = D12 / 2 + 0.2;
  const beamSpots: [string, number, number][] = [['b1', -x, 0], ['b2', x, 0], ['b3', -x - 0.4, 0], ['b4', x + 0.4, 0]];
  let prev: string[] = ['carryA'];
  for (const [b, bx] of beamSpots) {
    step(`carry_${b}`, 'carry', { crew: ['$crew[4]', '$crew[5]'], item: b, to: to(bx, L9 / 2, Math.PI / 2) }, prev, `carry beam ${b} to the bay`);
    prev = [`carry_${b}`];
  }
  // 2. raise + hold
  step('raiseA', 'raise_upright', { crew: ['$crew[0]', '$crew[1]'], item: 'A', stand_at: xz(to(0, 0, 0)) }, ['carryA', 'carry_b4'], 'raise and hold upright A (after the beams are staged beside the bay)');
  step('raiseB', 'raise_upright', { crew: ['$crew[2]', '$crew[3]'], item: 'B', stand_at: xz(to(0, L9, 0)) }, ['carryB'], 'raise and hold upright B');
  // 3. beams: lower level both columns, then upper level (12 ft frames need two)
  prev = ['raiseA', 'raiseB'];
  for (const [b, col, h] of [['b1', 'r', 0.5], ['b2', 'l', 0.5], ['b3', 'r', 1.8], ['b4', 'l', 1.8]] as const) {
    step(`seat_${b}`, 'connect_beam', { crew: ['$crew[4]', '$crew[5]'], beam: b, a: 'A', b: 'B', column: col, height: h }, prev, `seat ${b} at ${h} m`);
    prev = [`seat_${b}`];
  }
  // 4. release only now (the runtime would refuse earlier)
  step('releaseA', 'release_support', { item: 'A' }, prev);
  step('releaseB', 'release_support', { item: 'B' }, prev);
  // 5. joists + plywood carried from the timber pile, in parallel crews
  const JSP: Record<string, number> = { j1: 0, j2: 1, j3: 2, j4: 3, j5: 4 };
  const joistCarrier = (k: number) => `$crew[${k % 2}]`;
  // joists are staged 12 cm apart, so their carries are chained (alternating carriers); parallel
  // single-person carries to adjacent spots would stand on each other's release stations
  let prevJ: Record<number, string> = {};
  let lastJ: string[] = ['releaseA', 'releaseB'];
  for (const [j] of JOISTS) {
    const k = JSP[j];
    step(`carry_${j}`, 'carry', { crew: [joistCarrier(k)], item: j, to: to(-1.6 - 0.12 * k, 1.37, Math.PI / 2) }, lastJ);
    lastJ = [`carry_${j}`];
    prevJ = { 0: `carry_${j}` };
  }
  // sheets must end within 3 m of their deck position (hand-up rule) and beside the bay, where
  // they can be lifted over the side beams onto the joists (swept-lift rule: never through the
  // 12 ft end frames): s1 east of the bay now, s2 west of it once the joists have left the ground there
  step('carry_s1', 'carry', { crew: ['$crew[2]', '$crew[3]'], item: 's1', to: to(2.6, PANELS[0][1], 0) }, ['releaseA', 'releaseB']);
  prev = Object.values(prevJ);
  for (const [j, a] of JOISTS) {
    step(`fix_${j}`, 'install_joist', { crew: ['$crew[4]'], joist: j, bay: { a: 'A', b: 'B' }, height: 1.8, at: a }, prev);
    prev = [`fix_${j}`];
  }
  step('carry_s2', 'carry', { crew: ['$crew[2]', '$crew[3]'], item: 's2', to: to(-2.6, 2.0, 0) }, [...prev, 'carry_s1']);
  step('deck_s1', 'install_plywood', { crew: ['$crew[2]', '$crew[3]'], sheet: 's1', ...xzYaw(to(0, PANELS[0][1], 0)) }, ['carry_s2']);
  step('deck_s2', 'install_plywood', { crew: ['$crew[2]', '$crew[3]'], sheet: 's2', ...xzYaw(to(0, PANELS[1][1], 0)) }, ['deck_s1']);
  // 6. clear the stair site, set the flight, treads bottom-up
  const muster = [2, 3, 4].map((i) => {
    const q = to(-6 + 1.2 * i, -7, 0);
    step(`muster${i}`, 'walk_to', { actor: `$crew[${i}]`, x: q.x, z: q.z, level: 0 }, ['deck_s2']);
    return `muster${i}`;
  });
  const sp = to(0.94 + def('stair-flight-10').size[0], 0.75, Math.PI);
  step('stair', 'install_stair_flight', { crew: ['$crew[0]', '$crew[1]'], stair: 'st', x: sp.x, z: sp.z, heading: sp.yaw }, muster);
  prev = ['stair'];
  for (let i = 1; i <= 10; i++) {
    step(`tread${i}`, 'install_tread', { crew: ['$crew[5]'], stair: 'st', tread: `t${i}`, index: i }, prev);
    prev = [`tread${i}`];
  }
  // 7. the first person walks up onto the new deck
  const top = to(0, 1.37, 0);
  step('visit', 'walk_to', { actor: '$visitor', x: top.x, z: top.z, level: 4 }, prev, 'visitor walks up the new stair onto the deck');
  return { schema: SEQUENCE_SCHEMA, id: 'build-bay-v1', label: 'Build a two-level rack bay from material piles (hypothetical)', params: { crew: { kind: 'actors' }, visitor: { kind: 'actor' } }, steps: S };
}

const xz = (q: { x: number; z: number }) => ({ x: q.x, z: q.z });
const xzYaw = (q: { x: number; z: number; yaw: number }) => ({ x: q.x, z: q.z, yaw: q.yaw });

export const buildBayBindings = { crew: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'], visitor: 'visitor' };

export function buildBayRegistry(): Map<string, ActionDef> {
  return new Map<string, ActionDef>([['walk_to', walkTo], ['carry', carry], ...CONSTRUCTION_ACTIONS.map((a) => [a.verb, a] as [string, ActionDef])]);
}
export const BUILD_BAY_INVARIANTS = [...DEFAULT_INVARIANTS, ...CARRY_INVARIANTS, uprightsSupported, progressiveSupported, liftHandsInReach];
export const BUILD_BAY_CONTRIBUTORS = [progressiveContributor];
