// Fragile loads (owner feedback 2026-09-28 §9): a solar panel is carried by two people and never
// tilted past its catalog `handling.fragile.maxTilt` (30°) from level, and never dropped. Plan time:
// a fragile carry between levels would follow a stair flight's slope — refused when the flight is steeper
// than maxTilt (`carry.fragile-tilt`, naming the flight and the angle). Every tick: a fragile load held
// by people tilted past maxTilt is `carry.fragile-tilt`; one left with no support is `carry.fragile-dropped`.
import { dacos, datan2, dcos, type Vec3 } from '../core/math.ts';
import type { Diagnostic } from '../actions/types.ts';
import type { Invariant, Runtime } from '../runtime/runtime.ts';
import type { Spatial } from '../spatial/service.ts';
import type { Link } from '../spatial/types.ts';
import { HUMAN_PROFILE } from '../spatial/types.ts';
import type { Entity, Pose } from '../world/types.ts';
import { def } from '../world/catalog.ts';
import { relevantEntities } from '../world/relevant.ts';

const DEG = 180 / Math.PI;
export const maxTiltOf = (defId: string): number | null => def(defId).handling?.fragile?.maxTilt ?? null;

/** Tilt of a pose from level (rad): the angle between its local up axis and world up (roll about Z, then pitch about X). */
export const tiltOf = (q: Pose): number => dacos(Math.max(-1, Math.min(1, dcos(q.pitch ?? 0) * dcos(q.roll ?? 0))));

/** Slope of a stair flight (rad): its tread-centre polyline, first → last point. */
export function flightTilt(l: Link): number {
  const a: Vec3 = l.path[0], b: Vec3 = l.path[l.path.length - 1];
  const run = Math.sqrt((b[0] - a[0]) ** 2 + (b[2] - a[2]) ** 2);
  return datan2(Math.abs(b[1] - a[1]), run);
}

/**
 * A fragile load carried from `level` to `toLevel` goes up / down a flight tilted along its slope
 * (carry/climb.ts): refused when that slope exceeds the load's maxTilt. null = not fragile / no level change / fine.
 */
export function fragileFlightCheck(rt: Runtime, item: Entity, carrier: Entity, level: number, to: { x: number; z: number; level?: number }, via?: string): Diagnostic | null {
  const max = maxTiltOf(item.def);
  const toLevel = to.level ?? level;
  if (max === null || toLevel === level) return null;
  const sp = rt.services.spatial as Spatial;
  sp.sync(rt.world);
  let link: Link | undefined;
  if (via) link = sp.scene.links.find((l) => l.id === via);
  else {
    const r = sp.route(rt.world, HUMAN_PROFILE, { level, p: [carrier.pose.p[0], carrier.pose.p[2]] }, { level: toLevel, p: [to.x, to.z] }, { goalTolerance: 1.0 });
    if (!r.ok) return null; // the carry's own planning reports the missing route
    link = r.route.legs.find((l) => l.kind === 'link')?.link;
  }
  if (!link) return null;
  const tilt = flightTilt(link);
  if (tilt <= max + 1e-9) return null;
  return {
    code: 'carry.fragile-tilt',
    message: `${def(item.def).label} ${item.id} is fragile (never tilted past ${(max * DEG).toFixed(0)}°): carried up ${link.kind} ${link.id} it would tilt ${(tilt * DEG).toFixed(1)}° with the flight; hand it up (hand_up) or use the forklift`,
    subjects: [item.id, link.id],
    details: { tiltDeg: tilt * DEG, maxTiltDeg: max * DEG },
  };
}

export const fragileLoadsOk: Invariant = (rt) => {
  const out: Diagnostic[] = [];
  for (const e of relevantEntities(rt.world)) {   // components only (world/relevant.ts)
    if (e.kind !== 'component') continue;
    const max = maxTiltOf(e.def);
    if (max === null) continue;
    if (e.support?.kind === 'none')
      out.push({ code: 'carry.fragile-dropped', message: `${def(e.def).label} ${e.id} is fragile and has no support (dropped)`, subjects: [e.id], at: e.pose.p });
    else if (e.phase === 'carried' && e.support?.kind === 'held') {
      const t = tiltOf(e.pose);
      if (t > max + 1e-6)
        out.push({ code: 'carry.fragile-tilt', message: `${def(e.def).label} ${e.id} is tilted ${(t * DEG).toFixed(1)}° while held by ${e.support.by.join(', ')} (fragile: max ${(max * DEG).toFixed(0)}°)`, subjects: [e.id, ...e.support.by], at: e.pose.p });
    }
  }
  return out;
};
