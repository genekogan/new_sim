// Geometry kit for building/1's mesh half, ported from the Eden interiors kit
// (mars/viewer/app/engine-view/content/assets/eden-interiors/kit.ts): every part is accumulated as a
// flat-shaded, vertex-coloured triangle soup per (group, layer) and emitted as ONE mesh per pair, so a
// furnished storey costs a handful of draws. Groups are storeys ('level-0', 'level-1', …) and 'roof',
// so the interior view can hide the roof and the floors above the camera. Owner: L2.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { MaterialLib } from './materials.ts';

/** wall: walls, partitions · floor: slabs, boards, decks · roof · trim: frames, sills, rails, details · glass · glow (lamps, lit lantern). */
export type Layer = 'wall' | 'floor' | 'roof' | 'trim' | 'glass' | 'glow';
export type Col = THREE.ColorRepresentation;
const tmpC = new THREE.Color();

const unit = new Map<string, THREE.BufferGeometry>();
function prim(key: string, make: () => THREE.BufferGeometry) {
  let g = unit.get(key);
  if (!g) { const made = make(); g = made.index ? made.toNonIndexed() : made; if (g !== made) made.dispose(); unit.set(key, g); }
  return g;
}

type Buf = { p: number[]; n: number[]; c: number[] };
export class Builder {
  readonly buf = new Map<string, Buf>();
  group = 'level-0';
  private enabled = true;
  /** Consume the same seeded detail choices while omitting an optional ornament's geometry. */
  optional(enabled: boolean, draw: () => void) { const was = this.enabled; this.enabled = was && enabled; try { draw(); } finally { this.enabled = was; } }
  private m = new THREE.Matrix4(); private stack: THREE.Matrix4[] = [];
  private l = new THREE.Matrix4(); private nm = new THREE.Matrix3(); private v = new THREE.Vector3(); private q = new THREE.Quaternion(); private s = new THREE.Vector3(); private t = new THREE.Vector3(); private e = new THREE.Euler();
  push(x: number, y: number, z: number, yaw = 0) { this.stack.push(this.m.clone()); this.m.multiply(new THREE.Matrix4().makeRotationY(yaw).setPosition(x, y, z)); return this; }
  pop() { this.m = this.stack.pop() ?? new THREE.Matrix4(); return this; }
  at(x: number, y: number, z: number, yaw: number, f: () => void) { this.push(x, y, z, yaw); try { f(); } finally { this.pop(); } return this; }
  private bufOf(layer: Layer) { const k = `${this.group}|${layer}`; let b = this.buf.get(k); if (!b) { b = { p: [], n: [], c: [] }; this.buf.set(k, b); } return b; }
  private add(g: THREE.BufferGeometry, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, col: Col, layer: Layer, rx = 0, ry = 0, rz = 0) {
    if (!this.enabled) return;
    this.q.setFromEuler(this.e.set(rx, ry, rz, 'YXZ')); this.l.compose(this.t.set(cx, cy, cz), this.q, this.s.set(sx, sy, sz)); this.l.premultiply(this.m); this.nm.getNormalMatrix(this.l);
    const b = this.bufOf(layer), P = g.attributes.position, N = g.attributes.normal; tmpC.set(col);
    for (let i = 0; i < P.count; i++) {
      this.v.fromBufferAttribute(P, i).applyMatrix4(this.l); b.p.push(this.v.x, this.v.y, this.v.z);
      this.v.fromBufferAttribute(N, i).applyMatrix3(this.nm).normalize(); b.n.push(this.v.x, this.v.y, this.v.z); b.c.push(tmpC.r, tmpC.g, tmpC.b);
    }
  }
  /** Box by its bottom-centre (x, y = bottom, z), size and yaw. */
  box(x: number, y: number, z: number, w: number, h: number, d: number, col: Col, layer: Layer = 'trim', yaw = 0) { if (w > 1e-4 && h > 1e-4 && d > 1e-4) this.add(prim('box', () => new THREE.BoxGeometry(1, 1, 1)), x, y + h / 2, z, w, h, d, col, layer, 0, yaw, 0); return this; }
  /** Chamfered box: an octagonal prism scaled to the box (the Eden look for posts and newels, 32 tris). */
  rbox(x: number, y: number, z: number, w: number, h: number, d: number, col: Col, layer: Layer = 'trim', yaw = 0) { if (w > 1e-4 && h > 1e-4 && d > 1e-4) this.add(prim('oct', () => new THREE.CylinderGeometry(0.5 / Math.cos(Math.PI / 8), 0.5 / Math.cos(Math.PI / 8), 1, 8).rotateY(Math.PI / 8)), x, y + h / 2, z, w, h, d, col, layer, 0, yaw, 0); return this; }
  /** Rounded box with real fillets (108 tris): use sparingly. */
  roundBox(x: number, y: number, z: number, w: number, h: number, d: number, col: Col, layer: Layer = 'trim', yaw = 0) { if (w > 1e-4 && h > 1e-4 && d > 1e-4) this.add(prim('rbox', () => new RoundedBoxGeometry(1, 1, 1, 1, 0.18)), x, y + h / 2, z, w, h, d, col, layer, 0, yaw, 0); return this; }
  /** One planar quad (a, b, c, d counter-clockwise seen from its front) under the current transform; 2 tris, no geometry allocation. */
  face(a: THREE.Vector3Tuple, b: THREE.Vector3Tuple, c: THREE.Vector3Tuple, d: THREE.Vector3Tuple, col: Col, layer: Layer = 'wall') {
    if (!this.enabled) return this;
    const buf = this.bufOf(layer); tmpC.set(col);
    const P = [a, b, c, d].map((p) => new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(this.m));
    const n = new THREE.Vector3().subVectors(P[1], P[0]).cross(new THREE.Vector3().subVectors(P[2], P[0])).normalize();
    for (const i of [0, 1, 2, 0, 2, 3]) { buf.p.push(P[i].x, P[i].y, P[i].z); buf.n.push(n.x, n.y, n.z); buf.c.push(tmpC.r, tmpC.g, tmpC.b); }
    return this;
  }
  /**
   * A wall slab in a local frame (x along the wall, y up, z across): faces only where they can be seen —
   * both sides, the top and bottom when asked, the ends when they frame an opening (≈ 6–10 tris instead of 24).
   */
  wallSlab(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, plus: Col, minus: Col, opts: { top?: Col; bottom?: Col; ends?: Col; endL?: boolean; endR?: boolean } = {}, layer: Layer = 'wall') {
    if (x1 - x0 < 1e-4 || y1 - y0 < 1e-4) return this;
    this.face([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], plus, layer);
    this.face([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], minus, layer);
    if (opts.top) this.face([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], opts.top, layer);
    if (opts.bottom) this.face([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], opts.bottom, layer);
    if (opts.endL && opts.ends) this.face([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], opts.ends, layer);
    if (opts.endR && opts.ends) this.face([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], opts.ends, layer);
    return this;
  }
  /** Box between two plan points (a wall run, a rail): from (ax, az) to (bx, bz), bottom y, height h, thickness d. */
  run(ax: number, az: number, bx: number, bz: number, y: number, h: number, d: number, col: Col, layer: Layer = 'trim') {
    const len = Math.hypot(bx - ax, bz - az); if (len < 1e-4) return this;
    return this.box((ax + bx) / 2, y, (az + bz) / 2, len, h, d, col, layer, Math.atan2(-(bz - az), bx - ax));
  }
  /** Tilted box: centre, size and Euler (YXZ: yaw, pitch, roll). */
  tilt(x: number, y: number, z: number, w: number, h: number, d: number, rx: number, rz: number, col: Col, layer: Layer = 'trim', ry = 0) { this.add(prim('box', () => new THREE.BoxGeometry(1, 1, 1)), x, y, z, w, h, d, col, layer, rx, ry, rz); return this; }
  /** Vertical cylinder (bottom at y); rTop ≠ rBot gives a frustum. */
  cyl(x: number, y: number, z: number, rTop: number, rBot: number, h: number, col: Col, layer: Layer = 'trim', seg = 8) { const r = Math.max(rTop, rBot, 1e-4); this.add(prim(`cyl${seg}:${(rTop / r).toFixed(3)}:${(rBot / r).toFixed(3)}`, () => new THREE.CylinderGeometry(rTop / r, rBot / r, 1, seg)), x, y + h / 2, z, r, h, r, col, layer); return this; }
  /** Horizontal cylinder along local X (ridges, logs). */
  cylX(x: number, y: number, z: number, r: number, len: number, col: Col, layer: Layer = 'trim', seg = 8, yaw = 0) { this.add(prim(`cylx${seg}`, () => new THREE.CylinderGeometry(1, 1, 1, seg).rotateZ(Math.PI / 2)), x, y, z, len, r, r, col, layer, 0, yaw, 0); return this; }
  /** Low-poly ball. */
  ball(x: number, y: number, z: number, rx: number, ry: number, rz: number, col: Col, layer: Layer = 'trim') { this.add(prim('ico0', () => new THREE.IcosahedronGeometry(1, 0)), x, y, z, rx, ry, rz, col, layer); return this; }
  /** Cone (bottom at y). */
  cone(x: number, y: number, z: number, r: number, h: number, col: Col, layer: Layer = 'roof', seg = 12) { this.add(prim(`cone${seg}`, () => new THREE.ConeGeometry(1, 1, seg)), x, y + h / 2, z, r, h, r, col, layer); return this; }
  /** Dome (upper hemisphere), base at y. */
  dome(x: number, y: number, z: number, r: number, h: number, col: Col, layer: Layer = 'roof', seg = 12) { this.add(prim(`dome${seg}`, () => new THREE.SphereGeometry(1, seg, Math.max(3, seg / 3), 0, Math.PI * 2, 0, Math.PI / 2)), x, y, z, r, h, r, col, layer); return this; }
  /** Triangular prism along local Z: width w (x), ridge height h, length d, bottom at y. */
  prism(x: number, y: number, z: number, w: number, h: number, d: number, col: Col, layer: Layer = 'roof', yaw = 0) {
    this.add(prim('prism', () => { const s = new THREE.Shape([new THREE.Vector2(-0.5, 0), new THREE.Vector2(0.5, 0), new THREE.Vector2(0, 1)]); const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false }); g.translate(0, 0, -0.5); return g; }), x, y, z, w, h, d, col, layer, 0, yaw, 0); return this;
  }
  /** A flat polygon slab (plan polygon, bottom y, thickness h). */
  slab(poly: [number, number][], y: number, h: number, col: Col, layer: Layer = 'floor') {
    if (poly.length < 3) return this;
    const shape = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z)));
    const g0 = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false }); g0.rotateX(-Math.PI / 2); g0.translate(0, y, 0);
    const g = g0.index ? g0.toNonIndexed() : g0; if (g !== g0) g0.dispose(); g.computeVertexNormals();
    this.add(g, 0, 0, 0, 1, 1, 1, col, layer); g.dispose(); return this;
  }
  /** Raw triangle (world-of-builder coordinates under the current transform). */
  tri(a: THREE.Vector3Tuple, b: THREE.Vector3Tuple, c: THREE.Vector3Tuple, col: Col, layer: Layer = 'roof') {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c], 3)); g.computeVertexNormals();
    this.add(g, 0, 0, 0, 1, 1, 1, col, layer); g.dispose(); return this;
  }
  quad(a: THREE.Vector3Tuple, b: THREE.Vector3Tuple, c: THREE.Vector3Tuple, d: THREE.Vector3Tuple, col: Col, layer: Layer = 'roof') { this.tri(a, b, c, col, layer); this.tri(a, c, d, col, layer); return this; }
  tris(): number { let n = 0; for (const b of this.buf.values()) n += b.p.length / 9; return n; }
  /** One mesh per (group, layer) under one THREE.Group per group. */
  emit(materials: MaterialLib): { groups: Map<string, THREE.Group>; draws: number; tris: number } {
    const groups = new Map<string, THREE.Group>(); let draws = 0, tris = 0;
    for (const [k, b] of this.buf) {
      if (!b.p.length) continue;
      const [gname, layer] = k.split('|') as [string, Layer];
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(b.n, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(b.c, 3));
      g.computeBoundingBox(); g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, materialFor(materials, layer)); mesh.name = `${gname} ${layer}`;
      mesh.castShadow = layer !== 'glow' && layer !== 'glass'; mesh.receiveShadow = layer !== 'glow';
      if (layer === 'glass' || layer === 'glow') mesh.userData.cameraTransparent = true;
      let grp = groups.get(gname); if (!grp) { grp = new THREE.Group(); grp.name = gname; groups.set(gname, grp); }
      grp.add(mesh); draws++; tris += b.p.length / 9;
    }
    this.buf.clear();
    return { groups, draws, tris };
  }
}

let glow: THREE.Material | null = null;
function materialFor(lib: MaterialLib, layer: Layer): THREE.Material {
  switch (layer) {
    case 'wall': return lib.get('plaster', undefined, { vertexColors: true });
    case 'floor': return lib.get('wood', undefined, { vertexColors: true });
    case 'roof': return lib.get('tile', undefined, { vertexColors: true });
    case 'trim': return lib.get('paint', undefined, { vertexColors: true });
    case 'glass': return lib.get('glass', undefined, { vertexColors: true, side: THREE.DoubleSide });
    case 'glow': return (glow ??= new THREE.MeshBasicMaterial({ vertexColors: true }));
  }
}

/** Deterministic PRNG (seeded per entity) for shutters, flowers, ivy. */
export function rng(seed: number) { let s = seed >>> 0 || 1; return () => { s = Math.imul(s ^ (s >>> 15), 2246822507) >>> 0; s = Math.imul(s ^ (s >>> 13), 3266489909) >>> 0; s = (s ^ (s >>> 16)) >>> 0; return s / 4294967296; }; }
export function hashStr(str: string) { let h = 2166136261; for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619); return h >>> 0; }
/** Mix a hex colour toward another (0..1). */
export function mix(a: string, b: string, t: number): string { return '#' + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString(); }
