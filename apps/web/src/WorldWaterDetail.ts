import * as THREE from 'three';
import {classifyRealism,realismClassOf} from './WorldEdenRealism.ts';
/** W11 water detail, one module for both engines (old per-world scenes and new entity worlds):
 *  - surface shimmer: twinkling sun glitter on every water surface that opts in (`WATER_DETAIL_GLSL`);
 *  - swimmer ripples: expanding rings around each Soul in the water and a short broken wake behind one that
 *    travels, from a fixed set of SWIMMERS slots (no allocation per frame, no fluid simulation);
 *  - gradual underwater fade: body fragments below the water surface lose contrast and shift toward the water
 *    colour with depth. This is an inexpensive submerged-depth approximation (vertical depth under a flat water
 *    rectangle), not viewing-ray absorption.
 * Render-time only: positions, poses, water datum and contact inputs are read, never changed. Time is the
 * displayed world time, so pause, seek and reset show the same water. */
export const SWIMMERS=8,REGIONS=6;
/** Ripple time wrap (s): keeps float precision; ring/wake periods divide it so the wrap is seamless. */
const WRAP=2.4*1500;
const v4=(n:number)=>Array.from({length:n},()=>new THREE.Vector4());
/** Shared uniform objects: every patched material references these, so one write per frame updates all. */
export const WATER_DETAIL={
 /** x, z, smoothed velocity x, z (m/s). */
 uSwim:{value:v4(SWIMMERS)},
 /** water level (m), phase seed (s), strength (0 = slot empty), body size (1 = adult). */
 uSwimMeta:{value:v4(SWIMMERS)},
 uSwimTime:{value:0},
 /** min x, min z, max x, max z of a flat water surface. */
 uWaterRect:{value:v4(REGIONS)},
 /** level (m), strength (0 = slot empty), 0, 0. */
 uWaterLevel:{value:v4(REGIONS)},
 /** Water colour bodies fade toward (linear), already scaled by daylight. */
 uWaterTint:{value:new THREE.Color('#1d5674')},
 /** 0 night .. 1 day: glitter and crest highlights scale with it. */
 uWaterDay:{value:1},
};
const TINT_DAY=new THREE.Color('#1d5674'),TINT_NIGHT=new THREE.Color('#061420');

/** GLSL: uniforms plus `vec3 waterSwim(vec3 w)` -> (slope x, slope z, crest) at a world point on a water surface,
 * and `float waterGlitter(vec3 w,vec3 n,vec3 eye,float t)` sun glitter. */
export const WATER_DETAIL_GLSL=/* glsl */`
uniform vec4 uSwim[${SWIMMERS}];uniform vec4 uSwimMeta[${SWIMMERS}];uniform float uSwimTime;uniform float uWaterDay;
vec3 waterSwim(vec3 w){
 vec3 acc=vec3(0.);
 for(int i=0;i<${SWIMMERS};i++){
  vec4 m=uSwimMeta[i];if(m.z<=0.)continue;
  vec4 s=uSwim[i];vec2 d=w.xz-s.xy;float r=length(d);
  if(r>7.5||abs(w.y-m.x)>.7)continue;
  vec2 dir=d/max(r,1e-3);float t=uSwimTime+m.y,sp=length(s.zw),size=m.w;
  // three rings alive at once, each expanding for 2.4 s; a treading swimmer's rings are stronger
  float ring=0.;
  for(int k=0;k<3;k++){float age=fract(t/2.4+float(k)/3.)*2.4,R=.3*size+age*1.15,env=1.-age/2.4;float x=(r-R)/(.16+.05*age);ring+=-x*exp(-x*x)*env*env;}
  float calm=1.-.55*smoothstep(.15,.8,sp);
  acc.xy+=dir*ring*.16*calm*m.z;acc.z+=max(ring,0.)*.5*calm*m.z;
  // wake: two arms of a short V behind a travelling swimmer, broken into moving wavelets
  if(sp>.12){vec2 u=s.zw/sp,p=vec2(-u.y,u.x);float a=-dot(d,u),b=dot(d,p);
   if(a>-.4&&a<5.5){float arm=abs(b)-.36*max(a,0.)-.25*size,x=arm/(.14+.04*max(a,0.));float fade=smoothstep(-.4,.3,a)*(1.-smoothstep(2.5,5.5,a))*smoothstep(.12,.6,sp);
    float broken=.55+.45*sin(a*7.-t*6.3+b*2.);float g=-x*exp(-x*x)*fade*broken;
    acc.xy+=p*sign(b)*g*.13*m.z;acc.z+=max(-g,0.)*.45*m.z;}}
 }
 return acc;
}
float waterHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
/** Twinkling glitter: sparse cells catch the light for a moment; view-angle weighted, fades before aliasing. */
float waterGlitter(vec3 w,vec3 n,vec3 eye,float t){
 vec2 c=floor(w.xz*5.),f=fract(w.xz*5.)-.5;float h=waterHash(c);
 float blink=pow(max(0.,sin(t*(1.7+h*2.3)+h*31.)),24.);
 vec2 o=f+vec2(h-.5,fract(h*7.)-.5)*.5;float spot=smoothstep(.09,.0,length(o*vec2(1.,2.2)));
 float graze=.35+.65*pow(clamp(1.-abs(dot(n,eye)),0.,1.),1.5);
 float far=1.-smoothstep(28.,70.,length(cameraPosition-w));
 return blink*spot*graze*far*step(.7,h);
}
`;

/** GLSL for body materials: `float waterDepthAt(vec3 w)` and the fade applied to gl_FragColor. */
const BODY_HEAD=/* glsl */`
uniform vec4 uWaterRect[${REGIONS}];uniform vec4 uWaterLevel[${REGIONS}];uniform vec3 uWaterTint;varying vec3 vWaterBodyW;
// overlapping boxes: the smallest box containing the point is the most specific water there
float waterDepthAt(vec3 w){float d=0.,area=1e12;
 for(int i=0;i<${REGIONS};i++){vec4 r=uWaterRect[i];vec4 l=uWaterLevel[i];if(l.y<=0.)continue;
  float a=(r.z-r.x)*(r.w-r.y);if(w.x>=r.x&&w.x<=r.z&&w.z>=r.y&&w.z<=r.w&&a<area){area=a;d=l.x-w.y;}}
 return d;}
`;
const BODY_FADE=/* glsl */`
{float edenDep=waterDepthAt(vWaterBodyW);
 if(edenDep>0.){
  // near the surface skin and clothes keep their detail; deeper they flatten and take the water's colour
  float f=1.-exp(-edenDep*1.35);float near=smoothstep(0.,.12,edenDep);
  vec3 c=gl_FragColor.rgb;float l=dot(c,vec3(.2126,.7152,.0722));
  c=mix(c,vec3(l)*vec3(.82,.95,1.05),near*(.25+.45*f));
  gl_FragColor.rgb=mix(c,uWaterTint,near*f*.85);
 }}
`;
const BODY_KEY='w11-underwater-v1';

/** Patch one body material so its fragments below a water surface fade gradually. Idempotent per material. */
const patched=new WeakSet<THREE.Material>();
export function patchUnderwaterBody(m:THREE.Material):boolean{
 if(patched.has(m))return false;
 const any=m as THREE.Material&{isMeshStandardMaterial?:boolean;isMeshPhysicalMaterial?:boolean;isMeshLambertMaterial?:boolean;isMeshPhongMaterial?:boolean;isMeshToonMaterial?:boolean;isMeshBasicMaterial?:boolean};
 if(!(any.isMeshStandardMaterial||any.isMeshLambertMaterial||any.isMeshPhongMaterial||any.isMeshToonMaterial||any.isMeshBasicMaterial))return false;
 patched.add(m);
 const previous=m.onBeforeCompile,previousKey=m.customProgramCacheKey;
 m.onBeforeCompile=function(shader,renderer){
  previous.call(this,shader,renderer);
  if(!shader.vertexShader.includes('#include <project_vertex>')||!shader.fragmentShader.includes('#include <tonemapping_fragment>'))return;
  shader.uniforms.uWaterRect=WATER_DETAIL.uWaterRect;shader.uniforms.uWaterLevel=WATER_DETAIL.uWaterLevel;shader.uniforms.uWaterTint=WATER_DETAIL.uWaterTint;
  shader.vertexShader='varying vec3 vWaterBodyW;\n'+shader.vertexShader.replace('#include <project_vertex>',`#include <project_vertex>
{vec4 edenWp=vec4(transformed,1.0);
#ifdef USE_BATCHING
edenWp=batchingMatrix*edenWp;
#endif
#ifdef USE_INSTANCING
edenWp=instanceMatrix*edenWp;
#endif
vWaterBodyW=(modelMatrix*edenWp).xyz;}`);
  shader.fragmentShader=BODY_HEAD+shader.fragmentShader.replace('#include <tonemapping_fragment>',BODY_FADE+'#include <tonemapping_fragment>');
 };
 m.customProgramCacheKey=function(){return previousKey.call(this)+'|'+BODY_KEY;};
 m.needsUpdate=true;return true;
}

const SURFACE_KEY='w11-surface-v1';
const surfaces=new WeakSet<THREE.Material>();
const SURFACE_VERTEX=`#include <project_vertex>
{vec4 edenWp=vec4(transformed,1.0);
#ifdef USE_INSTANCING
edenWp=instanceMatrix*edenWp;
#endif
vWaterSurfW=(modelMatrix*edenWp).xyz;}`;
/** Add swimmer ripples, crest highlights and glitter to a drawn water surface. Two shader families exist:
 * the old scenes' captured calm-water ShaderMaterial and the standard-material water of new worlds and the
 * Eden expansion (realism pass). Chained after any existing onBeforeCompile; idempotent per material. */
export function patchWaterSurface(m:THREE.Material):'captured'|'standard'|null{
 if(surfaces.has(m))return null;
 const shaderMat=(m as THREE.ShaderMaterial).isShaderMaterial,std=(m as THREE.MeshStandardMaterial).isMeshStandardMaterial;
 if(shaderMat){const sm=m as THREE.ShaderMaterial;if(!sm.fragmentShader.includes('vec3 normal=normalize(vec3(-slope.x,1.0,-slope.y));')||!sm.fragmentShader.includes('gl_FragColor=vec4(colour,')||!sm.vertexShader.includes('vWorld'))return null;}
 else if(!std)return null;
 surfaces.add(m);
 const previous=m.onBeforeCompile,previousKey=m.customProgramCacheKey;
 m.onBeforeCompile=function(shader,renderer){
  previous.call(this,shader,renderer);
  Object.assign(shader.uniforms,{uSwim:WATER_DETAIL.uSwim,uSwimMeta:WATER_DETAIL.uSwimMeta,uSwimTime:WATER_DETAIL.uSwimTime,uWaterDay:WATER_DETAIL.uWaterDay});
  if(shaderMat){
   shader.fragmentShader=WATER_DETAIL_GLSL+shader.fragmentShader
    .replace('vec3 normal=normalize(vec3(-slope.x,1.0,-slope.y));','vec3 edenSw=waterSwim(vWorld);slope+=edenSw.xy;vec3 normal=normalize(vec3(-slope.x,1.0,-slope.y));')
    .replace('gl_FragColor=vec4(colour,','colour=mix(colour,vec3(.62,.74,.8)*mix(.2,1.,uWaterDay),clamp(edenSw.z,0.,1.)*.35);colour+=vec3(.95,.92,.82)*waterGlitter(vWorld,normal,eye,uSwimTime)*.9*uWaterDay;\n  gl_FragColor=vec4(colour,');
  }else{
   if(!shader.vertexShader.includes('#include <project_vertex>')||!shader.fragmentShader.includes('#include <emissivemap_fragment>')||!shader.fragmentShader.includes('#include <tonemapping_fragment>'))return;
   shader.vertexShader='varying vec3 vWaterSurfW;\n'+shader.vertexShader.replace('#include <project_vertex>',SURFACE_VERTEX);
   shader.fragmentShader='varying vec3 vWaterSurfW;\n'+WATER_DETAIL_GLSL+shader.fragmentShader
    .replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\nvec3 edenSw=waterSwim(vWaterSurfW);normal=normalize(normal-(viewMatrix*vec4(edenSw.x,0.,edenSw.y,0.)).xyz);')
    .replace('#include <tonemapping_fragment>','gl_FragColor.rgb=mix(gl_FragColor.rgb,vec3(.62,.74,.8)*mix(.2,1.,uWaterDay),clamp(edenSw.z,0.,1.)*.3);gl_FragColor.rgb+=vec3(.95,.92,.82)*waterGlitter(vWaterSurfW,vec3(0.,1.,0.),normalize(cameraPosition-vWaterSurfW),uSwimTime)*.5*uWaterDay*uWaterDay;\n#include <tonemapping_fragment>');
  }
 };
 m.customProgramCacheKey=function(){return previousKey.call(this)+'|'+SURFACE_KEY;};
 m.needsUpdate=true;return shaderMat?'captured':'standard';
}

export type WaterRegion={minX:number;minZ:number;maxX:number;maxZ:number;level:number;mesh?:THREE.Mesh};
export type WaterSwimmer={id:string;root:THREE.Object3D|null;p:readonly [number,number,number];activity:string};
const SWIM=/swim|tread|wade|float|paddle/;
/** Water bodies drawn as flat surfaces: named water meshes whose world bounds are (nearly) level. */
const WATER_NAME=/water|lake surface|river surface|entity-sea|calmlake/i,NOT_WATER=/ bed\b|bed ;|riverreach bed|calmlake bed|fountain|basin|falls|waterfall|bank|shore appearance/i;
export function findWaterRegions(root:THREE.Object3D):WaterRegion[]{
 const out:WaterRegion[]=[],box=new THREE.Box3();
 root.traverseVisible(o=>{const mesh=o as THREE.Mesh;if(!mesh.isMesh||!mesh.geometry)return;
  const names=`${mesh.name} ${mesh.parent?.name??''}`;if(!WATER_NAME.test(names)||NOT_WATER.test(names))return;
  if(!mesh.geometry.boundingBox)mesh.geometry.computeBoundingBox();box.copy(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld);
  const sx=box.max.x-box.min.x,sz=box.max.z-box.min.z,sy=box.max.y-box.min.y;
  if(sy>.25||Math.max(sx,sz)<1.5||!Number.isFinite(sx+sz))return;  // sloped rivers and tiny basins are out of scope
  out.push({minX:box.min.x,minZ:box.min.z,maxX:box.max.x,maxZ:box.max.z,level:box.max.y,mesh});});
 return out;
}
const probe=new THREE.Raycaster(),down=new THREE.Vector3(0,-1,0),from=new THREE.Vector3();
/** Is this point in the water: below a drawn water surface that lies directly above it (recorded contact, never
 * invented). The box is a quick reject; where a region has its mesh, a short vertical ray confirms the surface is
 * really overhead (a lake's box can cover a lower pond or a dry bank). */
export function waterUnder(regions:readonly WaterRegion[],x:number,y:number,z:number):WaterRegion|null{
 let best:WaterRegion|null=null;
 for(const r of regions){if(!(x>=r.minX&&x<=r.maxX&&z>=r.minZ&&z<=r.maxZ&&y<r.level+.05&&y>r.level-3))continue;
  if(best&&(r.maxX-r.minX)*(r.maxZ-r.minZ)>=(best.maxX-best.minX)*(best.maxZ-best.minZ))continue;
  if(r.mesh){probe.set(from.set(x,r.level+.5,z),down);probe.near=0;probe.far=1;if(!probe.intersectObject(r.mesh,false).length)continue;}
  best=r;}
 return best;
}
/** Height to mark a point at (the selection ring): the water surface when the point is under drawn water, so the
 * ring of a swimmer whose root sits 1.2 m under the surface (a duck drawn at the waterline) lies on the water around
 * it, not on the lake bed below it; elsewhere the point itself. */
export function markHeight(regions:readonly WaterRegion[],x:number,y:number,z:number):number{const r=waterUnder(regions,x,y,z);return r?Math.max(y,r.level):y;}
const phase=(id:string)=>{let h=2166136261;for(let i=0;i<id.length;i++)h=Math.imul(h^id.charCodeAt(i),16777619);return ((h>>>0)%1000)/1000*2.4;};

/** Per-view driver. Call `update` once per frame before rendering. */
export class WorldWaterDetail{
 regions:WaterRegion[]=[];
 private scannedAt=-Infinity;
 private last=new Map<string,{x:number;z:number;t:number;vx:number;vz:number}>();
 private roots=new WeakSet<THREE.Object3D>();
 /** Diagnostics for proofs: active swimmers, regions, patched body materials. */
 stats={swimmers:0,regions:0,bodies:0,surfaces:0};
 private readonly reduced:()=>boolean;
 constructor(reduced:()=>boolean=()=>false){this.reduced=reduced;}
 /** Re-scan the drawn water surfaces at most every 3 s (scene changes are rare). */
 scan(scene:THREE.Object3D,now=performance.now()){
  if(now-this.scannedAt<3000)return;this.scannedAt=now;this.regions=findWaterRegions(scene);this.stats.regions=this.regions.length;
  for(const r of this.regions)if(r.mesh)for(const m of ([] as THREE.Material[]).concat(r.mesh.material)){
   // Eden expansion water gets its ripples from the realism pass first; wait for it rather than block it.
   if(realismClassOf(m)===null&&classifyRealism(m,[r.mesh.name,r.mesh.parent?.name??''])==='water')continue;
   if(patchWaterSurface(m))this.stats.surfaces++;}
 }
 /** `fallbackBody` finds a Soul's drawn body when it is not a rigged person (a floater, or the simple stand-in figure). */
 update(scene:THREE.Object3D,camera:THREE.Camera,souls:readonly WaterSwimmer[],seconds:number,daylight:number|null,now=performance.now(),fallbackBody?:(id:string)=>THREE.Object3D|null){
  this.scan(scene,now);
  const t=Number.isFinite(seconds)?((seconds%WRAP)+WRAP)%WRAP:0;WATER_DETAIL.uSwimTime.value=this.reduced()?0:t;
  const day=daylight===null||!Number.isFinite(daylight)?1:Math.max(0,Math.min(1,daylight));
  WATER_DETAIL.uWaterTint.value.copy(TINT_NIGHT).lerp(TINT_DAY,day);WATER_DETAIL.uWaterDay.value=day;
  const cx=camera.position.x,cz=camera.position.z;
  // swimmers: Souls whose recorded activity is swimming/treading/wading, or whose body stands below a water surface
  const wet:{s:WaterSwimmer;r:WaterRegion;d:number}[]=[];
  for(const s of souls){const r=waterUnder(this.regions,s.p[0],s.p[1],s.p[2]);
   const root=s.root??(r&&fallbackBody?fallbackBody(s.id):null);
   if(root&&!this.roots.has(root)&&r){this.roots.add(root);root.traverse(o=>{const mesh=o as THREE.Mesh;if(!mesh.isMesh)return;for(const m of ([] as THREE.Material[]).concat(mesh.material))if(patchUnderwaterBody(m))this.stats.bodies++;});}
   if(!r)continue;if(!SWIM.test(s.activity)&&s.p[1]>r.level-.25)continue;
   wet.push({s,r,d:Math.hypot(s.p[0]-cx,s.p[2]-cz)});}
  wet.sort((a,b)=>a.d-b.d);
  // The fade uses only the water each wet Soul is actually in (nearest first): a wider surface whose bounds happen
  // to cover a lower pond (an expansion lake's box around the commons pond) must never tint bodies in that pond.
  const used:WaterRegion[]=[];for(const w of wet)if(!used.includes(w.r)&&used.length<REGIONS)used.push(w.r);
  for(let i=0;i<REGIONS;i++){const r=used[i],rect=WATER_DETAIL.uWaterRect.value[i],lv=WATER_DETAIL.uWaterLevel.value[i];
   if(r){rect.set(r.minX,r.minZ,r.maxX,r.maxZ);lv.set(r.level,1,0,0);}else lv.set(0,0,0,0);}
  const seen=new Set<string>();let n=0;
  for(const w of wet){if(n>=SWIMMERS||w.d>140)break;const {s,r}=w;seen.add(s.id);
   const prev=this.last.get(s.id);let vx=0,vz=0;
   if(prev){const dt=seconds-prev.t;if(dt>1e-3&&dt<1.5){const k=Math.min(1,dt*3);vx=prev.vx+((s.p[0]-prev.x)/dt-prev.vx)*k;vz=prev.vz+((s.p[2]-prev.z)/dt-prev.vz)*k;}else if(dt>=0&&dt<=1e-3){vx=prev.vx;vz=prev.vz;}}
   if(!Number.isFinite(vx+vz)||Math.hypot(vx,vz)>4){vx=0;vz=0;}
   if(!prev||prev.t!==seconds)this.last.set(s.id,{x:s.p[0],z:s.p[2],t:seconds,vx,vz});
   WATER_DETAIL.uSwim.value[n].set(s.p[0],s.p[2],vx,vz);
   WATER_DETAIL.uSwimMeta.value[n].set(r.level,phase(s.id),SWIM.test(s.activity)?1:.6,1);n++;}
  for(let i=n;i<SWIMMERS;i++)WATER_DETAIL.uSwimMeta.value[i].z=0;
  for(const id of this.last.keys())if(!seen.has(id))this.last.delete(id);
  this.stats.swimmers=n;
 }
}
