// End-of-tick vehicle invariants (spec §31): record, never correct.
//   vehicle.rider-off          rider and vehicle agree (support ridden-by ↔ human.riding) and a riding
//                              person sits exactly on the vehicle pose
//   vehicle.static-clearance   a ridden vehicle keeps clearance ≥ its radius (kerbs included)
//   route.vehicle-no-link      a ridden vehicle never climbs a link or leaves its level's floor
//   motion.teleport            no vehicle moves more than MAX_STEP_PER_TICK in one tick
//   vehicle.max-speed          no vehicle exceeds its profile's maxSpeed
//   vehicle.close-pass         no vehicle moving faster than PASS_SPEED passes within PASS_GAP of a person
import type { Diagnostic } from '../actions/types.ts';
import { angleDelta, type Vec3, hypot } from '../core/math.ts';
import { clearanceAt, nearestBlocker } from '../spatial/grid.ts';
import type { Spatial } from '../spatial/service.ts';
import { DT, type Invariant, type Runtime } from '../runtime/runtime.ts';
import { MAX_STEP_PER_TICK } from '../runtime/invariants.ts';
import { HUMAN_RADIUS } from '../world/catalog.ts';
import type { Entity, WorldState } from '../world/types.ts';
import { vehicleProfile } from './profiles.ts';
import { vehicleGrids } from './curve.ts';
import { PASS_GAP, PASS_SPEED } from './actions.ts';

const TOL = 0.03;
const POSE_TOL = 0.01;

const riderOfVehicle = (w: WorldState, v: Entity) => (v.support?.kind === 'ridden-by' ? w.entities[v.support.by] : undefined);

export const vehicleRider: Invariant = (rt: Runtime) => {
  const out: Diagnostic[] = [];
  const ents = rt.world.entities;
  for (const e of Object.values(ents)) {
    if (e.kind === 'vehicle' && e.support?.kind === 'ridden-by') {
      const h = ents[e.support.by];
      const pr = vehicleProfile(e.def);
      if (!h?.human || h.human.riding !== e.id)
        out.push({ code: 'vehicle.rider-off', message: `${e.id} is marked ridden by ${e.support.by}, who is not riding it (riding ${h?.human?.riding ?? 'nothing'})`, subjects: [e.id, e.support.by], at: e.pose.p });
      else if (h.human.activity === 'ride' && pr) {
        const d = hypot(h.pose.p[0] - e.pose.p[0], h.pose.p[2] - e.pose.p[2]);
        const dy = h.pose.p[1] - (e.pose.p[1] + pr.riderY);
        const dyaw = Math.abs(angleDelta(e.pose.yaw, h.pose.yaw));
        if (d > POSE_TOL || Math.abs(dy) > POSE_TOL || dyaw > POSE_TOL)
          out.push({ code: 'vehicle.rider-off', message: `${h.id} rides ${e.id} but is ${d.toFixed(3)} m / ${dy.toFixed(3)} m high / ${dyaw.toFixed(3)} rad off its pose`, subjects: [e.id, h.id], at: h.pose.p });
      }
    }
    if (e.human?.riding) {
      const v = ents[e.human.riding];
      if (!v || v.support?.kind !== 'ridden-by' || v.support.by !== e.id)
        out.push({ code: 'vehicle.rider-off', message: `${e.id} is riding ${e.human.riding}, which is not marked ridden by them`, subjects: [e.id, e.human.riding], at: e.pose.p });
    }
  }
  return out;
};

export const vehicleClearance: Invariant = (rt: Runtime) => {
  const out: Diagnostic[] = [];
  let sp: Spatial | undefined;
  for (const e of Object.values(rt.world.entities)) {
    if (e.kind !== 'vehicle') continue;
    const h = riderOfVehicle(rt.world, e);
    const pr = vehicleProfile(e.def);
    if (!h?.human || !pr) continue; // parked: it is itself a static obstacle
    if (h.human.activity.startsWith('climb')) {
      out.push({ code: 'route.vehicle-no-link', message: `${h.id} is ${h.human.activity} while riding ${e.id}: vehicles never use links`, subjects: [e.id, h.id], at: e.pose.p });
      continue;
    }
    sp ??= rt.services.spatial as Spatial;
    const g = vehicleGrids(sp, rt.world, pr, h.human.level).grids.levels.get(h.human.level);
    if (!g) continue;
    if (Math.abs(e.pose.p[1] - g.y) > 0.05) {
      out.push({ code: 'route.vehicle-no-link', message: `${e.id} is at height ${e.pose.p[1].toFixed(2)} m, off its level ${h.human.level} floor (${g.y} m)`, subjects: [e.id, h.id], at: e.pose.p });
      continue;
    }
    const p: [number, number] = [e.pose.p[0], e.pose.p[2]];
    const c = clearanceAt(g, p);
    if (c < pr.radius - TOL)
      out.push({ code: 'vehicle.static-clearance', message: `${e.id} (${pr.id}, radius ${pr.radius} m) overlaps static geometry: clearance ${c.toFixed(2)} m near ${nearestBlocker(g, p) ?? 'the floor edge'} at (${p[0].toFixed(2)}, ${p[1].toFixed(2)})`, subjects: [e.id, h.id], at: e.pose.p });
  }
  return out;
};

const lastPoses = new WeakMap<Runtime, { tick: number; world: WorldState; poses: Map<string, Vec3> }>();

export const vehicleMotion: Invariant = (rt: Runtime) => {
  const prev = lastPoses.get(rt);
  const valid = !!prev && prev.world === rt.world && prev.tick === rt.tick - 1;
  const poses = new Map<string, Vec3>();
  const out: Diagnostic[] = [];
  const ents = Object.values(rt.world.entities);
  for (const e of ents) {
    if (e.kind !== 'vehicle') continue;
    const pr = vehicleProfile(e.def);
    const cur: Vec3 = [e.pose.p[0], e.pose.p[1], e.pose.p[2]];
    poses.set(e.id, cur);
    const q = valid ? prev!.poses.get(e.id) : undefined;
    if (!q || !pr) continue;
    const step = hypot(cur[0] - q[0], cur[1] - q[1], cur[2] - q[2]);
    const speed = step / DT;
    if (step > MAX_STEP_PER_TICK)
      out.push({ code: 'motion.teleport', message: `${e.id} moved ${step.toFixed(2)} m in one tick (max ${MAX_STEP_PER_TICK} m)`, subjects: [e.id], at: e.pose.p });
    if (speed > pr.maxSpeed + 0.01)
      out.push({ code: 'vehicle.max-speed', message: `${e.id} moved at ${speed.toFixed(2)} m/s, above the ${pr.id} limit ${pr.maxSpeed} m/s`, subjects: [e.id], at: e.pose.p });
    if (speed <= PASS_SPEED + 1e-6) continue;
    const rider = riderOfVehicle(rt.world, e);
    const level = rider?.human?.level ?? 0;
    for (const o of ents) {
      if (!o.human || o.id === rider?.id || o.human.level !== level || Math.abs(o.pose.p[1] - e.pose.p[1]) > 1.2) continue;
      const gap = hypot(o.pose.p[0] - cur[0], o.pose.p[2] - cur[2]) - pr.radius - HUMAN_RADIUS;
      if (gap < PASS_GAP - 1e-6)
        out.push({ code: 'vehicle.close-pass', message: `${e.id} passed ${o.id} ${Math.max(0, gap).toFixed(2)} m apart at ${speed.toFixed(2)} m/s (at most ${PASS_SPEED} m/s within ${PASS_GAP} m of a person)`, subjects: [e.id, o.id], at: e.pose.p });
    }
  }
  lastPoses.set(rt, { tick: rt.tick, world: rt.world, poses });
  return out;
};

export const VEHICLE_INVARIANTS: Invariant[] = [vehicleRider, vehicleClearance, vehicleMotion];
