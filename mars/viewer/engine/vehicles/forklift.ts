// Rule-based forklift (spec §7 "a forklift may be used to lift plywood or other loads to upper
// levels", §12 "forklift actions require a vehicle route, turning clearance, fork/load engagement,
// lift range, and valid receiving arrangement"). See docs/engineering/VEHICLES.md § Forklift.
// The forklift is a vehicle (kind 'vehicle', def 'forklift') that an operator `mount`s; driving
// reuses the ride_to follower (rideTo.start / rideTo.step on a curve planned here with the loaded
// footprint). The final square-up, fork creep, lift, reach and back-off are scripted here.
//   forklift_pick    {operator, item}           forks under a ground load, raise 0.3 m for travel
//   forklift_deliver {operator, to:{x,z,yaw,level}}  raise to a deck edge and set the load down
// The load rides the forks: phase 'carried', support { kind: 'forks', vehicle }.
import { z } from 'zod';
import { add2, angleDelta, clamp, dist2, heading, obbCorners, obbOverlap, pointInObb, rot2, sub2, wrapAngle, type OBB2, type Vec2 } from '../core/math.ts';
import type { ActionDef, Diagnostic, StepResult } from '../actions/types.ts';
import type { Invariant, Runtime } from '../runtime/runtime.ts';
import type { Entity, WorldState } from '../world/types.ts';
import type { Spatial } from '../spatial/service.ts';
import type { Obstacle, Surface } from '../spatial/types.ts';
import { clearanceAt } from '../spatial/grid.ts';
import { def, HUMAN_RADIUS } from '../world/catalog.ts';
import { FIXTURE } from '../world/factory.ts';
import { makeWay } from '../locomotion/walk.ts';
import { VEHICLE_PROFILES, type VehicleProfile } from './profiles.ts';
import { blockersNear, planCurve, vehicleGrids, type Curve } from './curve.ts';
import { rideTo } from './actions.ts';

/** Geometry and limits (catalog def 'forklift' carries the box; these are the working limits). */
export const FORKLIFT = {
  length: 2.6, // m, truck body incl. counterweight (local x; forks at +x)
  width: 1.2,
  mast: 2.2, // lowered mast height
  liftMax: 3.2, // fork height range 0–3.2 m above the truck's floor
  forkLength: 1.1,
  capacityKg: 1000,
  travelHeight: 0.3, // forks raised this far for travel
  liftRate: 0.3, // m/s raise / lower
  carriage: 1.0, // m of mast / load backrest above the fork height while raised
  gap: 0.05, // load near edge ↔ carriage face
  overhang: 0.3, // a load may reach this far past the fork tips
  creepSpeed: 0.5, // m/s straight creep / back-off
  reachSpeed: 0.2, // m/s push-pull (reach) of the load along the forks
  sideShiftMax: 0.15, // m lateral fork side-shift
  edgeGap: 0.05, // truck front stops this short of a receiving deck edge
  deckClear: 0.05, // load carried this far above the deck top before set-down
  prePose: 0.3, // load stops this short of the deck edge (or item) before lifting / creeping
  leadIn: 4.0, // m of straight approach planned before the pre-pose
  backOff: 1.0,
  peopleGap: 1.5, // m body gap to the moving truck + load: stop and ask them to step away
} as const;

export const FORKLIFT_PROFILE: VehicleProfile = {
  id: 'forklift',
  radius: 1.4,
  height: 2.2,
  speed: 1.5,
  maxSpeed: 2.0,
  turnRate: 0.5, // rad/s standstill pivot (steer-axle lock)
  stepHeight: 0.05,
  accel: 0.6,
  brake: 1.5,
  minTurnRadius: 2.5,
  slowSpeed: 1.0,
  turnRadius: 2.5,
  fastSpeed: 2.0,
  latAccel: 1.5,
  trackMargin: 0.15,
  riderY: 0.3, // operator's floor plate
  links: false,
};
// registered next to the EUC / bicycle so mount, dismount and the vehicle invariants know it
VEHICLE_PROFILES.forklift = FORKLIFT_PROFILE;

const HALF_L = FORKLIFT.length / 2;
const spatial = (rt: Runtime) => rt.services.spatial as Spatial;
const xz = (e: Entity): Vec2 => [e.pose.p[0], e.pose.p[2]];
const f2 = (x: number) => x.toFixed(2);
const fmt = (p: Vec2) => `(${f2(p[0])}, ${f2(p[1])})`;
const fwd = (yaw: number): Vec2 => rot2([1, 0], yaw);
type Fail = { ok: false; diagnostic: Diagnostic };
const bad = (code: string, message: string, subjects: string[], at?: Vec2, y = 0): Fail => ({ ok: false, diagnostic: { code, message, subjects, at: at ? [at[0], y, at[1]] : undefined } });

/** A parked forklift entity (test fixtures, seeds). */
export function forklift(id: string, x: number, z: number, yaw = 0, y = 0): Entity {
  return { id, def: 'forklift', kind: 'vehicle', label: id, pose: { p: [x, y, z], yaw }, provenance: FIXTURE, support: { kind: 'ground' } };
}

/**
 * How a load sits on the forks: `across` = forks slide in along the load's local z (approach its
 * long side; the load's x axis lies across the truck), else along its local x (short side).
 * depth = extent along the forks, width = across them.
 */
export type Engage = { across: boolean; depth: number; width: number; height: number };
export function engagement(defId: string): Engage | null {
  const [sx, sy, sz] = def(defId).size;
  const reach = FORKLIFT.forkLength + FORKLIFT.overhang;
  if (sz <= sx && sz <= reach) return { across: true, depth: sz, width: sx, height: sy };
  if (sx <= reach) return { across: false, depth: sx, width: sz, height: sy };
  if (sz <= reach) return { across: true, depth: sz, width: sx, height: sy };
  return null;
}
/** Load yaw for a truck yaw. */
const loadYaw = (g: Engage, truckYaw: number) => wrapAngle(truckYaw + (g.across ? Math.PI / 2 : 0));
/** Load centre in the truck's local frame (x forward), for reach `ext` and side-shift `s`. */
const loadLocal = (g: Engage, ext: number, s: number): Vec2 => [HALF_L + FORKLIFT.gap + g.depth / 2 + ext, s];
/** Load centre in world (x, z). */
export const loadCentre = (p: Vec2, yaw: number, g: Engage, ext: number, s: number): Vec2 => add2(p, rot2(loadLocal(g, ext, s), yaw));
/** Load ground footprint (its own local x/z half extents at its yaw). */
function loadObb(p: Vec2, yaw: number, g: Engage, ext: number, s: number): OBB2 {
  const ly = loadYaw(g, yaw);
  return { c: loadCentre(p, yaw, g, ext, s), half: g.across ? [g.width / 2, g.depth / 2] : [g.depth / 2, g.width / 2], yaw: ly };
}
export const truckObb = (p: Vec2, yaw: number): OBB2 => ({ c: p, half: [HALF_L, FORKLIFT.width / 2], yaw });

/** Farthest point of truck + load from the truck centre: the loaded routing disc. */
export function loadedRadius(g: Engage): number {
  const far = HALF_L + FORKLIFT.gap + g.depth;
  return Math.max(FORKLIFT_PROFILE.radius, Math.hypot(far, g.width / 2));
}
export function loadedProfile(g: Engage): VehicleProfile {
  const r = Math.round(loadedRadius(g) * 100) / 100;
  return { ...FORKLIFT_PROFILE, id: `forklift+load${r}`, radius: r };
}

const distToObb = (p: Vec2, o: OBB2) => {
  const l = rot2(sub2(p, o.c), -o.yaw);
  return Math.hypot(Math.max(Math.abs(l[0]) - o.half[0], 0), Math.max(Math.abs(l[1]) - o.half[1], 0));
};
const obLabel = (o: Obstacle) => (o.label && o.label !== o.id ? `${o.label} (${o.id})` : o.id);

// ─── shared checks ─────────────────────────────────────────────────────────────────────────────

type Op = { a: Entity; v: Entity };
function operatorOf(w: WorldState, operator: string): Op | Diagnostic {
  const a = w.entities[operator];
  if (!a?.human) return { code: 'actor.not-human', message: `"${operator}" is not a person in this world`, subjects: [operator] };
  const v = a.human.riding ? w.entities[a.human.riding] : undefined;
  if (!v || v.def !== 'forklift') return { code: 'forklift.no-operator', message: `${operator} is not driving a forklift (mount one first${v ? `; riding ${v.id}` : ''})`, subjects: [operator] };
  if (a.human.activity !== 'ride' || a.human.task) return { code: 'actor.busy', message: `${operator} is ${a.human.activity} (${a.human.task ?? 'no task'})`, subjects: [operator, v.id] };
  return { a, v };
}

/** The load on this forklift's forks, if any. */
export const loadOn = (w: WorldState, vehicle: string) =>
  Object.values(w.entities).find((e) => e.support?.kind === 'forks' && e.support.vehicle === vehicle);

/** Truck + load height at fork height h (mast / backrest above the forks while raised). */
const stackHeight = (h: number, g?: Engage) => Math.max(FORKLIFT.mast, h + FORKLIFT.carriage, g ? h + g.height : 0);

/**
 * Overhead check along poses: an obstacle the walking grids ignore (bottom above body height, e.g.
 * a deck slab or a `.up` prism) that truck + load at height H would strike.
 */
function overheadHit(sp: Spatial, poses: { p: Vec2; yaw: number }[], floor: number, H: number, g: Engage | undefined, skip: Set<string>): { o: Obstacle; p: Vec2 } | null {
  const cands = sp.scene.obstacles.filter((o) => !skip.has(o.id) && o.y0 >= floor + 1.8 - 1e-9 && o.y0 < floor + H - 0.005);
  if (!cands.length) return null;
  for (const q of poses) {
    const boxes = [truckObb(q.p, q.yaw), ...(g ? [loadObb(q.p, q.yaw, g, 0, 0)] : [])];
    for (const o of cands) if (boxes.some((b) => obbOverlap(b, o.obb, -0.01))) return { o, p: q.p };
  }
  return null;
}

/** Curve samples as poses (heading from neighbouring samples). */
function curvePoses(c: Curve): { p: Vec2; yaw: number }[] {
  const S = c.samples;
  return S.map((s, i) => {
    const a = S[Math.max(0, i - 1)].p, b = S[Math.min(S.length - 1, i + 1)].p;
    return { p: s.p, yaw: heading(sub2(b, a)) };
  });
}

/** The load's box (on the forks) against scene obstacles: the first one it intersects. */
export function loadHit(sp: Spatial, load: Entity, skip: Set<string>): Obstacle | null {
  const d = def(load.def);
  const o2: OBB2 = { c: xz(load), half: [d.size[0] / 2, d.size[2] / 2], yaw: load.pose.yaw };
  const y0 = load.pose.p[1], y1 = y0 + d.size[1];
  for (const o of sp.scene.obstacles) {
    if (o.id === load.id || skip.has(o.id) || o.y1 <= y0 + 0.005 || o.y0 >= y1 - 0.005) continue;
    if (obbOverlap(o2, o.obb, -0.01)) return o;
  }
  return null;
}

/** Obstacles the load touches where it lies (a pile, the floor slab): not in its way when lifted. */
function touching(sp: Spatial, load: Entity): string[] {
  const out: string[] = [];
  const d = def(load.def);
  const o2: OBB2 = { c: xz(load), half: [d.size[0] / 2, d.size[2] / 2], yaw: load.pose.yaw };
  for (const o of sp.scene.obstacles)
    if (o.id !== load.id && !(o.y1 <= load.pose.p[1] - 0.01 || o.y0 >= load.pose.p[1] + d.size[1] + 0.01) && obbOverlap(o2, o.obb, -0.01)) out.push(o.id);
  return out;
}

/** The nearest other person within `gap` (body gap) of truck + load on the operator's level. */
function personNear(w: WorldState, op: Op, gap: number, load?: Entity): { id: string; gap: number } | null {
  const boxes = [truckObb(xz(op.v), op.v.pose.yaw)];
  if (load) { const d = def(load.def); boxes.push({ c: xz(load), half: [d.size[0] / 2, d.size[2] / 2], yaw: load.pose.yaw }); }
  let best: { id: string; gap: number } | null = null;
  for (const o of Object.values(w.entities)) {
    if (!o.human || o.id === op.a.id || o.human.level !== op.a.human!.level || Math.abs(o.pose.p[1] - op.v.pose.p[1]) > 1.2) continue;
    const g = Math.min(...boxes.map((b) => distToObb(xz(o), b))) - HUMAN_RADIUS;
    if (g < gap && (!best || g < best.gap)) best = { id: o.id, gap: g };
  }
  return best;
}

// ─── execution: drive (ride_to follower), then scripted fork / creep steps ─────────────────────

type Step =
  | { k: 'drive' }
  | { k: 'square'; yaw: number }
  | { k: 'forks'; to: number }
  | { k: 'align'; c: Vec2; ext: number; s?: number; t?: number }
  | { k: 'reach'; to: number }
  | { k: 'creep'; d: number; done?: number }
  | { k: 'engage' }
  | { k: 'release'; y: number };

type RideExec = ReturnType<typeof rideTo.start>;
export type ForkProgram = { curve: Curve | null; targets: Vec2[]; steps: Step[]; g: Engage; out: Record<string, unknown> };
type ForkExec = {
  id: string; operator: string; vehicle: string; item: string; g: Engage; steps: Step[]; i: number;
  ride?: RideExec; curve: Curve | null; targets: Vec2[];
  h: number; ext: number; s: number; skip: string[]; out: Record<string, unknown>; ticks: number;
};

const failed = (code: string, message: string, subjects: string[], at?: Vec2): StepResult => ({ status: 'failed', diagnostic: { code, message, subjects, at: at ? [at[0], 0, at[1]] : undefined } });

/** Put the truck (and its operator, and the load on its forks) at (p, yaw). */
function placeTruck(rt: Runtime, ex: ForkExec, p: Vec2, yaw: number) {
  const v = rt.world.entities[ex.vehicle], a = rt.world.entities[ex.operator];
  const floor = v.pose.p[1];
  v.pose.p = [p[0], floor, p[1]];
  v.pose.yaw = yaw;
  a.pose.p = [p[0], floor + FORKLIFT_PROFILE.riderY, p[1]];
  a.pose.yaw = yaw;
  syncLoad(rt, ex);
}

/** The load follows the forks: truck pose + reach + side-shift, at fork height. */
function syncLoad(rt: Runtime, ex: ForkExec) {
  const load = rt.world.entities[ex.item];
  if (load?.support?.kind !== 'forks') return;
  const v = rt.world.entities[ex.vehicle];
  const c = loadCentre(xz(v), v.pose.yaw, ex.g, ex.ext, ex.s);
  load.pose = { p: [c[0], v.pose.p[1] + ex.h, c[1]], yaw: loadYaw(ex.g, v.pose.yaw) };
}

/** After any motion: the load must not intersect anything (forklift.load-collision). */
function loadCheck(rt: Runtime, ex: ForkExec): StepResult | null {
  const load = rt.world.entities[ex.item];
  if (load?.support?.kind !== 'forks') return null;
  const sp = spatial(rt);
  sp.sync(rt.world);
  const o = loadHit(sp, load, new Set(ex.skip));
  if (!o) return null;
  return failed('forklift.load-collision', `${load.id} on the forks of ${ex.vehicle} intersects ${obLabel(o)} at ${fmt(xz(load))}, ${f2(load.pose.p[1])} m up`, [load.id, ex.vehicle, o.id], xz(load));
}

/** A person within the stopping envelope of the moving truck: ask them to step away and wait. */
function peopleStop(rt: Runtime, ex: ForkExec, extra = 0): StepResult | null {
  const op = { a: rt.world.entities[ex.operator], v: rt.world.entities[ex.vehicle] };
  const load = rt.world.entities[ex.item]?.support?.kind === 'forks' ? rt.world.entities[ex.item] : undefined;
  const pn = personNear(rt.world, op, FORKLIFT.peopleGap + extra, load);
  if (!pn) return null;
  makeWay(rt, pn.id, xz(op.v));
  return { status: 'blocked', diagnostic: { code: 'traffic.person', message: `${ex.operator} on ${ex.vehicle} stops: ${pn.id} is ${f2(Math.max(0, pn.gap))} m from the truck${load ? ` and its load ${load.id}` : ''} (keeps ${FORKLIFT.peopleGap} m); waiting for them to move away`, subjects: [ex.operator, ex.vehicle, pn.id] } };
}

function stepDrive(rt: Runtime, ex: ForkExec, dt: number): StepResult | 'done' {
  const a = rt.world.entities[ex.operator];
  if (!ex.ride) ex.ride = rideTo.start(rt, { actor: ex.operator, x: ex.targets[ex.targets.length - 1][0], z: ex.targets[ex.targets.length - 1][1] }, { curve: ex.curve!, targets: ex.targets, cruise: FORKLIFT_PROFILE.speed }, ex.id);
  const r = ex.ride;
  const env = (r.v * r.v) / (2 * FORKLIFT_PROFILE.brake) + 0.2;
  const ps = peopleStop(rt, ex, env);
  let res: StepResult;
  if (ps && r.v < 0.02) res = ps;
  else {
    const cruise = r.cruise;
    if (ps) r.cruise = 0; // brake for them (the follower's own profile; no pivot at a standstill)
    res = rideTo.step(rt, r, dt);
    r.cruise = cruise;
    if (ps && res.status === 'running') res = ps;
  }
  a.human!.task = ex.id; // the follower clears it when its ride ends; the forklift verb still owns the operator
  syncLoad(rt, ex);
  const lc = loadCheck(rt, ex);
  if (lc) return lc;
  if (res.status === 'completed') return 'done';
  return res;
}

function advance(rt: Runtime, ex: ForkExec, dt: number): StepResult {
  const st = ex.steps[ex.i];
  if (!st) return finish(rt, ex);
  const v = rt.world.entities[ex.vehicle];
  const load = rt.world.entities[ex.item];
  const next = (): StepResult => { ex.i++; return { status: 'running', phase: ex.steps[ex.i]?.k ?? 'done' }; };
  switch (st.k) {
    case 'drive': {
      const r = stepDrive(rt, ex, dt);
      return r === 'done' ? next() : r;
    }
    case 'square': {
      const err = angleDelta(v.pose.yaw, st.yaw);
      if (Math.abs(err) < 1e-6) return next();
      const ps = peopleStop(rt, ex);
      if (ps) return ps;
      const d = clamp(err, -FORKLIFT_PROFILE.turnRate * dt, FORKLIFT_PROFILE.turnRate * dt);
      placeTruck(rt, ex, xz(v), Math.abs(err - d) < 1e-6 ? st.yaw : wrapAngle(v.pose.yaw + d));
      return loadCheck(rt, ex) ?? { status: 'running', phase: 'square' };
    }
    case 'forks': {
      if (Math.abs(ex.h - st.to) < 1e-9) return next();
      if (st.to > ex.h) {
        const sp = spatial(rt);
        sp.sync(rt.world);
        const hit = overheadHit(sp, [{ p: xz(v), yaw: v.pose.yaw }], v.pose.p[1], stackHeight(st.to), undefined, new Set());
        if (hit) return failed('forklift.overhead', `${ex.vehicle} cannot raise its forks to ${f2(st.to)} m at ${fmt(xz(v))}: the mast would strike ${obLabel(hit.o)} (${f2(hit.o.y0)} m up)`, [ex.vehicle, hit.o.id], xz(v));
      }
      const phase = st.to > ex.h ? 'raise' : 'lower';
      ex.h += clamp(st.to - ex.h, -FORKLIFT.liftRate * dt, FORKLIFT.liftRate * dt);
      if (Math.abs(ex.h - st.to) < 1e-9) ex.h = st.to;
      syncLoad(rt, ex);
      return loadCheck(rt, ex) ?? { status: 'running', phase };
    }
    case 'align': {
      if (st.t === undefined) {
        const l = rot2(sub2(st.c, xz(v)), -v.pose.yaw);
        st.s = l[1];
        st.t = l[0] - loadLocal(ex.g, st.ext, 0)[0];
        if (Math.abs(st.s) > FORKLIFT.sideShiftMax)
          return failed('forklift.misaligned', `${ex.vehicle} ended its approach ${f2(Math.abs(st.s))} m off line at ${fmt(xz(v))} (side-shift ±${FORKLIFT.sideShiftMax} m)`, [ex.vehicle, ex.item], xz(v));
      }
      if (Math.abs(ex.s - st.s!) > 1e-9) {
        ex.s += clamp(st.s! - ex.s, -FORKLIFT.reachSpeed * dt, FORKLIFT.reachSpeed * dt);
        if (Math.abs(ex.s - st.s!) < 1e-9) ex.s = st.s!;
        syncLoad(rt, ex);
        return loadCheck(rt, ex) ?? { status: 'running', phase: 'side-shift' };
      }
      ex.steps[ex.i] = { k: 'creep', d: st.t };
      return { status: 'running', phase: 'creep' };
    }
    case 'creep': {
      const done = st.done ?? 0;
      if (Math.abs(st.d - done) < 1e-9) return next();
      const ps = peopleStop(rt, ex);
      if (ps) return ps;
      const ds = clamp(st.d - done, -FORKLIFT.creepSpeed * dt, FORKLIFT.creepSpeed * dt);
      st.done = Math.abs(st.d - done - ds) < 1e-9 ? st.d : done + ds;
      placeTruck(rt, ex, add2(xz(v), rot2([st.done - done, 0], v.pose.yaw)), v.pose.yaw);
      return loadCheck(rt, ex) ?? { status: 'running', phase: st.d < 0 ? 'back-off' : 'creep' };
    }
    case 'reach': {
      if (Math.abs(ex.ext - st.to) < 1e-9) return next();
      ex.ext += clamp(st.to - ex.ext, -FORKLIFT.reachSpeed * dt, FORKLIFT.reachSpeed * dt);
      if (Math.abs(ex.ext - st.to) < 1e-9) ex.ext = st.to;
      syncLoad(rt, ex);
      return loadCheck(rt, ex) ?? { status: 'running', phase: 'reach' };
    }
    case 'engage': {
      ex.skip = touching(spatial(rt), load);
      load.phase = 'carried';
      load.support = { kind: 'forks', vehicle: ex.vehicle };
      syncLoad(rt, ex);
      return next();
    }
    case 'release': {
      load.pose = { p: [load.pose.p[0], st.y, load.pose.p[2]], yaw: load.pose.yaw };
      load.phase = 'staged';
      load.support = { kind: 'ground' }; // lying on that level's floor: what stagedCheck (install_*) expects
      ex.s = 0;
      return next();
    }
  }
}

function finish(rt: Runtime, ex: ForkExec): StepResult {
  rt.world.entities[ex.operator].human!.task = undefined;
  const v = rt.world.entities[ex.vehicle], load = rt.world.entities[ex.item];
  return { status: 'completed', outputs: { ...ex.out, vehicle: v.id, item: load.id, x: v.pose.p[0], z: v.pose.p[2], loadAt: [load.pose.p[0], load.pose.p[1], load.pose.p[2]], forks: ex.h, ticks: ex.ticks } };
}

// ─── planning ──────────────────────────────────────────────────────────────────────────────────

/** Vehicle-grid clearance at p below the truck's radius: the blockers there. */
function tightAt(sp: Spatial, w: WorldState, level: number, p: Vec2, r: number): string[] | null {
  const g = vehicleGrids(sp, w, FORKLIFT_PROFILE, level).grids.levels.get(level);
  if (!g) return ['no floor'];
  const c = clearanceAt(g, p);
  if (c >= r) return null;
  const near = blockersNear(g, p, c + 0.3);
  return near.length ? near.slice(0, 2) : ['the floor edge'];
}

type Drive = { ok: true; curve: Curve | null; targets: Vec2[]; length: number } | Fail;
/** Plan the drive to `pre` facing `yaw` (straight lead-in), with overhead clearance for height H. */
function planDrive(rt: Runtime, op: Op, pr: VehicleProfile, pre: Vec2, yaw: number, H: number, g: Engage | undefined): Drive {
  const sp = spatial(rt);
  const start = xz(op.v);
  if (dist2(start, pre) < 0.05 && Math.abs(angleDelta(op.v.pose.yaw, yaw)) < 0.3) return { ok: true, curve: null, targets: [], length: 0 };
  const lead = sub2(pre, rot2([FORKLIFT.leadIn, 0], yaw));
  const targets: Vec2[] = dist2(start, pre) > FORKLIFT.leadIn + 1 ? [lead, pre] : [pre];
  const r = planCurve(sp, rt.world, pr, `${op.a.id} on ${op.v.id}`, op.a.human!.level, start, targets, pr.speed);
  if (!r.ok) return r;
  const hit = overheadHit(sp, curvePoses(r.curve), op.v.pose.p[1], stackHeight(FORKLIFT.travelHeight, g), g, new Set());
  if (hit) return bad('forklift.overhead', `${op.v.id}${g ? ' with its load' : ''} (${f2(stackHeight(FORKLIFT.travelHeight, g))} m tall) cannot pass under ${obLabel(hit.o)} (${f2(hit.o.y0)} m up) at ${fmt(hit.p)}`, [op.v.id, hit.o.id], hit.p);
  return { ok: true, curve: r.curve, targets, length: r.curve.length };
}

type Cand = { steps: Step[]; drive: Exclude<Drive, Fail>; out: Record<string, unknown> };
const bestOf = (cs: Cand[]) => cs.sort((a, b) => a.drive.length - b.drive.length)[0];

export function planPick(rt: Runtime, p: { operator: string; item: string }): { ok: true; program: ForkProgram } | Fail {
  const w = rt.world;
  const op = operatorOf(w, p.operator);
  if ('code' in op) return { ok: false, diagnostic: op };
  const it = w.entities[p.item];
  if (!it || it.kind !== 'component') return bad('entity.unknown', `no component "${p.item}"`, [p.item]);
  const held = loadOn(w, op.v.id);
  if (held) return bad('forklift.loaded', `${op.v.id} already carries ${held.id} on its forks`, [op.v.id, held.id]);
  const floor = op.v.pose.p[1];
  if (!(it.phase === 'stored' || it.phase === 'staged') || it.support?.kind !== 'ground' || Math.abs(it.pose.p[1] - floor) > 0.05 || it.pose.pitch || it.pose.roll)
    return bad('forklift.not-on-ground', `${it.id} must lie flat on the ground at ${op.v.id}'s level (it is ${it.phase ?? 'unplaced'}, support ${it.support?.kind ?? 'none'}, ${f2(it.pose.p[1])} m up)`, [it.id], xz(it));
  const d = def(it.def);
  if (d.massKg > FORKLIFT.capacityKg) return bad('forklift.capacity', `${it.id} weighs ${d.massKg} kg, over the ${FORKLIFT.capacityKg} kg capacity of ${op.v.id}`, [it.id, op.v.id]);
  const g = engagement(it.def);
  if (!g) return bad('forklift.no-engagement', `${it.id} (${d.size[0].toFixed(2)} × ${d.size[2].toFixed(2)} m) is longer than the forks can take from either side (fork length ${FORKLIFT.forkLength} m + ${FORKLIFT.overhang} m overhang)`, [it.id]);
  const sp = spatial(rt);
  sp.sync(w);
  const touch = new Set(touching(sp, it));
  const c = xz(it);
  const lv = op.a.human!.level;
  const psi0 = wrapAngle(it.pose.yaw - (g.across ? Math.PI / 2 : 0));
  const cands: Cand[] = [], why: string[] = [], subj: string[] = [];
  let firstFail: Diagnostic | null = null;
  for (const psi of [psi0, wrapAngle(psi0 + Math.PI)]) {
    const T = sub2(c, rot2(loadLocal(g, 0, 0), psi));
    const pre = sub2(T, rot2([FORKLIFT.forkLength + FORKLIFT.prePose - FORKLIFT.gap, 0], psi));
    // approach lane (fork side): truck width from the load's near edge back past the pre-pose
    const near = HALF_L + FORKLIFT.gap; // along f from T
    const tail = -(FORKLIFT.forkLength + FORKLIFT.prePose - FORKLIFT.gap) - HALF_L - 0.5;
    const lane: OBB2 = { c: add2(T, rot2([(near + tail) / 2, 0], psi)), half: [(near - tail) / 2, FORKLIFT.width / 2], yaw: psi };
    const side = `from ${fmt(add2(c, rot2([-(g.depth / 2 + 1), 0], psi)))}`;
    const block = sp.scene.obstacles.find((o) => o.id !== it.id && !touch.has(o.id) && o.y1 > floor + FORKLIFT_PROFILE.stepHeight && o.y0 < floor + FORKLIFT.mast && obbOverlap(lane, o.obb, -0.01));
    if (block) { why.push(`${side}: ${obLabel(block)} is in the approach lane`); subj.push(block.id); continue; }
    const tight = tightAt(sp, w, lv, pre, FORKLIFT_PROFILE.radius) ?? tightAt(sp, w, lv, T, FORKLIFT_PROFILE.radius);
    if (tight) { why.push(`${side}: no turning clearance (${FORKLIFT_PROFILE.radius} m) next to ${tight.join(' and ')}`); subj.push(...tight); continue; }
    const dr = planDrive(rt, op, FORKLIFT_PROFILE, pre, psi, FORKLIFT.mast, undefined);
    if (!dr.ok) { firstFail ??= dr.diagnostic; why.push(`${side}: ${dr.diagnostic.message}`); continue; }
    const drive = dr;
    cands.push({ drive, steps: [...(drive.curve ? [{ k: 'drive' } as Step] : []), { k: 'square', yaw: psi }, { k: 'forks', to: 0 }, { k: 'align', c, ext: 0 }, { k: 'engage' }, { k: 'forks', to: FORKLIFT.travelHeight }], out: { yaw: psi } });
  }
  const best = bestOf(cands);
  if (!best) {
    if (firstFail && !subj.length) return { ok: false, diagnostic: firstFail };
    return bad('forklift.no-approach', `${op.v.id} cannot get its forks under ${it.id}: ${why.join('; ')}`, [op.v.id, it.id, ...new Set(subj)], c);
  }
  return { ok: true, program: { curve: best.drive.curve, targets: best.drive.targets, steps: best.steps, g, out: best.out } };
}

type To = { x: number; z: number; yaw: number; level: number };

export function planDeliver(rt: Runtime, p: { operator: string; to: To }): { ok: true; program: ForkProgram } | Fail {
  const w = rt.world;
  const op = operatorOf(w, p.operator);
  if ('code' in op) return { ok: false, diagnostic: op };
  const load = loadOn(w, op.v.id);
  if (!load) return bad('forklift.no-load', `${op.v.id} has nothing on its forks (forklift_pick first)`, [op.v.id]);
  const g = engagement(load.def)!;
  const sp = spatial(rt);
  sp.sync(w);
  const floor = op.v.pose.p[1];
  const lv = op.a.human!.level;
  const c: Vec2 = [p.to.x, p.to.z];
  const level = sp.scene.levels.find((l) => l.id === p.to.level);
  if (!level) return bad('forklift.no-surface', `there is no level ${p.to.level} in this scene (levels ${sp.scene.levels.map((l) => l.id).join(', ')})`, [load.id], c);
  const d = def(load.def);
  const place: OBB2 = { c, half: [d.size[0] / 2, d.size[2] / 2], yaw: p.to.yaw };
  const corners = obbCorners(place);
  const surf = sp.scene.surfaces.find((s: Surface) => s.level === level.id && corners.every((q) => pointInObb(q, s.obb, 0.01)));
  if (!surf) return bad('forklift.no-surface', `no supported floor on level ${level.id} (${level.label}, ${f2(level.y)} m) carries the whole footprint of ${load.id} at ${fmt(c)}`, [load.id], c, level.y);
  const top = surf.y;
  const deck = top > floor + FORKLIFT.travelHeight;
  if (deck && top - floor > FORKLIFT.liftMax + 1e-9)
    return bad('forklift.lift-range', `${surf.label ?? surf.id} is ${f2(top - floor)} m above ${op.v.id}'s floor; its forks lift 0–${FORKLIFT.liftMax} m`, [op.v.id, surf.id, load.id], c, top);
  if (top < floor - 0.05) return bad('forklift.lift-range', `${surf.label ?? surf.id} lies below ${op.v.id}'s floor; forks do not reach down`, [op.v.id, surf.id], c, top);
  const box = sp.scene.obstacles.find((o) => o.id !== load.id && o.y1 > top + 0.005 && o.y0 < top + g.height + 0.3 && obbOverlap(place, o.obb, -0.01));
  if (box) return bad('forklift.placement-blocked', `the footprint of ${load.id} at ${fmt(c)} on ${surf.label ?? surf.id} is taken by ${obLabel(box)}`, [load.id, box.id], c, top);
  const who = Object.values(w.entities).find((o) => o.human && o.human.level === level.id && Math.abs(o.pose.p[1] - top) < 1 && distToObb(xz(o), place) < HUMAN_RADIUS);
  if (who) return bad('forklift.placement-blocked', `${who.id} is standing where ${load.id} would go at ${fmt(c)}`, [load.id, who.id], c, top);
  const raise = deck ? Math.min(top - floor + FORKLIFT.deckClear, FORKLIFT.liftMax) : FORKLIFT.travelHeight;
  const psi0 = wrapAngle(p.to.yaw - (g.across ? Math.PI / 2 : 0));
  const pr = loadedProfile(g);
  const cands: Cand[] = [], why: string[] = [], subj: string[] = [];
  let reachFail: Fail | null = null, firstFail: Diagnostic | null = null;
  for (const psi of [psi0, wrapAngle(psi0 + Math.PI)]) {
    const h = fwd(psi);
    let front: number, ext = 0, preFront: number, edge = '';
    if (deck) {
      // the receiving edge: the side of the deck behind the load, square to the truck
      const u = rot2(h, -surf.obb.yaw);
      const k = Math.abs(u[0]) > 0.9995 ? 0 : Math.abs(u[1]) > 0.9995 ? 1 : -1;
      if (k === -1) { why.push(`heading ${f2(psi)} rad is not square to an edge of ${surf.id}`); continue; }
      const sgn = u[k] > 0 ? 1 : -1;
      const eb = sgn * rot2(sub2(c, surf.obb.c), -surf.obb.yaw)[k] + surf.obb.half[k]; // load centre → edge, along -h
      const far = eb + g.depth / 2;
      if (far > FORKLIFT.forkLength + FORKLIFT.overhang + 1e-9) {
        reachFail ??= bad('forklift.reach', `${load.id} at ${fmt(c)} would reach ${f2(far)} m in from the edge of ${surf.label ?? surf.id} (${fmt(sub2(c, scale(h, eb)))}); the forks reach ${f2(FORKLIFT.forkLength + FORKLIFT.overhang)} m (fork length ${FORKLIFT.forkLength} m + ${FORKLIFT.overhang} m)`, [op.v.id, load.id, surf.id], c, top);
        continue;
      }
      front = Math.min(-eb - FORKLIFT.edgeGap, -g.depth / 2 - FORKLIFT.gap);
      ext = -g.depth / 2 - FORKLIFT.gap - front;
      preFront = -eb - FORKLIFT.prePose - FORKLIFT.gap - g.depth;
      edge = `${surf.id} edge at ${fmt(sub2(c, scale(h, eb)))}`;
    } else {
      front = -g.depth / 2 - FORKLIFT.gap;
      preFront = front - FORKLIFT.backOff;
    }
    const T = add2(c, scale(h, front - HALF_L)), pre = add2(c, scale(h, preFront - HALF_L));
    const side = `approaching along ${f2(psi)} rad`;
    const tight = tightAt(sp, w, lv, T, FORKLIFT_PROFILE.radius) ?? tightAt(sp, w, lv, pre, FORKLIFT_PROFILE.radius);
    if (tight) { why.push(`${side}: no clearance for the truck next to ${tight.join(' and ')}`); subj.push(...tight); continue; }
    // raised: the mast over truck positions pre → final, the load box along the creep at fork height
    const up = overheadHit(sp, [{ p: pre, yaw: psi }, { p: T, yaw: psi }], floor, stackHeight(raise), undefined, new Set());
    if (up) { why.push(`${side}: the raised mast would strike ${obLabel(up.o)}`); subj.push(up.o.id); continue; }
    const sweep = sweepHit(sp, load, g, pre, T, psi, ext, floor + raise);
    if (sweep) { why.push(`${side}: the raised load would strike ${obLabel(sweep)}`); subj.push(sweep.id); continue; }
    const dr = planDrive(rt, op, pr, pre, psi, 0, g);
    if (!dr.ok) { firstFail ??= dr.diagnostic; why.push(`${side}: ${dr.diagnostic.message}`); continue; }
    const steps: Step[] = [...(dr.curve ? [{ k: 'drive' } as Step] : []), { k: 'square', yaw: psi }, { k: 'forks', to: raise }, { k: 'align', c, ext }];
    if (ext > 0) steps.push({ k: 'reach', to: ext });
    steps.push({ k: 'forks', to: top - floor }, { k: 'release', y: top }, ...(ext > 0 ? [{ k: 'reach', to: 0 } as Step] : []), { k: 'creep', d: -FORKLIFT.backOff }, { k: 'forks', to: deck ? FORKLIFT.travelHeight : 0 });
    cands.push({ drive: dr, steps, out: { yaw: psi, level: level.id, surface: surf.id, top, reach: ext, edge } });
  }
  const best = bestOf(cands);
  if (!best) {
    if (reachFail && !why.length) return reachFail;
    if (firstFail && !subj.length) return { ok: false, diagnostic: firstFail };
    if (!why.length && reachFail) return reachFail;
    const overhead = why.some((s) => s.includes('strike') || s.includes('pass under'));
    return bad(overhead ? 'forklift.overhead' : 'forklift.no-approach', `${op.v.id} cannot set ${load.id} down at ${fmt(c)}: ${why.join('; ')}${reachFail ? `; ${reachFail.diagnostic.message}` : ''}`, [op.v.id, load.id, ...new Set(subj)], c, top);
  }
  return { ok: true, program: { curve: best.drive.curve, targets: best.drive.targets, steps: best.steps, g, out: best.out } };
}

const scale = (v: Vec2, k: number): Vec2 => [v[0] * k, v[1] * k];

/** The load's box at fork height y along the straight creep pre → T (then pushed out by ext). */
function sweepHit(sp: Spatial, load: Entity, g: Engage, pre: Vec2, T: Vec2, yaw: number, ext: number, y: number): Obstacle | null {
  const n = Math.max(2, Math.ceil(dist2(pre, T) / 0.05));
  const y1 = y + g.height;
  const obs = sp.scene.obstacles.filter((o) => o.id !== load.id && o.y1 > y + 0.005 && o.y0 < y1 - 0.005);
  for (let k = 0; k <= n + 1; k++) {
    const p = k <= n ? add2(pre, scale(sub2(T, pre), k / n)) : T;
    const b = loadObb(p, yaw, g, k <= n ? 0 : ext, 0);
    const o = obs.find((q) => obbOverlap(b, q.obb, -0.01));
    if (o) return o;
  }
  return null;
}

// ─── verbs ─────────────────────────────────────────────────────────────────────────────────────

const opReservations = (w: WorldState, operator: string, item?: string) => {
  const vid = w.entities[operator]?.human?.riding;
  const load = item ?? (vid ? loadOn(w, vid)?.id : undefined);
  return [
    { resource: `actor:${operator}`, mode: 'exclusive' as const },
    ...(vid ? [{ resource: `entity:${vid}`, mode: 'exclusive' as const }] : []),
    ...(load ? [{ resource: `entity:${load}`, mode: 'exclusive' as const }] : []),
  ];
};

function startFork(rt: Runtime, operator: string, item: string, prog: ForkProgram, id: string): ForkExec {
  const a = rt.world.entities[operator];
  a.human!.task = id;
  const it = rt.world.entities[item];
  const onForks = it.support?.kind === 'forks';
  if (!onForks) it.phase = 'reserved';
  return {
    id, operator, vehicle: a.human!.riding!, item, g: prog.g, steps: prog.steps.map((s) => ({ ...s })), i: 0, curve: prog.curve, targets: prog.targets,
    h: onForks ? it.pose.p[1] - rt.world.entities[a.human!.riding!].pose.p[1] : FORKLIFT.travelHeight, ext: 0, s: 0, skip: [], out: prog.out, ticks: 0,
  };
}

function stepFork(rt: Runtime, ex: ForkExec, dt: number): StepResult {
  ex.ticks++;
  const a = rt.world.entities[ex.operator];
  if (a?.human?.riding !== ex.vehicle) return failed('vehicle.rider-lost', `${ex.operator} is no longer driving ${ex.vehicle}`, [ex.operator, ex.vehicle]);
  // instantaneous steps (engage / release / finished moves) chain within the tick
  for (let n = 0; n < 6; n++) {
    const i = ex.i;
    const r = advance(rt, ex, dt);
    if (r.status !== 'running') return r;
    if (ex.i >= ex.steps.length) return finish(rt, ex);
    if (ex.i === i || ex.steps[i].k === 'drive') return r; // moved this tick
  }
  return { status: 'running', phase: ex.steps[ex.i]?.k ?? 'done' };
}

function cancelFork(rt: Runtime, ex: ForkExec) {
  const st = ex.steps[ex.i];
  const load = rt.world.entities[ex.item];
  const onForks = load?.support?.kind === 'forks';
  if (onForks && ex.h > FORKLIFT.travelHeight + 1e-6)
    return { ok: false as const, diagnostic: { code: 'forklift.cancel-unsafe', message: `${ex.item} is raised ${f2(ex.h)} m on the forks of ${ex.vehicle}; it cannot be abandoned mid-placement`, subjects: [ex.item, ex.vehicle] } };
  if (st?.k === 'drive' && ex.ride) {
    ex.ride.cancelling = true; // brake to a stop (the follower's cancel), then the verb completes as cancelled
    ex.steps = ex.steps.slice(0, ex.i + 1);
    return { ok: true as const, deferred: true };
  }
  if (!onForks && load?.phase === 'reserved') load.phase = 'staged';
  rt.world.entities[ex.operator].human!.task = undefined;
  return { ok: true as const };
}

export const forkliftPick: ActionDef<{ operator: string; item: string }, ForkProgram, ForkExec> = {
  verb: 'forklift_pick',
  description: `A mounted forklift operator drives to a load lying on the ground (clear approach lane on the fork side), slides the forks under it, and raises it ${FORKLIFT.travelHeight} m for travel. Capacity ${FORKLIFT.capacityKg} kg; forks ${FORKLIFT.forkLength} m.`,
  schema: z.strictObject({ operator: z.string().max(80), item: z.string().max(80) }),
  reservations: (w, p) => opReservations(w, p.operator, p.item),
  plan: planPick,
  start: (rt, p, prog, id) => startFork(rt, p.operator, p.item, prog, id),
  step: stepFork,
  cancel: cancelFork,
};

export const forkliftDeliver: ActionDef<{ operator: string; to: To }, ForkProgram, ForkExec> = {
  verb: 'forklift_deliver',
  description: `Drive the load on the forks to the receiving edge of a supported deck (or a ground spot), raise it (lift range 0–${FORKLIFT.liftMax} m), set it down at (x, z, yaw) within fork reach of the edge (≤ ${FORKLIFT.forkLength + FORKLIFT.overhang} m), lower and back off ${FORKLIFT.backOff} m. The load is left staged on that level.`,
  schema: z.strictObject({
    operator: z.string().max(80),
    to: z.strictObject({ x: z.number().min(-1e4).max(1e4), z: z.number().min(-1e4).max(1e4), yaw: z.number().min(-10).max(10), level: z.number().int().min(0).max(40) }),
  }),
  reservations: (w, p) => opReservations(w, p.operator),
  plan: planDeliver,
  start: (rt, p, prog, id) => {
    const vid = rt.world.entities[p.operator].human!.riding!;
    return startFork(rt, p.operator, loadOn(rt.world, vid)!.id, prog, id);
  },
  step: stepFork,
  cancel: cancelFork,
};

/** Every tick: a load on forks sits on a forklift and intersects no scene obstacle. */
export const forkliftLoad: Invariant = (rt: Runtime) => {
  const out: Diagnostic[] = [];
  let sp: Spatial | undefined;
  for (const e of Object.values(rt.world.entities)) {
    if (e.support?.kind !== 'forks') continue;
    const v = rt.world.entities[e.support.vehicle];
    if (!v || v.def !== 'forklift') { out.push({ code: 'forklift.load-unsupported', message: `${e.id} is on the forks of ${e.support.vehicle}, which is not a forklift`, subjects: [e.id, e.support.vehicle], at: e.pose.p }); continue; }
    const rise = e.pose.p[1] - v.pose.p[1];
    if (rise < -1e-6 || rise > FORKLIFT.liftMax + 1e-6) out.push({ code: 'forklift.lift-range', message: `${e.id} is ${f2(rise)} m up on ${v.id}'s forks (range 0–${FORKLIFT.liftMax} m)`, subjects: [e.id, v.id], at: e.pose.p });
    sp ??= spatial(rt);
    sp.sync(rt.world);
    const hit = loadHit(sp, e, new Set());
    if (hit) out.push({ code: 'forklift.load-collision', message: `${e.id} on the forks of ${v.id} intersects ${obLabel(hit)} at ${fmt(xz(e))}, ${f2(e.pose.p[1])} m up`, subjects: [e.id, v.id, hit.id], at: e.pose.p });
  }
  return out;
};

export const FORKLIFT_ACTIONS: ActionDef[] = [forkliftPick, forkliftDeliver];
export const FORKLIFT_INVARIANTS: Invariant[] = [forkliftLoad];
