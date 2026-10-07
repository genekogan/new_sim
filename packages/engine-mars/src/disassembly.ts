// A finite physical DISASSEMBLY job for the camp lookout: the exact reverse of the
// build (construction.ts), read from the same original parts/poses/supports.
//
// The build's own four phases run backwards, latest first: stairs → deck → frame →
// stage. Within a phase, the forward job order is reversed and every forward step
// that is physically done gets its inverse:
//
//   carry X to the bay   ↔ carry X back to its original pile place
//   raise_upright        ↔ lower_upright      release_support ↔ hold_upright
//   connect_beam         ↔ disconnect_beam    install_joist   ↔ remove_joist
//   install_plywood      ↔ remove_plywood     install_stair_flight ↔ remove_stair_flight
//   install_tread        ↔ remove_tread
//
// Removed parts are laid exactly where the build staged them (so a rebuild can take
// them straight up again) and the un-stage phases carry them back to the piles the
// camp started with. Materials are conserved by construction: the same entities,
// never created, merged or destroyed. Pure: it plans, the engine runs native verbs.
import { entityFrame } from '../../../mars/viewer/engine/carry/formation.ts';
import { angleDelta, hypot } from '../../../mars/viewer/engine/core/math.ts';
import { CAMP_BUILD_SITE, edenCampWorld, type CampActivity } from '../../../mars/viewer/engine/scenarios/eden-camp.ts';
import type { Entity, WorldState } from '../../../mars/viewer/engine/world/types.ts';
import { BUILD_ACTIONS, constructionDone, itemOf, phaseOf, type BuildPhase, type BuildPlan } from './construction.ts';
import { CAMP_EXPANSION_CAMPUS } from './camp-expansion.ts';

export const DISASSEMBLY_POLICY = 'disassembly/1';
/** Forward build order of the phases; disassembly takes them down from the end. */
export const BUILD_PHASES: readonly BuildPhase[] = ['stage', 'frame', 'deck', 'stairs'];
type Refusal = { code: string; message: string };
type Step = BuildPlan['steps'][number];
type Inverse = { forward: CampActivity; verb: string; roles: number; params: (crew: string[]) => Record<string, unknown> };

let genesis: WorldState | undefined;
/** The camp's original stock: where every part lay before anything was built. */
function original(id: string): Entity {
  genesis ??= edenCampWorld('disassembly-piles');
  const e = genesis.entities[id];
  if (!e) throw new Error(`disassembly.unknown-part: ${id}`);
  return e;
}
const angleMod = (a: number, b: number) => { const d = angleDelta(b, a); return Math.min(Math.abs(d), Math.abs(Math.PI - Math.abs(d))); };

/** Every part the lookout is made of (the build's own items). */
export const LOOKOUT_PARTS: readonly string[] = [...new Set(BUILD_ACTIONS.map(itemOf))].sort();
/** Where a part's original pile place is, as a carry target (load centre and long axis). */
export function pileTarget(id: string): { x: number; z: number; yaw: number } {
  const { q } = entityFrame(original(id));
  return { x: q.x, z: q.z, yaw: q.th };
}
/** The part lies in its original pile place (the build's own carry tolerance). */
export function atPile(world: WorldState, id: string): boolean {
  const e = world.entities[id];
  if (!e || !(e.phase === 'staged' || e.phase === 'stored') || e.support?.kind !== 'ground') return false;
  const { q, bottom } = entityFrame(e), t = pileTarget(id), b0 = entityFrame(original(id)).bottom;
  // lying on the floor (or as the original stock was encoded: genesis frames rest half a column low)
  return (Math.abs(bottom) < 0.015 || Math.abs(bottom - b0) < 0.015) && hypot(q.x - t.x, q.z - t.z) < 0.015 && angleMod(q.th, t.yaw) < 0.015;
}

/** The phase's forward job order from scratch (the order constructionPlan would choose). */
function forwardOrder(phase: BuildPhase): CampActivity[] {
  const all = BUILD_ACTIONS.filter((a) => phaseOf(a) === phase);
  const done = new Set(BUILD_ACTIONS.filter((a) => phaseOf(a) !== phase).map((a) => a.id)), out: CampActivity[] = [];
  while (out.length < all.length) {
    const next = all.find((a) => !done.has(a.id) && (a.after ?? []).every((id) => done.has(id)));
    if (!next) throw new Error(`disassembly.order-cycle: ${phase}`);
    out.push(next); done.add(next.id);
  }
  return out;
}

/** Where the build staged a part beside the bay (its forward carry target): removed parts are laid there. */
const stageOf = (id: string) => (BUILD_ACTIONS.find((a) => a.verb === 'carry' && a.params.item === id)?.params.to ?? pileTarget(id)) as { x: number; z: number; yaw: number };
const placeOf = (id: string) => { const e = original(id); return { x: e.pose.p[0], z: e.pose.p[2], yaw: e.pose.yaw }; };

/** The inverse of one forward job, or null when that job is not (physically) done. */
function inverseOf(world: WorldState, a: CampActivity): Inverse | null {
  const item = itemOf(a), p = a.params;
  if (a.verb === 'carry') {
    if (atPile(world, item)) return null;
    return { forward: a, verb: 'carry', roles: a.roles.length, params: (crew) => ({ crew, item, to: pileTarget(item) }) };
  }
  if (!constructionDone(world, a)) return null;
  switch (a.verb) {
    case 'release_support': return { forward: a, verb: 'hold_upright', roles: 1, params: (crew) => ({ crew, item }) };
    case 'raise_upright': return { forward: a, verb: 'lower_upright', roles: 1, params: (crew) => ({ crew, item }) };
    case 'connect_beam': return { forward: a, verb: 'disconnect_beam', roles: 2, params: (crew) => ({ crew, beam: item, to: stageOf(item) }) };
    case 'install_joist': return { forward: a, verb: 'remove_joist', roles: 1, params: (crew) => ({ crew, joist: item, to: stageOf(item) }) };
    case 'install_plywood': return { forward: a, verb: 'remove_plywood', roles: 2, params: (crew) => ({ crew, sheet: item, to: stageOf(item) }) };
    case 'install_stair_flight': return { forward: a, verb: 'remove_stair_flight', roles: 2, params: (crew) => ({ crew, stair: item, to: placeOf(item) }) };
    case 'install_tread': return { forward: a, verb: 'remove_tread', roles: 1, params: (crew) => ({ crew, stair: String(p.stair), tread: item, index: Number(p.index), to: placeOf(item) }) };
    default: throw new Error(`disassembly.no-inverse: ${a.verb}`);
  }
}

/** Pending inverse jobs of one phase, latest forward job first. */
export function pendingDisassembly(world: WorldState, phase: BuildPhase): Inverse[] {
  return forwardOrder(phase).reverse().map((a) => inverseOf(world, a)).filter((x): x is Inverse => !!x);
}

/** Someone up on the lookout (or walking up to it): nobody may be on a deck that is coming apart. */
export function lookoutOccupants(world: WorldState, walks: { actor: string; x: number; z: number; level: number }[] = []): string[] {
  const site = CAMP_BUILD_SITE.origin, near = (x: number, z: number) => hypot(x - site[0], z - site[1]) < 9;
  const up = Object.values(world.entities).filter((e) => e.human && e.human.level > 0 && near(e.pose.p[0], e.pose.p[2])).map((e) => e.id);
  const bound = walks.filter((w) => w.level > 0 && near(w.x, w.z)).map((w) => w.actor);
  return [...new Set([...up, ...bound])].sort();
}

/**
 * Plan one finite disassembly phase for `actor`: the crew (as the build's own phase
 * sizes: stage 1, deck/stairs 2, frame 4) and the native steps, or a precise refusal.
 * `walks` are active walk goals (someone on the way up to the deck).
 */
export function disassemblyPlan(world: WorldState, actor: string, phase: unknown, free: (id: string) => boolean, walks: { actor: string; x: number; z: number; level: number }[] = []): BuildPlan | Refusal {
  if (world.base.campus !== 'eden-camp' && world.base.campus !== CAMP_EXPANSION_CAMPUS) return { code: 'disassembly.only-camp', message: 'This project belongs to the camp build site.' };
  if (!BUILD_PHASES.includes(phase as BuildPhase)) return { code: 'disassembly.phase', message: 'Choose stairs, deck, frame or stage to take down.' };
  const at = BUILD_PHASES.indexOf(phase as BuildPhase);
  for (const later of BUILD_PHASES.slice(at + 1).reverse())
    if (pendingDisassembly(world, later).length) return { code: 'disassembly.order', message: `First take down the ${later} work; a structure comes apart in the reverse order it went up.` };
  const pending = pendingDisassembly(world, phase as BuildPhase);
  if (!pending.length) return { code: 'disassembly.not-built', message: `Nothing of the ${phase} work is up; there is nothing to take down.` };
  const people = lookoutOccupants(world, walks);
  if (people.length) return { code: 'disassembly.deck-occupied', message: `${people.join(', ')} ${people.length === 1 ? 'is' : 'are'} up on the lookout or on the way up; nobody may be on a deck that is being taken apart.` };
  const held = ['upright-a', 'upright-b'].map((id) => { const s = world.entities[id]?.support; return s?.kind === 'held' ? s.by[0] : undefined; });
  const available = Object.keys(world.entities).sort().filter((id) => {
    const e = world.entities[id]; return e.human?.level === 0 && !e.human.grip && free(id) && e.body?.family !== 'floater';
  });
  const count = phase === 'frame' ? 4 : phase === 'stage' ? 1 : 2;
  const crew = [...new Set([actor, ...(phase === 'frame' ? held.filter((id): id is string => !!id) : []), ...available])].slice(0, count);
  if (crew.length < count || !crew.every((id) => { const e = world.entities[id]; return e?.human?.level === 0 && free(id) && (!e.human.grip || (phase === 'frame' && held.includes(id))); }))
    return { code: 'disassembly.crew-unavailable', message: `Taking down the ${phase} work needs ${count} free ground-level ${count === 1 ? 'person' : 'people'}.` };
  let aHolder = held[0], bHolder = held[1];
  if (phase === 'frame') { aHolder ??= crew.find((id) => id !== bHolder); bHolder ??= crew.find((id) => id !== aHolder); }
  const beamCrew = crew.filter((id) => id !== aHolder && id !== bHolder);
  const steps: Step[] = pending.map((inv) => {
    const item = itemOf(inv.forward);
    const who = ['hold_upright', 'lower_upright'].includes(inv.verb) ? [item === 'upright-a' ? aHolder! : bHolder!] : inv.verb === 'disconnect_beam' ? beamCrew.slice(0, 2) : crew.slice(0, inv.roles);
    return { verb: `mars:${inv.verb}`, params: inv.params(who) };
  });
  return { crew, steps };
}

export type LookoutPhaseState = 'down' | 'partial' | 'up';
export type LookoutActionV1 = { verb: 'build_lookout' | 'unbuild_lookout'; phase: BuildPhase; available: boolean; reason?: string };
/**
 * The lookout as one object with explicit state and typed actions (edge-ready: an owner's agent
 * can be offered exactly these). Structural only: whether a phase is up, partly up or down, and
 * which build / take-down jobs the structure itself allows next. Crew, occupancy and site use are
 * still decided at admission (constructionPlan / disassemblyPlan), with their precise refusals.
 */
export function lookoutStateV1(world: WorldState): { contract: 'lookout-state/1'; phases: Record<BuildPhase, LookoutPhaseState>; actions: LookoutActionV1[] } {
  const phases = Object.fromEntries(BUILD_PHASES.map((ph) => {
    const forward = BUILD_ACTIONS.filter((a) => phaseOf(a) === ph);
    const up = forward.every((a) => constructionDone(world, a)), down = pendingDisassembly(world, ph).length === 0;
    return [ph, down ? 'down' : up ? 'up' : 'partial'];
  })) as Record<BuildPhase, LookoutPhaseState>;
  const actions: LookoutActionV1[] = [];
  for (const [i, ph] of BUILD_PHASES.entries()) {
    const before = BUILD_PHASES.slice(0, i).find((x) => phases[x] !== 'up'), after = BUILD_PHASES.slice(i + 1).reverse().find((x) => phases[x] !== 'down');
    actions.push(phases[ph] === 'up' ? { verb: 'build_lookout', phase: ph, available: false, reason: `the ${ph} work is already up` }
      : before ? { verb: 'build_lookout', phase: ph, available: false, reason: `build the ${before} work first` } : { verb: 'build_lookout', phase: ph, available: true });
    actions.push(phases[ph] === 'down' ? { verb: 'unbuild_lookout', phase: ph, available: false, reason: `nothing of the ${ph} work is up` }
      : after ? { verb: 'unbuild_lookout', phase: ph, available: false, reason: `take down the ${after} work first` } : { verb: 'unbuild_lookout', phase: ph, available: true });
  }
  return { contract: 'lookout-state/1', phases, actions };
}
