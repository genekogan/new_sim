import * as THREE from 'three';
import {hash01} from './weather.ts';
/** Rolling fog banks over the sea (presentation only): a few dozen very large, soft, camera-facing puffs
 * lying low over the bay and along the outer coast, drifting slowly downwind and wrapping around. They thicken
 * in fog and mist and on still early mornings, and thin to nothing on clear afternoons. One instanced draw,
 * alpha-blended, no depth write; the fog colour comes from the atmosphere so banks match the air. */
const VERT=/* glsl */`
attribute vec4 aBank; // x, z (home), size, phase
uniform vec4 uBank; // x time, y drift x, z drift z, w amount
uniform vec3 uBankCol;
varying vec2 vUv;varying float vA;
void main(){
 vec3 c=vec3(aBank.x,0.0,aBank.y);
 // drift downwind, wrapping within a 1.6 km band so the banks keep rolling past
 c.x=mod(c.x+uBank.y*uBank.x+800.0,1600.0)-800.0;c.z+=sin(uBank.x*.01+aBank.w)*25.0+uBank.z*uBank.x*.15;
 c.y=3.0+aBank.z*.08+sin(uBank.x*.05+aBank.w*3.0)*1.5;
 vec4 v=modelViewMatrix*vec4(c,1.0);v.xy+=position.xy*vec2(aBank.z*1.8,aBank.z*.55);
 vUv=position.xy*2.0;vA=uBank.w*(.55+.45*sin(uBank.x*.02+aBank.w*5.0));
 // fade puffs the camera is inside or right next to
 vA*=smoothstep(aBank.z*.25,aBank.z*.9,-v.z);
 gl_Position=projectionMatrix*v;}`;
const FRAG=/* glsl */`
uniform vec3 uBankCol;varying vec2 vUv;varying float vA;
void main(){float r=dot(vUv*vec2(1.0,1.3),vUv*vec2(1.0,1.3));if(r>1.0)discard;float a=(1.0-r)*(1.0-r)*vA*.55;gl_FragColor=vec4(uBankCol,a);
 #include <colorspace_fragment>
}`;
export class FogBanks{
 readonly mesh:THREE.Mesh<THREE.InstancedBufferGeometry,THREE.ShaderMaterial>;
 readonly uniforms={uBank:{value:new THREE.Vector4()},uBankCol:{value:new THREE.Color(1,1,1)}};
 constructor(n=36){
  const g=new THREE.InstancedBufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute([-.5,-.5,0,.5,-.5,0,.5,.5,0,-.5,-.5,0,.5,.5,0,-.5,.5,0],3));
  const A=new Float32Array(n*4);for(let i=0;i<n;i++){A.set([-800+hash01(i,31)*1600,175+hash01(i,32)*230,70+hash01(i,33)*110,hash01(i,34)*6.28],i*4);}
  g.setAttribute('aBank',new THREE.InstancedBufferAttribute(A,4));g.instanceCount=n;
  this.mesh=new THREE.Mesh(g,new THREE.ShaderMaterial({vertexShader:VERT,fragmentShader:FRAG,uniforms:this.uniforms,transparent:true,depthWrite:false,fog:false}));
  this.mesh.name='atmosphere: fog banks over the sea';this.mesh.frustumCulled=false;this.mesh.renderOrder=1e6+3;this.mesh.userData.cameraTransparent=true;this.mesh.raycast=()=>{};this.mesh.visible=false;
 }
 /** amount 0..1; wind direction (x,z) and strength; fog colour. */
 update(seconds:number,amount:number,windX:number,windZ:number,wind:number,color:THREE.Color){
  const u=this.uniforms.uBank.value;u.set(seconds,windX*(.4+2*wind),windZ*(.4+2*wind),amount);this.uniforms.uBankCol.value.copy(color);
  this.mesh.visible=amount>.01;
 }
 dispose(){this.mesh.removeFromParent();this.mesh.geometry.dispose();this.mesh.material.dispose();}
}
