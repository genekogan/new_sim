import * as THREE from 'three';
/** WEATHER-FX (2026-10-23, Gene's night notes #8): a camera-local rain cover map, so rain wets and rings only the
 * surfaces the sky can reach. While the ground is wet or rain falls, the static scene around the view is drawn
 * from straight above (one override-material pass, a few seconds apart or when the view moves) into a small
 * top-height map; the wet-ground chunk (chunks.ts) keeps any surface more than COVER_GAP below that height dry:
 * floors inside buildings, porches under eaves, ground under tree canopies. Roofs and open ground are the top
 * surface, so they stay wet. Presentation only; nothing in the world model changes. */
const SIZE=256,SPAN=96,RANGE=256,AHEAD=26,MOVE=8,EVERY=5,EVERY_PHONE=10;
/** Shared uniforms (plain objects so material uniform cloning keeps the reference): A = (x0, z0, 1/span, on),
 * B = (base y, y range, -, -). The map texture's clone() returns itself for the same reason. */
export const COVER_A={value:{x:0,y:0,z:1/SPAN,w:0}};
export const COVER_B={value:{x:0,y:RANGE,z:0,w:0}};
const target=new THREE.WebGLRenderTarget(SIZE,SIZE,{minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,generateMipmaps:false,depthBuffer:true,format:THREE.RGBAFormat,type:THREE.UnsignedByteType});
// Uploaded only by rendering into it (version stays 0), so it may pose as an ordinary shared texture for uniform clones.
target.texture.isRenderTargetTexture=false;target.texture.clone=function(this:THREE.Texture){return this;} as THREE.Texture['clone'];
// Pin version at 0: any needsUpdate (a material/uniform pass elsewhere) would otherwise make three upload its empty image
// over the immutable render-target storage (texSubImage2D overload error + GL_INVALID_OPERATION every frame).
Object.defineProperty(target.texture,'version',{get:()=>0,set:()=>{},configurable:true});
export const COVER_MAP={value:target.texture as THREE.Texture};
const material=new THREE.ShaderMaterial({side:THREE.DoubleSide,fog:false,
 uniforms:{uBox:{value:new THREE.Vector4()}},
 vertexShader:`#include <common>
#include <batching_pars_vertex>
uniform vec4 uBox;varying float vEdenY;
void main(){
#include <batching_vertex>
#include <begin_vertex>
 vec4 w=vec4(transformed,1.0);
#ifdef USE_BATCHING
 w=batchingMatrix*w;
#endif
#ifdef USE_INSTANCING
 w=instanceMatrix*w;
#endif
 w=modelMatrix*w;vEdenY=w.y;
 gl_Position=vec4((w.x-uBox.x)/uBox.z,(w.z-uBox.y)/uBox.z,clamp((uBox.w-w.y)/${RANGE.toFixed(1)},0.0,1.0)*2.0-1.0,1.0);
}`,
 fragmentShader:`uniform vec4 uBox;varying float vEdenY;
void main(){float h=floor(clamp((vEdenY-(uBox.w-${RANGE.toFixed(1)}))/${RANGE.toFixed(1)},0.0,1.0)*65535.0);
 gl_FragColor=vec4(floor(h/256.0)/255.0,mod(h,256.0)/255.0,0.0,1.0);}`});
// Culling only: an orthographic box matching the shader's own projection (square and symmetric, so its facing is moot).
const camera=new THREE.OrthographicCamera(-SPAN/2,SPAN/2,SPAN/2,-SPAN/2,0,RANGE);camera.rotation.x=-Math.PI/2;
const hidden:THREE.Object3D[]=[],clear=new THREE.Color(),fwd=new THREE.Vector3();
let rendering=false,at=-Infinity,cx=NaN,cz=NaN;
/** True while the cover pass draws (hooks that follow the main camera skip it). */
export function rainCoverRendering(){return rendering;}
/** Things that never shelter the ground from rain: people and animals, particles, lines, sprites, see-through
 * effects, inward-facing domes and anything huge (sky, sea, the whole terrain). */
function excluded(o:THREE.Object3D){
 const any=o as THREE.Object3D&{isSkinnedMesh?:boolean;isPoints?:boolean;isLine?:boolean;isSprite?:boolean;isMesh?:boolean};
 if(any.isSkinnedMesh||any.isPoints||any.isLine||any.isSprite||o.userData.noRainCover)return true;
 if(!any.isMesh)return false;
 const m=o as THREE.Mesh,mat=(Array.isArray(m.material)?m.material[0]:m.material) as THREE.Material|undefined;
 if(!mat||mat.side===THREE.BackSide||(mat.transparent&&!mat.depthWrite)||!mat.visible)return true;
 const s=m.geometry?.boundingSphere;if(s){const k=Math.max(Math.abs(o.scale.x),Math.abs(o.scale.y),Math.abs(o.scale.z));if(s.radius*k>120)return true;}
 return false;
}
/** Redraw the map if due (wet ground or rain, the view moved, or it is a few seconds old); `on` false parks it. */
export function updateRainCover(renderer:THREE.WebGLRenderer|null,scene:THREE.Scene,view:THREE.Camera,seconds:number,on:boolean,phone:boolean,skip:THREE.Object3D|null){
 if(!on||!renderer){COVER_A.value.w=0;at=-Infinity;return;}
 view.getWorldDirection(fwd);fwd.y=0;const l=fwd.length();if(l>1e-3)fwd.multiplyScalar(AHEAD/l);
 const x=view.position.x+fwd.x,z=view.position.z+fwd.z;
 if(seconds-at<(phone?EVERY_PHONE:EVERY)&&Math.hypot(x-cx,z-cz)<MOVE&&seconds>=at)return;
 at=seconds;cx=x;cz=z;const top=view.position.y+RANGE*.5;
 material.uniforms.uBox.value.set(x,z,SPAN/2,top);camera.position.set(x,top,z);camera.updateMatrixWorld(true);
 scene.traverseVisible(o=>{if(o!==scene&&(o===skip||excluded(o))){hidden.push(o);}});
 for(const o of hidden)o.visible=false;
 const prevTarget=renderer.getRenderTarget(),prevAuto=renderer.autoClear,prevAlpha=renderer.getClearAlpha(),prevShadow=renderer.shadowMap.autoUpdate,
  prevOverride=scene.overrideMaterial,prevBackground=scene.background;renderer.getClearColor(clear);
 rendering=true;
 try{
  scene.overrideMaterial=material;scene.background=null;renderer.shadowMap.autoUpdate=false;renderer.autoClear=true;
  renderer.setRenderTarget(target);renderer.setClearColor(0x000000,0);renderer.clear(true,true,false);renderer.render(scene,camera);
 }finally{
  rendering=false;renderer.setRenderTarget(prevTarget);renderer.setClearColor(clear,prevAlpha);renderer.autoClear=prevAuto;renderer.shadowMap.autoUpdate=prevShadow;
  scene.overrideMaterial=prevOverride;scene.background=prevBackground;for(const o of hidden)o.visible=true;hidden.length=0;
 }
 COVER_A.value.x=x-SPAN/2;COVER_A.value.y=z-SPAN/2;COVER_A.value.z=1/SPAN;COVER_A.value.w=1;COVER_B.value.x=top-RANGE;COVER_B.value.y=RANGE;
}
export function disposeRainCover(){COVER_A.value.w=0;at=-Infinity;}
