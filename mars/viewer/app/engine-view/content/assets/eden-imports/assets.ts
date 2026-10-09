import * as THREE from 'three';
import {GLTFLoader,type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {MODEL_DIR} from '../../../people.ts';
/** CC0 models imported from Quaternius / Kenney packs (team/asset-scouting/SOURCES.csv), exported by
 * mars/scripts/imports/export_pack.py into one GLB per package: every model is one root node named after it, standing
 * on the ground at real size, with its colours baked into vertex colours (one material). Served beside the character
 * GLBs (MODEL_DIR). Bump IMPORTS_TAG whenever a pack GLB changes. */
export const IMPORTS_TAG='imports-1';
/** No invented Y0 when a decorative root has no selected drawn surface. Explicit
 * authored water/platform heights remain absolute; absent support is omitted. */
export function decorationGround(ground:(x:number,z:number)=>number|null,x:number,z:number,absolute?:number){
 const y=absolute??ground(x,z);return y!==null&&Number.isFinite(y)?y:null;
}
const cache=new Map<string,Promise<GLTF>>();
export function loadPack(file:string):Promise<GLTF>{
 let p=cache.get(file);
 if(!p){p=fetch(`${MODEL_DIR}${file}?v=${IMPORTS_TAG}`).then(r=>{if(!r.ok)throw Error(`${file}: ${r.status}`);return r.arrayBuffer();}).then(b=>new GLTFLoader().parseAsync(b,''));cache.set(file,p);p.catch(()=>cache.delete(file));}
 return p;
}
/** Geometry of one model of a pack (all meshes under its root, in the root's frame, non-indexed with a `color`). */
export function modelGeometry(gltf:GLTF,name:string):THREE.BufferGeometry|null{
 const root=gltf.scene.getObjectByName(name);if(!root)return null;
 root.updateWorldMatrix(true,true);const inv=new THREE.Matrix4().copy(root.matrixWorld).invert();
 const parts:THREE.BufferGeometry[]=[];
 root.traverse(o=>{const m=o as THREE.Mesh;if(!m.isMesh)return;let g=m.geometry.clone();g=g.index?g.toNonIndexed():g;g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv,m.matrixWorld));
  if(!g.attributes.color){const n=g.attributes.position.count,c=new Float32Array(n*3).fill(.6);g.setAttribute('color',new THREE.BufferAttribute(c,3));}
  else if(g.attributes.color.itemSize===4||(g.attributes.color as THREE.BufferAttribute).normalized){const a=g.attributes.color,n=a.count,c=new Float32Array(n*3);for(let i=0;i<n;i++){c[i*3]=a.getX(i);c[i*3+1]=a.getY(i);c[i*3+2]=a.getZ(i);}g.setAttribute('color',new THREE.BufferAttribute(c,3));}
  for(const k of Object.keys(g.attributes))if(k!=='position'&&k!=='normal'&&k!=='color')g.deleteAttribute(k);
  if(!g.attributes.normal)g.computeVertexNormals();
  parts.push(g);});
 if(!parts.length)return null;
 return parts.length===1?parts[0]:merge(parts);
}
function merge(gs:THREE.BufferGeometry[]){const out=new THREE.BufferGeometry();for(const k of ['position','normal','color']){const n=gs.reduce((s,g)=>s+g.attributes[k].array.length,0),a=new Float32Array(n);let o=0;for(const g of gs){a.set(g.attributes[k].array as Float32Array,o);o+=g.attributes[k].array.length;}out.setAttribute(k,new THREE.BufferAttribute(a,3));}gs.forEach(g=>g.dispose());return out;}
/** Merges many placed copies of pack models into one vertex-coloured geometry (one draw). */
export class PackSoup{
 private pos:number[]=[];private nor:number[]=[];private col:number[]=[];
 private m=new THREE.Matrix4();private nm=new THREE.Matrix3();private v=new THREE.Vector3();private q=new THREE.Quaternion();private s=new THREE.Vector3();private e=new THREE.Euler();
 triangles=0;
 /** Place model geometry `g` at `at` turned by `yaw` (three.js rotation.y), tilted (`tilt` about its x, `roll` about its z), uniformly scaled, optionally tinted (multiply). */
 add(g:THREE.BufferGeometry,at:readonly number[],yaw=0,scale=1,tint?:THREE.Color,tilt=0,roll=0){
  this.m.compose(this.v.set(at[0],at[1],at[2]),this.q.setFromEuler(this.e.set(tilt,yaw,roll,'YXZ')),this.s.set(scale,scale,scale));this.nm.getNormalMatrix(this.m);
  const P=g.attributes.position,N=g.attributes.normal,C=g.attributes.color,p=new THREE.Vector3(),n=new THREE.Vector3();
  for(let i=0;i<P.count;i++){p.fromBufferAttribute(P,i).applyMatrix4(this.m);n.fromBufferAttribute(N,i).applyMatrix3(this.nm).normalize();this.pos.push(p.x,p.y,p.z);this.nor.push(n.x,n.y,n.z);
   const r=C.getX(i),gg=C.getY(i),b=C.getZ(i);this.col.push(tint?r*tint.r:r,tint?gg*tint.g:gg,tint?b*tint.b:b);}
  this.triangles+=P.count/3;
 }
 get empty(){return this.pos.length===0;}
 geometry(){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(this.pos,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(this.nor,3));g.setAttribute('color',new THREE.Float32BufferAttribute(this.col,3));g.computeBoundingSphere();g.computeBoundingBox();return g;}
}
/** Stable hash of a string (+ salt) to [0, 1). */
export const hash01=(s:string,salt=0)=>{let h=2166136261^salt;for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),16777619);h=Math.imul(h^(h>>>15),2246822507);h^=h>>>13;return (h>>>0)/4294967296;};
/** Deterministic pseudo-random sequence from a seed. */
export function rng(seed:string){let i=0;return ()=>hash01(seed,++i*7919);}
