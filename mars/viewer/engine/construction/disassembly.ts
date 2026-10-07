// Disassembly — the reverse of progressive construction (Mars assembly model v1,
// approximate: rule-based plausibility, not structural engineering).
//
// Every verb takes ONE part from its installed state back to the ground, where a
// later build can stage and install it again. Nothing is created or destroyed: the
// same entity comes down that went up, keeps its id and definition, and ends lying
// on the floor (phase 'staged', support 'ground', no connections).
//
//   remove_tread         the reverse of install_tread        (lift out of the flight)
//   remove_stair_flight  the reverse of install_stair_flight (walked off along the floor)
//   remove_plywood       the reverse of install_plywood      (two people lift it down)
//   remove_joist         the reverse of install_joist        (lifted off its beams)
//   hold_upright         the reverse of release_support      (people take hold again)
//   disconnect_beam      the reverse of connect_beam         (unhooked and lowered)
//   lower_upright        the reverse of raise_upright        (walked down to lying)
//
// Safety is refused, not repaired: a part is only removed when nothing still bears on
// it, nobody stands on, under or on the way to what is coming down, the drop spot is
// clear floor, and every upright that a beam joins is held by people. Lifts follow the
// install's own swept path in reverse, so a part comes down exactly the way it went up.
// None of these verbs is in the default registry (api/registry.ts): an engine adds
// DISASSEMBLY_ACTIONS explicitly under its own rules version, so old logs replay
// unchanged.
import { z } from 'zod';
import { angleDelta, datan2, dsin, obbOverlap, pointInObb, rot2, sub2, type OBB2, type Vec2, hypot, obbCorners } from '../core/math.ts';
import type { ActionDef, Diagnostic } from '../actions/types.ts';
import type { Runtime } from '../runtime/runtime.ts';
import type { Entity, Pose, WorldState } from '../world/types.ts';
import { def, HUMAN_RADIUS } from '../world/catalog.ts';
import { entityFootprint } from '../spatial/service.ts';
import { HUMAN_PROFILE } from '../spatial/types.ts';
import { makeWay } from '../locomotion/walk.ts';
import { carry } from '../carry/actions.ts';
import { entityFrame } from '../carry/formation.ts';
import type { CarryParams, CarryProgram } from '../carry/validate.ts';
import { holdStations, isBeam, isStanding, isUpright, seatPoint } from './rules.ts';
import { bearsOn, flatObb, isJoist, isPlywood, memberTop } from './deck.ts';
import { isStairFlight, missingTreads, stairGeom, stairObb } from './stairs.ts';
import { checkStations, childrenState, walkCrew, type Children } from './children.ts';
import { frameLinks } from './frame.ts';
import { pickupPlan } from './liftcrew.ts';
import { clearanceAt, nearestBlocker } from '../spatial/grid.ts';
import {
  approach, beginLift, crewCheck, f2, fail, findStations, lerpPose, levelFor, liftDuration, liftStep, releaseCrew, spatialOf, stationFloor, sweepPoses, sweptLiftPath, symmetricYaw,
  type Fail, type LiftExec, type LiftPath, type Station, type SweepOpts,
} from './access.ts';
import { putRaiseFrame, raiseFrame, type RaiseFrame } from './raise-lower.ts';
import {
  RAISE_RATE, LIFT_SPEED, raiseChoreoBlocked, raiseFaceCol, raiseGeo, raiseLifterAt, raiseReach, raiseRoles, raiseStandBlocked, raiseSweep, raiseTransitionPitch,
  type RaiseGeo, type RaiseRole,
} from './raise.ts';

export const DISASSEMBLY_RULES = 'disassembly/1';
const CONSTRUCTION =
  'disassembly actions hold a load (support held / lowering, a crew gripping it) and drive crew sub-walks plus lift trajectories whose tick-exact restoration has not been verified';

const Target = z.strictObject({ x: z.number().min(-1e4).max(1e4), z: z.number().min(-1e4).max(1e4), yaw: z.number().min(-10).max(10) });
type To = z.infer<typeof Target>;
const id80 = z.string().max(80);
const others = (w: WorldState, crew: string[]) => Object.values(w.entities).filter((e) => e.kind === 'human' && e.human && !crew.includes(e.id)).sort((a, b) => (a.id < b.id ? -1 : 1));
const xz = (e: Entity): Vec2 => [e.pose.p[0], e.pose.p[2]];

/** Height of the walkable ground floor (level 0). */
function groundY(rt: Runtime): number {
  return spatialOf(rt).scene.levels.find((l) => l.id === 0)?.y ?? 0;
}

/** The ground pose a removed part is laid at: flat, its yaw kept within a half turn of where it is. */
export function dropPose(rt: Runtime, e: Entity, to: To, symmetric = true): Pose {
  return { p: [to.x, groundY(rt), to.z], yaw: symmetric ? symmetricYaw(e.pose.yaw, to.yaw) : to.yaw, pitch: 0, roll: 0 };
}

/** Something already there (another part, a fixture), a person, or no floor under the drop footprint. */
export function dropIssue(rt: Runtime, e: Entity, pose: Pose, crew: string[], code = 'remove'): Fail | null {
  const sp = spatialOf(rt);
  const f = entityFootprint({ ...e, pose });
  for (const o of sp.scene.obstacles) {
    if (o.id === e.id || o.y1 <= f.y0 + 0.005 || o.y0 >= f.y1 - 0.005) continue;
    if (obbOverlap(f.obb, o.obb, -0.01))
      return fail(`${code}.drop-blocked`, `${e.id} cannot be laid at (${f2(pose.p[0])}, ${f2(pose.p[2])}): ${o.label && o.label !== o.id ? `${o.label} (${o.id})` : o.id} is already there`, [e.id, o.id], pose.p);
  }
  const floor = sp.scene.surfaces.filter((s) => Math.abs(s.y - pose.p[1]) < 0.05);
  if (!obbCorners(f.obb).every((c) => floor.some((s) => pointInObb(c, s.obb, 1e-6))))
    return fail(`${code}.drop-no-floor`, `${e.id} cannot be laid at (${f2(pose.p[0])}, ${f2(pose.p[2])}): there is no continuous floor under it`, [e.id], pose.p);
  for (const h of others(rt.world, crew))
    if (h.human!.level === 0 && pointInObb(xz(h), f.obb, HUMAN_RADIUS))
      return fail(`${code}.drop-occupied`, `${h.id} is standing where ${e.id} would be laid down`, [e.id, h.id], pose.p);
  return null;
}

/** Installed parts that still rest on, hook onto or seat into `id`. */
export function loadsOn(w: WorldState, id: string): string[] {
  return Object.values(w.entities)
    .filter((o) => o.id !== id && o.kind === 'component' && o.phase === 'installed' && (bearsOn(o).includes(id) || (o.connections ?? []).some((c) => c.to === id && (c.socket === 'top' || c.socket === 'seat'))))
    .map((o) => o.id)
    .sort();
}

/** People standing on a frame link (climbing an upright, walking a beam) that involves any of `ids`. */
function frameOccupants(w: WorldState, ids: string[]): string[] {
  const links = new Set(frameLinks(w).filter((l) => (l.members ?? [l.id]).some((m) => ids.includes(m)) || ids.some((i) => l.id.includes(i))).map((l) => l.id));
  return Object.values(w.entities).filter((h) => h.human?.on && links.has(h.human.on)).map((h) => h.id).sort();
}

/**
 * The install's own swept path, reversed: plan ground → seat for the part as if it lay at
 * `ground`, then walk it backwards. A part comes down exactly the way it went up.
 */
export function reverseLiftPath(rt: Runtime, e: Entity, ground: Pose, o: SweepOpts): { ok: true; path: LiftPath } | Fail {
  const r = sweptLiftPath(rt, { ...e, pose: ground }, ground, e.pose, o);
  if (!r.ok) return { ok: false, diagnostic: { ...r.diagnostic, code: r.diagnostic.code === 'lift.path-blocked' ? 'remove.path-blocked' : r.diagnostic.code, message: r.diagnostic.message.replace('cannot be lifted into place', 'cannot be taken down') } };
  return { ok: true, path: { via: r.path.via, poses: [...r.path.poses].reverse().map((q) => structuredClone(q)) } };
}

// ---------------------------------------------------------------- shared lift-down exec

type LiftDownProg = { to: Pose; stations: Station[]; sweep: SweepOpts; base: number; slots?: string[]; offsets?: Vec2[] };
type LDExec = LiftExec & { p: { crew: string[] }; prog: LiftDownProg; verb: string };

/** One tick of a lift-down: walk to the stations, recheck, detach and lift along the reversed install path. */
function liftDownStep(rt: Runtime, ex: LDExec, dt: number, recheck: () => Fail | null, detach: () => void, code: string, follow = true) {
  if (ex.phase === 'approach') {
    const s = approach(rt, ex, ex.prog.stations, `${code}.station-unreachable`, follow);
    if (s === 'running') return { status: 'running' as const, phase: 'approach' };
    if (s !== 'arrived') return { status: 'failed' as const, diagnostic: s };
    const again = recheck();
    if (again) return { status: 'failed' as const, diagnostic: again.diagnostic };
    const item = rt.world.entities[ex.item];
    const path = reverseLiftPath(rt, item, ex.to, ex.prog.sweep);
    if (!path.ok) return { status: 'failed' as const, diagnostic: path.diagnostic };
    detach();
    beginLift(rt, ex);
    ex.path = path.path.poses;
    ex.duration = liftDuration(path.path, ex.prog.base);
    ex.phase = 'place';
  }
  const ls = liftStep(rt, ex, dt, follow);
  if (!follow) {
    // carriers either side of a walked part (a stair flight) keep their offsets
    const q = rt.world.entities[ex.item].pose;
    for (const [i, c] of ex.crew.entries()) {
      const oo = rot2(ex.prog.offsets![i], q.yaw);
      const h = rt.world.entities[c];
      h.pose = { ...h.pose, p: [q.p[0] + oo[0], h.pose.p[1], q.p[2] + oo[1]] };
    }
  }
  if (ls !== true) return ls ? { status: 'blocked' as const, diagnostic: ls } : { status: 'running' as const, phase: 'take-down' };
  const e = rt.world.entities[ex.item];
  e.pose = structuredClone(ex.to);
  e.phase = 'staged';
  e.support = { kind: 'ground' };
  delete e.connections;
  e.reservedBy = undefined;
  releaseCrew(rt, ex.crew);
  spatialOf(rt);
  return { status: 'completed' as const, outputs: { item: e.id, at: [e.pose.p[0], e.pose.p[2]] } };
}

function cancelLiftDown(rt: Runtime, ex: LDExec, code: string) {
  if (ex.phase === 'place')
    return { ok: false as const, diagnostic: { code: `${code}.cancel-unsafe`, message: `${ex.item} is being taken down; it cannot be abandoned mid-air`, subjects: [ex.item] } };
  for (const r of ex.children?.recs ?? []) if (rt.isActive(r.id)) rt.cancel(r.id);
  return { ok: true as const };
}

function startLiftDown(rt: Runtime, verb: string, p: { crew: string[] }, prog: LiftDownProg, id: string, item: string): LDExec {
  const e = rt.world.entities[item];
  e.phase = 'reserved';
  return { verb, p, prog, id, crew: p.crew, item, phase: 'approach', t: 0, from: structuredClone(e.pose), to: prog.to, duration: prog.base, ...(prog.slots ? { slots: prog.slots } : {}) };
}

// ---------------------------------------------------------------- remove_tread

type RTP = { crew: string[]; stair: string; tread: string; index: number; to: To };

/** People on or at the stair (any level) and on the landing it serves: removing a tread or flight would strand or drop them. */
function stairOccupants(w: WorldState, st: Entity, crew: string[]): string[] {
  const g = stairGeom(st.def, st.pose), obb = stairObb(g);
  return others(w, crew)
    .filter((h) => pointInObb(xz(h), obb, HUMAN_RADIUS + 0.15) || (h.human!.level > 0 && hypot(h.pose.p[0] - g.top[0], h.pose.p[2] - g.top[1]) < 4))
    .map((h) => h.id);
}
/** Active walks bound for a raised level near `at` (someone on the way up). */
function boundAbove(rt: Runtime, at: Vec2, radius: number): string[] {
  const out: string[] = [];
  for (const r of rt.records.values()) {
    if (!rt.isActive(r.id) || r.verb !== 'walk_to') continue;
    const q = r.params as { actor?: string; x?: number; z?: number; level?: number };
    if ((q.level ?? 0) > 0 && typeof q.x === 'number' && typeof q.z === 'number' && hypot(q.x - at[0], q.z - at[1]) < radius && q.actor) out.push(q.actor);
  }
  return out.sort();
}

function treadCheck(rt: Runtime, p: RTP, phaseOk: (e: Entity) => boolean): Fail | null {
  const w = rt.world, st = w.entities[p.stair], tr = w.entities[p.tread];
  if (!isStairFlight(st) || st.phase !== 'installed') return fail('remove.no-stair', `${p.stair} is not an installed stair flight`, [p.stair]);
  if (tr?.def !== 'stair-tread') return fail('remove.not-tread', `${p.tread} is not a stair tread`, [p.tread]);
  const seat = (st.connections ?? []).find((c) => c.socket === `tread-${p.index}`);
  if (!phaseOk(tr) || seat?.to !== tr.id) return fail('remove.not-installed', `${tr.id} is not installed as tread ${p.index} of ${st.id}`, [tr.id, st.id]);
  const on = stairOccupants(w, st, p.crew), up = boundAbove(rt, stairGeom(st.def, st.pose).top, 6).filter((a) => !p.crew.includes(a));
  if (on.length || up.length) return fail('remove.stair-occupied', `${[...on, ...up].join(', ')} ${on.length ? 'is on or at' : 'is on the way up'} ${st.id}; nobody may be on a stair or its deck while it is taken apart`, [st.id, ...on, ...up]);
  return null;
}

export function planRemoveTread(rt: Runtime, p: RTP): { ok: true; program: LiftDownProg } | Fail {
  const c = treadCheck(rt, p, (e) => e.phase === 'installed');
  if (c) return c;
  const w = rt.world, st = w.entities[p.stair], tr = w.entities[p.tread];
  const cc = crewCheck(rt, p.crew, 1, 2, 'taking out a tread');
  if (cc) return cc;
  const to = dropPose(rt, tr, p.to);
  const drop = dropIssue(rt, tr, to, p.crew);
  if (drop) return drop;
  const g = stairGeom(st.def, st.pose);
  const obb: OBB2 = { c: xz(tr), half: [def(tr.def).size[0] / 2, def(tr.def).size[2] / 2], yaw: tr.pose.yaw };
  const s2 = findStations(rt, p.crew, [xz(tr)], { label: `tread ${p.index} of ${st.id}`, obb, y: memberTop(tr), y0: tr.pose.p[1] }, [stairObb(g)]);
  if (!s2.ok) return s2;
  const sweep: SweepOpts = { ignore: [st.id], what: `tread ${p.index} (${tr.id}) of ${st.id}`, floor: stationFloor(rt, s2.stations) };
  const path = reverseLiftPath(rt, tr, to, sweep);
  if (!path.ok) return path;
  return { ok: true, program: { to, stations: s2.stations, sweep, base: 1.5 } };
}

export const removeTread: ActionDef<RTP, LiftDownProg, LDExec> = {
  verb: 'remove_tread',
  description: 'Take tread `index` out of an installed stair flight and lay it on the ground at `to` (x, z, yaw). Refused while anyone is on the stair or its deck.',
  schema: z.strictObject({ crew: z.array(id80).min(1).max(2), stair: id80, tread: id80, index: z.number().int().min(1).max(40), to: Target }),
  resumable: CONSTRUCTION,
  reservations: (_w, p) => [...p.crew.map((c) => ({ resource: `actor:${c}`, mode: 'exclusive' as const })), { resource: `entity:${p.tread}`, mode: 'exclusive' }, { resource: `tread:${p.stair}:${p.index}`, mode: 'exclusive' }],
  plan: planRemoveTread,
  start: (rt, p, prog, id) => startLiftDown(rt, 'remove_tread', p, prog, id, p.tread),
  step(rt, ex, dt) {
    const p = ex.p as RTP;
    return liftDownStep(rt, ex, dt, () => treadCheck(rt, p, (e) => e.phase === 'reserved'), () => {
      const st = rt.world.entities[p.stair];
      st.connections = (st.connections ?? []).filter((c) => c.socket !== `tread-${p.index}`);
    }, 'remove');
  },
  cancel: (rt, ex) => cancelLiftDown(rt, ex, 'remove'),
};

// ---------------------------------------------------------------- remove_stair_flight

type RSP = { crew: string[]; stair: string; to: To };

function stairCheck(rt: Runtime, p: RSP, phaseOk: (e: Entity) => boolean): Fail | null {
  const w = rt.world, st = w.entities[p.stair];
  if (!isStairFlight(st) || !phaseOk(st)) return fail('remove.not-installed', `${p.stair} is not an installed stair flight`, [p.stair]);
  const all = def(st.def).stair!.treads, missing = missingTreads(w, st);
  if (missing.length !== all) {
    const have = Array.from({ length: all }, (_, i) => i + 1).filter((i) => !missing.includes(i));
    return fail('remove.stair-has-treads', `${st.id} still has tread${have.length === 1 ? '' : 's'} ${have.join(', ')} fitted; take the treads out first`, [st.id]);
  }
  const on = stairOccupants(w, st, p.crew), up = boundAbove(rt, stairGeom(st.def, st.pose).top, 6).filter((a) => !p.crew.includes(a));
  if (on.length || up.length) return fail('remove.stair-occupied', `${[...on, ...up].join(', ')} ${on.length ? 'is on or at' : 'is on the way up'} ${st.id}; nobody may be on a stair or its deck while it is taken apart`, [st.id, ...on, ...up]);
  return null;
}

export function planRemoveStair(rt: Runtime, p: RSP): { ok: true; program: LiftDownProg } | Fail {
  const c = stairCheck(rt, p, (e) => e.phase === 'installed');
  if (c) return c;
  const st = rt.world.entities[p.stair];
  const cc = crewCheck(rt, p.crew, 2, 2, `taking down a ${def(st.def).label}`);
  if (cc) return cc;
  const to = dropPose(rt, st, p.to, false);
  const drop = dropIssue(rt, st, to, p.crew);
  if (drop) return drop;
  const top = (st.connections ?? []).find((x) => x.socket === 'top')?.to;
  const g = stairGeom(st.def, st.pose);
  const off = g.width / 2 + 0.45;
  const offsets: Vec2[] = [[0, -off], [0, off]];
  // walked along the floor by its carriers, as it came: no hoisting over anything
  const sweep: SweepOpts = { ignore: top ? [top] : [], liftOver: false, what: `stair flight ${st.id}` };
  const path = reverseLiftPath(rt, st, to, sweep);
  if (!path.ok) return path;
  const sp = spatialOf(rt), gr = sp.level(0)!;
  const dist = hypot(to.p[0] - st.pose.p[0], to.p[2] - st.pose.p[2]);
  const n = Math.max(2, Math.ceil(dist / 0.1));
  for (let k = 0; k <= n; k++) {
    const t = k / n, q: Vec2 = [st.pose.p[0] + (to.p[0] - st.pose.p[0]) * t, st.pose.p[2] + (to.p[2] - st.pose.p[2]) * t];
    const yaw = st.pose.yaw + (to.yaw - st.pose.yaw) * t;
    for (const o of offsets) {
      const oo = rot2(o, yaw), cp: Vec2 = [q[0] + oo[0], q[1] + oo[1]];
      if (clearanceAt(gr, cp) < HUMAN_PROFILE.radius - 0.02) return fail('remove.move-blocked', `a carrier of ${st.id} would hit ${nearestBlocker(gr, cp) ?? 'the floor edge'} at (${f2(cp[0])}, ${f2(cp[1])})`, [st.id], [cp[0], 0, cp[1]]);
    }
  }
  const stations: Station[] = p.crew.map((actor, i) => {
    const oo = rot2(offsets[i], st.pose.yaw);
    return { actor, level: 0, p: [st.pose.p[0] + oo[0], st.pose.p[2] + oo[1]] as Vec2, yaw: st.pose.yaw };
  });
  return { ok: true, program: { to, stations, sweep, base: Math.max(2, dist / 0.6), slots: ['lift-edge-0', 'lift-edge-1'], offsets } };
}

export const removeStairFlight: ActionDef<RSP, LiftDownProg, LDExec> = {
  verb: 'remove_stair_flight',
  description: 'Two people walk an installed stair flight (all treads already out) off its deck edge and stand it on the ground at `to` (x, z, heading). Refused while anyone is on the stair or its deck.',
  schema: z.strictObject({ crew: z.array(id80).min(1).max(2), stair: id80, to: Target }),
  resumable: CONSTRUCTION,
  reservations: (_w, p) => [...p.crew.map((c) => ({ resource: `actor:${c}`, mode: 'exclusive' as const })), { resource: `entity:${p.stair}`, mode: 'exclusive' }],
  plan: planRemoveStair,
  start: (rt, p, prog, id) => startLiftDown(rt, 'remove_stair_flight', p, prog, id, p.stair),
  step(rt, ex, dt) {
    const p = ex.p as RSP;
    return liftDownStep(rt, ex, dt, () => stairCheck(rt, p, (e) => e.phase === 'reserved'), () => {}, 'remove', false);
  },
  cancel(rt, ex) {
    const r = cancelLiftDown(rt, ex, 'remove');
    if (!r.ok) r.diagnostic.message = `${ex.item} is being walked off its deck edge; the crew cannot safely abandon it during this movement`;
    return r;
  },
};

// ---------------------------------------------------------------- remove_plywood / remove_joist

type RPP = { crew: string[]; sheet: string; to: To };
type RJP = { crew: string[]; joist: string; to: To };

/** People standing on (or within a step of) a deck sheet, and walks bound for it. */
function deckOccupants(rt: Runtime, e: Entity, crew: string[]): string[] {
  const level = levelFor(memberTop(e)), obb = flatObb(e.pose, e);
  const on = others(rt.world, crew).filter((h) => h.human!.level === level && pointInObb(xz(h), obb, HUMAN_RADIUS + 0.3)).map((h) => h.id);
  return [...new Set([...on, ...boundAbove(rt, obb.c, 6).filter((a) => !crew.includes(a))])].sort();
}

function memberCheck(rt: Runtime, id: string, crew: string[], kind: 'plywood' | 'joist', phaseOk: (e: Entity) => boolean): Fail | null {
  const e = rt.world.entities[id];
  if (!(kind === 'plywood' ? isPlywood(e) : isJoist(e)) || !phaseOk(e)) return fail('remove.not-installed', `${id} is not an installed ${kind === 'plywood' ? 'plywood sheet' : '2x4 joist'}`, [id]);
  const loads = loadsOn(rt.world, id);
  if (loads.length) return fail('remove.still-loaded', `${loads.join(', ')} still ${loads.length === 1 ? 'rests' : 'rest'} on ${id}; take ${loads.length === 1 ? 'it' : 'them'} down first`, [id, ...loads]);
  const people = deckOccupants(rt, e, crew);
  if (people.length) return fail('remove.deck-occupied', `${people.join(', ')} ${people.length === 1 ? 'is' : 'are'} on or bound for the deck over ${id}; nobody may be on a deck while it is taken apart`, [id, ...people]);
  return null;
}

function planMember(rt: Runtime, id: string, crew: string[], toT: To, kind: 'plywood' | 'joist'): { ok: true; program: LiftDownProg } | Fail {
  const c = memberCheck(rt, id, crew, kind, (e) => e.phase === 'installed');
  if (c) return c;
  const e = rt.world.entities[id];
  const cc = kind === 'plywood' ? crewCheck(rt, crew, 2, 2, `taking up a ${def(e.def).label}`) : crewCheck(rt, crew, 1, 2, `taking down a ${def(e.def).label}`);
  if (cc) return cc;
  const to = dropPose(rt, e, toT);
  const drop = dropIssue(rt, e, to, crew);
  if (drop) return drop;
  const len = def(e.def).size[0], c0 = xz(e), u = rot2([len * 0.45, 0], e.pose.yaw);
  const anchors: Vec2[] = crew.length === 1 ? [c0] : [[c0[0] - u[0], c0[1] - u[1]], [c0[0] + u[0], c0[1] + u[1]]];
  const st = findStations(rt, crew, anchors, { label: `${kind} ${id}`, obb: flatObb(e.pose, e), y: memberTop(e), y0: e.pose.p[1] });
  if (!st.ok) return st;
  const sweep: SweepOpts = { ignore: bearsOn(e), what: `${kind} ${id}`, floor: stationFloor(rt, st.stations) };
  const path = reverseLiftPath(rt, e, to, sweep);
  if (!path.ok) return path;
  return { ok: true, program: { to, stations: st.stations, sweep, base: kind === 'plywood' ? 3.0 : 2.0 } };
}

export const removePlywood: ActionDef<RPP, LiftDownProg, LDExec> = {
  verb: 'remove_plywood',
  description: 'Two people lift an installed deck sheet off its joists and lay it flat on the ground at `to` (x, z, yaw). Refused while anything rests on it or anyone is on or bound for that deck.',
  schema: z.strictObject({ crew: z.array(id80).min(1).max(2), sheet: id80, to: Target }),
  resumable: CONSTRUCTION,
  reservations: (_w, p) => [...p.crew.map((c) => ({ resource: `actor:${c}`, mode: 'exclusive' as const })), { resource: `entity:${p.sheet}`, mode: 'exclusive' }],
  plan: (rt, p) => planMember(rt, p.sheet, p.crew, p.to, 'plywood'),
  start: (rt, p, prog, id) => startLiftDown(rt, 'remove_plywood', p, prog, id, p.sheet),
  step(rt, ex, dt) {
    const p = ex.p as RPP;
    return liftDownStep(rt, ex, dt, () => memberCheck(rt, p.sheet, p.crew, 'plywood', (e) => e.phase === 'reserved'), () => {}, 'remove');
  },
  cancel: (rt, ex) => cancelLiftDown(rt, ex, 'remove'),
};

export const removeJoist: ActionDef<RJP, LiftDownProg, LDExec> = {
  verb: 'remove_joist',
  description: 'Lift an installed 2x4 joist off its two beams and lay it on the ground at `to` (x, z, yaw). Refused while any sheet or stair still rests on it or anyone is on that deck.',
  schema: z.strictObject({ crew: z.array(id80).min(1).max(2), joist: id80, to: Target }),
  resumable: CONSTRUCTION,
  reservations: (_w, p) => [...p.crew.map((c) => ({ resource: `actor:${c}`, mode: 'exclusive' as const })), { resource: `entity:${p.joist}`, mode: 'exclusive' }],
  plan: (rt, p) => planMember(rt, p.joist, p.crew, p.to, 'joist'),
  start: (rt, p, prog, id) => startLiftDown(rt, 'remove_joist', p, prog, id, p.joist),
  step(rt, ex, dt) {
    const p = ex.p as RJP;
    return liftDownStep(rt, ex, dt, () => memberCheck(rt, p.joist, p.crew, 'joist', (e) => e.phase === 'reserved'), () => {}, 'remove');
  },
  cancel: (rt, ex) => cancelLiftDown(rt, ex, 'remove'),
};

// ---------------------------------------------------------------- hold_upright (reverse of release_support)

type HP = { crew: string[]; item: string };
type HExec = { p: HP; id: string; phase: 'approach' | 'grip'; children?: Children; t: number };

export function planHold(rt: Runtime, p: HP): { ok: true; program: { p: Vec2; yaw: number }[] } | Fail {
  const w = rt.world, u = w.entities[p.item];
  if (!isUpright(u)) return fail('hold.not-upright', `${p.item} is not a pallet-rack upright`, [p.item]);
  if (u.support?.kind === 'held') return fail('hold.already-held', `${u.id} is already held by ${u.support.by.join(', ')}`, [u.id, ...u.support.by]);
  if (!isStanding(u) || u.phase !== 'installed' || u.support?.kind !== 'connected') return fail('hold.not-installed', `${u.id} is not a standing, released (installed) upright`, [u.id]);
  const need = def(u.def).handling?.holdCrew ?? 1;
  if (p.crew.length < need) return fail('hold.crew-too-small', `holding the ${def(u.def).label} ${u.id} needs at least ${need} ${need === 1 ? 'person' : 'people'}; ${p.crew.length} assigned`, [u.id, ...p.crew]);
  const cc = crewCheck(rt, p.crew, 1, 2, `holding ${u.id}`);
  if (cc) return cc;
  const on = frameOccupants(w, [u.id]);
  if (on.length) return fail('hold.frame-occupied', `${on.join(', ')} ${on.length === 1 ? 'is' : 'are'} on ${u.id}'s frame`, [u.id, ...on]);
  const st = holdStations(u, p.crew.length);
  const unreachable = checkStations(rt, p.crew.map((actor, i) => ({ actor, p: st[i].p })));
  if (unreachable) return { ok: false, diagnostic: { ...unreachable, code: 'hold.station-unreachable' } };
  return { ok: true, program: st };
}

export const holdUpright: ActionDef<HP, { p: Vec2; yaw: number }[], HExec> = {
  verb: 'hold_upright',
  description: 'People take hold of a released standing upright at its holding stations and keep holding it (support held), so its beams can be taken out. The reverse of release_support; the crew stays committed until lower_upright.',
  schema: z.strictObject({ crew: z.array(id80).min(1).max(2), item: id80 }),
  resumable: CONSTRUCTION,
  reservations: (_w, p) => [...p.crew.map((c) => ({ resource: `actor:${c}`, mode: 'exclusive' as const })), { resource: `entity:${p.item}`, mode: 'exclusive' }],
  plan: planHold,
  start: (_rt, p, _prog, id) => ({ p, id, phase: 'approach', t: 0 }),
  step(rt, ex, dt) {
    const w = rt.world, u = w.entities[ex.p.item];
    if (ex.phase === 'approach') {
      if (!ex.children) {
        const st = holdStations(u, ex.p.crew.length);
        const r = walkCrew(rt, ex.id, ex.p.crew.map((actor, i) => ({ actor, p: st[i].p, yaw: st[i].yaw })));
        if ('code' in r) return { status: 'failed', diagnostic: { ...r, code: 'hold.station-unreachable' } };
        ex.children = r;
      }
      const s = childrenState(ex.children);
      if (s === 'running') return { status: 'running', phase: 'approach' };
      if (s !== 'done') return { status: 'failed', diagnostic: s };
      if (u.support?.kind !== 'connected' || !isStanding(u)) return { status: 'failed', diagnostic: { code: 'hold.stale', message: `${u.id} is no longer a released standing upright`, subjects: [u.id] } };
      ex.phase = 'grip';
      ex.t = 0;
    }
    ex.t += dt;
    for (const [i, c] of ex.p.crew.entries()) Object.assign(w.entities[c].human!, { activity: 'support', grip: { entity: u.id, slot: `hold-${i}` }, task: ex.id });
    if (ex.t < 1.0) return { status: 'running', phase: 'grip' };
    u.support = { kind: 'held', by: [...ex.p.crew] };
    u.phase = 'placed';
    return { status: 'completed', outputs: { holding: ex.p.crew } };
  },
  cancel(rt, ex) {
    for (const r of ex.children?.recs ?? []) if (rt.isActive(r.id)) rt.cancel(r.id);
    if (ex.phase === 'grip') for (const c of ex.p.crew) Object.assign(rt.world.entities[c].human!, { activity: 'idle', grip: undefined, task: undefined });
    return { ok: true };
  },
};

// ---------------------------------------------------------------- disconnect_beam (reverse of connect_beam)

type DP = { crew: string[]; beam: string; to: To };
type DProg = LiftDownProg & { a: string; b: string };

function beamCheck(rt: Runtime, p: DP, phaseOk: (e: Entity) => boolean): Fail | null {
  const w = rt.world, beam = w.entities[p.beam];
  if (!isBeam(beam) || !phaseOk(beam) || beam.support?.kind !== 'connected') return fail('remove.not-installed', `${p.beam} is not an installed beam`, [p.beam]);
  const ends = (beam.connections ?? []).map((c) => c.to);
  for (const id of ends) {
    const u = w.entities[id];
    const need = u ? def(u.def).handling?.holdCrew ?? 1 : 1;
    if (!isUpright(u) || u.support?.kind !== 'held' || u.support.by.length < need)
      return fail('remove.upright-not-held', `${p.beam} joins ${id}, which nobody is holding; hold both uprights before a beam comes out`, [p.beam, id]);
  }
  const loads = loadsOn(w, p.beam);
  if (loads.length) return fail('remove.still-loaded', `${loads.join(', ')} still ${loads.length === 1 ? 'rests' : 'rest'} on ${p.beam}; take ${loads.length === 1 ? 'it' : 'them'} down first`, [p.beam, ...loads]);
  const on = frameOccupants(w, [p.beam, ...ends]);
  if (on.length) return fail('remove.frame-occupied', `${on.join(', ')} ${on.length === 1 ? 'is' : 'are'} on the frame ${p.beam} belongs to`, [p.beam, ...on]);
  return null;
}

export function planDisconnect(rt: Runtime, p: DP): { ok: true; program: DProg } | Fail {
  const c = beamCheck(rt, p, (e) => e.phase === 'installed');
  if (c) return c;
  const w = rt.world, beam = w.entities[p.beam];
  if (p.crew.length !== 2) return fail('remove.beam-crew', 'taking out a beam needs exactly two people, one at each end', p.crew);
  const cc = crewCheck(rt, p.crew, 2, 2, `taking out ${p.beam}`);
  if (cc) return cc;
  const [ca, cb] = beam.connections!;
  const a = w.entities[ca.to], b = w.entities[cb.to];
  const m = /^col([lr])@(\d+(?:\.\d+)?)$/.exec(ca.toSocket);
  if (!m) return fail('remove.not-installed', `${p.beam} has no seat record on ${a.id}`, [p.beam, a.id]);
  const col = m[1] === 'l' ? -1 : 1, h = Number(m[2]);
  const mb = /^col([lr])@/.exec(cb.toSocket);
  const colB = mb?.[1] === 'l' ? -1 : 1;
  // the installers' own stations (beam.ts planBeam): just outside each column, beyond the bay end
  const rel = rot2(sub2(xz(b), xz(a)), -a.pose.yaw);
  const sgn = Math.sign(rel[1]) || 1;
  const face = (s: [number, number, number], outZ: number) => {
    const o = rot2([col * 0.25, outZ * 0.8], a.pose.yaw);
    return { p: [s[0] + o[0], s[2] + o[1]] as Vec2, yaw: datan2(-o[1], -o[0]) };
  };
  const sa = seatPoint(a, col as -1 | 1, h), sb = seatPoint(b, colB as -1 | 1, h);
  const stations: Station[] = [face(sa, -sgn), face(sb, sgn)].map((s, i) => ({ actor: p.crew[i], level: w.entities[p.crew[i]].human!.level, ...s }));
  const unreachable = checkStations(rt, stations.map((s) => ({ actor: s.actor, p: s.p })));
  if (unreachable) return { ok: false, diagnostic: { ...unreachable, code: 'remove.station-unreachable' } };
  const to = dropPose(rt, beam, p.to);
  // the people holding the frame stand at its columns, beside where its beams were staged (as in the build)
  const holders = [a, b].flatMap((u) => (u.support?.kind === 'held' ? u.support.by : []));
  const drop = dropIssue(rt, beam, to, [...p.crew, ...holders]);
  if (drop) return drop;
  const sweep: SweepOpts = { ignore: [a.id, b.id], what: `${def(beam.def).label} ${beam.id}` };
  const path = reverseLiftPath(rt, beam, to, sweep);
  if (!path.ok) return path;
  return { ok: true, program: { to, stations, sweep, base: 2.5, a: a.id, b: b.id } };
}

type DExec = LDExec & { prog: DProg };

export const disconnectBeam: ActionDef<DP, DProg, DExec> = {
  verb: 'disconnect_beam',
  description: 'Two people unhook an installed beam from two held uprights and lay it on the ground at `to` (x, z, yaw). Refused unless both uprights are held and nothing rests on the beam.',
  schema: z.strictObject({ crew: z.array(id80).min(1).max(4), beam: id80, to: Target }),
  resumable: CONSTRUCTION,
  reservations: (_w, p) => [...p.crew.map((c) => ({ resource: `actor:${c}`, mode: 'exclusive' as const })), { resource: `entity:${p.beam}`, mode: 'exclusive' }],
  plan(rt, p) {
    return planDisconnect(rt, p);
  },
  start(rt, p, prog, id) {
    const ex = startLiftDown(rt, 'disconnect_beam', p, prog, id, p.beam) as DExec;
    return ex;
  },
  step(rt, ex, dt) {
    const p = ex.p as DP;
    if (ex.phase === 'approach' && !ex.children) {
      // the crew takes hold beside the beam's ends where it sits (liftcrew pickupPlan) and walks it down
      const beam = rt.world.entities[p.beam];
      const pk = pickupPlan(rt, p.crew, beam, ex.to, ex.prog.stations);
      if ('code' in pk) return { status: 'failed', diagnostic: pk };
      ex.slots = pk.slots;
      const r = walkCrew(rt, ex.id, pk.moves);
      if ('code' in r) return { status: 'failed', diagnostic: { ...r, code: 'remove.station-unreachable' } };
      ex.children = r;
    }
    return liftDownStep(rt, ex, dt, () => beamCheck(rt, p, (e) => e.phase === 'reserved'), () => {
      const w = rt.world;
      for (const id of [ex.prog.a, ex.prog.b]) {
        const u = w.entities[id];
        u.connections = (u.connections ?? []).filter((c) => c.to !== p.beam);
        if (!u.connections.length) delete u.connections;
      }
    }, 'remove');
  },
  cancel: (rt, ex) => cancelLiftDown(rt, ex, 'remove'),
};

// ---------------------------------------------------------------- lower_upright (reverse of raise_upright)

type LP = { crew: string[]; item: string };
type LExec = { p: LP; id: string; phase: 'lower'; groundY: number; y0: number; roles: RaiseRole[]; geo: RaiseGeo; thT: number };
const HALF_PI = Math.PI / 2;

/** Next pitch toward lying: at most RAISE_RATE·dt more, and no lifter walks more than LIFT_SPEED·dt (raise.ts nextPitch, mirrored). */
function lowerPitch(g: RaiseGeo, th: number, hi: number, dt: number): number {
  const ceil = Math.min(hi, th + RAISE_RATE * dt);
  const r0 = raiseReach(g, th), max = LIFT_SPEED * dt;
  if (raiseReach(g, ceil) - r0 <= max) return ceil;
  let a = th, b = ceil;
  for (let k = 0; k < 40; k++) {
    const m = (a + b) / 2;
    if (raiseReach(g, m) - r0 > max) b = m; else a = m;
  }
  return a;
}

/**
 * raise-lower.ts loweringIssue, for a lowering that starts from the standing hold rather than a
 * recorded raise: the same frame sweep, moving-body, landing-floor, bystander and crew-floor checks,
 * except that the crew may step beside or over parts lying on the floor (below a step, as they
 * stood during the raise itself, e.g. beside a staged beam's end).
 */
function lowerIssue(rt: Runtime, item: string, from: RaiseFrame, to: RaiseFrame, gy: number): Diagnostic | null {
  const u = rt.world.entities[item], sp = spatialOf(rt);
  const refuse = (message: string, subjects: string[]): Diagnostic => ({ code: 'lower.blocked', message: `${item} waits to be lowered: ${message}`, subjects: [item, ...subjects] });
  const hit = sweepPoses(rt, u, [from.pose, to.pose], []);
  if (hit) return refuse(`its lowering sweep meets ${hit.o.label ?? hit.o.id}`, [hit.o.id]);
  const staticIds = new Set(sp.scene.obstacles.map((o) => o.id));
  const dynamic = Object.values(rt.world.entities)
    .filter((e) => e.id !== item && e.kind !== 'human' && e.kind !== 'marker' && !staticIds.has(e.id))
    .map((e) => ({ id: e.id, ...entityFootprint(e) }));
  const bodies = [...sp.scene.obstacles, ...dynamic];
  const crew = new Set(to.crew.map((c) => c.id));
  const bystanders = Object.values(rt.world.entities).filter((e) => e.human && !crew.has(e.id));
  for (let k = 0; k <= 24; k++) {
    const t = k / 24, pose = lerpPose(from.pose, to.pose, t);
    const fp = entityFootprint({ ...u, pose });
    const load = dynamic.find((o) => o.y1 > fp.y0 + 1e-6 && o.y0 < fp.y1 - 1e-6 && obbOverlap(fp.obb, o.obb, -1e-6));
    if (load) return refuse(`its lowering sweep meets moving ${load.id}`, [load.id]);
    if (Math.abs((pose.pitch ?? 0) - HALF_PI) < 1e-6 && !sp.scene.surfaces.some((s) => Math.abs(s.y - gy) < 0.05 && obbCorners(fp.obb).every((p) => pointInObb(p, s.obb, 1e-6))))
      return refuse('the lying footprint has no continuous floor support', []);
    for (const person of bystanders)
      if (person.pose.p[1] + 1.9 > fp.y0 && person.pose.p[1] < fp.y1 && pointInObb([person.pose.p[0], person.pose.p[2]], fp.obb, HUMAN_RADIUS))
        return refuse(`the descending frame would hit ${person.id}`, [person.id]);
    for (let i = 0; i < to.crew.length; i++) {
      const next = to.crew[i], q = lerpPose(from.crew[i].pose, next.pose, t);
      const p: Vec2 = [q.p[0], q.p[2]];
      if (!sp.scene.surfaces.some((s) => Math.abs(s.y - q.p[1]) < 0.05 && pointInObb(p, s.obb, -HUMAN_RADIUS)))
        return refuse(`${next.id}'s path has no floor support`, [next.id]);
      const body = { c: p, half: [HUMAN_RADIUS, HUMAN_RADIUS] as Vec2, yaw: 0 };
      const obstruction = bodies.find((o) => o.id !== item && o.y1 > q.p[1] + HUMAN_PROFILE.stepHeight && o.y0 < q.p[1] + 1.9 && obbOverlap(body, o.obb));
      if (obstruction) return refuse(`${next.id}'s path meets ${obstruction.id}`, [next.id, obstruction.id]);
      const person = bystanders.find((e) => Math.abs(e.pose.p[1] - q.p[1]) < 1 && hypot(e.pose.p[0] - p[0], e.pose.p[2] - p[1]) < 2 * HUMAN_RADIUS + 0.08);
      if (person) return refuse(`${next.id}'s path meets ${person.id}`, [next.id, person.id]);
    }
  }
  return null;
}

/** The point of a footprint's long centreline nearest p (step aside from here, sideways). */
function axisPoint(o: OBB2, p: Vec2): Vec2 {
  const long = o.half[0] >= o.half[1] ? 0 : 1, l = rot2(sub2(p, o.c), -o.yaw);
  const along = Math.max(-o.half[long], Math.min(o.half[long], l[long]));
  const w = rot2(long === 0 ? [along, 0] : [0, along], o.yaw);
  return [o.c[0] + w[0], o.c[1] + w[1]];
}
/** Geometry of the standing upright as the raise saw it while lying (same base, yaw and resting height). */
function lowerGeo(u: Entity, groundY: number): RaiseGeo {
  return { ...raiseGeo(u, groundY), y0: groundY + def(u.def).size[2] / 2 };
}
const lyingPose = (u: Entity, g: RaiseGeo): Pose => ({ p: [g.base[0], g.y0, g.base[1]], yaw: u.pose.yaw, pitch: HALF_PI, roll: 0 });

function lowerCheck(rt: Runtime, p: LP): Fail | null {
  const w = rt.world, u = w.entities[p.item];
  if (!isUpright(u)) return fail('lower.not-upright', `${p.item} is not a pallet-rack upright`, [p.item]);
  if (!isStanding(u)) return fail('lower.not-standing', `${u.id} is not standing`, [u.id]);
  const by = u.support?.kind === 'held' ? [...u.support.by].sort() : [];
  if (by.join() !== [...p.crew].sort().join()) return fail('lower.not-held-by-crew', `${u.id} must be held by exactly its lowering crew (${p.crew.join(', ')}); it is ${by.length ? `held by ${by.join(', ')}` : 'not held'}`, [u.id, ...p.crew]);
  const joined = (u.connections ?? []).filter((c) => w.entities[c.to]?.phase === 'installed' || w.entities[c.to]?.phase === 'reserved' || w.entities[c.to]?.phase === 'carried').map((c) => c.to);
  if (joined.length) return fail('lower.still-connected', `${u.id} is still joined to ${[...new Set(joined)].join(', ')}; take the beams out first`, [u.id, ...joined]);
  const on = frameOccupants(w, [u.id]);
  if (on.length) return fail('lower.frame-occupied', `${on.join(', ')} ${on.length === 1 ? 'is' : 'are'} on ${u.id}'s frame`, [u.id, ...on]);
  return null;
}

export function planLower(rt: Runtime, p: LP): { ok: true; program: null } | Fail {
  const c = lowerCheck(rt, p);
  if (c) return c;
  if (p.crew.length > 2) return fail('lower.crew-unsupported', `lowering is modelled for one or two holders (a lifter walking it down, a footer at the base); ${p.crew.length} assigned`, [p.item, ...p.crew]);
  if (new Set(p.crew).size !== p.crew.length) return fail('crew.duplicate', `crew for lowering ${p.item} lists someone twice`, p.crew);
  const u = rt.world.entities[p.item], gy = groundY(rt), g = lowerGeo(u, gy), roles = raiseRoles(p.crew);
  const lying = { ...u, pose: lyingPose(u, g) };
  const sweep = raiseSweep(rt, lying, 0, HALF_PI);
  if (sweep) return { ok: false, diagnostic: { ...sweep, code: 'lower.arc-blocked', message: sweep.message.replace('raising arc', 'lowering arc') } };
  const blocked = raiseChoreoBlocked(rt, lying, g, roles, raiseTransitionPitch(g, roles));
  if (blocked) return { ok: false, diagnostic: { ...blocked, code: 'lower.station-blocked', message: blocked.message.replace('walk', 'walk down').replace(' up:', ':') } };
  // People standing where it will lie are asked to step aside when the lowering begins (it waits for them).
  return { ok: true, program: null };
}

export const lowerUpright: ActionDef<LP, null, LExec> = {
  verb: 'lower_upright',
  description:
    'The crew holding a standing upright with no beams left walks it down to lying on the ground, retracing the raise (hands ≤ 2 m, ≤ 0.6 m/s): a footer braces the base while the lifter walks out toward the top. Waits for anyone in its way; a stop finishes the lowering safely.',
  schema: z.strictObject({ crew: z.array(id80).min(1).max(4), item: id80 }),
  resumable: CONSTRUCTION,
  reservations: (_w, p) => [...p.crew.map((c) => ({ resource: `actor:${c}`, mode: 'exclusive' as const })), { resource: `entity:${p.item}`, mode: 'exclusive' }],
  plan: planLower,
  start(rt, p, _prog, id) {
    const u = rt.world.entities[p.item], gy = groundY(rt), geo = lowerGeo(u, gy), roles = raiseRoles(p.crew);
    u.phase = 'raising';
    u.reservedBy = id;
    for (const c of p.crew) Object.assign(rt.world.entities[c].human!, { task: id });
    return { p, id, phase: 'lower', groundY: gy, y0: geo.y0, roles, geo, thT: raiseTransitionPitch(geo, roles) };
  },
  step(rt, ex, dt) {
    const w = rt.world, u = w.entities[ex.p.item], g = ex.geo;
    const th = u.pose.pitch ?? 0;
    if (th <= 1e-9) {
      // before it tilts at all: everyone clear of where it will lie (asked to step aside, perpendicular to it)
      const land = entityFootprint({ ...u, pose: lyingPose(u, g) }).obb;
      const inWay = others(w, ex.p.crew).filter((h) => h.human!.level === 0 && pointInObb(xz(h), land, HUMAN_RADIUS + 0.05));
      if (inWay.length) {
        for (const h of inWay) makeWay(rt, h.id, axisPoint(land, xz(h)));
        return { status: 'blocked', diagnostic: { code: 'lower.landing-occupied', message: `the crew holding ${u.id} waits for ${inWay.map((h) => h.id).join(', ')} to step clear of where it will lie`, subjects: [u.id, ...inWay.map((h) => h.id)], at: [land.c[0], ex.groundY, land.c[1]] } };
      }
    }
    const next = lowerPitch(g, th, HALF_PI, dt);
    const grip = (r: RaiseRole) => (next >= ex.thT - 1e-12 ? (r.lifter ? 'lift-far' : r.side < 0 ? 'foot-l' : 'foot-r') : `hold-${r.station}`);
    const to: RaiseFrame = {
      pose: { ...u.pose, p: [u.pose.p[0], ex.groundY + (ex.y0 - ex.groundY) * (next / HALF_PI), u.pose.p[2]], pitch: next },
      crew: ex.roles.map((r) => {
        const h = w.entities[r.actor];
        if (!r.lifter) return { id: r.actor, pose: structuredClone(h.pose), grip: { entity: u.id, slot: grip(r) } };
        const q = raiseLifterAt(g, r.side, next);
        return { id: r.actor, pose: { ...h.pose, p: [q[0], h.pose.p[1], q[1]], yaw: raiseFaceCol(g, q, r.side, raiseReach(g, next)) }, grip: { entity: u.id, slot: grip(r) } };
      }),
    };
    for (const c of to.crew) {
      if (!ex.roles.find((r) => r.actor === c.id)?.lifter) continue;
      const b = raiseStandBlocked(rt, u, c.id, [c.pose.p[0], c.pose.p[2]], HUMAN_RADIUS - 0.01);
      if (b) return { status: 'blocked', diagnostic: { ...b, code: 'lower.station-blocked' } };
    }
    const issue = lowerIssue(rt, u.id, raiseFrame(rt, u.id, ex.p.crew), to, ex.groundY);
    if (issue) {
      const who = issue.subjects?.find((s) => s !== u.id && w.entities[s]?.human && !ex.p.crew.includes(s));
      if (who) makeWay(rt, who, [u.pose.p[0] + (to.pose.p[0] - u.pose.p[0]), u.pose.p[2]], { by: `the crew lowering ${u.id}`, subjects: [u.id, ...ex.p.crew] });
      return { status: 'blocked', diagnostic: { ...issue, code: who ? 'lower.path-occupied' : 'lower.blocked' } };
    }
    putRaiseFrame(rt, u.id, to);
    for (const c of ex.p.crew) w.entities[c].human!.activity = 'support';
    if (next < HALF_PI - 1e-12) return { status: 'running', phase: next >= ex.thT ? 'lay-down' : 'tilt' };
    u.pose = lyingPose(u, g);
    u.support = { kind: 'ground' };
    u.phase = 'staged';
    u.reservedBy = undefined;
    for (const c of ex.p.crew) Object.assign(w.entities[c].human!, { grip: undefined, task: undefined, activity: 'idle' });
    return { status: 'completed', outputs: { lowered: u.id } };
  },
  cancel(rt, ex) {
    // Before it tilts, the crew simply keeps holding it standing (still a safe, held state).
    // Once tilting, the only safe stop is the ground: finish the lowering, recorded as cancelled.
    const u = rt.world.entities[ex.p.item];
    if ((u.pose.pitch ?? 0) > 1e-9) return { ok: true, deferred: true };
    u.phase = 'placed';
    u.reservedBy = undefined;
    return { ok: true };
  },
};

// ---------------------------------------------------------------- carry under disassembly/1

const axisAligned = (a?: number) => Math.abs(dsin(2 * (a ?? 0))) < 1e-9;
/**
 * The same physical placement, encoded half a turn about the vertical through the load's centre
 * (the encoding raise.ts canonicalLying already applies to frames). A load laid down by one carry
 * and taken up by the next can be planned end-for-end (the planner treats symmetric loads either
 * way round); the legacy lift then interpolated yaw across that half turn and swung the load
 * through the people beside it. Under disassembly/1 a re-carried load is first re-encoded to the
 * heading the crew takes it up at, so its lift is the ordinary small motion. Boxes lying with their
 * axes vertical/horizontal occupy exactly the same space either way.
 */
export function pickupEncoding(e: Entity, th: number): Pose | null {
  const { q } = entityFrame(e);
  if (!axisAligned(e.pose.pitch) || !axisAligned(e.pose.roll) || Math.abs(angleDelta(th, q.th)) <= Math.PI / 2) return null;
  return { ...e.pose, p: [2 * q.x - e.pose.p[0], e.pose.p[1], 2 * q.z - e.pose.p[2]], yaw: e.pose.yaw + Math.PI };
}

/** `carry` with the re-carry encoding fix above; everything else is the legacy verb. */
export const carryV1: ActionDef<CarryParams, CarryProgram, unknown> = {
  ...(carry as unknown as ActionDef<CarryParams, CarryProgram, unknown>),
  start(rt, p, prog, id) {
    const e = rt.world.entities[prog.item];
    const flipped = e && pickupEncoding(e, prog.pickup.th);
    if (flipped) {
      const same = JSON.stringify(prog.lying) === JSON.stringify(e.pose);
      e.pose = flipped;
      if (same) prog.lying = structuredClone(flipped);
    }
    return (carry as unknown as ActionDef<CarryParams, CarryProgram, unknown>).start(rt, p, prog, id);
  },
};

/** Reverse verbs, added to a registry explicitly (never part of the default registry). */
export const DISASSEMBLY_ACTIONS: ActionDef[] = [removeTread, removeStairFlight, removePlywood, removeJoist, holdUpright, disconnectBeam, lowerUpright] as ActionDef[];
/** A registry under disassembly/1: the default verbs, the reverse verbs, and carry with the re-carry encoding. */
export function disassemblyRegistry(create: (extra: ActionDef[]) => Map<string, ActionDef>): Map<string, ActionDef> {
  const registry = create(DISASSEMBLY_ACTIONS);
  registry.set('carry', carryV1 as ActionDef);
  return registry;
}
