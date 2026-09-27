// Pure geometry used by the offline campus extractor (deploy/engine-scene.mjs)
// and by tests: convex hull, minimum-area oriented rectangle, triangle
// clipping to a vertical band, and deterministic point clustering.
// No three.js — inputs are flat Float64 arrays of world-space positions.
import type { OBB2, Vec2 } from '../core/math.ts';

const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** Andrew's monotone chain; returns CCW hull without duplicates. Deterministic (sorted input). */
export function convexHull(points: Vec2[]): Vec2[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const uniq: Vec2[] = [];
  for (const p of pts) if (!uniq.length || uniq[uniq.length - 1][0] !== p[0] || uniq[uniq.length - 1][1] !== p[1]) uniq.push(p);
  if (uniq.length < 3) return uniq;
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Vec2[] = [], upper: Vec2[] = [];
  for (const p of uniq) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  for (let i = uniq.length - 1; i >= 0; i--) {
    const p = uniq[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

export function polygonArea(poly: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
}

/**
 * Minimum-area enclosing rectangle via rotating edges of the hull.
 * `minHalf` pads degenerate (zero-thickness) footprints so thin panels stay solid.
 * Yaw is normalised to [0, π/2) with half[0] along yaw, so output is canonical.
 */
export function minAreaRect(points: Vec2[], minHalf = 0.02): OBB2 {
  const hull = convexHull(points);
  if (hull.length === 0) throw new Error('minAreaRect: no points');
  let best = { area: Infinity, yaw: 0, c: [0, 0] as Vec2, half: [0, 0] as Vec2 };
  const cands: number[] = [0];
  for (let i = 0; i < hull.length; i++) {
    const p = hull[i], q = hull[(i + 1) % hull.length];
    if (p[0] !== q[0] || p[1] !== q[1]) cands.push(Math.atan2(q[1] - p[1], q[0] - p[0]));
  }
  for (let yaw of cands) {
    yaw = ((yaw % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
    const c = Math.cos(yaw), s = Math.sin(yaw);
    let ax = Infinity, az = Infinity, bx = -Infinity, bz = -Infinity;
    for (const [x, z] of hull) {
      const u = x * c + z * s, v = -x * s + z * c; // rotate by -yaw
      if (u < ax) ax = u; if (u > bx) bx = u; if (v < az) az = v; if (v > bz) bz = v;
    }
    const area = Math.max(bx - ax, 1e-6) * Math.max(bz - az, 1e-6);
    if (area < best.area - 1e-9) {
      const lu = (ax + bx) / 2, lv = (az + bz) / 2;
      best = { area, yaw, c: [lu * c - lv * s, lu * s + lv * c], half: [(bx - ax) / 2, (bz - az) / 2] };
    }
  }
  return {
    c: [r3(best.c[0]), r3(best.c[1])],
    half: [r3(Math.max(minHalf, best.half[0])), r3(Math.max(minHalf, best.half[1]))],
    yaw: Math.round(best.yaw * 1e5) / 1e5,
  };
}

/**
 * Footprint points (x, z) of the part of each triangle that lies inside the
 * vertical band y ∈ [y0, y1] (Sutherland–Hodgman against two planes). Needed
 * because a tall post has vertices only at its ends: vertex filtering alone
 * would lose it. `tri` = 9 numbers per triangle.
 */
export function clipTrianglesToBand(tri: Float64Array | number[], y0: number, y1: number, out: Vec2[] = []): Vec2[] {
  for (const poly of clipTrianglesToBandPolys(tri, y0, y1)) out.push(...poly);
  return out;
}

/** As clipTrianglesToBand, but one footprint polygon per triangle (keeps connectivity). */
export function clipTrianglesToBandPolys(tri: Float64Array | number[], y0: number, y1: number): Vec2[][] {
  const out: Vec2[][] = [];
  const poly: number[][] = [], tmp: number[][] = [];
  const clip = (inp: number[][], outp: number[][], y: number, keepAbove: boolean) => {
    outp.length = 0;
    for (let i = 0; i < inp.length; i++) {
      const a = inp[i], b = inp[(i + 1) % inp.length];
      const ina = keepAbove ? a[1] >= y : a[1] <= y, inb = keepAbove ? b[1] >= y : b[1] <= y;
      if (ina) outp.push(a);
      if (ina !== inb) {
        const t = (y - a[1]) / (b[1] - a[1]);
        outp.push([a[0] + (b[0] - a[0]) * t, y, a[2] + (b[2] - a[2]) * t]);
      }
    }
  };
  for (let k = 0; k + 8 < tri.length; k += 9) {
    const ymin = Math.min(tri[k + 1], tri[k + 4], tri[k + 7]), ymax = Math.max(tri[k + 1], tri[k + 4], tri[k + 7]);
    if (ymax < y0 || ymin > y1) continue;
    const t0 = [[tri[k], tri[k + 1], tri[k + 2]], [tri[k + 3], tri[k + 4], tri[k + 5]], [tri[k + 6], tri[k + 7], tri[k + 8]]];
    if (ymin >= y0 && ymax <= y1) { out.push(t0.map((p) => [p[0], p[2]] as Vec2)); continue; }
    clip(t0, tmp, y0, true);
    clip(tmp, poly, y1, false);
    if (poly.length) out.push(poly.map((p) => [p[0], p[2]] as Vec2));
  }
  return out;
}

/**
 * Split footprint points into spatially separate clusters (8-connected cells of
 * size `cell`). Deterministic: clusters ordered by their smallest cell index.
 */
export function clusterPoints(points: Vec2[], cell = 0.5): Vec2[][] {
  const key = (p: Vec2) => `${Math.floor(p[0] / cell)},${Math.floor(p[1] / cell)}`;
  const cells = new Map<string, Vec2[]>();
  for (const p of points) {
    const k = key(p);
    const arr = cells.get(k);
    if (arr) arr.push(p); else cells.set(k, [p]);
  }
  const keys = [...cells.keys()].sort((a, b) => {
    const [ai, aj] = a.split(',').map(Number), [bi, bj] = b.split(',').map(Number);
    return ai - bi || aj - bj;
  });
  const seen = new Set<string>();
  const out: Vec2[][] = [];
  for (const k0 of keys) {
    if (seen.has(k0)) continue;
    seen.add(k0);
    const group: Vec2[] = [];
    const stack = [k0];
    while (stack.length) {
      const k = stack.pop()!;
      group.push(...cells.get(k)!);
      const [i, j] = k.split(',').map(Number);
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        const n = `${i + di},${j + dj}`;
        if (!seen.has(n) && cells.has(n)) { seen.add(n); stack.push(n); }
      }
    }
    out.push(group);
  }
  return out;
}

/**
 * Group footprint polygons (one per clipped triangle) into connected clusters:
 * polygons are joined when they share or neighbour a cell, and every polygon is
 * internally connected (a 10 m wall triangle with vertices only at its ends
 * stays one piece). Deterministic: clusters ordered by first polygon index.
 */
export function clusterPolygons(polys: Vec2[][], cell = 0.5): Vec2[][][] {
  const parent = polys.map((_, i) => i);
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (a: number, b: number) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb); };
  const owner = new Map<string, number>();
  polys.forEach((poly, pi) => {
    for (const p of poly) {
      const i = Math.floor(p[0] / cell), j = Math.floor(p[1] / cell);
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        const o = owner.get(`${i + di},${j + dj}`);
        if (o !== undefined) union(o, pi);
      }
      const k = `${i},${j}`;
      if (!owner.has(k)) owner.set(k, pi);
    }
  });
  const groups = new Map<number, Vec2[][]>();
  polys.forEach((poly, pi) => {
    const r = find(pi);
    const g = groups.get(r);
    if (g) g.push(poly); else groups.set(r, [poly]);
  });
  return [...groups.keys()].sort((a, b) => a - b).map((k) => groups.get(k)!);
}

/** Keep the part of a convex polygon with (p − o)·n ≥ 0 (or ≤ 0 when `negative`). */
export function clipHalfPlane(poly: Vec2[], o: Vec2, n: Vec2, negative = false): Vec2[] {
  const sd = (p: Vec2) => ((p[0] - o[0]) * n[0] + (p[1] - o[1]) * n[1]) * (negative ? -1 : 1);
  const out: Vec2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const da = sd(a), db = sd(b);
    if (da >= 0) out.push(a);
    if ((da >= 0) !== (db >= 0)) { const t = da / (da - db); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
  }
  return out;
}
