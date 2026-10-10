import * as THREE from 'three';
import {installGroundOcclusion} from './WorldGroundOcclusion.ts';
/** Night lighting as a world-space light map, not as many real point lights.
 *
 * Every lit built-in material (lambert/phong/standard/physical/toon) samples
 * one shared texture of warm light pools painted from static sources (lamps,
 * fire, windows, paths). Cost is one texture lookup per pixel regardless of
 * how many lamps exist; overlapping halos add up into soft ambient light where
 * lights cluster. Strength follows the sun, so it fades in at dusk. Pure
 * presentation: no simulation, perception or physical light authority.
 *
 * The map covers the inhabited rectangle and every Region district. Scenery
 * modules publish their lights as `userData.edenLightSources` ([x, groundY, z,
 * kind, scale]); the expansion collects them once (collectNightSources) and
 * repaints the map (paintNightSources). The alpha channel stores the ground
 * height under the light so pools hug sloping ground (hill villages) too. */
export type NightSource={x:number;z:number;radius:number;intensity:number;color:string;halo?:number;
 /** Ground height under the source (metres, default 0). */
 base?:number};
export const NIGHT_MAP_BOUNDS=Object.freeze({x0:-240,z0:-210,x1:320,z1:190});
/** Ground heights the alpha channel can carry (metres). */
const BASE_MIN=-10,BASE_RANGE=100;
const WARM='#ffc27a',FIRE='#ff9448',WINDOW='#ffd79a',PATH='#ffcf8a',COOL='#cfe3ff';
const lamp=(x:number,z:number):NightSource=>({x,z,radius:3.4,intensity:1.35,color:WARM,halo:10});
/** Light kinds published by scenery modules. Lamps match the residential cluster (the reference look). */
export type NightKind='lamp'|'park-lamp'|'lantern'|'window'|'fire'|'string'|'mural-uplight';
export function nightSource(x:number,base:number,z:number,kind:string,scale=1):NightSource|null{
 if(![x,base,z,scale].every(Number.isFinite))return null;const k=Math.max(.3,Math.min(2,scale));
 switch(kind as NightKind){
  case 'lamp':return {x,z,base,radius:3.4*k,intensity:1.35,color:WARM,halo:10*k};
  // Park walks: smaller, softer pools so the parkland stays night with islands of light.
  case 'park-lamp':return {x,z,base,radius:2.8*k,intensity:.95,color:WARM,halo:5*k};
  case 'lantern':return {x,z,base,radius:2.2*k,intensity:.75,color:WARM,halo:5*k};
  case 'window':return {x,z,base,radius:4*k,intensity:.2,color:WINDOW,halo:7*k};
  case 'fire':return {x,z,base,radius:4.5*k,intensity:1.3,color:FIRE,halo:13*k};
  case 'string':return {x,z,base,radius:4*k,intensity:.7,color:'#ffe0a8',halo:9*k};
  case 'mural-uplight':return {x,z,base,radius:1.8*k,intensity:1.2,color:WINDOW,halo:5*k};
  default:return null;
 }
}
/** Static sources in the installed Eden layout (world metres). */
export const EDEN_NIGHT_SOURCES:readonly NightSource[]=Object.freeze([
 // Street lamps beside the residential routes (eden-street-details.ts).
 ...[[32,3.25],[50,3.25],[63.75,9],[60.25,18],[40,25.75],[31,22.25],[63.75,28],[58,36.25],[49,39.75],[40,36.25],[31,39.75]].map(([x,z])=>lamp(x,z)),
 // Commons campfire (native fixture social-eden-fire).
 {x:24,z:-7,radius:5.5,intensity:1.6,color:FIRE,halo:16},
 // Lit windows: houses, library, office, market, barn, classroom.
 ...[[34,15,4.5],[52,15,4.5],[34,30,6],[54,30,5],[74,-7,6],[92,15,6.5],[70,29,4],[88,51,6],[42,-8,7]].map(([x,z,r])=>({x,z,radius:r*.8,intensity:.28,color:WINDOW,halo:r*1.6})),
 // New quarters: dome, pergola court string lights, bandstand, kiosks, tea house,
 // amphitheatre stage, greenhouse, windmill/observatory doors, artist row windows.
 {x:99.2,z:36.5,radius:5,intensity:.85,color:WARM,halo:12},
 {x:99.5,z:48.25,radius:5.5,intensity:.8,color:'#ffe0a8',halo:12},
 {x:38.5,z:-26,radius:4,intensity:.9,color:WARM,halo:11},
 {x:57.5,z:-26.5,radius:4.5,intensity:.85,color:WARM,halo:11},
 {x:92.5,z:4.5,radius:4,intensity:.8,color:WARM,halo:10},
 {x:76,z:80.6,radius:4.5,intensity:.8,color:WARM,halo:11},
 {x:69,z:35,radius:5,intensity:.45,color:COOL,halo:10},
 {x:88,z:30,radius:2.5,intensity:.6,color:WINDOW,halo:6},
 {x:36.5,z:80,radius:2.5,intensity:.6,color:WINDOW,halo:6},
 ...[[76.5,-25.5],[67.5,-18.5],[69,20]].map(([x,z])=>({x,z,radius:3,intensity:.5,color:WINDOW,halo:7})),
 // Furnished new buildings (eden-interiors): café, music and games rooms, bakery, chapel, clinic, bathhouse, potting shed.
 ...[[101.5,25],[101,59],[86.5,-20],[77.5,-15.5],[87,82],[64.5,-8.5],[83.5,-11],[44,83]].map(([x,z])=>({x,z,radius:3,intensity:.4,color:WINDOW,halo:7})),
 // Garden fire circle (activity cluster eden-party-fire-place).
 {x:47,z:64,radius:3.5,intensity:.9,color:FIRE,halo:10},
]);
/** Walking paths get a low continuous glow (as from path bollards). */
export const EDEN_NIGHT_PATHS:readonly (readonly [number,number])[][]=Object.freeze([
 [[18,5],[28,5],[36,4],[42,2]],
 [[28,5],[62,5],[62,24],[28,24]],[[62,24],[62,38],[28,38]],
 [[42,20],[48,40],[75,50]],
 [[9,-12],[9,-28],[9,-40]],
]);
const SIZE=[1536,1024] as const;
/** A DataTexture that uniform cloning shares rather than copies, so one repaint reaches every compiled material. */
class SharedDataTexture extends THREE.DataTexture{override clone(){return this as this;}}
/** Paint sources into a float RGB map, then soft-saturate so clusters glow
 * brighter without blowing out (diffuse pooling rather than spotlights). Alpha
 * carries the light-weighted ground height under the pools. */
function paintInto(data:Uint8Array,sources:readonly NightSource[],paths:readonly (readonly [number,number])[][]){
 const [w,h]=SIZE,{x0,z0,x1,z1}=NIGHT_MAP_BOUNDS,sx=(x1-x0)/w,sz=(z1-z0)/h,acc=new Float32Array(w*h*4),wsum=new Float32Array(w*h),c=new THREE.Color();
 const splat=(x:number,z:number,radius:number,intensity:number,color:string,halo:number,base:number)=>{
  c.set(color);const reach=Math.max(radius,halo)*2.2,i0=Math.max(0,Math.floor((x-reach-x0)/sx)),i1=Math.min(w-1,Math.ceil((x+reach-x0)/sx)),j0=Math.max(0,Math.floor((z-reach-z0)/sz)),j1=Math.min(h-1,Math.ceil((z+reach-z0)/sz));
  const r2=radius*radius,h2=halo*halo;
  for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){const dx=x0+(i+.5)*sx-x,dz=z0+(j+.5)*sz-z,d2=dx*dx+dz*dz;
   const v=intensity*(Math.exp(-d2/r2)+.18*Math.exp(-d2/h2));if(v<1e-4)continue;const k=(j*w+i)*4;acc[k]+=v*c.r;acc[k+1]+=v*c.g;acc[k+2]+=v*c.b;acc[k+3]+=v*base;wsum[k>>2]+=v;}
 };
 for(const s of sources)splat(s.x,s.z,s.radius,s.intensity,s.color,s.halo??s.radius*2.5,s.base??0);
 for(const p of paths)for(let i=1;i<p.length;i++){const [a,b]=[p[i-1],p[i]],len=Math.hypot(b[0]-a[0],b[1]-a[1]);for(let t=0;t<=len;t+=1.5)splat(a[0]+(b[0]-a[0])*t/len,a[1]+(b[1]-a[1])*t/len,1.3,.07,PATH,3,0);}
 for(let k=0;k<acc.length;k+=4){const wt=wsum[k>>2];
  for(let ch=0;ch<3;ch++){const v=acc[k+ch];data[k+ch]=Math.round(255*Math.min(1,1.25*v/(1+v)));}
  // Light-weighted mean ground height (0 where there is no light).
  const base=wt>1e-4?acc[k+3]/wt:0;data[k+3]=Math.round(255*Math.min(1,Math.max(0,(base-BASE_MIN)/BASE_RANGE)));}
}
export function paintNightMap(sources:readonly NightSource[],paths:readonly (readonly [number,number])[][]){
 const [w,h]=SIZE,data=new Uint8Array(w*h*4);if(sources.length||paths.length)paintInto(data,sources,paths);
 const texture=new SharedDataTexture(data,w,h,THREE.RGBAFormat);texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.generateMipmaps=true;texture.wrapS=texture.wrapT=THREE.ClampToEdgeWrapping;texture.needsUpdate=true;
 return texture;
}
// Shared uniform objects: plain {x,y,z,w} so three's per-material uniform
// cloning keeps the reference, and one assignment updates every material.
const NIGHT_PARAMS={x:0,y:0,z:0,w:0};
/** Lit windows (eden-window-interiors): x fraction of rooms lit now, y time (s) for the slow silhouettes. */
const WINDOW_PARAMS={x:.75,y:0,z:0,w:0};
let installed=false,installedTexture:THREE.DataTexture|null=null;
/** Patch three's shared shader chunks once, before any lit program compiles. The map starts dark; the Eden expansion
 * paints it once when it is built (paintNightSources), since the lights only show there. */
export function installNightLighting(texture=paintNightMap([],[])){
 if(installed)return;installed=true;installedTexture=texture;
 const {x0,z0,x1,z1}=NIGHT_MAP_BOUNDS,f=(n:number)=>n.toFixed(4);
 THREE.ShaderChunk.common+='\nvarying vec3 vEdenNightWorld;\n';
 THREE.ShaderChunk.project_vertex+=`
vec4 edenNightWorld=vec4(transformed,1.0);
#ifdef USE_BATCHING
edenNightWorld=batchingMatrix*edenNightWorld;
#endif
#ifdef USE_INSTANCING
edenNightWorld=instanceMatrix*edenNightWorld;
#endif
vEdenNightWorld=(modelMatrix*edenNightWorld).xyz;
`;
 THREE.ShaderChunk.lights_pars_begin+='\nuniform sampler2D uEdenNightMap;\nuniform vec4 uEdenNight;\n';
 THREE.ShaderChunk.lights_fragment_end+=`
if(uEdenNight.x>0.0){
 vec2 edenUv=(vEdenNightWorld.xz-vec2(${f(x0)},${f(z0)}))/vec2(${f(x1-x0)},${f(z1-z0)});
 if(edenUv.x>0.0&&edenUv.x<1.0&&edenUv.y>0.0&&edenUv.y<1.0){
  vec4 edenLight=texture2D(uEdenNightMap,edenUv);
  // Light pools hug the ground under them (alpha = ground height): roofs and tree tops receive less.
  float edenHeight=clamp(1.0-max(0.0,vEdenNightWorld.y-(${f(BASE_MIN)}+edenLight.a*${f(BASE_RANGE)})-1.0)/7.0,0.2,1.0);
  reflectedLight.indirectDiffuse+=diffuseColor.rgb*edenLight.rgb*(uEdenNight.x*edenHeight);
 }
}
`;
 for(const name of ['lambert','phong','standard','physical','toon'] as const){const lib=THREE.ShaderLib[name];if(!lib)continue;lib.uniforms.uEdenNightMap={value:texture};lib.uniforms.uEdenNight={value:NIGHT_PARAMS};lib.uniforms.uEdenWindows={value:WINDOW_PARAMS};}
 // Contact ambient occlusion shares this patch's world-position varying and map extent.
 installGroundOcclusion(NIGHT_MAP_BOUNDS);
}
/** 0 by day, rising through dusk to full at night. */
export function setNightLightStrength(daylight:number|null){
 const d=daylight===null||!Number.isFinite(daylight)?1:Math.max(0,Math.min(1,daylight));
 NIGHT_PARAMS.x=1.0*Math.pow(1-d,1.5);
}
export function nightLightStrength(){return NIGHT_PARAMS.x;}
/** Fraction of rooms with a light on by hour (local): people come home at dusk, the evening is busy, the late
 * night has only a few lights, early risers before dawn. Each room keeps its own threshold, so lights go out
 * one by one rather than all at once. */
export function windowsLitAt(hour:number){
 const h=((hour%24)+24)%24,k=[[0,.32],[1,.16],[4.5,.12],[6,.34],[8,.3],[16.5,.4],[18.5,.72],[22,.7],[23.5,.42],[24,.32]];
 for(let i=1;i<k.length;i++)if(h<=k[i][0]){const [a,va]=k[i-1],[b,vb]=k[i],t=(h-a)/(b-a);return va+(vb-va)*t*t*(3-2*t);}
 return .32;
}
export function setWindowLife(hour:number|null,seconds:number){WINDOW_PARAMS.x=hour===null?.6:windowsLitAt(hour);WINDOW_PARAMS.y=seconds%3600;}
/** Light sources published under root as userData.edenLightSources ([x, groundY, z, kind, scale]). */
export function collectNightSources(root:THREE.Object3D):NightSource[]{
 const out:NightSource[]=[],v=new THREE.Vector3();root.updateWorldMatrix(true,true);
 root.traverse(o=>{const list=o.userData?.edenLightSources;if(!Array.isArray(list))return;
  for(const a of list){if(!Array.isArray(a)||a.length<3)continue;v.set(+a[0],+a[1],+a[2]).applyMatrix4(o.matrixWorld);const s=nightSource(v.x,v.y,v.z,String(a[3]??'lamp'),a[4]===undefined?1:+a[4]);if(s)out.push(s);}});
 return out;
}
/** Repaint the installed map with the static sources plus these (sources within 1 m of a static one are dropped). */
export function paintNightSources(extra:readonly NightSource[]){
 const sources=[...EDEN_NIGHT_SOURCES];
 for(const s of extra)if(!EDEN_NIGHT_SOURCES.some(o=>Math.hypot(o.x-s.x,o.z-s.z)<1&&o.color===s.color))sources.push(s);
 if(installedTexture){paintInto(installedTexture.image.data as Uint8Array,sources,EDEN_NIGHT_PATHS);installedTexture.needsUpdate=true;}
 return sources.length;
}
