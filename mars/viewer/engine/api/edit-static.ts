import { obbCorners, obbOverlap, pointInObb } from '../core/math.ts';
import { entityFootprint, type Spatial } from '../spatial/service.ts';
import type { Obstacle } from '../spatial/types.ts';
import { HUMAN_RADIUS } from '../world/catalog.ts';
import type { WorldState } from '../world/types.ts';
import type { WorldEdit } from './edit.ts';

type StaticEdit = Extract<WorldEdit, { op: 'static_add' | 'static_update' | 'static_remove' }>;
type Issue = { code: string; message: string; subjects: string[] };

/** Validate against the progressively edited scene, then write only the fork's override. */
export function editStatic(w: WorldState, sp: Spatial, edit: StaticEdit): Issue | null {
  const fail = (code: string, message: string, ...subjects: string[]): Issue => ({ code, message, subjects: [edit.id, ...subjects] });
  const old = sp.base.obstacles.find((o) => o.id === edit.id);
  if (edit.op === 'static_add' && (old || w.entities[edit.id] || sp.base.surfaces.some((s) => s.id === edit.id) || sp.base.links.some((l) => l.id === edit.id)))
    return fail('edit.id-taken', `static id ${edit.id} already exists`);
  if (edit.op !== 'static_add' && !old) return fail('edit.static-unknown', `no static obstacle ${edit.id}; query_world include obstacles lists the available ids`);
  if (!Object.hasOwn(w.obstacleEdits ?? {}, edit.id) && Object.keys(w.obstacleEdits ?? {}).length >= 256)
    return fail('edit.static-limit', 'a workspace may override at most 256 static obstacles');
  // Static geometry has no assembly graph. Refuse edits at a support interface rather than
  // removing a post/slab and leaving an unchanged surface or another solid floating.
  if (old) {
    const dependent = Object.values(w.entities).find((e) => e.support?.kind === 'resting-on' && e.support.on === old.id);
    if (dependent) return fail('edit.static-support', `${dependent.id} rests on ${edit.id}; move it first`, dependent.id);
    const resting = Object.values(w.entities).find((e) => {
      if (e.kind === 'marker') return false;
      const fp = entityFootprint(e);
      return Math.abs(fp.y0 - old.y1) < 0.05 && obbOverlap(fp.obb, old.obb);
    });
    if (resting) return fail('edit.static-support', `${edit.id} supports entity ${resting.id}; move it first`, resting.id);
    const surface = sp.base.surfaces.find((s) => Math.abs(s.y - old.y1) < 0.05 && obbOverlap(s.obb, old.obb));
    if (surface) return fail('edit.static-support', `${edit.id} supports surface ${surface.id}; editing supporting geometry requires an assembly edit`, surface.id);
    const above = sp.base.obstacles.find((o) => o.id !== old.id && Math.abs(o.y0 - old.y1) < 0.05 && obbOverlap(o.obb, old.obb));
    if (above) return fail('edit.static-support', `${edit.id} supports ${above.id}; edit the dependent geometry first`, above.id);
    const link = sp.base.links.find((l) => l.members?.includes(old.id));
    if (link) return fail('edit.static-support', `${edit.id} belongs to traversal link ${link.id}`, link.id);
  }
  let next: Obstacle | null = null;
  if (edit.op !== 'static_remove') {
    const { op: _op, ...obstacle } = edit;
    next = obstacle;
    if (next.y1 <= next.y0) return fail('edit.static-invalid', 'the obstacle top y1 must exceed its bottom y0');
    const corners = obbCorners(next.obb);
    const [x0, z0, x1, z1] = sp.base.bounds;
    if (corners.some(([x, z]) => x < x0 || x > x1 || z < z0 || z > z1))
      return fail('edit.off-floor', `${edit.id} leaves the scene bounds`);
    const floors = sp.base.surfaces.filter((s) => Math.abs(s.y - next!.y0) < 1e-6);
    // One convex surface must cover the entire footprint. Corners on disconnected
    // patches are not proof of support across the gap between them.
    if (!floors.some((s) => corners.every((p) => pointInObb(p, s.obb, 1e-6))))
      return fail('edit.unsupported', `${edit.id} must rest fully on an existing surface at y ${next.y0}`);
    for (const e of Object.values(w.entities)) {
      if (e.kind === 'marker') continue;
      if (e.human) {
        if (next.y1 > e.pose.p[1] && next.y0 < e.pose.p[1] + 1.9 && pointInObb([e.pose.p[0], e.pose.p[2]], next.obb, HUMAN_RADIUS))
          return fail('edit.blocked', `${edit.id} would overlap person ${e.id}`, e.id);
      } else {
        const fp = entityFootprint(e);
        if (next.y1 > fp.y0 + 1e-3 && next.y0 < fp.y1 - 1e-3 && obbOverlap(next.obb, fp.obb))
          return fail('edit.blocked', `${edit.id} would overlap ${e.id}`, e.id);
      }
    }
    const other = sp.base.obstacles.find((o) => o.id !== edit.id && next!.y1 > o.y0 + 1e-3 && next!.y0 < o.y1 - 1e-3 && obbOverlap(next!.obb, o.obb));
    if (other) return fail('edit.blocked', `${edit.id} would overlap static obstacle ${other.id}`, other.id);
  }
  w.obstacleEdits ??= {};
  w.obstacleEdits[edit.id] = next;
  return null;
}
