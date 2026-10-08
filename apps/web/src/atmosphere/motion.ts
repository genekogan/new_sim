import * as THREE from 'three';
/** Small mechanical / water motions by material patch (no transforms touched):
 *  - windmill sails turn about their hub (speed follows the wind);
 *  - small static fountain / basin water gets fine concentric ripples.
 * Lake and river surfaces are already animated by the realism pass. */
export const ROTOR={value:{x:1e9,y:1e9,z:1e9,w:0}}; // hub world position, w = sail angle (rad)
export const RIPPLE={value:{x:0,y:0,z:0,w:0}}; // x time (s), y strength (0 = off)
/** The existing static ornamental sky clouds: xz drift offset (m), z colour multiplier (greyer under overcast). */
export const SKY_OBJECTS={value:{x:0,y:0,z:1,w:0}};
const KEY='eden-atmos-motion-v1';
const ROTOR_HEAD=/* glsl */`uniform vec4 uEdenRotor;\n`;
const rotate=(v:string)=>/* glsl */`
if(distance(modelMatrix[3].xyz,uEdenRotor.xyz)<.02){
 float edenC=cos(uEdenRotor.w),edenS=sin(uEdenRotor.w);mat3 edenR=mat3(edenC,edenS,0.0,-edenS,edenC,0.0,0.0,0.0,1.0);
 #ifdef USE_INSTANCING
  mat3 edenI=mat3(instanceMatrix);vec3 edenT=${v==='transformed'?'instanceMatrix[3].xyz':'vec3(0.0)'};
  ${v}=inverse(edenI)*(edenR*(edenI*${v}+edenT)-edenT);
 #else
  ${v}=edenR*${v};
 #endif
}
`;
const WATER_HEAD=/* glsl */`uniform vec4 uEdenRipple;\nuniform vec3 uEdenRippleC;\n`;
const WATER=/* glsl */`
float edenRip=0.0;
#ifdef USE_FOG
if(uEdenRipple.y>0.0){
 vec2 edenD=vEdenAtmosW.xz-uEdenRippleC.xz;float edenR=length(edenD)+1e-4;
 float edenT=uEdenRipple.x;
 // rings travelling outward from the jet + a cross-chop from two travelling waves
 vec2 edenG=edenD/edenR*cos(edenR*22.0-edenT*5.0)*22.0*exp(-edenR*.6)*.5;
 edenG+=vec2(cos(dot(vEdenAtmosW.xz,vec2(9.0,4.0))+edenT*2.3)*9.0,cos(dot(vEdenAtmosW.xz,vec2(-3.0,8.0))-edenT*1.9)*8.0)*.12;
 vec3 edenWn=normalize(vec3(-edenG.x*.012*uEdenRipple.y,1.0,-edenG.y*.012*uEdenRipple.y));
 normal=normalize(mix(normal,normalize((viewMatrix*vec4(edenWn,0.0)).xyz),.85));
 edenRip=(edenG.x+edenG.y)*.06*uEdenRipple.y;
}
#endif
`;
type Hook={material:THREE.Material;onBeforeCompile:THREE.Material['onBeforeCompile'];key:THREE.Material['customProgramCacheKey']};
export class MotionPatches{
 private readonly hooks:Hook[]=[];private readonly done=new WeakSet<THREE.Material>();
 rotorFound=false;waterFound=0;skyClouds=0;
 private hook(m:THREE.Material,tag:string,edit:(s:{vertexShader:string;fragmentShader:string;uniforms:Record<string,THREE.IUniform>})=>void){
  if(this.done.has(m))return;this.done.add(m);
  const previous=m.onBeforeCompile,previousKey=m.customProgramCacheKey;
  m.onBeforeCompile=function(shader,renderer){previous.call(this,shader,renderer);edit(shader);};
  m.customProgramCacheKey=function(){return previousKey.call(this)+'|'+KEY+':'+tag;};
  m.needsUpdate=true;this.hooks.push({material:m,onBeforeCompile:previous,key:previousKey});
 }
 /** Find the sails hub and small fountain water. Idempotent; called on the periodic scan. */
 scan(scene:THREE.Scene,skip:(o:THREE.Object3D)=>boolean){
  const hub=this.rotorFound?null:scene.getObjectByName('windmill-sails');
  if(hub&&!skip(hub)){
   hub.updateWorldMatrix(true,false);const p=new THREE.Vector3().setFromMatrixPosition(hub.matrixWorld);ROTOR.value.x=p.x;ROTOR.value.y=p.y;ROTOR.value.z=p.z;
   hub.traverse(o=>{const mesh=o as THREE.Mesh;if(!mesh.isMesh)return;
    for(const m of ([] as THREE.Material[]).concat(mesh.material))this.hook(m,'rotor',s=>{if(!s.vertexShader.includes('#include <begin_vertex>'))return;s.uniforms.uEdenRotor=ROTOR;
     s.vertexShader=ROTOR_HEAD+s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\n'+rotate('transformed')).replace('#include <beginnormal_vertex>','#include <beginnormal_vertex>\n'+rotate('objectNormal'));});});
   this.rotorFound=true;
  }
  for(const g of scene.children)g.traverse(o=>{
   if(!skip(o)&&/cloud family|ornamental sky/i.test(o.name))o.traverse(c=>{const mesh=c as THREE.Mesh;if(!mesh.isMesh)return;
    for(const m of ([] as THREE.Material[]).concat(mesh.material)){if(this.done.has(m))continue;this.skyClouds++;
     this.hook(m,'skycloud',sh=>{if(!sh.vertexShader.includes('#include <begin_vertex>')||!sh.fragmentShader.includes('#include <color_fragment>'))return;sh.uniforms.uEdenSkyObj=SKY_OBJECTS;
      sh.vertexShader='uniform vec4 uEdenSkyObj;\n'+sh.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\n{mat4 edenM=modelMatrix;\n#ifdef USE_INSTANCING\nedenM=modelMatrix*instanceMatrix;\n#endif\nvec3 edenV=vec3(uEdenSkyObj.x,0.0,uEdenSkyObj.y);transformed+=vec3(dot(edenM[0].xyz,edenV)/dot(edenM[0].xyz,edenM[0].xyz),dot(edenM[1].xyz,edenV)/dot(edenM[1].xyz,edenM[1].xyz),dot(edenM[2].xyz,edenV)/dot(edenM[2].xyz,edenM[2].xyz));}');
      sh.fragmentShader='uniform vec4 uEdenSkyObj;\n'+sh.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\ndiffuseColor.rgb*=uEdenSkyObj.z;');});}});
   if(skip(o)||!/fountain|basin|pond/i.test(o.name)||!(o as THREE.Group).isObject3D)return;
   const centre=new THREE.Vector3();o.updateWorldMatrix(true,false);centre.setFromMatrixPosition(o.matrixWorld);
   o.traverse(c=>{const mesh=c as THREE.Mesh;if(!mesh.isMesh)return;
    for(const m of ([] as THREE.Material[]).concat(mesh.material)){const std=m as THREE.MeshStandardMaterial;
     if(!std.isMeshStandardMaterial||std.roughness>=.5||std.transparent||!(std.color.b>std.color.r&&std.color.g>std.color.r)||this.done.has(m))continue;
     const c3={value:centre.clone()};this.waterFound++;
     this.hook(m,'water',s=>{if(!s.fragmentShader.includes('#include <normal_fragment_maps>'))return;s.uniforms.uEdenRipple=RIPPLE;s.uniforms.uEdenRippleC=c3;
      s.fragmentShader=WATER_HEAD+s.fragmentShader.replace('#include <normal_fragment_maps>','#include <normal_fragment_maps>\n'+WATER).replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\ntotalEmissiveRadiance+=diffuseColor.rgb*clamp(edenRip,-.6,.6)*.35;');});}});
  });
 }
 dispose(){for(const h of this.hooks){h.material.onBeforeCompile=h.onBeforeCompile;h.material.customProgramCacheKey=h.key;h.material.needsUpdate=true;}this.hooks.length=0;}
}
