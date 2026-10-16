// The automatic profile portrait of a core/humanoid@2 Soul, rendered on the CPU (no browser, no GPU): the look is
// composed by the same kit as the world view, posed in its Idle clip, framed straight-on at head and shoulders and
// rasterised with a z-buffer (2x supersampled, per-vertex lambert light on the kit's palette colours). Node only
// (node:zlib); the server runs it in a child process (apps/server/src/portrait/render-worker.mjs).
import * as THREE from 'three';
import {deflateSync} from 'node:zlib';
import {createRig} from '../../../../mars/viewer/app/engine-view/people.ts';
import type {HumanoidKit} from './compose.ts';
import {resolveLook} from './look.ts';

export const PORTRAIT_SIZE = 256;
// A change to framing or light here must bump AUTO_PORTRAIT_STYLE (apps/server/src/portrait/auto-portraits.ts) so stored portraits redraw.
const BG_TOP = [0.86, 0.84, 0.78], BG_BOTTOM = [0.68, 0.66, 0.6]; // linear
const KEY = new THREE.Vector3(0.75, 0.55, -0.35).normalize(), FILL = new THREE.Vector3(0.6, 0.1, 0.8).normalize();

const srgb = (v: number) => { const c = Math.min(1, Math.max(0, v)); return Math.round(255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)); };

/** finish/material.ts PALETTE pattern mask at bind-space point (x, y, z): 1 stripes, 2 checks, 3 knit ribs. */
function patternMask(kind: number, x: number, y: number, z: number) {
  const fract = (v: number) => v - Math.floor(v);
  if (kind === 1) return fract(y * 16) >= 0.5 ? 1 : 0;
  if (kind === 2) { const a = Math.floor(y * 13), b = Math.floor((x + z * 0.6) * 13); return ((a + b) % 2 + 2) % 2; }
  const q = Math.atan2(x, z - 0.04) * 26, t = Math.min(1, Math.max(0, (Math.abs(fract(q) - 0.5) * 2 - 0.25) / 0.5));
  return (t * t * (3 - 2 * t)) * 0.55 + 0.2 * (fract(y * 40) >= 0.5 ? 1 : 0);
}
type Tri = {p: number[]; c: number[]; alt?: number[]; bp?: number[]};
/** Skinned world-space positions, normals and palette colours of one posed mesh, as triangles. */
function trianglesOf(mesh: THREE.SkinnedMesh, out: Tri[], camera: THREE.Vector3, pattern: number) {
  const g = mesh.geometry, P = g.attributes.position, N = g.attributes.normal, J = g.attributes.skinIndex, W = g.attributes.skinWeight, H = g.getAttribute('hinfo');
  const palette = (mesh.material as THREE.Material).userData.humanoid.palette as Float32Array;
  mesh.skeleton.update();
  const bones = mesh.skeleton.boneMatrices!, bind = mesh.bindMatrix, bindInv = mesh.bindMatrixInverse, world = mesh.matrixWorld;
  const n = P.count, pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  const m = new THREE.Matrix4(), acc = new THREE.Matrix4(), full = new THREE.Matrix4(), v = new THREE.Vector3(), nv = new THREE.Vector3(), nm = new THREE.Matrix3();
  for (let i = 0; i < n; i++) {
    acc.elements.fill(0);
    for (let k = 0; k < 4; k++) {
      const w = W.getComponent(i, k); if (!w) continue;
      m.fromArray(bones, J.getComponent(i, k) * 16);
      for (let e = 0; e < 16; e++) acc.elements[e] += m.elements[e] * w;
    }
    full.copy(world).multiply(bindInv).multiply(acc).multiply(bind);
    v.fromBufferAttribute(P, i).applyMatrix4(full); pos.set([v.x, v.y, v.z], i * 3);
    nm.getNormalMatrix(full); nv.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); nor.set([nv.x, nv.y, nv.z], i * 3);
  }
  const I = g.index!, a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), face = new THREE.Vector3(), view = new THREE.Vector3();
  for (let t = 0; t < I.count; t += 3) {
    const ids = [I.getX(t), I.getX(t + 1), I.getX(t + 2)];
    a.fromArray(pos, ids[0] * 3); b.fromArray(pos, ids[1] * 3); c.fromArray(pos, ids[2] * 3);
    face.subVectors(b, a).cross(c.clone().sub(a));
    view.copy(camera).sub(a);
    const flip = face.dot(view) < 0 ? -1 : 1; // double-sided: light the side we see
    const p: number[] = [], col: number[] = [], alt: number[] = [], bp: number[] = [];
    // the material's procedural top pattern (stripes/checks/knit) applies to cloth (role 2) in the top's two colour slots
    const s0 = H ? H.getX(ids[0]) : 0, patterned = pattern > 0 && H && (s0 === 6 || s0 === 7) && H.getY(ids[0]) === 2;
    for (const id of ids) {
      p.push(pos[id * 3], pos[id * 3 + 1], pos[id * 3 + 2]);
      const nx = nor[id * 3] * flip, ny = nor[id * 3 + 1] * flip, nz = nor[id * 3 + 2] * flip;
      const slot = H ? H.getX(id) : 0, light = 0.4 + 0.16 * ny + 0.78 * Math.max(0, nx * KEY.x + ny * KEY.y + nz * KEY.z) + 0.22 * Math.max(0, nx * FILL.x + ny * FILL.y + nz * FILL.z);
      col.push(palette[slot * 3] * light, palette[slot * 3 + 1] * light, palette[slot * 3 + 2] * light);
      if (patterned) { const o = slot === 6 ? 7 : 6; alt.push(palette[o * 3] * light, palette[o * 3 + 1] * light, palette[o * 3 + 2] * light); bp.push(P.getX(id), P.getY(id), P.getZ(id)); }
    }
    out.push(patterned ? {p, c: col, alt, bp} : {p, c: col});
  }
}

/** A straight-on head-and-shoulders portrait of the look as an 8-bit RGB PNG (PORTRAIT_SIZE square). */
export async function humanoidPortraitPNG(kit: HumanoidKit, params: unknown, size = PORTRAIT_SIZE, view: 'portrait' | 'full' | 'side' = 'portrait'): Promise<Uint8Array> {
  const look = resolveLook(params), template = await kit.template(look), rig = createRig(template);
  rig.mixer.update(0.01); rig.holder.updateMatrixWorld(true);
  const meshes: THREE.SkinnedMesh[] = []; rig.model.traverse(o => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh); });
  const headBone = rig.model.getObjectByName('Head'); if (!headBone) throw Error('portrait: rig has no Head bone');
  // The body faces +x (createRig). Frame from the skull, not from hair or hats (a mohawk or a tall hat may be cropped,
  // as in a real portrait): ks = the rig's world scale (neck→head joint is 0.0767 m in kit space), the skull top 0.24 m and
  // the eyes 0.11 m above the head joint (kit landmarks), the eye line ~37 % from the top so a round avatar crop keeps the face.
  const neckBone = rig.model.getObjectByName('Neck'), hp = headBone.getWorldPosition(new THREE.Vector3());
  const ks = (neckBone ? Math.max(0.5, Math.min(2, (hp.y - neckBone.getWorldPosition(new THREE.Vector3()).y) / 0.07673)) : 1) * look.headSize;
  const span = 0.62 * ks, skull = hp.y + 0.24 * ks, cy = skull + 0.16 * span - span / 2, cz = hp.z;
  const pattern = (meshes[0]?.material as THREE.Material | undefined)?.userData.humanoid.pattern.value as number ?? 0, tris: Tri[] = [];
  const fov = 16 * Math.PI / 180, tanH = Math.tan(fov / 2);
  // 'full' and 'side' (whole body, for checking outfits and body shape) frame 2.1 m around the body's middle
  const fullSpan = 2.1, viewSpan = view === 'portrait' ? span : fullSpan, viewY = view === 'portrait' ? cy : 0.98, dist = (viewSpan / 2) / tanH;
  const fwd = view === 'side' ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(-1, 0, 0), right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0));
  const cam = view === 'side' ? new THREE.Vector3(hp.x, viewY, cz + dist) : new THREE.Vector3(hp.x + dist, viewY, cz);
  for (const mesh of meshes) trianglesOf(mesh, tris, cam, pattern);
  const S = size * 2, depth = new Float32Array(S * S).fill(Infinity), rgb = new Float32Array(S * S * 3);
  for (let y = 0; y < S; y++) { const f = y / (S - 1); for (let x = 0; x < S; x++) for (let k = 0; k < 3; k++) rgb[(y * S + x) * 3 + k] = BG_TOP[k] * (1 - f) + BG_BOTTOM[k] * f; }
  const sx = new Float64Array(3), sy = new Float64Array(3), sz = new Float64Array(3);
  for (const t of tris) {
    let behind = false;
    for (let k = 0; k < 3; k++) {
      const rx = t.p[k * 3] - cam.x, ry = t.p[k * 3 + 1] - cam.y, rz = t.p[k * 3 + 2] - cam.z, d = rx * fwd.x + rz * fwd.z;
      if (d < 0.05) { behind = true; break; }
      sx[k] = (((rx * right.x + rz * right.z) / d) / tanH * 0.5 + 0.5) * S; sy[k] = (0.5 - (ry / d) / tanH * 0.5) * S; sz[k] = d;
    }
    if (behind) continue;
    const area = (sx[1] - sx[0]) * (sy[2] - sy[0]) - (sx[2] - sx[0]) * (sy[1] - sy[0]); if (Math.abs(area) < 1e-9) continue;
    const x0 = Math.max(0, Math.floor(Math.min(sx[0], sx[1], sx[2]))), x1 = Math.min(S - 1, Math.ceil(Math.max(sx[0], sx[1], sx[2])));
    const y0 = Math.max(0, Math.floor(Math.min(sy[0], sy[1], sy[2]))), y1 = Math.min(S - 1, Math.ceil(Math.max(sy[0], sy[1], sy[2])));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5;
      const w0 = ((sx[1] - px) * (sy[2] - py) - (sx[2] - px) * (sy[1] - py)) / area, w1 = ((sx[2] - px) * (sy[0] - py) - (sx[0] - px) * (sy[2] - py)) / area, w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const z = w0 * sz[0] + w1 * sz[1] + w2 * sz[2], o = y * S + x; if (z >= depth[o]) continue;
      depth[o] = z;
      let m = 0;
      if (t.bp) { const b = t.bp; m = 0.85 * patternMask(pattern, w0 * b[0] + w1 * b[3] + w2 * b[6], w0 * b[1] + w1 * b[4] + w2 * b[7], w0 * b[2] + w1 * b[5] + w2 * b[8]); }
      for (let k = 0; k < 3; k++) { const base = w0 * t.c[k] + w1 * t.c[3 + k] + w2 * t.c[6 + k]; rgb[o * 3 + k] = t.alt ? base + (w0 * t.alt[k] + w1 * t.alt[3 + k] + w2 * t.alt[6 + k] - base) * m : base; }
    }
  }
  // 2x2 box downsample in linear light, then sRGB rows with the PNG "Sub" filter
  const row = size * 3 + 1, raw = Buffer.alloc(row * size);
  for (let y = 0; y < size; y++) {
    raw[y * row] = 1; let prev = [0, 0, 0];
    for (let x = 0; x < size; x++) for (let k = 0; k < 3; k++) {
      const i = (a: number, b: number) => ((y * 2 + a) * S + x * 2 + b) * 3 + k;
      const v = srgb((rgb[i(0, 0)] + rgb[i(0, 1)] + rgb[i(1, 0)] + rgb[i(1, 1)]) / 4);
      raw[y * row + 1 + x * 3 + k] = (v - prev[k] + 256) & 255; prev[k] = v;
    }
  }
  return encodePNG(size, size, deflateSync(raw, {level: 9}));
}

const CRC = Array.from({length: 256}, (_, n) => { for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
const crc32 = (d: Uint8Array) => { let n = 0xffffffff; for (const b of d) n = CRC[(n ^ b) & 255] ^ (n >>> 8); return (n ^ 0xffffffff) >>> 0; };
function chunk(type: string, data: Uint8Array) {
  const out = Buffer.alloc(12 + data.length); out.writeUInt32BE(data.length, 0); out.write(type, 4, 'ascii'); Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length); return out;
}
function encodePNG(w: number, h: number, idat: Uint8Array): Uint8Array {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array())]);
}
