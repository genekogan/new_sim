import * as THREE from 'three';
/** Soft contact ambient occlusion without a screen-space pass: a world-space map (same extent and ~0.36 m
 * texels as the night light map) darkens ambient light on the ground around every building footprint and on
 * the lowest metre or so of its walls, fading with height above the ground stored per texel (so hill villages
 * get it too and roofs never do). One texture fetch per lit pixel; painted once when the expansion is built.
 * Presentation only. Installed with the night lighting (it reuses that patch's world-position varying). */
const SIZE=[1536,1024] as const;
const BASE_MIN=-10,BASE_RANGE=100;
class SharedDataTexture extends THREE.DataTexture{override clone(){return this as this;}}
const AO={x:0,y:0,z:0,w:0};
let texture:SharedDataTexture|null=null;
/** Footprint: a closed polygon (world x/z) and an optional strength (default 1). */
export type OcclusionFootprint={corners:readonly (readonly [number,number])[];strength?:number};
type Bounds={x0:number;z0:number;x1:number;z1:number};
let BOUNDS:Bounds={x0:0,z0:0,x1:1,z1:1};
/** Called by installNightLighting (same bounds; needs its world-position varying). */
export function installGroundOcclusion(bounds:Bounds){
 if(texture)return;BOUNDS={...bounds};
 const data=new Uint8Array(SIZE[0]*SIZE[1]*4);texture=new SharedDataTexture(data,SIZE[0],SIZE[1],THREE.RGBAFormat);
 texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.generateMipmaps=true;texture.wrapS=texture.wrapT=THREE.ClampToEdgeWrapping;texture.needsUpdate=true;
 const {x0,z0,x1,z1}=BOUNDS,f=(n:number)=>n.toFixed(4);
 THREE.ShaderChunk.lights_pars_begin+='\nuniform sampler2D uEdenAoMap;\nuniform vec4 uEdenAo;\n';
 THREE.ShaderChunk.lights_fragment_end+=`
if(uEdenAo.x>0.0){
 vec2 edenAoUv=(vEdenNightWorld.xz-vec2(${f(x0)},${f(z0)}))/vec2(${f(x1-x0)},${f(z1-z0)});
 if(edenAoUv.x>0.0&&edenAoUv.x<1.0&&edenAoUv.y>0.0&&edenAoUv.y<1.0){
  vec4 edenAo=texture2D(uEdenAoMap,edenAoUv);
  float edenAoH=vEdenNightWorld.y-(${f(BASE_MIN)}+edenAo.g*${f(BASE_RANGE)});
  float edenAoK=edenAo.r*uEdenAo.x*(1.0-smoothstep(.0,1.6,edenAoH))*step(-.8,edenAoH);
  reflectedLight.indirectDiffuse*=1.0-edenAoK;reflectedLight.directDiffuse*=1.0-.22*edenAoK;
 }
}
`;
 for(const name of ['lambert','phong','standard','physical','toon'] as const){const lib=THREE.ShaderLib[name];if(!lib)continue;lib.uniforms.uEdenAoMap={value:texture};lib.uniforms.uEdenAo={value:AO};}
}
/** 0 switches the occlusion off (e.g. a review toggle); default strength after painting is .55. */
export function setGroundOcclusionStrength(k:number){AO.x=Math.max(0,Math.min(1,k));}
const segDist=(px:number,pz:number,ax:number,az:number,bx:number,bz:number)=>{const dx=bx-ax,dz=bz-az,l=dx*dx+dz*dz,t=l>0?Math.max(0,Math.min(1,((px-ax)*dx+(pz-az)*dz)/l)):0,ex=ax+t*dx-px,ez=az+t*dz-pz;return Math.sqrt(ex*ex+ez*ez);};
const inside=(px:number,pz:number,c:readonly (readonly [number,number])[])=>{let s=false;for(let i=0,j=c.length-1;i<c.length;j=i++){const [xi,zi]=c[i],[xj,zj]=c[j];if((zi>pz)!==(zj>pz)&&px<(xj-xi)*(pz-zi)/(zj-zi)+xi)s=!s;}return s;};
/** Paint footprints (max-blended): outside the walls exp(-d/0.85), inside a faint band along the walls. */
export function paintGroundOcclusion(footprints:readonly OcclusionFootprint[],ground:(x:number,z:number)=>number|null){
 if(!texture)return 0;const data=texture.image.data as Uint8Array,[w,h]=SIZE,{x0,z0,x1,z1}=BOUNDS,sx=(x1-x0)/w,sz=(z1-z0)/h,REACH=2.6;
 data.fill(0);let painted=0;
 for(const fp of footprints){const c=fp.corners;if(c.length<3)continue;const s=Math.max(0,Math.min(1,fp.strength??1));
  let bx0=Infinity,bz0=Infinity,bx1=-Infinity,bz1=-Infinity;for(const [x,z] of c){bx0=Math.min(bx0,x);bx1=Math.max(bx1,x);bz0=Math.min(bz0,z);bz1=Math.max(bz1,z);}
  if(bx1<x0||bx0>x1||bz1<z0||bz0>z1||bx1-bx0>80||bz1-bz0>80)continue;painted++;
  // Buildings sit on level pads: one ground sample at the footprint centre serves its whole ring.
  const g=ground((bx0+bx1)/2,(bz0+bz1)/2),gy=Math.round(255*Math.max(0,Math.min(1,((g!==null&&Number.isFinite(g)?g:0)-BASE_MIN)/BASE_RANGE)));
  const i0=Math.max(0,Math.floor((bx0-REACH-x0)/sx)),i1=Math.min(w-1,Math.ceil((bx1+REACH-x0)/sx)),j0=Math.max(0,Math.floor((bz0-REACH-z0)/sz)),j1=Math.min(h-1,Math.ceil((bz1+REACH-z0)/sz));
  for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){const px=x0+(i+.5)*sx,pz=z0+(j+.5)*sz;let d=Infinity;
   for(let a=0,b=c.length-1;a<c.length;b=a++)d=Math.min(d,segDist(px,pz,c[b][0],c[b][1],c[a][0],c[a][1]));
   const v=s*(inside(px,pz,c)?.45*Math.exp(-d/.45):Math.exp(-d/.85));if(v<.02)continue;
   const k=(j*w+i)*4,val=Math.round(255*Math.min(1,v));if(val<=data[k])continue;data[k]=val;data[k+1]=gy;}}
 texture.needsUpdate=true;AO.x=.55;return painted;
}
