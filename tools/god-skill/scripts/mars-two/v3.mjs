// Shared helpers for the mars-two build: read the private V3 Mars 2026 campus GLB (Codex's Mars handover,
// team/pm-integration/mars-handover-20261010/MARS-HANDOVER.md), map it into the mars-two frame and cut pieces out of it.
//
// Frames
// - V3 (glTF) frame: the campus backdrop as authored (+y up). The Mars world placed it at [40, .16, -30]; its ground is
//   y = -0.16. The Mimos source frame has origin O (V3 xz) and unit axes NORTH / EAST in V3 xz.
// - mars-two frame (the new world): north up = −z, east = +x, ground y = 0, metres. X = E + X0, Z = −N, where (N, E) are
//   metres north/east of the Mimos origin. Every building of the campus is aligned with these axes (the rack grid).
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
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

// MARSFIX: the reference is now the corrected sim.mars.college source itself in TRUE compass (mars-src-fix a5376c1:
// release 43's campus.glb + add2026Details with Gene's Oct-10 corrections on the CAD's own north–south bays), exported by
// fork-backdrop.mjs (campus-owner-<rev>.raw.glb, the same GLB frame as V3). The old V3 export (the first, rotated
// reading) stays readable with MARS_TWO_SRC=v3 (then PARITY's 7d9688f delta applies, as before).
export const OLD_V3_GLB = '<team>/scratch/mars-mimos-binding-20261010/visible-access-export-v3/scene_7d4cac4af33bb32cd069a248611b6dd3fdc2ce072bc77e3f2f336ea5df028b76.glb';
export const SOURCE_REV = 'a5376c10cfab';
export const V3_GLB = process.env.MARS_TWO_SRC === 'v3' ? OLD_V3_GLB : (process.env.MARS_TWO_SRC || '<team>/scratch/mars-truecompass-20261012/campus-owner-a5376c10cfab.raw.glb');
export const V3_SHA = process.env.MARS_TWO_SRC === 'v3' ? '7d4cac4af33bb32cd069a248611b6dd3fdc2ce072bc77e3f2f336ea5df028b76' : 'b52044bb96ec9e472d04900fa1150af82ede94341731f5046da2e2520f0bd250';
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
  if (V3_GLB === OLD_V3_GLB) applyRefDelta(doc);
  return { io, doc };
}

// PARITY: the corrected sim.mars.college source build (7d9688f) moved some V3 pieces (the kitchen prep table, the Mimos
// papasan and clothing rack): ref-7d9688f-delta.json (ref-delta.mjs) holds their world matrices there; each node's local
// matrix is set so its world matrix is the reference's.
export const REF_DELTA = join(ROOT, 'tools/god-skill/scripts/mars-two/ref-7d9688f-delta.json');
export function inv4(m) {
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  const d = 1 / (b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06);
  return [(a11 * b11 - a12 * b10 + a13 * b09) * d, (a02 * b10 - a01 * b11 - a03 * b09) * d, (a31 * b05 - a32 * b04 + a33 * b03) * d, (a22 * b04 - a21 * b05 - a23 * b03) * d,
    (a12 * b08 - a10 * b11 - a13 * b07) * d, (a00 * b11 - a02 * b08 + a03 * b07) * d, (a32 * b02 - a30 * b05 - a33 * b01) * d, (a20 * b05 - a22 * b02 + a23 * b01) * d,
    (a10 * b10 - a11 * b08 + a13 * b06) * d, (a01 * b08 - a00 * b10 - a03 * b06) * d, (a30 * b04 - a31 * b02 + a33 * b00) * d, (a21 * b02 - a20 * b04 - a23 * b00) * d,
    (a11 * b07 - a10 * b09 - a12 * b06) * d, (a00 * b09 - a01 * b07 + a02 * b06) * d, (a31 * b01 - a30 * b03 - a32 * b00) * d, (a20 * b03 - a21 * b01 + a22 * b00) * d];
}
function applyRefDelta(doc) {
  if (!existsSync(REF_DELTA)) return 0;
  const { nodes } = JSON.parse(readFileSync(REF_DELTA, 'utf8'));
  let n = 0;
  for (const node of doc.getRoot().listNodes()) {
    if (!node.getMesh()) continue;
    const d = nodes[`${node.getName()}|${node.getExtras()?.component_id ?? null}`]; if (!d) continue;
    const parent = node.getParentNode(), local = parent ? mul(inv4(parent.getWorldMatrix()), d.m) : d.m;
    node.setMatrix(local); n++;
  }
  if (n !== Object.keys(nodes).length) throw new Error(`ref delta: ${n} of ${Object.keys(nodes).length} nodes found in V3`);
  return n;
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
    let [out] = MeshoptSimplifier.simplifySloppy(I, F, 3, null, target, error);
    // (FURN: a part the error bound collapses to almost nothing gets a larger target, not its full CAD resolution back)
    for (let t = target * 2, k = 0; out.length < 36 && k < 6 && t < n; t *= 2, k++) [out] = MeshoptSimplifier.simplifySloppy(I, F, 3, null, t, error);
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
export async function cut(src, nodeIdx, { name, frame = v3ToLocal(0, 0), tex = 512, maxTris = 60000, compress = true, simplify = null, roof = null, world = null, maxError = 0.01 } = {}) {
  const nodes = src.doc.getRoot().listNodes();
  const pickedIdx = nodeIdx.filter((i) => nodes[i]?.getMesh()), picked = pickedIdx.map((i) => nodes[i]);
  const doc = new core.Document();
  doc.createBuffer();
  const map = fn.copyToDocument(doc, src.doc, picked.map((n) => n.getMesh()));
  // two groups: the body, and `roof` (roofs, ceilings, upper floors), which the viewer hides for the roofs-off view and
  // when the camera is inside (mesh.mesh.ts); meshes are joined per material within each group
  const scene = doc.createScene(name), body = doc.createNode('body'), top = doc.createNode('roof');
  scene.addChild(body); scene.addChild(top);
  // `world`: a corrected world matrix for some nodes (V3 index → matrix), e.g. a rug the reference stood on its edge
  const mats = picked.map((n, k) => mul(frame, world?.get(pickedIdx[k]) ?? n.getWorldMatrix()));
  const tmp = doc.createScene('bounds'), probe = [];
  picked.forEach((n, k) => { const q = doc.createNode('p').setMesh(map.get(n.getMesh())).setMatrix(mats[k]); tmp.addChild(q); probe.push(q); });
  const b = fn.getBounds(tmp);
  for (const q of probe) q.dispose(); tmp.dispose();
  const shift = [(b.min[0] + b.max[0]) / 2, b.min[1], (b.min[2] + b.max[2]) / 2];
  const T = translate(-shift[0], -shift[1], -shift[2]);
  picked.forEach((n, k) => (roof?.(pickedIdx[k]) ? top : body).addChild(doc.createNode(n.getName()).setMesh(map.get(n.getMesh())).setMatrix(mul(T, mats[k]))));
  if (!top.listChildren().length) top.dispose();
  doc.getRoot().getAsset().generator = 'eden mars-two v3 split (gltf-transform)';
  if (simplify) { await MeshoptSimplifier.ready; await doc.transform(fn.dedup()); crush(doc, simplify); await doc.transform(fn.prune()); }
  await doc.transform(fn.dedup(), fn.prune(), fn.join({ keepNamed: false }), fn.weld(), fn.prune());
  const tris = () => doc.getRoot().listMeshes().reduce((s, m) => s + m.listPrimitives().reduce((t, p) => t + Math.floor((p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3), 0), 0);
  const t0 = tris();
  if (t0 > maxTris) { await MeshoptSimplifier.ready; await doc.transform(fn.simplify({ simplifier: MeshoptSimplifier, ratio: maxTris / t0, error: maxError, lockBorder: false }), fn.prune()); }
  // FURN: simplification can drop a piece's outermost vertices (Freeside lost 2.1 m on its west side). The viewer fits a
  // mesh by its own bounds (centred on x/z, base on y = 0), so re-centre on what is left and move the origin with it —
  // otherwise the whole building draws offset from its footprint and furniture (Freeside was 1.07 m west).
  const nb = fn.getBounds(scene), d = [(nb.min[0] + nb.max[0]) / 2, nb.min[1], (nb.min[2] + nb.max[2]) / 2];
  // (only a visible offset, over 2 cm: smaller ones leave released pieces byte-identical)
  if (Math.hypot(d[0], d[2]) > 0.02 || Math.abs(d[1]) > 0.02) {
    for (const g of scene.listChildren()) g.setTranslation([-d[0], -d[1], -d[2]]);
    shift[0] += d[0]; shift[1] += d[1]; shift[2] += d[2];
    b.min = [nb.min[0] - d[0], nb.min[1] - d[1], nb.min[2] - d[2]]; b.max = [nb.max[0] - d[0], nb.max[1] - d[1], nb.max[2] - d[2]];
  }
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
