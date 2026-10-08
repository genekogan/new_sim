/** Connected optional settings; Core alone admits surfaces, activities and storage. */
import * as THREE from 'three';
import {createRoomFurnishing,inspectRoomFurnishing} from '../room-furnishing-kit.ts';
import {createCommonsPrefab,inspectCommonsPrefab} from '../commons-prefabs.ts';
import {createSeatingPrefab,inspectSeatingPrefab} from '../seating-prefabs.ts';
import {createOutdoorStageProposal,inspectOutdoorStageProposal} from '../outdoor-stage-proposal/stage.ts';
import type {Ground} from './venue.ts';
type V=[number,number,number];type Owner={group:THREE.Group;dispose():void};
const settings={craft:{root:[92,0,-11],reserve:[84,-18,100,-4],entry:[92,-4]},performance:{root:[92,0,-30],reserve:[84,-36,100,-20],entry:[92,-22.6]}} as const;
const pieces=[{id:'craft-west-work-storage',kind:'desk-cabinet',p:[-4,0,-4]},{id:'craft-east-work-storage',kind:'desk-cabinet',p:[4,0,-4]},{id:'craft-west-table',kind:'table',p:[-4,0,0]},{id:'craft-east-table',kind:'table',p:[4,0,0]},{id:'craft-west-bench',kind:'bench',p:[-4,0,2]},{id:'craft-east-bench',kind:'bench',p:[4,0,2]},{id:'craft-rest-couch',kind:'couch',p:[0,0,-5]},{id:'craft-west-woven-mat',kind:'floor-mat',p:[-3,0,4]},{id:'craft-east-yoga-mat',kind:'yoga-mat',p:[3,0,4]}] as const;
const inspection=(kind:string)=>kind==='desk-cabinet'?inspectRoomFurnishing(kind):kind==='bench'||kind==='table'?inspectCommonsPrefab(kind):inspectSeatingPrefab(kind as 'couch'|'floor-mat'|'yoga-mat');
const factory=(kind:string):Owner=>kind==='desk-cabinet'?createRoomFurnishing(kind):kind==='bench'||kind==='table'?createCommonsPrefab(kind):createSeatingPrefab(kind as 'couch'|'floor-mat'|'yoga-mat');
export function craftPerformancePlan(){return{status:'optional decorative assembly; no goods/food/inventory/native seats/work/dance authority',craft:{...structuredClone(settings.craft),parts:pieces.map(p=>({id:p.id,kind:p.kind,localRoot:[...p.p],inspection:inspection(p.kind)})),clearAisle:{boundsXZ:[-1,-3,1,7],width:2,status:'geometry-only ground authority external'},connectionProposal:[[92,-4],[92,4],[74,4]]},performance:{...structuredClone(settings.performance),original:inspectOutdoorStageProposal(),connectionProposal:[[92,-22.6],[102,-22.6],[102,4],[92,4]],status:'original stage/ramp/canopy/lectern/four inward benches; no actual performer/audience or traversability claim'}};}
/** Root explicit, bounded to agreed plot centre. Actual ground must be flat throughout reservation. */
export function createEdenCraftPerformance(kind:'craft'|'performance',root:V,ground:Ground){
 if(!Object.hasOwn(settings,kind)||!Array.isArray(root)||root.length!==3||!root.every(Number.isFinite)||typeof ground!=='function')return null;
 const s=settings[kind];if(root[0]!==s.root[0]||root[2]!==s.root[2])return null;
 for(let x=s.reserve[0];x<=s.reserve[2];x+=.5)for(let z=s.reserve[1];z<=s.reserve[3];z+=.5){const y=ground(x,z);if(typeof y!=='number'||!Number.isFinite(y)||Math.abs(y-root[1])>1e-5)return null;}
 const group=new THREE.Group(),owners:Owner[]=[];group.name='eden-'+kind+'-setting:visual';group.position.fromArray(root);const plan=craftPerformancePlan()[kind];
 const add=(o:Owner,p:number[],id:string)=>{owners.push(o);o.group.name=id;o.group.position.fromArray(p);group.add(o.group);};
 try{if(kind==='craft')for(const p of pieces)add(factory(p.kind),[...p.p],p.id);else add(createOutdoorStageProposal(),[0,0,0],'eden-performance-stage-setting');}catch(error){const failures:unknown[]=[error];for(const o of owners.reverse())try{o.dispose();}catch(e){failures.push(e);}throw new AggregateError(failures,'Setting constructor failed; original pre-return allocations remain original factory responsibility');}
 let closed=false;return{group,plan,dispose(){if(closed)return;closed=true;const errors:unknown[]=[],attempt=(f:()=>void)=>{try{f();}catch(e){errors.push(e);}};attempt(()=>group.removeFromParent());for(const o of owners.reverse())attempt(()=>o.dispose());for(const c of [...group.children])attempt(()=>group.remove(c));if(errors.length)throw new AggregateError(errors,'Craft/performance cleanup');}};
}
