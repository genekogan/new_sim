import * as THREE from 'three';
import {hash01} from './weather.ts';
/** GPU point sprites: fireflies (night, additive) and chimney smoke (soft
 * puffs). One draw each; positions are pure functions of time in the vertex
 * shader. Added to the scene root only; never raycast. */
const FIREFLY_VERT=/* glsl */`
uniform vec4 uFly; // x time, y visibility, z pixel scale, w unused
attribute vec4 aR;
varying float vGlow;
varying float vMoth;
void main(){
 float t=uFly.x,ph=aR.x*40.0,moth=step(1.5,aR.w);vMoth=moth;
 vec3 p=moth>.5
  // moths: tight erratic loops around a lamp head
  ?position+vec3(sin(t*3.1+ph)*.35+sin(t*7.3+ph*2.0)*.12,sin(t*2.3+ph*1.3)*.25+sin(t*9.1+ph)*.06,cos(t*2.7+ph*.7)*.35+cos(t*6.1+ph*1.6)*.12)
  :position+vec3(sin(t*.31+ph)*1.6+sin(t*.83+ph*1.7)*.5,.9+aR.y*1.4+sin(t*.47+ph*2.1)*.45,cos(t*.27+ph*1.3)*1.6+cos(t*.71+ph*.9)*.5);
 vec4 mv=viewMatrix*vec4(p,1.0);
 float blink=moth>.5?.35+.15*sin(t*13.0+ph):pow(max(sin(t*(.55+aR.z*.6)+ph),0.0),3.0);
 vGlow=blink*uFly.y;
 gl_PointSize=vGlow>.01?clamp(uFly.z*(moth>.5?.1:.2)/max(-mv.z,1.0),2.0,14.0)*(0.55+.45*blink):0.0;
 gl_Position=projectionMatrix*mv;
 if(vGlow<=.01)gl_Position=vec4(2.0,2.0,2.0,1.0);
}`;
const FIREFLY_FRAG=/* glsl */`
varying float vGlow;
varying float vMoth;
void main(){vec2 d=gl_PointCoord-.5;float a=exp(-dot(d,d)*14.0)*vGlow;gl_FragColor=vec4(mix(vec3(1.0,.93,.45)*2.2,vec3(1.0,.95,.85)*1.4,vMoth)*a,1.0);}`;
export const MAX_FIREFLIES=180,MOTHS=72;
export class Fireflies{
 readonly points:THREE.Points<THREE.BufferGeometry,THREE.ShaderMaterial>;
 readonly uniforms={uFly:{value:new THREE.Vector4()}};
 constructor(){
  const N=MAX_FIREFLIES+MOTHS,g=new THREE.BufferGeometry(),P=new Float32Array(N*3),R=new Float32Array(N*4);
  for(let i=0;i<N;i++){P.set([52+(hash01(i,1)-.5)*40,0,46+(hash01(i,2)-.5)*12],i*3);R.set([hash01(i,3),hash01(i,4),hash01(i,5),i<MAX_FIREFLIES?hash01(i,6):2],i*4);}
  g.setAttribute('position',new THREE.BufferAttribute(P,3));g.setAttribute('aR',new THREE.BufferAttribute(R,4));g.setDrawRange(0,MAX_FIREFLIES);
  const m=new THREE.ShaderMaterial({vertexShader:FIREFLY_VERT,fragmentShader:FIREFLY_FRAG,uniforms:this.uniforms,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending});
  this.points=new THREE.Points(g,m);this.points.name='atmosphere: fireflies';this.points.frustumCulled=false;this.points.userData.cameraTransparent=true;this.points.raycast=()=>{};this.points.renderOrder=5;
 }
 /** Spread over found low vegetation (world positions near the ground). */
 setSites(points:readonly THREE.Vector3[]){
  if(!points.length)return;const a=this.points.geometry.getAttribute('position') as THREE.BufferAttribute;
  for(let i=0;i<MAX_FIREFLIES;i++){const p=points[Math.floor(hash01(i,911)*points.length)];a.setXYZ(i,p.x+(hash01(i,12)-.5)*3,p.y,p.z+(hash01(i,13)-.5)*3);}
  a.needsUpdate=true;
 }
 /** Moths circle found lamp heads (world positions) at night. */
 setLamps(points:readonly THREE.Vector3[]){
  if(!points.length)return;const a=this.points.geometry.getAttribute('position') as THREE.BufferAttribute;
  for(let k=0;k<MOTHS;k++){const p=points[Math.floor(hash01(k,1213)*points.length)];a.setXYZ(MAX_FIREFLIES+k,p.x,p.y,p.z);}
  a.needsUpdate=true;this.points.geometry.setDrawRange(0,MAX_FIREFLIES+MOTHS);
 }
 update(seconds:number,visibility:number,pixelScale:number){this.uniforms.uFly.value.set(seconds%7200,visibility,pixelScale,0);this.points.visible=visibility>.005;}
 dispose(){this.points.removeFromParent();this.points.geometry.dispose();this.points.material.dispose();}
}

const SMOKE_VERT=/* glsl */`
uniform vec4 uSmoke; // x time, y visibility, z pixel scale, w daylight
uniform vec4 uSmokeWind; // xy dir, z strength
attribute vec4 aR; // x lifetime offset, y seed, z source scale
varying float vA;
varying float vAge;
void main(){
 float life=10.0,age=fract(uSmoke.x/life+aR.x);vAge=age;
 float s=aR.z,w=uSmokeWind.z;
 vec3 drift=vec3(uSmokeWind.x,0.0,uSmokeWind.y)*age*age*(2.0+7.0*w)*s;
 vec3 curl=vec3(sin(age*5.0+aR.y*20.0+uSmoke.x*.4),0.0,cos(age*4.3+aR.y*17.0+uSmoke.x*.33))*age*.7*s;
 vec3 p=position+vec3(0.0,age*(4.2-2.4*w)*s,0.0)+drift+curl;
 vec4 mv=viewMatrix*vec4(p,1.0);
 float size=(.35+age*2.3)*s;
 gl_PointSize=clamp(uSmoke.z*size/max(-mv.z,1.0),1.0,220.0);
 vA=smoothstep(0.0,.08,age)*(1.0-age)*(1.0-age)*.6*uSmoke.y; // W2: was .42, white-on-sky by day
 gl_Position=projectionMatrix*mv;
 if(uSmoke.y<=.001)gl_Position=vec4(2.0,2.0,2.0,1.0);
}`;
const SMOKE_FRAG=/* glsl */`
uniform vec4 uSmoke;
varying float vA;
varying float vAge;
void main(){vec2 d=gl_PointCoord-.5;float r=dot(d,d)*4.0;if(r>1.0)discard;
 float a=vA*(1.0-r)*(1.0-r);vec3 c=mix(vec3(.11,.11,.13),vec3(.74,.74,.73),.15+.85*uSmoke.w)*mix(.82,1.0,vAge);
 gl_FragColor=vec4(c,a);
 #include <colorspace_fragment>
}`;
export const SMOKE_PER_SOURCE=16,MAX_SMOKE_SOURCES=48;
/** W2: more chimneys than the smoke can carry: a fixed, seeded choice of which fires are lit (not the first found). */
function lit<T extends {p:THREE.Vector3}>(list:readonly T[]):readonly T[]{
 if(list.length<=MAX_SMOKE_SOURCES)return list;
 const key=(s:T)=>{const x=Math.round(s.p.x*2),z=Math.round(s.p.z*2);let h=2166136261;h=Math.imul(h^x,16777619);h=Math.imul(h^z,16777619);return h>>>0;};
 return list.map(s=>[key(s),s] as const).sort((a,b)=>a[0]-b[0]).slice(0,MAX_SMOKE_SOURCES).map(x=>x[1]);
}
export class Smoke{
 readonly points:THREE.Points<THREE.BufferGeometry,THREE.ShaderMaterial>;
 readonly uniforms={uSmoke:{value:new THREE.Vector4()},uSmokeWind:{value:new THREE.Vector4(1,0,0,0)}};
 private sources=0;
 constructor(){
  const n=SMOKE_PER_SOURCE*MAX_SMOKE_SOURCES,g=new THREE.BufferGeometry(),P=new Float32Array(n*3),R=new Float32Array(n*4);
  for(let i=0;i<n;i++)R.set([(i%SMOKE_PER_SOURCE)/SMOKE_PER_SOURCE+hash01(i,3)*.03,hash01(i,4),1,0],i*4);
  g.setAttribute('position',new THREE.BufferAttribute(P,3));g.setAttribute('aR',new THREE.BufferAttribute(R,4));g.setDrawRange(0,0);
  const m=new THREE.ShaderMaterial({vertexShader:SMOKE_VERT,fragmentShader:SMOKE_FRAG,uniforms:this.uniforms,transparent:true,depthWrite:false});
  this.points=new THREE.Points(g,m);this.points.name='atmosphere: chimney smoke';this.points.frustumCulled=false;this.points.userData.cameraTransparent=true;this.points.raycast=()=>{};this.points.renderOrder=4;
 }
 /** Chimney tops (world). Scale ~1 for a house chimney, smaller for a stove pipe. */
 setSources(list:readonly {p:THREE.Vector3;scale:number}[]){
  list=lit(list);const g=this.points.geometry,a=g.getAttribute('position') as THREE.BufferAttribute,r=g.getAttribute('aR') as THREE.BufferAttribute;
  this.sources=Math.min(list.length,MAX_SMOKE_SOURCES);
  for(let s=0;s<this.sources;s++)for(let k=0;k<SMOKE_PER_SOURCE;k++){const i=s*SMOKE_PER_SOURCE+k;a.setXYZ(i,list[s].p.x,list[s].p.y,list[s].p.z);r.setZ(i,list[s].scale);r.setX(i,k/SMOKE_PER_SOURCE+hash01(s,k)*.05);}
  a.needsUpdate=true;r.needsUpdate=true;g.setDrawRange(0,this.sources*SMOKE_PER_SOURCE);
 }
 get sourceCount(){return this.sources;}
 update(seconds:number,visibility:number,pixelScale:number,daylight:number,windX:number,windZ:number,wind:number){
  this.uniforms.uSmoke.value.set(seconds%7200,visibility,pixelScale,daylight);this.uniforms.uSmokeWind.value.set(windX,windZ,wind,0);
  this.points.visible=visibility>.005&&this.sources>0;
 }
 dispose(){this.points.removeFromParent();this.points.geometry.dispose();this.points.material.dispose();}
}
