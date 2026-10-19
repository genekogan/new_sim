// W2: old Eden's animated fire (mars/viewer/app/engine-view/fire.ts), ported for entity worlds without its point light
// (the night map's flickering pool lights it instead; a per-fire PointLight recompiles every material). A glowing coal
// bed, crossed flame tongues shaded by scrolling value noise (one draw), rising embers and thin smoke (GPU-animated
// points, one draw each). Size classes: 'candle' is one tongue; 'torch' adds embers; 'full' adds the coal bed and smoke.
// `setDetail` drops parts with distance (fx/flames.ts). Everything is a pure function of (seed, t):
// the seed comes from the entity id (`seedOf`), t is sim/take seconds — no Math.random / Date.now,
// so a replayed take draws the identical fire at the same tick. Stones and logs stay with the callers.
import * as THREE from 'three';

/** FNV-1a 32-bit hash of an id → seed. */
export function seedOf(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

const h1 = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const vn1 = (x: number) => {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  return h1(i) * (1 - u) + h1(i + 1) * u;
};
/** Light flicker in [0, 1] (irregular, a few Hz), deterministic in (t, seed). */
export function flicker(t: number, seed: number): number {
  const s = (seed % 9973) * 0.137;
  return 0.55 * vn1(t * 5.1 + s) + 0.3 * vn1(t * 11.7 + s * 2.1) + 0.15 * vn1(t * 23.3 + s * 3.7);
}

const NOISE = /* glsl */ `
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p){ return 0.5 * vn(p) + 0.3 * vn(p * 2.03 + 7.1) + 0.2 * vn(p * 4.01 + 3.7); }`;

const FLAME_VS = /* glsl */ `${NOISE}
uniform float uTime, uStrength; attribute vec2 corner; attribute vec4 tongue; attribute float angle;
varying vec2 vUv; varying float vSeed, vHeat;
void main(){
  vUv = corner + vec2(0.5, 0.0); vSeed = tongue.z; vHeat = tongue.w;
  // The two oblique planes of each tongue keep visible area from directly above.
  // Their sideways directions differ by 90 degrees, avoiding a camera-facing disc.
  vec3 R = vec3(cos(angle), 0.20, sin(angle));
  vec3 V = vec3(-sin(angle) * 0.42, 1.0, cos(angle) * 0.42);
  float breathe = 0.8 + 0.4 * vn(vec2(uTime * 3.3 + tongue.z * 17.0, tongue.z));
  vec3 p = position + R * corner.x * tongue.x + V * corner.y * tongue.y * breathe * (0.5 + 0.5 * uStrength);
  p.xz += vec2(sin(uTime * 4.7 + tongue.z * 31.0), cos(uTime * 3.9 + tongue.z * 29.0)) * tongue.x * corner.y * 0.18;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const FLAME_FS = /* glsl */ `${NOISE}
uniform float uTime, uStrength; varying vec2 vUv; varying float vSeed, vHeat;
void main(){
  float y = vUv.y, x = (vUv.x - 0.5) * 2.0;
  float n = fbm(vec2(vUv.x * 2.5 + vSeed * 13.0, y * 2.0 - uTime * (1.7 + 0.9 * vHeat)));
  float n2 = vn(vec2(vUv.x * 5.0 - vSeed * 7.0, y * 3.5 - uTime * 3.2));
  x += (n - 0.5) * 1.1 * y + sin(uTime * 2.3 + vSeed * 40.0) * 0.18 * y * y;   // tongues lick sideways
  float width = (1.0 - y) * (0.6 + 0.4 * smoothstep(0.0, 0.2, y));
  float body = 1.0 - smoothstep(0.45, 1.0, abs(x) / max(width, 1e-3));
  float top = 1.0 - smoothstep(0.3, 0.95, y + (n2 - 0.35) * 0.7 * y);
  float a = body * top * smoothstep(0.0, 0.1, y) * (0.55 + 0.6 * n);
  float heat = a * (0.55 + 0.45 * vHeat) * (1.15 - 0.6 * y);
  vec3 c = mix(vec3(0.85, 0.16, 0.02), vec3(1.0, 0.5, 0.08), smoothstep(0.05, 0.4, heat));
  c = mix(c, vec3(1.0, 0.73, 0.30), smoothstep(0.45, 0.85, heat));
  gl_FragColor = vec4(c, clamp(a, 0.0, 1.0) * uStrength);
}`;
const BED_FS = /* glsl */ `${NOISE}
uniform float uTime, uStrength; varying vec2 vUv;
void main(){
  vec2 p = vUv * 2.0 - 1.0; float r = length(p);
  float coals = fbm(p * 5.0 + vec2(0.0, uTime * 0.15)), pulse = vn(p * 3.0 + uTime * 0.9);
  float glow = smoothstep(1.0, 0.2, r) * smoothstep(0.35, 0.75, coals) * (0.55 + 0.45 * pulse);
  gl_FragColor = vec4(mix(vec3(0.55, 0.06, 0.0), vec3(1.0, 0.45, 0.08), glow), glow * uStrength);
}`;
const PARTS_VS = /* glsl */ `
uniform float uTime, uStrength, uPx, uSize, uGrow, uRise, uRate, uSpread, uMax; attribute float seed;
varying float vAge, vTw;
void main(){
  float age = fract(uTime * uRate * (0.7 + 0.6 * fract(seed * 7.13)) + seed);
  vec3 p = position;
  p.y += age * uRise * (0.7 + 0.6 * fract(seed * 3.7));
  p.x += sin(uTime * 1.7 + seed * 31.0) * uSpread * age + age * age * uSpread * sin(seed * 12.0);
  p.z += cos(uTime * 1.3 + seed * 17.0) * uSpread * age + age * age * uSpread * cos(seed * 12.0);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  vAge = age; vTw = 0.55 + 0.45 * sin(uTime * (9.0 + seed * 7.0) + seed * 50.0);
  gl_PointSize = clamp(uSize * (1.0 + uGrow * age) * projectionMatrix[1][1] * uPx / -mv.z, 1.5, uMax);
}`;
const EMBER_FS = /* glsl */ `varying float vAge, vTw; uniform float uStrength;
void main(){ float r = length(gl_PointCoord - 0.5) * 2.0; float a = (1.0 - smoothstep(0.3, 1.0, r)) * (1.0 - vAge) * vTw * uStrength;
  gl_FragColor = vec4(mix(vec3(1.0, 0.8, 0.35), vec3(1.0, 0.25, 0.05), vAge), a); }`;
const SMOKE_FS = /* glsl */ `varying float vAge, vTw; uniform float uStrength;
void main(){ float r = length(gl_PointCoord - 0.5) * 2.0; float a = (1.0 - smoothstep(0.10, 1.0, r)) * sin(3.14159 * vAge) * 0.27 * uStrength;
  gl_FragColor = vec4(vec3(0.55, 0.52, 0.48), a); }`;

export type FireKind = 'candle' | 'torch' | 'full';
export type Fire = {
  readonly group: THREE.Group;
  readonly kind: FireKind;
  /** t: sim/take seconds; strength 0..1 scales flames, embers, smoke. */
  update(t: number, strength: number): void;
  /** 2 = everything, 1 = flames (and coal bed) only, 0 = nothing (the caller shows its static stand-in). */
  setDetail(level: 0 | 1 | 2): void;
  dispose(): void;
};

/** A fire of flame radius `radius` m (flame height ≈ 2.6 radius), seeded by `seed` (see `seedOf`). */
export function createFire(seed: number, radius: number, kind: FireKind = 'full', height = radius * 2.6): Fire {
  let s = seed >>> 0;
  const rnd = () => { // mulberry32
    s = (s + 0x6d2b79f5) >>> 0;
    let r = Math.imul(s ^ (s >>> 15), 1 | s);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
  const group = new THREE.Group();
  group.name = 'fire';
  const u = { uTime: { value: 0 }, uStrength: { value: 1 } };
  const geos: THREE.BufferGeometry[] = [], mats: THREE.Material[] = [];
  const shader = (vs: string, fs: string, extra: Record<string, { value: number }>, blending: THREE.Blending = THREE.AdditiveBlending) => {
    const m = new THREE.ShaderMaterial({ uniforms: { ...u, ...extra }, vertexShader: vs, fragmentShader: fs, transparent: true, depthWrite: false, blending });
    mats.push(m);
    return m;
  };

  // Crossed oblique ribbons: both planes share the same seeded tongue and one draw call.
  const pos: number[] = [], corner: number[] = [], tongue: number[] = [], angle: number[] = [], index: number[] = [];
  // tongues are sized by the flame's own height (kit flames can be taller or squatter than 2.6 radii)
  const hk = height / (radius * 2.6);
  const tongues = kind === 'candle' ? [[1, 1.7, 2.4, 0.7]] : kind === 'torch' ? [[3, 1.0, 2.5, 0.2], [2, 0.7, 2.2, 0.8]] : [[4, 1.1, 2.4, 0], [3, 0.85, 2.6, 0.5], [2, 0.6, 1.8, 1]];
  for (const [count, w, h0, heat] of tongues) {
    const h = h0 * hk;
    for (let k = 0; k < count; k++) {
      const a = rnd() * Math.PI * 2, r = radius * (0.35 - 0.12 * heat) * Math.sqrt(rnd());
      const width = radius * w * (0.85 + 0.3 * rnd()), height = radius * h * (0.85 + 0.3 * rnd()), noise = rnd();
      for (const turn of [0, Math.PI / 2]) {
        const base = pos.length / 3;
        for (const [cx, cy] of [[-0.5, 0], [0.5, 0], [0.5, 1], [-0.5, 1]]) {
          pos.push(Math.cos(a) * r, Math.min(0.04, radius * 0.1), Math.sin(a) * r);
          corner.push(cx, cy);
          tongue.push(width, height, noise, heat);
          angle.push(a + turn);
        }
        index.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
  }
  const fg = new THREE.BufferGeometry();
  fg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  fg.setAttribute('corner', new THREE.Float32BufferAttribute(corner, 2));
  fg.setAttribute('tongue', new THREE.Float32BufferAttribute(tongue, 4));
  fg.setAttribute('angle', new THREE.Float32BufferAttribute(angle, 1));
  fg.setIndex(index);
  fg.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, height * 0.5, 0), Math.max(height, radius * 2) * 0.9);
  geos.push(fg);
  const flameMat = shader(FLAME_VS, FLAME_FS, {}, THREE.NormalBlending);
  flameMat.side = THREE.DoubleSide;
  const flame = new THREE.Mesh(fg, flameMat);
  flame.name = 'flame';
  flame.renderOrder = 2;

  const bg = new THREE.CircleGeometry(radius * 1.25, 24).rotateX(-Math.PI / 2);
  geos.push(bg);
  const bed = new THREE.Mesh(bg, shader('varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }', `${BED_FS}`, {}));
  bed.name = 'coal bed';
  bed.position.y = 0.025;

  const px = { value: 400 };
  const points = (n: number, y0: number, spread0: number, extra: Record<string, { value: number }>, fs: string, blending?: THREE.Blending) => {
    const p: number[] = [], sd: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, r = radius * spread0 * Math.sqrt(rnd());
      p.push(Math.cos(a) * r, y0, Math.sin(a) * r);
      sd.push(rnd());
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute('seed', new THREE.Float32BufferAttribute(sd, 1));
    geos.push(g);
    const o = new THREE.Points(g, shader(PARTS_VS, fs, { uPx: px, ...extra }, blending));
    const rise = extra.uRise.value, spread = extra.uSpread.value * 2 + radius;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, y0 + rise * 0.6, 0), Math.hypot(rise * 0.7, spread) + extra.uSize.value * 3);
    o.onBeforeRender = (r) => (px.value = r.getDrawingBufferSize(tmp).y * 0.5);
    return o;
  };
  const tmp = new THREE.Vector2();
  const embers = points(28, radius * 0.3, 0.6, { uSize: { value: 0.022 }, uGrow: { value: 0 }, uRise: { value: radius * 5.5 }, uRate: { value: 0.45 }, uSpread: { value: radius * 0.35 }, uMax: { value: 10 } }, EMBER_FS);
  embers.name = 'embers';
  const smoke = points(24, Math.max(radius * 1.8, height * 0.7), 0.3, { uSize: { value: radius * 1.1 }, uGrow: { value: 2.3 }, uRise: { value: radius * 8 }, uRate: { value: 0.12 }, uSpread: { value: radius * 1.1 }, uMax: { value: 400 } }, SMOKE_FS, THREE.NormalBlending);
  smoke.name = 'smoke';
  // Composite the translucent column behind the flames; overhead smoke otherwise hides every tongue.
  smoke.renderOrder = 1;

  group.add(flame);
  if (kind !== 'candle') group.add(embers);
  if (kind === 'full') group.add(bed, smoke);
  for (const o of group.children) { o.castShadow = false; o.receiveShadow = false; }
  let detail: 0 | 1 | 2 = 2;

  return {
    group,
    kind,
    update(t, strength) {
      group.visible = strength > 0 && detail > 0;
      u.uTime.value = t % 600; // keeps shader noise inputs in float precision; one pattern jump per 10 min
      u.uStrength.value = strength;
    },
    setDetail(level) {
      if (level === detail) return;
      detail = level; group.visible = level > 0; embers.visible = smoke.visible = level > 1;
    },
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
    },
  };
}
