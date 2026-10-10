// A small vertex-colour geometry builder for L3's mesh halves: everything an entity draws merges
// into one or two BufferGeometries (few draw calls), low-poly with rounded silhouettes (blobs,
// chamfered kerbs and caps, many-sided posts) — the Eden look, never voxel. Owner: L3.
import * as THREE from 'three';

export type V3 = [number, number, number];
export type RGB = [number, number, number];
const tmpC = new THREE.Color();
export function rgb(hex: string, f = 1): RGB { tmpC.set(hex); return [Math.min(1, tmpC.r * f), Math.min(1, tmpC.g * f), Math.min(1, tmpC.b * f)]; }
export function mix(a: RGB, b: RGB, t: number): RGB { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
export function scale(c: RGB, f: number): RGB { return [Math.min(1, c[0] * f), Math.min(1, c[1] * f), Math.min(1, c[2] * f)]; }
/** Deterministic hash → [0,1). */
export function h01(a: number, b = 0, c = 0): number { let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 2147483647)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h = (h ^ (h >>> 16)) >>> 0; return h / 4294967296; }
export const hf = (x: number, z: number, k = 0) => h01(Math.floor(x * 97.3), Math.floor(z * 89.1), k);

let ico1: Float32Array | null = null, ico0: Float32Array | null = null;
function icoPositions(detail: 0 | 1): Float32Array {
  if (detail === 1) return (ico1 ??= (new THREE.IcosahedronGeometry(1, 1).toNonIndexed().attributes.position.array as Float32Array));
  return (ico0 ??= (new THREE.IcosahedronGeometry(1, 0).toNonIndexed().attributes.position.array as Float32Array));
}

export class Soup {
  pos: number[] = []; nor: number[] = []; col: number[] = [];
  get tris() { return this.pos.length / 9; }
  /** One triangle; flat normal unless given per-vertex normals. */
  tri(a: V3, b: V3, c: V3, color: RGB | [RGB, RGB, RGB], normals?: [V3, V3, V3]) {
    let n: [V3, V3, V3];
    if (normals) n = normals;
    else {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      const f: V3 = [nx, ny, nz]; n = [f, f, f];
    }
    const cs = (Array.isArray(color[0]) ? color : [color, color, color]) as [RGB, RGB, RGB];
    for (let k = 0; k < 3; k++) { const p = [a, b, c][k]; this.pos.push(p[0], p[1], p[2]); this.nor.push(n[k][0], n[k][1], n[k][2]); this.col.push(cs[k][0], cs[k][1], cs[k][2]); }
  }
  /** Quad a-b-c-d (counter-clockwise seen from the front). */
  quad(a: V3, b: V3, c: V3, d: V3, color: RGB | [RGB, RGB, RGB, RGB]) {
    const cs = (Array.isArray(color[0]) ? color : [color, color, color, color]) as [RGB, RGB, RGB, RGB];
    this.tri(a, b, c, [cs[0], cs[1], cs[2]]); this.tri(a, c, d, [cs[0], cs[2], cs[3]]);
  }
  /** Upward quad from four ground points (x, y, z) wound so the normal faces up. */
  topQuad(a: V3, b: V3, c: V3, d: V3, color: RGB | [RGB, RGB, RGB, RGB]) {
    const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    if (ny >= 0) this.quad(a, b, c, d, color); else { const cs = (Array.isArray(color[0]) ? color : [color, color, color, color]) as [RGB, RGB, RGB, RGB]; this.quad(a, d, c, b, [cs[0], cs[3], cs[2], cs[1]]); }
  }
  /** Oriented box (centre, size, yaw), optional chamfer on the top edges (rounded look at 12–28 tris). */
  box(c: V3, size: V3, yaw: number, color: RGB, chamfer = 0, top?: RGB) {
    const [w, h, d] = size, co = Math.cos(yaw), si = Math.sin(yaw);
    const P = (x: number, y: number, z: number): V3 => [c[0] + x * co + z * si, c[1] + y, c[2] - x * si + z * co];
    const hx = w / 2, hz = d / 2, y0 = -h / 2, y1 = h / 2, k = Math.min(chamfer, hx * 0.9, hz * 0.9, h * 0.45);
    const tc = top ?? color, sc = scale(color, 0.92);
    if (k <= 0.001) {
      this.quad(P(-hx, y1, hz), P(hx, y1, hz), P(hx, y1, -hz), P(-hx, y1, -hz), tc);
      this.quad(P(-hx, y0, hz), P(hx, y0, hz), P(hx, y1, hz), P(-hx, y1, hz), sc);
      this.quad(P(hx, y0, -hz), P(-hx, y0, -hz), P(-hx, y1, -hz), P(hx, y1, -hz), sc);
      this.quad(P(hx, y0, hz), P(hx, y0, -hz), P(hx, y1, -hz), P(hx, y1, hz), color);
      this.quad(P(-hx, y0, -hz), P(-hx, y0, hz), P(-hx, y1, hz), P(-hx, y1, -hz), color);
      this.quad(P(-hx, y0, -hz), P(hx, y0, -hz), P(hx, y0, hz), P(-hx, y0, hz), scale(color, 0.7));
      return;
    }
    const ym = y1 - k;
    // top (inset), chamfers, sides up to ym
    this.quad(P(-hx + k, y1, hz - k), P(hx - k, y1, hz - k), P(hx - k, y1, -hz + k), P(-hx + k, y1, -hz + k), tc);
    this.quad(P(-hx, ym, hz), P(hx, ym, hz), P(hx - k, y1, hz - k), P(-hx + k, y1, hz - k), mix(tc, sc, 0.5));
    this.quad(P(hx, ym, -hz), P(-hx, ym, -hz), P(-hx + k, y1, -hz + k), P(hx - k, y1, -hz + k), mix(tc, sc, 0.5));
    this.quad(P(hx, ym, hz), P(hx, ym, -hz), P(hx - k, y1, -hz + k), P(hx - k, y1, hz - k), mix(tc, color, 0.5));
    this.quad(P(-hx, ym, -hz), P(-hx, ym, hz), P(-hx + k, y1, hz - k), P(-hx + k, y1, -hz + k), mix(tc, color, 0.5));
    this.quad(P(-hx, y0, hz), P(hx, y0, hz), P(hx, ym, hz), P(-hx, ym, hz), sc);
    this.quad(P(hx, y0, -hz), P(-hx, y0, -hz), P(-hx, ym, -hz), P(hx, ym, -hz), sc);
    this.quad(P(hx, y0, hz), P(hx, y0, -hz), P(hx, ym, -hz), P(hx, ym, hz), color);
    this.quad(P(-hx, y0, -hz), P(-hx, y0, hz), P(-hx, ym, hz), P(-hx, ym, -hz), color);
  }
  /** Box spanning two points (a beam, a rail, a kerb segment): width w, height h, centred on the line, bottom at a/b y. */
  beam(a: V3, b: V3, w: number, h: number, color: RGB, chamfer = 0) {
    const dx = b[0] - a[0], dz = b[2] - a[2], len = Math.hypot(dx, dz);
    if (len < 1e-4) return;
    const dy = b[1] - a[1];
    if (Math.abs(dy) < 0.05 * len) { this.box([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + h / 2, (a[2] + b[2]) / 2], [len, h, w], Math.atan2(-dz, dx), color, chamfer); return; }
    // sloped: a parallelepiped following the slope
    const nx = -dz / len * w / 2, nz = dx / len * w / 2;
    const A0: V3 = [a[0] + nx, a[1], a[2] + nz], A1: V3 = [a[0] - nx, a[1], a[2] - nz], B0: V3 = [b[0] + nx, b[1], b[2] + nz], B1: V3 = [b[0] - nx, b[1], b[2] - nz];
    const up = (p: V3): V3 => [p[0], p[1] + h, p[2]];
    this.topQuad(up(A0), up(B0), up(B1), up(A1), color);
    this.quad(A0, B0, up(B0), up(A0), scale(color, 0.9)); this.quad(B1, A1, up(A1), up(B1), scale(color, 0.9));
    this.quad(A1, A0, up(A0), up(A1), scale(color, 0.85)); this.quad(B0, B1, up(B1), up(B0), scale(color, 0.85));
  }
  /** Vertical cylinder (or frustum) from base point up h, n sides, smooth-shaded sides, flat cap. */
  cyl(base: V3, r: number, h: number, color: RGB, n = 7, rTop = r, cap = true) {
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      const p00: V3 = [base[0] + c0 * r, base[1], base[2] + s0 * r], p01: V3 = [base[0] + c1 * r, base[1], base[2] + s1 * r];
      const p10: V3 = [base[0] + c0 * rTop, base[1] + h, base[2] + s0 * rTop], p11: V3 = [base[0] + c1 * rTop, base[1] + h, base[2] + s1 * rTop];
      const n0: V3 = [c0, 0, s0], n1: V3 = [c1, 0, s1];
      this.tri(p00, p11, p01, color, [n0, n1, n1]); this.tri(p00, p10, p11, color, [n0, n0, n1]);
      if (cap && rTop > 0.001) this.tri([base[0], base[1] + h, base[2]], p11, p10, scale(color, 1.08), [[0, 1, 0], [0, 1, 0], [0, 1, 0]]);
    }
  }
  /** Cylinder between two arbitrary points (wires, braces, poles at an angle). */
  rod(a: V3, b: V3, r: number, color: RGB, n = 5) {
    const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]); const len = d.length(); if (len < 1e-5) return;
    d.divideScalar(len);
    const ref = Math.abs(d.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const u = new THREE.Vector3().crossVectors(d, ref).normalize(), v = new THREE.Vector3().crossVectors(d, u);
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      const o0 = u.clone().multiplyScalar(Math.cos(a0)).add(v.clone().multiplyScalar(Math.sin(a0))), o1 = u.clone().multiplyScalar(Math.cos(a1)).add(v.clone().multiplyScalar(Math.sin(a1)));
      const A0: V3 = [a[0] + o0.x * r, a[1] + o0.y * r, a[2] + o0.z * r], A1: V3 = [a[0] + o1.x * r, a[1] + o1.y * r, a[2] + o1.z * r];
      const B0: V3 = [b[0] + o0.x * r, b[1] + o0.y * r, b[2] + o0.z * r], B1: V3 = [b[0] + o1.x * r, b[1] + o1.y * r, b[2] + o1.z * r];
      const n0: V3 = [o0.x, o0.y, o0.z], n1: V3 = [o1.x, o1.y, o1.z];
      this.tri(A0, B1, A1, color, [n0, n1, n1]); this.tri(A0, B0, B1, color, [n0, n0, n1]);
    }
  }
  /** Cone from base up h (n sides). */
  cone(base: V3, r: number, h: number, color: RGB, n = 7, tip?: RGB) {
    const t: V3 = [base[0], base[1] + h, base[2]], tc = tip ?? scale(color, 1.12);
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2, c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      const k = r / Math.hypot(r, h), ny = r / h * k;
      this.tri([base[0] + c0 * r, base[1], base[2] + s0 * r], t, [base[0] + c1 * r, base[1], base[2] + s1 * r], [color, tc, color], [[c0, ny, s0], [(c0 + c1) / 2, ny, (s0 + s1) / 2], [c1, ny, s1]]);
    }
  }
  /** A rounded blob (icosahedron, detail 1 = 80 tris; 0 = 20), radii per axis, smooth-shaded, with seeded jitter. */
  blob(c: V3, r: V3, color: RGB, detail: 0 | 1 = 1, jitter = 0.12, seed = 0, shade = true) {
    const P = icoPositions(detail);
    const vtx: V3[] = [];
    for (let i = 0; i < P.length; i += 3) {
      const x = P[i], y = P[i + 1], z = P[i + 2];
      const j = 1 + (h01(Math.round(x * 1000) + seed * 7, Math.round(y * 1000), Math.round(z * 1000)) - 0.5) * 2 * jitter;
      vtx.push([c[0] + x * r[0] * j, c[1] + y * r[1] * j, c[2] + z * r[2] * j]);
    }
    for (let i = 0; i < vtx.length; i += 3) {
      const ns = [0, 1, 2].map((k) => { const p = vtx[i + k]; const nx = (p[0] - c[0]) / r[0], ny = (p[1] - c[1]) / r[1], nz = (p[2] - c[2]) / r[2], l = Math.hypot(nx, ny, nz) || 1; return [nx / l, ny / l, nz / l] as V3; }) as [V3, V3, V3];
      const cs = shade ? ns.map((n) => scale(color, 0.82 + 0.28 * (n[1] * 0.5 + 0.5))) as [RGB, RGB, RGB] : color;
      this.tri(vtx[i], vtx[i + 1], vtx[i + 2], cs, ns);
    }
  }
  /** Merge another soup in. */
  add(o: Soup) { this.pos.push(...o.pos); this.nor.push(...o.nor); this.col.push(...o.col); }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

let vcMat: THREE.MeshStandardMaterial | null = null;
/** The shared vertex-colour material for L3 meshes (matte, Eden palette lives in the vertices). */
export function vertexMaterial(): THREE.MeshStandardMaterial {
  return (vcMat ??= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, side: THREE.DoubleSide }));
}
export function soupMesh(s: Soup, name: string, opts: { shadow?: boolean; receive?: boolean } = {}): THREE.Mesh | null {
  if (!s.pos.length) return null;
  const m = new THREE.Mesh(s.geometry(), vertexMaterial());
  m.name = name; m.castShadow = opts.shadow ?? true; m.receiveShadow = opts.receive ?? true; m.userData.cameraTransparent = true;
  return m;
}

// ---------- draping ----------

type Sample = (x: number, z: number) => number;
function inPoly(px: number, pz: number, poly: [number, number][]) { let inside = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > pz) !== (zj > pz) && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) inside = !inside; } return inside; }
function distEdge(px: number, pz: number, poly: [number, number][]) { let b = Infinity; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[j], c = poly[i], vx = c[0] - a[0], vz = c[1] - a[1], n = vx * vx + vz * vz; let t = n ? ((px - a[0]) * vx + (pz - a[1]) * vz) / n : 0; t = t < 0 ? 0 : t > 1 ? 1 : t; b = Math.min(b, Math.hypot(px - a[0] - vx * t, pz - a[1] - vz * t)); } return b; }
/** Clip a polygon to an axis-aligned rectangle (Sutherland–Hodgman). */
function clipRect(poly: [number, number][], x0: number, z0: number, x1: number, z1: number): [number, number][] {
  let out = poly;
  const edges: [(p: [number, number]) => boolean, (a: [number, number], b: [number, number]) => [number, number]][] = [
    [(p) => p[0] >= x0, (a, b) => { const t = (x0 - a[0]) / (b[0] - a[0]); return [x0, a[1] + (b[1] - a[1]) * t]; }],
    [(p) => p[0] <= x1, (a, b) => { const t = (x1 - a[0]) / (b[0] - a[0]); return [x1, a[1] + (b[1] - a[1]) * t]; }],
    [(p) => p[1] >= z0, (a, b) => { const t = (z0 - a[1]) / (b[1] - a[1]); return [a[0] + (b[0] - a[0]) * t, z0]; }],
    [(p) => p[1] <= z1, (a, b) => { const t = (z1 - a[1]) / (b[1] - a[1]); return [a[0] + (b[0] - a[0]) * t, z1]; }],
  ];
  for (const [inside, cut] of edges) {
    const inp = out; out = [];
    for (let i = 0; i < inp.length; i++) {
      const cur = inp[i], prev = inp[(i + inp.length - 1) % inp.length];
      if (inside(cur)) { if (!inside(prev)) out.push(cut(prev, cur)); out.push(cur); } else if (inside(prev)) out.push(cut(prev, cur));
    }
    if (!out.length) return out;
  }
  return out;
}
/**
 * Drape a polygon on the ground as a dense mesh: a grid of `cell` m clipped to the polygon (proper
 * interior triangulation, so it follows hills and hollows), each vertex at ground + lift.
 * `color(x, z, edge)` gives the vertex colour (edge = distance to the outline, for soft borders).
 */
export function drapeArea(s: Soup, poly: [number, number][], cell: number, sample: Sample, lift: number, color: (x: number, z: number, edge: number) => RGB) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of poly) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
  const V = (x: number, z: number): V3 => [x, sample(x, z) + lift, z];
  const C = (x: number, z: number) => color(x, z, distEdge(x, z, poly));
  for (let gz = Math.floor(z0 / cell) * cell; gz < z1; gz += cell) for (let gx = Math.floor(x0 / cell) * cell; gx < x1; gx += cell) {
    const cx = gx + cell / 2, cz = gz + cell / 2;
    const corners: [number, number][] = [[gx, gz], [gx + cell, gz], [gx + cell, gz + cell], [gx, gz + cell]];
    const allIn = corners.every(([x, z]) => inPoly(x, z, poly)) && distEdge(cx, cz, poly) > cell * 0.72;
    if (allIn) { s.topQuad(V(gx, gz), V(gx, gz + cell), V(gx + cell, gz + cell), V(gx + cell, gz), [C(gx, gz), C(gx, gz + cell), C(gx + cell, gz + cell), C(gx + cell, gz)]); continue; }
    const piece = clipRect(poly, gx, gz, gx + cell, gz + cell);
    if (piece.length < 3) continue;
    for (let k = 1; k < piece.length - 1; k++) {
      const a = piece[0], b = piece[k], c = piece[k + 1];
      const A = V(a[0], a[1]), B = V(b[0], b[1]), Cc = V(c[0], c[1]);
      const ny = (B[2] - A[2]) * (Cc[0] - A[0]) - (B[0] - A[0]) * (Cc[2] - A[2]);
      if (ny >= 0) s.tri(A, B, Cc, [C(a[0], a[1]), C(b[0], b[1]), C(c[0], c[1])]); else s.tri(A, Cc, B, [C(a[0], a[1]), C(c[0], c[1]), C(b[0], b[1])]);
    }
  }
}
export { inPoly, distEdge };
