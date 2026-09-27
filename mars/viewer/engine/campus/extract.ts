// Pure extraction core: manifest components (world-space triangles + extras)
// → obstacle prisms. The GLB loading lives in deploy/engine-scene.mjs; this
// file is deterministic TS so tests can exercise it without the 70 MB model.
import { dcos, dsin, type OBB2, type Vec2 } from '../core/math.ts';
import type { Confidence } from '../world/types.ts';
import { clipHalfPlane, clipTrianglesToBandPolys, clusterPolygons, convexHull, minAreaRect, polygonArea } from './geom.ts';
import type { ObstacleKind, ObstacleRow } from './types.ts';

export const GROUND_Y = -0.16;
/** Body band on the ground level: anything intersecting it blocks walking (grid: step 0.22, body 1.8). */
export const LOW_BAND: [number, number] = [GROUND_Y + 0.06, GROUND_Y + 2.0];
export const BUILDING_ASSEMBLIES = ['chiba', 'north-workshops', 'north-rack-building', 'northeast-compound', 'west-rack-building'];
const VEHICLE_RE = /\b(bus|van|motorhome|truck|trailer|rv|camper|car|jeep|chevy|ford|toyota|mitsubishi|airstream|l300)\b/i;

export type ComponentInput = {
  id: string; // manifest component_id
  kind: string; // manifest kind
  layer: string;
  assembly: string;
  accuracy?: string;
  ancestors?: string[];
  /** World-space triangles, 9 numbers each. */
  tris: Float64Array;
};

const r3 = (x: number) => Math.round(x * 1000) / 1000;

export function classify(c: ComponentInput): { kind: ObstacleKind; name: string; vehicle?: string } {
  const vehicle = (c.ancestors ?? []).find((a) => VEHICLE_RE.test(a));
  if (vehicle) return { kind: 'vehicle', name: vehicle, vehicle };
  if (c.kind === 'transparent_panel' || c.layer === 'Glazing')
    return { kind: 'glass', name: 'clear glazing panel (glass/plexiglass not distinguished in source)' };
  if (c.layer === 'Walls and screens') return { kind: 'wall', name: 'wall/screen panel' };
  if (c.layer === 'Fittings and furniture') return { kind: 'fixture', name: 'fitting/furniture' };
  if (c.layer === 'Solar and equipment') return { kind: 'fixture', name: 'solar/equipment' };
  if (c.layer === 'Rack steel') return { kind: 'solid', name: c.kind === 'beam_candidate' ? 'rack beam (CAD)' : 'rack steel member (CAD)' };
  if (c.layer === 'Roofs and upper floors') return { kind: 'solid', name: 'roof/upper floor' };
  return { kind: 'solid', name: 'timber/floor/stair piece' };
}

export function confidenceOf(accuracy: string | undefined): Confidence {
  if (!accuracy) return 'provisional';
  if (/approximate|photo-informed|estimated/i.test(accuracy)) return 'provisional';
  return 'inferred'; // "CAD geometry; visual correspondence, dimensions not field verified"
}

/**
 * Fit OBBs to a cluster of footprint polygons, splitting along the long axis
 * while the cluster is large and poorly filled (L/U-shaped meshes). Polygons
 * are clipped at the split line so no geometry between vertices is lost.
 */
export function fitPieces(polys: Vec2[][], depth = 0): OBB2[] {
  const points = polys.flat();
  const obb = minAreaRect(points);
  const area = 4 * obb.half[0] * obb.half[1];
  const hull = convexHull(points);
  const fill = hull.length >= 3 ? polygonArea(hull) / area : 1;
  if (depth >= 4 || area < 6 || fill >= 0.6) return [obb];
  const ax: Vec2 = obb.half[0] >= obb.half[1] ? [dcos(obb.yaw), dsin(obb.yaw)] : [-dsin(obb.yaw), dcos(obb.yaw)];
  const a = polys.map((p) => clipHalfPlane(p, obb.c, ax, true)).filter((p) => p.length);
  const b = polys.map((p) => clipHalfPlane(p, obb.c, ax)).filter((p) => p.length);
  if (!a.length || !b.length) return [obb];
  return [...fitPieces(a, depth + 1), ...fitPieces(b, depth + 1)];
}

export type Extracted = { rows: ObstacleRow[]; labels: string[]; stats: Record<string, number> };

/**
 * Components → rows. Per component: the geometry inside the ground body band
 * becomes one prism per spatial cluster (id, id.1, id.2 …); geometry above the
 * band becomes `id.up…` prisms (overhead: camera/upper-level use only).
 * Roofs/upper floors of buildings also emit `interior:` blockers from ground to
 * their underside: covered space is unverified interior and NOT walkable.
 */
export function extractObstacles(components: ComponentInput[], assemblyNames: Record<string, string>): Extracted {
  const labels: string[] = [];
  const labelIdx = new Map<string, number>();
  const L = (s: string) => {
    let i = labelIdx.get(s);
    if (i === undefined) { i = labels.length; labels.push(s); labelIdx.set(s, i); }
    return i;
  };
  const rows: ObstacleRow[] = [];
  const stats: Record<string, number> = { components: 0, lowPrisms: 0, upperPrisms: 0, interiorPrisms: 0, skippedFlat: 0 };
  const sorted = [...components].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const c of sorted) {
    if (!c.tris.length) continue;
    stats.components++;
    let ymin = Infinity, ymax = -Infinity;
    for (let k = 1; k < c.tris.length; k += 3) { const y = c.tris[k]; if (y < ymin) ymin = y; if (y > ymax) ymax = y; }
    const { kind, name } = classify(c);
    const conf = confidenceOf(c.accuracy);
    const asmName = assemblyNames[c.assembly] ?? c.assembly;
    const label = L(`${name} · ${asmName}`);
    const push = (id: string, o: OBB2, y0: number, y1: number, k: ObstacleKind, lab: number, cf: Confidence) =>
      // zero-thickness horizontal sheets (table tops, flat panels) get a 2 cm slab so y1 > y0
      rows.push([id, k, o.c[0], o.c[1], o.half[0], o.half[1], o.yaw, r3(y1 - y0 < 0.02 ? (y0 + y1) / 2 - 0.01 : y0), r3(y1 - y0 < 0.02 ? (y0 + y1) / 2 + 0.01 : y1), lab, cf, c.assembly, c.id]);
    const emit = (pts: Vec2[][], prefix: string, y0: number, y1: number, cell: number, k = kind, lab = label, cf = conf) => {
      const pieces = clusterPolygons(pts, cell).flatMap((cl) => fitPieces(cl));
      pieces.forEach((o, i) => push(i === 0 ? prefix : `${prefix}.${i}`, o, y0, y1, k, lab, cf));
      return pieces.length;
    };
    if (ymax <= LOW_BAND[0]) { stats.skippedFlat++; continue; } // flush with the ground: walk over it
    const [b0, b1] = LOW_BAND;
    if (ymin < b1) {
      const pts = clipTrianglesToBandPolys(c.tris, b0, b1);
      if (pts.length) stats.lowPrisms += emit(pts, c.id, ymin, Math.min(ymax, b1), 0.5);
    }
    if (ymax > b1) {
      const pts = clipTrianglesToBandPolys(c.tris, Math.max(b1, ymin), ymax);
      if (pts.length) stats.upperPrisms += emit(pts, `${c.id}.up`, Math.max(b1, ymin), ymax, 1.0);
    }
    if (c.layer === 'Roofs and upper floors' && BUILDING_ASSEMBLIES.includes(c.assembly) && ymin > b0) {
      const pts = clipTrianglesToBandPolys(c.tris, ymin, ymax);
      const lab = L(`unverified interior under ${name} · ${asmName} (non-walkable by rule)`);
      stats.interiorPrisms += emit(pts, `interior:${c.id}`, GROUND_Y, ymin, 1.0, 'solid', lab, 'inferred');
    }
  }
  return { rows, labels, stats };
}
