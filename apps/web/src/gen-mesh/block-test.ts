// The blocked-ground test of scatters (ecology.mesh.ts blockedBy): solid footprints, paved areas and roads, indexed in
// 16 m cells. Pure data and math (no three), so the desert-scrub worker (scrub.worker.ts) runs the very same test.
export type BlockShape = ({ kind: 'obb'; c: [number, number]; h: [number, number]; yaw: number } | { kind: 'poly'; p: [number, number][] } | { kind: 'line'; c: [number, number][]; w: number }) & { id: string };
export type BlockCells = Map<string, BlockShape[]>;

export function inPoly(px: number, pz: number, poly: [number, number][]) { let inside = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > pz) !== (zj > pz) && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) inside = !inside; } return inside; }

/** Does this one shape cover (x, z)? */
export function shapeHits(s: BlockShape, x: number, z: number): boolean {
  if (s.kind === 'obb') { const dx = x - s.c[0], dz = z - s.c[1], co = Math.cos(s.yaw), si = Math.sin(s.yaw); const lx = dx * co - dz * si, lz = dx * si + dz * co; return Math.abs(lx) <= s.h[0] && Math.abs(lz) <= s.h[1]; }
  if (s.kind === 'poly') return inPoly(x, z, s.p);
  const [a, b] = s.c, vx = b[0] - a[0], vz = b[1] - a[1], n = vx * vx + vz * vz; let t = n ? ((x - a[0]) * vx + (z - a[1]) * vz) / n : 0; t = t < 0 ? 0 : t > 1 ? 1 : t; return Math.hypot(x - a[0] - vx * t, z - a[1] - vz * t) < s.w;
}
/** A shape's bounding box [x0, z0, x1, z1]. */
export function shapeBox(s: BlockShape): [number, number, number, number] {
  if (s.kind === 'obb') { const r = Math.hypot(s.h[0], s.h[1]); return [s.c[0] - r, s.c[1] - r, s.c[0] + r, s.c[1] + r]; }
  const pts = s.kind === 'poly' ? s.p : s.c, w = s.kind === 'line' ? s.w : 0; let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of pts) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
  return [x0 - w, z0 - w, x1 + w, z1 + w];
}
/** True where something other than `selfId` blocks (x, z). */
export function blockTest(cells: BlockCells, C: number, selfId: string): (x: number, z: number) => boolean {
  return (x, z) => {
    const l = cells.get(`${Math.floor(x / C)},${Math.floor(z / C)}`); if (!l) return false;
    for (const s of l) if (s.id !== selfId && shapeHits(s, x, z)) return true;
    return false;
  };
}
