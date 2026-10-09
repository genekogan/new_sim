import {REGION_EXPLORE} from '../../../mars/viewer/app/engine-view/content/assets/eden-regions/index.ts';
import {INTERIOR_EXPLORE} from '../../../mars/viewer/app/engine-view/content/assets/eden-interiors/index.ts';
/** Local renderer tour addresses. They identify scenery views, never native
 * entities, controller destinations, attendance, or recorded world facts. */
export const WORLD_PLACE_VIEWS={
 gallery:{label:'Library wall gallery',p:[74,1.8,-9.1],target:[74,2.35,-3.225]},
 roofseating:{label:'Front roof table',p:[43,8.5,40],target:[34,3.5,31.4]},
 libraryroom:{label:'Library reading interior',p:[74,1.65,-3.55],target:[74.6,.7,-7.1]},
 homecourtyard:{label:'Courtyard home interior',p:[34.7,2.1,14.1],target:[33.3,.9,16.6]},
 rural:{label:'Southern village',p:[38,23,71],target:[0,2,48]},
 courtyard:{label:'Stone courtyard',p:[15,10,67],target:[0,1,59]},
 fountain:{label:'Library fountain',p:[85,5,9],target:[79,1,0]},
 dock:{label:'Lake pier',p:[-84,8,10],target:[-94,-1,2]},
 rooftops:{label:'Roof gardens',p:[66,18,42],target:[45,4,30]},
 lookout:{label:'Northern lookout',p:[22,14,-45],target:[3,1,-57]},
 craft:{label:'Craft courtyard',p:[105,12,2],target:[92,1,-11]},
 performance:{label:'Outdoor performance',p:[106,13,-17],target:[92,1,-30]},
 overview:{label:'All of Eden',p:[112,76,115],target:[7,0,5]},
 domequarter:{label:'Dome quarter',p:[104,9,57],target:[99.2,2,37]},
 amphitheatre:{label:'Amphitheatre',p:[76,10,70],target:[76,.8,82]},
 observatory:{label:'Observatory',p:[46,9,72],target:[36.5,2.4,82]},
 stonegarden:{label:'Stone garden gate',p:[65,5,-1],target:[57,1.4,-10]},
 windmill:{label:'Windmill and greenhouse',p:[74,12,18],target:[80,3,32]},
 bandstand:{label:'Bandstand',p:[45.5,4.5,-18.5],target:[38.5,1.6,-26]},
 kiosks:{label:'Market kiosks',p:[57.5,4,-18.5],target:[57.5,1.3,-26.5]},
 cabins:{label:'A-frame cabin and yurt',p:[85,8,-11],target:[72,1.6,-22]},
 teahouse:{label:'Tea house',p:[92.5,4.2,13.5],target:[92.5,1.8,4.5]},
 muralwall:{label:'Mural wall',p:[73.5,2.4,11.5],target:[73.5,1.2,4.5]},
 towerhouse:{label:'Tower house',p:[81,7,25],target:[69,4,20]},
 commons:{label:'Commons',p:[35,20,35],target:[8,1,0]},
 classroom:{label:'Classroom',p:[42,5,7],target:[42,1.7,-10]},
 presentation:{label:'Presentation screen',p:[42,3,-2],target:[42,2,-14]},
 homes:{label:'Homes',p:[68,23,48],target:[44,2,23]},
 library:{label:'Library',p:[82,16,8],target:[75,3,-4]},
 market:{label:'Market',p:[83,12,42],target:[70,1,29]},
 farm:{label:'Farm and gardens',p:[95,24,77],target:[72,1,51]},
 forest:{label:'Forest',p:[30,25,-22],target:[7,1,-44]},
 lake:{label:'Lake and river',p:[-49,30,25],target:[-80,-1,1]},
 bridge:{label:'River crossing',p:[-57,12,-11],target:[-74,-1,-22]},
} as const;
/** Regions lane districts (scenery beyond the original layout), keyed `region-<id>`. */
export const REGION_PLACE_VIEWS:Readonly<Record<string,{label:string;p:readonly [number,number,number];target:readonly [number,number,number]}>>=Object.freeze(Object.fromEntries(REGION_EXPLORE.map(e=>[`region-${e.id}`,{label:e.label,p:e.camera,target:e.target}])));
/** Buildings & Interiors lane views (inside furnished rooms and the new buildings), keyed by their `int-<id>`. */
export const INTERIOR_PLACE_VIEWS:Readonly<Record<string,{label:string;p:readonly [number,number,number];target:readonly [number,number,number]}>>=Object.freeze(Object.fromEntries(INTERIOR_EXPLORE.map(e=>[e.id,{label:e.label,p:e.camera,target:e.target}])));
export type RegionPlaceId=`region-${string}`;
export type InteriorPlaceId=`int-${string}`;
export type WorldPlaceId=keyof typeof WORLD_PLACE_VIEWS|RegionPlaceId|InteriorPlaceId;
/** Any Explore view: the original places, a Regions lane district or an interior. */
export function worldPlaceView(id:string){return Object.hasOwn(WORLD_PLACE_VIEWS,id)?WORLD_PLACE_VIEWS[id as keyof typeof WORLD_PLACE_VIEWS]:Object.hasOwn(REGION_PLACE_VIEWS,id)?REGION_PLACE_VIEWS[id]:Object.hasOwn(INTERIOR_PLACE_VIEWS,id)?INTERIOR_PLACE_VIEWS[id]:null;}
export const WORLD_PLACES=Object.freeze(Object.entries(WORLD_PLACE_VIEWS).map(([id,view])=>Object.freeze({id:id as WorldPlaceId,label:view.label})));
export const REGION_PLACES_FOR_TOUR=Object.freeze(Object.entries(REGION_PLACE_VIEWS).map(([id,view])=>Object.freeze({id:id as RegionPlaceId,label:view.label})));
export const INTERIOR_PLACES_FOR_TOUR=Object.freeze(Object.entries(INTERIOR_PLACE_VIEWS).map(([id,view])=>Object.freeze({id:id as InteriorPlaceId,label:view.label})));
