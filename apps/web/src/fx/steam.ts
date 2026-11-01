// Soul Actions entry 43: steam from a kettle's spout and from a fresh cup of tea. Each wisp is a GPU point whose place is a
// pure function of the atmosphere's clock (RIPPLE.x, world seconds) and its own seeds: it rises, drifts, widens and fades.
// How much of the plume shows (uHeat) comes from kettleHeat / cupSteam at the depicted tick, one uniform per steaming
// thing per frame; a cold kettle or a cold cup draws nothing.
import * as THREE from 'three';
import { RIPPLE } from '../atmosphere/motion.ts';

export type SteamKind = 'kettle' | 'cup';
const KINDS: Record<SteamKind, { n: number; life: number; rise: number; spread: number; size: number; alpha: number }> = {
  // a kettle's plume: a fast jet out of the spout that slows, billows and drifts up over ~1.6 s
  kettle: { n: 520, life: 1.7, rise: 0.38, spread: 0.11, size: 0.045, alpha: 0.32 },
  // a cup: a few slow, thin wisps over the rim
  cup: { n: 120, life: 2.6, rise: 0.09, spread: 0.035, size: 0.03, alpha: 0.2 },
};
const materials = new Map<SteamKind, THREE.ShaderMaterial>(), geometries = new Map<SteamKind, THREE.BufferGeometry>();
function material(kind: SteamKind) {
  const k = KINDS[kind];
  const m = new THREE.ShaderMaterial({
    name: `steam (${kind})`, transparent: true, depthWrite: false,
    uniforms: { uEdenRipple: RIPPLE, uHeat: { value: 0 }, uJet: { value: new THREE.Vector3(0, 0, 0) } },
    vertexShader: /* glsl */`uniform vec4 uEdenRipple; uniform float uHeat; uniform vec3 uJet; attribute vec4 aSeed; varying float vAlpha;
      float h(float x){ return fract(sin(x * 91.3458) * 47453.5453); }
      void main(){
        float life = ${k.life.toFixed(3)}, t = uEdenRipple.x, u = t / life + aSeed.x, cyc = floor(u), a = (u - cyc) * life, q = a / life;
        float r1 = h(aSeed.y + cyc * 1.37), r2 = h(aSeed.z + cyc * 2.11), r3 = h(aSeed.w + cyc * 0.73);
        // a wisp shows only as much of the plume as the heat allows (the seed's own threshold)
        float on = step(h(aSeed.y * 0.37 + aSeed.z), uHeat);
        // out of the spout along uJet, slowing quickly; then rising with a slow sideways drift and swirl
        float out_ = (1.0 - exp(-a * 4.0)) / 4.0;
        float ang = r1 * 6.2831853 + a * (1.2 + r3);
        vec3 p = uJet * out_ * (0.6 + 0.8 * r2) + vec3(0.0, ${k.rise.toFixed(3)} * a * (0.7 + 0.6 * r3), 0.0)
               + vec3(cos(ang), 0.0, sin(ang)) * ${k.spread.toFixed(3)} * sqrt(q) * (0.4 + r2) + vec3(0.06, 0.0, 0.03) * a * a;
        vAlpha = on * smoothstep(0.0, 0.12, q) * (1.0 - smoothstep(0.45, 1.0, q)) * ${k.alpha.toFixed(3)} * (0.6 + 0.4 * uHeat);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(${k.size.toFixed(3)} * (0.5 + 2.2 * q) * 900.0 / max(0.1, -mv.z), 1.0, 90.0);
      }`,
    fragmentShader: /* glsl */`varying float vAlpha;
      void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c); if (d > 0.5) discard;
        gl_FragColor = vec4(vec3(0.93, 0.95, 0.97), smoothstep(0.5, 0.0, d) * vAlpha); }`,
  });
  materials.set(kind, m); return m;
}
function geometry(kind: SteamKind) {
  let g = geometries.get(kind); if (g) return g;
  const n = KINDS[kind].n, seed = new Float32Array(n * 4); let s = 7;
  const rnd = () => ((s = Math.imul(s ^ (s >>> 15), 2246822519) + 3266489917 | 0) >>> 0) / 4294967296;
  for (let i = 0; i < n; i++) { seed[i * 4] = i / n; seed[i * 4 + 1] = rnd() * 100; seed[i * 4 + 2] = rnd() * 100; seed[i * 4 + 3] = rnd() * 100; }
  g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.4, 0), 1.2);
  geometries.set(kind, g); return g;
}
/** A steam plume (its own material: each thing has its own heat). Place it at the spout/rim in world space each frame. */
export function steam(kind: SteamKind): THREE.Points {
  void materials;
  const p = new THREE.Points(geometry(kind), material(kind));
  p.name = `steam (${kind})`; p.frustumCulled = true; p.renderOrder = 3; p.visible = false; p.userData.steam = kind;
  return p;
}
/** Set how much of the plume shows (0..1) and the direction it leaves in (world, m/s). Hidden at 0. */
export function setSteam(p: THREE.Points, heat: number, jet?: THREE.Vector3) {
  const u = (p.material as THREE.ShaderMaterial).uniforms;
  u.uHeat.value = Math.max(0, Math.min(1, heat)); if (jet) (u.uJet.value as THREE.Vector3).copy(jet);
  p.visible = heat > 0.004;
}
