import * as THREE from 'three';
/** The harbour lighthouse at night (presentation only): two opposed beams sweep from the lantern room once
 * every 12 s, soft-edged and fading along their length, brighter in mist, fog and rain; the lantern flares
 * when a beam swings toward the viewer. Additive, depth-tested, no depth write: two cheap draws, none by day.
 * The tower is the Regions harbour lighthouse (lantern glass at 14.1 m above its breakwater at x 96, z 188). */
export const LIGHTHOUSE_LANTERN=new THREE.Vector3(96,14.1,188);
const BEAM_VERT=/* glsl */`
varying float vAlong;varying vec3 vN;varying vec3 vV;
void main(){vAlong=clamp(length(position)/160.0,0.0,1.0);vec4 w=modelMatrix*vec4(position,1.0);vN=normalize(mat3(modelMatrix)*normal);vV=normalize(cameraPosition-w.xyz);gl_Position=projectionMatrix*viewMatrix*w;}`;
const BEAM_FRAG=/* glsl */`
uniform vec4 uBeam; // x strength, y haze
varying float vAlong;varying vec3 vN;varying vec3 vV;
void main(){float edge=pow(abs(dot(normalize(vN),normalize(vV))),1.6);float a=pow(1.0-vAlong,1.8)*smoothstep(0.0,.03,vAlong)*edge*uBeam.x*(.18+.5*uBeam.y);
 gl_FragColor=vec4(vec3(1.0,.93,.78)*a,1.0);}`;
const GLARE_VERT=/* glsl */`
uniform vec4 uGlare; // x strength, y size
varying vec2 vUv;
void main(){vec4 c=modelViewMatrix*vec4(0.0,0.0,0.0,1.0);c.xy+=position.xy*uGlare.y;vUv=position.xy*2.0;gl_Position=projectionMatrix*c;}`;
const GLARE_FRAG=/* glsl */`
uniform vec4 uGlare;varying vec2 vUv;
void main(){float r2=dot(vUv,vUv);if(r2>1.0)discard;float a=(exp(-r2*4.0)*.6+exp(-r2*40.0))*uGlare.x;gl_FragColor=vec4(vec3(1.0,.9,.72)*a,1.0);}`;
export class Lighthouse{
 readonly group=new THREE.Group();
 readonly beamUniforms={uBeam:{value:new THREE.Vector4()}};readonly glareUniforms={uGlare:{value:new THREE.Vector4(0,6,0,0)}};
 private readonly beams:THREE.Mesh;private readonly glare:THREE.Mesh;private yaw=0;private readonly cam=new THREE.Vector3();
 constructor(){
  this.group.name='atmosphere: lighthouse beam';this.group.position.copy(LIGHTHOUSE_LANTERN);
  // two opposed cones, apex at the lantern, 160 m long, 9 m wide at the far end; local -y along the beam
  const one=new THREE.ConeGeometry(4.5,160,20,1,true).translate(0,-80,0),two=one.clone().rotateZ(Math.PI);
  const g=new THREE.BufferGeometry();for(const name of ['position','normal'] as const){const a=one.getAttribute(name).array as Float32Array,b=two.getAttribute(name).array as Float32Array,o=new Float32Array(a.length+b.length);o.set(a);o.set(b,a.length);g.setAttribute(name,new THREE.BufferAttribute(o,3));}
  const ia=one.getIndex()!.array,ib=two.getIndex()!.array,n=one.getAttribute('position').count,idx:number[]=[...ia];for(const i of ib)idx.push(i+n);g.setIndex(idx);one.dispose();two.dispose();
  // the cone apex points along +y: lay the beams horizontal, then tilt them a touch down toward the sea
  g.rotateZ(Math.PI/2).rotateZ(-.04);
  const mat=(v:string,f:string,u:Record<string,THREE.IUniform>)=>new THREE.ShaderMaterial({vertexShader:v,fragmentShader:f,uniforms:u,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,side:THREE.DoubleSide,fog:false});
  this.beams=new THREE.Mesh(g,mat(BEAM_VERT,BEAM_FRAG,this.beamUniforms));this.beams.name='lighthouse beams';
  this.glare=new THREE.Mesh(new THREE.PlaneGeometry(1,1),mat(GLARE_VERT,GLARE_FRAG,this.glareUniforms));this.glare.name='lighthouse lantern glare';
  for(const m of [this.beams,this.glare]){m.frustumCulled=false;m.renderOrder=1e6+2;m.userData.cameraTransparent=true;m.raycast=()=>{};this.group.add(m);}
  const self=this;this.glare.onBeforeRender=function(_r,_s,camera){camera.getWorldPosition(self.cam).sub(LIGHTHOUSE_LANTERN);self.cam.y=0;
   const d=self.cam.lengthSq()>1e-6?self.cam.normalize():self.cam.set(1,0,0),beam=Math.abs(Math.cos(self.yaw)*d.x-Math.sin(self.yaw)*d.z);
   self.glareUniforms.uGlare.value.x=self.beamUniforms.uBeam.value.x*(.35+1.4*Math.pow(beam,24));};
  this.group.visible=false;
 }
 get angle(){return this.yaw;}
 update(seconds:number,night:number,haze:number){
  this.group.visible=night>.02;if(!this.group.visible)return;
  this.yaw=(seconds*Math.PI*2/12)%(Math.PI*2);this.beams.rotation.y=this.yaw;
  this.beamUniforms.uBeam.value.set(night,Math.min(1,haze),0,0);
 }
 dispose(){this.group.removeFromParent();this.beams.geometry.dispose();(this.beams.material as THREE.Material).dispose();this.glare.geometry.dispose();(this.glare.material as THREE.Material).dispose();}
}
