// Human surface finish: presentation-only material realism for the Soul GLBs.
// Explicit per-template, per-slot table (audited slot names; never inferred from
// colours). Changes only roughness and one shared compile hook on the template's
// own MeshStandardMaterials, in place. Rigs, bones, poses, geometry, names and
// draw lists are never touched. One program variant serves every role (role is a
// uniform); zero textures, zero extra passes, fine detail fades with distance.
import * as T from 'three';

export const HUMAN_FINISH_VERSION='human-finish/1';
export type HumanFinishRole='skin'|'cloth'|'denim'|'leather'|'sole'|'hair'|'brow'|'eye'|'trinket';
export type HumanFinishSlot=Readonly<{role:HumanFinishRole;roughness:number}>;
const ROLE_ID:Record<HumanFinishRole,number>={skin:1,cloth:2,denim:3,leather:4,sole:5,hair:6,brow:7,eye:8,trinket:9};
const slot=(role:HumanFinishRole,roughness:number)=>Object.freeze({role,roughness});
/** template -> GLB material name -> finish. Names are the audited audit.json slots. */
export const HUMAN_FINISH:Readonly<Record<'casual'|'punk'|'woman',Readonly<Record<string,HumanFinishSlot>>>>=Object.freeze({
 casual:Object.freeze({Skin:slot('skin',.62),Skin_Darker:slot('skin',.62),LightBrown:slot('cloth',.88),Red_Dark:slot('leather',.6),White:slot('sole',.9),Eyebrows:slot('brow',.82),Hair:slot('hair',.58),Eye:slot('eye',.22),LightBlue:slot('denim',.9)}),
 punk:Object.freeze({Skin:slot('skin',.62),White:slot('cloth',.88),Black:slot('leather',.6),Eye:slot('eye',.22),Eyebrows:slot('brow',.82),Red_Dark:slot('hair',.58),Red:slot('hair',.58),Earrings:slot('trinket',.36),LightBlue:slot('denim',.9)}),
 woman:Object.freeze({Skin:slot('skin',.62),White:slot('cloth',.86),Grey:slot('leather',.62),Hair_Brown:slot('brow',.82),Brown:slot('eye',.22),Hair_Blond:slot('hair',.58),Orange:slot('cloth',.88)}),
});
export function humanFinishFor(template:unknown,name:unknown):HumanFinishSlot|null{
 if(template!=='casual'&&template!=='punk'&&template!=='woman'||typeof name!=='string')return null;
 return Object.hasOwn(HUMAN_FINISH[template],name)?HUMAN_FINISH[template][name]:null;
}

const roles=new WeakMap<T.Material,HumanFinishRole>();
const roleUniforms=Object.fromEntries(Object.entries(ROLE_ID).map(([k,v])=>[k,{value:v}])) as Record<HumanFinishRole,{value:number}>;
const KEY='eden-human-finish-v1';

const VERTEX_HEAD=/* glsl */`
varying vec3 vHumanP;
`;
// Bind-space position: detail stays glued to the garment/skin as limbs move.
const VERTEX_BODY=/* glsl */`
vHumanP=position;
`;
const FRAGMENT_HEAD=/* glsl */`
uniform float edenHumanRole;
varying vec3 vHumanP;
float hHash(vec3 p){p=fract(p*vec3(.1031,.1030,.0973));p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z);}
// 3D value noise that settles to its mean once a cell nears pixel size (no shimmer at distance).
float hNoise(vec3 p){vec3 i=floor(p),f=fract(p),d=fwidth(p);f=f*f*(3.-2.*f);
 float n=mix(mix(mix(hHash(i),hHash(i+vec3(1,0,0)),f.x),mix(hHash(i+vec3(0,1,0)),hHash(i+vec3(1,1,0)),f.x),f.y),
  mix(mix(hHash(i+vec3(0,0,1)),hHash(i+vec3(1,0,1)),f.x),mix(hHash(i+vec3(0,1,1)),hHash(i+vec3(1,1,1)),f.x),f.y),f.z);
 return mix(n,.5,smoothstep(.35,.9,max(d.x,max(d.y,d.z))));}
`;
const FRAGMENT_BODY=/* glsl */`
float humanRough=1.,humanBump=0.,humanBumpAmt=0.;
{
 float role=edenHumanRole;vec3 hp=vHumanP;
 // Distance LOD: weave/strand/pore detail only within ~12 m (Follow and close Look), gone by 20 m.
 float hnear=1.-smoothstep(12.,20.,length(vViewPosition));bool hdetail=hnear>.001;
 vec3 tint=vec3(1.);
 if(role<1.5){ // skin: faint mottling and warm/cool zones, slightly varying sheen
  float zone=hNoise(hp*7.+3.1),m=hdetail?mix(.5,hNoise(hp*70.),hnear):.5;
  tint=mix(vec3(.985,.99,1.),vec3(1.03,.985,.965),zone)*(.975+.05*m);
  humanRough=.93+.14*m;humanBump=m*.0006;humanBumpAmt=hnear;
 }else if(role<3.5){ // woven fabric (cloth) and twill (denim): dye variation, pilling, weave relief
  float dye=hNoise(hp*3.3+7.),pill=hdetail?mix(.5,hNoise(hp*36.),hnear):.5,weave=0.;
  if(hdetail){vec3 a=abs(normalize(cross(dFdx(hp),dFdy(hp))));vec2 q=a.z>max(a.x,a.y)?hp.xy:(a.x>a.y?hp.zy:hp.xy);
   q*=role<2.5?1150.:900.;float wv=role<2.5?sin(q.x)*sin(q.y):sin(q.x+q.y)*.8+.2*sin(q.x-q.y);vec2 fw=fwidth(q);
   weave=wv*(1.-smoothstep(.5,1.3,max(fw.x,fw.y)))*hnear;}
  tint=vec3(.93+.12*dye)*(.95+.08*pill)*(1.+.035*weave);
  if(role>2.5){ // denim: faded fronts of thighs and knees, darker seams of the inside leg
   vec3 nb=normalize(cross(dFdx(hp),dFdy(hp)));tint*=mix(1.,1.1,smoothstep(.2,.8,nb.z)*smoothstep(.25,.55,hp.y)*(1.-smoothstep(.75,.95,hp.y)));
  }
  humanRough=1.+.06*(pill-.5);humanBump=pill*.0012+weave*.00025;humanBumpAmt=hnear;
 }else if(role<4.5){ // leather/shoes/boots: creases and scuffs, uneven polish
  float c=hdetail?mix(.5,hNoise(hp*vec3(60.,24.,60.)),hnear):.5,s=hNoise(hp*9.+2.);
  tint=vec3(.92+.14*s)*(.96+.06*c);humanRough=.85+.35*c;humanBump=c*.0008;humanBumpAmt=hnear;
 }else if(role<5.5){ // soles/laces: dusty, matte
  tint=vec3(.9+.08*hNoise(hp*20.))*mix(.92,1.,smoothstep(.0,.06,hp.y));humanRough=1.08;
 }else if(role<6.5){ // hair: strand streaks, darker roots near the scalp, sheen varies per strand clump
  vec3 c=hp-vec3(0.,1.685,.035);float r=length(c*vec3(1.,.92,1.));
  float strand=hdetail?mix(.5,hNoise(vec3(hp.x*260.,hp.y*16.,hp.z*260.)),hnear):.5,clump=hNoise(hp*vec3(40.,8.,40.));
  float roots=1.-smoothstep(.095,.14,r);
  tint=vec3(.88+.24*strand)*(.92+.14*clump)*mix(1.,.62,roots);
  humanRough=.78+.5*strand;humanBump=strand*.0008;humanBumpAmt=hnear;
 }else if(role<7.5){ // brows: matte fine hairs
  tint=vec3(.85+.2*(hdetail?mix(.5,hNoise(hp*vec3(600.,120.,600.)),hnear):.5));humanRough=1.05;
 }else if(role<8.5){ // eyes: darker pupil, lighter iris ring, glossy cornea
  float r=length(vec2(abs(hp.x)-.045,hp.y-1.694))/.0125;
  tint=r<.38?vec3(.45):mix(vec3(2.6,2.2,1.9),vec3(1.),smoothstep(.62,.95,r));
 }
 diffuseColor.rgb*=tint;
}
`;
/** After lighting: soft occlusion feel, skin warmth (terminator scatter, warm shadows), cloth sheen, eye catchlight. */
const LIGHT_BODY=/* glsl */`
{
 float role=edenHumanRole;vec3 hp=vHumanP;
 vec3 wn=inverseTransformDirection(normal,viewMatrix);
 // Undersides of chin/arms/hems see less sky; lower legs and feet see the ground; inner thighs close in.
 float ao=mix(.64,1.,clamp(wn.y*.5+.5,0.,1.))*mix(.8,1.,smoothstep(.02,.5,hp.y));
 ao*=1.-.22*(1.-smoothstep(.025,.075,abs(hp.x)))*smoothstep(.55,.85,hp.y)*(1.-smoothstep(.9,1.02,hp.y));
 if(role>7.5&&role<8.5)ao=1.;
 reflectedLight.indirectDiffuse*=ao;reflectedLight.directDiffuse*=mix(1.,ao,.3);
 vec3 V=normalize(vViewPosition);float facing=clamp(dot(normal,V),0.,1.),rim=pow(1.-facing,3.);
 float amb=dot(reflectedLight.indirectDiffuse,vec3(.333))/max(dot(diffuseColor.rgb,vec3(.333)),1e-3);
 if(role<1.5){
  float base=max(dot(diffuseColor.rgb,vec3(.333)),1e-3),irr=dot(reflectedLight.directDiffuse,vec3(.333))/base;
  float term=smoothstep(0.,.06,irr)*(1.-smoothstep(.06,.3,irr));
  reflectedLight.directDiffuse+=diffuseColor.rgb*vec3(.15,.05,.02)*term;
  reflectedLight.indirectDiffuse*=vec3(1.035,.995,.97);
  reflectedLight.indirectDiffuse+=diffuseColor.rgb*vec3(1.,.74,.64)*rim*.16*amb;
 }else if(role<3.5){
  reflectedLight.indirectDiffuse+=diffuseColor.rgb*rim*.22*amb;
 }else if(role>7.5&&role<8.5){
  vec3 L=normalize(vec3(.35,.5,1.));float glint=smoothstep(.88,.95,dot(normal,L));
  reflectedLight.directSpecular+=vec3(.6)*glint;
 }
}
`;
const BUMP=/* glsl */`if(humanBumpAmt>0.){vec3 sx=dFdx(-vViewPosition),sy=dFdy(-vViewPosition),r1=cross(sy,normal),r2=cross(normal,sx);float det=dot(sx,r1);
 vec3 grad=sign(det)*(dFdx(humanBump)*r1+dFdy(humanBump)*r2);normal=normalize(abs(det)*normal-grad*humanBumpAmt);}`;

/** Shared compile hook (identity is part of the preset adapter contract). Role comes from the material. */
export function humanFinishCompile(this:T.Material,shader:T.WebGLProgramParametersWithUniforms){
 const role=roles.get(this);if(!role)return;
 shader.uniforms.edenHumanRole=roleUniforms[role];
 shader.vertexShader=VERTEX_HEAD+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\n'+VERTEX_BODY);
 shader.fragmentShader=FRAGMENT_HEAD+shader.fragmentShader
  .replace('#include <color_fragment>','#include <color_fragment>\n'+FRAGMENT_BODY)
  .replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=clamp(roughnessFactor*humanRough,.04,1.);')
  .replace('#include <normal_fragment_maps>','#include <normal_fragment_maps>\n'+BUMP)
  .replace('#include <aomap_fragment>','#include <aomap_fragment>\n'+LIGHT_BODY);
}
export function humanFinishKey(){return KEY;}

const pristine=(m:T.Material)=>m.onBeforeCompile===T.Material.prototype.onBeforeCompile&&m.customProgramCacheKey===T.Material.prototype.customProgramCacheKey;
/** Role installed on a material (null when not finished). */
export function humanFinishRoleOf(m:unknown):HumanFinishRole|null{
 if(!(m instanceof T.Material)||m.onBeforeCompile!==humanFinishCompile||m.customProgramCacheKey!==humanFinishKey)return null;return roles.get(m)??null;
}
/** Exactly finished for this audited slot: hooks, role and roughness all as the table says. */
export function isHumanFinished(m:unknown,template:unknown,name:unknown){const f=humanFinishFor(template,name);return!!f&&m instanceof T.MeshStandardMaterial&&humanFinishRoleOf(m)===f.role&&m.roughness===f.roughness;}

function install(m:T.MeshStandardMaterial,f:HumanFinishSlot){
 roles.set(m,f.role);m.roughness=f.roughness;m.onBeforeCompile=humanFinishCompile;m.customProgramCacheKey=humanFinishKey;m.needsUpdate=true;
}
/** In place, idempotent, over one loaded template scene. Only pristine audited slots (roughness .5, prototype
 * hooks, metalness 0, no maps) are finished; anything else is left alone. Returns materials newly finished. */
export function applyHumanFinish(template:string,root:T.Object3D){
 const seen=new Set<T.Material>();let added=0;
 root.traverse(o=>{const mesh=o as T.SkinnedMesh;if(!mesh.isSkinnedMesh||Array.isArray(mesh.material))return;const m=mesh.material;if(seen.has(m))return;seen.add(m);
  if(!(m instanceof T.MeshStandardMaterial)||Object.getPrototypeOf(m)!==T.MeshStandardMaterial.prototype)return;
  const f=humanFinishFor(template,m.name);if(!f||!pristine(m)||m.roughness!==.5||m.metalness!==0||m.map||m.roughnessMap||m.normalMap)return;
  install(m,f);added++;});
 return added;
}
/** An owned clone of a finished original receives the same finish (Material.copy does not copy hooks). */
export function finishCloneLike(clone:T.MeshStandardMaterial,original:T.Material){
 const role=humanFinishRoleOf(original);if(!role)return false;
 roles.set(clone,role);clone.onBeforeCompile=humanFinishCompile;clone.customProgramCacheKey=humanFinishKey;return true;
}
