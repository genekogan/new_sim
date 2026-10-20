// W2: fountain water moves, wherever a kit draws water. Two pieces, both pure functions of world time (the atmosphere's
// RIPPLE uniform: x seconds, y strength; 0 when still or reduced motion):
//  - ripples: a kit's water class gets one shared patched copy of its material: rings spread from the entity's own
//    origin (a fountain's jet) plus a cross-chop, in the normal only (no geometry change), as old Eden's fountain had;
//  - falling water: a translucent sheet of streaks falls from the rim of each water disc to the wider disc below it
//    (a tiered fountain's overflow), and shapes tinted spray/jet/cascade/waterfall draw with the same streaks.
// All curtains and sprays share one material; geometry is built once per kit prototype (kit.mesh.ts caches it).
import * as THREE from 'three';
import { RIPPLE } from '../atmosphere/motion.ts';
import { FOG_FRAGMENT, FOG_PARS_FRAGMENT, FOG_PARS_VERTEX, FOG_VERTEX, withSceneFog } from '../../../../mars/viewer/app/engine-view/content/environment/scene-fog.ts';

const KEY = 'eden-w2-water-v1';
const ripples = new WeakMap<THREE.Material, THREE.Material>();
/** The ripple-patched copy of a kit water material (one per base material, shared by every fountain). */
export function rippleMaterial(base: THREE.Material): THREE.Material {
  let m = ripples.get(base);
  if (m) return m;
  m = base.clone(); m.name = 'kit water (rippling)';
  const previous = base.onBeforeCompile, previousKey = base.customProgramCacheKey;
  m.onBeforeCompile = function (shader, renderer) {
    previous.call(this, shader, renderer);
    if (!shader.vertexShader.includes('#include <begin_vertex>') || !shader.fragmentShader.includes('#include <normal_fragment_maps>')) return;
    shader.uniforms.uEdenRipple = RIPPLE;
    shader.vertexShader = 'varying vec3 vEdenWaterW;\nvarying vec3 vEdenWaterO;\n' + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
{ mat4 edenM = modelMatrix;
  #ifdef USE_INSTANCING
  edenM = modelMatrix * instanceMatrix;
  #endif
  vEdenWaterO = edenM[3].xyz; vEdenWaterW = (edenM * vec4(transformed, 1.0)).xyz; }`);
    shader.fragmentShader = 'uniform vec4 uEdenRipple;\nvarying vec3 vEdenWaterW;\nvarying vec3 vEdenWaterO;\n' + shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
if (uEdenRipple.y > 0.0) {
  vec2 edenD = vEdenWaterW.xz - vEdenWaterO.xz; float edenR = length(edenD) + 1e-4, edenT = uEdenRipple.x;
  vec2 edenG = edenD / edenR * cos(edenR * 22.0 - edenT * 5.0) * 11.0 * exp(-edenR * .5);
  edenG += vec2(cos(dot(vEdenWaterW.xz, vec2(9.0, 4.0)) + edenT * 2.3) * 9.0, cos(dot(vEdenWaterW.xz, vec2(-3.0, 8.0)) - edenT * 1.9) * 8.0) * .12;
  vec3 edenWn = normalize(vec3(-edenG.x * .012 * uEdenRipple.y, 1.0, -edenG.y * .012 * uEdenRipple.y));
  normal = normalize(mix(normal, normalize((viewMatrix * vec4(edenWn, 0.0)).xyz), .85));
}`);
  };
  m.customProgramCacheKey = function () { return previousKey.call(this) + '|' + KEY; };
  ripples.set(base, m);
  return m;
}

const streaks: Partial<Record<'sheet' | 'spray', THREE.ShaderMaterial>> = {};
/** Falling water: bright streaks scrolling down a translucent sheet (uv.y = 1 at the top). Shared by every fountain.
 *  'spray' is for kit shapes, which carry no uv: the streaks are laid out in world space instead. */
export function fallingWaterMaterial(kind: 'sheet' | 'spray' = 'sheet'): THREE.ShaderMaterial {
  // W5: in the scene fog like the basin it falls into
  return streaks[kind] ??= withSceneFog(new THREE.ShaderMaterial({
    name: `falling water (${kind})`, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    defines: kind === 'spray' ? { EDEN_WORLD_UV: 1 } : {},
    uniforms: { uEdenRipple: RIPPLE },
    vertexShader: /* glsl */`varying vec2 vUv; varying vec3 vW;${FOG_PARS_VERTEX} void main(){ vec4 w = modelMatrix * vec4(position, 1.0);
      #ifdef USE_INSTANCING
      w = modelMatrix * instanceMatrix * vec4(position, 1.0);
      #endif
      #ifdef EDEN_WORLD_UV
      vUv = vec2((w.x + w.z) * 0.7, 0.5 + w.y * 0.6);
      #else
      vUv = uv;
      #endif
      vW = w.xyz; vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;${FOG_VERTEX} }`,
    fragmentShader: /* glsl */`uniform vec4 uEdenRipple; varying vec2 vUv; varying vec3 vW;${FOG_PARS_FRAGMENT}
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main(){
        float t = uEdenRipple.x * (0.35 + 0.65 * uEdenRipple.y), cx = vUv.x * 64.0, col = floor(cx), s = h(vec2(col, 1.7));
        float lane = smoothstep(0.0, 0.35, fract(cx)) * smoothstep(1.0, 0.65, fract(cx));
        float f = fract((vUv.y + t * (1.1 + 0.6 * s) + s * 7.0) * (2.0 + 2.0 * s));
        float streak = lane * smoothstep(0.35, 0.8, f) * smoothstep(1.0, 0.85, f);
        #ifdef EDEN_WORLD_UV
        float edge = 1.0;
        #else
        float edge = smoothstep(0.0, 0.12, vUv.y) * smoothstep(1.0, 0.85, vUv.y);
        #endif
        float a = (0.18 + 0.5 * streak) * edge * (0.6 + 0.4 * h(vec2(col, 9.3)));
        gl_FragColor = vec4(mix(vec3(0.62, 0.78, 0.86), vec3(0.95, 0.98, 1.0), streak), a);${FOG_FRAGMENT}
      }`,
  }));
}

/** A kit shape that draws moving water (a jet, spray, cascade or waterfall). */
export const isSprayShape = (sh: { tint?: string }) => /spray|jet|cascade|waterfall/.test(sh.tint ?? '');
export type Disc = { x: number; y: number; z: number; r: number };
/** Overflow sheets between stacked water discs: from each disc's rim down to the next wider disc below it. */
export function fallingWaterSheets(discs: readonly Disc[]): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  for (const a of discs) {
    let below: Disc | null = null;
    for (const b of discs) if (b !== a && b.y < a.y - 0.15 && b.r > a.r * 1.15 && Math.hypot(b.x - a.x, b.z - a.z) < b.r - a.r && (!below || b.y > below.y)) below = b;
    if (!below) continue;
    const h = a.y - below.y, g = new THREE.CylinderGeometry(a.r * 1.01, a.r * 1.08, h, 32, 1, true);
    const m = new THREE.Mesh(g, fallingWaterMaterial());
    m.position.set(a.x, below.y + h / 2, a.z); m.name = 'falling water'; m.castShadow = false; m.renderOrder = 3;
    out.push(m);
  }
  return out;
}
