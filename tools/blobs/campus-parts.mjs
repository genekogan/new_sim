#!/usr/bin/env node
// Lane W3: the Mars campus as shared parts + placements, with the same look.
//   node tools/blobs/campus-parts.mjs <in.glb> <out.glb> [--report <json>] [--err 0.00025] [--step 0.00025] [--texels 1300]
//     [--cell 24] [--psnr 34]   (debug: --skip tex,flat,fold,join --noposq --nouvq)
// Input: the served campus (/blobs/assets/64/64b8838c….glb, tools/blobs/shrink-campus.mjs output) or the raw
// /browser/campus.glb. Why the old file is 41.8 MB: the CAD export gives every component instance its own baked copy,
// every face its own normal and its own UV island (3.26 M vertices for 1.2 M triangles), 3D-Warehouse fittings carry
// micro-textures repeated every few millimetres, and 6,457 nodes carry provenance extras. Steps, each look-preserving:
//  1. Drop what the mars-2026-map scene always hides (people, context groups, reference objects): never drawn.
//  2. Mip levels the GPU never samples are dropped. Per use (primitive as placed), the finest sampled mip follows
//     from its least dense triangle (texels per metre); --texels (default 1300) is one dpr-2 pixel at the orbit
//     camera's 2 m minimum distance on a 1080-css-pixel-tall view (45° fov). A use whose next-coarser mip is uniform (sd <= 4/255, opaque) gets a
//     solid twin of its material in the texture's mean linear colour (its grain is sub-pixel from every reachable
//     camera); a texture is then downscaled to the finest level any remaining use can sample.
//  3. UVs go where no texture reads them; triangles whose normals all equal the face normal lose NORMAL (glTF: no
//     normals = flat normals; three's GLTFLoader sets flatShading), so faces share their corners; exact weld.
//  4. Congruent meshes become one definition: same topology and every UV set, positions related within 0.2 mm by a
//     similarity (one TRS placement) or an affine map (det > 0; a stretched part: an SVD node pair U·Σ then V^T).
//  5. Simplify every definition with an absolute world-space error bound (--err metres, default 0.25 mm).
//  6. Meshes used once are joined per (parent group, material, vertex layout, --cell metre cell): the irregular
//     custom pieces stay meshes, but as a few hundred streams instead of thousands.
//  7. Leaf extras keep `kind`, groups kind/assembly_id/layer; positions as integer --step metre steps (uint16, step
//     and origin in the placement); UV islands moved by whole tiles under REPEAT and stored uint16 with the range in
//     KHR_texture_transform; textures AVIF where the worst 16x16 block keeps --psnr dB; meshopt; node TRS to 7 digits.
// Look check: team/scratch/t4/w3/tools/{shots,compare}.mjs (paired renders, dpr 1+2). Tools: the worktree's pnpm store.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { brotliCompressSync, constants as Z } from 'node:zlib';

const STORE = new URL('../../node_modules/.pnpm/', import.meta.url).pathname;
const pkg = (prefix, sub) => { const d = readdirSync(STORE).filter((x) => x.startsWith(prefix)).sort().pop(); if (!d) throw Error(`missing ${prefix} in ${STORE}`); return `${STORE}${d}/node_modules/${sub}`; };
const { NodeIO } = await import(`${pkg('@gltf-transform+core@4.5', '@gltf-transform/core')}/dist/index.js`);
const EXT = await import(`${pkg('@gltf-transform+extensions@4.5', '@gltf-transform/extensions')}/dist/index.js`);
const F = await import(`${pkg('@gltf-transform+functions@4.5', '@gltf-transform/functions')}/dist/index.js`);
const { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } = await import(`${pkg('meshoptimizer@1.3', 'meshoptimizer')}/index.js`);
const sharp = (await import(`${pkg('sharp@0.35', 'sharp')}/dist/index.mjs`)).default;

const argv = process.argv.slice(2); const [inPath, outPath] = argv;
const opt = (k, d) => { const i = argv.indexOf(k); return i < 0 ? d : argv[i + 1]; };
const SKIP = new Set((opt('--skip', '') ?? '').split(',').filter(Boolean)); // debugging: tex, flat, fold, join
if (!inPath || !outPath) { console.error('usage: campus-parts.mjs <in.glb> <out.glb> [--report json] [--err m] [--texels n] [--cell m]'); process.exit(2); }
const STEP = +opt('--step', 0.00025), ERR = +opt('--err', 0.00025), TEXELS = +opt('--texels', 1300), CELL = +opt('--cell', 24), COS = 0.9994, SAME = 0.0002, SOLID_SD = 4;
/** packages/engine-mars/src/mars-2026-map.ts: the scene's render-only exclusions (pinned by campus-parts.test.mjs). */
export const HIDE = { kind: ['context_person', 'context_group', 'reference'], assembly: ['people', 'reference-ground'], layer: ['Aerial reference'] };
const KEEP_EXTRAS = ['kind', 'assembly_id', 'layer'];

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(EXT.ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const t0 = Date.now(); const inBytes = readFileSync(inPath);
const doc = await io.readBinary(new Uint8Array(inBytes)); const root = doc.getRoot();
const report = { input: { path: inPath, bytes: inBytes.length, sha256: sha(inBytes) }, options: { err: ERR, texels: TEXELS, cell: CELL }, stages: {} };
function sha(b) { return createHash('sha256').update(b).digest('hex'); }
const usersOf = (m) => m.listParents().filter((p) => p.propertyType === 'Node');
function stage(tag) {
  let v = 0, t = 0, pv = 0, pt = 0;
  for (const m of root.listMeshes()) { let mv = 0, mt = 0; for (const p of m.listPrimitives()) { mv += p.getAttribute('POSITION').getCount(); mt += p.getIndices().getCount() / 3; } const u = usersOf(m).length; v += mv; t += mt; pv += mv * u; pt += mt * u; }
  report.stages[tag] = { nodes: root.listNodes().length, meshes: root.listMeshes().length, primitives: root.listMeshes().reduce((n, m) => n + m.listPrimitives().length, 0), vertices: v, triangles: t, placedVertices: pv, placedTriangles: pt, textures: root.listTextures().length, textureBytes: root.listTextures().reduce((n, x) => n + x.getImage().byteLength, 0) };
}
const prune = () => doc.transform(F.prune({ keepExtras: true, keepLeaves: true, keepAttributes: true }));
stage('input');

// 1 ------------------------------------------------------------------ never-drawn nodes
let hidden = 0;
for (const n of root.listNodes()) { if (n.isDisposed()) continue; const d = n.getExtras(); if (HIDE.kind.includes(d.kind) || HIDE.assembly.includes(d.assembly_id) || HIDE.layer.includes(d.layer)) { const kill = (x) => { for (const c of x.listChildren()) kill(c); x.dispose(); hidden++; }; kill(n); } }
await prune(); await doc.transform(F.dequantize());
// bake each mesh's local rotation/scale (the CAD export's frames and the old quantization volumes) into its vertices,
// so placements are plain translations and congruent parts relate by similarity transforms
let baked = 0;
for (const m of root.listMeshes()) {
  const users = m.listParents().filter((p) => p.propertyType === 'Node'); if (!users.length) continue;
  const r0 = users[0].getRotation(), s0 = users[0].getScale(); if (!users.every((u) => u.getRotation().every((x, i) => x === r0[i]) && u.getScale().every((x, i) => x === s0[i]))) continue;
  if (r0[3] === 1 && s0.every((x) => x === 1)) continue;
  const tmp = doc.createNode().setRotation(r0).setScale(s0); F.transformMesh(m, tmp.getMatrix()); tmp.dispose();
  for (const u of users) u.setRotation([0, 0, 0, 1]).setScale([1, 1, 1]); baked++;
}
report.hiddenNodesDropped = hidden; report.bakedFrames = baked; stage('visible');

// 2 ------------------------------------------------------------------ never-sampled mips, sub-pixel textures
const textureSlots = (mat) => mat ? [['baseColor', mat.getBaseColorTexture(), mat.getBaseColorTextureInfo()], ['normal', mat.getNormalTexture(), mat.getNormalTextureInfo()], ['occlusion', mat.getOcclusionTexture(), mat.getOcclusionTextureInfo()], ['emissive', mat.getEmissiveTexture(), mat.getEmissiveTextureInfo()], ['metallicRoughness', mat.getMetallicRoughnessTexture(), mat.getMetallicRoughnessTextureInfo()]].filter((s) => s[1]) : [];
/** Least texels per metre over a primitive's triangles as drawn by node n. Per triangle the GPU (isotropic filtering,
 * GLTFLoader's default anisotropy 1) picks the mip from the larger screen derivative, i.e. the largest singular value
 * of the world->texel map; facing the camera at distance d, that is sigma_max * pixel size. */
function primDensity(n, p, tex, info) {
  const W = n.getWorldMatrix(); const uvA = p.getAttribute(`TEXCOORD_${info.getTexCoord()}`); if (!uvA) return Infinity;
  const [w, h] = tex.getSize(); const pos = p.getAttribute('POSITION').getArray(), uv = uvA.getArray(), idx = p.getIndices().getArray(); let best = Infinity;
  const wp = (i) => [W[0] * pos[3 * i] + W[4] * pos[3 * i + 1] + W[8] * pos[3 * i + 2], W[1] * pos[3 * i] + W[5] * pos[3 * i + 1] + W[9] * pos[3 * i + 2], W[2] * pos[3 * i] + W[6] * pos[3 * i + 1] + W[10] * pos[3 * i + 2]];
  for (let k = 0; k < idx.length; k += 3) {
    const a = idx[k], b = idx[k + 1], c = idx[k + 2], A = wp(a), B = wp(b), C = wp(c);
    const e1 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], e2 = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    const x1 = Math.hypot(...e1); if (x1 < 1e-5) continue; const x2 = (e1[0] * e2[0] + e1[1] * e2[1] + e1[2] * e2[2]) / x1;
    const y2 = Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]) / x1; if (y2 < 1e-5) continue;
    const du1 = (uv[2 * b] - uv[2 * a]) * w, dv1 = (uv[2 * b + 1] - uv[2 * a + 1]) * h, du2 = (uv[2 * c] - uv[2 * a]) * w, dv2 = (uv[2 * c + 1] - uv[2 * a + 1]) * h;
    // J = D·E^-1 with E = [[x1,x2],[0,y2]]
    const j00 = du1 / x1, j01 = (du2 - j00 * x2) / y2, j10 = dv1 / x1, j11 = (dv2 - j10 * x2) / y2;
    const p0 = j00 * j00 + j10 * j10, q0 = j01 * j01 + j11 * j11, r0 = j00 * j01 + j10 * j11; // J^T J = [[p,r],[r,q]]
    const sigmaMax = Math.sqrt((p0 + q0) / 2 + Math.sqrt(((p0 - q0) / 2) ** 2 + r0 * r0));
    if (sigmaMax < best) best = sigmaMax;
  }
  return best;
}
const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const levelCache = new Map(); // texture -> level -> {sd, opaque, linear}
async function levelStats(t, level) {
  let m = levelCache.get(t); if (!m) levelCache.set(t, (m = new Map())); if (m.has(level)) return m.get(level);
  const [w, h] = t.getSize(), nw = Math.max(1, Math.round(w / 2 ** level)), nh = Math.max(1, Math.round(h / 2 ** level));
  const { data, info } = await sharp(Buffer.from(t.getImage())).resize(nw, nh, { fit: 'fill', kernel: 'lanczos3' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const px = info.width * info.height, mean = [0, 0, 0], lin = [0, 0, 0]; let aMin = 255, sd = 0;
  for (let i = 0; i < px; i++) { for (let c = 0; c < 3; c++) { mean[c] += data[4 * i + c]; lin[c] += srgbToLinear(data[4 * i + c] / 255); } aMin = Math.min(aMin, data[4 * i + 3]); }
  for (let c = 0; c < 3; c++) { mean[c] /= px; lin[c] /= px; let s = 0; for (let i = 0; i < px; i++) s += (data[4 * i + c] - mean[c]) ** 2; sd = Math.max(sd, Math.sqrt(s / px)); }
  const r = { sd, opaque: aMin === 255, linear: lin }; m.set(level, r); return r;
}
// finest level the GPU samples for a density d: log2(d / TEXELS) (TEXELS ~ one dpr-2 pixel at 2 m)
const finestLevel = (d) => (Number.isFinite(d) && d > TEXELS ? Math.floor(Math.log2(d / TEXELS)) : 0);
const tex = { capped: 0, solidUses: 0, solidMaterials: 0, bytesBefore: root.listTextures().reduce((n, x) => n + x.getImage().byteLength, 0), bytesAfter: 0, rows: [] };
const baseOnly = (t) => t.listParents().filter((p) => p.propertyType === 'Material').every((mat) => textureSlots(mat).every(([slot, x]) => x !== t || slot === 'baseColor'));
const solidOf = new Map(); // material -> its solid-colour twin
const keepDensity = new Map(); // texture -> min density over the uses that keep it
for (const m of SKIP.has('tex') ? [] : root.listMeshes()) for (const p of m.listPrimitives()) {
  const mat = p.getMaterial(); const slots = textureSlots(mat); if (!slots.length) continue;
  const users = usersOf(m); const dens = slots.map(([slot, t, info]) => [slot, t, Math.min(...users.map((n) => primDensity(n, p, t, info)))]);
  if (slots.length === 1 && slots[0][0] === 'baseColor' && baseOnly(slots[0][1])) {
    const [, t, d] = dens[0]; const s = await levelStats(t, finestLevel(d) + 1);
    if (s.opaque && s.sd <= SOLID_SD) {
      let twin = solidOf.get(mat);
      if (!twin) { twin = mat.clone().setName(`${mat.getName()} · solid`).setBaseColorTexture(null); const bc = mat.getBaseColorFactor(), lin = (await levelStats(t, 0)).linear; twin.setBaseColorFactor([bc[0] * lin[0], bc[1] * lin[1], bc[2] * lin[2], bc[3]]); solidOf.set(mat, twin); tex.solidMaterials++; }
      p.setMaterial(twin); tex.solidUses++; continue;
    }
  }
  for (const [, t, d] of dens) keepDensity.set(t, Math.min(keepDensity.get(t) ?? Infinity, d));
}
for (const t of SKIP.has('tex') ? [] : root.listTextures()) {
  const d = keepDensity.get(t); if (d === undefined) continue; const L = finestLevel(d); if (L < 1) continue;
  const [w, h] = t.getSize(), nw = Math.max(1, Math.round(w / 2 ** L)), nh = Math.max(1, Math.round(h / 2 ** L)), before = t.getImage().byteLength;
  const out = await sharp(Buffer.from(t.getImage())).resize(nw, nh, { fit: 'fill', kernel: 'lanczos3' }).webp({ quality: 88 }).toBuffer();
  if (out.length >= before) continue;
  t.setImage(new Uint8Array(out)).setMimeType('image/webp'); tex.capped++; tex.rows.push({ name: t.getName(), size: [w, h], to: [nw, nh], texelsPerMetre: Math.round(d), bytes: before, bytesAfter: out.length });
}
await prune();
tex.bytesAfter = root.listTextures().reduce((n, x) => n + x.getImage().byteLength, 0);
report.textures = tex; stage('textures');

// 3 ------------------------------------------------------------------ unread UVs, flat normals, weld
const sampled = (mat) => new Set(textureSlots(mat).map(([, , info]) => info.getTexCoord()));
let uvDropped = 0, flatPrims = 0, splitPrims = 0;
for (const m of root.listMeshes()) for (const p of [...m.listPrimitives()]) {
  const used = sampled(p.getMaterial());
  for (const s of p.listSemantics()) { const k = /^TEXCOORD_(\d+)$/.exec(s); if (k && !used.has(+k[1])) { p.setAttribute(s, null); uvDropped++; } }
  const nA = p.getAttribute('NORMAL'); if (!nA || p.getMode() !== 4) continue;
  const pos = p.getAttribute('POSITION').getArray(), nrm = nA.getArray(), idx = p.getIndices().getArray(); const flat = [], smooth = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    const ux = pos[3 * b] - pos[3 * a], uy = pos[3 * b + 1] - pos[3 * a + 1], uz = pos[3 * b + 2] - pos[3 * a + 2], vx = pos[3 * c] - pos[3 * a], vy = pos[3 * c + 1] - pos[3 * a + 1], vz = pos[3 * c + 2] - pos[3 * a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz);
    let ok = l > 1e-24; if (ok) { nx /= l; ny /= l; nz /= l; for (const v of [a, b, c]) { const ln = Math.hypot(nrm[3 * v], nrm[3 * v + 1], nrm[3 * v + 2]) || 1; if ((nx * nrm[3 * v] + ny * nrm[3 * v + 1] + nz * nrm[3 * v + 2]) / ln < COS) { ok = false; break; } } }
    (ok ? flat : smooth).push(a, b, c);
  }
  if (!flat.length || SKIP.has("flat")) continue;
  if (!smooth.length) { p.setAttribute('NORMAL', null); flatPrims++; continue; }
  const q = p.clone(); q.setAttribute('NORMAL', null);
  const I = (arr) => doc.createAccessor().setType('SCALAR').setArray(pos.length / 3 < 65536 ? new Uint16Array(arr) : new Uint32Array(arr)).setBuffer(p.getIndices().getBuffer());
  q.setIndices(I(flat)); p.setIndices(I(smooth)); m.addPrimitive(q); splitPrims++;
}
await doc.transform(F.weld()); await prune();
report.normals = { uvDropped, flatPrims, splitPrims }; stage('welded');

// 4 ------------------------------------------------------------------ congruent meshes -> one definition
const hashArr = (a) => createHash('sha1').update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)).digest('hex');
const uvKey = (a) => { if (!a) return '-'; const q = new Int32Array(a.length); for (let i = 0; i < a.length; i++) q[i] = Math.round(a[i] * 4096); return hashArr(q); };
const mul = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; };
const worldScale = (n) => { const m = n.getWorldMatrix(); return Math.max(Math.hypot(m[0], m[1], m[2]), Math.hypot(m[4], m[5], m[6]), Math.hypot(m[8], m[9], m[10])); };
const det3 = (T) => T[0] * (T[5] * T[10] - T[9] * T[6]) - T[4] * (T[1] * T[10] - T[9] * T[2]) + T[8] * (T[1] * T[6] - T[5] * T[2]);
function solveAffine(A, B) { // least squares X (3x4) with B ≈ X·[A;1], returned as a glTF column-major 4x4
  const n = A.length / 3, M = Array.from({ length: 4 }, () => new Array(7).fill(0));
  for (let i = 0; i < n; i++) { const a = [A[3 * i], A[3 * i + 1], A[3 * i + 2], 1]; for (let r = 0; r < 4; r++) { for (let c = 0; c < 4; c++) M[r][c] += a[r] * a[c]; for (let c = 0; c < 3; c++) M[r][4 + c] += a[r] * B[3 * i + c]; } }
  for (let c = 0; c < 4; c++) { let p = c; for (let r = c + 1; r < 4; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; if (Math.abs(M[p][c]) < 1e-14) return null; [M[c], M[p]] = [M[p], M[c]]; for (let r = 0; r < 4; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k < 7; k++) M[r][k] -= f * M[c][k]; } }
  const X = (row, col) => M[col][4 + row] / M[col][col];
  return [X(0, 0), X(1, 0), X(2, 0), 0, X(0, 1), X(1, 1), X(2, 1), 0, X(0, 2), X(1, 2), X(2, 2), 0, X(0, 3), X(1, 3), X(2, 3), 1];
}

const closeTo = (a, b) => a.every((x, i) => Math.abs(x - b[i]) <= 1e-6 * (1 + Math.abs(b[i])));
let shearPlacements = 0;
function place(u, w, mesh) {
  u.setMatrix(w); if (closeTo(u.getMatrix(), w)) { u.setMesh(mesh); return; }
  const { U, S, V } = svd3([[w[0], w[4], w[8]], [w[1], w[5], w[9]], [w[2], w[6], w[10]]]);
  u.setTranslation([w[12], w[13], w[14]]).setRotation(quat(U)).setScale(S).setMesh(null);
  const c = doc.createNode(u.getName()).setRotation(quat([[V[0][0], V[1][0], V[2][0]], [V[0][1], V[1][1], V[2][1]], [V[0][2], V[1][2], V[2][2]]])).setMesh(mesh);
  u.addChild(c); shearPlacements++;
  if (!closeTo(c.getWorldMatrix().map((x, i) => x), mul(parentWorld(u), w))) throw Error(`shear placement mismatch at ${u.getName()}`);
}
const parentWorld = (u) => { const p = u.listParents().find((x) => x.propertyType === 'Node'); return p ? p.getWorldMatrix() : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; };
function similarity(U, S, V, A, B) { // s·R with R = U V^T, s = mean singular value; translation from the centroids
  const R = [0, 1, 2].map((r) => [0, 1, 2].map((c) => U[r][0] * V[c][0] + U[r][1] * V[c][1] + U[r][2] * V[c][2])), k = (S[0] + S[1] + S[2]) / 3, n = A.length / 3, ca = [0, 0, 0], cb = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) { ca[c] += A[3 * i + c] / n; cb[c] += B[3 * i + c] / n; }
  const t = [0, 1, 2].map((r) => cb[r] - k * (R[r][0] * ca[0] + R[r][1] * ca[1] + R[r][2] * ca[2]));
  return [k * R[0][0], k * R[1][0], k * R[2][0], 0, k * R[0][1], k * R[1][1], k * R[2][1], 0, k * R[0][2], k * R[1][2], k * R[2][2], 0, t[0], t[1], t[2], 1];
}
function svd3(L) { // L = U diag(S) V^T with U, V proper rotations (det L > 0)
  const LtL = [0, 1, 2].map((i) => [0, 1, 2].map((j) => L[0][i] * L[0][j] + L[1][i] * L[1][j] + L[2][i] * L[2][j]));
  const A = LtL.map((r) => [...r]), V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0; for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) off += A[i][j] ** 2; if (off < 1e-30) break;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) {
      if (Math.abs(A[p][q]) < 1e-300) continue; const th = (A[q][q] - A[p][p]) / (2 * A[p][q]); const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) { const akp = A[k][p], akq = A[k][q]; A[k][p] = c * akp - s * akq; A[k][q] = s * akp + c * akq; }
      for (let k = 0; k < 3; k++) { const apk = A[p][k], aqk = A[q][k]; A[p][k] = c * apk - s * aqk; A[q][k] = s * apk + c * aqk; }
      for (let k = 0; k < 3; k++) { const vkp = V[k][p], vkq = V[k][q]; V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq; }
    }
  }
  const detV = V[0][0] * (V[1][1] * V[2][2] - V[1][2] * V[2][1]) - V[0][1] * (V[1][0] * V[2][2] - V[1][2] * V[2][0]) + V[0][2] * (V[1][0] * V[2][1] - V[1][1] * V[2][0]);
  if (detV < 0) for (let k = 0; k < 3; k++) V[k][2] = -V[k][2];
  const S = [0, 1, 2].map((i) => Math.sqrt(Math.max(A[i][i], 0)));
  const U = [0, 1, 2].map((r) => [0, 1, 2].map((c) => (L[r][0] * V[0][c] + L[r][1] * V[1][c] + L[r][2] * V[2][c]) / S[c]));
  return { U, S, V };
}
function quat(R) { // rotation matrix (rows) -> [x,y,z,w]
  const t = R[0][0] + R[1][1] + R[2][2]; let x, y, z, w;
  if (t > 0) { const s = 0.5 / Math.sqrt(t + 1); w = 0.25 / s; x = (R[2][1] - R[1][2]) * s; y = (R[0][2] - R[2][0]) * s; z = (R[1][0] - R[0][1]) * s; }
  else if (R[0][0] > R[1][1] && R[0][0] > R[2][2]) { const s = 2 * Math.sqrt(1 + R[0][0] - R[1][1] - R[2][2]); w = (R[2][1] - R[1][2]) / s; x = 0.25 * s; y = (R[0][1] + R[1][0]) / s; z = (R[0][2] + R[2][0]) / s; }
  else if (R[1][1] > R[2][2]) { const s = 2 * Math.sqrt(1 + R[1][1] - R[0][0] - R[2][2]); w = (R[0][2] - R[2][0]) / s; x = (R[0][1] + R[1][0]) / s; y = 0.25 * s; z = (R[1][2] + R[2][1]) / s; }
  else { const s = 2 * Math.sqrt(1 + R[2][2] - R[0][0] - R[1][1]); w = (R[1][0] - R[0][1]) / s; x = (R[0][2] + R[2][0]) / s; y = (R[1][2] + R[2][1]) / s; z = 0.25 * s; }
  const l = Math.hypot(x, y, z, w); return [x / l, y / l, z / l, w / l];
}
const groups = new Map();
for (const m of root.listMeshes()) { if (!usersOf(m).length) continue; const k = m.listPrimitives().map((p) => [hashArr(p.getIndices().getArray()), p.listSemantics().sort().join(','), p.getAttribute('POSITION').getCount(), p.listSemantics().filter((x) => x !== 'POSITION' && x !== 'NORMAL').sort().map((x) => x + '=' + uvKey(p.getAttribute(x).getArray())).join(';'), p.getMaterial() ? root.listMaterials().indexOf(p.getMaterial()) : -1].join(':')).join('|'); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(m); }
let shared = 0;
for (const list of SKIP.has('fold') ? [] : groups.values()) {
  const reps = [];
  for (const m of list) {
    const users = usersOf(m); let placed = false; const s = Math.max(...users.map(worldScale));
    const within = (rep, T) => { for (let k = 0; k < rep.listPrimitives().length; k++) { const a = rep.listPrimitives()[k].getAttribute('POSITION').getArray(), b = m.listPrimitives()[k].getAttribute('POSITION').getArray(); for (let i = 0; i < a.length / 3; i++) { const x = T[0] * a[3 * i] + T[4] * a[3 * i + 1] + T[8] * a[3 * i + 2] + T[12] - b[3 * i], y = T[1] * a[3 * i] + T[5] * a[3 * i + 1] + T[9] * a[3 * i + 2] + T[13] - b[3 * i + 1], z = T[2] * a[3 * i] + T[6] * a[3 * i + 1] + T[10] * a[3 * i + 2] + T[14] - b[3 * i + 2]; if (Math.hypot(x, y, z) * s > SAME) return false; } } return true; };
    for (const rep of reps) {
      const pa = rep.listPrimitives(), pb = m.listPrimitives(), A0 = pa[0].getAttribute('POSITION').getArray(), B0 = pb[0].getAttribute('POSITION').getArray(); const Ta = solveAffine(A0, B0);
      if (!Ta || det3(Ta) <= 1e-12) continue;
      const { U, S, V } = svd3([[Ta[0], Ta[4], Ta[8]], [Ta[1], Ta[5], Ta[9]], [Ta[2], Ta[6], Ta[10]]]); if (Math.min(...S) < 1e-3 * Math.max(...S)) continue; // degenerate (flat) fit
      // prefer the nearest similarity (rotation x uniform scale): placements stay plain TRS nodes; else the affine map
      const sim = similarity(U, S, V, A0, B0), Ts = within(rep, sim) ? sim : within(rep, Ta) ? Ta : null; if (!Ts) continue; const T = Ts;
      let ok = true;
      if (ok) { // normals must follow the inverse-transpose of the map
        const L = [[T[0], T[4], T[8]], [T[1], T[5], T[9]], [T[2], T[6], T[10]]], d = det3(T);
        const N = [[L[1][1] * L[2][2] - L[1][2] * L[2][1], L[1][2] * L[2][0] - L[1][0] * L[2][2], L[1][0] * L[2][1] - L[1][1] * L[2][0]], [L[0][2] * L[2][1] - L[0][1] * L[2][2], L[0][0] * L[2][2] - L[0][2] * L[2][0], L[0][1] * L[2][0] - L[0][0] * L[2][1]], [L[0][1] * L[1][2] - L[0][2] * L[1][1], L[0][2] * L[1][0] - L[0][0] * L[1][2], L[0][0] * L[1][1] - L[0][1] * L[1][0]]].map((r) => r.map((x) => x / d)); // cofactor/det = (L^-1)^T
        for (let k = 0; k < pa.length && ok; k++) { const na = pa[k].getAttribute('NORMAL')?.getArray(), nb = pb[k].getAttribute('NORMAL')?.getArray(); if (!na || !nb) continue; for (let i = 0; i < na.length / 3; i++) { const x = N[0][0] * na[3 * i] + N[0][1] * na[3 * i + 1] + N[0][2] * na[3 * i + 2], y = N[1][0] * na[3 * i] + N[1][1] * na[3 * i + 1] + N[1][2] * na[3 * i + 2], z = N[2][0] * na[3 * i] + N[2][1] * na[3 * i + 1] + N[2][2] * na[3 * i + 2]; const l = Math.hypot(x, y, z) * (Math.hypot(nb[3 * i], nb[3 * i + 1], nb[3 * i + 2]) || 1); if (!(l > 0) || (x * nb[3 * i] + y * nb[3 * i + 1] + z * nb[3 * i + 2]) / l < 0.999) { ok = false; break; } } }
      }
      if (!ok) continue;
      // glTF nodes are TRS: a placement whose map has shear (a part stretched along a rotated axis) becomes two nodes,
      // U·Σ on the placement and V^T on a child that holds the shared mesh (SVD of the linear part)
      for (const u of users) place(u, mul(u.getMatrix(), T), rep);
      shared++; placed = true; break;
    }
    if (!placed) reps.push(m);
  }
}
await prune();
report.sharedDefinitions = { meshesFolded: shared, shearPlacements }; stage('deduped');

// 5 ------------------------------------------------------------------ absolute-error simplification
if (ERR > 0) {
  for (const m of root.listMeshes()) {
    const s = Math.max(...usersOf(m).map(worldScale), 1e-9);
    for (const p of [...m.listPrimitives()]) {
      if (p.getMode() !== 4) continue;
      const pos = p.getAttribute('POSITION').getArray(), idx = new Uint32Array(p.getIndices().getArray()), nv = pos.length / 3;
      const extra = p.listSemantics().filter((x) => x === 'NORMAL' || /^TEXCOORD_\d$/.test(x)).map((x) => [x, p.getAttribute(x)]);
      let out;
      if (extra.length) {
        const as = extra.reduce((n, [, a]) => n + a.getElementSize(), 0), at = new Float32Array(nv * as), wts = [];
        let o = 0; for (const [x, a] of extra) { const arr = a.getArray(), e = a.getElementSize(); for (let i = 0; i < nv; i++) for (let c = 0; c < e; c++) at[i * as + o + c] = arr[i * e + c]; for (let c = 0; c < e; c++) wts.push(x === 'NORMAL' ? 0.5 : 1); o += e; }
        out = MeshoptSimplifier.simplifyWithAttributes(idx, pos, 3, at, as, wts, null, 0, ERR / s, ['ErrorAbsolute'])[0];
      } else out = MeshoptSimplifier.simplify(idx, pos, 3, 0, ERR / s, ['ErrorAbsolute'])[0];
      if (!out.length) { p.dispose(); continue; }
      if (out.length < idx.length) { p.getIndices().setArray(nv < 65536 ? new Uint16Array(out) : out); F.compactPrimitive(p); }
    }
    if (!m.listPrimitives().length) { for (const n of usersOf(m)) n.setMesh(null); m.dispose(); }
  }
  await prune(); stage('simplified');
}

// 6 ------------------------------------------------------------------ join meshes used once, per parent/material/cell
const parentOf = (n) => n.listParents().find((p) => p.propertyType === 'Node') ?? null;
const buckets = new Map(); let singles = 0;
for (const n of root.listNodes()) {
  const m = n.getMesh(); if (!m || usersOf(m).length !== 1 || n.listChildren().length) continue; const parent = parentOf(n); if (!parent) continue;
  const W = n.getWorldMatrix(); singles++;
  for (const p of m.listPrimitives()) {
    const key = [root.listNodes().indexOf(parent), p.getMaterial() ? root.listMaterials().indexOf(p.getMaterial()) : -1, p.listSemantics().sort().join(','), p.getMode(), Math.floor(W[12] / CELL), Math.floor(W[14] / CELL)].join('|');
    if (!buckets.has(key)) buckets.set(key, { parent, items: [] }); buckets.get(key).items.push({ node: n, prim: p });
  }
}
let joinedNodes = 0, joinedMeshes = 0;
const doneNodes = new Set();
for (const { parent, items } of SKIP.has('join') ? [] : buckets.values()) {
  if (items.length < 2) continue;
  const local = (n) => mul(invert(parent.getWorldMatrix()), n.getWorldMatrix());
  const prims = items.map(({ node, prim }) => { const q = prim.clone(); F.transformPrimitive(q, local(node)); return q; });
  const joined = F.joinPrimitives(prims); for (const q of prims) q.dispose();
  const mesh = doc.createMesh(`${parent.getName()} · joined`).addPrimitive(joined);
  const extras = {}; for (const k of KEEP_EXTRAS) { const vals = new Set(items.map(({ node }) => node.getExtras()[k])); if (vals.size === 1 && [...vals][0] !== undefined) extras[k] = [...vals][0]; }
  parent.addChild(doc.createNode(`${parent.getName()} · ${joined.getMaterial()?.getName() ?? 'default'} · ${items.length}`).setMesh(mesh).setExtras({ ...extras, joined: items.length }));
  joinedMeshes++;
  for (const { node, prim } of items) { prim.dispose(); doneNodes.add(node); }
}
for (const n of doneNodes) { const m = n.getMesh(); if (m && !m.listPrimitives().length) { n.setMesh(null); m.dispose(); } if (!n.getMesh() && !n.listChildren().length) { n.dispose(); joinedNodes++; } }
await prune();
report.joined = { singleUseNodes: singles, nodesRemoved: joinedNodes, joinedMeshes }; stage('joined');
function invert(m) { // general 4x4 inverse (column-major)
  const inv = new Array(16), a = m;
  inv[0] = a[5] * a[10] * a[15] - a[5] * a[11] * a[14] - a[9] * a[6] * a[15] + a[9] * a[7] * a[14] + a[13] * a[6] * a[11] - a[13] * a[7] * a[10];
  inv[4] = -a[4] * a[10] * a[15] + a[4] * a[11] * a[14] + a[8] * a[6] * a[15] - a[8] * a[7] * a[14] - a[12] * a[6] * a[11] + a[12] * a[7] * a[10];
  inv[8] = a[4] * a[9] * a[15] - a[4] * a[11] * a[13] - a[8] * a[5] * a[15] + a[8] * a[7] * a[13] + a[12] * a[5] * a[11] - a[12] * a[7] * a[9];
  inv[12] = -a[4] * a[9] * a[14] + a[4] * a[10] * a[13] + a[8] * a[5] * a[14] - a[8] * a[6] * a[13] - a[12] * a[5] * a[10] + a[12] * a[6] * a[9];
  inv[1] = -a[1] * a[10] * a[15] + a[1] * a[11] * a[14] + a[9] * a[2] * a[15] - a[9] * a[3] * a[14] - a[13] * a[2] * a[11] + a[13] * a[3] * a[10];
  inv[5] = a[0] * a[10] * a[15] - a[0] * a[11] * a[14] - a[8] * a[2] * a[15] + a[8] * a[3] * a[14] + a[12] * a[2] * a[11] - a[12] * a[3] * a[10];
  inv[9] = -a[0] * a[9] * a[15] + a[0] * a[11] * a[13] + a[8] * a[1] * a[15] - a[8] * a[3] * a[13] - a[12] * a[1] * a[11] + a[12] * a[3] * a[9];
  inv[13] = a[0] * a[9] * a[14] - a[0] * a[10] * a[13] - a[8] * a[1] * a[14] + a[8] * a[2] * a[13] + a[12] * a[1] * a[10] - a[12] * a[2] * a[9];
  inv[2] = a[1] * a[6] * a[15] - a[1] * a[7] * a[14] - a[5] * a[2] * a[15] + a[5] * a[3] * a[14] + a[13] * a[2] * a[7] - a[13] * a[3] * a[6];
  inv[6] = -a[0] * a[6] * a[15] + a[0] * a[7] * a[14] + a[4] * a[2] * a[15] - a[4] * a[3] * a[14] - a[12] * a[2] * a[7] + a[12] * a[3] * a[6];
  inv[10] = a[0] * a[5] * a[15] - a[0] * a[7] * a[13] - a[4] * a[1] * a[15] + a[4] * a[3] * a[13] + a[12] * a[1] * a[7] - a[12] * a[3] * a[5];
  inv[14] = -a[0] * a[5] * a[14] + a[0] * a[6] * a[13] + a[4] * a[1] * a[14] - a[4] * a[2] * a[13] - a[12] * a[1] * a[6] + a[12] * a[2] * a[5];
  inv[3] = -a[1] * a[6] * a[11] + a[1] * a[7] * a[10] + a[5] * a[2] * a[11] - a[5] * a[3] * a[10] - a[9] * a[2] * a[7] + a[9] * a[3] * a[6];
  inv[7] = a[0] * a[6] * a[11] - a[0] * a[7] * a[10] - a[4] * a[2] * a[11] + a[4] * a[3] * a[10] + a[8] * a[2] * a[7] - a[8] * a[3] * a[6];
  inv[11] = -a[0] * a[5] * a[11] + a[0] * a[7] * a[9] + a[4] * a[1] * a[11] - a[4] * a[3] * a[9] - a[8] * a[1] * a[7] + a[8] * a[3] * a[5];
  inv[15] = a[0] * a[5] * a[10] - a[0] * a[6] * a[9] - a[4] * a[1] * a[10] + a[4] * a[2] * a[9] + a[8] * a[1] * a[6] - a[8] * a[2] * a[5];
  const det = a[0] * inv[0] + a[1] * inv[4] + a[2] * inv[8] + a[3] * inv[12]; return inv.map((x) => x / det);
}

// 7 ------------------------------------------------------------------ extras, quantization, textures, meshopt
// Leaves keep only `kind`; groups keep kind/assembly_id/layer (the hide rules match groups, which hide their subtree).
for (const n of root.listNodes()) { const e = n.getExtras(), keep = {}; for (const k of n.listChildren().length ? KEEP_EXTRAS : ['kind']) if (e[k] !== undefined) keep[k] = e[k]; n.setExtras(keep); }
for (const m of root.listMeshes()) m.setExtras({});
root.getAsset().extras = { 'campus-parts/1': { source: report.input.sha256, err: ERR, texels: TEXELS, cell: CELL, step: STEP, hidden: HIDE } };
stage('extras');
await doc.transform(F.reorder({ encoder: MeshoptEncoder, level: 'high' }));
stage('reordered');
// positions: integer steps of --step metres (as placed), uint16, the step and origin folded into each placement's matrix
const quant = doc.createExtension(EXT.KHRMeshQuantization).setRequired(true); void quant;
let qMeshes = 0, qCoarse = 0;
for (const m of argv.includes('--noposq') ? [] : root.listMeshes()) {
  const users = usersOf(m); if (!users.length) continue; const accs = [...new Set(m.listPrimitives().map((p) => p.getAttribute('POSITION')))];
  if (accs.some((a) => a.listParents().some((p) => p.propertyType === 'Primitive' && !m.listPrimitives().includes(p)))) continue;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const a of accs) { const v = a.getArray(); for (let i = 0; i < v.length; i++) { const c = i % 3; if (v[i] < lo[c]) lo[c] = v[i]; if (v[i] > hi[c]) hi[c] = v[i]; } }
  const s = Math.max(...users.map(worldScale)); let step = STEP / s; const ext = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]); if (ext / step > 65535) { step = ext / 65535; qCoarse++; }
  for (const a of accs) { const v = a.getArray(), q = new Uint16Array(v.length); for (let i = 0; i < v.length; i++) q[i] = Math.round((v[i] - lo[i % 3]) / step); a.setArray(q).setNormalized(false); }
  const T = [step, 0, 0, 0, 0, step, 0, 0, 0, 0, step, 0, lo[0], lo[1], lo[2], 1];
  for (const u of users) u.setMatrix(mul(u.getMatrix(), T)); qMeshes++;
}
// UVs: under REPEAT every UV island may move by whole tiles; then uint16 normalized with the material's range in
// KHR_texture_transform (precision kept at 1/8 texel of the largest texture the material samples)
const xform = doc.createExtension(EXT.KHRTextureTransform).setRequired(true);
let uvMats = 0, uvShifted = 0; const uvSkip = { none: 0, ext: 0, texcoord: 0, type: 0, precision: 0 };
for (const mat of argv.includes('--nouvq') ? [] : root.listMaterials()) {
  const slots = textureSlots(mat); if (!slots.length) { uvSkip.none++; continue; } if (mat.listExtensions().some((e) => e.extensionName === 'KHR_materials_specular' && (e.getSpecularTexture() || e.getSpecularColorTexture()))) { uvSkip.ext++; continue; }
  if (slots.some(([, , info]) => info.getTexCoord() !== 0 || info.getExtension('KHR_texture_transform'))) { uvSkip.texcoord++; continue; }
  const prims = mat.listParents().filter((p) => p.propertyType === 'Primitive'); if (!prims.length) continue;
  const repeat = slots.every(([, , info]) => info.getWrapS() === 10497 && info.getWrapT() === 10497);
  const accs = new Map(); for (const p of prims) { const a = p.getAttribute('TEXCOORD_0'); if (!a) continue; if (!accs.has(a)) accs.set(a, []); accs.get(a).push(p); }
  if ([...accs.keys()].some((a) => a.getComponentType() !== 5126 || a.listParents().some((p) => p.propertyType === 'Primitive' && p.getMaterial() !== mat))) { uvSkip.type++; continue; }
  if (repeat) for (const [a, ps] of accs) { // union-find islands over triangles, shift each to its lowest whole tile
    const uv = a.getArray(), n = uv.length / 2, up = new Int32Array(n).map((_, i) => i); const find = (x) => { while (up[x] !== x) x = up[x] = up[up[x]]; return x; };
    for (const p of ps) { const idx = p.getIndices().getArray(); for (let k = 0; k < idx.length; k += 3) { const r = find(idx[k]); up[find(idx[k + 1])] = r; up[find(idx[k + 2])] = r; } }
    const mu = new Map(); for (let i = 0; i < n; i++) { const r = find(i), o = mu.get(r); if (!o) mu.set(r, [uv[2 * i], uv[2 * i + 1]]); else { o[0] = Math.min(o[0], uv[2 * i]); o[1] = Math.min(o[1], uv[2 * i + 1]); } }
    const out = new Float32Array(uv); for (let i = 0; i < n; i++) { const o = mu.get(find(i)); out[2 * i] -= Math.floor(o[0]); out[2 * i + 1] -= Math.floor(o[1]); } a.setArray(out); uvShifted++;
  }
  let lo = 0, hi = 0; for (const a of accs.keys()) for (const x of a.getArray()) { if (x < lo) lo = x; if (x > hi) hi = x; }
  const R = 2 ** Math.ceil(Math.log2(Math.max(hi - lo, 1e-6))), texels = Math.max(...slots.map(([, t]) => Math.max(...t.getSize())));
  if (R / 65535 > 1 / (8 * texels)) { uvSkip.precision++; continue; }
  for (const a of accs.keys()) { const v = a.getArray(), q = new Uint16Array(v.length); for (let i = 0; i < v.length; i++) q[i] = Math.round((v[i] - lo) / R * 65535); a.setArray(q).setNormalized(true); }
  for (const [, , info] of slots) info.setExtension('KHR_texture_transform', xform.createTransform().setOffset([lo, lo]).setScale([R, R]));
  uvMats++;
}
await doc.transform(F.quantize({ pattern: argv.includes('--noposq') ? /^(POSITION|NORMAL)$/ : /^NORMAL$/, quantizePosition: 16, quantizeNormal: 10, quantizationVolume: 'mesh', cleanup: false }));
report.quantization = { step: STEP, meshes: qMeshes, coarseMeshes: qCoarse, uvMaterials: uvMats, uvShiftedAccessors: uvShifted, uvSkip };
// textures: AVIF at the lowest quality whose worst 16x16 block keeps PSNR >= --psnr dB against the current pixels, if smaller
const PSNR = +opt('--psnr', 34); let avif = 0;
if (PSNR > 0) {
  const ext = doc.createExtension(EXT.EXTTextureAVIF).setRequired(true); void ext;
  for (const t of root.listTextures()) {
    const src = Buffer.from(t.getImage()), { data: ref, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    // score = the worst 16x16 block's PSNR (a global PSNR hides a smeared detail region in an otherwise smooth image)
    const score = async (b) => { const d = await sharp(b).ensureAlpha().raw().toBuffer(); if (d.length !== ref.length) return 0; let worst = 99;
      for (let by = 0; by < info.height; by += 16) for (let bx = 0; bx < info.width; bx += 16) { let se = 0, n = 0; for (let y = by; y < Math.min(by + 16, info.height); y++) for (let x = bx; x < Math.min(bx + 16, info.width); x++) { const i = 4 * (y * info.width + x); for (let c = 0; c < 4; c++) { se += (d[i + c] - ref[i + c]) ** 2; n++; } } if (se) worst = Math.min(worst, 10 * Math.log10(255 * 255 * n / se)); }
      return worst; };
    let best = null, lo = 20, hi = 90;
    while (lo <= hi) { const q = (lo + hi) >> 1; const b = await sharp(src).avif({ quality: q, effort: 6 }).toBuffer(); if (await score(b) >= PSNR) { best = b; hi = q - 1; } else lo = q + 1; }
    if (best && best.length < src.length) { t.setImage(new Uint8Array(best)).setMimeType('image/avif'); avif++; }
  }
}
report.textures.avif = avif; report.textures.bytesFinal = root.listTextures().reduce((n, x) => n + x.getImage().byteLength, 0);
await prune();
const mo = root.listExtensionsUsed().find((e) => e.extensionName === 'EXT_meshopt_compression') ?? doc.createExtension(EXT.EXTMeshoptCompression);
mo.setRequired(true).setEncoderOptions({ method: 'filter' });
stage('output');
const bytes = compactJSON(await io.writeBinary(doc)); writeFileSync(outPath, bytes);
/** Node transforms to 7 significant digits (0.01 mm at 200 m; rotations 1e-7): same placements, a third of the JSON. */
function compactJSON(glb) {
  const b = Buffer.from(glb), n = b.readUInt32LE(12), json = JSON.parse(b.subarray(20, 20 + n).toString('utf8')), rest = b.subarray(20 + n);
  const r = (x) => +x.toPrecision(7);
  for (const node of json.nodes ?? []) for (const k of ['translation', 'rotation', 'scale', 'matrix']) if (node[k]) node[k] = node[k].map(r);
  let text = Buffer.from(JSON.stringify(json), 'utf8'); const pad = (4 - (text.length % 4)) % 4; text = Buffer.concat([text, Buffer.alloc(pad, 0x20)]);
  const head = Buffer.alloc(20); head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(20 + text.length + rest.length, 8); head.writeUInt32LE(text.length, 12); head.writeUInt32LE(0x4e4f534a, 16);
  return Buffer.concat([head, text, rest]);
}
const br = brotliCompressSync(bytes, { params: { [Z.BROTLI_PARAM_QUALITY]: 11, [Z.BROTLI_PARAM_SIZE_HINT]: bytes.length } }).length;
report.output = { path: outPath, bytes: bytes.length, br11: br, sha256: sha(bytes) }; report.seconds = (Date.now() - t0) / 1000;
const rp = opt('--report', null); if (rp) writeFileSync(rp, JSON.stringify(report, null, 1));
console.log(JSON.stringify({ stages: report.stages, textures: { capped: tex.capped, solidUses: tex.solidUses, solidMaterials: tex.solidMaterials, bytesBefore: tex.bytesBefore, bytesAfter: tex.bytesAfter }, output: report.output, seconds: report.seconds }, null, 1));
