import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {validateAuthoredLmSidecars,authoredLmAliasProfile} from './authored-lm-edge.ts';import type {WorldHost} from '../world.ts';
const read=(file:string)=>JSON.parse(readFileSync(new URL('./testdata/authored-lm/'+file,import.meta.url),'utf8'));
const raw={placeData:read('places.v1.json'),activityData:read('activity-spots.v1.json'),nativeAliases:read('native-place-aliases.json')};
const regions=Object.fromEntries(raw.nativeAliases.aliases.map((a:any)=>{const p=raw.placeData.places.find((p:any)=>p.id===a.place);return[a.nativeRegion,{...p,id:a.nativeRegion,label:p.name}]}));
const host={engine:{world:{regions,entities:{self:{body:{family:'floater'}}}},canPerform:(p:any)=>{assert.equal(p.actor,'self');return{code:'route.blocked',message:'actual admission refusal'};}}} as unknown as WorldHost;
test('pinned map sidecars retain seven native room identities and preserve admission refusal',()=>{
 const data=validateAuthoredLmSidecars(host,raw);assert.equal(data.places.places.length,17);assert.equal(data.aliases.length,7);assert.equal(data.activities.solids.length,40);
 const caps:any[]=[{id:'walk:tower-L0',target:{kind:'place',id:'tower-L0'}}],plans=new Map([['walk:tower-L0',{label:'old',steps:[]}]]);authoredLmAliasProfile(host,data.aliases)({soulId:'s',entityId:'self',owner:'fixture',name:'fixture'},caps,plans);
 assert.equal(caps.length,7);assert.ok(caps.every(c=>!c.available&&c.blocked.code==='route.blocked'));assert.equal(plans.has('walk:tower-L0'),false);assert.deepEqual(plans.get('walk:tower-l0')?.steps,[{verb:'walk_to',params:{to:'tower-L0'}}]);
});
test('sidecars reject unknown/changed aliases, outside geometry and role injection',()=>{
 for(const change of [(d:any)=>d.nativeAliases.aliases[0].nativeRegion='invented',(d:any)=>d.nativeAliases.aliases.push(d.nativeAliases.aliases[0]),(d:any)=>d.placeData.places.find((p:any)=>p.id==='tower-l0').level=0,(d:any)=>d.placeData.places[1].polygon[0]=[999,999],(d:any)=>d.activityData.solids[0].half=[-1,2],(d:any)=>d.activityData.interiors[0].doors[0]=[999,999,999,998],(d:any)=>d.placeData.places[0].roles=[{id:'admin'}]]){const d=structuredClone(raw);change(d);assert.throws(()=>validateAuthoredLmSidecars(host,d),/authored-lm.invalid/);}
});
test('ring containment checks the other corners of a slanted root',()=>{
 const d={placeData:{contract:'place-data/1',world:'littlemartians',places:[{id:'root',name:'Root',kind:'outdoor',parent:null,polygon:[[-2,0],[0,-2],[2,0],[0,2]],level:0,enclosed:false,capacity:null,starting:true}]},activityData:{contract:'activity-spots/1',world:'littlemartians',spots:[],solids:[],interiors:[],rings:[{id:'protruding-ring',c:[-.5,.5],r:1}]},nativeAliases:{schema:'native-place-aliases/1',aliases:[]}};
 // The original two corners (-1.5,-.5),(.5,1.5) lie on the root boundary;
 // (-1.5,1.5) and the corresponding circle arc protrude outside it.
 assert.throws(()=>validateAuthoredLmSidecars(host,d),/ring outside root/);
 d.activityData.rings[0].r=.4;assert.equal(validateAuthoredLmSidecars(host,d).activities.rings.length,1);
});
