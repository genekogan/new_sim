// The height function. h = natural → carve → pad (spec §4.1). Total and
// deterministic; order within a class is array order (callers keep it by birth).
import { areaMask, bumpK, distPolyEdge, distPolyline, pathMask, pointInPoly, polyBounds, powPeak, smooth, sq, valueNoise } from './geom.ts';
import { brushFalloff, brushRaise, channelApply, cliffReach, cliffRise, KERNEL, smoothRadius, terraceTarget } from './forms.ts';
import type { Ground, Landform, Vec2 } from './types.ts';

// lane PERF2: memoized per landform object (landforms are immutable data; every sample asked again: a 226-thing world spent
// ~115 ms of a terrain edit's 200 ms stall recomputing polygon bounds)
const boundsMemo = new WeakMap<Landform, [number, number, number, number]>();
export function landformBounds(l: Landform): [number, number, number, number] {
  let b = boundsMemo.get(l);
  if (!b) { b = landformBoundsRaw(l); boundsMemo.set(l, b); }
  return b;
}
function landformBoundsRaw(l: Landform): [number, number, number, number] {
  switch (l.kind) {
    case 'bump': return [l.c[0] - l.r, l.c[1] - l.r, l.c[0] + l.r, l.c[1] + l.r];
    case 'ridge': return polyBounds(l.path, l.w);
    case 'plateau': return polyBounds(l.area, 0);
    case 'carve': return l.area ? polyBounds(l.area, 0) : polyBounds(l.path!, l.w!);
    case 'pad': return l.aprons?.length ? unionBounds([l.area, ...l.aprons]) : polyBounds(l.area, 0);
    case 'cliff': return polyBounds(l.path, cliffReach(l));
    case 'terrace': return polyBounds(l.area, 0);
    case 'channel': return polyBounds(l.path, l.w + l.edge);
    case 'brush': return [l.c[0] - l.r, l.c[1] - l.r, l.c[0] + l.r, l.c[1] + l.r];
  }
}
const inBounds = (b: [number, number, number, number], x: number, z: number) => x >= b[0] && x <= b[2] && z >= b[1] && z <= b[3];
function unionBounds(polys: Vec2[][]): [number, number, number, number] {
  const b: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of polys) { const q = polyBounds(p, 0); b[0] = Math.min(b[0], q[0]); b[1] = Math.min(b[1], q[1]); b[2] = Math.max(b[2], q[2]); b[3] = Math.max(b[3], q[3]); }
  return b;
}

/** Raw height at (x, z). Prefer Terrain.sample() (tile-interpolated) for anything that must match the browser. */
/** Landforms in canonical fold order (class, then id), so a reloaded world sums in the same order to the bit. */
export function orderedLandforms(landforms: Landform[]): Landform[] {
  // L3 kinds slot between the originals (whose ranks 0/1/2 are unchanged): fill/set channels (graded roads,
  // embankments) at 0.9 so lakes, rivers and cuts always carve through them; smooth 1.25; terrace/flatten 1.5.
  const rank = (l: Landform) => (l.kind === 'pad' ? 2 : l.kind === 'carve' ? 1 : l.kind === 'channel' ? (l.mode === 'cut' ? 1 : 0.9) : l.kind === 'terrace' || (l.kind === 'brush' && l.op === 'flatten') ? 1.5 : l.kind === 'brush' && l.op === 'smooth' ? 1.25 : 0);
  return [...landforms].sort((a, b) => rank(a) - rank(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function heightAt(g: Ground, x: number, z: number): number {
  const forms = (g as Ground & { _ordered?: Landform[] })._ordered ?? orderedLandforms(g.landforms);
  let h = naturalAndCarve(g, forms, x, z);
  // smooth brushes (L3): relax toward the mean of the natural + carve result at nine kernel points
  for (const l of forms) {
    if (l.kind !== 'brush' || l.op !== 'smooth') continue;
    const f = brushFalloff(l, x, z); if (f <= 0) continue;
    const rho = smoothRadius(l);
    let sum = naturalAndCarve(g, forms, x, z);
    for (const [dx, dz] of KERNEL) sum += naturalAndCarve(g, forms, x + dx * rho, z + dz * rho);
    h += (sum / 9 - h) * f * (l.amount > 1 ? 1 : l.amount);
  }
  // terraces and flatten brushes (L3)
  for (const l of forms) {
    if (l.kind === 'terrace') {
      const b = landformBounds(l); if (!inBounds(b, x, z)) continue;
      const m = areaMask(x, z, l.area, l.edge);
      if (m > 0) h += (terraceTarget(l, h) - h) * m;
    } else if (l.kind === 'brush' && l.op === 'flatten') {
      const f = brushFalloff(l, x, z);
      if (f > 0) h += (l.level! - h) * f * (l.amount > 1 ? 1 : l.amount);
    }
  }
  // pad (pad/1 blends and pad/2 banks fold one after another, in order; pad/2b pads fold together, last)
  let flats: FlatsPad[] | null = null;
  for (const l of forms) {
    if (l.kind !== 'pad') continue;
    const b = influenceBounds(l); if (!inBounds(b, x, z)) continue;
    if (l.fold === 'flats' && l.grade !== undefined) { (flats ??= []).push(l as FlatsPad); continue; }
    if (l.grade !== undefined) { h = padGraded(h, x, z, l as PadLandform & { grade: number }); continue; }
    const m = padMask(x, z, l.area, l.edge);
    if (m > 0) h += (l.level - h) * m;
  }
  return flats ? padsFlatsWin(h, x, z, flats, onOldFlat(forms, x, z)) : h;
}

/** Base, noise, natural forms and carves: the part of the fold a smooth brush samples around a point. */
function naturalAndCarve(g: Ground, forms: Landform[], x: number, z: number): number {
  let h = g.base;
  if (g.noise && g.noise.amp > 0) h += g.noise.amp * valueNoise(x, z, g.noise.scale, g.noise.seed);
  // natural
  for (const l of forms) {
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
    } else if (l.kind === 'cliff') {
      const b = landformBounds(l); if (!inBounds(b, x, z)) continue;
      h += cliffRise(l, x, z);
    } else if (l.kind === 'brush' && (l.op === 'raise' || l.op === 'lower')) {
      h += brushRaise(l, x, z);
    }
  }
  // carve
  for (const l of forms) {
    if (l.kind === 'channel') {
      const b = landformBounds(l); if (!inBounds(b, x, z)) continue;
      h = channelApply(l, h, x, z);
      continue;
    }
    if (l.kind !== 'carve') continue;
    const b = landformBounds(l); if (!inBounds(b, x, z)) continue;
    const m = l.area ? areaMask(x, z, l.area, l.edge) : pathMask(x, z, l.path!, l.w!);
    if (m > 0 && l.bed < h) h += (l.bed - h) * m;
  }
  return h;
}

type PadLandform = Extract<Landform, { kind: 'pad' }>;
/** pad/2: the last metres of `edge` over which a bank that has not met the natural ground eases back to it. */
export const PAD_EASE_M = 2;
/** Distance from (x, z) to a pad/2's flat (its area and aprons); 0 on it. */
export function padFlatDist(x: number, z: number, l: PadLandform): number {
  let d = pointInPoly(x, z, l.area) ? 0 : distPolyEdge(x, z, l.area);
  for (const a of l.aprons ?? []) { if (d === 0) break; d = Math.min(d, pointInPoly(x, z, a) ? 0 : distPolyEdge(x, z, a)); }
  return d;
}
/** pad/2: level on the flat; outside it the ground is clamped to within `grade` x distance of the level (a walkable
 *  cut or fill bank), easing back to the natural ground over the last PAD_EASE_M of `edge`. */
function padGraded(h: number, x: number, z: number, l: PadLandform & { grade: number }): number {
  const d = padFlatDist(x, z, l);
  if (d >= l.edge) return h;
  const lo = l.level - l.grade * d, hi = l.level + l.grade * d, c = h < lo ? lo : h > hi ? hi : h;
  if (c === h) return h;
  const rest = l.edge - d;
  return rest >= PAD_EASE_M ? c : h + (c - h) * smooth(rest / PAD_EASE_M);
}

type FlatsPad = PadLandform & { grade: number; fold: 'flats' };
/**
 * pad/2b (lane PADFIX, 2026-10-21; the "flats win" part of RT2's pad/3): the pad/2b pads round (x, z) fold together, after
 * every older pad, so no bank cuts a standing building's flat. On a pad/2b flat (area or door landing) the ground is that
 * pad's level (the last in fold order where flats overlap). On an older pad's flat (pad/1 area, pad/2 area or landing) a
 * pad/2b bank leaves the ground as the older fold made it. Off every flat each pad/2b pad bounds the ground to its cone,
 * level +- grade x distance (eased back over the last PAD_EASE_M of its edge, as pad/2), and the ground is held between the
 * highest lower bound and the lowest upper one; where two cones do not meet (a terrace above another, closer than the grade
 * allows) the ground runs between the two binding bounds by distance to their flats, so it meets each flat at its level.
 */
function padsFlatsWin(h: number, x: number, z: number, pads: FlatsPad[], inOldFlat: boolean): number {
  let flat: number | undefined;
  const near: { l: FlatsPad; d: number; w: number; up?: true; down?: true }[] = [];
  for (const l of pads) {
    const d = padFlatDist(x, z, l);
    if (d === 0) { flat = l.level; continue; }
    if (d >= l.edge || flat !== undefined || inOldFlat) continue;
    const rest = l.edge - d;
    near.push({ l, d, w: rest >= PAD_EASE_M ? 1 : smooth(rest / PAD_EASE_M) });
  }
  if (flat !== undefined) return flat;
  if (inOldFlat || !near.length) return h;
  // a bound binds when it lies beyond the ground as clamped so far: a neighbour's cut cone that digs the ground below
  // this pad's fill cone (or a fill above its cut) is a conflict even where the natural ground lay inside both (padfix2)
  let v = h, lo = -Infinity, hi = Infinity, dLo = 0, dHi = 0;
  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    for (const n of near) {
      const { l, d, w } = n, a = l.level - l.grade * d, c = l.level + l.grade * d;
      // each pad's fill (cut) bound is taken once, eased from the ground as it stood when it first bound
      if (!n.up && a > v) { n.up = true; const b = v + (a - v) * w; if (b > lo) { lo = b; dLo = d; moved = true; } }
      if (!n.down && c < v) { n.down = true; const b = v + (c - v) * w; if (b < hi) { hi = b; dHi = d; moved = true; } }
    }
    if (lo > hi) return conflictBlend(lo, hi, dLo, dHi);
    if (!moved) break;
    v = v < lo ? lo : v > hi ? hi : v;
  }
  return v;
}

/** pad/2b shoulder (lane SEALED, 2026-10-21): where two cones do not meet, each flat keeps a walkable shoulder this wide
 *  on its own cone (grade PAD_GRADE) before the ground drops (or rises) to the other flat, the upper flat first: before,
 *  the ground ran between the two flats by distance from the flat's edge, so a terrace 1-3 m above a neighbour lost the
 *  margin along its wall (the 1 m tile grid put the next sample down the drop: a ledge too narrow to stand on). */
export const PAD_SHOULDER_M = 1.0;
/** Two conflicting cones at (x, z): the upper flat's fill bound `lo` (dLo from its flat), the lower flat's cut bound `hi`
 *  (dHi from its flat). Within the upper shoulder: lo; within the lower one: hi; between: from one to the other by distance. */
function conflictBlend(lo: number, hi: number, dLo: number, dHi: number): number {
  const gap = dLo + dHi;
  const sUp = Math.min(PAD_SHOULDER_M, Math.max(0, gap - 0.3)), sLo = Math.min(PAD_SHOULDER_M, Math.max(0, gap - sUp - 0.3));
  if (dLo <= sUp) return lo;
  if (dHi <= sLo) return hi;
  const t = (dLo - sUp) / (gap - sUp - sLo);
  return lo + (hi - lo) * t;
}

/** pad/2b: is (x, z) on an older pad's flat (a pad/1 area, a pad/2 area or landing)? Only asked near a pad/2b pad. */
function onOldFlat(forms: Landform[], x: number, z: number): boolean {
  for (const l of forms) {
    if (l.kind !== 'pad' || l.fold === 'flats' || !inBounds(landformBounds(l), x, z)) continue;
    if (l.grade !== undefined ? padFlatDist(x, z, l) === 0 : pointInPoly(x, z, l.area)) return true;
  }
  return false;
}

/** Pads flatten fully inside and blend across `edge` metres OUTSIDE the footprint, so the terrace reaches the walls. */
function padMask(x: number, z: number, area: Vec2[], edge: number): number {
  // = 1 - (1 - areaMask(x, z, area, 1e-9)) * (1 - outsideBand), with the inside test made once instead of twice (L3e)
  const inside = pointInPoly(x, z, area);
  const mask = inside ? smooth(distPolyEdge(x, z, area) / 1e-9) : 0;
  const band = inside ? 1 : 1 - smooth(distPolyEdge(x, z, area) / edge);
  return 1 - (1 - mask) * (1 - band);
}

/** Bounds a landform influences, for tile invalidation (pads blend outside their area). */
export function influenceBounds(l: Landform): [number, number, number, number] {
  const b = landformBounds(l);
  const pad = l.kind === 'pad' ? l.edge : 0;  // smooth brushes also read neighbours up to smoothRadius away (tiles.ts widens the tile subset)
  return [b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad];
}
