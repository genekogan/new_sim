// W5 (2026-10-20): a hand-written ShaderMaterial takes the scene's fog the way every built-in material does, through
// three's own fog chunks, so whatever a host folds into those chunks (Sim's rain mist, desert dust and colour grade)
// applies to it as well. Without scene.fog the chunks compile to nothing. Before this, a far calm-water plane kept its
// full colour while the land around it faded into rain or fog.
import * as THREE from 'three';

/** Vertex: declare after the shader's own varyings. */
export const FOG_PARS_VERTEX = '\n#include <fog_pars_vertex>\n';
/** Vertex: after `mvPosition` (the view-space position) is computed. */
export const FOG_VERTEX = '\n#include <fog_vertex>\n';
/** Fragment: declare after the shader's own uniforms. */
export const FOG_PARS_FRAGMENT = '\n#include <fog_pars_fragment>\n';
/** Fragment: last, after gl_FragColor (and any tone mapping / colour space includes) is written. */
export const FOG_FRAGMENT = '\n#include <fog_fragment>\n';

/** Turn the scene fog on for a ShaderMaterial whose shaders include the four chunks above. Returns the material. */
export function withSceneFog<M extends THREE.ShaderMaterial>(m: M): M {
  m.fog = true;
  for (const [k, u] of Object.entries(THREE.UniformsLib.fog)) if (!(k in m.uniforms)) m.uniforms[k] = { value: (u.value as { clone?: () => unknown })?.clone?.() ?? u.value };
  const previous = m.onBeforeCompile;
  m.onBeforeCompile = function (shader, renderer) {
    previous.call(this, shader, renderer);
    // A host's own fog uniforms live on the built-in libraries (shared objects, one write a frame updates every material).
    const lib = THREE.ShaderLib.standard.uniforms as Record<string, THREE.IUniform>, chunks = THREE.ShaderChunk.fog_pars_vertex + THREE.ShaderChunk.fog_pars_fragment;
    for (const k of Object.keys(lib)) if (!(k in shader.uniforms) && new RegExp(`\\buniform\\s+\\w+\\s+${k}\\s*;`).test(chunks)) shader.uniforms[k] = lib[k];
  };
  return m;
}
