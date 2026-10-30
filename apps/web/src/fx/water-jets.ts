// Soul Actions: water that actually moves. A sprinkler sweeps a fan of droplets that fly on ballistic arcs, fall and
// splash; a tap pours a stream that arcs into its basin; a shower rains from its head. Each droplet is a GPU point whose
// position is a pure function of the atmosphere's clock (RIPPLE.x, world seconds) and its own seeds, so every viewer
// sees the same water and the CPU does nothing per frame. The effect is attached only while the thing is on (the
// entity is rebuilt at the contact tick), so the water starts and stops exactly with the hand.
import * as THREE from 'three';
import { RIPPLE } from '../atmosphere/motion.ts';

export type WaterJetKind = 'sprinkler' | 'stream' | 'shower';
type Def = { tags?: readonly string[]; params?: Record<string, { default?: unknown }>; make?: { kind: string; args?: unknown } };
/** Which moving water a def draws while it is on (by its tags), or null. */
export function waterJetKind(def: Def): WaterJetKind | null {
  const t = def.tags ?? [];
  if (!t.includes('hand-operated')) return null;
  return t.includes('sprinkler') ? 'sprinkler' : t.includes('tap') ? 'stream' : t.includes('shower') ? 'shower' : null;
}
/** The part tinted `nozzle` (where the water leaves), in the def's local frame. */
export function nozzleOf(def: Def): [number, number, number] | null {
  const shapes = def.make?.kind === 'gen' ? (def.make.args as { shapes?: { tint?: string; at?: number[] }[] } | undefined)?.shapes : undefined;
  const n = shapes?.find((s) => s.tint === 'nozzle' && s.at);
  return n?.at ? [n.at[0], n.at[1], n.at[2] ?? 0] : null;
}

// per kind: droplet count, life (s), droplet size (m), and the shader body that places a droplet of age `a`
const KINDS: Record<WaterJetKind, { n: number; life: number; size: number; streak: number; glsl: string }> = {
  // An oscillating garden sprinkler: a fan of twelve jets sweeps ±45° about the forward axis every 6 s; each droplet keeps the
  // direction it was launched in and falls under gravity to the ground (uDrop below the nozzle), then splashes.
  sprinkler: { n: 4800, life: 1.7, size: 0.04, streak: 0.25, glsl: `
    float tb = t - a;
    // twelve holes along the sprinkler bar spread the jets sideways; the whole fan sweeps ±45° every 6 s
    float hole = floor(aSeed.y * 12.0 / 100.0), az = 0.8 * sin(6.2831853 * tb / 6.0) + (hole - 5.5) * 0.06 + (r1 - 0.5) * 0.05;
    float el = 0.62 + (r2 - 0.5) * 0.30;
    float v = uSpeed * (0.62 + 0.38 * r3);
    vec3 d = vec3(sin(az) * cos(el), sin(el), cos(az) * cos(el));
    float tl = (v * d.y + sqrt(v * v * d.y * d.y + 2.0 * 9.8 * uDrop)) / 9.8;
    float fa = min(a, tl);
    p = d * v * fa + vec3(0.0, -4.9 * fa * fa, 0.0);
    if (a > tl) { float s = a - tl; p += vec3((r4 - 0.5) * 0.25, 0.0, (r1 - 0.5) * 0.25) * s * 2.0 + vec3(0.0, 0.9 * s - 4.9 * s * s, 0.0); alpha = clamp(1.0 - s / 0.28, 0.0, 1.0) * 0.8; size *= 0.7; }
    else alpha = 0.9;` },
  // A tap: a stream leaves the spout gently forward and falls into the basin; drops scatter where it lands.
  stream: { n: 900, life: 0.55, size: 0.024, streak: 0.65, glsl: `
    vec3 v = vec3((r1 - 0.5) * 0.03, -0.25, 0.32 + (r2 - 0.5) * 0.05);
    float tl = (v.y + sqrt(v.y * v.y + 2.0 * 9.8 * uDrop)) / 9.8;
    float fa = min(a, tl);
    p = v * fa + vec3((r3 - 0.5) * 0.008, -4.9 * fa * fa, (r4 - 0.5) * 0.008);
    if (a > tl) { float s = a - tl, ang = r3 * 6.2831853; p += vec3(cos(ang), 0.0, sin(ang)) * (0.25 + 0.5 * r4) * s + vec3(0.0, 0.6 * s - 4.9 * s * s, 0.0); alpha = clamp(1.0 - s / 0.18, 0.0, 1.0) * 0.75; size *= 0.8; }
    else alpha = 0.95;` },
  // A shower head: drops leave the rose spread over its face and fall to the tray.
  shower: { n: 1500, life: 0.8, size: 0.03, streak: 0.8, glsl: `
    float ang = r1 * 6.2831853, rad = 0.09 * sqrt(r2);
    vec3 v = vec3(cos(ang) * (0.15 + 0.35 * r3), -0.8, sin(ang) * (0.15 + 0.35 * r3));
    float tl = (v.y + sqrt(v.y * v.y + 2.0 * 9.8 * uDrop)) / 9.8;
    float fa = min(a, tl);
    p = vec3(cos(ang) * rad, 0.0, sin(ang) * rad) + v * fa + vec3(0.0, -4.9 * fa * fa, 0.0);
    if (a > tl) { float s = a - tl; p += vec3((r4 - 0.5) * 0.6, 0.5 - 4.9 * s, (r1 - 0.5) * 0.6) * s; alpha = clamp(1.0 - s / 0.16, 0.0, 1.0) * 0.7; }
    else alpha = 0.85;` },
};
const materials = new Map<WaterJetKind, THREE.ShaderMaterial>(), geometries = new Map<WaterJetKind, THREE.BufferGeometry>();
function material(kind: WaterJetKind) {
  let m = materials.get(kind); if (m) return m;
  const k = KINDS[kind];
  m = new THREE.ShaderMaterial({
    name: `water jets (${kind})`, transparent: true, depthWrite: false,
    uniforms: { uEdenRipple: RIPPLE, uSpeed: { value: 5.5 }, uDrop: { value: 0.66 } },
    vertexShader: /* glsl */`uniform vec4 uEdenRipple; uniform float uSpeed; uniform float uDrop; attribute vec4 aSeed; varying float vAlpha;
      float h(float x){ return fract(sin(x * 91.3458) * 47453.5453); }
      void main(){
        float t = uEdenRipple.x, life = ${k.life.toFixed(3)}, u = t / life + aSeed.x, cyc = floor(u), a = (u - cyc) * life;
        float r1 = h(aSeed.y + cyc * 1.37), r2 = h(aSeed.z + cyc * 2.11), r3 = h(aSeed.w + cyc * 0.73), r4 = h(aSeed.y * 3.1 + cyc);
        vec3 p = vec3(0.0); float alpha = 1.0, size = ${k.size.toFixed(3)};
        ${k.glsl}
        vAlpha = alpha;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(size * 900.0 / max(0.1, -mv.z), 1.5, 24.0);
      }`,
    // falling water reads as short vertical streaks; airborne sprinkler drops as nearly round beads
    fragmentShader: /* glsl */`varying float vAlpha;
      void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(vec2(c.x * ${(1 + 2.6 * k.streak).toFixed(2)}, c.y)); if (d > 0.5) discard;
        float body = smoothstep(0.5, 0.12, d), glint = smoothstep(0.2, 0.0, length(c - vec2(-0.06, -0.14)));
        gl_FragColor = vec4(mix(vec3(0.56, 0.74, 0.88), vec3(1.0), glint * 0.85), body * vAlpha * 0.95); }`,
  });
  materials.set(kind, m); return m;
}
function geometry(kind: WaterJetKind) {
  let g = geometries.get(kind); if (g) return g;
  const n = KINDS[kind].n, seed = new Float32Array(n * 4); let s = 1;
  const rnd = () => ((s = Math.imul(s ^ (s >>> 15), 2246822519) + 3266489917 | 0) >>> 0) / 4294967296;
  for (let i = 0; i < n; i++) { seed[i * 4] = i / n; seed[i * 4 + 1] = rnd() * 100; seed[i * 4 + 2] = rnd() * 100; seed[i * 4 + 3] = rnd() * 100; }
  g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  geometries.set(kind, g); return g;
}
/** The moving water of a thing that is on, placed at its nozzle (its own local frame: +z forward), or null. */
export function waterJets(def: Def, state: Record<string, unknown> | undefined, params: Record<string, unknown> = {}): THREE.Object3D | null {
  const kind = waterJetKind(def), at = nozzleOf(def);
  if (!kind || !at || state?.on !== true) return null;
  const reach = Number(params.reach ?? def.params?.reach?.default ?? 3.5);
  const m = kind === 'sprinkler' ? material(kind).clone() : material(kind);
  m.uniforms.uDrop.value = Math.max(0.05, at[1] - (kind === 'stream' ? 0.1 : kind === 'shower' ? 0.04 : 0));
  // a sprinkler's speed carries the farthest drops to its reach (flat-ground range at the mean launch angle, plus height)
  if (kind === 'sprinkler') { m.uniforms.uEdenRipple = RIPPLE; m.uniforms.uSpeed.value = Math.sqrt(reach * 9.8 / Math.sin(2 * 0.62)) * 0.92; }
  const pts = new THREE.Points(geometry(kind), m);
  pts.name = `water jets (${kind})`; pts.position.set(at[0], at[1], at[2]); pts.frustumCulled = false; pts.renderOrder = 2;
  pts.userData.cameraTransparent = true;
  return pts;
}
