// Flagship reference sequence, third template (build-bay-v3): v2 (build-bay-v2.ts) with the deck
// materials going up the Martian way (owner feedback 2026-09-28 §5): nothing floats up.
//   (a) joists: each 2x4 is carried to the west side, handed up by its carrier (1 giver) to crew[4],
//       who climbed frame A and works standing on beam b3, and fastened by crew[4] (install_joist on a
//       part staged aloft);
//   (b) sheet s1: crew[2]/crew[3] lift it overhead at the east edge and push it in over beam b4;
//       crew[4] (on b3) and crew[5] (who climbed onto b4) take it, lay it and fasten it (install_plywood);
//   (c) sheet s2: crew[1] drives the forklift, picks s2 west of the bay and presents it raised beside
//       b3 at deck height (forklift_present); crew[4] and crew[5], who stepped off the beams onto s1,
//       take it off the forks, lay it and fasten it; the truck backs straight out and parks;
//   (d) then as v2: stair, treads, crew[4]/crew[5] walk down the new stair, spare tread carried up, the
//       visitor goes up, the campfire ending.
// v1 / v2 and their pins are untouched.
//
// Layout differences from v2 (why the scenario, not the engine, differs):
// - 12 ft beams (bay 3.66 m), not 9 ft: the forks take a 4x6 only across its short side (fork reach
//   1.4 m < 1.83 m), so a forklift-presented sheet arrives with its long side parallel to the edge, and
//   receivers feed a sheet straight in (they do not turn it over the bay). s2 therefore lies long axis
//   along the bay (yaw π/2, 1.22 × 1.83 m), which needs 1.83 m of bay beside s1 (v2's 9 ft bay has 1.33 m).
//   The deck is s1 (across the bay, as v2) + s2 (along it, between the beam lines): 7 joists instead of 5.
// - Joists are handed up over the west beam b3, sheet s1 over the east beam b4 (where v1 carried them);
//   s1 is staged 0.4 m nearer the bay than v1 so its givers stand clear of the staged stair flight.
// - The treads are staged south-east of the bay (v1: north-east, where the 12 ft beams now lie).
// - The forklift works the west side (the stair flight is staged east, in line with where it goes, as in
//   v1: a flight is walked along its own axis): s2 waits on dunnage west of the bay in line with the
//   truck (no reversing, no U-turn next to the rack); after presenting, the truck backs straight out
//   3 m (forklift_back) and parks there. v2's spare tread lies 1.3 m further north, out of the loaded
//   truck's 2.73 m swept radius.
//
// HYPOTHETICAL: an illustrative Mars-style build (spec §4), not a documented historical sequence.
import type { ActionDef } from '../actions/types.ts';
import type { Invariant } from '../runtime/runtime.ts';
import type { Contributor } from '../spatial/service.ts';
import type { Entity, Provenance, Region } from '../world/types.ts';
import { def } from '../world/catalog.ts';
import { component, human } from '../world/factory.ts';
import { layTargetForStanding } from '../construction/lying.ts';
import { frameAccessContributor, frameAccessOk } from '../construction/index.ts';
import { SEQUENCE_SCHEMA, type SequenceTemplate, type StepSpec } from '../sequence/types.ts';
import { forklift } from '../vehicles/forklift.ts';
import { place, type Site } from './build-bay.ts';
import { buildBayV2Registry, BUILD_BAY_V2_CONTRIBUTORS, BUILD_BAY_V2_INVARIANTS, V2_LAYOUT, WANDER_S } from './build-bay-v2.ts';

export type { Site };
const HYPO: Provenance = { origin: 'design-edit', confidence: 'hypothetical', note: 'flagship build v3 scenario inventory — not historical' };

const L12 = def('beam-12ft').size[0];
const D12 = def('upright-12ft').size[0];
const COL = D12 / 2;
const PW = def('plywood-4x6').size[2]; // 1.22 m
const PL = def('plywood-4x6').size[0]; // 1.83 m
const BEAM_T = def('beam-12ft').size[2] / 2; // half the beam's thickness (face offset)
/** Joists across the bay: three under s1, four under s2 (metres from A along the bay). */
export const V3_JOISTS: [string, number][] = [['j1', 0.25], ['j2', 0.71], ['j3', 1.17], ['j4', 1.55], ['j5', 2.08], ['j6', 2.61], ['j7', 3.14]];
/** Deck sheets: s1 across the bay (yaw 0) at the A end, s2 along the bay (yaw π/2) beside it. */
export const V3_SHEETS = {
  s1: { x: 0, z: 0.1 + PW / 2, yaw: 0 },
  s2: { x: 0, z: 0.1 + PW + PL / 2, yaw: Math.PI / 2 }, // abuts s1 (one walkable deck)
};
const SEAT = 1.8; // upper beam seat (snaps to 1.83 m): deck 1.99 m, as v1 / v2

/** Site-local layout of what v3 moves or adds. */
export const V3_LAYOUT = {
  joistStage: -2.6, // x of a joist lying (along x) west of the bay before its hand-up
  joistWait: [{ x: -4.6, z: -1.4 }, { x: -4.6, z: 4.4 }], // where crew[0] / crew[1] wait between joists
  s1Stage: { x: 2.2 }, // s1 lying east of the bay before its hand-up (z = its deck z)
  s2Pile: { x: -5.6, z: V3_SHEETS.s2.z },
  truck: { x: -15.5, z: V3_SHEETS.s2.z, yaw: 0 }, // parked west (clear of the rack pile), forks toward the bay
  back: 3.0, // the truck backs straight out this far after presenting s2
  stair: { x: 5.0, z: 0.75 }, // as v1
  tread: { dx: 0.5, z: -1.9 }, // treads south-east of the bay (v1: dx 0, z 3.3 — where the 12 ft beams are staged now)
  spare: { x: -6.0, z: 6.5 }, // v2's spare tread (v2: z 5.2)
  // laid across s1 on the axis of s2, its carrier (0.47 m beside it) standing on s2: every load disc ≥ 0.27 m from a deck
  // edge, so it fits wherever the site falls on the 0.1 m grid lattice (was (−0.15, 1.2): an end disc 0.17 m from the
  // s1/s2 corner, r 0.163 m — failed at 7 of 17 open-ground origins, W27)
  spareDeck: { x: 0, z: 1.0 },
  visit: { x: 0, z: 2.4 }, // the visitor walks onto s2
  // receivers' places for the sheets (site-local); b3 is the west upper beam, b4 the east one
  s1Receivers: [{ x: -COL, z: 1.65 }, { x: COL, z: 1.65 }], // on b3 / b4, north of s1
  // s2 comes off the forks west of b3; its receivers kneel at an edge within 0.5 m of it (hand_up's receiver
  // rule): crew[4] on b3 just north of where s2 goes, crew[5] on s1 at its north-west corner — one per end
  s2Receivers: [{ x: -COL, z: 0.1 + PW + PL + 0.32 }, { x: -0.45, z: 0.95 }],
  s2StepOff: { x: 0.25, z: 0.9 }, // where crew[5] steps off b4 onto s1
  s2Off: { x: -0.2, z: 2.8 }, // where crew[4] steps off b3 onto s2 once it is fastened
  presentY: 0, // filled below: s2's underside while presented (joist top + 5 cm)
};
const BEAM_TOP = 1.8288 + def('beam-12ft').size[1] / 2;
const JOIST_TOP = BEAM_TOP + def('2x4-6ft').size[1];
V3_LAYOUT.presentY = JOIST_TOP + 0.05;

function at(site: Site, id: string, defId: string, x: number, z: number, yaw: number, extra: Partial<Entity> = {}): Entity {
  const q = place(site, x, z, yaw);
  return component(id, defId, [q.x, site.groundY ?? 0, q.z], q.yaw, { phase: 'stored', provenance: HYPO, ...extra });
}
function fixture(site: Site, id: string, defId: string, x: number, z: number, yaw: number): Entity {
  const q = place(site, x, z, yaw);
  return { id, def: defId, kind: 'fixture', label: id, pose: { p: [q.x, site.groundY ?? 0, q.z], yaw: q.yaw }, provenance: HYPO };
}

/** v2's inventory with 12 ft beams, 7 joists, s2 east of the bay, the stair staged south, the truck east. */
export function buildBayV3Entities(site: Site): Entity[] {
  const y = site.groundY ?? 0;
  const L = V3_LAYOUT;
  const out: Entity[] = [];
  out.push(at(site, 'A', 'upright-12ft', -12, -3.0, 0));
  out.push(at(site, 'B', 'upright-12ft', -12, -0.5, 0));
  ['b1', 'b2', 'b3', 'b4'].forEach((id, k) => out.push(at(site, id, 'beam-12ft', -6.5 + 0.35 * k, -4.5, Math.PI / 2)));
  V3_JOISTS.forEach(([id], k) => out.push(at(site, id, '2x4-6ft', -7 + 0.2 * k, 5.2, Math.PI / 2)));
  out.push(at(site, 's1', 'plywood-4x6', -11.5, 5, 0));
  out.push(at(site, 's2', 'plywood-4x6', L.s2Pile.x, L.s2Pile.z, Math.PI / 2));
  out.push(at(site, 'st', 'stair-flight-10', L.stair.x, L.stair.z, Math.PI, { phase: 'staged' }));
  for (let i = 1; i <= 10; i++) out.push(at(site, `t${i}`, 'stair-tread', 0.94 + 1.25 - (-1.25 + (i - 0.5) * 0.25) + L.tread.dx, L.tread.z, Math.PI / 2, { phase: 'staged' }));
  for (let i = 0; i < 6; i++) {
    const q = place(site, -6 + 1.2 * i, -7);
    out.push(human(`p${i + 1}`, q.x, q.z, { provenance: HYPO, y }));
  }
  const v = place(site, 6, 5);
  out.push(human('visitor', v.x, v.z, { provenance: HYPO, y }));
  for (const e of out) if (e.id === 'A' || e.id === 'B') e.pose.pitch = Math.PI / 2;
  // v2 extras (spare tread, campfire, benches, guests, wanderers); the forklift parks east
  const V2 = V2_LAYOUT;
  const sp = place(site, L.spare.x, L.spare.z, Math.PI / 2);
  out.push(component('t11', 'stair-tread', [sp.x, y, sp.z], sp.yaw, { phase: 'stored', provenance: HYPO }));
  const t = place(site, L.truck.x, L.truck.z, L.truck.yaw);
  out.push({ ...forklift('fk', t.x, t.z, t.yaw, y), provenance: HYPO });
  out.push(fixture(site, 'fire', 'campfire', V2.fire.x, V2.fire.z, 0));
  for (const b of V2.benches) out.push(fixture(site, b.id, 'bench-6ft', b.x, b.z, Math.PI));
  V2.guests.forEach(([x, z], i) => { const q = place(site, x, z); out.push(human(`g${i + 1}`, q.x, q.z, { provenance: HYPO, y })); });
  V2.wanderers.forEach(([x, z], i) => { const q = place(site, x, z); out.push(human(`w${i + 1}`, q.x, q.z, { provenance: HYPO, y })); });
  return out;
}

export function buildBayV3Regions(site: Site): Region[] {
  const poly = V2_LAYOUT.lawn.map(([x, z]) => { const q = place(site, x, z); return [q.x, q.z] as [number, number]; });
  return [{ id: 'fire-lawn', label: 'lawn by the campfire (hypothetical)', kind: 'place', polygon: poly, level: 0, provenance: HYPO }];
}

export function buildBayV3Template(site: Site): SequenceTemplate {
  const S: StepSpec[] = [];
  const L = V3_LAYOUT;
  const step = (id: string, verb: string, params: Record<string, unknown>, after: string[] = [], label?: string) => S.push({ id, verb, params, after: after.length ? after : undefined, label });
  const to = (x: number, z: number, yaw = 0) => place(site, x, z, yaw);
  const xz = (q: { x: number; z: number }) => ({ x: q.x, z: q.z });
  const xzYaw = (q: { x: number; z: number; yaw: number }) => ({ x: q.x, z: q.z, yaw: q.yaw });
  // 1. rack: uprights to their raise positions, beams beside the bay (as v1, 12 ft bay)
  const tA = layTargetForStanding('upright-12ft', [0, 0], -Math.PI / 2), tB = layTargetForStanding('upright-12ft', [0, L12], Math.PI / 2);
  step('carryA', 'carry', { crew: ['$crew[0]', '$crew[1]'], item: 'A', to: to(tA.x, tA.z, tA.yaw) }, [], 'carry upright A to its raise position');
  step('carryB', 'carry', { crew: ['$crew[2]', '$crew[3]'], item: 'B', to: to(tB.x, tB.z, tB.yaw) }, ['carry_b4'], 'carry upright B (after the beams are staged)');
  const bx = COL + 0.2;
  let prev: string[] = ['carryA'];
  for (const [b, x] of [['b1', -bx], ['b2', bx], ['b3', -bx - 0.4], ['b4', bx + 0.4]] as const) {
    step(`carry_${b}`, 'carry', { crew: ['$crew[4]', '$crew[5]'], item: b, to: to(x, L12 / 2, Math.PI / 2) }, prev, `carry 12 ft beam ${b} to the bay`);
    prev = [`carry_${b}`];
  }
  step('raiseA', 'raise_upright', { crew: ['$crew[0]', '$crew[1]'], item: 'A', stand_at: xz(to(0, 0, 0)) }, ['carryA', 'carry_b4'], 'raise and hold upright A');
  step('raiseB', 'raise_upright', { crew: ['$crew[2]', '$crew[3]'], item: 'B', stand_at: xz(to(0, L12, 0)) }, ['carryB'], 'raise and hold upright B');
  prev = ['raiseA', 'raiseB'];
  for (const [b, col, h] of [['b1', 'r', 0.5], ['b2', 'l', 0.5], ['b3', 'r', SEAT], ['b4', 'l', SEAT]] as const) {
    step(`seat_${b}`, 'connect_beam', { crew: ['$crew[4]', '$crew[5]'], beam: b, a: 'A', b: 'B', column: col, height: h }, prev, `seat ${b} at ${h} m`);
    prev = [`seat_${b}`];
  }
  step('releaseA', 'release_support', { item: 'A' }, prev);
  step('releaseB', 'release_support', { item: 'B' }, prev);
  // 2. (a) joists: carry west, hand up to crew[4] on b3, fasten
  let last: string[] = ['releaseA', 'releaseB'];
  for (const [k, [j, z]] of V3_JOISTS.entries()) {
    const giver = `$crew[${k % 2}]`;
    step(`carry_${j}`, 'carry', { crew: [giver], item: j, to: to(L.joistStage, z, 0) }, last, `carry joist ${j} beside the bay`);
    const p = to(0, z, 0);
    step(`up_${j}`, 'hand_up', { part: j, givers: [giver], receivers: ['$crew[4]'], to: xzYaw(p), edge: 'b3' }, [`carry_${j}`], `${j} handed up to crew[4] standing on beam b3`);
    step(`fix_${j}`, 'install_joist', { crew: ['$crew[4]'], joist: j, bay: { a: 'A', b: 'B' }, height: SEAT, at: z }, [`up_${j}`], `crew[4] fastens ${j}`);
    // the giver steps clear of the staging strip before the next joist is set down there
    const w = to(L.joistWait[k % 2].x, L.joistWait[k % 2].z);
    step(`clear_${j}`, 'walk_to', { actor: giver, x: w.x, z: w.z, level: 0 }, [`up_${j}`]);
    last = [`up_${j}`, `clear_${j}`];
  }
  const joistsDone = `fix_${V3_JOISTS[V3_JOISTS.length - 1][0]}`;
  // 3. (b) s1 by hand over the east beam
  const s1 = V3_SHEETS.s1;
  step('carry_s1', 'carry', { crew: ['$crew[2]', '$crew[3]'], item: 's1', to: to(L.s1Stage.x, s1.z, 0) }, ['releaseA', 'releaseB'], 'carry s1 east of the bay');
  const s1to = to(s1.x, s1.z, s1.yaw);
  step('up_s1', 'hand_up', {
    part: 's1', givers: ['$crew[2]', '$crew[3]'], receivers: ['$crew[4]', '$crew[5]'], to: xzYaw(s1to), edge: 'b4',
    stations: L.s1Receivers.map((q) => xz(to(q.x, q.z))),
  }, ['carry_s1', joistsDone], 's1 handed up: two lift it overhead at the east edge, two on the beams take it');
  step('deck_s1', 'install_plywood', { crew: ['$crew[4]', '$crew[5]'], sheet: 's1', ...xzYaw(s1to) }, ['up_s1'], 'crew[4] and crew[5] fasten s1');
  // 4. (c) s2 by forklift over the east beam, received by the two standing on s1
  const t = to(L.truck.x, L.truck.z, L.truck.yaw);
  const side = to(L.truck.x, L.truck.z - 1.0);
  step('fk_walk', 'walk_to', { actor: '$crew[1]', x: side.x, z: side.z, level: 0 }, [`up_${V3_JOISTS[V3_JOISTS.length - 1][0]}`], 'crew[1] walks to the parked forklift');
  step('fk_mount', 'mount', { actor: '$crew[1]', vehicle: 'fk' }, ['fk_walk']);
  step('fk_pick', 'forklift_pick', { operator: '$crew[1]', item: 's2' }, ['fk_mount'], 'forklift picks plywood s2 off its dunnage');
  const [r4, r5] = L.s2Receivers.map((q) => to(q.x, q.z));
  const off5 = to(L.s2StepOff.x, L.s2StepOff.z);
  step('onto_s1_4', 'beam_walk', { actor: '$crew[4]', x: r4.x, z: r4.z }, ['deck_s1'], 'crew[4] walks b3 to its north end, past where s2 goes');
  step('onto_s1_5', 'beam_walk', { actor: '$crew[5]', x: off5.x, z: off5.z }, ['deck_s1'], 'crew[5] steps off beam b4 onto s1');
  const s2 = V3_SHEETS.s2;
  const pres = to(-(COL + BEAM_T + 0.08 + PW / 2), s2.z, s2.yaw);
  step('fk_present', 'forklift_present', { operator: '$crew[1]', at: { x: pres.x, z: pres.z, y: (site.groundY ?? 0) + L.presentY, yaw: pres.yaw } }, ['fk_pick', 'up_s1'], 'forks raise s2 to deck height beside the west beam');
  const s2to = to(s2.x, s2.z, s2.yaw);
  step('up_s2', 'hand_up', { part: 's2', via: 'forklift', operator: '$crew[1]', receivers: ['$crew[4]', '$crew[5]'], to: xzYaw(s2to), edge: 'b3', stations: [xz(r4), xz(r5)] },
    ['fk_present', 'onto_s1_4', 'onto_s1_5'], 'crew[4] and crew[5] take s2 off the forks and lay it');
  step('deck_s2', 'install_plywood', { crew: ['$crew[4]', '$crew[5]'], sheet: 's2', ...xzYaw(s2to) }, ['up_s2'], 'crew[4] and crew[5] fasten s2');
  const off4 = to(L.s2Off.x, L.s2Off.z);
  step('onto_s2_4', 'beam_walk', { actor: '$crew[4]', x: off4.x, z: off4.z }, ['deck_s2'], 'crew[4] steps off beam b3 onto s2');
  step('fk_back', 'forklift_back', { operator: '$crew[1]', d: L.back }, ['up_s2'], 'the empty forklift backs out');
  step('fk_dismount', 'dismount', { actor: '$crew[1]' }, ['fk_back']);
  // 5. stair (crew[4]/crew[5] are up on the deck; crew[2] fits the treads)
  const muster = [2, 3].map((i) => {
    const q = to(-6 + 1.2 * i, -7, 0);
    step(`muster${i}`, 'walk_to', { actor: `$crew[${i}]`, x: q.x, z: q.z, level: 0 }, ['deck_s2', 'up_s1']);
    return `muster${i}`;
  });
  const sp = to(0.94 + def('stair-flight-10').size[0], 0.75, Math.PI);
  step('stair', 'install_stair_flight', { crew: ['$crew[0]', '$crew[1]'], stair: 'st', x: sp.x, z: sp.z, heading: sp.yaw }, [...muster, 'fk_dismount', 'deck_s2', 'onto_s2_4', joistsDone]);
  prev = ['stair'];
  for (let i = 1; i <= 10; i++) {
    step(`tread${i}`, 'install_tread', { crew: ['$crew[2]'], stair: 'st', tread: `t${i}`, index: i }, prev);
    prev = [`tread${i}`];
  }
  // the two on the deck come down the new stair, the one nearer its head first
  const downs = [5, 4].map((i, k) => {
    const q = to(-3 + 1.2 * k, -5.5, 0);
    step(`down${i}`, 'walk_to', { actor: `$crew[${i}]`, x: q.x, z: q.z, level: 0 }, k ? ['down5'] : prev, `crew[${i}] walks down the new stair`);
    return `down${i}`;
  });
  // 6. v2's spare tread up the stair, the visitor, the campfire ending
  const V2 = V2_LAYOUT;
  const d = to(L.spareDeck.x, L.spareDeck.z, 0);
  step('carry_spare', 'carry', { crew: ['$crew[0]'], item: 't11', to: { x: d.x, z: d.z, yaw: d.yaw, level: 4 } }, downs, 'crew[0] carries a spare tread up the stair onto the deck');
  const down = to(V2.benches[0].x - 2, V2.benches[0].z);
  step('down0', 'walk_to', { actor: '$crew[0]', x: down.x, z: down.z, level: 0 }, ['carry_spare'], 'crew[0] comes back down');
  const top = to(L.visit.x, L.visit.z, 0);
  step('visit', 'walk_to', { actor: '$visitor', x: top.x, z: top.z, level: 4 }, ['down0'], 'visitor walks up the new stair onto the deck');
  const ring = ['$crew[2]', '$crew[3]', '$crew[4]', '$crew[5]', '$visitor', '$guests[0]', '$guests[1]', '$guests[2]'];
  step('fire', 'campfire_circle', { actors: ring, fire: 'fire' }, ['visit', 'fk_dismount'], 'crew, visitor and guests gather round the campfire');
  step('sit0', 'gather', { actors: ['$crew[0]'], fixture: V2.benches[0].id }, ['visit'], 'crew[0] sits on the west bench');
  step('sit1', 'gather', { actors: ['$crew[1]'], fixture: V2.benches[1].id }, ['visit'], 'crew[1] sits on the east bench');
  step('wander', 'ambient_wander', { actors: ['$wanderers[0]', '$wanderers[1]'], region: 'fire-lawn', seed: 3, duration: WANDER_S }, ['visit'], 'two passers-by stroll the lawn');
  const standers = ['$crew[0]', '$crew[1]', ...ring];
  standers.forEach((a, i) => step(`stand${i}`, 'stand', { actor: a }, ['wander'], i === 0 ? 'everyone stands: the evening ends' : undefined));
  return {
    schema: SEQUENCE_SCHEMA,
    id: 'build-bay-v3',
    label: 'Build a rack bay with the deck handed up (joists and a sheet by hand to two on the beams, a sheet off the forklift), then v2\'s stair, spare tread and campfire ending (hypothetical)',
    params: { crew: { kind: 'actors' }, visitor: { kind: 'actor' }, guests: { kind: 'actors' }, wanderers: { kind: 'actors' } },
    steps: S,
  };
}

export const buildBayV3Bindings = { crew: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'], visitor: 'visitor', guests: ['g1', 'g2', 'g3'], wanderers: ['w1', 'w2'] };
export function buildBayV3Registry(): Map<string, ActionDef> {
  return buildBayV2Registry(); // CONSTRUCTION_ACTIONS already carry climb_frame / beam_walk / hand_up; FORKLIFT_ACTIONS forklift_present / forklift_back
}
export const BUILD_BAY_V3_INVARIANTS: Invariant[] = [...BUILD_BAY_V2_INVARIANTS, frameAccessOk];
export const BUILD_BAY_V3_CONTRIBUTORS: Contributor[] = [...BUILD_BAY_V2_CONTRIBUTORS, frameAccessContributor];
