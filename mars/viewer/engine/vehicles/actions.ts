// Riding verbs (spec §10 vehicle movement profiles, §17 riding): mount, ride_to, ride_loop,
// dismount. A vehicle is an entity (kind 'vehicle', catalog def 'euc' | 'bicycle'). Parked, it is
// a static obstacle at its box (catalog `obstacle`); mounted, its phase is 'carried' (it leaves the
// navigation grids), support { kind: 'ridden-by', by }, and the rider holds it (human.grip, so no
// walking verb can take the rider off it) with human.riding = vehicle id and activity 'ride'.
// Riding follows a curvature-limited reference curve (curve.ts) with pure pursuit.
import { z } from 'zod';
import { add2, angleDelta, clamp, dcos, dist2, dsin, heading, norm2, rot2, scale2, sub2, wrapAngle, type OBB2, type Vec2 } from '../core/math.ts';
import type { ActionDef, Diagnostic, StepResult } from '../actions/types.ts';
import type { Runtime } from '../runtime/runtime.ts';
import type { Entity, WorldState } from '../world/types.ts';
import type { AroundPerson, Spatial } from '../spatial/service.ts';
import { entityFootprint } from '../spatial/service.ts';
import { clearanceAt, cellOf, centreOf, nearestBlocker, segmentClearance, type LevelGrid } from '../spatial/grid.ts';
import { HUMAN_RADIUS } from '../world/catalog.ts';
import { FIXTURE } from '../world/factory.ts';
import { makeWay } from '../locomotion/walk.ts';
import { turnRadiusAt, vehicleProfile, type VehicleProfile } from './profiles.ts';
import { blockersNear, planCurve, vehicleGrids, type Curve } from './curve.ts';

/** Max distance (m) from a person to a parked vehicle's centre to mount it. */
export const MOUNT_REACH = 1.2;
/** Body gap (m) a rider keeps short of a person standing on its path. */
export const STOP_GAP = 1.0;
/** Body gap (m) within which a vehicle must not exceed PASS_SPEED (invariant vehicle.close-pass). */
export const PASS_GAP = 0.6;
export const PASS_SPEED = 1.0;
/** Speed cap used near people (below PASS_SPEED, so the invariant has margin). */
const NEAR_SPEED = 0.9;
/** A person whose body comes within this gap of the vehicle's swept path blocks it. */
const ON_PATH = 0.25;
const MOUNT_SPEED = 1.0; // m/s stepping on / off
const STUCK_REPLAN = 60; // ticks stopped for a person before replanning around standing people
const MAX_REPLANS = 3;
const HR = HUMAN_RADIUS;

const spatial = (rt: Runtime) => rt.services.spatial as Spatial;
const xz = (e: Entity): Vec2 => [e.pose.p[0], e.pose.p[2]];
const fmt = (p: Vec2) => `(${p[0].toFixed(2)}, ${p[1].toFixed(2)})`;
const bad = (code: string, message: string, subjects: string[], at?: Vec2): { ok: false; diagnostic: Diagnostic } => ({
  ok: false,
  diagnostic: { code, message, subjects, at: at ? [at[0], 0, at[1]] : undefined },
});

/** A parked vehicle entity (test fixtures, seeds). */
export function vehicle(id: string, defId: 'euc' | 'bicycle', x: number, z: number, yaw = 0, y = 0): Entity {
  return { id, def: defId, kind: 'vehicle', label: id, pose: { p: [x, y, z], yaw }, provenance: FIXTURE, support: { kind: 'ground' } };
}

/** Clearance at p ignoring cells blocked by `ignore` (a parked vehicle about to be mounted). */
function clearanceIgnoring(g: LevelGrid, p: Vec2, ignore: string, maxR = 1.5): number {
  const c = cellOf(g, p);
  if (c < 0) return 0;
  const k = Math.ceil(maxR / g.cell), ci = c % g.nx, cj = Math.floor(c / g.nx);
  let best = maxR;
  for (let j = cj - k; j <= cj + k; j++)
    for (let i = ci - k; i <= ci + k; i++) {
      if (i < 0 || j < 0 || i >= g.nx || j >= g.nz) { best = Math.min(best, Math.max(0, Math.hypot(i - ci, j - cj) * g.cell - g.cell / 2)); continue; }
      const n = j * g.nx + i;
      if (g.free[n] || g.blockers.get(n) === ignore) continue;
      const d = dist2(centreOf(g, n), centreOf(g, c)) - g.cell / 2;
      if (d < best) best = Math.max(0, d);
    }
  return best;
}

const distToObb = (p: Vec2, o: OBB2) => {
  const l = rot2(sub2(p, o.c), -o.yaw);
  return Math.hypot(Math.max(Math.abs(l[0]) - o.half[0], 0), Math.max(Math.abs(l[1]) - o.half[1], 0));
};

type Rider = { a: Entity; v: Entity; pr: VehicleProfile };
function riderOf(w: WorldState, actor: string): Rider | Diagnostic {
  const a = w.entities[actor];
  if (!a) return { code: 'entity.unknown', message: `no actor "${actor}"`, subjects: [actor] };
  if (!a.human) return { code: 'actor.not-human', message: `"${actor}" is a ${a.kind}, not a person`, subjects: [actor] };
  const vid = a.human.riding;
  if (!vid) return { code: 'vehicle.not-riding', message: `${actor} is not riding a vehicle (mount one first)`, subjects: [actor] };
  const v = w.entities[vid];
  const pr = v && vehicleProfile(v.def);
  if (!v || !pr) return { code: 'vehicle.unknown', message: `${actor} rides "${vid}", which is not a known vehicle`, subjects: [actor, vid] };
  return { a, v, pr };
}

function setPose(rd: Rider, p: Vec2, yaw: number, floor: number) {
  rd.v.pose.p = [p[0], floor, p[1]];
  rd.v.pose.yaw = yaw;
  rd.a.pose.p = [p[0], floor + rd.pr.riderY, p[1]];
  rd.a.pose.yaw = yaw;
}

// ─── mount ─────────────────────────────────────────────────────────────────────────────────────

type MountParams = { actor: string; vehicle: string };
type MountExec = { id: string; actor: string; vehicle: string; from: Vec2; fromY: number; back: boolean };

export const mount: ActionDef<MountParams, { from: Vec2 }, MountExec> = {
  verb: 'mount',
  description: `Step onto a parked vehicle (EUC or bicycle) within ${MOUNT_REACH} m; the person becomes its rider (activity 'ride') until dismount.`,
  schema: z.strictObject({ actor: z.string().max(80), vehicle: z.string().max(80) }),
  reservations: (_w, p) => [{ resource: `actor:${p.actor}`, mode: 'exclusive' }, { resource: `entity:${p.vehicle}`, mode: 'exclusive' }],
  plan(rt, p) {
    const a = rt.world.entities[p.actor], v = rt.world.entities[p.vehicle];
    if (!a?.human) return bad('actor.not-human', `"${p.actor}" is not a person in this world`, [p.actor]);
    if (a.human.task || a.human.grip || a.human.riding) return bad('actor.busy', `${p.actor} is busy (${a.human.riding ? `riding ${a.human.riding}` : a.human.grip ? `holding ${a.human.grip.entity}` : `task ${a.human.task}`})`, [p.actor]);
    const pr = v && vehicleProfile(v.def);
    if (!v || v.kind !== 'vehicle' || !pr) return bad('vehicle.unknown', `"${p.vehicle}" is not a rideable vehicle`, [p.actor, p.vehicle]);
    if (v.support?.kind === 'ridden-by') return bad('vehicle.taken', `${p.vehicle} is already ridden by ${v.support.by}`, [p.vehicle, v.support.by]);
    const sp = spatial(rt);
    sp.sync(rt.world);
    const g = sp.level(a.human.level);
    if (!g || Math.abs(v.pose.p[1] - g.y) > 0.1) return bad('vehicle.other-level', `${p.vehicle} is not on ${p.actor}'s level ${a.human.level}`, [p.actor, p.vehicle]);
    const d = dist2(xz(a), xz(v));
    if (d > MOUNT_REACH) return bad('vehicle.out-of-reach', `${p.actor} is ${d.toFixed(2)} m from ${p.vehicle} (reach ${MOUNT_REACH} m): walk to it first`, [p.actor, p.vehicle], xz(v));
    const c = clearanceIgnoring(g, xz(v), v.id);
    if (c < pr.radius) {
      const near = blockersNear(g, xz(v), c + 0.3).filter((id) => id !== v.id);
      return bad('vehicle.too-narrow', `${p.vehicle} is parked with ${c.toFixed(2)} m clearance, less than its ${pr.id} riding radius ${pr.radius} m${near.length ? ` (next to ${near.slice(0, 2).join(' and ')})` : ''}`, [p.vehicle, ...near.slice(0, 2)], xz(v));
    }
    for (let t = 0; t <= 1; t += 0.1) {
      const q = add2(xz(a), scale2(sub2(xz(v), xz(a)), t));
      if (clearanceIgnoring(g, q, v.id) < HR - 0.03) return bad('vehicle.out-of-reach', `${p.actor} cannot step onto ${p.vehicle}: ${nearestBlocker(g, q) ?? 'geometry'} is in the way at ${fmt(q)}`, [p.actor, p.vehicle], q);
    }
    return { ok: true, program: { from: xz(a) } };
  },
  start(rt, p, prog, id) {
    const a = rt.world.entities[p.actor], v = rt.world.entities[p.vehicle];
    a.human!.task = id;
    a.human!.activity = 'mount';
    a.human!.grip = { entity: v.id, slot: 'rider' };
    a.human!.riding = v.id;
    v.phase = 'carried';
    v.support = { kind: 'ridden-by', by: a.id };
    return { id, actor: p.actor, vehicle: p.vehicle, from: prog.from, fromY: a.pose.p[1], back: false };
  },
  step(rt, ex, dt) {
    const a = rt.world.entities[ex.actor], v = rt.world.entities[ex.vehicle];
    const pr = vehicleProfile(v.def)!;
    const target: Vec2 = ex.back ? ex.from : xz(v);
    const ty = ex.back ? ex.fromY : v.pose.p[1] + pr.riderY;
    const cur = xz(a);
    const d = dist2(cur, target);
    const stepLen = MOUNT_SPEED * dt;
    const p = d <= stepLen ? target : add2(cur, scale2(sub2(target, cur), stepLen / d));
    const wantYaw = ex.back ? a.pose.yaw : v.pose.yaw;
    const yaw = wrapAngle(a.pose.yaw + clamp(angleDelta(a.pose.yaw, wantYaw), -4 * dt, 4 * dt));
    const y = a.pose.p[1] + clamp(ty - a.pose.p[1], -0.5 * dt, 0.5 * dt);
    a.pose.p = [p[0], y, p[1]];
    a.pose.yaw = yaw;
    if (d > stepLen || Math.abs(y - ty) > 1e-9 || Math.abs(angleDelta(yaw, wantYaw)) > 1e-6) return { status: 'running', phase: ex.back ? 'step-off' : 'step-on' };
    a.human!.task = undefined;
    if (ex.back) {
      a.human!.grip = undefined;
      a.human!.riding = undefined;
      a.human!.activity = 'idle';
      v.phase = undefined;
      v.support = { kind: 'ground' };
      return { status: 'completed', outputs: { mounted: false } };
    }
    a.human!.activity = 'ride';
    return { status: 'completed', outputs: { mounted: true, vehicle: v.id } };
  },
  cancel(_rt, ex) {
    ex.back = true; // step back off to where the person stood, then the vehicle is parked again
    return { ok: true, deferred: true };
  },
};

// ─── dismount ──────────────────────────────────────────────────────────────────────────────────

type DismountParams = { actor: string; side?: 'left' | 'right' };
type DismountExec = { id: string; actor: string; vehicle: string; spot: Vec2 };

export const dismount: ActionDef<DismountParams, { spot: Vec2 }, DismountExec> = {
  verb: 'dismount',
  description: 'Stop riding: the rider steps off beside the (stopped) vehicle to a clear spot; the vehicle stays parked where it is as a static obstacle.',
  schema: z.strictObject({ actor: z.string().max(80), side: z.enum(['left', 'right']).optional() }),
  reservations: (w, p) => {
    const vid = w.entities[p.actor]?.human?.riding;
    return [{ resource: `actor:${p.actor}`, mode: 'exclusive' }, ...(vid ? [{ resource: `entity:${vid}`, mode: 'exclusive' as const }] : [])];
  },
  plan(rt, p) {
    const rd = riderOf(rt.world, p.actor);
    if ('code' in rd) return { ok: false, diagnostic: rd };
    if (rd.a.human!.activity !== 'ride' || rd.a.human!.task) return bad('actor.busy', `${p.actor} is ${rd.a.human!.activity} (${rd.a.human!.task ?? 'no task'}); dismount once the vehicle has stopped`, [p.actor]);
    const sp = spatial(rt);
    sp.sync(rt.world);
    const g = sp.level(rd.a.human!.level)!;
    const f = entityFootprint(rd.v);
    const c = xz(rd.v);
    const side = f.obb.half[1] + HR + 0.2, back = f.obb.half[0] + HR + 0.2;
    const locals: Record<string, Vec2> = { left: [0, side], right: [0, -side], behind: [-back, 0], front: [back, 0] };
    const order = p.side === 'right' ? ['right', 'left', 'behind', 'front'] : ['left', 'right', 'behind', 'front'];
    const tried: string[] = [];
    for (const k of order) {
      const q = add2(c, rot2(locals[k], rd.v.pose.yaw));
      const cl = clearanceAt(g, q);
      const occ = Object.values(rt.world.entities).find((o) => o.id !== rd.a.id && o.human && o.human.level === rd.a.human!.level && dist2(xz(o), q) < 2 * HR + 0.1);
      if (cl < HR + 0.1) tried.push(`${k} ${fmt(q)} (${nearestBlocker(g, q) ?? 'no floor'})`);
      else if (occ) tried.push(`${k} ${fmt(q)} (${occ.id} stands there)`);
      else if (segmentClearance(g, c, q) < HR) tried.push(`${k} ${fmt(q)} (no clear step off)`);
      else if (distToObb(q, f.obb) < HR + 0.14) tried.push(`${k} ${fmt(q)} (too close to ${rd.v.id})`);
      else return { ok: true, program: { spot: q } };
    }
    return bad('vehicle.no-dismount-spot', `${p.actor} cannot step off ${rd.v.id} at ${fmt(c)}: no clear spot beside it — ${tried.join('; ')}`, [p.actor, rd.v.id], c);
  },
  start(rt, p, prog, id) {
    const a = rt.world.entities[p.actor];
    a.human!.task = id;
    a.human!.activity = 'dismount';
    return { id, actor: p.actor, vehicle: a.human!.riding!, spot: prog.spot };
  },
  step(rt, ex, dt) {
    const a = rt.world.entities[ex.actor], v = rt.world.entities[ex.vehicle];
    const cur = xz(a);
    const d = dist2(cur, ex.spot);
    const stepLen = MOUNT_SPEED * dt;
    const p = d <= stepLen ? ex.spot : add2(cur, scale2(sub2(ex.spot, cur), stepLen / d));
    const floor = v.pose.p[1];
    const y = a.pose.p[1] + clamp(floor - a.pose.p[1], -0.5 * dt, 0.5 * dt);
    a.pose.p = [p[0], y, p[1]];
    if (d > stepLen || Math.abs(y - floor) > 1e-9) return { status: 'running', phase: 'step-off' };
    a.human!.task = undefined;
    a.human!.grip = undefined;
    a.human!.riding = undefined;
    a.human!.activity = 'idle';
    v.phase = undefined; // parked: a static obstacle at its box again (catalog `obstacle`)
    v.support = { kind: 'ground' };
    return { status: 'completed', outputs: { x: p[0], z: p[1], vehicle: v.id } };
  },
  cancel: () => ({ ok: true, deferred: true }), // half off the vehicle: finish stepping off
};

// ─── ride_to / ride_loop ───────────────────────────────────────────────────────────────────────

type RideParams = { actor: string; x: number; z: number; level?: number; speed?: number };
type LoopParams = { actor: string; points: { x: number; z: number }[]; laps?: number; close?: boolean; speed?: number };
type RideProgram = { curve: Curve; targets: Vec2[]; cruise: number };
type RideExec = {
  id: string;
  actor: string;
  vehicle: string;
  level: number;
  curve: Curve;
  targets: Vec2[];
  cruise: number;
  idx: number;
  v: number;
  phase: 'pivot' | 'ride';
  epoch: number;
  replan: boolean;
  replans: number;
  stuck: number;
  cancelling: boolean;
  maxLat: number;
  maxSpeed: number;
  distance: number;
  ticks: number;
};

const riderReservations = (w: WorldState, actor: string) => {
  const vid = w.entities[actor]?.human?.riding;
  return [{ resource: `actor:${actor}`, mode: 'exclusive' as const }, ...(vid ? [{ resource: `entity:${vid}`, mode: 'exclusive' as const }] : [])];
};

function planRide(rt: Runtime, actor: string, targets: Vec2[], level: number | undefined, speed: number | undefined): { ok: true; program: RideProgram } | { ok: false; diagnostic: Diagnostic } {
  const rd = riderOf(rt.world, actor);
  if ('code' in rd) return { ok: false, diagnostic: rd };
  const { a, v, pr } = rd;
  if (a.human!.activity !== 'ride' || a.human!.task) return bad('actor.busy', `${actor} is ${a.human!.activity} (${a.human!.task ?? 'no task'}) and cannot start a ride`, [actor]);
  const lv = a.human!.level;
  if (level !== undefined && level !== lv) {
    const sp = spatial(rt);
    sp.sync(rt.world);
    const links = sp.scene.links.filter((l) => (l.from.level === lv && l.to.level === level) || (l.to.level === lv && l.from.level === level)).map((l) => l.id);
    const name = sp.scene.levels.find((l) => l.id === level)?.label ?? `level ${level}`;
    return bad('route.vehicle-no-link', `${actor} cannot ride ${v.id} to level ${level} (${name}): a ${pr.id} stays on its level ${lv} and never uses stairs, ladders or ramps${links.length ? ` (${links.join(', ')})` : ''}; dismount and walk`, [actor, v.id, ...links]);
  }
  if (speed !== undefined && speed > pr.maxSpeed) return bad('vehicle.speed-limit', `${speed} m/s exceeds the ${pr.id} limit of ${pr.maxSpeed} m/s`, [actor, v.id]);
  const cruise = Math.min(speed ?? pr.speed, pr.maxSpeed);
  const r = planCurve(spatial(rt), rt.world, pr, `${actor} on ${v.id}`, lv, xz(v), targets, cruise);
  if (!r.ok) return r;
  return { ok: true, program: { curve: r.curve, targets, cruise } };
}

function startRide(rt: Runtime, actor: string, prog: RideProgram, id: string): RideExec {
  const a = rt.world.entities[actor];
  a.human!.task = id;
  return {
    id, actor, vehicle: a.human!.riding!, level: a.human!.level, curve: prog.curve, targets: prog.targets, cruise: prog.cruise, idx: 0, v: 0, phase: 'pivot',
    epoch: spatial(rt).epoch, replan: false, replans: 0, stuck: 0, cancelling: false, maxLat: 0, maxSpeed: 0, distance: 0, ticks: 0,
  };
}

/** Point on the curve at arc length s (extrapolated along the last tangent past the end). */
function curvePoint(c: Curve, s: number, from: number): Vec2 {
  const S = c.samples;
  if (s >= c.length) {
    const n = S.length;
    if (n < 2) return S[n - 1].p;
    const t = norm2(sub2(S[n - 1].p, S[n - 2].p));
    return add2(S[n - 1].p, scale2(t, s - c.length));
  }
  let i = from;
  while (i < S.length - 1 && S[i + 1].s < s) i++;
  const a = S[i], b = S[Math.min(i + 1, S.length - 1)];
  const len = b.s - a.s;
  return len > 1e-9 ? add2(a.p, scale2(sub2(b.p, a.p), (s - a.s) / len)) : a.p;
}

type PeopleView = { stopS?: number; blocker?: string; slowS?: number; near: boolean };

/** People relative to the remaining path: who blocks it (stop STOP_GAP short) and where to slow for a pass. */
function peopleAhead(rt: Runtime, ex: RideExec, rd: Rider, cur: Vec2): PeopleView {
  const out: PeopleView = { near: false };
  const S = ex.curve.samples;
  const r = rd.pr.radius;
  const sN = S[ex.idx].s;
  const horizon = sN + (ex.v * ex.v) / (2 * rd.pr.brake) + STOP_GAP + r + HR + 3;
  for (const o of Object.values(rt.world.entities)) {
    if (o.id === rd.a.id || !o.human || o.human.level !== rd.a.human!.level || Math.abs(o.pose.p[1] - rd.a.pose.p[1]) > 1.0) continue;
    const op = xz(o);
    if (dist2(cur, op) - r - HR < PASS_GAP + 0.1) out.near = true;
    let kStop = -1, slow = -1, onPath = false;
    for (let j = ex.idx; j < S.length && S[j].s <= horizon; j++) {
      const d = dist2(S[j].p, op);
      if (kStop < 0 && d < r + HR + STOP_GAP + 0.1) kStop = j; // (+0.1: sample spacing and the last braking tick)
      if (slow < 0 && d < r + HR + PASS_GAP + 0.15) slow = j;
      if (d < r + HR + ON_PATH) { onPath = true; break; }
    }
    if (slow >= 0 && (out.slowS === undefined || S[slow].s < out.slowS)) out.slowS = S[slow].s;
    if (onPath) {
      const stopS = kStop >= 0 ? S[kStop].s : sN;
      if (out.stopS === undefined || stopS < out.stopS) { out.stopS = stopS; out.blocker = o.id; }
    }
  }
  return out;
}

/** Ask an idle person standing on the path to step off it sideways (walk.ts makeWay). */
function askToStepAside(rt: Runtime, ex: RideExec, who: string) {
  const S = ex.curve.samples;
  const op = xz(rt.world.entities[who]);
  let j = ex.idx, best = Infinity;
  for (let k = ex.idx; k < S.length; k++) {
    const d = dist2(S[k].p, op);
    if (d < best) { best = d; j = k; }
  }
  const a = S[Math.max(0, j - 1)].p, b = S[Math.min(S.length - 1, j + 1)].p;
  const t = norm2(sub2(b, a));
  const lat = (op[0] - S[j].p[0]) * -t[1] + (op[1] - S[j].p[1]) * t[0];
  const side = lat >= -0.05 ? 1 : -1; // exactly on the path: they step to its left
  const n: Vec2 = [-t[1] * side, t[0] * side];
  makeWay(rt, who, sub2(S[j].p, scale2(n, 0.4)));
}

/** People to plan around after being stuck: everyone else on the level who is not walking somewhere. */
function standing(rt: Runtime, rd: Rider): AroundPerson[] {
  return Object.values(rt.world.entities)
    .filter((o) => o.id !== rd.a.id && o.human && o.human.level === rd.a.human!.level && (!o.human.task || rt.records.get(o.human.task)?.status === 'blocked'))
    .map((o) => ({ id: o.id, p: xz(o) }));
}

function replan(rt: Runtime, ex: RideExec, rd: Rider, around?: AroundPerson[]): Diagnostic | null {
  const S = ex.curve.samples;
  const sN = S[ex.idx].s;
  // targets not yet reached: those whose closest curve point lies ahead of the rider
  let from = 0;
  const remaining: Vec2[] = [];
  for (const t of ex.targets) {
    let bj = from, bd = Infinity;
    for (let k = from; k < S.length; k++) {
      const d = dist2(S[k].p, t);
      if (d < bd - 1e-9) { bd = d; bj = k; }
    }
    from = bj;
    if (S[bj].s > sN + 0.3) remaining.push(t);
  }
  if (!remaining.length) remaining.push(ex.targets[ex.targets.length - 1]);
  const r = planCurve(spatial(rt), rt.world, rd.pr, `${rd.a.id} on ${rd.v.id}`, ex.level, xz(rd.v), remaining, ex.cruise, around);
  if (!r.ok) return r.diagnostic;
  ex.curve = r.curve;
  ex.targets = remaining;
  ex.idx = 0;
  ex.replans++;
  ex.phase = 'pivot';
  return null;
}

function stepRide(rt: Runtime, ex: RideExec, dt: number): StepResult {
  const rd = riderOf(rt.world, ex.actor);
  if ('code' in rd || rd.v.id !== ex.vehicle) return { status: 'failed', diagnostic: { code: 'vehicle.rider-lost', message: `${ex.actor} is no longer riding ${ex.vehicle}`, subjects: [ex.actor, ex.vehicle] } };
  const { a, v, pr } = rd;
  ex.ticks++;
  const sp = spatial(rt);
  const { grids } = vehicleGrids(sp, rt.world, pr, ex.level);
  const g = grids.levels.get(ex.level)!;
  const r = pr.radius;
  // construction changed the grids: is the rest of the curve still clear?
  if (sp.epoch !== ex.epoch) {
    ex.epoch = sp.epoch;
    for (let k = ex.idx; k < ex.curve.samples.length && !ex.replan; k++) if (clearanceAt(g, ex.curve.samples[k].p) < r + 0.02) ex.replan = true;
  }
  if (ex.replan && ex.v < 0.02) {
    ex.replan = false;
    const d = replan(rt, ex, rd);
    if (d) return { status: 'failed', diagnostic: { ...d, code: 'route.invalidated', message: `ride invalidated: ${d.message}` } };
  }
  const S = ex.curve.samples;
  const cur = xz(v);
  // progress: nearest sample ahead (monotone)
  let bi = ex.idx, bd = dist2(S[ex.idx].p, cur);
  for (let k = ex.idx + 1; k < Math.min(S.length, ex.idx + 40); k++) {
    const d = dist2(S[k].p, cur);
    if (d < bd) { bd = d; bi = k; }
  }
  ex.idx = bi;
  const sN = S[bi].s;
  const end = S[S.length - 1].p;
  const rem = ex.curve.length - sN < 1.0 ? dist2(cur, end) : ex.curve.length - sN;
  if ((ex.curve.length - sN < 0.06 || rem < 0.06) && !ex.cancelling) {
    ex.v = 0;
    a.human!.task = undefined;
    return { status: 'completed', outputs: { length: Math.round(ex.curve.length * 1000) / 1000, distance: Math.round(ex.distance * 1000) / 1000, time: ex.ticks * dt, maxSpeed: ex.maxSpeed, maxLatAccel: ex.maxLat, minRadius: ex.curve.minRadius, replans: ex.replans, miss: Math.round(dist2(cur, end) * 1000) / 1000 } };
  }
  const Ld = clamp(0.25 + 0.25 * ex.v, 0.35, 1.25);
  const la = curvePoint(ex.curve, sN + Ld, bi);
  const want = heading(sub2(la, cur));
  const err = angleDelta(v.pose.yaw, want);
  // standstill pivot (EUC twist / walking the bike round) when badly misaligned
  if (ex.v < 0.05 && Math.abs(err) > 0.6) ex.phase = 'pivot';
  if (ex.phase === 'pivot') {
    if (Math.abs(err) > 0.1 && !ex.cancelling) {
      setPose(rd, cur, wrapAngle(v.pose.yaw + clamp(err, -pr.turnRate * dt, pr.turnRate * dt)), g.y);
      return { status: 'running', phase: 'pivot' };
    }
    ex.phase = 'ride';
  }
  // speed target: profile over the lookahead window (the final sample's 0 is handled by `rem`)
  let vt = ex.cruise;
  for (let k = bi; k < S.length - 1 && S[k].s <= sN + Ld; k++) vt = Math.min(vt, ex.curve.vmax[k]);
  vt = Math.min(vt, Math.sqrt(2 * pr.accel * rem));
  const ppl = peopleAhead(rt, ex, rd, cur);
  if (ppl.stopS !== undefined) vt = Math.min(vt, Math.sqrt(2 * pr.brake * Math.max(0, ppl.stopS - sN - 0.05)));
  if (ppl.slowS !== undefined) vt = Math.min(vt, Math.sqrt(NEAR_SPEED * NEAR_SPEED + 2 * pr.brake * Math.max(0, ppl.slowS - sN)));
  if (ppl.near) vt = Math.min(vt, NEAR_SPEED);
  if (ex.cancelling || ex.replan) vt = 0;
  const dec = ppl.stopS !== undefined || ex.cancelling ? 2 * pr.brake : pr.brake;
  ex.v = clamp(ex.v + clamp(vt - ex.v, -dec * dt, pr.accel * dt), 0, pr.maxSpeed);
  if (ex.cancelling && ex.v < 1e-6) {
    a.human!.task = undefined;
    return { status: 'completed', outputs: { cancelled: true, x: cur[0], z: cur[1] } };
  }
  // pure pursuit, curvature clamped to the speed-dependent turn radius
  const L = dist2(la, cur);
  let kappa = L > 1e-6 ? (2 * dsin(err)) / L : 0;
  const move = (speed: number): { p: Vec2; yaw: number; k: number } => {
    const kmax = 1 / turnRadiusAt(pr, speed);
    const k = clamp(kappa, -kmax, kmax);
    const ds = speed * dt;
    const mid = v.pose.yaw + (k * ds) / 2;
    return { p: [cur[0] + ds * dcos(mid), cur[1] + ds * dsin(mid)], yaw: wrapAngle(v.pose.yaw + k * ds), k };
  };
  let nx = move(ex.v);
  // close-pass guard on the predicted pose
  if (ex.v > NEAR_SPEED) {
    for (const o of Object.values(rt.world.entities)) {
      if (o.id === a.id || !o.human || o.human.level !== a.human!.level || Math.abs(o.pose.p[1] - a.pose.p[1]) > 1.0) continue;
      if (dist2(nx.p, xz(o)) - r - HR < PASS_GAP + 0.05) { ex.v = NEAR_SPEED; nx = move(ex.v); break; }
    }
  }
  // hard guards: never into a person's space, never below body clearance
  let blocker = ppl.blocker;
  for (const o of Object.values(rt.world.entities)) {
    if (o.id === a.id || !o.human || o.human.level !== a.human!.level || Math.abs(o.pose.p[1] - a.pose.p[1]) > 1.0) continue;
    const dTo = dist2(nx.p, xz(o));
    if (dTo < r + HR + 0.02 && dTo < dist2(cur, xz(o)) - 1e-9) { blocker = o.id; ex.v = 0; nx = { p: cur, yaw: v.pose.yaw, k: 0 }; break; }
  }
  if (ex.v > 0 && segmentClearance(g, cur, nx.p) < r) {
    const b = nearestBlocker(g, nx.p) ?? 'geometry';
    ex.v = 0;
    ex.replan = true;
    return { status: 'blocked', diagnostic: { code: 'vehicle.corridor', message: `${a.id} on ${v.id} stopped at ${fmt(cur)}: the next step would bring it within ${r} m of ${b}; replanning`, subjects: [a.id, v.id, b], at: [cur[0], g.y, cur[1]] } };
  }
  ex.distance += dist2(cur, nx.p);
  setPose(rd, nx.p, nx.yaw, g.y);
  ex.maxSpeed = Math.max(ex.maxSpeed, ex.v);
  ex.maxLat = Math.max(ex.maxLat, ex.v * ex.v * Math.abs(nx.k));
  if (blocker && ex.v < 0.02) {
    ex.stuck++;
    askToStepAside(rt, ex, blocker);
    if (ex.stuck > STUCK_REPLAN && ex.replans < MAX_REPLANS) {
      ex.stuck = 0;
      if (!replan(rt, ex, rd, standing(rt, rd))) return { status: 'running', phase: 'replan' };
    }
    return { status: 'blocked', diagnostic: { code: 'traffic.person', message: `${a.id} on ${v.id} waits for ${blocker} to move off its path`, subjects: [a.id, blocker] } };
  }
  ex.stuck = 0;
  return { status: 'running', phase: 'ride' };
}

const rideCancel = (_rt: Runtime, ex: RideExec) => {
  ex.cancelling = true; // brake to a stop, then the rider sits on the stopped vehicle
  return { ok: true as const, deferred: true };
};

export const rideTo: ActionDef<RideParams, RideProgram, RideExec> = {
  verb: 'ride_to',
  description: 'Ride a mounted vehicle to (x, z) on its level along a curvature-limited route (no stairs or decks); slows and stops for people on the path.',
  schema: z.strictObject({
    actor: z.string().max(80),
    x: z.number().min(-500).max(500),
    z: z.number().min(-500).max(500),
    level: z.number().int().min(0).max(20).optional(),
    speed: z.number().min(0.3).max(8).optional(),
  }),
  reservations: (w, p) => riderReservations(w, p.actor),
  plan: (rt, p) => planRide(rt, p.actor, [[p.x, p.z]], p.level, p.speed),
  start: (rt, p, prog, id) => startRide(rt, p.actor, prog, id),
  step: stepRide,
  cancel: rideCancel,
};

export const rideLoop: ActionDef<LoopParams, RideProgram, RideExec> = {
  verb: 'ride_loop',
  description: 'Ride a mounted vehicle through points in order (laps times, closing back to the first point unless close:false) as one continuous curve; stops at the end.',
  schema: z.strictObject({
    actor: z.string().max(80),
    points: z.array(z.strictObject({ x: z.number().min(-500).max(500), z: z.number().min(-500).max(500) })).min(1).max(64),
    laps: z.number().int().min(1).max(20).optional(),
    close: z.boolean().optional(),
    speed: z.number().min(0.3).max(8).optional(),
  }),
  reservations: (w, p) => riderReservations(w, p.actor),
  plan(rt, p) {
    const pts = p.points.map((q) => [q.x, q.z] as Vec2);
    const targets: Vec2[] = [];
    for (let k = 0; k < (p.laps ?? 1); k++) targets.push(...pts);
    if (p.close !== false && pts.length > 1) targets.push(pts[0]);
    return planRide(rt, p.actor, targets, undefined, p.speed);
  },
  start: (rt, p, prog, id) => startRide(rt, p.actor, prog, id),
  step: stepRide,
  cancel: rideCancel,
};

export const VEHICLE_ACTIONS: ActionDef[] = [mount, rideTo, rideLoop, dismount];
