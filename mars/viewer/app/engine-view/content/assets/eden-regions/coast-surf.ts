import * as THREE from 'three';
/** The sea's life along the coast (presentation only): a shore map baked once from the terrain (water depth
 * within 4 m of the surface, and how high the land rises right behind the waterline: cliffs) drives, in the
 * Regions water material, (1) a long ocean swell rolling toward the land as moving normals, (2) lines of surf
 * that travel in over the shallows and wash up the beaches, (3) white foam and spray where swell meets cliffs
 * and sea stacks, (4) a lighter, greener shallow-water tint. Only the sea surface (bay level, inside the map)
 * is touched: lakes, canals and ponds keep their look. Time comes from the shared SURF uniform (the viewer's
 * atmosphere writes it; 0 = still). */
export const SHORE_BOUNDS={x0:-900,z0:84,x1:900,z1:324} as const;
const STEP=2.5,W=Math.round((SHORE_BOUNDS.x1-SHORE_BOUNDS.x0)/STEP),H=Math.round((SHORE_BOUNDS.z1-SHORE_BOUNDS.z0)/STEP);
export const SURF={value:{x:0,y:0,z:0,w:0}}; // x time (s), y strength (0 = off)
export const SHORE_MAP={value:null as THREE.Texture|null};
/** Bake the shore map: R depth below `sea` (0..4 m → 0..1), G land height within ~6 m inland (0..20 m → 0..1, cliffs). */
export function bakeShore(height:(x:number,z:number)=>number,sea:number){
 const hgt=new Float32Array(W*H);
 for(let j=0;j<H;j++)for(let i=0;i<W;i++)hgt[j*W+i]=height(SHORE_BOUNDS.x0+(i+.5)*STEP,SHORE_BOUNDS.z0+(j+.5)*STEP);
 const data=new Uint8Array(W*H*4),R=3;
 for(let j=0;j<H;j++)for(let i=0;i<W;i++){const k=j*W+i,h=hgt[k],depth=Math.max(0,Math.min(4,sea-h));
  let land=0;if(depth<4)for(let dj=-R;dj<=R;dj++)for(let di=-R;di<=R;di++){const a=i+di,b=j+dj;if(a<0||b<0||a>=W||b>=H)continue;land=Math.max(land,hgt[b*W+a]-sea);}
  data[k*4]=Math.round(255*depth/4);data[k*4+1]=Math.round(255*Math.max(0,Math.min(1,land/20)));data[k*4+2]=0;data[k*4+3]=255;}
 const t=new THREE.DataTexture(data,W,H,THREE.RGBAFormat);t.magFilter=THREE.LinearFilter;t.minFilter=THREE.LinearFilter;t.wrapS=t.wrapT=THREE.ClampToEdgeWrapping;t.needsUpdate=true;
 SHORE_MAP.value?.dispose();SHORE_MAP.value=t;return t;
}
const f=(n:number)=>n.toFixed(3);
const HEAD=/* glsl */`
uniform vec4 uEdenSurf;uniform sampler2D uEdenShore;varying vec3 vEdenSeaW;
float edenSh(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float edenSn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(edenSh(i),edenSh(i+vec2(1,0)),f.x),mix(edenSh(i+vec2(0,1)),edenSh(i+vec2(1,1)),f.x),f.y);}
`;
export function seaSurfPatch(sea:number){
 return (sh:{vertexShader:string;fragmentShader:string;uniforms:Record<string,THREE.IUniform>})=>{
  sh.uniforms.uEdenSurf=SURF;sh.uniforms.uEdenShore=SHORE_MAP;
  sh.vertexShader=sh.vertexShader.replace('void main() {','varying vec3 vEdenSeaW;\nvoid main() {').replace('#include <project_vertex>','#include <project_vertex>\nvEdenSeaW=(modelMatrix*vec4(transformed,1.0)).xyz;');
  sh.fragmentShader=HEAD+sh.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
float edenFoam=0.0,edenShallow=0.0;
vec2 edenSuv=(vEdenSeaW.xz-vec2(${f(SHORE_BOUNDS.x0)},${f(SHORE_BOUNDS.z0)}))/vec2(${f(SHORE_BOUNDS.x1-SHORE_BOUNDS.x0)},${f(SHORE_BOUNDS.z1-SHORE_BOUNDS.z0)});
if(uEdenSurf.y>0.0&&abs(vEdenSeaW.y-(${f(sea)}))<.06&&edenSuv.x>0.0&&edenSuv.x<1.0&&edenSuv.y>0.0&&edenSuv.y<1.0){
 vec4 edenS=texture2D(uEdenShore,edenSuv);float d=edenS.r*4.0,cliff=edenS.g;float t=uEdenSurf.x;vec2 p=vEdenSeaW.xz;
 // swell: two long trains rolling in from the open sea (toward -z), plus a cross-chop
 float a1=dot(p,vec2(.05,.34))+t*.9,a2=dot(p,vec2(-.11,.52))+t*1.25,a3=dot(p,vec2(.61,.23))-t*1.7;
 vec2 g=vec2(.05,.34)*cos(a1)*.9+vec2(-.11,.52)*cos(a2)*.45+vec2(.61,.23)*cos(a3)*.12;
 vec3 n=normalize(vec3(-g.x*.35,1.0,-g.y*.35));normal=normalize(mix(normal,normalize((viewMatrix*vec4(n,0.0)).xyz),.8*uEdenSurf.y));
 // surf lines travelling in over the shallows, broken up; wash on the beach; foam and spray against cliffs
 float brk=edenSn(p*.35+vec2(t*.05,0.0))*.6+edenSn(p*1.3-t*.1)*.4;
 float wave=fract(d*.55+t*.11+brk*.25);
 float line=smoothstep(.0,.06,wave)*(1.0-smoothstep(.1,.32,wave));
 edenFoam=line*(1.0-smoothstep(.15,2.6,d))*(.45+.55*brk);
 edenFoam+=(1.0-smoothstep(.0,.3,d))*(.55+.45*sin(t*.8+brk*6.0))*.75;
 edenFoam+=cliff*(1.0-smoothstep(.0,2.2,d))*(.55+.45*sin(t*1.3+p.x*.21+brk*4.0))*smoothstep(.15,.5,brk+.2);
 edenFoam=clamp(edenFoam*uEdenSurf.y,0.0,1.0);edenShallow=(1.0-smoothstep(.2,3.5,d))*uEdenSurf.y;
}`).replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\ndiffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(.9,1.12,1.02)+vec3(.02,.05,.04),edenShallow*.6);diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.93,.96,.95),edenFoam*.9);diffuseColor.a=max(diffuseColor.a,edenFoam);');
 };
}
/** Rock pools at the waterline of the harbour beach and in the coves of the outer coast: a ring of weathered
 * stones holding still, clear water with weed and a starfish or two. Positions are found on the terrain (the
 * first point of each x where the ground rises out of the sea), seeded, so they always sit at the tide line. */
export function tidePools(b:import('./kit.ts').Builder,height:(x:number,z:number)=>number,sea:number){
 const hash=(i:number,s:number)=>{let h=Math.imul(i,374761393)+Math.imul(s,668265263);h=Math.imul(h^(h>>>13),1274126177);return((h^(h>>>16))>>>0)/4294967296;};
 let n=0;
 for(const x of [-94,-86,-77,-66,-58,-49,-430,-415,-640,365,382,520,705]){
  let z=SHORE_BOUNDS.z1;for(let zz=SHORE_BOUNDS.z1;zz>SHORE_BOUNDS.z0;zz-=.5){if(height(x,zz)>sea+.05){z=zz;break;}}
  if(z>=SHORE_BOUNDS.z1-1)continue;const cz=z+.6,y=height(x,cz),r=.8+hash(n,1)*.7;if(!Number.isFinite(y)||y>sea+.6)continue;
  const seg=9;for(let k=0;k<seg;k++){const a=k/seg*Math.PI*2+hash(n,k)*.3,rr=r*(1+.15*(hash(n,k+20)-.5)),sx=.35+hash(n,k+40)*.35;
   b.box('stone',x+Math.cos(a)*rr,y-.1,cz+Math.sin(a)*rr,sx,.28+hash(n,k+60)*.25,.3+hash(n,k+80)*.3,hash(n,k+100)<.5?'#7c766c':'#6d675e');}
  b.disc('water',x,y+.06,cz,r*.92,10,'#5f8f94');
  b.disc('soil',x,y+.02,cz,r*.9,10,'#5d6b5a');
  for(let k=0;k<5;k++){const a=hash(n,k+120)*6.283,d=hash(n,k+140)*r*.6;b.cone('foliage',x+Math.cos(a)*d,y+.02,cz+Math.sin(a)*d,.06,.12+hash(n,k+160)*.1,4,'#3f5f3a');}
  if(hash(n,5)<.7)b.disc('flower',x+(hash(n,6)-.5)*r*.8,y+.035,cz+(hash(n,7)-.5)*r*.8,.08,5,hash(n,8)<.5?'#e07040':'#c84a6a');
  n++;}
 return n;
}
