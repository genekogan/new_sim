import {houseThreeRoofPhysicalProposal} from '../../../mars/viewer/app/engine-view/content/assets/eden-expansion-assets/house-three-roof-access.ts';
import {createLibraryInteriorChair} from '../../../mars/viewer/app/engine-view/content/assets/eden-expansion-assets/library-ground-contract.ts';
import {createWorldEdenTransport} from './WorldEdenTransport.ts';
import {createEdenRuralVariant} from '../../../mars/viewer/app/engine-view/content/assets/eden-expansion-assets/rural-variants.ts';
import {createEdenEntranceLanterns,entranceLanternPlan} from '../../../mars/viewer/app/engine-view/content/assets/eden-expansion-assets/entrance-lanterns.ts';
import {createEdenGardenFountain} from '../../../mars/viewer/app/engine-view/content/assets/eden-expansion-assets/garden-fountain.ts';
import * as THREE from 'three';
import {FixtureViews} from '../../../mars/viewer/app/engine-view/fixtures.ts';
import {createEdenLakeDock} from '../../../mars/viewer/app/engine-view/content/assets/eden-expansion-assets/lake-dock.ts';
import {publicActivityClusters} from '../../../mars/viewer/app/engine-view/content/assets/eden-expansion-assets/activity-clusters.ts';
import {createEdenDeeperInteriors} from '../../../mars/viewer/app/engine-view/content/assets/eden-expansion-assets/interior-deepen.ts';
import {createEdenCraftPerformance} from '../../../mars/viewer/app/engine-view/content/assets/eden-expansion-assets/craft-performance.ts';
import {createEdenCountryLookout} from '../../../mars/viewer/app/engine-view/content/assets/eden-expansion-assets/country-lookout.ts';
import {createEdenRoofPlanters,roofPlanterPlan} from '../../../mars/viewer/app/engine-view/content/assets/eden-expansion-assets/roof-planters.ts';
import {createEdenTerraceFurniture} from '../../../mars/viewer/app/engine-view/content/assets/eden-expansion-assets/terrace-furniture.ts';
import {createEdenRoofGarden} from '../../../mars/viewer/app/engine-view/content/environment/eden-expansion-roof-garden/roof-garden.mjs';
import {createEdenOutlookAtmosphere} from '../../../mars/viewer/app/engine-view/content/environment/eden-expansion-outlook/outlook.mjs';
import dockTuple from '../../../mars/viewer/app/engine-view/content/environment/eden-expansion-landscape/lake-dock-tuple.json';
import boatProposal from '../../../worlds/eden/assets/fixtures/shore-dock-proposal.v1.json';
type Owner={group:THREE.Group;dispose():void};
type Ground=(x:number,z:number)=>number|null;
type Building={id:string;group:THREE.Group;root:readonly number[];parts:any[]};
/** Local scene composition only. Rendered roof/bank checks certify this scenery
 * placement; they never assert native access, structure, activity or contacts. */
export function createWorldEdenPlaces(input:{ground:Ground;buildings:Building[]}){
 const group=new THREE.Group(),owners:Owner[]=[],omitted:string[]=[];
 const views=new FixtureViews(true),fixtures=publicActivityClusters().flatMap(c=>c.fixtures);
 group.name='Eden lakeside, activity places, roofs and countryside';group.add(views.group);
 let closed=false,outlook:ReturnType<typeof createEdenOutlookAtmosphere>=null;
 let libraryViews:FixtureViews|null=null,libraryRequest:{id:string;def:string;root:number[];yaw:number}|null=null,libraryNativePresent:boolean|undefined;
 const add=(name:string,create:()=>Owner|null)=>{const owner=create();if(!owner){omitted.push(name);return null;}owners.push(owner);group.add(owner.group);return owner;};
 const ray=new THREE.Raycaster(),origin=new THREE.Vector3(),direction=new THREE.Vector3(0,-1,0);
 const renderedTop=(target:THREE.Group,x:number,z:number,y:number)=>{target.updateWorldMatrix(true,true);ray.set(origin.set(x,y+.03,z),direction);ray.far=.06;return ray.intersectObject(target,true).some(hit=>Math.abs(hit.point.y-y)<1e-5);};
 const buildingById=new Map(input.buildings.map(b=>[b.id,b]));
 const surface=(id:string,partName:string)=>{const building=buildingById.get(id),part=building?.parts.find(p=>p.name===partName);if(!building||!part)return null;const p=part.p??part.centre;return{building,top:p[1]+part.size[1]/2+building.root[1],x:p[0]+building.root[0],z:p[2]+building.root[2]};};
 try{
  const transport=createWorldEdenTransport(input.ground);add('parked market and country transport',()=>transport);omitted.push(...transport.omitted);
  add('lake pier and parked craft',()=>createEdenLakeDock(dockTuple as any,boatProposal.boat as any));
  add('library interior original chair',()=>createLibraryInteriorChair({
   verifyFloor(id,top){const floor=surface('eden-library-1','proposed-floor');return id==='eden-library-1:proposed-floor:top'&&!!floor&&Math.abs(floor.top-top)<1e-7&&[[0,0],[-.28,-.32],[.28,-.32],[-.28,.32],[.28,.32]].every(([dx,dz])=>renderedTop(floor.building.group,75.4+dx,-7.6+dz,top));},
   createOriginalOwner(request){const view=new FixtureViews(true);try{libraryViews=view;libraryRequest=request;return{group:view.group,dispose:()=>view.dispose()};}catch(error){view.dispose();throw error;}}
  }));
  add('upper interiors',createEdenDeeperInteriors);
  for(const [kind,x,z] of [['craft',92,-11],['performance',92,-30]] as const){const y=input.ground(x,z);if(y===null)omitted.push(kind);else add(kind,()=>createEdenCraftPerformance(kind,[x,y,z],input.ground));}
  for(const [kind,x,z] of [['farmhouse',90,38.5],['lookout',3.5,-59.5]] as const){const y=input.ground(x,z);if(y===null)omitted.push(kind);else add(kind,()=>createEdenCountryLookout(kind,[x,y,z],input.ground));}
  for(const [kind,x,z] of [['cottage',-12,46],['verandah',12,46],['courtyard',0,59]] as const){const y=input.ground(x,z);if(y===null)omitted.push(kind);else add(kind,()=>createEdenRuralVariant(kind,[x,y,z],input.ground));}
  add('entrance lanterns',()=>createEdenEntranceLanterns(entranceLanternPlan().map(p=>({...p,root:[p.root[0],input.ground(p.root[0],p.root[2])??NaN,p.root[2]]})),input.ground));
  const fountainY=input.ground(79,0);if(fountainY!==null)add('library fountain',()=>createEdenGardenFountain([79,fountainY,0],input.ground));
  const plan=roofPlanterPlan();
  const beds=add('roof planter boxes',()=>createEdenRoofPlanters((id,part,p)=>{const s=surface(id,part);return !!s&&Math.abs(s.top-p[1])<1e-7&&[[0,0],[-.6,-.4],[.6,-.4],[-.6,.4],[.6,.4]].every(([dx,dz])=>renderedTop(s.building.group,p[0]+dx,p[2]+dz,p[1]));}));
  if(beds)add('roof plants',()=>createEdenRoofGarden(plan,(id:string,p:number[],rect:number[])=>{const b=plan.beds.find(b=>b.id===id);return !!b&&Math.abs(b.soil.topY-p[1])<1e-7&&rect.every((v,i)=>v===b.soil.rectangleXZ[i])&&renderedTop(beds.group,p[0],p[2],p[1]);},true));
  add('terrace furniture',()=>createEdenTerraceFurniture((id,part,top)=>{const s=surface(id,part);return !!s&&Math.abs(s.top-top)<1e-7&&renderedTop(s.building.group,s.x,s.z,top);},{houseThree:'native-fixtures'}));
  const roof=surface('eden-house-3','south-ground-roof'),roofPlan=houseThreeRoofPhysicalProposal();
  const roofFixtures=[...roofPlan.seats.map(s=>({id:s.id,def:s.def,p:s.root,yaw:s.yaw,corners:[[-.28,-.32],[.28,-.32],[-.28,.32],[.28,.32]]})),{id:roofPlan.table.id,def:roofPlan.table.defProposal,p:roofPlan.table.root,yaw:roofPlan.table.yaw,corners:[[-.7,-.4],[.7,-.4],[-.7,.4],[.7,.4]]}];
  if(roof&&roof.top===3&&roofFixtures.every(f=>f.corners.every(([dx,dz])=>renderedTop(roof.building.group,f.p[0]+dx,f.p[2]+dz,3))))for(const f of roofFixtures)fixtures.push({id:f.id,def:f.def,kind:'fixture',pose:{p:f.p as [number,number,number],yaw:f.yaw},support:{kind:'ground'}});
  else omitted.push('house3 lower roof table and catalog chairs');
  outlook=createEdenOutlookAtmosphere({worldSeed:20261006,recordedSeconds:null},true);if(outlook){owners.push(outlook);group.add(outlook.group);}else omitted.push('outlook and ornamental clouds');
 }catch(error){views.dispose();for(const owner of owners.reverse())try{owner.dispose();}catch{}throw error;}
 let presence='';
 return {group,omitted,
  sync(nativeEntities:Record<string,unknown>,seconds:number){if(closed)return;if(libraryViews&&libraryRequest){const present=Object.hasOwn(nativeEntities,libraryRequest.id);if(present!==libraryNativePresent){libraryNativePresent=present;libraryViews.onTick({entities:present?{}:{[libraryRequest.id]:{id:libraryRequest.id,def:libraryRequest.def,kind:'fixture',pose:{p:libraryRequest.root,yaw:libraryRequest.yaw},support:{kind:'ground'}}}} as any);}libraryViews.render(seconds,1);} const missing=fixtures.filter(f=>!Object.hasOwn(nativeEntities,f.id));const key=missing.map(f=>f.id).join('|');if(key!==presence){presence=key;views.onTick({entities:Object.fromEntries(missing.map(f=>[f.id,f]))} as any);}views.render(seconds,1);},
  dispose(){if(closed)return;closed=true;const errors:unknown[]=[];try{views.dispose();}catch(e){errors.push(e);}for(const owner of owners.reverse())try{owner.dispose();}catch(e){errors.push(e);}group.removeFromParent();group.clear();if(errors.length)throw new AggregateError(errors,'Eden additional places cleanup');}
 };
}
