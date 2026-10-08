import * as THREE from 'three';
import {KINDS,mergeParts} from './kit.ts';
import {STREET_PROP_PLACEMENTS,type Placement} from './placements.ts';
/** Soft contact shadows ("blob" ambient occlusion) under props that do not
 * cast real-time shadows, so small furniture sits on the ground instead of
 * floating. One radial-gradient canvas texture, one merged transparent mesh
 * (one draw), no depth write, camera-transparent. Browser only (needs a canvas). */
const SKIP=new Set(['windowBox','banner','plaque','hangingSign','produceDisplay','flowerBuckets','drapedTowel','leaves','doormat','steppingStone','picnicBlanket','mushrooms','picket','gate','railFence','laundryLine','streetSign','lowWall','hedge']);
export function contactShadowQuads(){
 const out:{x:number;z:number;ry:number;w:number;d:number;ox:number;oz:number}[]=[];
 for(const [kind,list] of Object.entries(STREET_PROP_PLACEMENTS) as [string,readonly Placement[]][]){
  const k=KINDS[kind];if(!k||k.shadow||SKIP.has(kind))continue;
  const g=mergeParts(k.parts());g.computeBoundingBox();const b=g.boundingBox!;g.dispose();
  const w=(b.max.x-b.min.x)*1.25+.2,d=(b.max.z-b.min.z)*1.25+.2,ox=(b.max.x+b.min.x)/2,oz=(b.max.z+b.min.z)/2;
  for(const [x,z,ry,,dy,sx] of list){if((dy??0)>.05)continue;out.push({x,z,ry,w:w*(sx??1),d,ox:ox*(sx??1),oz});}
 }
 return out;
}
export function createEdenContactShadows(ground:(x:number,z:number)=>number|null):{mesh:THREE.Mesh;dispose():void}|null{
 if(typeof document==='undefined'||typeof Reflect.get(document,'createElement')!=='function')return null;
 const canvas=document.createElement('canvas');canvas.width=canvas.height=64;const g=canvas.getContext('2d');if(!g)return null;
 const grad=g.createRadialGradient(32,32,2,32,32,32);grad.addColorStop(0,'rgba(0,0,0,0.55)');grad.addColorStop(.55,'rgba(0,0,0,0.28)');grad.addColorStop(1,'rgba(0,0,0,0)');g.fillStyle=grad;g.fillRect(0,0,64,64);
 const pos:number[]=[],uv:number[]=[],nor:number[]=[];
 for(const q of contactShadowQuads()){const y=ground(q.x,q.z);if(typeof y!=='number'||!Number.isFinite(y))continue;const c=Math.cos(q.ry),s=Math.sin(q.ry),hw=q.w/2,hd=q.d/2;
  const P=(lx:number,lz:number)=>{const X=lx+q.ox,Z=lz+q.oz;return [q.x+X*c+Z*s,y+.015,q.z-X*s+Z*c];};
  for(const [lx,lz,u,v] of [[-hw,hd,0,0],[hw,hd,1,0],[hw,-hd,1,1],[-hw,hd,0,0],[hw,-hd,1,1],[-hw,-hd,0,1]] as const){pos.push(...P(lx,lz));uv.push(u,v);nor.push(0,1,0);}}
 if(!pos.length)return null;
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(nor,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geometry.computeBoundingSphere();
 const texture=new THREE.CanvasTexture(canvas);
 const material=new THREE.MeshBasicMaterial({name:'street-props contact shadow',map:texture,color:'#000000',transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-4,polygonOffsetUnits:-4});
 const mesh=new THREE.Mesh(geometry,material);mesh.name='street-props:contact shadows';mesh.renderOrder=1;mesh.castShadow=false;mesh.receiveShadow=false;mesh.userData.cameraTransparent=true;
 return {mesh,dispose(){geometry.dispose();material.dispose();texture.dispose();}};
}
