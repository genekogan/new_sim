// Shared helpers for the mars-two build: read the private V3 Mars 2026 campus GLB (Codex's Mars handover,
// team/pm-integration/mars-handover-20261010/MARS-HANDOVER.md), map it into the mars-two frame and cut pieces out of it.
//
// Frames
// - V3 (glTF) frame: the campus backdrop as authored (+y up). The Mars world placed it at [40, .16, -30]; its ground is
//   y = -0.16. The Mimos source frame has origin O (V3 xz) and unit axes NORTH / EAST in V3 xz.
// - mars-two frame (the new world): north up = −z, east = +x, ground y = 0, metres. X = E + X0, Z = −N, where (N, E) are
//   metres north/east of the Mimos origin. Every building of the campus is aligned with these axes (the rack grid).
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const req = createRequire(join(ROOT, 'node_modules/.pnpm/@gltf-transform+functions@4.5.1_@types+node@22.20.4/node_modules/@gltf-transform/functions/package.json'));
export const core = req('@gltf-transform/core');
export const ext = req('@gltf-transform/extensions');
export const fn = req('@gltf-transform/functions');
export const sharp = createRequire(join(ROOT, 'node_modules/.pnpm/sharp@0.35.4_@types+node@22.20.4/node_modules/sharp/package.json'))('sharp');
const mo = await import(join(ROOT, 'node_modules/.pnpm/meshoptimizer@1.3.0/node_modules/meshoptimizer/index.js'));
export const { MeshoptEncoder, MeshoptSimplifier } = mo;

export const V3_GLB = '<team>/scratch/mars-mimos-binding-20261010/visible-access-export-v3/scene_7d4cac4af33bb32cd069a248611b6dd3fdc2ce072bc77e3f2f336ea5df028b76.glb';
export const V3_SHA = '7d4cac4af33bb32cd069a248611b6dd3fdc2ce072bc77e3f2f336ea5df028b76';
export const O = [2.05645, -8.92635];                       // Mimos native origin [42.05645, .53, -38.92635] minus the backdrop's [40, ., -30]
export const NORTH = [0.4264952019559668, -0.9044898245467106];
export const EAST = [0.9044898245467106, 0.4264952019559668];
export const GROUND_Y = -0.16;                              // V3 ground; native 0
export const X0 = 48;                                       // mars-two x of the Mimos origin (centres the campus)

/** V3 point → (N, E) metres from the Mimos origin. */
export const ne = (x, z) => { const dx = x - O[0], dz = z - O[1]; return [dx * NORTH[0] + dz * NORTH[1], dx * EAST[0] + dz * EAST[1]]; };
/** (N, E) → mars-two (x, z). */
export const xz = (n, e) => [e + X0, -n];
/** The 4×4 (column-major) taking V3 coordinates to mars-two coordinates, then subtracting a piece origin (x, 0, z). */
export function v3ToLocal(ox = 0, oz = 0) {
  // X = (p−O)·EAST + X0 − ox;  Y = y − GROUND_Y;  Z = −(p−O)·NORTH − oz
  const tx = -(O[0] * EAST[0] + O[1] * EAST[1]) + X0 - ox, tz = (O[0] * NORTH[0] + O[1] * NORTH[1]) - oz;
  return [EAST[0], 0, -NORTH[0], 0, 0, 1, 0, 0, EAST[1], 0, -NORTH[1], 0, tx, -GROUND_Y, tz, 1];
}

export async function readV3() {
  const io = new core.NodeIO().registerExtensions(ext.ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
  const doc = await io.read(V3_GLB);
  return { io, doc };
}

export const mul = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
/** Rotation about +y by `yaw` (entity convention: x' = x cos + z sin, z' = −x sin + z cos), column-major. */
export const rotY = (yaw) => { const c = Math.cos(yaw), s = Math.sin(yaw); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]; };
export const translate = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];

/**
 * Heavy untextured CAD parts (a 0.1 m bolt in 5 000 triangles): weld by position only, `simplifySloppy` to `ratio`,
 * then rebuild flat-shaded (each triangle its own normal), which is what a faceted CAD part looks like anyway.
 */
export function crush(doc, { ratio = 0.25, minTris = 300, error = 0.02 } = {}) {
  let before = 0, after = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION'); if (!pos || prim.getMode() !== 4) continue;
    const idx = prim.getIndices(), n = idx ? idx.getCount() : pos.getCount(), tris = Math.floor(n / 3);
    if (tris < minTris) continue;
    const uv = prim.getAttribute('TEXCOORD_0'), U = [], u = [0, 0];
    const key = new Map(), P = [], I = new Uint32Array(n), v = [0, 0, 0];
    for (let k = 0; k < n; k++) { const vi = idx ? idx.getScalar(k) : k; pos.getElement(vi, v); const h = `${Math.round(v[0] * 1e5)},${Math.round(v[1] * 1e5)},${Math.round(v[2] * 1e5)}`; let j = key.get(h); if (j === undefined) { j = P.length / 3; key.set(h, j); P.push(v[0], v[1], v[2]); if (uv) { uv.getElement(vi, u); U.push(u[0], u[1]); } } I[k] = j; }
    const F = new Float32Array(P), target = Math.max(36, Math.floor((n * ratio) / 3) * 3);
    const [out] = MeshoptSimplifier.simplifySloppy(I, F, 3, null, target, error);
    if (out.length < 36 || out.length >= n) continue;
    const pa = new Float32Array(out.length * 3), na = new Float32Array(out.length * 3), ta = uv ? new Float32Array(out.length * 2) : null;
    for (let t = 0; t < out.length; t += 3) {
      const a = out[t] * 3, b = out[t + 1] * 3, c = out[t + 2] * 3;
      const ux = F[b] - F[a], uy = F[b + 1] - F[a + 1], uz = F[b + 2] - F[a + 2], wx = F[c] - F[a], wy = F[c + 1] - F[a + 1], wz = F[c + 2] - F[a + 2];
      let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      for (let q = 0; q < 3; q++) { const o = out[t + q] * 3, d = (t + q) * 3; pa[d] = F[o]; pa[d + 1] = F[o + 1]; pa[d + 2] = F[o + 2]; na[d] = nx; na[d + 1] = ny; na[d + 2] = nz; if (ta) { ta[(t + q) * 2] = U[out[t + q] * 2]; ta[(t + q) * 2 + 1] = U[out[t + q] * 2 + 1]; } }
    }
    for (const sem of prim.listSemantics()) prim.setAttribute(sem, null);
    const buf = doc.getRoot().listBuffers()[0];
    prim.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(pa).setBuffer(buf));
    prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(na).setBuffer(buf));
    if (ta) prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(ta).setBuffer(buf));
    prim.setIndices(null);
    before += tris; after += out.length / 3;
  }
  return { before, after };
}

/**
 * Cut a piece out of V3: the given mesh nodes (V3 node indices), baked into one flat scene through `frame` (V3 →
 * piece frame; default the mars-two frame), then base-centred exactly as the viewer fits a mesh def (bounding-box
 * centre at x = z = 0, lowest point at y = 0). Materials deduplicated, meshes joined per material, textures WebP ≤
 * `tex` px, simplified when over `maxTris`, meshopt-compressed. Returns the bytes and the offset that was removed
 * (`shift`, in the frame), so the caller can place the def where the piece was.
 */
export async function cut(src, nodeIdx, { name, frame = v3ToLocal(0, 0), tex = 512, maxTris = 60000, compress = true, simplify = null } = {}) {
  const nodes = src.doc.getRoot().listNodes();
  const picked = nodeIdx.map((i) => nodes[i]).filter((n) => n && n.getMesh());
  const doc = new core.Document();
  doc.createBuffer();
  const map = fn.copyToDocument(doc, src.doc, picked.map((n) => n.getMesh()));
  const scene = doc.createScene(name), root = doc.createNode(name);
  scene.addChild(root);
  for (const n of picked) root.addChild(doc.createNode(n.getName()).setMesh(map.get(n.getMesh())).setMatrix(mul(frame, n.getWorldMatrix())));
  const b = fn.getBounds(scene);
  const shift = [(b.min[0] + b.max[0]) / 2, b.min[1], (b.min[2] + b.max[2]) / 2];
  root.setTranslation([-shift[0], -shift[1], -shift[2]]);
  doc.getRoot().getAsset().generator = 'eden mars-two v3 split (gltf-transform)';
  if (simplify) { await MeshoptSimplifier.ready; await doc.transform(fn.dedup()); crush(doc, simplify); await doc.transform(fn.prune()); }
  await doc.transform(fn.dedup(), fn.prune(), fn.flatten(), fn.join({ keepNamed: false }), fn.weld(), fn.prune());
  const tris = () => doc.getRoot().listMeshes().reduce((s, m) => s + m.listPrimitives().reduce((t, p) => t + Math.floor((p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3), 0), 0);
  const t0 = tris();
  if (t0 > maxTris) { await MeshoptSimplifier.ready; await doc.transform(fn.simplify({ simplifier: MeshoptSimplifier, ratio: maxTris / t0, error: 0.01, lockBorder: false }), fn.prune()); }
  await doc.transform(fn.textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [tex, tex], quality: 80 }));
  if (compress) { await MeshoptEncoder.ready; await doc.transform(fn.reorder({ encoder: MeshoptEncoder }), fn.quantize(), fn.meshopt({ encoder: MeshoptEncoder, level: 'medium' })); }
  const bufs = doc.getRoot().listBuffers();
  for (const a of doc.getRoot().listAccessors()) a.setBuffer(bufs[0]);
  for (const b of bufs.slice(1)) b.dispose();
  const io = new core.NodeIO().registerExtensions(ext.ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
  const bytes = await io.writeBinary(doc);
  const box = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
  return { bytes, tris: tris(), trisBefore: t0, shift, box };
}

/**
 * Every mesh node of V3 with its box in the Mimos (N, E) frame (8 local-box corners through the world matrix),
 * heights above the native ground, its subtree root under the campus (the building it belongs to) and its extras.
 */
export function indexNodes(src) {
  const nodes = src.doc.getRoot().listNodes();
  const idx = new Map(nodes.map((n, i) => [n, i]));
  const out = [];
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i], mesh = n.getMesh(); if (!mesh) continue;
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const p of mesh.listPrimitives()) { const a = p.getAttribute('POSITION'); const mn = a.getMinNormalized ? a.getMin([]) : a.getMin([]), mx = a.getMax([]); for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], mn[k]); hi[k] = Math.max(hi[k], mx[k]); } }
    const W = n.getWorldMatrix();
    let n0 = Infinity, n1 = -Infinity, e0 = Infinity, e1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const x of [lo[0], hi[0]]) for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]]) {
      const wx = W[0] * x + W[4] * y + W[8] * z + W[12], wy = W[1] * x + W[5] * y + W[9] * z + W[13], wz = W[2] * x + W[6] * y + W[10] * z + W[14];
      const [nn, ee] = ne(wx, wz); n0 = Math.min(n0, nn); n1 = Math.max(n1, nn); e0 = Math.min(e0, ee); e1 = Math.max(e1, ee); y0 = Math.min(y0, wy - GROUND_Y); y1 = Math.max(y1, wy - GROUND_Y);
    }
    // ancestors (indices), root first
    const anc = []; for (let p = n.getParentNode(); p; p = p.getParentNode()) anc.unshift(idx.get(p));
    const ex = n.getExtras() ?? {};
    const tris = mesh.listPrimitives().reduce((t, p) => t + Math.floor((p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3), 0);
    out.push({ i, name: n.getName(), anc, asm: ex.assembly_id ?? null, kind: ex.kind ?? null, layer: ex.layer ?? null, comp: ex.component_id ?? null, n0, n1, e0, e1, y0, y1, cn: (n0 + n1) / 2, ce: (e0 + e1) / 2, tris });
  }
  return out;
}

/** Minimum-area rectangle of 2-D points (convex hull + rotating edges): { c: [x, z], half: [hx, hz], yaw } with the
 *  entity yaw convention (local +x turned by yaw: world dir (cos yaw, −sin yaw)). */
export function minRect(pts) {
  if (pts.length < 3) { const x = pts.map((p) => p[0]), z = pts.map((p) => p[1]); return { c: [(Math.min(...x) + Math.max(...x)) / 2, (Math.min(...z) + Math.max(...z)) / 2], half: [(Math.max(...x) - Math.min(...x)) / 2, (Math.max(...z) - Math.min(...z)) / 2], yaw: 0 }; }
  const P = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const p of P) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
  const H = lo.slice(0, -1).concat(hi.slice(0, -1));
  let best = null;
  const tryAngle = (a) => {
    const c = Math.cos(a), s = Math.sin(a);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [x, z] of H) { const u = x * c + z * s, v = -x * s + z * c; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area - 1e-9) { const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2; best = { area, c: [uc * c - vc * s, uc * s + vc * c], half: [(u1 - u0) / 2, (v1 - v0) / 2], a }; }
  };
  tryAngle(0);
  for (let i = 0; i < H.length; i++) { const p = H[i], q = H[(i + 1) % H.length]; tryAngle(Math.atan2(q[1] - p[1], q[0] - p[0])); }
  // axis u = (cos a, sin a) in (x, z); entity yaw θ has local +x → (cos θ, −sin θ): θ = −a. Normalise to (−π/2, π/2].
  let yaw = -best.a; while (yaw > Math.PI / 2) yaw -= Math.PI; while (yaw <= -Math.PI / 2) yaw += Math.PI;
  return { c: best.c, half: best.half, yaw };
}
/** Horizontal points (mars-two x, z) of a node's vertices (subsampled), through its world matrix. */
export function nodePoints(node, max = 600) {
  const W = node.getWorldMatrix(), out = [], v = [0, 0, 0];
  for (const p of node.getMesh().listPrimitives()) {
    const a = p.getAttribute('POSITION'), n = a.getCount(), step = Math.max(1, Math.floor(n / max));
    for (let k = 0; k < n; k += step) { a.getElement(k, v); const wx = W[0] * v[0] + W[4] * v[1] + W[8] * v[2] + W[12], wz = W[2] * v[0] + W[6] * v[1] + W[10] * v[2] + W[14]; const [nn, ee] = ne(wx, wz); out.push([ee + X0, -nn]); }
  }
  return out;
}
/** Do two { c, half, yaw } rectangles overlap (with tolerance `tol` added to each half)? */
export function rectOverlap(a, b, tol = 0) {
  const ax = (r) => [[Math.cos(r.yaw), -Math.sin(r.yaw)], [Math.sin(r.yaw), Math.cos(r.yaw)]];
  const corners = (r) => { const [u, v] = ax(r), h0 = r.half[0] + tol, h1 = r.half[1] + tol; return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => [r.c[0] + i * h0 * u[0] + j * h1 * v[0], r.c[1] + i * h0 * u[1] + j * h1 * v[1]]); };
  const ca = corners(a), cb = corners(b);
  for (const [x, z] of [...ax(a), ...ax(b)]) {
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const p of ca) { const d = p[0] * x + p[1] * z; a0 = Math.min(a0, d); a1 = Math.max(a1, d); }
    for (const p of cb) { const d = p[0] * x + p[1] * z; b0 = Math.min(b0, d); b1 = Math.max(b1, d); }
    if (a1 < b0 || b1 < a0) return false;
  }
  return true;
}
