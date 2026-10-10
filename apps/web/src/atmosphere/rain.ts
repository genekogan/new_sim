import * as THREE from 'three';
import {leafSpell} from './visual-transitions.ts';
import {hash01} from './weather.ts';
/** Rain streaks and wind-blown autumn leaves near the camera only: one draw of
 * small camera-facing quads (rain and leaves are two ranges of one buffer). Each drop is
 * world-anchored in a box that wraps around the camera (moving the camera
 * does not drag the rain), falls and slants with the wind entirely in the
 * vertex shader. Intensity culls drops by their seed. */
const VERT=/* glsl */`
uniform vec4 uRain; // x time, y rain intensity 0..1, z daylight, w leaf intensity 0..1
uniform vec3 uCam;
uniform vec3 uWind; // xz direction * strength (m/s sideways), y unused
uniform vec4 uMotes; // x mote intensity, y 0 = sunlit pollen .. 1 = wind-blown dust
attribute vec4 aSeed; // xyz 0..1 position seeds, w 0 top / 1 tail
attribute float aSide; // -1 / 1 across the streak
attribute float aKind; // 0 rain, 1 leaf, 2 mote
varying float vA;
varying vec3 vC;
varying vec3 vUv;
const float BOX=24.0;const float H=15.0;
void leaf(){
 float t=uRain.x,ph=aSeed.z*40.0,gust=length(uWind.xz);vec2 dir=gust>1e-3?uWind.xz/gust:vec2(1.0,0.0);
 float mote=step(1.5,aKind);
 vec3 base=vec3(aSeed.x*BOX,fract(aSeed.y*3.1)*H,aSeed.z*BOX);
 float dust=mote*uMotes.y;
 float travel=t*gust*(.7+aSeed.y*.5)*mix(1.0,mix(.3,1.6,dust),mote);
 float y=mod(base.y-t*(.6+aSeed.y*.5)*mix(1.0,.08,mote)-uCam.y,H);
 // dust skims low over the ground (world height .05..1.5 m; Eden's ground is near y=0)
 y=mix(y,.05+fract(aSeed.y*5.7)*1.45+sin(t*1.9+ph)*.08-(uCam.y-H*.45),dust);
 vec3 p=vec3(uCam.x+mod(base.x+dir.x*travel-uCam.x,BOX)-BOX*.5,uCam.y-H*.45+y,uCam.z+mod(base.z+dir.y*travel-uCam.z,BOX)-BOX*.5);
 p+=vec3(sin(t*1.7+ph)*.45,sin(t*2.3+ph)*.18,cos(t*1.3+ph)*.45);
 vec3 toCam=uCam-p;float dist=length(toCam);vec3 f=toCam/max(dist,1e-3);
 vec3 r=normalize(cross(vec3(0.0,1.0,0.0),f)+vec3(1e-4,0.0,0.0));vec3 u=cross(f,r);
 float a=t*(2.0+aSeed.x*3.0)+ph,flip=cos(t*(1.3+aSeed.y*2.0)+ph*.7);
 vec2 c=vec2(aSide,aSeed.w*2.0-1.0)*mix(vec2(.05,.035),vec2(mix(.011,.016,dust)),mote);c=vec2(c.x*cos(a)-c.y*sin(a),c.x*sin(a)+c.y*cos(a));
 p+=r*c.x*mix(.25+.75*abs(flip),1.0,mote)+u*c.y;
 float threshold=fract(aSeed.x*17.3+aSeed.z*5.1);
 float on=mix(smoothstep(threshold-.03,threshold+.03,uRain.w),step(threshold,uMotes.x),mote);
 vC=mix(mix(mix(vec3(.62,.24,.06),vec3(.78,.55,.12),fract(aSeed.z*9.7)),vec3(.36,.22,.1),step(.7,fract(aSeed.x*5.3)))*(.35+.65*uRain.z)*(.75+.25*abs(flip)),mix(vec3(1.0,.97,.86)*1.3,vec3(.72,.62,.48)*(.45+.55*uRain.z),uMotes.y),mote);
 vUv=vec3(aSide,aSeed.w*2.0-1.0,1.0+mote);
 // motes glint as they turn in the sun and only show close to the camera
 float glint=mix(1.0,mix(.35+.65*pow(.5+.5*sin(t*2.6+ph*3.0),3.0),.55,uMotes.y),mote);
 vA=on*glint*smoothstep(1.0,2.5,dist)*(1.0-smoothstep(BOX*mix(.3,.12,mote),BOX*mix(.5,.22,mote),length(p.xz-uCam.xz)))*mix(1.0,.75,mote);
 gl_Position=projectionMatrix*viewMatrix*vec4(p,1.0);
 if(on<.001)gl_Position=vec4(2.0,2.0,2.0,1.0);
}
void main(){
 vUv=vec3(0.0);
 if(aKind>.5){leaf();return;}
 vC=mix(vec3(.4,.43,.5),vec3(.86,.89,.94),uRain.z);
 float speed=10.0+aSeed.y*3.0;
 vec3 base=vec3(aSeed.x*BOX,fract(aSeed.y*7.31)*H,aSeed.z*BOX);
 float y=mod(base.y-uRain.x*speed-uCam.y,H);
 vec3 p=vec3(uCam.x+mod(base.x-uCam.x,BOX)-BOX*.5,uCam.y-H*.45+y,uCam.z+mod(base.z-uCam.z,BOX)-BOX*.5);
 vec3 vel=normalize(vec3(uWind.x,-speed,uWind.z));
 p.xz+=vec2(uWind.x,uWind.z)*(y/speed);
 p-=vel*aSeed.w*(.6+aSeed.x*.35);
 float on=step(fract(aSeed.x*13.7+aSeed.z*7.9),uRain.y);
 vec3 toCam=uCam-p;float dist=length(toCam);
 p+=normalize(cross(vel,toCam))*aSide*max(.006,dist*.0011);
 vec4 mv=viewMatrix*vec4(p,1.0);
 vA=on*smoothstep(.8,3.0,dist)*(1.0-smoothstep(BOX*.3,BOX*.5,length(p.xz-uCam.xz)))*(.17+.33*uRain.z)*(1.0-aSeed.w*.75);
 gl_Position=projectionMatrix*mv;
 if(on<.5)gl_Position=vec4(2.0,2.0,2.0,1.0);
}`;
const FRAG=/* glsl */`
uniform vec4 uRain;
varying float vA;
varying vec3 vC;
varying vec3 vUv;
void main(){if(vUv.z>1.5){if(dot(vUv.xy,vUv.xy)>1.0)discard;}else if(vUv.z>.5&&abs(vUv.x)>(1.0-vUv.y*vUv.y)*.95)discard;gl_FragColor=vec4(vC,vA);
 #include <colorspace_fragment>
}`;
export const RAIN_DROPS=4200,LEAVES=280,MOTES=700;
export class Rain{
 readonly lines:THREE.Mesh<THREE.BufferGeometry,THREE.ShaderMaterial>;
 readonly uniforms={uMotes:{value:new THREE.Vector4()},uRain:{value:new THREE.Vector4()},uCam:{value:new THREE.Vector3()},uWind:{value:new THREE.Vector3()}};
 constructor(){
  const N=RAIN_DROPS+LEAVES+MOTES,g=new THREE.BufferGeometry(),S=new Float32Array(N*24),A=new Float32Array(N*6),K=new Float32Array(N*6),P=new Float32Array(N*18);
  // two triangles per drop: (top,-1)(top,+1)(tail,+1) (top,-1)(tail,+1)(tail,-1)
  const corners=[[0,-1],[0,1],[1,1],[0,-1],[1,1],[1,-1]];
  for(let i=0;i<N;i++){const a=hash01(i,11),b=hash01(i,12),c=hash01(i,13);corners.forEach(([w,side],k)=>{S.set([a,b,c,w],(i*6+k)*4);A[i*6+k]=side;K[i*6+k]=i<RAIN_DROPS?0:i<RAIN_DROPS+LEAVES?1:2;});}
  g.setAttribute('position',new THREE.BufferAttribute(P,3));g.setAttribute('aSeed',new THREE.BufferAttribute(S,4));g.setAttribute('aSide',new THREE.BufferAttribute(A,1));g.setAttribute('aKind',new THREE.BufferAttribute(K,1));
  const m=new THREE.ShaderMaterial({vertexShader:VERT,fragmentShader:FRAG,uniforms:this.uniforms,transparent:true,depthWrite:false,side:THREE.DoubleSide});
  this.lines=new THREE.Mesh(g,m);this.lines.name='atmosphere: rain';this.lines.frustumCulled=false;this.lines.userData.cameraTransparent=true;this.lines.raycast=()=>{};this.lines.renderOrder=6;
 }
 update(seconds:number,intensity:number,daylight:number,camera:THREE.Camera,windX:number,windZ:number,wind:number){
  this.update2(seconds,intensity,0,daylight,camera,windX,windZ,wind);
 }
 /** Rain and leaves together: the draw range covers only the populations that are on. */
 update2(seconds:number,intensity:number,leaves:number,daylight:number,camera:THREE.Camera,windX:number,windZ:number,wind:number,motes=0,dust=0){
  leaves*=leafSpell(seconds,wind);
  const rainOn=intensity>.01,leavesOn=leaves>.01,motesOn=motes>.01;this.lines.visible=rainOn||leavesOn||motesOn;if(!this.lines.visible)return;
  // contiguous ranges: [rain][leaves][motes]; start at the first one on, end after the last one on
  const start=rainOn?0:leavesOn?RAIN_DROPS:RAIN_DROPS+LEAVES,end=motesOn?RAIN_DROPS+LEAVES+MOTES:leavesOn?RAIN_DROPS+LEAVES:RAIN_DROPS;
  this.lines.geometry.setDrawRange(start*6,(end-start)*6);this.uniforms.uMotes.value.x=motes;this.uniforms.uMotes.value.y=dust;
  this.uniforms.uRain.value.set(seconds%7200,intensity,daylight,leaves);camera.getWorldPosition(this.uniforms.uCam.value);
  const side=1.5+wind*5.5;this.uniforms.uWind.value.set(windX*side,0,windZ*side);
 }
 dispose(){this.lines.removeFromParent();this.lines.geometry.dispose();this.lines.material.dispose();}
}
