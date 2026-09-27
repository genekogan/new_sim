// `carry` action (spec §11, §13): gather → lift → move → set-down → release.
// The crew and load move as one rigid formation along a trajectory that was
// validated for the whole formation at submit time. Carrier positions are
// derived from the load pose every tick, so grips never drift. Cancelling
// never drops a load: it becomes a controlled set-down (deferred cancel) at
// the current pose if that spot is clear, otherwise it is refused.
import { z } from 'zod';
import { angleDelta, clamp, wrapAngle, type Vec2 } from '../core/math.ts';
import type { ActionDef, CancelResult, StepResult } from '../actions/types.ts';
import type { Runtime } from '../runtime/runtime.ts';
import type { Entity, Pose } from '../world/types.ts';
import type { Spatial } from '../spatial/service.ts';
import { makeWay, walkTo } from '../locomotion/walk.ts';
import { carriedPose, carrierSpots, entityFrame, laidPose, worldDiscs, type SE2 } from './formation.ts';
import { poseHit } from './sweep.ts';
import { labelOf, laidIssue, planCarryAction, type CarryParams, type CarryProgram } from './validate.ts';
import { planCarry } from './planner.ts';

export const CARRY_SPEED = 0.9; // m/s of the fastest-moving formation point (centre + load tips under rotation)
const ACCEL = 0.5; // m/s²
const LIFT_S = 1.2;
const SETDOWN_S = 1.2;
const RELEASE_S = 0.4;
const GATHER_TIMEOUT_S = 120;
const TURN_RATE = 3.0; // rad/s, turning to face along the load before lifting

type WalkExec = ReturnType<typeof walkTo.start>;
type Transition = { from: Pose; to: Pose; fromSpots: Vec2[]; toSpots: Vec2[]; yaw: number; final: 'staged' | 'stored' };
type Exec = {
  id: string;
  p: CarryProgram;
  phase: 'gather' | 'lift' | 'move' | 'set-down' | 'release';
  walks: (WalkExec | null)[];
  t: number;
  u: number;
  v: number;
  i: number;
  q: SE2;
  tr?: Transition;
  cancelling: boolean;
  epoch: number;
  replans?: number;
  waited?: number;
};

export const carrySchema = z.strictObject({
  crew: z.array(z.string().max(80)).min(1).max(8).refine((a) => new Set(a).size === a.length, 'crew members must be distinct'),
  item: z.string().max(80),
  to: z.strictObject({ x: z.number().min(-500).max(500), z: z.number().min(-500).max(500), yaw: z.number().min(-7).max(7), level: z.number().int().min(0).max(20).optional() }),
  place: z.literal('lay').optional(),
});

const smooth = (t: number) => t * t * (3 - 2 * t);
const lerpPose = (a: Pose, b: Pose, t: number): Pose => ({
  p: [a.p[0] + (b.p[0] - a.p[0]) * t, a.p[1] + (b.p[1] - a.p[1]) * t, a.p[2] + (b.p[2] - a.p[2]) * t],
  yaw: wrapAngle(a.yaw + angleDelta(a.yaw, b.yaw) * t),
  pitch: (a.pitch ?? 0) + ((b.pitch ?? 0) - (a.pitch ?? 0)) * t,
  roll: (a.roll ?? 0) + ((b.roll ?? 0) - (a.roll ?? 0)) * t,
});
const crewOf = (rt: Runtime, ex: Exec): Entity[] => ex.p.crew.map((id) => rt.world.entities[id]);
const itemOf = (rt: Runtime, ex: Exec) => rt.world.entities[ex.p.item];

/** Place load + carriers for formation pose q (the only way positions change while moving). */
function applyFormation(rt: Runtime, ex: Exec, q: SE2) {
  const item = itemOf(rt, ex);
  item.pose = carriedPose(ex.p.f, q, ex.p.levelY);
  const spots = carrierSpots(ex.p.f, q);
  crewOf(rt, ex).forEach((h, i) => {
    h.pose = { p: [spots[i][0], ex.p.levelY, spots[i][1]], yaw: wrapAngle(q.th) };
  });
  ex.q = q;
}

/** A non-crew person inside the formation's footprint (load discs + carrier spots) at arc length u. */
function pathBystander(rt: Runtime, ex: Exec, u: number): string | null {
  const p = ex.p;
  const i0 = ex.i;
  const q = poseAtU(ex, u);
  ex.i = i0; // poseAtU advances the segment cursor; restore it
  const discs = worldDiscs(p.f, q);
  const spots = carrierSpots(p.f, q);
  for (const o of Object.values(rt.world.entities)) {
    if (o.kind !== 'human' || p.crew.includes(o.id) || o.human?.level !== p.level) continue;
    const x = o.pose.p[0], z = o.pose.p[2];
    if (discs.some((d) => Math.hypot(d.p[0] - x, d.p[1] - z) < d.d.r + 0.28 + 0.08)) return o.id;
    if (spots.some((s) => Math.hypot(s[0] - x, s[1] - z) < 2 * 0.28 + 0.08)) return o.id;
  }
  return null;
}

/** A non-crew person standing within a body width of any station, or inside a laid footprint (+0.4 m). */
function bystanderAt(rt: Runtime, ex: Exec, spots: Vec2[], frame: ReturnType<typeof entityFrame> | null): string | null {
  const p = ex.p;
  for (const o of Object.values(rt.world.entities)) {
    if (o.kind !== 'human' || p.crew.includes(o.id) || o.human?.level !== p.level) continue;
    const q: Vec2 = [o.pose.p[0], o.pose.p[2]];
    if (spots.some((s) => Math.hypot(s[0] - q[0], s[1] - q[1]) < 2 * 0.28 + 0.12)) return o.id;
    if (frame) {
      const l = sub2r(q, [frame.q.x, frame.q.z], frame.q.th);
      if (Math.abs(l[0]) < p.f.length / 2 + 0.4 && Math.abs(l[1]) < frame.halfW + 0.4) return o.id;
    }
  }
  return null;
}
const sub2r = (q: Vec2, c: Vec2, th: number): Vec2 => {
  const dx = q[0] - c[0], dz = q[1] - c[1];
  return [dx * Math.cos(-th) - dz * Math.sin(-th), dx * Math.sin(-th) + dz * Math.cos(-th)];
};

/**
 * Mid-carry replan starts: always the current pose; the heading-flipped pose only when it keeps
 * every carrier within 0.3 m of where they stand (otherwise the crew would teleport — review C1).
 */
function replanStarts(rt: Runtime, ex: Exec, here: SE2): SE2[] {
  const flip: SE2 = { ...here, th: wrapAngle(here.th + Math.PI) };
  const spots = carrierSpots(ex.p.f, flip);
  const near = crewOf(rt, ex).every((h, i) => Math.hypot(spots[i][0] - h.pose.p[0], spots[i][1] - h.pose.p[2]) <= 0.3);
  return near ? [here, flip] : [here];
}

function poseAtU(ex: Exec, u: number): SE2 {
  const { poses, u: us } = ex.p.traj;
  while (ex.i < us.length - 2 && us[ex.i + 1] <= u) ex.i++;
  const a = poses[ex.i], b = poses[ex.i + 1] ?? a;
  const span = (us[ex.i + 1] ?? us[ex.i]) - us[ex.i];
  const t = span > 1e-12 ? clamp((u - us[ex.i]) / span, 0, 1) : 1;
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, th: a.th + (b.th - a.th) * t };
}

function beginTransition(rt: Runtime, ex: Exec, phase: 'lift' | 'set-down', to: Pose, toSpots: Vec2[], yaw: number, final: 'staged' | 'stored') {
  const item = itemOf(rt, ex);
  const fromSpots = crewOf(rt, ex).map((h) => [h.pose.p[0], h.pose.p[2]] as Vec2);
  ex.tr = { from: { ...item.pose, p: [...item.pose.p] }, to, fromSpots, toSpots, yaw, final };
  ex.phase = phase;
  ex.t = 0;
  for (const h of crewOf(rt, ex)) h.human!.activity = phase;
}

function stepTransition(rt: Runtime, ex: Exec, dt: number, dur: number): boolean {
  const tr = ex.tr!;
  ex.t = Math.min(dur, ex.t + dt);
  const a = smooth(ex.t / dur);
  itemOf(rt, ex).pose = lerpPose(tr.from, tr.to, a);
  crewOf(rt, ex).forEach((h, i) => {
    const s = tr.fromSpots[i], e = tr.toSpots[i];
    h.pose = { p: [s[0] + (e[0] - s[0]) * a, ex.p.levelY, s[1] + (e[1] - s[1]) * a], yaw: wrapAngle(h.pose.yaw + angleDelta(h.pose.yaw, tr.yaw) * a) };
  });
  return ex.t >= dur - 1e-9;
}

function startSetDown(rt: Runtime, ex: Exec, q: SE2) {
  const laid = laidPose(ex.p.f, q, ex.p.levelY);
  const halfW = entityFrame({ ...itemOf(rt, ex), pose: laid }).halfW;
  beginTransition(rt, ex, 'set-down', laid, carrierSpots(ex.p.f, q, halfW), q.th, 'staged');
}

export const carry: ActionDef<CarryParams, CarryProgram, Exec> = {
  verb: 'carry',
  description:
    'A crew of 1–4 people picks up a component (upright, beam, 2x4, plywood), carries it as one rigid formation along a route validated for load + carriers, and lays it down at (x, z, yaw). Rejected with a diagnostic if the crew is too small or the formation cannot fit.',
  schema: carrySchema,
  reservations: (_w, p) => [...p.crew.map((c) => ({ resource: `actor:${c}`, mode: 'exclusive' as const })), { resource: `entity:${p.item}`, mode: 'exclusive' }],
  plan: planCarryAction,
  start(rt, p, prog, id) {
    const walks = prog.crew.map((actor, i) => {
      const r = prog.gather[i];
      return r ? walkTo.start(rt, { actor, x: prog.approach[i][0], z: prog.approach[i][1] }, r, id) : null;
    });
    for (const c of prog.crew) rt.world.entities[c].human!.task = id;
    rt.world.entities[prog.item].reservedBy = id;
    return { id, p: prog, phase: 'gather', walks, t: 0, u: 0, v: 0, i: 0, q: prog.pickup, cancelling: false, epoch: -1 };
  },
  step(rt, ex, dt): StepResult {
    const p = ex.p;
    if (ex.phase === 'gather') {
      ex.t += dt;
      for (let i = 0; i < ex.walks.length; i++) {
        const w = ex.walks[i];
        if (!w) continue;
        const r = walkTo.step(rt, w, dt);
        if (r.status === 'failed') return { status: 'failed', diagnostic: { ...r.diagnostic, code: 'carry.gather-failed', message: `${p.crew[i]} could not reach the ${p.f.name}: ${r.diagnostic.message}` } };
        if (r.status === 'completed') {
          ex.walks[i] = null;
          const h = rt.world.entities[p.crew[i]].human!;
          h.task = ex.id;
          h.activity = 'idle';
        }
      }
      // arrived carriers turn to face along the load (walk_to's own `face` option is not used: see CARRY.md)
      let aligned = true;
      const face = wrapAngle(p.pickup.th);
      crewOf(rt, ex).forEach((h, i) => {
        if (ex.walks[i]) return;
        const d = angleDelta(h.pose.yaw, face);
        if (Math.abs(d) > 0.02) aligned = false;
        h.pose.yaw = wrapAngle(h.pose.yaw + clamp(d, -TURN_RATE * dt, TURN_RATE * dt));
      });
      if (ex.walks.some((w) => w) || !aligned) {
        if (ex.t > GATHER_TIMEOUT_S) return { status: 'failed', diagnostic: { code: 'carry.gather-stuck', message: `the crew did not assemble around ${p.item} within ${GATHER_TIMEOUT_S} s`, subjects: [p.item, ...p.crew] } };
        return { status: 'running', phase: 'gather' };
      }
      // nobody may stand where the carriers step to grip the load (idle bystanders are asked to move)
      const inWay = bystanderAt(rt, ex, carrierSpots(p.f, p.pickup), null);
      if (inWay) {
        makeWay(rt, inWay, [p.pickup.x, p.pickup.z]);
        return { status: 'blocked', diagnostic: { code: 'carry.pickup-occupied', message: `the crew cannot take up ${p.item}: ${inWay} is standing at a grip position`, subjects: [p.item, inWay], at: [p.pickup.x, p.levelY, p.pickup.z] } };
      }
      // lift: the load leaves the ground, held by exactly the crew
      const item = itemOf(rt, ex);
      item.phase = 'carried';
      item.support = { kind: 'held', by: [...p.crew] };
      crewOf(rt, ex).forEach((h, i) => (h.human!.grip = { entity: p.item, slot: p.f.carriers[i].slot }));
      beginTransition(rt, ex, 'lift', carriedPose(p.f, p.pickup, p.levelY), carrierSpots(p.f, p.pickup), wrapAngle(p.pickup.th), 'stored');
      return { status: 'running', phase: 'lift' };
    }
    if (ex.phase === 'lift') {
      if (stepTransition(rt, ex, dt, LIFT_S)) {
        ex.phase = 'move';
        ex.epoch = (rt.services.spatial as Spatial).epoch;
        for (const h of crewOf(rt, ex)) h.human!.activity = 'carry';
        applyFormation(rt, ex, p.traj.poses[0]);
      }
      return { status: 'running', phase: ex.phase };
    }
    if (ex.phase === 'move') {
      // construction changed the scene? the rest of the validated route must still be clear
      const sp = rt.services.spatial as Spatial;
      sp.sync(rt.world);
      if (sp.epoch !== ex.epoch) {
        const g = sp.level(p.level)!;
        const k = p.traj.poses.findIndex((q, j) => j > ex.i && poseHit(g, p.f, q, 0) >= 0);
        if (k >= 0) {
          // replan the rest of the carry from the current formation pose (construction changed the topology)
          const here = poseAtU(ex, ex.u);
          const r = planCarry({ g, f: p.f, starts: replanStarts(rt, ex, here), goals: [p.target], labelOf: (id) => labelOf(sp, id), carrierNames: p.crew });
          if (r.ok) {
            p.traj = r.traj;
            ex.u = 0;
            ex.i = 0;
            ex.replans = (ex.replans ?? 0) + 1;
            ex.epoch = sp.epoch;
            applyFormation(rt, ex, r.traj.poses[0]);
            return { status: 'running', phase: 'replan' };
          }
          const q = p.traj.poses[k];
          return { status: 'blocked', diagnostic: { code: 'carry.route-blocked', message: `the carry route of ${p.item} is now blocked near (${q.x.toFixed(1)}, ${q.z.toFixed(1)}) and no alternative exists: ${r.diagnostic.message}; the crew holds the load and waits`, subjects: [p.item, ...(r.diagnostic.subjects ?? [])], at: [q.x, p.levelY, q.z] } };
        }
        ex.epoch = sp.epoch;
      }
      const U = p.traj.u[p.traj.u.length - 1];
      // people in the formation's way: halt (never push through), ask idle bystanders to step aside
      // sample the swept footprint from here to 1.2 m ahead (the first primitive may rotate in place)
      const ahead = [0, 0.3, 0.6, 0.9, 1.2].map((d) => pathBystander(rt, ex, Math.min(U, ex.u + d))).find((x) => x) ?? null;
      if (ahead) {
        ex.v = Math.max(0, ex.v - 2 * ACCEL * dt);
        ex.u = Math.min(U, ex.u + ex.v * dt);
        applyFormation(rt, ex, poseAtU(ex, ex.u));
        const c = poseAtU(ex, ex.u);
        makeWay(rt, ahead, [c.x, c.z]);
        // waited long enough: the people in the way are not going anywhere (another crew, a
        // boxed-in bystander) → replan the rest of the carry treating them as soft obstacles
        ex.waited = (ex.waited ?? 0) + 1;
        if (ex.waited > 120 && ex.v < 0.02) {
          ex.waited = 0;
          const others = Object.values(rt.world.entities)
            .filter((o) => o.kind === 'human' && !p.crew.includes(o.id) && o.human?.level === p.level)
            .map((o) => ({ id: o.id, p: [o.pose.p[0], o.pose.p[2]] as Vec2 }));
          const aug = sp.gridsAround(rt.world, others);
          const ga = aug.grids.levels.get(p.level);
          const r = ga ? planCarry({ g: ga, f: p.f, starts: replanStarts(rt, ex, c), goals: [p.target], labelOf: (id) => labelOf(sp, id), carrierNames: p.crew }) : null;
          if (r?.ok) {
            p.traj = r.traj;
            ex.u = 0;
            ex.i = 0;
            ex.replans = (ex.replans ?? 0) + 1;
            applyFormation(rt, ex, r.traj.poses[0]);
            return { status: 'running', phase: 'replan' };
          }
        }
        if (ex.v < 0.02) return { status: 'blocked', diagnostic: { code: 'carry.path-occupied', message: `the crew carrying ${p.item} waits for ${ahead} to move out of its way`, subjects: [p.item, ahead], at: [c.x, p.levelY, c.z] } };
        return { status: 'running', phase: 'move' };
      }
      const vmax = Math.min(CARRY_SPEED, Math.sqrt(2 * ACCEL * Math.max(0, U - ex.u)) + 0.02);
      ex.v = clamp(vmax, ex.v - 2 * ACCEL * dt, ex.v + ACCEL * dt);
      ex.u = Math.min(U, ex.u + ex.v * dt);
      applyFormation(rt, ex, poseAtU(ex, ex.u));
      if (ex.u >= U - 1e-9) {
        applyFormation(rt, ex, p.traj.poses[p.traj.poses.length - 1]);
        // the set-down stations must be free of other people: idle bystanders are asked to step
        // aside (directed work outranks idling); the crew holds the load meanwhile
        const bystander = bystanderAt(rt, ex, p.setdown, entityFrame({ ...itemOf(rt, ex), pose: p.laid }));
        if (bystander) {
          makeWay(rt, bystander, [p.target.x, p.target.z]);
          return { status: 'blocked', diagnostic: { code: 'carry.setdown-occupied', message: `the crew holds ${p.item} at its destination: ${bystander} is standing where it must be set down`, subjects: [p.item, bystander], at: [p.target.x, p.levelY, p.target.z] } };
        }
        beginTransition(rt, ex, 'set-down', p.laid, p.setdown, wrapAngle(p.target.th), 'staged');
      }
      return { status: 'running', phase: ex.phase };
    }
    if (ex.phase === 'set-down') {
      if (stepTransition(rt, ex, dt, SETDOWN_S)) {
        const item = itemOf(rt, ex);
        item.pose = ex.tr!.to;
        item.phase = ex.tr!.final;
        item.support = { kind: 'ground' };
        item.reservedBy = undefined;
        for (const h of crewOf(rt, ex)) { h.human!.grip = undefined; h.human!.activity = 'release'; }
        ex.phase = 'release';
        ex.t = 0;
      }
      return { status: 'running', phase: ex.phase };
    }
    ex.t += dt;
    if (ex.t < RELEASE_S) return { status: 'running', phase: 'release' };
    for (const h of crewOf(rt, ex)) { h.human!.activity = 'idle'; h.human!.task = undefined; }
    const e = itemOf(rt, ex);
    return {
      status: 'completed',
      outputs: {
        replans: ex.replans ?? 0,
        cancelled: ex.cancelling, x: ex.q.x, z: ex.q.z, yaw: e.pose.yaw,
        length: p.traj.length, rotation: p.traj.rotation, reverse: p.traj.reverse, expanded: p.stats.expanded,
      },
    };
  },
  cancel(rt, ex): CancelResult {
    const p = ex.p;
    if (ex.phase === 'gather') {
      ex.walks.forEach((w) => w && walkTo.cancel(rt, w));
      for (const h of crewOf(rt, ex)) { h.human!.activity = 'idle'; h.human!.task = undefined; }
      itemOf(rt, ex).reservedBy = undefined;
      return { ok: true };
    }
    if (ex.phase === 'lift') {
      // lower it back where it lay
      beginTransition(rt, ex, 'set-down', p.lying, p.approach, wrapAngle(p.pickup.th), 'stored');
      ex.cancelling = true;
      return { ok: true, deferred: true };
    }
    if (ex.phase === 'move') {
      const sp = rt.services.spatial as Spatial;
      sp.sync(rt.world);
      const why = laidIssue(sp, p.f, ex.q, p.level, p.levelY, p.item, p.crew);
      if (why)
        return {
          ok: false,
          diagnostic: {
            code: 'carry.cancel-unsafe',
            message: `cannot set the ${p.f.name} ${p.item} down at (${ex.q.x.toFixed(1)}, ${ex.q.z.toFixed(1)}): ${why.reason}; the crew keeps carrying — cancel again where the ground is clear`,
            subjects: [p.item, ...why.subjects],
            at: [ex.q.x, p.levelY, ex.q.z],
          },
        };
      startSetDown(rt, ex, ex.q);
      ex.cancelling = true;
      return { ok: true, deferred: true };
    }
    ex.cancelling = true; // already setting down / releasing
    return { ok: true, deferred: true };
  },
};
