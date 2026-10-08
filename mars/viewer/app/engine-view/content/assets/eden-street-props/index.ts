import * as THREE from 'three';
import type {Ground} from '../eden-expansion-assets/venue.ts';
import {KINDS,mergeParts,concatGeometries} from './kit.ts';
import {STREET_PROP_PLACEMENTS,type Placement} from './placements.ts';
import {createEdenStreetSigns} from './signs.ts';
import {createEdenContactShadows} from './shadows.ts';
/** World Street-props lane entry point (owned by that lane). Street furniture,
 * signage, clutter and gardens across existing areas. Visual scenery only:
 * no collision, support, route, place or interaction authority. Every
 * placement is pre-computed offline (zero overlap with installed objects,
 * route centrelines and door approaches kept clear) and pinned by a test.
 * Frequent kinds are one InstancedMesh each; rare kinds are pre-transformed
 * into one static mesh per material bucket. Shared class materials;
 * everything is camera-transparent (never a Broadcast occluder); only props
 * taller than ~1 m cast shadows. */
export const EDEN_STREET_PROPS_ID='eden-street-props';
const MATERIALS={wood:'street-props painted wood',metal:'street-props steel',stone:'street-props stone',cloth:'street-props fabric',foliage:'street-props foliage',painted:'street-props painted timber',terracotta:'street-props terracotta stone'} as const;
/** Kinds placed fewer times than this share static merged meshes instead of an InstancedMesh each. */
export const INSTANCE_MIN=12;
const ROUGH={wood:.85,metal:.55,stone:.9,cloth:.95,foliage:.9,painted:.7,terracotta:.9} as const;
/** Deterministic, subtle per-placement colour jitter (weathering, fading) so repeated props never look cloned. */
export function weathering(x:number,z:number,out:THREE.Color){const f=(v:number)=>v-Math.floor(v),h=f(Math.sin(x*12.9898+z*78.233)*43758.5453),l=.9+.1*h;return out.setRGB(l*(.97+.05*f(h*7.13)),l*(.97+.05*f(h*3.71)),l*(.97+.05*f(h*5.29)));}
export function createEdenStreetProps(ground:Ground):{group:THREE.Group;dispose():void;placed:number}|null{
 if(typeof ground!=='function')return null;
 const group=new THREE.Group();group.name='Eden street props (scenery only)';
 const geos:THREE.BufferGeometry[]=[],mats=new Map<string,THREE.MeshStandardMaterial>();let closed=false,placed=0,signs:ReturnType<typeof createEdenStreetSigns>=null,blobs:ReturnType<typeof createEdenContactShadows>=null;
 const dispose=()=>{if(closed)return;closed=true;group.removeFromParent();signs?.dispose();blobs?.dispose();for(const g of geos)g.dispose();for(const m of mats.values())m.dispose();group.clear();};
 try{
  const m=new THREE.Matrix4(),q=new THREE.Quaternion(),p=new THREE.Vector3(),s=new THREE.Vector3(),up=new THREE.Vector3(0,1,0),c=new THREE.Color();
  const material=(key:keyof typeof MATERIALS)=>{let mat=mats.get(key);if(!mat){mat=new THREE.MeshStandardMaterial({name:MATERIALS[key],vertexColors:true,roughness:ROUGH[key],metalness:key==='metal'?.25:0});mats.set(key,mat);}return mat;};
  // Rarely placed kinds are pre-transformed into one static mesh per (material, shadow, clutter) bucket.
  const buckets=new Map<string,{key:keyof typeof MATERIALS;shadow:boolean;clutter:boolean;geos:THREE.BufferGeometry[];kinds:Set<string>}>();
  for(const [kind,list] of Object.entries(STREET_PROP_PLACEMENTS) as [string,readonly Placement[]][]){
   const k=KINDS[kind];if(!k)throw Error('Unknown street prop kind '+kind);
   const ok=list.filter(([x,z])=>{const y=ground(x,z);return typeof y==='number'&&Number.isFinite(y)&&Math.abs(y)<=.05;});
   if(!ok.length)continue;
   const geometry=mergeParts(k.parts());
   // Street furniture is low, thin or see-through (posts, glass shelters): none of it can hide a
   // standing person, so all of it stays out of Broadcast visibility raycasts (zero CPU cost there).
   const clear=true;
   const at=([x,z,ry,,dy,sx]:Placement)=>m.compose(p.set(x,(ground(x,z) as number)+(dy??0),z),q.setFromAxisAngle(up,ry),s.set(sx??1,1,1));
   placed+=ok.length;
   if(ok.length<INSTANCE_MIN){
    const id=k.material+(k.shadow?':shadow':'');let b=buckets.get(id);if(!b){b={key:k.material,shadow:k.shadow,clutter:clear,geos:[],kinds:new Set()};buckets.set(id,b);}
    b.kinds.add(kind);
    for(const pl of ok){const g=geometry.clone().applyMatrix4(at(pl));{if(pl[3])c.set(pl[3]);else weathering(pl[0],pl[1],c);const col=g.attributes.color;for(let i=0;i<col.count;i++)col.setXYZ(i,col.getX(i)*c.r,col.getY(i)*c.g,col.getZ(i)*c.b);}b.geos.push(g);}
    geometry.dispose();continue;
   }
   geos.push(geometry);
   const mesh=new THREE.InstancedMesh(geometry,material(k.material),ok.length);mesh.name='street-props:'+kind+' ('+k.name+')';
   ok.forEach((pl,i)=>{mesh.setMatrixAt(i,at(pl));mesh.setColorAt(i,pl[3]?c.set(pl[3]):weathering(pl[0],pl[1],c));});
   mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;mesh.computeBoundingBox();mesh.computeBoundingSphere();
   mesh.castShadow=k.shadow;mesh.receiveShadow=true;
   if(clear)mesh.userData.cameraTransparent=true;
   mesh.userData.streetPropKinds=[kind];mesh.userData.streetPropCount=ok.length;group.add(mesh);
  }
  for(const [id,b] of buckets){
   const geometry=concatGeometries(b.geos);geos.push(geometry);for(const g of b.geos)g.dispose();
   const mesh=new THREE.Mesh(geometry,material(b.key));mesh.name='street-props:static '+id;mesh.castShadow=b.shadow;mesh.receiveShadow=true;
   if(b.clutter)mesh.userData.cameraTransparent=true;
   mesh.userData.streetPropKinds=[...b.kinds];mesh.userData.streetPropCount=b.geos.length;group.add(mesh);
  }
  // Lettering (wayfinding, street names, numbers, boards): one atlas, one draw; browser only.
  // Optional layers never take the props down with them (e.g. a canvas without 2D gradients/text).
  try{signs=createEdenStreetSigns();if(signs)group.add(signs.mesh);}catch{signs=null;}
  // Soft contact shadows under the non-shadow-casting props: one transparent draw.
  try{blobs=createEdenContactShadows(ground);if(blobs)group.add(blobs.mesh);}catch{blobs=null;}
 }catch(error){dispose();throw error;}
 return {group,dispose,placed};
}
