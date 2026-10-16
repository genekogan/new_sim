// Hats, glasses and bags: small low-poly, flat-shaded props built in code (zero downloads, zero textures),
// fitted to the composed head/torso from kit landmarks, and skinned rigidly to one bone (Head, Chest or Hips)
// so they merge into the part's geometry and draw with it (no extra draw call).
import * as THREE from 'three';
import {SLOTS, type Look} from './look.ts';

export type HeadFit = {cz: number; rx: number; rz: number; top: number; eye: [number, number, number]; eyeX: number; templeX: number};
export type TorsoFit = {back: number; front: number; chestY: number; hipsY: number};
type Piece = {geo: THREE.BufferGeometry; slot: (typeof SLOTS)[number]; role: number; rough: number; bone: number};
const ROLE = {cloth: 2, leather: 4, trinket: 9, eye: 8};
const S = (s: (typeof SLOTS)[number]) => SLOTS.indexOf(s);

/** Flat-shaded, indexed copy with skin/info attributes in the kit's formats (merges with kit parts). */
export function skinned({geo, slot, role, rough, bone}: Piece): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.deleteAttribute('uv'); g.computeVertexNormals();
  const n = g.attributes.position.count, out = new THREE.BufferGeometry();
  out.setAttribute('position', g.attributes.position);
  const nor = new THREE.BufferAttribute(new Int8Array(n * 3), 3, true);
  for (let i = 0; i < n; i++) nor.setXYZ(i, g.attributes.normal.getX(i), g.attributes.normal.getY(i), g.attributes.normal.getZ(i));
  out.setAttribute('normal', nor);
  const j = new Uint8Array(n * 4), w = new Uint8Array(n * 4), info = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) { j[i * 4] = bone; w[i * 4] = 255; info.set([S(slot), role, Math.round(rough * 255), 0], i * 4); }
  out.setAttribute('skinIndex', new THREE.BufferAttribute(j, 4)); out.setAttribute('skinWeight', new THREE.BufferAttribute(w, 4, true));
  out.setAttribute('hinfo', new THREE.BufferAttribute(info, 4));
  out.setIndex(Array.from({length: n}, (_, i) => i));
  return out;
}
const at = (g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => { g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz))); g.translate(x, y, z); return g; };
/** A flat bar (strap) from a to b, its face turned toward `out`. */
function bar(a: THREE.Vector3, b: THREE.Vector3, w: number, t: number, out: THREE.Vector3) {
  const d = b.clone().sub(a), len = d.length(); d.normalize();
  const x = new THREE.Vector3().crossVectors(d, out).normalize(), z = new THREE.Vector3().crossVectors(x, d);
  const g = new THREE.BoxGeometry(w, len + t, t); g.applyMatrix4(new THREE.Matrix4().makeBasis(x, d, z)); g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2); return g;
}
/** Outer surface of a garment near (x, y): the front-most (side +1) or back-most (side −1) vertex z, plus a gap. */
export function surfaceZ(geo: THREE.BufferGeometry, x: number, y: number, side: 1 | -1, gap = 0.008, r = 0.035) {
  const P = geo.attributes.position; let best = side > 0 ? -Infinity : Infinity;
  for (let i = 0; i < P.count; i++) { if (Math.abs(P.getX(i) - x) > r || Math.abs(P.getY(i) - y) > r) continue; const z = P.getZ(i); best = side > 0 ? Math.max(best, z) : Math.min(best, z); }
  return Number.isFinite(best) ? best + side * gap : null;
}
/** A strap draped over the garment through (x, y) waypoints on one side (front or back). */
function drape(geo: THREE.BufferGeometry, pts: [number, number][], side: 1 | -1, w = 0.032, t = 0.01) {
  const v = pts.map(([x, y]) => new THREE.Vector3(x, y, surfaceZ(geo, x, y, side) ?? 0.1 * side));
  const out = new THREE.Vector3(0, 0, side);
  return v.slice(1).map((b, i) => bar(v[i], b, w, t, out));
}
/** Upper half-ellipsoid dome (low poly) with its rim at y = 0. */
const dome = (rx: number, ry: number, rz: number, seg = 12, rings = 4) => { const g = new THREE.SphereGeometry(1, seg, rings, 0, Math.PI * 2, 0, Math.PI / 2); g.scale(rx, ry, rz); return g; };
const ring = (r: number, h: number, seg = 12, open = true) => new THREE.CylinderGeometry(r, r, h, seg, 1, open);

/** Hat pieces around the head: rim height just above the brows, dome enclosing hair. */
export function hatPieces(kind: Look['hat'], fit: HeadFit, headBone: number): Piece[] {
  if (kind === 'none') return [];
  const rim = fit.eye[1] + 0.055, rx = fit.rx * 1.06 + 0.012, rz = fit.rz * 1.04 + 0.012, ry = Math.max(0.06, fit.top - rim + 0.018), cz = fit.cz;
  const cloth = (geo: THREE.BufferGeometry, slot: Piece['slot'] = 'gear'): Piece => ({geo, slot, role: ROLE.cloth, rough: .9, bone: headBone});
  if (kind === 'cap') {
    const visor = new THREE.CircleGeometry(1, 10, 0, Math.PI); visor.scale(rx * 0.92, 0.09, 1); // half disc, straight edge on the brow
    const band = ring(1, 0.014, 12); band.scale(rx * 1.004, 1, rz * 1.004);
    return [cloth(at(dome(rx, ry, rz), 0, rim, cz)), cloth(at(band, 0, rim + 0.007, cz), 'gearDark'), cloth(at(visor, 0, rim + 0.003, cz + rz * 0.84, Math.PI / 2 + 0.2, 0, 0))];
  }
  if (kind === 'beanie') {
    const cuff = ring(1, 0.04, 14, false); cuff.scale(rx * 1.035, 1, rz * 1.035);
    return [cloth(at(dome(rx * 0.99, ry * 1.12, rz * 0.99, 12, 5), 0, rim + 0.02, cz)), cloth(at(cuff, 0, rim + 0.012, cz), 'gearDark')];
  }
  // sunhat: soft crown, band, wide brim with a slight droop
  const crown = dome(rx * 1.02, ry * 1.05, rz * 1.02, 14, 4), band = ring(1, 0.022, 14); band.scale(rx * 1.035, 1, rz * 1.035);
  const brim = new THREE.RingGeometry(1, 1.9, 18, 1); brim.scale(rx * 1.03, rz * 1.03, 1);
  const pos = brim.attributes.position; for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), y = pos.getY(i), r = Math.hypot(x / rx, y / rz); pos.setZ(i, -(r - 1) * 0.02); }
  return [cloth(at(crown, 0, rim, cz)), cloth(at(band, 0, rim + 0.011, cz), 'gearDark'), cloth(at(brim, 0, rim, cz, -Math.PI / 2, 0, 0))];
}

/** Glasses on the eye line: frames (accent colour), and dark lenses for shades. */
export function glassesPieces(kind: Look['glasses'], fit: HeadFit, headBone: number): Piece[] {
  if (kind === 'none') return [];
  const [, ey, ez] = fit.eye, z = ez + 0.016, ex = Math.max(0.03, fit.eyeX - 0.018), lr = 0.021, t = 0.0032;
  const frame = (geo: THREE.BufferGeometry): Piece => ({geo, slot: 'accent', role: ROLE.trinket, rough: .36, bone: headBone});
  const out: Piece[] = [];
  for (const sx of [-1, 1]) {
    if (kind === 'round') out.push(frame(at(new THREE.TorusGeometry(lr, t, 4, 14), sx * ex, ey, z)));
    else { // square / shades: four bars
      const w = lr * 2.1, h = lr * (kind === 'shades' ? 1.75 : 1.6);
      for (const [bw, bh, dx, dy] of [[w, t * 2, 0, h / 2], [w, t * 2, 0, -h / 2], [t * 2, h, w / 2, 0], [t * 2, h, -w / 2, 0]] as const)
        out.push(frame(at(new THREE.BoxGeometry(bw, bh, t * 2), sx * ex + dx, ey + dy, z)));
    }
    if (kind === 'shades') out.push({geo: at(new THREE.PlaneGeometry(lr * 2.05, lr * 1.7), sx * ex, ey, z - 0.001), slot: 'lens', role: ROLE.eye, rough: .15, bone: headBone});
    // temple arm back to the ear
    const back = fit.cz - 0.01, len = z - back, tx = sx * (Math.max(fit.templeX, ex + lr) + 0.003);
    out.push(frame(at(new THREE.BoxGeometry(t * 2, t * 2, len), tx, ey + 0.004, back + len / 2)));
    out.push(frame(at(new THREE.BoxGeometry(Math.abs(tx - sx * (ex + lr)) + t, t * 2, t * 2), (tx + sx * (ex + lr)) / 2, ey + 0.004, z)));
  }
  out.push(frame(at(new THREE.BoxGeometry(Math.max(0.006, 2 * (ex - lr)), t * 2, t * 2), 0, ey + 0.006, z)));
  return out;
}

/** Bags on the torso: a backpack on the chest's back, or a satchel on the hip with a strap across the chest. */
export function bagPieces(kind: Look['bag'], fit: TorsoFit, bones: {chest: number; hips: number}, top: THREE.BufferGeometry): Piece[] {
  if (kind === 'none') return [];
  const leather = (geo: THREE.BufferGeometry, bone: number, slot: Piece['slot'] = 'gear'): Piece => ({geo, slot, role: ROLE.cloth, rough: .85, bone});
  const cy = fit.chestY;
  if (kind === 'backpack') {
    const d = 0.13, y = cy - 0.1, z = (surfaceZ(top, 0, y, -1, 0) ?? fit.back) - d / 2 + 0.004;
    const body = new THREE.BoxGeometry(0.27, 0.34, d, 1, 2, 1), lid = dome(0.135, 0.05, d / 2, 8, 2), pocket = new THREE.BoxGeometry(0.18, 0.12, 0.04);
    const pieces = [leather(at(body, 0, y, z), bones.chest), leather(at(lid, 0, y + 0.17, z), bones.chest, 'gearDark'), leather(at(pocket, 0, y - 0.08, z - d / 2 - 0.018), bones.chest, 'gearDark')];
    for (const sx of [-1, 1]) { // shoulder straps: over the shoulder top, down the chest to the ribs
      const x = sx * 0.088;
      for (const g of drape(top, [[x, cy + 0.12], [x, cy + 0.04], [sx * 0.095, cy - 0.06], [sx * 0.105, cy - 0.15]], 1)) pieces.push(leather(g, bones.chest, 'gearDark'));
      const zf = surfaceZ(top, x, cy + 0.12, 1) ?? fit.front, zb = surfaceZ(top, x, cy + 0.1, -1) ?? fit.back;
      pieces.push(leather(bar(new THREE.Vector3(x, cy + 0.135, zf), new THREE.Vector3(x, cy + 0.125, zb), 0.032, 0.01, new THREE.Vector3(0, 1, 0)), bones.chest, 'gearDark'));
    }
    return pieces;
  }
  // satchel on the right hip, strap from the left shoulder across the chest and back
  const bag = new THREE.BoxGeometry(0.2, 0.17, 0.07), flap = new THREE.BoxGeometry(0.205, 0.09, 0.075);
  const hx = 0.19, hy = fit.hipsY + 0.04, hz = 0.03;
  const path: [number, number][] = [[-0.1, cy + 0.12], [-0.05, cy + 0.02], [0.03, cy - 0.1], [0.1, cy - 0.21], [0.16, cy - 0.3]];
  const pieces = [leather(at(bag, hx, hy, hz), bones.hips), leather(at(flap, hx, hy + 0.045, hz + 0.002), bones.hips, 'gearDark')];
  for (const side of [1, -1] as const) for (const g of drape(top, path, side, 0.028, 0.009)) pieces.push(leather(g, bones.chest, 'gearDark'));
  const zf = surfaceZ(top, -0.1, cy + 0.12, 1) ?? fit.front, zb = surfaceZ(top, -0.1, cy + 0.12, -1) ?? fit.back;
  pieces.push(leather(bar(new THREE.Vector3(-0.1, cy + 0.135, zf), new THREE.Vector3(-0.1, cy + 0.135, zb), 0.028, 0.009, new THREE.Vector3(0, 1, 0)), bones.chest, 'gearDark'));
  return pieces;
}

// ---------- looks v2: facial hair, mask, scarf, gloves, jewellery ----------

/** A conforming layer over part of a kit geometry (beard, mask, gloves, scarf wrap): the triangles whose three vertices
 *  pass `keep` are copied, pushed out by `offset` along the normal averaged over coincident vertices (so the layer stays
 *  closed over flat-shaded parts) and recoloured. They keep their skin weights, so they deform with the body exactly. */
export function shell(g: THREE.BufferGeometry, keep: (i: number, p: THREE.Vector3, dominant: number) => boolean, offset: number, slot: (typeof SLOTS)[number], role: number, rough: number, region?: (centroid: THREE.Vector3) => boolean): THREE.BufferGeometry | null {
  const P = g.attributes.position, N = g.attributes.normal, J = g.attributes.skinIndex, W = g.attributes.skinWeight, I = g.index!;
  const n = P.count, ok = new Uint8Array(n), p = new THREE.Vector3();
  for (let i = 0; i < n; i++) { let best = 0, bw = -1; for (let k = 0; k < 4; k++) { const w = W.getComponent(i, k); if (w > bw) { bw = w; best = J.getComponent(i, k); } } p.fromBufferAttribute(P, i); ok[i] = keep(i, p, best) ? 1 : 0; }
  // `keep` filters vertices (bone, colour slot); `region`, when given, picks the triangles by centroid (low-poly faces have big triangles)
  const tris: number[] = [], c3 = new THREE.Vector3();
  for (let t = 0; t < I.count; t += 3) { const a = I.getX(t), b = I.getX(t + 1), c = I.getX(t + 2); if (!(ok[a] && ok[b] && ok[c])) continue;
    if (region) { c3.fromBufferAttribute(P, a).add(p.fromBufferAttribute(P, b)).add(p.fromBufferAttribute(P, c)).divideScalar(3); if (!region(c3)) continue; }
    tris.push(a, b, c); }
  if (!tris.length) return null;
  const avg = new Map<string, THREE.Vector3>(), key = (i: number) => `${Math.round(P.getX(i) * 2e4)},${Math.round(P.getY(i) * 2e4)},${Math.round(P.getZ(i) * 2e4)}`;
  for (const i of tris) { const k = key(i); const v = avg.get(k) ?? new THREE.Vector3(); avg.set(k, v.add(new THREE.Vector3(N.getX(i), N.getY(i), N.getZ(i)))); }
  const remap = new Map<number, number>(), used: number[] = []; for (const i of tris) if (!remap.has(i)) { remap.set(i, used.length); used.push(i); }
  const m = used.length, out = new THREE.BufferGeometry();
  const pos = new Float32Array(m * 3), nor = new Int8Array(m * 3), si = new Uint8Array(m * 4), sw = new Uint8Array(m * 4), info = new Uint8Array(m * 4), S = SLOTS.indexOf(slot);
  used.forEach((i, j) => {
    const d = avg.get(key(i))!.clone().normalize();
    pos.set([P.getX(i) + d.x * offset, P.getY(i) + d.y * offset, P.getZ(i) + d.z * offset], j * 3);
    nor.set([Math.round(N.getX(i) * 127), Math.round(N.getY(i) * 127), Math.round(N.getZ(i) * 127)], j * 3);
    for (let k = 0; k < 4; k++) { si[j * 4 + k] = J.getComponent(i, k); sw[j * 4 + k] = Math.round(W.getComponent(i, k) * 255); }
    info.set([S, role, Math.round(rough * 255), 0], j * 4);
  });
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3, true));
  out.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4)); out.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4, true));
  out.setAttribute('hinfo', new THREE.BufferAttribute(info, 4)); out.setIndex(tris.map(i => remap.get(i)!));
  return out;
}
const isSkin = (g: THREE.BufferGeometry, i: number) => { const s = g.attributes.hinfo.getX(i); return s === 0 || s === 1; };

/** A mustache: two tapered bars under the nose, on the face's own surface (low-poly faces have no lip band to follow). */
export function mustachePieces(face: THREE.BufferGeometry, fit: HeadFit, headBone: number): Piece[] {
  const y = fit.eye[1] - 0.08, z = (surfaceZ(face, 0, y, 1, 0.002, 0.03) ?? fit.eye[2] + 0.02);
  return [-1, 1].map(sx => { const g = new THREE.BoxGeometry(0.042, 0.013, 0.012); g.translate(sx * 0.021, 0, 0); return {geo: at(g, sx * 0.004, y, z, 0, -sx * 0.35, -sx * 0.32), slot: 'hair' as const, role: 6, rough: .8, bone: headBone}; });
}
/** Facial hair over the face part's skin: goatee or full beard (with the mustache). */
export function facialHairLayers(kind: Look['facialHair'], face: THREE.BufferGeometry, fit: HeadFit, headBone: number): THREE.BufferGeometry[] {
  if (kind === 'none') return [];
  const ey = fit.eye[1], front = fit.cz;
  const lower = (p: THREE.Vector3) => p.y < ey - 0.05 && p.y > ey - 0.2;
  const goatee = (p: THREE.Vector3) => p.y < ey - 0.098 && p.y > ey - 0.2 && Math.abs(p.x) < 0.042 && p.z > front + 0.02;
  const beard = (p: THREE.Vector3) => lower(p) && p.z > front - 0.05 && !(p.y > ey - 0.115 && p.y < ey - 0.095 && Math.abs(p.x) < 0.028 && p.z > front + 0.05); // leaves the lips
  if (kind === 'mustache') return [];
  const region = kind === 'goatee' ? goatee : beard;
  const layer = shell(face, (i, _p, bone) => bone === headBone && isSkin(face, i), kind === 'beard' ? 0.008 : 0.005, 'hair', 6, 0.8, region);
  return layer ? [layer] : [];
}
/** A cloth mask over the nose, mouth and chin (accessory colour). */
export function maskLayer(face: THREE.BufferGeometry, fit: HeadFit, headBone: number): THREE.BufferGeometry | null {
  const ey = fit.eye[1];
  return shell(face, (i, _p, bone) => bone === headBone && isSkin(face, i), 0.006, 'spare', 2, 0.9, p => p.y < ey - 0.03 && p.y > ey - 0.19 && p.z > fit.cz);
}
/** A knitted wrap around the neck (accessory colour); its hanging end is `scarfEndPieces`. */
export function scarfWrap(face: THREE.BufferGeometry, neckBone: number, chestBone: number, headBone: number, neckY: number): THREE.BufferGeometry | null {
  return shell(face, (i, p, bone) => isSkin(face, i) && (bone === neckBone || bone === chestBone || (bone === headBone && p.y < neckY + 0.02)), 0.024, 'spare', 2, 0.95);
}
/** The scarf's two ends hanging down the chest, draped over the top. */
export function scarfEndPieces(fit: TorsoFit, neckY: number, chestBone: number, top: THREE.BufferGeometry): Piece[] {
  const out: Piece[] = [];
  for (const [x0, x1, len] of [[0.03, 0.05, 0.2], [0.055, 0.085, 0.15]] as const)
    for (const g of drape(top, [[x0, neckY - 0.04], [x1, neckY - 0.04 - len]], 1, 0.055, 0.016)) out.push({geo: g, slot: 'spare', role: ROLE.cloth, rough: .95, bone: chestBone});
  void fit; return out;
}
/** Gloves: a thin leather layer over the hands (gear colour), following every finger. */
export function gloveLayer(top: THREE.BufferGeometry, handBones: ReadonlySet<number>): THREE.BufferGeometry | null {
  return shell(top, (i, _p, bone) => isSkin(top, i) && handBones.has(bone), 0.004, 'gear', ROLE.leather, 0.7);
}
/** Earrings: small accent-coloured drops at the ear lobes. */
export function earringPieces(fit: HeadFit, headBone: number): Piece[] {
  const out: Piece[] = [];
  for (const sx of [-1, 1]) {
    const x = sx * (fit.templeX - 0.004), y = fit.eye[1] - 0.05, z = fit.cz - 0.012;
    out.push({geo: at(new THREE.TorusGeometry(0.008, 0.0022, 4, 10), x, y, z, 0, Math.PI / 2, 0), slot: 'accent', role: ROLE.trinket, rough: .3, bone: headBone});
    out.push({geo: at(new THREE.OctahedronGeometry(0.0085, 0), x, y - 0.016, z), slot: 'accent', role: ROLE.trinket, rough: .3, bone: headBone});
  }
  return out;
}
/** A necklace: a thin chain draped over the top around the neck with a small pendant (accent colour). */
export function necklacePieces(neckY: number, chestBone: number, top: THREE.BufferGeometry): Piece[] {
  const pts: [number, number][] = [[-0.072, neckY - 0.035], [-0.05, neckY - 0.08], [-0.022, neckY - 0.105], [0, neckY - 0.112], [0.022, neckY - 0.105], [0.05, neckY - 0.08], [0.072, neckY - 0.035]];
  const out: Piece[] = drape(top, pts, 1, 0.007, 0.005).map(g => ({geo: g, slot: 'accent' as const, role: ROLE.trinket, rough: .3, bone: chestBone}));
  const z = surfaceZ(top, 0, neckY - 0.125, 1) ?? 0.15;
  out.push({geo: at(new THREE.OctahedronGeometry(0.014, 0), 0, neckY - 0.128, z + 0.008), slot: 'accent', role: ROLE.trinket, rough: .3, bone: chestBone});
  return out;
}
