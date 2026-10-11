// One palette material per composed look. Colour, finish role and roughness come per vertex (the kit's
// _HINFO attribute: [palette slot, finish role, roughness·255, flags]) so a whole part is one draw. The surface
// finish is finish.ts's own shader (skin mottling, weave, hair strands, eye glints...), reused through its
// public hook with the role turned from a uniform into a per-vertex varying. Zero textures; one program for
// every composed body.
import * as THREE from 'three';
import {applyHumanFinish, humanFinishCompile} from '../../../../mars/viewer/app/engine-view/content/details/human-presets/finish.ts';

export const HUMANOID_PROGRAM_KEY = 'eden-humanoid2-v1';
// A finished donor gives humanFinishCompile a role to run with (its role uniform is replaced below).
const donor = new THREE.MeshStandardMaterial({roughness: .5, metalness: 0});
donor.name = 'Skin';
applyHumanFinish('casual', new THREE.SkinnedMesh(new THREE.BufferGeometry(), donor));

const VERTEX_HEAD = /* glsl */`attribute vec4 hinfo;
varying float edenHumanRole;
varying float hSlot;
varying float hRough;
`;
const VERTEX_BODY = /* glsl */`
edenHumanRole=hinfo.y;hSlot=hinfo.x;hRough=hinfo.z/255.;`;
const FRAGMENT_DECL = /* glsl */`varying float edenHumanRole;
varying float hSlot;
varying float hRough;
uniform vec3 hPalette[16];
uniform float hPattern;`;
// Palette colour, then an optional procedural pattern on the cloth of the top (bind space: glued to the garment).
const PALETTE = /* glsl */`
{
 int hs=int(hSlot+.5);vec3 hc=hPalette[hs];
 if(hPattern>.5&&(hs==6||hs==7)&&edenHumanRole>1.5&&edenHumanRole<2.5){
  vec3 ho=hPalette[hs==6?7:6],hp=vHumanP;float hm=0.,hf=0.;
  if(hPattern<1.5){float q=hp.y*16.;hm=step(.5,fract(q));hf=fwidth(q);} // stripes
  else if(hPattern<2.5){vec2 q=vec2(hp.y,hp.x+hp.z*.6)*13.;hm=mod(floor(q.x)+floor(q.y),2.);hf=max(fwidth(q.x),fwidth(q.y));} // checks
  else{float q=atan(hp.x,hp.z-.04)*26.;hm=smoothstep(.25,.75,abs(fract(q)-.5)*2.)*.55+.2*step(.5,fract(hp.y*40.));hf=fwidth(q);} // knit ribs
  hm=mix(hm,.5,smoothstep(.35,.9,hf));
  hc=mix(hc,ho,hm*.85);
 }
 diffuseColor.rgb=hc;
}
`;

/** Patch a finish.ts-compiled shader into the per-vertex palette variant (exported for the kit test). */
export function humanoidCompile(shader: THREE.WebGLProgramParametersWithUniforms, palette: Float32Array, pattern: {value: number}) {
  humanFinishCompile.call(donor, shader);
  if (!shader.fragmentShader.includes('uniform float edenHumanRole;')) throw Error('finish.ts shader layout changed');
  shader.uniforms.hPalette = {value: palette};
  shader.uniforms.hPattern = pattern;
  shader.vertexShader = VERTEX_HEAD + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>' + VERTEX_BODY);
  shader.fragmentShader = shader.fragmentShader.replace('uniform float edenHumanRole;', FRAGMENT_DECL)
    .replace('#include <color_fragment>', '#include <color_fragment>' + PALETTE)
    .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor=hRough;');
}

export function humanoidMaterial(palette: Float32Array, patternId: number): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({color: 0xffffff, roughness: .5, metalness: 0, side: THREE.DoubleSide});
  m.name = 'humanoid@2';
  const pattern = {value: patternId};
  m.userData.humanoid = {palette, pattern};
  m.onBeforeCompile = shader => humanoidCompile(shader, palette, pattern);
  m.customProgramCacheKey = () => HUMANOID_PROGRAM_KEY;
  return m;
}
