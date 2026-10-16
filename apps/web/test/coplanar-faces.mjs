// Coplanar (z-fighting) overlap finder: every pair of triangles in (nearly) the same plane whose areas overlap,
// from different colours (visible stripes). Usage: import {coplanar} and pass a THREE.Object3D.
import * as THREE from 'three';
export function triangles(root) {
  const out = []; root.updateMatrixWorld(true);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || !o.visible) return; const g = o.geometry, P = g.getAttribute('position'), C = g.getAttribute('color'), I = g.index; if (!P) return;
    const mat = Array.isArray(o.material) ? o.material[0] : o.material; if (mat?.transparent) return;
    const n = I ? I.count : P.count;
    for (let i = 0; i + 2 < n; i += 3) {
      const ia = I ? I.getX(i) : i, ib = I ? I.getX(i + 1) : i + 1, ic = I ? I.getX(i + 2) : i + 2;
      a.fromBufferAttribute(P, ia).applyMatrix4(o.matrixWorld); b.fromBufferAttribute(P, ib).applyMatrix4(o.matrixWorld); c.fromBufferAttribute(P, ic).applyMatrix4(o.matrixWorld);
      const col = C ? [C.getX(ia), C.getY(ia), C.getZ(ia)] : (mat?.color ? [mat.color.r, mat.color.g, mat.color.b] : [1, 1, 1]);
      out.push({ p: [a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z], col, mesh: o.name, mat: mat?.name ?? '' });
    }
  });
  return out;
}
function plane(t) { const [ax, ay, az, bx, by, bz, cx, cy, cz] = t.p; let nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay), ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az), nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax); const l = Math.hypot(nx, ny, nz); if (l < 1e-9) return null; nx /= l; ny /= l; nz /= l; const nx0 = nx, ny0 = ny, nz0 = nz;
  // canonical sign (DoubleSide materials: the back face fights too)
  if (nx < -1e-6 || (Math.abs(nx) <= 1e-6 && (ny < -1e-6 || (Math.abs(ny) <= 1e-6 && nz < 0)))) { nx = -nx; ny = -ny; nz = -nz; }
  return { n: [nx, ny, nz], d: nx * ax + ny * ay + nz * az, area: l / 2, raw: [nx0, ny0, nz0] }; }
// 2D overlap area of two triangles projected into their shared plane (convex clip)
function clip(subject, clipPoly) { let out = subject; for (let i = 0; i < clipPoly.length; i++) { const A = clipPoly[i], B = clipPoly[(i + 1) % clipPoly.length], inp = out; out = []; if (!inp.length) break;
  const side = (p) => (B[0] - A[0]) * (p[1] - A[1]) - (B[1] - A[1]) * (p[0] - A[0]);
  for (let j = 0; j < inp.length; j++) { const P = inp[j], Q = inp[(j + 1) % inp.length], sp = side(P), sq = side(Q); if (sp >= 0) out.push(P); if ((sp >= 0) !== (sq >= 0)) { const t = sp / (sp - sq); out.push([P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t]); } } } return out; }
const area2 = (poly) => { let s = 0; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
export function coplanar(tris, { dTol = 0.003, minArea = 0.002, colourDiff = 0.04 } = {}) {
  const buckets = new Map();
  for (const t of tris) { const pl = plane(t); if (!pl || pl.area < 1e-5) continue; t.pl = pl;
    const key = `${Math.round(pl.n[0] * 200)},${Math.round(pl.n[1] * 200)},${Math.round(pl.n[2] * 200)}`; let m = buckets.get(key); if (!m) buckets.set(key, m = []); m.push(t); }
  const hits = [];
  for (const list of buckets.values()) {
    list.sort((a, b) => a.pl.d - b.pl.d);
    for (let i = 0; i < list.length; i++) { const A = list[i];
      for (let j = i + 1; j < list.length && list[j].pl.d - A.pl.d <= dTol; j++) { const B = list[j];
        const dc = Math.abs(A.col[0] - B.col[0]) + Math.abs(A.col[1] - B.col[1]) + Math.abs(A.col[2] - B.col[2]); if (dc < colourDiff) continue;
        // bbox reject
        const ax = [A.p[0], A.p[3], A.p[6]], ay = [A.p[1], A.p[4], A.p[7]], az = [A.p[2], A.p[5], A.p[8]], bx = [B.p[0], B.p[3], B.p[6]], by = [B.p[1], B.p[4], B.p[7]], bz = [B.p[2], B.p[5], B.p[8]];
        if (Math.max(...ax) < Math.min(...bx) - 1e-4 || Math.max(...bx) < Math.min(...ax) - 1e-4 || Math.max(...ay) < Math.min(...by) - 1e-4 || Math.max(...by) < Math.min(...ay) - 1e-4 || Math.max(...az) < Math.min(...bz) - 1e-4 || Math.max(...bz) < Math.min(...az) - 1e-4) continue;
        // project: drop the dominant normal axis
        const n = A.pl.n, k = Math.abs(n[0]) > Math.abs(n[1]) ? (Math.abs(n[0]) > Math.abs(n[2]) ? 0 : 2) : (Math.abs(n[1]) > Math.abs(n[2]) ? 1 : 2), u = (k + 1) % 3, v = (k + 2) % 3;
        const pa = [0, 1, 2].map((q) => [A.p[q * 3 + u], A.p[q * 3 + v]]), pb = [0, 1, 2].map((q) => [B.p[q * 3 + u], B.p[q * 3 + v]]);
        const ca = area2(pa) < 0 ? pa.reverse() : pa, cb = area2(pb) < 0 ? pb.reverse() : pb;
        const inter = clip(ca, cb); if (inter.length < 3) continue; const ar = Math.abs(area2(inter)) / Math.max(1e-6, Math.abs(n[k])); if (ar < minArea) continue;
        const same = A.pl.raw[0] * B.pl.raw[0] + A.pl.raw[1] * B.pl.raw[1] + A.pl.raw[2] * B.pl.raw[2] > 0;
        hits.push({ same, area: ar, gap: B.pl.d - A.pl.d, n: n.map((x) => +x.toFixed(3)), at: [0, 1, 2].map((q) => +(((A.p[q] + A.p[q + 3] + A.p[q + 6]) / 3).toFixed(2))), a: { col: A.col.map((x) => +x.toFixed(3)), mesh: A.mesh }, b: { col: B.col.map((x) => +x.toFixed(3)), mesh: B.mesh } });
      } }
  }
  return hits;
}
