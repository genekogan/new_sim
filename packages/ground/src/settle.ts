// Settling: five height samples and an anchor rule, no gravity (spec §4.3).
import { levelAlong } from './forms.ts';
import { areaMask, pathMask, pointInPoly } from './geom.ts';
import type { Terrain } from './tiles.ts';
import type { Anchor, Ground, Vec2 } from './types.ts';

/** Gap under a `base` anchor that a skirt may fill; above this a foundation pad is required. */
export const SKIRT_MAX_M = 0.6;
/** Walkable slope for an ordinary walker (rise/run of 30°). */
export const WALK_MAX_SLOPE = 0.5774;
/** Water deeper than this is swimming, not wading. */
export const WADE_MAX_M = 0.3;
/** Tolerance on the wading depth: tiles are Float32, so a pond carved exactly WADE_MAX_M deep must still be wadable. */
export const MEDIA_EPS = 1e-4;

export type Footprint = { corners: [Vec2, Vec2, Vec2, Vec2]; center: Vec2 };

/** Axis-aligned-in-local box footprint from a pose: half extents (hx, hz), yaw about +Y. */
export function footprintOf(cx: number, cz: number, hx: number, hz: number, yaw: number): Footprint {
  const c = Math.cos(yaw), s = Math.sin(yaw); // only used to build corners; not part of any hash
  const rot = (x: number, z: number): Vec2 => [cx + x * c + z * s, cz - x * s + z * c];
  return { corners: [rot(-hx, -hz), rot(hx, -hz), rot(hx, hz), rot(-hx, hz)], center: [cx, cz] };
}

export type Settled = {
  y: number;
  /** Tilt for `conform`: rotation about local X and Z in radians (small-angle, from slope). */
  pitch?: number; roll?: number;
  /** For `base`: vertical gap between the lowest and highest corner. */
  gap: number;
  /** For `base`: the footprint needs a foundation pad (gap > SKIRT_MAX_M). */
  needsPad: boolean;
  samples: number[];
};

export function settle(t: Terrain, fp: Footprint, anchor: Anchor, opts: { sink?: number; maxTiltRad?: number } = {}): Settled {
  const samples = [...fp.corners, fp.center].map(([x, z]) => t.sample(x, z));
  const lo = Math.min(...samples), hi = Math.max(...samples), mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  const gap = hi - lo;
  switch (anchor) {
    case 'base': return { y: lo, gap, needsPad: gap > SKIRT_MAX_M, samples };
    case 'center': return { y: samples[4] - (opts.sink ?? 0.2), gap, needsPad: false, samples };
    case 'conform': {
      // slope along local axes from corner pairs; clamp to maxTilt
      const [c0, c1, c2, c3] = fp.corners;
      const dxLen = Math.sqrt((c1[0] - c0[0]) ** 2 + (c1[1] - c0[1]) ** 2) || 1;
      const dzLen = Math.sqrt((c3[0] - c0[0]) ** 2 + (c3[1] - c0[1]) ** 2) || 1;
      const sx = ((samples[1] + samples[2]) - (samples[0] + samples[3])) / 2 / dxLen;
      const sz = ((samples[2] + samples[3]) - (samples[0] + samples[1])) / 2 / dzLen;
      const max = opts.maxTiltRad ?? 0.35;
      const clampT = (v: number) => (v > max ? max : v < -max ? -max : v);
      // small-angle: angle ≈ slope (rise/run); exact atan is engine-dependent and this is picture-side only
      return { y: mean, roll: clampT(sx), pitch: clampT(-sz), gap, needsPad: false, samples };
    }
    case 'drape': return { y: mean, gap, needsPad: false, samples };
  }
}

/** Surface level of standing water at (x, z), or null. The last matching water wins (birth order). */
export function waterLevelAt(g: Ground, x: number, z: number): number | null {
  let level: number | null = null;
  for (const w of g.waters) {
    const m = w.area ? areaMask(x, z, w.area, 1e-9) : pathMask(x, z, w.path!, w.w!);
    if (m > 0) level = w.levels ? levelAlong(x, z, w.path!, w.levels).level : w.level;
  }
  if (level === null && g.seaLevel !== undefined) level = g.seaLevel;
  return level;
}
export function waterDepthAt(t: Terrain, x: number, z: number): number {
  const lvl = waterLevelAt(t.ground, x, z);
  if (lvl === null) return 0;
  const d = lvl - t.sample(x, z);
  return d > 0 ? d : 0;
}

export type Medium = 'walk' | 'wade' | 'swim' | 'steep';
/** What a ground-bound body meets at (x, z). */
export function mediumAt(t: Terrain, x: number, z: number, maxSlope = WALK_MAX_SLOPE): Medium {
  const depth = waterDepthAt(t, x, z);
  if (depth > WADE_MAX_M + MEDIA_EPS) return 'swim';
  if (t.slope(x, z) > maxSlope) return 'steep';
  return depth > 0 ? 'wade' : 'walk';
}

/** Terrace margin beyond the walls (m): keeps tile samples under every corner flat. */
export const PAD_MARGIN_M = 1.0;
/** pad/2: the steepest bank a pad cuts or fills (rise/run, ~24°): walkable with room under WALK_MAX_SLOPE. */
export const PAD_GRADE = 0.45;
/** pad/2: the longest a bank reaches out from the flat before easing back to the natural ground (m). */
export const PAD_EDGE_MAX_M = 16;
/** pad/2: a door's landing reaches this far out from the wall's centre line (m), this much wider than the door each side. */
export const APRON_DEPTH_M = 2.6, APRON_SIDE_M = 0.6;
/** An exterior door at ground level, in world metres: its centre on the wall, outward unit normal and width. */
export type PadDoor = { at: Vec2; out: Vec2; width: number };

/**
 * The pad a `base`-anchored footprint needs on a slope: flatten to the lowest corner. pad/1 (no `grading`): blend 1.5 m
 * outside. pad/2 (`grading`, lane RT): a flat landing in front of every exterior door, and banks no steeper than
 * PAD_GRADE out to where they meet the ground as it is now (`grading.sample`), so the front of each door connects to open
 * ground at any yaw on any walkable slope.
 */
export function padFor(id: string, fp: Footprint, level: number, grading?: { sample(x: number, z: number): number; doors?: PadDoor[] }) {
  const [cx, cz] = fp.center;
  const area = fp.corners.map(([x, z]): Vec2 => {
    const dx = x - cx, dz = z - cz, len = Math.sqrt(dx * dx + dz * dz) || 1;
    return [x + (dx / len) * PAD_MARGIN_M * 1.4142, z + (dz / len) * PAD_MARGIN_M * 1.4142];
  });
  if (!grading) return { id, kind: 'pad' as const, area, level, edge: 1.5 };
  const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
  const aprons = (grading.doors ?? []).map(({ at, out, width }): Vec2[] => {
    const tx = -out[1], tz = out[0], hw = width / 2 + APRON_SIDE_M;
    return [[at[0] - tx * hw, at[1] - tz * hw], [at[0] + tx * hw, at[1] + tz * hw],
      [at[0] + tx * hw + out[0] * APRON_DEPTH_M, at[1] + tz * hw + out[1] * APRON_DEPTH_M], [at[0] - tx * hw + out[0] * APRON_DEPTH_M, at[1] - tz * hw + out[1] * APRON_DEPTH_M]]
      .map(([x, z]) => [r4(x), r4(z)] as Vec2);
  });
  const edge = gradedEdge(level, [area, ...aprons], grading.sample);
  return { id, kind: 'pad' as const, area, level, edge, grade: PAD_GRADE, ...(aprons.length ? { aprons } : {}) };
}

/** pad/2: how far the banks reach: the first offset (0.5 m steps) at which the ground all round the flat lies within
 *  PAD_GRADE x offset of the level, plus the ease band; at least pad/1's 1.5 m, at most PAD_EDGE_MAX_M. */
function gradedEdge(level: number, polys: Vec2[][], sample: (x: number, z: number) => number): number {
  const ring: { p: Vec2; n: Vec2 }[] = [];
  for (const poly of polys) {
    let sx = 0; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; sx += a[0] * b[1] - b[0] * a[1]; }
    const ccw = sx > 0 ? 1 : -1;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const n: Vec2 = [ccw * (b[1] - a[1]) / len, -ccw * (b[0] - a[0]) / len];
      const k = Math.max(1, Math.ceil(len));
      for (let j = 0; j <= k; j++) ring.push({ p: [a[0] + (b[0] - a[0]) * j / k, a[1] + (b[1] - a[1]) * j / k], n });
    }
  }
  const inside = (x: number, z: number) => polys.some((q) => pointInPoly(x, z, q));
  for (let d = 0.5; d <= PAD_EDGE_MAX_M - 2; d += 0.5) {
    let ok = true;
    for (const { p, n } of ring) {
      const x = p[0] + n[0] * d, z = p[1] + n[1] * d;
      if (inside(x, z)) continue;
      if (Math.abs(sample(x, z) - level) > PAD_GRADE * d + 1e-6) { ok = false; break; }
    }
    if (ok) return Math.max(1.5, d + 2);
  }
  return PAD_EDGE_MAX_M;
}
