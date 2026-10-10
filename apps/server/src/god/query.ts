// Diagnostics for builders (spec 33 §2 row 10): terrain samples, entity bounds, free-plot search,
// clearance at a pose. Pure functions over the WorldModel; `reach` asks the Soul engine through the bridge (L9).
// Owner: L1 (contract); L7 extends (solver helpers), L9 adds `reach`.
import { mediumAt, waterDepthAt } from '@sim/ground';
import { obbOverlap, type OBB, WorldModel } from '@sim/world-compiler';

/** A reach end: a point [x, z] (ground) or [x, y, z], an entity id/path (a Soul's body, a chair…), or `<path>:<room>`. */
export type ReachEnd = string | [number, number] | [number, number, number];
export type ReachFn = (from: ReachEnd, to: ReachEnd) => unknown;
/** Reachability needs the Soul engine; the engine bridge (engine-bridge.ts, lane L9) registers it per world model. */
export const reachProviders = new WeakMap<WorldModel, ReachFn>();

export type QueryInput = {
  points?: [number, number][];
  entity?: string;
  free?: { size: [number, number]; near?: [number, number]; radius?: number; maxSlope?: number; avoidWater?: boolean; count?: number };
  clearance?: { at: [number, number]; size: [number, number]; yaw?: number };
  reach?: { from: ReachEnd; to: ReachEnd };
};

export function runQuery(w: WorldModel, q: QueryInput) {
  const out: Record<string, unknown> = {};
  if (q.points) {
    out.points = q.points.slice(0, 256).map(([x, z]) => ({ x, z, y: round(w.terrain.sample(x, z)), slope: round(w.terrain.slope(x, z)), slopeDeg: round((Math.atan(w.terrain.slope(x, z)) * 180) / Math.PI), water: round(waterDepthAt(w.terrain, x, z)), medium: mediumAt(w.terrain, x, z) }));
  }
  if (q.entity) {
    const e = w.get(q.entity);
    if (!e) out.entity = { error: `no such entity ${q.entity}` };
    else {
      const def = w.resolvedDef(e.def)!;
      const baked = w.bake(def, e.params ?? {}, e.seed ?? 0, e.shape);
      const pose = w.worldPose(e);
      const fp = w.footprint(e, def);
      const bb = aabbOf(fp.length ? fp : [{ c: [pose.x, pose.z], half: [baked.box[0] * pose.s / 2, baked.box[2] * pose.s / 2], yaw: pose.yaw, y0: pose.y, y1: pose.y + baked.box[1] * pose.s }]);
      out.entity = {
        id: e.id, path: w.pathOf(e.id), def: e.def, pose: { x: round(pose.x), y: round(pose.y), z: round(pose.z), yaw: round(pose.yaw), s: pose.s },
        box: baked.box, bounds: bb, colliders: fp.length,
        rooms: baked.rooms?.map((r) => ({ id: r.id, name: r.name, floor: r.floor })) ?? [],
        openings: baked.openings?.map((o) => ({ id: o.id, kind: o.kind, level: o.level, state: o.state })) ?? [],
        links: baked.links?.map((l) => ({ id: l.id, kind: l.kind, from: l.from, to: l.to })) ?? [],
        slots: baked.slots.map((s) => ({ id: s.id, kind: s.kind, capacity: s.capacity, used: [...(w.children.get(e.id) ?? [])].filter((c) => w.entities.get(c)?.in.slot === s.id).length })),
        children: [...(w.children.get(e.id) ?? [])].map((c) => w.pathOf(c)),
        constraints: e.constraints ?? [],
        notes: baked.notes ?? [],
      };
    }
  }
  if (q.free) out.free = findFree(w, q.free);
  if (q.clearance) {
    const { at, size, yaw = 0 } = q.clearance;
    const box: OBB = { c: at, half: [size[0] / 2, size[1] / 2], yaw, y0: w.terrain.sample(at[0], at[1]), y1: w.terrain.sample(at[0], at[1]) + 2 };
    const hits = [...w.near([box])].filter((id) => w.footprintsOf(id).some((b) => obbOverlap(box, b))).map((id) => w.pathOf(id));
    out.clearance = { clear: hits.length === 0, blockedBy: hits };
  }
  if (q.reach) {
    const fn = reachProviders.get(w);
    out.reach = fn ? fn(q.reach.from, q.reach.to) : { supported: false, note: 'reachability needs the Soul engine (this world runs without it)' };
  }
  return out;
}

function findFree(w: WorldModel, f: NonNullable<QueryInput['free']>) {
  const [sw, sd] = f.size, maxSlope = f.maxSlope ?? 0.25, half = w.constants.extent / 2 - Math.max(sw, sd);
  const centre = f.near ?? [0, 0], radius = Math.min(f.radius ?? 120, half * 2), want = Math.min(f.count ?? 3, 12);
  const found: { at: [number, number]; y: number; slope: number; dist: number }[] = [];
  // spiral search on a 2 m lattice, nearest first
  const step = 2, rings = Math.ceil(radius / step);
  for (let r = 0; r <= rings && found.length < want; r++) {
    for (let k = -r; k <= r && found.length < want; k++) for (const [dx, dz] of r === 0 ? [[0, 0]] : [[k, -r], [k, r], [-r, k], [r, k]]) {
      if (found.length >= want) break;
      const x = centre[0] + dx * step, z = centre[1] + dz * step;
      if (Math.abs(x) > half || Math.abs(z) > half) continue;
      const corners: [number, number][] = [[x - sw / 2, z - sd / 2], [x + sw / 2, z - sd / 2], [x + sw / 2, z + sd / 2], [x - sw / 2, z + sd / 2], [x, z]];
      const ys = corners.map(([a, c]) => w.terrain.sample(a, c));
      const slope = (Math.max(...ys) - Math.min(...ys)) / Math.max(sw, sd);
      if (slope > maxSlope) continue;
      if ((f.avoidWater ?? true) && corners.some(([a, c]) => waterDepthAt(w.terrain, a, c) > 0)) continue;
      const box: OBB = { c: [x, z], half: [sw / 2 + 0.5, sd / 2 + 0.5], yaw: 0, y0: Math.min(...ys), y1: Math.max(...ys) + 3 };
      if ([...w.near([box])].some((id) => w.footprintsOf(id).some((b) => obbOverlap(box, b)))) continue;
      if (found.some((p) => Math.abs(p.at[0] - x) < sw && Math.abs(p.at[1] - z) < sd)) continue;
      found.push({ at: [x, z], y: round(ys[4]), slope: round(slope), dist: round(Math.hypot(x - centre[0], z - centre[1])) });
    }
  }
  return found;
}

function aabbOf(boxes: OBB[]) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const o of boxes) { const c = Math.abs(Math.cos(o.yaw)), s = Math.abs(Math.sin(o.yaw)); const hx = o.half[0] * c + o.half[1] * s, hz = o.half[0] * s + o.half[1] * c; x0 = Math.min(x0, o.c[0] - hx); x1 = Math.max(x1, o.c[0] + hx); z0 = Math.min(z0, o.c[1] - hz); z1 = Math.max(z1, o.c[1] + hz); y0 = Math.min(y0, o.y0); y1 = Math.max(y1, o.y1); }
  return { min: [round(x0), round(y0), round(z0)], max: [round(x1), round(y1), round(z1)] };
}
const round = (v: number) => Math.round(v * 100) / 100;
