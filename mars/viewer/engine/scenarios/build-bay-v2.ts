// Flagship reference sequence, second template (build-bay-v2). v1 (`build-bay.ts`) stays byte-for-byte
// as it is so its pinned hashes / takes stay valid; v2 is v1's bay, crew and steps plus:
//   (a) plywood s2 comes off its stack on a forklift (crew[5] walks to the parked truck, mounts,
//       forklift_pick, forklift_deliver beside the bay, rides back to the park spot, dismounts) and
//       crew[2]/crew[3] install it (install_plywood, as in v1);
//   (b) once the stair is finished, crew[0] carries a spare stair tread (t11) up the flight and lays
//       it on the deck (single-carrier stairs carry, CARRY.md "Between levels");
//   (c) the ending: two sit on benches, crew[2..5] + the visitor + three guests fill the campfire's
//       8 fire-circle places, two wanderers stroll meanwhile (ambient_wander, its duration is the
//       sequence's clock); then everyone `stand`s, so the run ends settled with no social holds.
//
// Layout notes (why the scenario, not the engine, differs from the brief):
// - s2 is forklift-delivered to the ground spot v1 carried it to, not onto the deck: the only deck
//   surface before s2 is s1 (one 1.83 × 1.22 m surface per sheet), a sheet must be approached on its
//   long side (fork reach 1.4 m < 1.83 m), so the truck would have to come in along the bay axis,
//   where the end frames leave the truck no clearance (refused next to A/b2 and next to B). The test proves this
//   refusal (`forklift.no-approach`) instead of assuming it.
// - The two sitters use `gather { fixture: bench }` (seat slots, sit-down / stand-up exactly as `sit`),
//   because a `sit` action can only end `cancelled` (its end is a stand-up), which a sequence reports
//   as `partial`; a gather ends `completed` once its members have stood.
//
// HYPOTHETICAL: an illustrative Mars-style build (spec §4), not a documented historical sequence.
import type { ActionDef } from '../actions/types.ts';
import type { Invariant } from '../runtime/runtime.ts';
import { carryIntegrity } from '../carry/invariants.ts';
import type { Entity, Provenance, Region } from '../world/types.ts';
import { component, human } from '../world/factory.ts';
import { SEQUENCE_SCHEMA, type SequenceTemplate, type StepSpec } from '../sequence/types.ts';
import { SOCIAL_ACTIONS } from '../social/actions.ts';
import { VEHICLE_ACTIONS, VEHICLE_INVARIANTS } from '../vehicles/index.ts';
import { forklift, FORKLIFT_ACTIONS, FORKLIFT_INVARIANTS } from '../vehicles/forklift.ts';
import { buildBayEntities, buildBayRegistry, buildBayTemplate, BUILD_BAY_INVARIANTS, BUILD_BAY_CONTRIBUTORS, place, type Site } from './build-bay.ts';

export type { Site };
const HYPO: Provenance = { origin: 'design-edit', confidence: 'hypothetical', note: 'flagship build v2 scenario inventory — not historical' };

/** Site-local layout of everything v2 adds (x across the bay, z along it; the bay is x ±0.6, z 0–2.74). */
export const V2_LAYOUT = {
  // t11: a spare tread on the timber pile. Not a 2x4: a 6 ft or 4 ft 2x4 is refused
  // carry.stairs-blocked (after the top step the carrier must line the load up level on the deck
  // along the flight, and the 1.83 m deck is too short for it); the 0.9 m tread fits.
  spare: { x: -6.0, z: 5.2 },
  // s2 waits on its own dunnage spot south of the bay, in line with its ground spot beside the bay, so
  // the loaded truck (2.73 m swept radius, 2.5 m min turn radius, no reversing) drives pick → deliver
  // straight; from v1's plywood pile (-11.5, 6.6) it has to U-turn and `vehicle.turn-too-tight` refuses
  s2Pile: { x: -2.6, z: 9.4 },
  truck: { x: -2.6, z: 13, yaw: -Math.PI / 2 }, // parked south of s2, forks toward it
  s2Ground: { x: -2.6, z: 2.0 }, // where v1's crew laid s2 (within 3 m of its deck position)
  spareDeck: { x: 0, z: 2.1 }, // t11 laid across the deck's north half, clear of the visitor's spot (0, 1.37)
  fire: { x: 4.5, z: 9 }, // clear of the forklift's loaded 2.9 m swept radius on its way to the bay
  benches: [{ id: 'bench-w', x: 2.8, z: 12.3 }, { id: 'bench-e', x: 6.2, z: 12.3 }],
  lawn: [[9, 5], [13, 5], [13, 10], [9, 10]] as [number, number][],
  guests: [[4, 14], [5.5, 14], [7, 14]] as [number, number][],
  wanderers: [[10, 7], [11.5, 8.5]] as [number, number][],
};
/** How long the wanderers stroll, starting with the fire circle (s): the ending's clock (stands follow). */
export const WANDER_S = 45;

function fixture(site: Site, id: string, defId: string, x: number, z: number, yaw: number): Entity {
  const q = place(site, x, z, yaw);
  return { id, def: defId, kind: 'fixture', label: id, pose: { p: [q.x, site.groundY ?? 0, q.z], yaw: q.yaw }, provenance: HYPO };
}

/** v1's piles + crew + visitor, plus the spare tread, forklift, campfire, benches, guests and wanderers. */
export function buildBayV2Entities(site: Site): Entity[] {
  const y = site.groundY ?? 0;
  const L = V2_LAYOUT;
  const out = buildBayEntities(site);
  const s2 = out.find((e) => e.id === 's2')!;
  const q2 = place(site, L.s2Pile.x, L.s2Pile.z, 0);
  s2.pose = { p: [q2.x, y, q2.z], yaw: q2.yaw };
  const sp = place(site, L.spare.x, L.spare.z, Math.PI / 2);
  out.push(component('t11', 'stair-tread', [sp.x, y, sp.z], sp.yaw, { phase: 'stored', provenance: HYPO }));
  const t = place(site, L.truck.x, L.truck.z, L.truck.yaw);
  out.push({ ...forklift('fk', t.x, t.z, t.yaw, y), provenance: HYPO });
  out.push(fixture(site, 'fire', 'campfire', L.fire.x, L.fire.z, 0));
  for (const b of L.benches) out.push(fixture(site, b.id, 'bench-6ft', b.x, b.z, Math.PI)); // seats face −z, toward the fire
  L.guests.forEach(([x, z], i) => { const q = place(site, x, z); out.push(human(`g${i + 1}`, q.x, q.z, { provenance: HYPO, y })); });
  L.wanderers.forEach(([x, z], i) => { const q = place(site, x, z); out.push(human(`w${i + 1}`, q.x, q.z, { provenance: HYPO, y })); });
  return out;
}

/** The wanderers' lawn east of the fire (a place region; ambient_wander needs one). */
export function buildBayV2Regions(site: Site): Region[] {
  const poly = V2_LAYOUT.lawn.map(([x, z]) => { const q = place(site, x, z); return [q.x, q.z] as [number, number]; });
  return [{ id: 'fire-lawn', label: 'lawn by the campfire (hypothetical)', kind: 'place', polygon: poly, level: 0, provenance: HYPO }];
}

/** v1's step graph with (a) spliced in where v1 carried s2, and (b) + (c) appended after the visit. */
export function buildBayV2Template(site: Site): SequenceTemplate {
  const v1 = buildBayTemplate(site);
  const L = V2_LAYOUT;
  const to = (x: number, z: number, yaw = 0) => place(site, x, z, yaw);
  const S: StepSpec[] = [];
  const step = (id: string, verb: string, params: Record<string, unknown>, after: string[] = [], label?: string) => S.push({ id, verb, params, after: after.length ? after : undefined, label });
  for (const s0 of v1.steps) {
    const s: StepSpec = { ...s0, after: s0.after ? [...s0.after] : undefined };
    if (s.id === 'carry_s2') {
      // (a) the forklift replaces v1's two-person carry of s2
      const t = to(L.truck.x, L.truck.z, L.truck.yaw);
      const side = to(L.truck.x + 1.0, L.truck.z); // beside the truck's flank (truck is 1.2 m wide)
      step('fk_walk', 'walk_to', { actor: '$crew[5]', x: side.x, z: side.z, level: 0 }, ['carry_j5'], 'operator walks to the parked forklift');
      step('fk_mount', 'mount', { actor: '$crew[5]', vehicle: 'fk' }, ['fk_walk']);
      step('fk_pick', 'forklift_pick', { operator: '$crew[5]', item: 's2' }, ['fk_mount'], 'forklift picks plywood s2 off the pile');
      // the joist carriers step back to the muster line: the last one stands on s2's ground spot
      const rest = [0, 1].map((i) => {
        const q = to(-6 + 1.2 * i, -7);
        step(`rest${i}`, 'walk_to', { actor: `$crew[${i}]`, x: q.x, z: q.z, level: 0 }, ['carry_j5']);
        return `rest${i}`;
      });
      const g = to(L.s2Ground.x, L.s2Ground.z, 0);
      step('fk_deliver', 'forklift_deliver', { operator: '$crew[5]', to: { x: g.x, z: g.z, yaw: g.yaw, level: 0 } }, ['fk_pick', 'fix_j5', 'deck_s1', ...rest], 'forklift sets s2 down beside the bay');
      step('fk_return', 'ride_to', { actor: '$crew[5]', x: t.x, z: t.z, level: 0 }, ['fk_deliver'], 'forklift back to its park spot');
      step('fk_dismount', 'dismount', { actor: '$crew[5]' }, ['fk_return']);
      continue;
    }
    if (s.id === 'deck_s1') s.after = ['fix_j5', 'carry_s1'];
    if (s.id === 'deck_s2') s.after = ['deck_s1', 'fk_dismount'];
    if (s.id === 'visit') {
      // (b) before the visitor goes up: crew[0] takes the spare tread up the finished stair, lays it, comes down
      const d = to(L.spareDeck.x, L.spareDeck.z, 0);
      step('carry_spare', 'carry', { crew: ['$crew[0]'], item: 't11', to: { x: d.x, z: d.z, yaw: d.yaw, level: 4 } }, s.after ?? [], 'crew[0] carries a spare tread up the stair onto the deck');
      const down = to(L.benches[0].x - 2, L.benches[0].z);
      step('down0', 'walk_to', { actor: '$crew[0]', x: down.x, z: down.z, level: 0 }, ['carry_spare'], 'crew[0] comes back down');
      s.after = ['down0'];
    }
    S.push(s);
  }
  // (c) the ending
  const ring = ['$crew[2]', '$crew[3]', '$crew[4]', '$crew[5]', '$visitor', '$guests[0]', '$guests[1]', '$guests[2]'];
  step('fire', 'campfire_circle', { actors: ring, fire: 'fire' }, ['visit', 'fk_dismount'], 'crew, visitor and guests gather round the campfire');
  step('sit0', 'gather', { actors: ['$crew[0]'], fixture: L.benches[0].id }, ['visit'], 'crew[0] sits on the west bench');
  step('sit1', 'gather', { actors: ['$crew[1]'], fixture: L.benches[1].id }, ['visit'], 'crew[1] sits on the east bench');
  step('wander', 'ambient_wander', { actors: ['$wanderers[0]', '$wanderers[1]'], region: 'fire-lawn', seed: 3, duration: WANDER_S }, ['visit'], 'two passers-by stroll the lawn');
  const standers = ['$crew[0]', '$crew[1]', ...ring];
  standers.forEach((a, i) => step(`stand${i}`, 'stand', { actor: a }, ['wander'], i === 0 ? 'everyone stands: the evening ends' : undefined));
  return {
    schema: SEQUENCE_SCHEMA,
    id: 'build-bay-v2',
    label: 'Build a rack bay from material piles, forklift a sheet, carry a spare up the stair, end at the campfire (hypothetical)',
    params: { crew: { kind: 'actors' }, visitor: { kind: 'actor' }, guests: { kind: 'actors' }, wanderers: { kind: 'actors' } },
    steps: S,
  };
}

export const buildBayV2Bindings = { crew: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'], visitor: 'visitor', guests: ['g1', 'g2', 'g3'], wanderers: ['w1', 'w2'] };

export function buildBayV2Registry(): Map<string, ActionDef> {
  const m = buildBayRegistry();
  for (const a of [...SOCIAL_ACTIONS, ...VEHICLE_ACTIONS, ...FORKLIFT_ACTIONS]) m.set(a.verb, a);
  return m;
}
/**
 * ENGINE ISSUE (routed around here, not fixed): `carryIntegrity` (carry/invariants.ts) reports every
 * `carried` component whose support is not `held` as `carry.support`, including a load on forks
 * (support `forks`), so the stock invariant set + a forklift pick flags every tick of the drive.
 * v2 runs carryIntegrity on everything except fork loads; those stay covered by `forkliftLoad`.
 */
const carryIntegrityExceptForks: Invariant = (rt) => carryIntegrity(rt).filter((d) => !(d.code === 'carry.support' && (d.subjects ?? []).some((id) => rt.world.entities[id]?.support?.kind === 'forks')));
export const BUILD_BAY_V2_INVARIANTS: Invariant[] = [...BUILD_BAY_INVARIANTS.map((i) => (i === carryIntegrity ? carryIntegrityExceptForks : i)), ...VEHICLE_INVARIANTS, ...FORKLIFT_INVARIANTS];
export const BUILD_BAY_V2_CONTRIBUTORS = BUILD_BAY_CONTRIBUTORS;
