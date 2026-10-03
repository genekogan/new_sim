// Browser-only snapshots: ordinary engine bodies, no Soul minds, world clocks or server connection.
import {Runtime} from '../../engine/runtime/runtime.ts';
import {createRegistry,servicesFor,ENGINE_INVARIANTS} from '../../engine/api/registry.ts';
import {human} from '../../engine/world/factory.ts';
import {EDEN_CAMP_SCENE,edenCampWorld} from '../../engine/scenarios/eden-camp.ts';
import {LITTLE_MARTIANS_SCENE,littleMartiansWorld} from '../../engine/scenarios/littlemartians.ts';
import {GREEN_FIELD_SCENE,greenFieldWorld} from '../../engine/scenarios/greenfield.ts';
import type {Scenario} from './scenarios.ts';
export const WORLD_SNAPSHOTS:Scenario[]=[
 {name:'eden-camp-snapshot',title:'Eden camp · snapshot of the place',description:'Plain buildings, garden, kitchen, living room, bunks and raw material piles. Browser-only; no persistent Souls.',scene:()=>EDEN_CAMP_SCENE,humans:()=>[],start:()=>{},maxTicks:9000,focus:[0,0,29],build:()=>{const w=edenCampWorld();for(let i=0;i<4;i++){const id=`visitor-${i+1}`;w.entities[id]=human(id,-3+i*2,18);}return new Runtime(w,createRegistry(),servicesFor({'eden-camp':EDEN_CAMP_SCENE})(w),ENGINE_INVARIANTS);},expect:rt=>[{ok:!rt.violations.length,message:'Snapshot has no invariant faults'}]},
 {name:'littlemartians-snapshot',title:'Little Martians · ceramic garden snapshot',description:'Seven scanned floating heads, six scenery kin and two enterable buildings. Browser-only; no Soul minds or world day.',scene:()=>LITTLE_MARTIANS_SCENE,humans:()=>[],start:()=>{},maxTicks:9000,focus:[0,0,45],build:()=>{const w=littleMartiansWorld();for(const [i,name] of ['Verdelis','Kalama','Kweku','Mycos','Ada','Shuijing','Nyx'].entries()){const id=name.toLowerCase();w.entities[id]={...human(id,-6+i*2,18,{label:name}),body:{family:'floater',model:id,radius:.35,hoverHeight:1.45}};}return new Runtime(w,createRegistry(),servicesFor({littlemartians:LITTLE_MARTIANS_SCENE})(w),ENGINE_INVARIANTS);},expect:rt=>[{ok:!rt.violations.length,message:'Snapshot has no invariant faults'}]},
 {name:'greenfield-snapshot',title:'Eden · green field snapshot',description:'One idle humanoid in a literal green field. Browser-only; no owner or Soul exists in this snapshot.',scene:()=>GREEN_FIELD_SCENE,humans:()=>[],start:()=>{},maxTicks:9000,focus:[0,0,25],build:()=>{const w=greenFieldWorld();w.entities.visitor=human('visitor',0,0);return new Runtime(w,createRegistry(),servicesFor({greenfield:GREEN_FIELD_SCENE})(w),ENGINE_INVARIANTS);},expect:rt=>[{ok:!rt.violations.length,message:'Snapshot has no invariant faults'}]},
];
