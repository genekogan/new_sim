// Exterior entrance safety uses the generator's room/door/stair graph and the same yaw boxes
// indexed for overlap/engine navigation. No engine or server is needed for a local dry run.
import { CREATION_LIMITS as L, pointInPoly, reachableFromOutside, type Baked, type Opening, type Vec2 } from '@sim/generators';
import { type WorldModel, type OBB } from './model.ts';
import type { Entity, Failure } from './schemas.ts';

const EPS = 1e-7;
type Sealed = { room: string; openings: string[] };

/** Clip a convex polygon to the resident-centre corridor. */
function clip(poly: Vec2[], half: number, depth: number): Vec2[] {
  for (const [axis, bound, sign] of [[0, -half, 1], [0, half, -1], [1, 0, 1], [1, depth, -1]]) {
    const out: Vec2[] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length], da = (a[axis] - bound) * sign, db = (b[axis] - bound) * sign;
      if (da >= -EPS) out.push(a);
      if ((da < -EPS) !== (db < -EPS)) { const t = da / (da - db); out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]); }
    }
    poly = out;
  }
  return poly;
}

/** Closed convex polygons intersect (touching obstacles leave no body clearance). */
function touches(a: Vec2[], b: Vec2[]): boolean {
  for (const p of [a, b]) for (let i = 0; i < p.length; i++) {
    const u = p[i], v = p[(i + 1) % p.length], dx = v[1] - u[1], dz = u[0] - v[0];
    const pa = a.map(([x, z]) => x * dx + z * dz), pb = b.map(([x, z]) => x * dx + z * dz);
    if (Math.max(...pa) < Math.min(...pb) - EPS || Math.max(...pb) < Math.min(...pa) - EPS) return false;
  }
  return true;
}

function blocked(w: WorldModel, e: Entity, baked: Baked, door: Opening, surfaces: Map<string, OBB[]>): boolean {
  const wp = w.worldPose(e), c = Math.cos(wp.yaw), s = Math.sin(wp.yaw), yaw = wp.yaw + door.yaw;
  const at: Vec2 = [wp.x + (door.at[0] * c + door.at[1] * s) * wp.s, wp.z + (-door.at[0] * s + door.at[1] * c) * wp.s];
  const radius = L.bodyWidthM / 2, half = Math.max(EPS, door.width * wp.s / 2 - radius), depth = L.sealApproachDepthM;
  const room = baked.rooms?.find(r => r.id === door.from && r.floor === door.level);
  const y = wp.y + ((room?.y ?? baked.rooms?.find(r => r.floor === door.level)?.y ?? 0) + (door.sill ?? 0)) * wp.s;
  const corridor: OBB = { c: [at[0] + Math.sin(yaw) * depth / 2, at[1] + Math.cos(yaw) * depth / 2],
    half: [half + radius * 2, depth / 2 + radius * 2], yaw, y0: y + 0.15, y1: y + L.bodyHeightM };
  const polys: Vec2[][] = [];
  // Surface generators can carry solid rails/posts too (the engine bridge collides with them),
  // although the compiler's placement-overlap hash indexes only the solid layer.
  for (const id of new Set([...w.near([corridor]), ...surfaces.keys()])) {
    if (id === e.id) continue; // the building's own split walls and lintels are already design-checked
    const other = w.entities.get(id);
    if (other && w.resolvedDef(other.def)?.components.body) continue; // residents are transient, not construction
    for (const b of surfaces.get(id) ?? w.footprintsOf(id)) {
      if (b.y1 <= corridor.y0 || b.y0 >= corridor.y1) continue;
      const bc = Math.cos(b.yaw), bs = Math.sin(b.yaw), dc = Math.cos(yaw), ds = Math.sin(yaw);
      // Expand each obstacle by the resident radius, retaining its orientation. This is a conservative
      // square-body clearance, matching the yaw-box representation used by the compiler.
      const poly: Vec2[] = [];
      for (const [i, j] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const x = b.c[0] + i * (b.half[0] + radius) * bc + j * (b.half[1] + radius) * bs - at[0];
        const z = b.c[1] - i * (b.half[0] + radius) * bs + j * (b.half[1] + radius) * bc - at[1];
        poly.push([x * dc - z * ds, x * ds + z * dc]);
      }
      const clipped = clip(poly, half, depth);
      if (clipped.length) polys.push(clipped);
    }
  }
  // A connected obstacle barrier from the corridor's left side to its right side seals it.
  // Unlike projecting all obstacles onto the door width, this allows a winding clear approach.
  const seen = new Set<number>(), queue: number[] = [];
  polys.forEach((p, i) => { if (p.some(([x]) => x <= -half + EPS)) { seen.add(i); queue.push(i); } });
  for (let k = 0; k < queue.length; k++) {
    const p = polys[queue[k]];
    if (p.some(([x]) => x >= half - EPS)) return true;
    polys.forEach((q, i) => { if (!seen.has(i) && touches(p, q)) { seen.add(i); queue.push(i); } });
  }
  return false;
}

function sealed(w: WorldModel, e: Entity, surfaces: Map<string, OBB[]>): Sealed[] {
  const d = w.resolvedDef(e.def); if (!d) return [];
  const b = w.bake(d, e.params ?? {}, e.seed ?? 0, e.shape);
  if (!b.rooms?.length) return [];
  const edges: [string, string][] = [], allEdges: [string, string][] = [], shut: string[] = [];
  const key = (floor: number, id: string) => `${floor}:${id}`;
  const roomAt = (level: number, p: Vec2) => b.rooms!.find(r => r.floor === level && pointInPoly(p[0], p[1], r.polygon));
  for (const o of b.openings ?? []) {
    if (o.kind === 'window') continue;
    // A legacy sidecar can contain a slot narrower than a resident (e.g. a serving door).
    // Such a slot was never a body route, so construction cannot remove it as the last route.
    if (o.width * w.worldPose(e).s < L.bodyWidthM || o.height * w.worldPose(e).s < L.bodyHeightM) continue;
    // Sidecars predating graph metadata can recover the adjacent rooms from the opening normal.
    const n: Vec2 = [Math.sin(o.yaw) * 0.3, Math.cos(o.yaw) * 0.3];
    const from = o.from ?? roomAt(o.level, [o.at[0] - n[0], o.at[1] - n[1]])?.id;
    const to = o.to ?? roomAt(o.level, [o.at[0] + n[0], o.at[1] + n[1]])?.id ?? 'outside';
    if (!from) continue;
    const exterior = to === 'outside' || to === 'porch', edge: [string, string] = [key(o.level, from), exterior ? 'outside' : to === 'balcony' ? 'balcony' : key(o.level, to)];
    allEdges.push(edge);
    if (exterior && blocked(w, e, b, o, surfaces)) shut.push(o.id); else edges.push(edge);
  }
  for (const l of b.links ?? []) {
    const a = roomAt(l.from, l.path[0]), z = roomAt(l.to, l.path[l.path.length - 1]);
    if (a && z) { const edge: [string, string] = [key(l.from, a.id), key(l.to, z.id)]; edges.push(edge); allEdges.push(edge); }
  }
  if (!shut.length) return [];
  const before = reachableFromOutside(allEdges), after = reachableFromOutside(edges);
  return b.rooms.filter(r => before.has(key(r.floor, r.id)) && !after.has(key(r.floor, r.id))).map(r => ({ room: r.id, openings: shut }));
}

/** Refuse only newly sealed rooms; legacy worlds can still repair or recolour existing construction. */
export function sealedRouteFailure(before: WorldModel, after: WorldModel, op: number): Failure | null {
  const surfacesOf = (w: WorldModel) => new Map([...w.entities.values()].filter(e => w.resolvedDef(e.def)?.layer === 'surface').map(e => [e.id, w.footprint(e)]));
  const beforeSurfaces = surfacesOf(before), afterSurfaces = surfacesOf(after);
  for (const e of after.entities.values()) {
    const next = sealed(after, e, afterSurfaces); if (!next.length) continue;
    const prev = before.entities.get(e.id), old = new Set(prev ? sealed(before, prev, beforeSurfaces).map(r => r.room) : []);
    const bad = next.find(r => !old.has(r.room)); if (!bad) continue;
    const building = after.pathOf(e.id), openings = bad.openings.join(', ');
    return { op, code: 'architecture.sealed', entity: e.id, def: e.def, field: 'p',
      detail: `${building}: room ${bad.room} loses its last exterior route; blocked door/opening: ${openings}`,
      measured: { building, room: bad.room, openings: bad.openings }, limit: L.bodyWidthM,
      fix: `Move the solid clear of ${building}/${openings}; leave a clear approach at least ${L.bodyWidthM} m wide for ${L.sealApproachDepthM} m outside an exterior opening.` };
  }
  return null;
}
