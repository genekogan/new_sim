// Controlled reversal of the actual raise choreography, starting at pickup (never at muster).
import type { Diagnostic } from '../actions/types.ts';
import type { Runtime } from '../runtime/runtime.ts';
import type { Entity, Pose } from '../world/types.ts';
import { obbCorners, obbOverlap, pointInObb, hypot } from '../core/math.ts';
import { HUMAN_RADIUS } from '../world/catalog.ts';
import { entityFootprint, type Spatial } from '../spatial/service.ts';
import { lerpPose, sweepPoses } from './access.ts';

// The 19ft maximum needs <400 moving ticks: H/0.6 + 5s rotation + 2.3/0.6s step-around,
// at DT=1/20, plus phase boundaries. No blocked ticks are stored. Overflow refuses, never truncates.
export const RAISE_REVERSE_LIMIT = 1024;
type Grip = NonNullable<Entity['human']>['grip'];
export type RaiseFrame = { pose: Pose; crew: { id: string; pose: Pose; grip: Grip }[] };
export type RaiseTrail = { frames: RaiseFrame[]; overflow: boolean };
export function raiseFrame(rt: Runtime, item: string, crew: string[]): RaiseFrame {
  return { pose: structuredClone(rt.world.entities[item].pose), crew: crew.map((id) => ({ id, pose: structuredClone(rt.world.entities[id].pose), grip: structuredClone(rt.world.entities[id].human!.grip) })) };
}
export function recordRaise(trail: RaiseTrail, frame: RaiseFrame) {
  if (trail.overflow) return;
  const last = trail.frames.at(-1);
  if (last && JSON.stringify(last) === JSON.stringify(frame)) return;
  if (trail.frames.length === RAISE_REVERSE_LIMIT) { trail.overflow = true; return; }
  trail.frames.push(frame);
}

/** Current geometry and people, including the frame's landing footprint and every holder path. */
export function loweringIssue(rt: Runtime, item: string, from: RaiseFrame, to: RaiseFrame, groundY: number): Diagnostic | null {
  const u = rt.world.entities[item], sp = rt.services.spatial as Spatial;
  sp.sync(rt.world);
  const refuse = (message: string, subjects: string[]): Diagnostic => ({ code: 'raise.cancel-unsafe', message: `${item} cannot be lowered: ${message}`, subjects: [item, ...subjects] });
  const hit = sweepPoses(rt, u, [from.pose, to.pose], []);
  if (hit) return refuse(`its reverse sweep intersects ${hit.o.label ?? hit.o.id}`, [hit.o.id]);
  // Navigation omits carried parts and some vehicle states. Physical lowering must still
  // see their current envelopes; rebuild these on every preflight/step so motion is observed.
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
    if (load) return refuse(`its reverse sweep intersects moving body ${load.id}`, [load.id]);
    if (Math.abs((pose.pitch ?? 0) - Math.PI / 2) < 1e-6) {
      const corners = obbCorners(fp.obb);
      if (!sp.scene.surfaces.some((s) => Math.abs(s.y - groundY) < 0.05 && corners.every((p) => pointInObb(p, s.obb, 1e-6))))
        return refuse('the lying footprint no longer has continuous floor support', []);
    }
    for (const person of bystanders) {
      if (person.pose.p[1] + 1.9 > fp.y0 && person.pose.p[1] < fp.y1 && pointInObb([person.pose.p[0], person.pose.p[2]], fp.obb, HUMAN_RADIUS))
        return refuse(`the descending frame would hit ${person.id}`, [person.id]);
    }
    for (let i = 0; i < to.crew.length; i++) {
      const next = to.crew[i], q = lerpPose(from.crew[i].pose, next.pose, t);
      const p: [number, number] = [q.p[0], q.p[2]];
      if (!sp.scene.surfaces.some((s) => Math.abs(s.y - q.p[1]) < 0.05 && pointInObb(p, s.obb, -HUMAN_RADIUS)))
        return refuse(`${next.id}'s reverse path has no floor support`, [next.id]);
      const body = { c: p, half: [HUMAN_RADIUS, HUMAN_RADIUS] as [number, number], yaw: 0 };
      const obstruction = bodies.find((o) => o.id !== item && o.y1 > q.p[1] + 0.02 && o.y0 < q.p[1] + 1.9 && obbOverlap(body, o.obb));
      if (obstruction) return refuse(`${next.id}'s reverse path meets ${obstruction.id}`, [next.id, obstruction.id]);
      const person = bystanders.find((e) => Math.abs(e.pose.p[1] - q.p[1]) < 1 && hypot(e.pose.p[0] - p[0], e.pose.p[2] - p[1]) < 2 * HUMAN_RADIUS + 0.08);
      if (person) return refuse(`${next.id}'s reverse path meets ${person.id}`, [next.id, person.id]);
    }
  }
  return null;
}

export function putRaiseFrame(rt: Runtime, item: string, frame: RaiseFrame) {
  rt.world.entities[item].pose = structuredClone(frame.pose);
  for (const saved of frame.crew) {
    const actor = rt.world.entities[saved.id];
    actor.pose = structuredClone(saved.pose);
    // Keep current action/task ownership and live support; only retrace physical choreography.
    actor.human!.grip = structuredClone(saved.grip);
  }
}
