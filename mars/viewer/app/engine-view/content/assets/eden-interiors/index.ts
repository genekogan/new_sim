import * as THREE from 'three';
import type {Ground} from '../eden-expansion-assets/venue.ts';
import {Builder,Materials,disposeUnits,type Box3Rec} from './kit.ts';
import {EXISTING_ROOMS} from './existing.ts';
import {NEW_BUILDINGS,shell,FLOOR,interiorRect} from './buildings.ts';
export {INTERIOR_PLACES} from './places.ts';
/** Explore-view proposals (camera inside, at eye height, looking across each furnished room). */
export const INTERIOR_EXPLORE:readonly {id:string;label:string;camera:[number,number,number];target:[number,number,number]}[]=Object.freeze([
 {id:'int-library',label:'Library reading room',camera:[78.4,2.5,-3.5],target:[71,.6,-9.5]},
 {id:'int-barn-workshop',label:'Barn workshop and crafts',camera:[83,2.6,54.5],target:[91.5,.6,48]},
 {id:'int-office-post-room',label:'Post room and reception',camera:[92,1.6,18.5],target:[93,.9,12]},
 {id:'int-office-studio',label:'Artists’ studio (office, first floor)',camera:[97.5,4.7,18.5],target:[91,3.6,12]},
 {id:'int-house-3-kitchen',label:'House 3 kitchen and dining room',camera:[34,1.6,27.6],target:[29,.9,26]},
 {id:'int-house-3-living',label:'House 3 living room with piano',camera:[33.6,1.6,34.6],target:[37.5,.9,33]},
 {id:'int-house-2',label:'House 2 home interior',camera:[52,1.7,12.4],target:[53,.7,16]},
 {id:'int-cafe',label:'Corner café',camera:[99.2,1.7,22],target:[103.5,1,27]},
 {id:'int-music-room',label:'Music room',camera:[98.9,1.7,56.6],target:[103,1,60]},
 {id:'int-games-room',label:'Games room',camera:[87.8,1.7,-18],target:[85.5,.9,-20.8]},
 {id:'int-bakery',label:'Bakery',camera:[79,1.7,-14],target:[76.2,1,-16.6]},
 {id:'int-new-buildings',label:'Café and office street',camera:[92,6,30],target:[101.5,1.5,25]},
 {id:'int-yurt',label:'Inside the yurt',camera:[66.14,1.6,-16.52],target:[67.93,.6,-19.66]},
 {id:'int-a-frame',label:'Inside the A-frame cabin',camera:[77.47,1.6,-23.2],target:[75.92,.7,-26.88]},
 {id:'int-observatory',label:'Inside the observatory',camera:[36.5,1.6,80.4],target:[36.5,1.4,83.2]},
 {id:'int-windmill',label:'Inside the windmill',camera:[86.76,1.6,28.99],target:[88.85,.7,26.9]},
 {id:'int-tower-house',label:'Inside the tower house',camera:[70.3,1.6,20.9],target:[68.3,.9,19.6]},
 {id:'int-tower-house-top',label:'Tower house bedroom',camera:[69.9,6.85,19.2],target:[68.6,5.5,20.9]},
 {id:'int-chapel',label:'Chapel',camera:[84.5,1.7,80.6],target:[88.7,.9,82.3]},
 {id:'int-clinic',label:'Clinic',camera:[63.9,1.7,-6.4],target:[64.1,.9,-10.5]},
 {id:'int-bathhouse',label:'Bathhouse and laundry',camera:[83.5,1.7,-8.4],target:[83.5,.9,-12.5]},
 {id:'int-potting-shed',label:'Potting shed',camera:[43.4,1.7,80.9],target:[44.2,.9,84.3]},
]);
/** World Buildings & Interiors lane entry point (owned by that lane): new building
 * and object kinds, and furnished, enterable interiors. Scenery unless Core admits.
 * Furniture/dressing is camera-transparent; walls/floors/roofs of new buildings stay opaque.
 * Each room is one Builder → one mesh per layer (≈2–4 draws per furnished room). */
export type InteriorsStats={draws:number;triangles:number;rooms:number};
export function buildInteriors(){const rooms:{id:string;b:Builder;owner:string[]}[]=[];
 for(const r of EXISTING_ROOMS){const b=new Builder();r.draw(b);rooms.push({id:r.id,b,owner:[]});}
 // New buildings: every shell (walls/floor/roof/glass/sign/exterior) shares one Builder; each interior has its own.
 const shells=new Builder(),owner:string[]=[];
 for(const k of NEW_BUILDINGS){const n=shells.boxes.length;shell(shells,k);for(let i=n;i<shells.boxes.length;i++)owner[i]=k.id;
  const b=new Builder();b.push(k.cx,FLOOR,k.cz,k.yaw);k.interior(b);b.pop();rooms.push({id:k.id,b,owner:[]});}
 rooms.push({id:'new-building-shells',b:shells,owner});
 return rooms;}
/** Every authored part's world AABB with its label (for the lane's placement checks). */
export function interiorBoxes():(Box3Rec&{room:string})[]{return buildInteriors().flatMap(r=>r.b.boxes.map((x,i)=>({...x,room:r.owner[i]??r.id})));}
export function createEdenInteriors(ground:Ground):{group:THREE.Group;dispose():void;stats:InteriorsStats}|null{
 if(typeof ground!=='function')return null;
 // Native flat ground under every room it furnishes (installed shells sit on Y0).
 for(const [x,z] of [[74,-7],[88,51],[92,15],[67.5,-18.5],[76.5,-25.5],[36.5,82],[88,27.75],[69,20],...NEW_BUILDINGS.flatMap(k=>{const r=interiorRect(k);return[[r[0],r[1]],[r[2],r[3]],[r[0],r[3]],[r[2],r[1]]];})]){const y=ground(x,z);if(y===null||!Number.isFinite(y)||Math.abs(y)>1e-6)return null;}
 const group=new THREE.Group();group.name='Eden interiors (scenery only)';const mats=new Materials();let draws=0,triangles=0;
 const smoke:[number,number,number,number][]=[];
 try{for(const r of buildInteriors()){
  // Stove pipes that leave the roof (yurt, A-frame) smoke: the top of each stove group's tallest part (atmosphere finder reads userData.edenSmokeSources).
  const tops=new Map<string,Box3Rec>();for(const x of r.b.boxes)if(/stove/.test(x.label)&&x.max[1]>3&&(!tops.has(x.label)||tops.get(x.label)!.max[1]<x.max[1]))tops.set(x.label,x);
  for(const x of tops.values())smoke.push([(x.min[0]+x.max[0])/2,x.max[1]+.05,(x.min[2]+x.max[2])/2,.5]);
  const g=new THREE.Group();g.name='Interior '+r.id;const s=r.b.emit(g,mats,'Interior '+r.id);draws+=s.draws;triangles+=s.tris;group.add(g);}}
 catch(e){group.traverse(o=>{if((o as THREE.Mesh).isMesh)(o as THREE.Mesh).geometry.dispose();});mats.dispose();throw e;}
 disposeUnits();group.userData.edenSmokeSources=smoke;
 let closed=false;
 return {group,stats:{draws,triangles,rooms:group.children.length},dispose(){if(closed)return;closed=true;group.removeFromParent();group.traverse(o=>{if((o as THREE.Mesh).isMesh)(o as THREE.Mesh).geometry.dispose();});mats.dispose();group.clear();}};
}
