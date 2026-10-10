// Settling: five height samples and an anchor rule, no gravity (spec §4.3).
import { areaMask, pathMask } from './geom.ts';
import type { Terrain } from './tiles.ts';
import type { Anchor, Ground, Vec2 } from './types.ts';

/** Gap under a `base` anchor that a skirt may fill; above this a foundation pad is required. */
export const SKIRT_MAX_M = 0.6;
/** Walkable slope for an ordinary walker (rise/run of 30°). */
export const WALK_MAX_SLOPE = 0.5774;
/** Water deeper than this is swimming, not wading. */
export const WADE_MAX_M = 0.3;

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
    if (m > 0) level = w.level;
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
  if (depth > WADE_MAX_M) return 'swim';
  if (t.slope(x, z) > maxSlope) return 'steep';
  return depth > 0 ? 'wade' : 'walk';
}

/** Terrace margin beyond the walls (m): keeps tile samples under every corner flat. */
export const PAD_MARGIN_M = 1.0;
/** The pad a `base`-anchored footprint needs on a slope: flatten to the lowest corner, blend 1.5 m outside. */
export function padFor(id: string, fp: Footprint, level: number) {
  const [cx, cz] = fp.center;
  const area = fp.corners.map(([x, z]): Vec2 => {
    const dx = x - cx, dz = z - cz, len = Math.sqrt(dx * dx + dz * dz) || 1;
    return [x + (dx / len) * PAD_MARGIN_M * 1.4142, z + (dz / len) * PAD_MARGIN_M * 1.4142];
  });
  return { id, kind: 'pad' as const, area, level, edge: 1.5 };
}
