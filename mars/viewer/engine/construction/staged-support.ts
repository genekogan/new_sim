// Staging is a physical precondition, not merely a distance from the installation target.
import { obbCorners, obbOverlap, hypot, type Vec2 } from '../core/math.ts';
import type { Runtime } from '../runtime/runtime.ts';
import type { Entity } from '../world/types.ts';
import { entityFootprint, type Spatial } from '../spatial/service.ts';
import { HUMAN_PROFILE, type Surface } from '../spatial/types.ts';
import { BODY_MODEL } from '../body/model.ts';

const EPS = 1e-7; // geometric round-off only (metres)
function area(p: Vec2[]): number {
  if (p.length < 3) return 0;
  let sum = 0;
  for (let i = 1; i + 1 < p.length; i++)
    sum += (p[i][0] - p[0][0]) * (p[i + 1][1] - p[0][1]) - (p[i][1] - p[0][1]) * (p[i + 1][0] - p[0][0]);
  return Math.abs(sum) / 2;
}
/** Convex polygon clipped to one signed half-plane; interpolated intersections are exact. */
function clip(p: Vec2[], distance: (v: Vec2) => number, inside: boolean): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length], da = distance(a), db = distance(b);
    const aa = inside ? da >= 0 : da <= 0, bb = inside ? db >= 0 : db <= 0;
    if (aa) out.push(a);
    if (aa !== bb) {
      const t = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}
/** Difference from a convex rectangle, partitioned into disjoint convex pieces. */
function subtract(p: Vec2[], surface: Surface): Vec2[][] {
  const corners = obbCorners(surface.obb), out: Vec2[][] = [];
  let remainder = p;
  for (let i = 0; i < corners.length && remainder.length; i++) {
    const a = corners[i], b = corners[(i + 1) % corners.length], dx = b[0] - a[0], dz = b[1] - a[1];
    const d = (v: Vec2) => dx * (v[1] - a[1]) - dz * (v[0] - a[0]) + EPS * hypot(dx, dz);
    const outside = clip(remainder, d, false);
    if (area(outside) > 1e-12) out.push(outside);
    remainder = clip(remainder, d, true);
  }
  return out;
}

/** Standing collision cylinder enclosed by a box; prone/rising and explicit hands add coverage. */
function personFootprint(e: Entity) {
  const h = e.human!;
  const prone = h.proneYaw !== undefined || /prone|lie-down|push-up|kneel-up/.test(h.activity);
  const r = prone ? BODY_MODEL.prone.posture.prone.lean + BODY_MODEL.shoulderHalf + BODY_MODEL.armLength : HUMAN_PROFILE.radius;
  const min = [e.pose.p[0] - r, e.pose.p[1] - (prone ? BODY_MODEL.prone.reachDown : 0), e.pose.p[2] - r];
  const max = [e.pose.p[0] + r, e.pose.p[1] + HUMAN_PROFILE.height, e.pose.p[2] + r];
  for (const hand of Object.values(h.hands ?? {})) if (hand) for (let k = 0; k < 3; k++) {
    min[k] = Math.min(min[k], hand[k] - BODY_MODEL.prone.head.r);
    max[k] = Math.max(max[k], hand[k] + BODY_MODEL.prone.head.r);
  }
  return { obb: { c: [(min[0] + max[0]) / 2, (min[2] + max[2]) / 2] as Vec2,
    half: [(max[0] - min[0]) / 2, (max[2] - min[2]) / 2] as Vec2, yaw: 0 }, y0: min[1], y1: max[1] };
}

export function stagedSupportIssue(rt: Runtime, item: Entity): { reason: string; subjects: string[] } | null {
  const sp = rt.services.spatial as Spatial;
  sp.sync(rt.world);
  const fp = entityFootprint(item);
  const surfaces = sp.scene.surfaces.filter((s) => Math.abs(s.y - fp.y0) <= EPS && obbOverlap(s.obb, fp.obb));
  let uncovered = [obbCorners(fp.obb)];
  for (const s of surfaces) {
    uncovered = uncovered.flatMap((p) => subtract(p, s));
    if (!uncovered.length) break;
    if (uncovered.length > 256) return { reason: 'floor coverage is too fragmented to certify safely', subjects: [] };
  }
  if (uncovered.some((p) => area(p) > 1e-10))
    return { reason: 'its full footprint is not supported by a continuous floor at its bottom height', subjects: [] };
  const dynamic = Object.values(rt.world.entities).filter((e) => e.id !== item.id && (e.phase === 'carried' || e.phase === 'raising' || e.kind === 'vehicle' || e.kind === 'human'));
  const obstacles = [...sp.scene.obstacles, ...dynamic.map((e) => ({ id: e.id, ...(e.kind === 'human' ? personFootprint(e) : entityFootprint(e)) }))];
  const hit = obstacles.find((o) => o.id !== item.id && o.y1 > fp.y0 + EPS && o.y0 < fp.y1 - EPS && obbOverlap(fp.obb, o.obb, -EPS));
  return hit ? { reason: `its staged footprint intersects ${hit.id}`, subjects: [hit.id] } : null;
}
