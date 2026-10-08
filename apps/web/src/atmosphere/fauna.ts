import * as THREE from 'three';
import {hash01} from './weather.ts';
/** Birds (circling flocks, a few that land and peck on the commons) and
 * butterflies near flowers: ONE instanced draw, every motion computed in the
 * vertex shader from (time, per-instance constants). No CPU per frame beyond
 * one uniform write. Purely decorative: added to the scene root, never to a
 * camera visibility/raycast root, and `raycast` is a no-op. */
const BIRD_FLOCKS:[number,number,number,number,number][]=[
 // centre x, z, radius, altitude, birds
 [6,6,16,17,7],[52,46,20,22,6],[-58,-12,26,15,6],[99,38,14,24,5],[8,-46,22,12,6],[72,-12,18,19,5],
];
const LANDERS=8,FLOWER_FALLBACK:[number,number,number][]=[[37,.4,46],[45,.4,46],[64,.4,46],[72,.4,46],[20,.3,34],[17,.3,70],[99,.6,44],[-22,.3,72]];
export const MAX_BUTTERFLIES=18,GULLS=7,DUCKS=14;
const VERT=/* glsl */`
uniform vec4 uFauna; // x time, y bird visibility, z butterfly visibility, w daylight
uniform vec4 uFauna2; // x waterfowl visibility
uniform vec2 uWindDir;
attribute float aWing; // 0 body .. 1 wing tip (signed x carries the side)
attribute vec4 aA; // centre x, centre z, radius, phase
attribute vec4 aB; // altitude, angular speed (signed), size, mode (0 flock, 1 lander, 2 butterfly, 3 duck)
attribute vec4 aC; // perch / flower xyz, landing period offset
attribute vec3 aCol;
varying vec3 vCol;
varying float vShade;
vec3 circle(float t){float a=aA.w+t*aB.y;return vec3(aA.x+cos(a)*aA.z,aB.x+sin(t*.31+aA.w*3.0)*1.4,aA.y+sin(a)*aA.z);}
float landK(float t){float u=mod(t+aC.w,74.0);return u<54.0?smoothstep(40.0,48.0,u):1.0-smoothstep(62.0,67.0,u);}
vec3 lander(float t){float k=landK(t);vec3 c=circle(t),q=aC.xyz;vec3 p=mix(c,q,k);p.y+=sin(k*3.14159)*2.5*(1.0-k);
 float u=mod(t+aC.w,74.0);if(k>.98){float hop=floor(u/3.0);p.xz+=vec2(sin(hop*2.1+aA.w),cos(hop*1.7+aA.w))*.25*fract(sin(hop*12.9+aA.w)*43758.5)*(u>48.0&&u<62.0?1.0:0.0);}
 return p;}
vec3 butterfly(float t){float ph=aA.w;vec3 c=aC.xyz;
 return c+vec3(sin(t*.53+ph)*1.3+sin(t*1.9+ph*2.3)*.35,.45+.3*sin(t*.9+ph*1.7)+.18*sin(t*4.3+ph),cos(t*.41+ph*1.3)*1.3+cos(t*2.3+ph*.7)*.35);}
vec3 duck(float t){float a=aA.w+t*aB.y;return aC.xyz+vec3(cos(a)*aA.z,.02+sin(t*1.7+aA.w*3.0)*.012,sin(a)*aA.z);}
vec3 at(float t){return aB.w<.5?circle(t):aB.w<1.5?lander(t):aB.w<2.5?butterfly(t):duck(t);}
void main(){
 float t=uFauna.x,mode=aB.w;
 float vis=mode<1.5?uFauna.y:mode<2.5?uFauna.z:uFauna2.x;
 vec3 p=at(t),q=at(t+.12),f=q-p;
 float perched=mode>.5&&mode<1.5?step(.98,landK(t)):0.0;
 if(length(f)<1e-4)f=vec3(sin(aA.w*7.0),0.0,cos(aA.w*7.0));
 if(perched>.5){float u=mod(t+aC.w,74.0);float y=aA.w*6.0+floor(u/3.5)*1.3;f=vec3(sin(y),0.0,cos(y));}
 f=normalize(f);vec3 r=normalize(cross(f,vec3(0.0,1.0,0.0))+vec3(1e-5));vec3 up=cross(r,f);
 vec3 l=position;float side=sign(l.x);float w=aWing;
 if(mode<1.5){
  float env=perched>.5?0.0:smoothstep(-.3,.35,sin(t*.5+aA.w*5.0))+(mode>.5?smoothstep(.75,.95,landK(t))*(1.0-perched)*2.0:0.0);
  float flap=sin(t*(9.0+fract(aA.w*3.0)*3.0)+aA.w*11.0);
  l.y+=w*.34*(flap*.55*min(env,1.5)+.06);
  if(perched>.5){l.x*=.4;l.y+=w*.03;float u=mod(t+aC.w,74.0);float peck=smoothstep(.0,.15,fract(u*.7+aA.w))*step(.6,fract(u*.31+aA.w));l.y-=peck*.04*step(.1,l.z);}
  // bank toward the circle centre
  if(mode<.5)l.y+=l.x*.25*sign(aB.y);
 }else if(mode>2.5){
  // swimming: wings folded along the body, head-bob
  l.x*=mix(1.4,.28,step(.01,w));l.y+=w*.03+step(.1,l.z)*.035*(1.0+sin(t*3.0+aA.w*7.0)*.3);
 }else{
  float a=sin(t*19.0+aA.w*9.0)*1.15;l=vec3(l.x*cos(a),abs(l.x)*sin(a)+l.y,l.z);
 }
 l*=aB.z*vis;
 vec3 world=p+r*l.x+up*l.y+f*l.z;
 vCol=aCol;vShade=.35+.65*uFauna.w+.15*w;
 gl_Position=projectionMatrix*viewMatrix*vec4(world,1.0);
 if(vis<=.001)gl_Position=vec4(2.0,2.0,2.0,1.0);
}`;
const FRAG=/* glsl */`
varying vec3 vCol;
varying float vShade;
void main(){gl_FragColor=vec4(vCol*vShade,1.0);
 #include <colorspace_fragment>
}`;
/** Bird mesh: body diamond + two-panel wings (x right, z forward). */
function birdGeometry(){
 const P:number[]=[],W:number[]=[];
 const tri=(a:number[],b:number[],c:number[],wa:number,wb:number,wc:number)=>{P.push(...a,...b,...c);W.push(wa,wb,wc);};
 tri([0,0,.2],[.035,0,-.08],[-.035,0,-.08],0,0,0);
 tri([.035,0,-.08],[0,0,-.2],[-.035,0,-.08],0,0,0);
 tri([0,.0,-.16],[.06,0,-.24],[-.06,0,-.24],0,0,0);
 // a vertical keel (back + head) so a bird reads from the side when perched or swimming, not as a flat line
 tri([0,0,.22],[0,.07,.1],[0,.02,-.04],0,0,0);tri([0,.02,-.04],[0,.07,.1],[0,.05,-.14],0,0,0);tri([0,0,.22],[0,.02,-.04],[0,-.03,.04],0,0,0);
 for(const s of [1,-1]){
  tri([0,0,.07],[s*.16,0,.03],[0,0,-.06],0,.5,0);
  tri([0,0,-.06],[s*.16,0,.03],[s*.16,0,-.07],0,.5,.5);
  tri([s*.16,0,.03],[s*.36,0,-.09],[s*.16,0,-.07],.5,1,.5);
 }
 const g=new THREE.InstancedBufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(P,3));g.setAttribute('aWing',new THREE.Float32BufferAttribute(W,1));
 return g;
}
const BUTTERFLY_COLOURS=['#f2c14e','#f7f3e8','#e8833a','#9fc2e8','#f2a6c4','#fbe7a1'];
export class Fauna{
 readonly mesh:THREE.Mesh<THREE.InstancedBufferGeometry,THREE.ShaderMaterial>;
 readonly uniforms={uFauna:{value:new THREE.Vector4()},uFauna2:{value:new THREE.Vector4()},uWindDir:{value:new THREE.Vector2(1,0)}};
 private readonly birds:number;private readonly ducks:number;ducksPlaced=false;
 constructor(){
  const g=birdGeometry(),rows:number[][]=[];
  let seed=1;const r=()=>hash01(seed++,991);
  for(const [cx,cz,rad,alt,n] of BIRD_FLOCKS){const base=r()*6.283,dir=r()<.5?-1:1,speed=dir*(5.5+r()*2)/rad;
   for(let i=0;i<n;i++)rows.push([cx+(r()-.5)*4,cz+(r()-.5)*4,rad+(r()-.5)*7,base+(r()-.5)*.55,alt+(r()-.5)*4,speed*(1+(r()-.5)*.06),.8+r()*.35,0,0,0,0,0,.16,.16,.18]);}
  for(let i=0;i<LANDERS;i++){const rad=10+r()*6,dir=r()<.5?-1:1;
   // perch on the flat native commons ground, away from the fire pit at (0,4)
   const a=r()*6.283,d=6+r()*9;rows.push([3,6,rad,r()*6.283,11+r()*5,dir*6/rad,.75+r()*.2,1,3+Math.cos(a)*d,.02,6+Math.sin(a)*d,r()*74,.2,.19,.2]);}
  // A gull flock (white) that moves over the harbour/beach once one is found; until then it circles the lake.
  {const base=r()*6.283;for(let i=0;i<GULLS;i++)rows.push([-60+(r()-.5)*5,-14+(r()-.5)*5,20+(r()-.5)*8,base+(r()-.5)*.8,13+(r()-.5)*4,-(6+r()*2)/20,.95+r()*.3,0,0,0,0,0,.82,.82,.8]);}
  this.birds=rows.length;
  // Ducks paddle in slow circles on found water (size 0 until water is found).
  for(let i=0;i<DUCKS;i++){const brown=i%3!==0;rows.push([0,0,.6+r()*1.4,r()*6.283,0,(r()<.5?-1:1)*(.05+r()*.06),0,3,0,0,0,0,brown?.23:.75,brown?.17:.74,brown?.11:.7]);}
  this.ducks=rows.length-DUCKS;
  for(let i=0;i<MAX_BUTTERFLIES;i++){const f=FLOWER_FALLBACK[i%FLOWER_FALLBACK.length],c=new THREE.Color(BUTTERFLY_COLOURS[i%BUTTERFLY_COLOURS.length]).convertSRGBToLinear();
   rows.push([0,0,0,r()*50,0,0,.3+r()*.08,2,f[0]+(r()-.5)*2,f[1],f[2]+(r()-.5)*2,0,c.r,c.g,c.b]);}
  const n=rows.length,A=new Float32Array(n*4),B=new Float32Array(n*4),C=new Float32Array(n*4),K=new Float32Array(n*3);
  rows.forEach((row,i)=>{A.set(row.slice(0,4),i*4);B.set(row.slice(4,8),i*4);C.set(row.slice(8,12),i*4);K.set(row.slice(12,15),i*3);});
  g.setAttribute('aA',new THREE.InstancedBufferAttribute(A,4));g.setAttribute('aB',new THREE.InstancedBufferAttribute(B,4));
  g.setAttribute('aC',new THREE.InstancedBufferAttribute(C,4));g.setAttribute('aCol',new THREE.InstancedBufferAttribute(K,3));
  g.instanceCount=n;
  const m=new THREE.ShaderMaterial({vertexShader:VERT,fragmentShader:FRAG,uniforms:this.uniforms,side:THREE.DoubleSide});
  this.mesh=new THREE.Mesh(g,m);this.mesh.name='atmosphere: birds and butterflies';this.mesh.frustumCulled=false;
  this.mesh.userData.cameraTransparent=true;this.mesh.raycast=()=>{};this.mesh.castShadow=false;this.mesh.receiveShadow=false;
 }
 /** Send every other lander to a found roof ridge (world points); the rest keep the commons. */
 setPerches(points:readonly THREE.Vector3[]){
  if(!points.length)return;const A=this.mesh.geometry.getAttribute('aA') as THREE.InstancedBufferAttribute,C=this.mesh.geometry.getAttribute('aC') as THREE.InstancedBufferAttribute;
  for(let k=0;k<LANDERS;k+=2){const i=this.birds-LANDERS+k,p=points[Math.floor(hash01(k,5051)*points.length)];
   A.setX(i,p.x+(hash01(k,1)-.5)*6);A.setY(i,p.z+(hash01(k,2)-.5)*6);C.setX(i,p.x+(hash01(k,3)-.5)*.6);C.setY(i,p.y+.07);C.setZ(i,p.z+(hash01(k,4)-.5)*.6);}
  A.needsUpdate=true;C.needsUpdate=true;
 }
 /** Re-centre the gull flock over a found harbour/beach (world xz). */
 setGulls(x:number,z:number){const A=this.mesh.geometry.getAttribute('aA') as THREE.InstancedBufferAttribute;
  for(let k=0;k<GULLS;k++){const i=this.birds-GULLS+k;A.setX(i,x+(hash01(k,61)-.5)*5);A.setY(i,z+(hash01(k,62)-.5)*5);}A.needsUpdate=true;}
 /** Put ducks on found open water (world points on the surface). */
 setWater(points:readonly THREE.Vector3[]){
  if(!points.length)return;const B=this.mesh.geometry.getAttribute('aB') as THREE.InstancedBufferAttribute,C=this.mesh.geometry.getAttribute('aC') as THREE.InstancedBufferAttribute;
  for(let k=0;k<DUCKS;k++){const i=this.ducks+k,p=points[Math.floor(hash01(k,733)*points.length)];C.setXYZW(i,p.x,p.y,p.z,0);B.setZ(i,.85+hash01(k,734)*.2);}
  B.needsUpdate=true;C.needsUpdate=true;this.ducksPlaced=true;
 }
 /** Place butterflies over found flowers (world positions); called rarely (after a scan). */
 setFlowers(points:readonly THREE.Vector3[]){
  if(!points.length)return;const C=this.mesh.geometry.getAttribute('aC') as THREE.InstancedBufferAttribute;
  for(let i=0;i<MAX_BUTTERFLIES;i++){const p=points[Math.floor(hash01(i,4241)*points.length)];C.setXYZW(this.birds+i,p.x+(hash01(i,77)-.5)*1.2,p.y,p.z+(hash01(i,78)-.5)*1.2,0);}
  C.needsUpdate=true;
 }
 update(seconds:number,birds:number,butterflies:number,daylight:number,ducks=0){
  const u=this.uniforms.uFauna.value;u.set(seconds,birds,butterflies,daylight);const d=this.ducksPlaced?ducks:0;this.uniforms.uFauna2.value.x=d;
  this.mesh.visible=birds>.001||butterflies>.001||d>.001;
 }
 dispose(){this.mesh.removeFromParent();this.mesh.geometry.dispose();this.mesh.material.dispose();}
}
