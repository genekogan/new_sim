// The blocked-ground test of scatters (ecology.mesh.ts blockedBy): solid footprints, paved areas and roads, indexed in
// 16 m cells. Pure data and math (no three), so the desert-scrub worker (scrub.worker.ts) runs the very same test.
export type BlockShape = ({ kind: 'obb'; c: [number, number]; h: [number, number]; yaw: number } | { kind: 'poly'; p: [number, number][] } | { kind: 'line'; c: [number, number][]; w: number }) & { id: string };
export type BlockCells = Map<string, BlockShape[]>;

export function inPoly(px: number, pz: number, poly: [number, number][]) { let inside = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > pz) !== (zj > pz) && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) inside = !inside; } return inside; }

/** True where something other than `selfId` blocks (x, z). */
export function blockTest(cells: BlockCells, C: number, selfId: string): (x: number, z: number) => boolean {
  return (x, z) => {
    const l = cells.get(`${Math.floor(x / C)},${Math.floor(z / C)}`); if (!l) return false;
    for (const s of l) {
      if (s.id === selfId) continue;
      if (s.kind === 'obb') { const dx = x - s.c[0], dz = z - s.c[1], co = Math.cos(s.yaw), si = Math.sin(s.yaw); const lx = dx * co - dz * si, lz = dx * si + dz * co; if (Math.abs(lx) <= s.h[0] && Math.abs(lz) <= s.h[1]) return true; }
      else if (s.kind === 'poly') { if (inPoly(x, z, s.p)) return true; }
      else { const [a, b] = s.c, vx = b[0] - a[0], vz = b[1] - a[1], n = vx * vx + vz * vz; let t = n ? ((x - a[0]) * vx + (z - a[1]) * vz) / n : 0; t = t < 0 ? 0 : t > 1 ? 1 : t; if (Math.hypot(x - a[0] - vx * t, z - a[1] - vz * t) < s.w) return true; }
    }
    return false;
  };
}
