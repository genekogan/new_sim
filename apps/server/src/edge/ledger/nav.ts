// nav/1 spec builder (Core): every enclosed building in PLACE-DATA-v1 and every water body becomes a solid footprint
// for walking; World's activity-spots file adds scenery solids that have no place and turns admitted interiors into
// wall shells with door gaps plus furniture boxes. Pure and deterministic; the engine validates and installs it.
import type {PlaceData, Place} from './places.ts';

type V2 = [number, number];
export type Solid = {id: string; label?: string; c: V2; half: V2; yaw: number; height?: number};
export type GroundRect = {id: string; boundsXZ: [number, number, number, number]};
export type NavSpec = {version: 'nav/1'; ground: GroundRect[]; solids: Solid[]};
/** activity-spots/1 `interiors[]`: an enclosed building made enterable through its doors. */
export type Interior = {place: string; doors: [number, number, number, number][]; wall?: number; furniture?: Solid[];
  /** Interior wall runs [x0,z0,x1,z1] inside the building; any door segment lying on a run is a gap in it. */
  walls?: [number, number, number, number][]};

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const bbox = (poly: V2[]) => {const xs = poly.map(v => v[0]), zs = poly.map(v => v[1]); return [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)] as [number, number, number, number];};
const hits = (a: number[], b: number[]) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

/** An oriented box for a polygon: exact for a (possibly turned) rectangle, else its axis-aligned bounds. */
export function polygonBox(id: string, poly: V2[], label?: string, height?: number): Solid {
  if (poly.length === 4) {
    const e0: V2 = [poly[1][0] - poly[0][0], poly[1][1] - poly[0][1]], e1: V2 = [poly[2][0] - poly[1][0], poly[2][1] - poly[1][1]];
    const l0 = Math.hypot(...e0), l1 = Math.hypot(...e1);
    if (l0 > 1e-6 && l1 > 1e-6 && Math.abs(e0[0] * e1[0] + e0[1] * e1[1]) / (l0 * l1) < 0.02) {
      const c: V2 = [r3(poly.reduce((s, v) => s + v[0], 0) / 4), r3(poly.reduce((s, v) => s + v[1], 0) / 4)];
      return {id, ...(label ? {label} : {}), c, half: [r3(l0 / 2), r3(l1 / 2)], yaw: r3(Math.atan2(e0[1], e0[0])), ...(height ? {height} : {})};
    }
  }
  const [x0, z0, x1, z1] = bbox(poly);
  return {id, ...(label ? {label} : {}), c: [r3((x0 + x1) / 2), r3((z0 + z1) / 2)], half: [r3((x1 - x0) / 2), r3((z1 - z0) / 2)], yaw: 0, ...(height ? {height} : {})};
}

/** A pond is an oval inside its rectangle: 8 strips that stay inside the ellipse (its stone edge is the bank). */
export function ovalStrips(id: string, poly: V2[], label?: string): Solid[] {
  const [x0, z0, x1, z1] = bbox(poly), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, rx = (x1 - x0) / 2, rz = (z1 - z0) / 2, n = 8, out: Solid[] = [];
  for (let i = 0; i < n; i++) {
    const a = z0 + (i / n) * (z1 - z0), b = z0 + ((i + 1) / n) * (z1 - z0), worst = Math.max(Math.abs(a - cz), Math.abs(b - cz)) / rz;
    const hx = rx * Math.sqrt(Math.max(0, 1 - worst * worst)); if (hx < 0.3) continue;
    out.push({id: `${id}#${i}`, ...(label ? {label} : {}), c: [r3(cx), r3((a + b) / 2)], half: [r3(hx), r3((b - a) / 2)], yaw: 0, height: 1});
  }
  return out;
}

/** Walls of a rectangular building (polygon = outside of the walls) with gaps where doors cross them. */
export function shellWalls(id: string, poly: V2[], doors: [number, number, number, number][], wall = 0.3, label?: string): Solid[] {
  const out: Solid[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]); if (len < 1e-6) continue;
    const u: V2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len], cx = poly.reduce((s, v) => s + v[0], 0) / poly.length, cz = poly.reduce((s, v) => s + v[1], 0) / poly.length;
    // inward normal: the side of the edge the centroid is on
    let nrm: V2 = [-u[1], u[0]]; if ((cx - a[0]) * nrm[0] + (cz - a[1]) * nrm[1] < 0) nrm = [u[1], -u[0]];
    const gaps: [number, number][] = [];
    for (const d of doors) {
      const p: V2 = [d[0], d[1]], q: V2 = [d[2], d[3]], off = (v: V2) => Math.abs((v[0] - a[0]) * nrm[0] + (v[1] - a[1]) * nrm[1]);
      if (off(p) > wall + 0.3 || off(q) > wall + 0.3) continue;                    // this door is on another wall
      const t = (v: V2) => (v[0] - a[0]) * u[0] + (v[1] - a[1]) * u[1], s = Math.max(0, Math.min(t(p), t(q))), e = Math.min(len, Math.max(t(p), t(q)));
      if (e - s >= 0.5) gaps.push([s, e]);
    }
    gaps.sort((x, y) => x[0] - y[0]);
    let from = 0, k = 0;
    for (const [s, e] of [...gaps, [len, len] as [number, number]]) {
      if (s - from > 0.05) {
        const m = (from + s) / 2, c: V2 = [a[0] + u[0] * m + nrm[0] * wall / 2, a[1] + u[1] * m + nrm[1] * wall / 2];
        out.push({id: `${id}#w${i}.${k++}`, ...(label ? {label} : {}), c: [r3(c[0]), r3(c[1])], half: [r3((s - from) / 2), r3(wall / 2)], yaw: r3(Math.atan2(u[1], u[0])), height: 3});
      }
      from = Math.max(from, e);
    }
  }
  return out;
}

/** activity-spots/1 `rings[]`: a round open structure's solid rail or wall (gazebo, bandstand, dome struts) as short
 *  straight segments on a circle, leaving `gaps` (degrees; x = cx + r·cos a, z = cz + r·sin a) open as doorways. */
export type Ring = {id: string; label?: string; c: V2; r: number; segments?: number; gaps?: number[]; gapDegrees?: number; thickness?: number; height?: number};
export function ringWalls(g: Ring): Solid[] {
  const n = Math.max(6, Math.min(48, g.segments ?? 16)), gap = (g.gapDegrees ?? 12) * Math.PI / 180, th = g.thickness ?? 0.25, out: Solid[] = [];
  const near = (a: number) => (g.gaps ?? []).some(d => {const x = Math.abs(((a - d * Math.PI / 180) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI); return x < gap;});
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * 2 * Math.PI, a1 = ((i + 1) / n) * 2 * Math.PI, am = (a0 + a1) / 2;
    if (near(am) || near(a0 + (a1 - a0) * 0.1) || near(a1 - (a1 - a0) * 0.1)) continue;
    const p0: V2 = [g.c[0] + g.r * Math.cos(a0), g.c[1] + g.r * Math.sin(a0)], p1: V2 = [g.c[0] + g.r * Math.cos(a1), g.c[1] + g.r * Math.sin(a1)];
    out.push({id: `${g.id}#r${i}`, ...(g.label ? {label: g.label} : {}), c: [r3((p0[0] + p1[0]) / 2), r3((p0[1] + p1[1]) / 2)], half: [r3(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) / 2 + th / 2), r3(th / 2)], yaw: r3(Math.atan2(p1[1] - p0[1], p1[0] - p0[0])), height: g.height ?? 1.2});
  }
  return out;
}

/** Interior wall runs with door gaps (a door segment within 0.3 m of the run's line opens it). */
export function runWalls(id: string, runs: [number, number, number, number][], doors: [number, number, number, number][], wall = 0.15, label?: string): Solid[] {
  const out: Solid[] = [];
  runs.forEach(([ax, az, bx, bz], i) => {
    const len = Math.hypot(bx - ax, bz - az); if (len < 0.05) return;
    const u: V2 = [(bx - ax) / len, (bz - az) / len], nrm: V2 = [-u[1], u[0]], gaps: [number, number][] = [];
    for (const d of doors) {
      const off = (x: number, z: number) => Math.abs((x - ax) * nrm[0] + (z - az) * nrm[1]), t = (x: number, z: number) => (x - ax) * u[0] + (z - az) * u[1];
      if (off(d[0], d[1]) > 0.3 || off(d[2], d[3]) > 0.3) continue;
      const s0 = Math.max(0, Math.min(t(d[0], d[1]), t(d[2], d[3]))), e0 = Math.min(len, Math.max(t(d[0], d[1]), t(d[2], d[3]))); if (e0 - s0 >= 0.5) gaps.push([s0, e0]);
    }
    gaps.sort((x, y) => x[0] - y[0]); let from = 0, k = 0;
    for (const [s0, e0] of [...gaps, [len, len] as [number, number]]) {
      if (s0 - from > 0.05) {const m = (from + s0) / 2; out.push({id: `${id}#i${i}.${k++}`, ...(label ? {label} : {}), c: [r3(ax + u[0] * m), r3(az + u[1] * m)], half: [r3((s0 - from) / 2), r3(wall / 2)], yaw: r3(Math.atan2(u[1], u[0])), height: 3});}
      from = Math.max(from, e0);
    }
  });
  return out;
}

/** The nav/1 spec for a place file. `native` = ids already native regions (their own geometry, never solid here);
 *  `area` = rectangles where solids matter (native ground plus new ground); others are skipped to keep the raster small. */
export function navSpecFromPlaces(data: PlaceData, opts: {native: Set<string>; ground: GroundRect[]; area: [number, number, number, number][]; extraSolids?: Solid[]; rings?: Ring[]; interiors?: Interior[]}): NavSpec {
  const byId = new Map(data.places.map(p => [p.id, p])), interiors = new Map((opts.interiors ?? []).map(i => [i.place, i]));
  const enclosedAncestor = (p: Place) => {for (let q = p.parent ? byId.get(p.parent) : undefined; q; q = q.parent ? byId.get(q.parent) : undefined) if (q.enclosed && (q.level ?? 0) === 0 && !q.carrier) return true; return false;};
  const area = [...opts.area, ...opts.ground.map(g => g.boundsXZ)], inArea = (poly: V2[]) => {const b = bbox(poly); return area.some(a => hits(b, a));};
  const solids: Solid[] = [];
  for (const p of [...data.places].sort((a, b) => a.id.localeCompare(b.id))) {
    if ((p.level ?? 0) !== 0 || p.carrier || p.parent === null || opts.native.has(p.id) || !inArea(p.polygon)) continue;
    if (p.kind === 'water') {solids.push(...ovalStrips(p.id, p.polygon, p.name)); continue;}
    if (!p.enclosed || enclosedAncestor(p)) continue;
    const inside = interiors.get(p.id);
    if (inside) {solids.push(...shellWalls(p.id, p.polygon, inside.doors, inside.wall ?? 0.3, p.name), ...runWalls(p.id, inside.walls ?? [], inside.doors, 0.15, p.name), ...(inside.furniture ?? []).map(f => ({...f, id: `${p.id}#f-${f.id}`})));}
    else solids.push(polygonBox(p.id, p.polygon, p.name));
  }
  for (const s of [...(opts.extraSolids ?? []), ...(opts.rings ?? []).flatMap(ringWalls)]) if (inArea([[s.c[0] - s.half[0], s.c[1] - s.half[1]], [s.c[0] + s.half[0], s.c[1] + s.half[1]]])) solids.push(s);
  return {version: 'nav/1', ground: opts.ground, solids};
}
