import * as THREE from 'three';
// L1: optional authored-light metadata; the original five-field scenery anchors stay unchanged.
import {LIGHT_PATTERN_GLSL,LIGHT_PATTERNS,type LightPattern} from '../WorldNightLights.ts';
export type HaloSource=readonly [number,number,number,string,number,LightPattern?,number?,string?];
/** Lamp bloom without a post pass: one instanced draw of camera-facing glow sprites at every published
 * night light (`userData.edenLightSources` [x, groundY, z, kind, scale] — lamps, park lamps, lanterns,
 * fires). Additive, depth-tested (a lamp behind a wall is hidden), depth-write off, pulled a little toward
 * the camera so the sprite never cuts into the lamp head. Far lamps keep a minimum pixel size so a lit
 * street still sparkles from the overview. Fires flicker. Strength follows night (0 by day: no draw). */
const VERT=/* glsl */`
attribute vec4 aHalo; // rgb colour premultiplied by intensity, w flicker seed (<0: steady)
attribute vec2 aPattern;uniform vec2 uPatternTime;
${LIGHT_PATTERN_GLSL}
uniform vec4 uHalo; // x strength, y time, z pixels per radian (viewport height / fov), w unused
varying vec2 vUv;varying vec3 vCol;
void main(){
 vec4 c=modelViewMatrix*vec4(instanceMatrix[3].xyz,1.0);
 float size=length(instanceMatrix[0].xyz);
 float dist=max(-c.z,.1);
 // keep at least ~5 px wide; shrink the brightness with that floor so distant lamps read as points
 float minSize=dist*5.0/uHalo.z;float grown=max(size,minSize);
 c.xyz+=normalize(-c.xyz)*min(.45,dist*.5);
 c.xy+=position.xy*grown;
 vUv=position.xy*2.0;
 float flick=aHalo.w<0.0?1.0:.82+.12*sin(uHalo.y*11.0+aHalo.w*17.0)+.06*sin(uHalo.y*23.0+aHalo.w*5.0);
 vCol=aHalo.rgb*uHalo.x*flick*edenPattern(aPattern.x,uPatternTime.x,aPattern.y,uPatternTime.y)*(size/grown)*(1.0-smoothstep(160.0,420.0,dist)*.6);
 gl_Position=projectionMatrix*c;
}`;
const FRAG=/* glsl */`
varying vec2 vUv;varying vec3 vCol;
void main(){
 float r2=dot(vUv,vUv);if(r2>1.0)discard;
 float a=exp(-r2*5.0)*.55+exp(-r2*38.0)*.9;
 gl_FragColor=vec4(vCol*a,1.0);
}`;
type Kind={height:(scale:number)=>number;size:number;color:string;intensity:number;flicker:boolean};
/** Head heights match the lamp models (street/park lamps: 3 m post, head at 3.2; Regions lampPost scale = h/3.4). */
const KINDS:Record<string,Kind>={
 'lamp':{height:s=>3.4*s-.2,size:.85,color:'#ffcf86',intensity:.9,flicker:false},
 'park-lamp':{height:s=>3.4*s-.2,size:.75,color:'#ffcf86',intensity:.8,flicker:false},
 'lantern':{height:s=>1.4*s+.2,size:.55,color:'#ffc777',intensity:.75,flicker:false},
 'fire':{height:()=>.55,size:1.5,color:'#ff9a4a',intensity:.75,flicker:true},
 // festival kit (anchors at the lantern / bulb itself)
 'paper-lantern':{height:()=>0,size:.6,color:'#ffd9a0',intensity:.55,flicker:false},
 'festoon':{height:()=>0,size:.32,color:'#ffe2a8',intensity:.7,flicker:false},
 'portable':{height:()=>0,size:.32,color:'#ffe2a8',intensity:.7,flicker:false},
};
export class Halos{
 readonly mesh:THREE.InstancedMesh;
 readonly uniforms={uHalo:{value:new THREE.Vector4(0,0,800,0)},uPatternTime:{value:new THREE.Vector2()}};
 private count=0;private key='';
 private sourceIndices:number[]=[];private sourceHeights:number[]=[];private moveMatrix=new THREE.Matrix4();
 constructor(max=640){
  const g=new THREE.PlaneGeometry(1,1);g.setAttribute('aHalo',new THREE.InstancedBufferAttribute(new Float32Array(max*4),4));
  g.setAttribute('aPattern',new THREE.InstancedBufferAttribute(new Float32Array(max*2),2));
  const m=new THREE.ShaderMaterial({vertexShader:VERT,fragmentShader:FRAG,uniforms:this.uniforms,transparent:true,depthWrite:false,depthTest:true,blending:THREE.AdditiveBlending,fog:false});
  this.mesh=new THREE.InstancedMesh(g,m,max);this.mesh.count=0;this.mesh.name='atmosphere: lamp glow';this.mesh.frustumCulled=false;
  this.mesh.renderOrder=1e6+1;this.mesh.userData.cameraTransparent=true;this.mesh.raycast=()=>{};this.mesh.visible=false;
 }
 /** Place a sprite at every published light (rebuilt only when the set changes). */
 setSources(list:readonly HaloSource[]){
  const key=JSON.stringify(list);if(key===this.key)return;this.key=key;
  const attr=this.mesh.geometry.getAttribute('aHalo') as THREE.InstancedBufferAttribute,patterns=this.mesh.geometry.getAttribute('aPattern') as THREE.InstancedBufferAttribute,m=new THREE.Matrix4(),c=new THREE.Color();let n=0;
  const placed:number[][]=[];this.sourceIndices=[];this.sourceHeights=[];let input=-1;
  for(const [x,y,z,kind,scale,pattern,phase,color] of list){input++;this.sourceIndices[input]=-1;const k=KINDS[kind];if(!k||n>=attr.count)continue;const s=Number.isFinite(scale)?scale:1,hy=y+k.height(s);
   // Each portable anchor is one actual emitter; colocated physical emitters may
   // later separate, so they must not be folded into a scenery duplicate.
   if(kind!=='portable'&&placed.some(p=>Math.abs(p[0]-x)<.3&&Math.abs(p[1]-hy)<.3&&Math.abs(p[2]-z)<.3))continue;if(kind!=='portable')placed.push([x,hy,z]);
   this.sourceIndices[input]=n;this.sourceHeights[input]=hy-y;
   const size=k.size*Math.max(.6,Math.min(1.5,s));m.makeScale(size,size,size).setPosition(x,hy,z);this.mesh.setMatrixAt(n,m);
   c.set(color??k.color).multiplyScalar(k.intensity);attr.setXYZW(n,c.r,c.g,c.b,k.flicker&&pattern===undefined?(n*.618)%1:-1);patterns.setXY(n,Math.max(0,LIGHT_PATTERNS.indexOf(pattern??'steady')),phase??0);n++;}
  this.count=n;this.mesh.count=n;this.mesh.instanceMatrix.clearUpdateRanges();attr.clearUpdateRanges();patterns.clearUpdateRanges();this.mesh.instanceMatrix.needsUpdate=true;attr.needsUpdate=true;patterns.needsUpdate=true;
 }
 /** Sparse movement by published input index; colour/shape and static sprites stay intact. */
 moveSource(input:number,x:number,y:number,z:number){
  const index=this.sourceIndices[input];if(index===undefined||index<0)return;
  this.mesh.getMatrixAt(index,this.moveMatrix);this.moveMatrix.setPosition(x,y+this.sourceHeights[input],z);
  this.mesh.setMatrixAt(index,this.moveMatrix);if(!this.mesh.instanceMatrix.updateRanges.some(r=>r.start===index*16))this.mesh.instanceMatrix.addUpdateRange(index*16,16);this.mesh.instanceMatrix.needsUpdate=true;
 }
 get size(){return this.count;}
 /** Night strength 0..1; the pixel scale (uHalo.z) is set per render from the renderer and camera. */
 update(seconds:number,night:number,reducedMotion=false){
  const u=this.uniforms.uHalo.value;u.x=night;u.y=seconds%600;
  this.uniforms.uPatternTime.value.set(((typeof performance!=='undefined'?performance.timeOrigin+performance.now():Date.now())/1000)%600,reducedMotion?1:0);
  this.mesh.visible=night>.01&&this.count>0;
 }
 dispose(){this.mesh.removeFromParent();this.mesh.geometry.dispose();(this.mesh.material as THREE.Material).dispose();}
}
