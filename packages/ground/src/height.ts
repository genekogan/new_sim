// The height function. h = natural → carve → pad (spec §4.1). Total and
// deterministic; order within a class is array order (callers keep it by birth).
import { areaMask, bumpK, distPolyEdge, distPolyline, pathMask, pointInPoly, polyBounds, powPeak, smooth, sq, valueNoise } from './geom.ts';
import type { Ground, Landform, Vec2 } from './types.ts';

export function landformBounds(l: Landform): [number, number, number, number] {
  switch (l.kind) {
    case 'bump': return [l.c[0] - l.r, l.c[1] - l.r, l.c[0] + l.r, l.c[1] + l.r];
    case 'ridge': return polyBounds(l.path, l.w);
    case 'plateau': return polyBounds(l.area, 0);
    case 'carve': return l.area ? polyBounds(l.area, 0) : polyBounds(l.path!, l.w!);
    case 'pad': return polyBounds(l.area, 0);
  }
}
const inBounds = (b: [number, number, number, number], x: number, z: number) => x >= b[0] && x <= b[2] && z >= b[1] && z <= b[3];

/** Raw height at (x, z). Prefer Terrain.sample() (tile-interpolated) for anything that must match the browser. */
export function heightAt(g: Ground, x: number, z: number): number {
  let h = g.base;
  if (g.noise && g.noise.amp > 0) h += g.noise.amp * valueNoise(x, z, g.noise.scale, g.noise.seed);
  // natural
  for (const l of g.landforms) {
    if (l.kind === 'bump') {
      const d = Math.sqrt(sq(x - l.c[0]) + sq(z - l.c[1])) / l.r;
      if (d < 1) h += l.h * powPeak(bumpK(d), l.peak);
    } else if (l.kind === 'ridge') {
      const b = landformBounds(l); if (!inBounds(b, x, z)) continue;
      const d = distPolyline(x, z, l.path) / l.w;
      if (d < 1) h += l.h * powPeak(bumpK(d), l.peak);
    } else if (l.kind === 'plateau') {
      const b = landformBounds(l); if (!inBounds(b, x, z)) continue;
      h += l.h * areaMask(x, z, l.area, l.edge);
    }
  }
  // carve
  for (const l of g.landforms) {
    if (l.kind !== 'carve') continue;
    const b = landformBounds(l); if (!inBounds(b, x, z)) continue;
    const m = l.area ? areaMask(x, z, l.area, l.edge) : pathMask(x, z, l.path!, l.w!);
    if (m > 0 && l.bed < h) h += (l.bed - h) * m;
  }
  // pad
  for (const l of g.landforms) {
    if (l.kind !== 'pad') continue;
    const b = influenceBounds(l); if (!inBounds(b, x, z)) continue;
    const m = padMask(x, z, l.area, l.edge);
    if (m > 0) h += (l.level - h) * m;
  }
  return h;
}

/** Pads flatten fully inside and blend across `edge` metres OUTSIDE the footprint, so the terrace reaches the walls. */
function padMask(x: number, z: number, area: Vec2[], edge: number): number {
  return 1 - (1 - areaMask(x, z, area, 1e-9)) * (1 - outsideBand(x, z, area, edge));
}
function outsideBand(x: number, z: number, area: Vec2[], edge: number): number {
  if (pointInPoly(x, z, area)) return 1;
  return 1 - smooth(distPolyEdge(x, z, area) / edge);
}

/** Bounds a landform influences, for tile invalidation (pads blend outside their area). */
export function influenceBounds(l: Landform): [number, number, number, number] {
  const b = landformBounds(l);
  const pad = l.kind === 'pad' ? l.edge : 0;
  return [b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad];
}
