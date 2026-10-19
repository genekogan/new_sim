import * as THREE from 'three';
import type {Ground} from '../eden-expansion-assets/venue.ts';
import {Builder,Materials,disposeUnits,type Box3Rec} from './kit.ts';
import {EXISTING_ROOMS} from './existing.ts';
import {NEW_BUILDINGS,shell,FLOOR,interiorRect} from './buildings.ts';
export {INTERIOR_PLACES} from './places.ts';
/** Explore-view proposals (camera inside, at eye height, looking across each furnished room). */
export {INTERIOR_EXPLORE} from './explore.ts';
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
