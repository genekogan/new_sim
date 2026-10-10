// Animated water for every water surface (rivers, lakes, ponds, the sea): a standard material
// whose normals ripple with two scrolling wave sets, plus a flow term along the uv's u axis for
// rivers (u = metres along the flow). Time comes from the clock in onBeforeRender, so no layer
// hook is needed; motion is a pure function of wall time (every viewer sees the same thing).
// Owner: L3. The entity layer can use `waterMaterial()` for lakes and the sea (patch 02).
import * as THREE from 'three';

const shared = { uTime: { value: 0 } };
let last = -1;
/** Advance the shared water clock (idempotent within a frame). */
export function tickWater(nowMs = performance.now()) { if (nowMs !== last) { last = nowMs; shared.uTime.value = nowMs / 1000; } }

const cache = new Map<string, THREE.MeshStandardMaterial>();
/** `flow` m/s along +u (rivers), 0 for still water. `color` the deep tint. */
export function waterMaterial(opts: { flow?: number; color?: string; opacity?: number } = {}): THREE.MeshStandardMaterial {
  const flow = opts.flow ?? 0, color = opts.color ?? '#3a7ca8', opacity = opts.opacity ?? 0.8;
  const key = `${flow}|${color}|${opacity}`;
  const hit = cache.get(key); if (hit) return hit;
  const m = new THREE.MeshStandardMaterial({ color, transparent: true, opacity, roughness: 0.18, metalness: 0.12, side: THREE.DoubleSide, depthWrite: false });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = shared.uTime;
    shader.uniforms.uFlow = { value: flow };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vWaterUv;\nvarying vec3 vWaterWorld;\nattribute vec2 waterUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWaterUv = waterUv;\nvWaterWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uFlow;\nvarying vec2 vWaterUv;\nvarying vec3 vWaterWorld;\nvec2 wv(vec2 p, vec2 d, float f, float s){ float ph = dot(p, d) * f + uTime * s; return d * cos(ph) * f; }')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      {
        vec2 p = uFlow > 0.0 ? vec2(vWaterUv.x - uTime * uFlow, vWaterUv.y) : vWaterWorld.xz;
        vec2 g = wv(p, normalize(vec2(1.0, 0.3)), 0.9, 1.3) * 0.05 + wv(p, normalize(vec2(-0.4, 1.0)), 1.7, 1.9) * 0.03 + wv(p, normalize(vec2(0.7, -0.8)), 3.1, 2.7) * 0.015;
        if (uFlow > 0.0) g += vec2(0.0, sin(vWaterUv.y * 2.3 + vWaterUv.x * 0.6 - uTime * uFlow * 1.7) * 0.03);
        vec3 wn = normalize(vec3(-g.x, 1.0, -g.y));
        normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
      }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        vec2 p = uFlow > 0.0 ? vec2(vWaterUv.x - uTime * uFlow * 1.2, vWaterUv.y) : vWaterWorld.xz * 0.35;
        float a = sin(p.x * 1.3 + uTime * 0.7 + sin(p.y * 0.71 + uTime * 0.13) * 2.1);
        float b = sin(p.y * 1.1 - uTime * 0.5 + sin(p.x * 0.53 - uTime * 0.11) * 2.3);
        float sparkle = smoothstep(0.93, 1.0, a * b) * (0.5 + 0.5 * sin(p.x * 0.17 + p.y * 0.23));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.93, 0.97), sparkle * 0.22);
        if (uFlow > 0.0) { float streak = smoothstep(0.6, 1.0, sin(p.x * 0.8 + sin(vWaterUv.y * 1.7) * 2.0)); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.7, 0.84, 0.9), streak * 0.18); }
      }`);
  };
  m.customProgramCacheKey = () => `l3-water-${flow > 0 ? 'flow' : 'still'}`;
  cache.set(key, m);
  return m;
}

/** Give a geometry the attribute the water shader reads (world xz for still water when none is set). */
export function setWaterUv(g: THREE.BufferGeometry, uv?: number[]) {
  if (!uv) { const p = g.attributes.position as THREE.BufferAttribute; uv = []; for (let i = 0; i < p.count; i++) uv.push(p.getX(i), p.getZ(i)); }
  g.setAttribute('waterUv', new THREE.Float32BufferAttribute(uv, 2));
}
/** A water mesh that keeps the shared clock moving while it is drawn. */
export function waterMesh(g: THREE.BufferGeometry, m: THREE.Material, name: string): THREE.Mesh {
  if (!g.attributes.waterUv) setWaterUv(g);
  const mesh = new THREE.Mesh(g, m); mesh.name = name; mesh.userData.cameraTransparent = true; mesh.renderOrder = 2;
  mesh.onBeforeRender = () => tickWater();
  return mesh;
}
