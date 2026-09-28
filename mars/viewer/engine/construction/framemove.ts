// Moving on the rack structure (owner feedback §5; frame.ts has the links and the rules):
//   climb_frame {actor, link, dir}  up: walk to the foot of an installed upright's climb link, climb
//                                   the bracing (0.35 m/s, one person at a time) and step onto the beam
//                                   end; down: walk the beam to the link's exit and climb back down.
//   beam_walk   {actor, x, z, speed?}  walk along the beam you stand on (≤ 0.4 m/s, balance-limited),
//                                   optionally stepping off onto a deck at that level.
// Only small loads (≤ 10 kg, catalog handling.smallLoad) may be held on either; a sheet goes up by
// hand_up (handup.ts) instead. Mars assembly model v1, approximate.
import { z } from 'zod';
import { datan2, dist2, pointInObb, type Vec2, type Vec3 } from '../core/math.ts';
import type { ActionDef, Diagnostic, StepResult } from '../actions/types.ts';
import type { Runtime } from '../runtime/runtime.ts';
import type { Link, Surface } from '../spatial/types.ts';
import type { Entity } from '../world/types.ts';
import { def } from '../world/catalog.ts';
import { clearanceAt } from '../spatial/grid.ts';
import { HUMAN_PROFILE } from '../spatial/types.ts';
import { checkStations, childrenState, walkCrew, type Children } from './children.ts';
import { spatialOf } from './access.ts';
import { BEAM_SPEED, bigLoad, CLIMB_SPEED, frameLinks, offWalkway, onWalkway, walkwayAtExit } from './frame.ts';

const f2 = (x: number) => x.toFixed(2);
const bad = (code: string, message: string, subjects: string[], at?: Vec3) => ({ ok: false as const, diagnostic: { code, message, subjects, at } });
const xz = (e: Entity): Vec2 => [e.pose.p[0], e.pose.p[2]];
export const STEP_OFF_MAX = 1.0; // m from the walkway to a deck spot you may step onto
export const STEP_UP_MAX = 0.25; // m a deck may be above / below the beam top you step off
export const FRAME_NOT_RESUMABLE = 'frame traversal tracks (climb / beam-walk positions) and child walks are not serialised';
export const OCCUPIED_WAIT = 5.0; // s a climber waits for someone else on the same climb before `blocked`

/** A polyline traversal state (positions along `pts`, arc length `s`). */
export type Track = { pts: Vec3[]; s: number; len: number };
export const track = (pts: Vec3[]): Track => ({ pts, s: 0, len: pts.slice(1).reduce((a, q, i) => a + Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1], q[2] - pts[i][2]), 0) });

/** Point at arc length s along the polyline. */
export function trackAt(t: Track, s: number): Vec3 {
  let left = Math.max(0, Math.min(s, t.len));
  for (let i = 1; i < t.pts.length; i++) {
    const a = t.pts[i - 1], b = t.pts[i];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    if (left <= l || i === t.pts.length - 1) {
      const k = l > 1e-9 ? Math.min(1, left / l) : 1;
      return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
    }
    left -= l;
  }
  return [...t.pts[t.pts.length - 1]] as Vec3;
}

/** Advance a person along a track at `speed`; true when at its end. */
export function stepTrack(h: Entity, t: Track, speed: number, dt: number, face?: number): boolean {
  const before = trackAt(t, t.s);
  t.s = Math.min(t.len, t.s + speed * dt);
  const p = trackAt(t, t.s);
  h.pose.p = p;
  const d: Vec2 = [p[0] - before[0], p[2] - before[2]];
  if (face !== undefined) h.pose.yaw = face;
  else if (Math.hypot(d[0], d[1]) > 1e-6) h.pose.yaw = datan2(d[1], d[0]);
  return t.s >= t.len - 1e-9;
}

/** Someone else on walkway `l` between the points at arc lengths s0 and s1 (± 0.6 m): who. */
export function beamBlocker(rt: Runtime, l: Link, actor: string, s0: number, s1: number): Entity | null {
  const lo = Math.min(s0, s1) - 0.6, hi = Math.max(s0, s1) + 0.6;
  for (const o of Object.values(rt.world.entities).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (o.id === actor || o.human?.on !== l.id) continue;
    const s = onWalkway(l, xz(o)).s;
    if (s > lo && s < hi && (s - s0) * (s1 - s0) > 0) return o;
  }
  return null;
}

// ---------------------------------------------------------------- climb_frame

type CP = { actor: string; link: string; dir: 'up' | 'down' };
type CProg = { link: Link; walkway: Link; toExit: number };
type CExec = { p: CP; prog: CProg; id: string; phase: 'approach' | 'beam' | 'wait' | 'climb'; children?: Children; beam?: Track; climb?: Track; waited: number };

function climbable(rt: Runtime, id: string): Link | Diagnostic {
  const links = frameLinks(rt.world);
  const l = links.find((x) => x.id === id && x.kind === 'climb');
  if (l) return l;
  const m = /^climb:([^:]+):/.exec(id);
  const u = m ? rt.world.entities[m[1]] : undefined;
  const why = u ? `${u.id} is ${u.phase ?? 'unplaced'}${u.phase === 'installed' ? ', but has no beam on that column at that seat' : ' (only an installed, standing, supported upright is climbable)'}` : 'no such upright';
  return { code: 'climb.no-link', message: `no climbable frame "${id}": ${why}; climbable here: ${links.filter((x) => x.kind === 'climb').map((x) => x.id).join(', ') || 'none'}`, subjects: [id, ...(u ? [u.id] : [])] };
}

export function planClimb(rt: Runtime, p: CP): { ok: true; program: CProg } | { ok: false; diagnostic: Diagnostic } {
  const a = rt.world.entities[p.actor];
  if (!a?.human) return bad('actor.not-human', `"${p.actor}" is not a person in this world`, [p.actor]);
  const l = climbable(rt, p.link);
  if ('code' in l) return { ok: false, diagnostic: l };
  const big = bigLoad(rt.world, a.id);
  if (big)
    return bad('climb.no-carry', `${a.id} cannot climb ${l.members![0]}'s frame holding ${big.id} (${def(big.def).label}, ${def(big.def).massKg} kg): only small loads (≤ 10 kg) go up a frame; hand it up (hand_up)`, [a.id, big.id, l.members![0]], a.pose.p);
  const walkway = walkwayAtExit(rt.world, l);
  if (!walkway) return bad('climb.no-walkway', `${l.id} can be climbed, but there is no walkable beam pair to step onto at ${f2(l.to.y)} m (${l.members!.slice(1).join(', ')} needs its partner beam on the other column)`, [l.id, ...l.members!], [l.to.p[0], l.to.y, l.to.p[1]]);
  if (p.dir === 'up') {
    if (a.human.on) return bad('climb.already-up', `${a.id} is already on ${a.human.on}`, [a.id]);
    if (a.human.level !== l.from.level) return bad('climb.wrong-level', `${a.id} is on level ${a.human.level}; ${l.id} starts on level ${l.from.level}`, [a.id]);
    const r = checkStations(rt, [{ actor: a.id, p: l.from.p, level: l.from.level }]);
    if (r) return { ok: false, diagnostic: { ...r, code: 'climb.unreachable' } };
    return { ok: true, program: { link: l, walkway, toExit: 0 } };
  }
  if (a.human.on !== walkway.id)
    return bad('climb.not-at-frame', `${a.id} must be on ${walkway.id} to climb down ${l.id} (is ${a.human.on ? `on ${a.human.on}` : `on level ${a.human.level}`})`, [a.id, l.id]);
  const s0 = onWalkway(walkway, xz(a)).s, s1 = onWalkway(walkway, l.to.p).s;
  const who = beamBlocker(rt, walkway, a.id, s0, s1);
  if (who) return bad('beam.occupied', `${who.id} stands on ${walkway.id} between ${a.id} and the top of ${l.id}; people cannot pass on a beam`, [a.id, who.id], who.pose.p);
  return { ok: true, program: { link: l, walkway, toExit: dist2(xz(a), l.to.p) } };
}

function climbStep(rt: Runtime, ex: CExec, dt: number): StepResult {
  const a = rt.world.entities[ex.p.actor];
  const { link, walkway } = ex.prog;
  const up = ex.p.dir === 'up';
  if (ex.phase === 'approach') {
    if (!ex.children) {
      const r = walkCrew(rt, ex.id, [{ actor: a.id, p: link.from.p, yaw: link.heading, level: link.from.level }]);
      if ('code' in r) return { status: 'failed', diagnostic: { ...r, code: 'climb.unreachable' } };
      ex.children = r;
    }
    const s = childrenState(ex.children);
    if (s === 'running') return { status: 'running', phase: 'approach' };
    if (s !== 'done') return { status: 'failed', diagnostic: s };
    a.human!.task = ex.id;
    ex.phase = 'wait';
  }
  if (ex.phase === 'beam') {
    Object.assign(a.human!, { activity: 'beam-walk', task: ex.id });
    if (!stepTrack(a, ex.beam!, BEAM_SPEED, dt)) return { status: 'running', phase: 'beam-walk' };
    ex.phase = 'wait';
  }
  if (ex.phase === 'wait') {
    const other = Object.values(rt.world.entities).find((o) => o.id !== a.id && o.human?.on === link.id);
    if (other) {
      ex.waited += dt;
      a.human!.activity = 'wait';
      if (ex.waited > OCCUPIED_WAIT) return { status: 'blocked', diagnostic: { code: 'climb.occupied', message: `${other.id} is on ${link.id} (one person at a time); ${a.id} waits`, subjects: [a.id, other.id] } };
      return { status: 'running', phase: 'wait' };
    }
    ex.climb = track(up ? link.path : [...link.path].reverse());
    ex.phase = 'climb';
  }
  Object.assign(a.human!, { activity: up ? 'climb-up' : 'climb-down', on: link.id, task: ex.id });
  if (!stepTrack(a, ex.climb!, CLIMB_SPEED, dt, link.heading)) return { status: 'running', phase: 'climb' };
  if (up) Object.assign(a.human!, { on: walkway.id, level: walkway.from.level, activity: 'idle', task: undefined });
  else Object.assign(a.human!, { on: undefined, level: link.from.level, activity: 'idle', task: undefined });
  return { status: 'completed', outputs: { on: a.human!.on ?? null, level: a.human!.level, y: a.pose.p[1] } };
}

export const climbFrame: ActionDef<CP, CProg, CExec> = {
  verb: 'climb_frame',
  description: `Climb an installed upright's bracing like a ladder (${CLIMB_SPEED} m/s, one person at a time) onto a connected beam pair, or back down. Only small loads (≤ 10 kg) may be held.`,
  schema: z.strictObject({ actor: z.string().max(80), link: z.string().max(120), dir: z.enum(['up', 'down']) }),
  reservations: (_w, p) => [{ resource: `actor:${p.actor}`, mode: 'exclusive' }],
  resumable: FRAME_NOT_RESUMABLE,
  plan: planClimb,
  start(rt, p, prog, id) {
    const a = rt.world.entities[p.actor];
    const ex: CExec = { p, prog, id, phase: p.dir === 'up' ? 'approach' : 'beam', waited: 0 };
    if (p.dir === 'down') ex.beam = track([[...a.pose.p] as Vec3, [prog.link.to.p[0], prog.link.to.y, prog.link.to.p[1]]]);
    return ex;
  },
  step: climbStep,
  cancel(rt, ex) {
    if (ex.phase === 'climb') return { ok: false, diagnostic: { code: 'climb.cancel-unsafe', message: `${ex.p.actor} is on ${ex.prog.link.id}; finish the climb first`, subjects: [ex.p.actor] } };
    for (const r of ex.children?.recs ?? []) if (rt.isActive(r.id)) rt.cancel(r.id);
    return { ok: true };
  },
};

// ---------------------------------------------------------------- beam_walk

type BP = { actor: string; x: number; z: number; speed?: number };
type BProg = { walkway: Link; q: Vec2; deck: Surface | null; speed: number };
type BExec = { p: BP; prog: BProg; id: string; beam: Track; off?: Track };

/** A deck surface at the walkway's level (± STEP_UP_MAX) containing p with room to stand; null = none. */
export function deckAt(rt: Runtime, l: Link, p: Vec2): Surface | Diagnostic | null {
  const sp = spatialOf(rt);
  const s = sp.scene.surfaces.find((x) => x.level > 0 && Math.abs(x.y - l.from.y) <= STEP_UP_MAX && pointInObb(p, x.obb));
  if (!s) return null;
  const g = sp.level(s.level);
  const c = g ? clearanceAt(g, p) : 0;
  if (c < HUMAN_PROFILE.radius) return { code: 'beam.no-room', message: `no room to stand at (${f2(p[0])}, ${f2(p[1])}) on ${s.label ?? s.id} (clearance ${f2(c)} m < ${HUMAN_PROFILE.radius} m)`, subjects: [s.id] };
  return s;
}

export function planBeamWalk(rt: Runtime, p: BP): { ok: true; program: BProg } | { ok: false; diagnostic: Diagnostic } {
  const a = rt.world.entities[p.actor];
  if (!a?.human) return bad('actor.not-human', `"${p.actor}" is not a person in this world`, [p.actor]);
  const l = a.human.on ? frameLinks(rt.world).find((x) => x.id === a.human!.on) : undefined;
  if (!l || l.kind !== 'beam')
    return bad('beam.not-on-beam', `${a.id} is not standing on a beam (${a.human.on ? `on ${a.human.on}` : `on level ${a.human.level}`}); climb a frame first (climb_frame)`, [a.id], a.pose.p);
  const beam = l.members![0];
  const speed = p.speed ?? BEAM_SPEED;
  if (speed > BEAM_SPEED + 1e-9)
    return bad('beam.too-fast', `${a.id} cannot walk beam ${beam} at ${f2(speed)} m/s: balance-limited to ${BEAM_SPEED} m/s on a ${f2(l.width - 0.1)} m flange`, [a.id, beam], a.pose.p);
  const big = bigLoad(rt.world, a.id);
  if (big)
    return bad('beam.no-carry', `${a.id} cannot walk beam ${beam} carrying ${big.id} (${def(big.def).label}, ${def(big.def).massKg} kg): nothing but small loads (≤ 10 kg) is carried on a beam; hand it up (hand_up)`, [a.id, big.id, beam], a.pose.p);
  const target: Vec2 = [p.x, p.z];
  let deck: Surface | null = null;
  const off = offWalkway(l, target);
  if (off > l.width / 2 + 0.02) {
    const d = deckAt(rt, l, target);
    if (d && 'code' in d) return { ok: false, diagnostic: d };
    if (!d || off > STEP_OFF_MAX)
      return bad('beam.off-walkway', `(${f2(p.x)}, ${f2(p.z)}) is ${f2(off)} m off beam ${beam}'s walkway and not on a deck within a step of it (≤ ${STEP_OFF_MAX} m, ±${STEP_UP_MAX} m)`, [a.id, beam], [p.x, l.from.y, p.z]);
    deck = d;
  }
  const q = onWalkway(l, target).q;
  const s0 = onWalkway(l, xz(a)).s, s1 = onWalkway(l, q).s;
  const who = beamBlocker(rt, l, a.id, s0, s1);
  if (who) return bad('beam.occupied', `${who.id} stands on beam ${beam} in ${a.id}'s way; people cannot pass on a beam`, [a.id, who.id, beam], who.pose.p);
  return { ok: true, program: { walkway: l, q, deck, speed } };
}

export const beamWalk: ActionDef<BP, BProg, BExec> = {
  verb: 'beam_walk',
  description: `Walk along the beam you stand on (balance-limited ≤ ${BEAM_SPEED} m/s; nothing but small loads carried), optionally stepping off onto a deck at that level.`,
  schema: z.strictObject({ actor: z.string().max(80), x: z.number().min(-1e4).max(1e4), z: z.number().min(-1e4).max(1e4), speed: z.number().min(0.05).max(3).optional() }),
  reservations: (_w, p) => [{ resource: `actor:${p.actor}`, mode: 'exclusive' }],
  resumable: FRAME_NOT_RESUMABLE,
  plan: planBeamWalk,
  start(rt, p, prog, id) {
    const a = rt.world.entities[p.actor];
    const y = prog.walkway.from.y;
    const ex: BExec = { p, prog, id, beam: track([[...a.pose.p] as Vec3, [prog.q[0], y, prog.q[1]]]) };
    if (prog.deck) ex.off = track([[prog.q[0], y, prog.q[1]], [p.x, prog.deck.y, p.z]]);
    return ex;
  },
  step(rt, ex, dt) {
    const a = rt.world.entities[ex.p.actor];
    Object.assign(a.human!, { activity: 'beam-walk', task: ex.id });
    if (ex.beam.s < ex.beam.len - 1e-9) {
      const l = ex.prog.walkway;
      const s0 = onWalkway(l, xz(a)).s, s1 = onWalkway(l, ex.prog.q).s;
      const who = beamBlocker(rt, l, a.id, s0, s1);
      if (who && Math.abs(onWalkway(l, xz(who)).s - s0) < 0.65) return { status: 'blocked', diagnostic: { code: 'beam.occupied', message: `${who.id} is in ${a.id}'s way on ${l.id}`, subjects: [a.id, who.id] } };
      if (!stepTrack(a, ex.beam, ex.prog.speed, dt)) return { status: 'running', phase: 'beam-walk' };
    }
    if (!ex.off) return done(a);
    // step off the beam onto the deck: still `on` the beam (activity step-off) until the foot lands
    a.human!.activity = 'step-off';
    if (!stepTrack(a, ex.off, ex.prog.speed, dt)) return { status: 'running', phase: 'step-off' };
    Object.assign(a.human!, { on: undefined, level: ex.prog.deck!.level });
    return done(a);
  },
  cancel: () => ({ ok: true }),
};

function done(a: Entity): StepResult {
  Object.assign(a.human!, { activity: 'idle', task: undefined });
  return { status: 'completed', outputs: { on: a.human!.on ?? null, level: a.human!.level, x: a.pose.p[0], z: a.pose.p[2] } };
}

export const FRAME_ACTIONS: ActionDef[] = [climbFrame, beamWalk];
