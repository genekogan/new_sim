import * as THREE from 'three';
import {createEdenAnimals} from './animals.ts';
import {createEdenCrops} from './crops.ts';
import {createEdenBoatsBikes} from './boats-bikes.ts';
import {createEdenProps} from './props.ts';
import {createEdenGroundCoverPlanned} from './groundcover-plan.ts';
/** CC0 imports for Eden (Quaternius, Kenney; team/asset-scouting/SOURCES.csv): animals, crops, boats and bikes, food and table props, house fixtures, ground cover and trees. Scenery only: nothing here is
 * an engine actor, support, seat or item. Each part loads its pack GLB asynchronously (the world shows without it) and
 * refuses quietly when unavailable. */
type Part={group:THREE.Group;dispose():void;stats?():Record<string,number>};
const PARTS:((ground:(x:number,z:number)=>number|null)=>Part|null)[]=[createEdenAnimals,createEdenCrops,createEdenBoatsBikes,createEdenProps,createEdenGroundCoverPlanned];
export function createEdenImports(ground:(x:number,z:number)=>number|null){
 if(typeof ground!=='function')return null;
 const group=new THREE.Group();group.name='Eden imports (CC0 models, scenery only)';
 const parts:Part[]=[];
 for(const make of PARTS){try{const p=make(ground);if(p){parts.push(p);group.add(p.group);}}catch(error){console.warn('Eden import unavailable',error);}}
 let closed=false;
 return {group,stats:()=>Object.assign({},...parts.map(p=>p.stats?.()??{})),dispose(){if(closed)return;closed=true;for(const p of parts)try{p.dispose();}catch{}group.removeFromParent();}};
}
