import test from 'node:test';
import assert from 'node:assert/strict';
import {marsFactory,EDEN_COMMONS_WORLD,GREEN_FIELD_WORLD} from './engine.ts';
import {regionArrivalMask} from './region-arrival.ts';

test('region arrival masks are finite, bounded, and keep full bodies outside interiors',()=>{
 assert.equal(regionArrivalMask([[[0,0],[4,0],[4,4],[0,4]]])!.outside(2,2),false);
 assert.equal(regionArrivalMask([[[0,0],[4,0],[4,4],[0,4]]])!.outside(4.2,2),false);
 assert.equal(regionArrivalMask([[[0,0],[4,0],[4,4],[0,4]]])!.outside(5,2),true);
 assert.equal(regionArrivalMask([[[NaN,0],[4,0],[0,4]]]),null);
 assert.equal(regionArrivalMask(Array(129).fill([[0,0],[4,0],[0,4]])),null);
});
test('a body above an outdoor region must descend instead of succeeding by X/Z alone',async()=>{
 const f=await marsFactory(EDEN_COMMONS_WORLD),e=f.create(f.genesis('region-level'));
 e.spawnHuman({id:'h',label:'Walker',soul:'s'});
 const deck=e.perform({actor:'h',label:'deck',steps:[{verb:'walk_to',params:{to:'commons-deck',standoff:0}}]});assert.equal(deck.ok,true);
 for(let i=0;i<600;i++)e.step();assert.equal(e.world.entities.h.human!.level,1);
 const legacy=e.perform({actor:'h',label:'replayed legacy field walk',steps:[{verb:'walk_to',params:{to:'field',spread:'region/1'}}]});assert.equal(legacy.ok,true);for(let i=0;i<25;i++)e.step();assert.equal(e.world.entities.h.human!.level,1,'legacy recorded programs keep their old admission');
 const start=e.world.entities.h.pose.p.slice(),walk=e.perform({actor:'h',label:'open field',steps:[{verb:'walk_to',params:{to:'field',spread:'region/1',regionOutside:[]}}]});assert.equal(walk.ok,true,JSON.stringify(walk));
 let descended=false,completed=false;
 for(let i=0;i<1200;i++){const out=e.step();descended ||= e.world.entities.h.human!.activity==='climb-down';if(walk.ok&&out.programs.some(p=>p.id===walk.id&&p.kind==='completed')){completed=true;break;}}
 assert.equal(completed,true);assert.equal(descended,true,'must use the actual level link');assert.equal(e.world.entities.h.human!.level,0);assert.notDeepEqual(e.world.entities.h.pose.p,start);
});
test('a fully excluded region refuses instead of using its interior centroid or outer fallback',async()=>{
 const f=await marsFactory({...GREEN_FIELD_WORLD,spreadV2:true}),e=f.create(f.genesis('region-closed'));e.spawnHuman({id:'h',label:'Walker',soul:'s'});
 const r=e.perform({actor:'h',label:'no outdoor room',steps:[{verb:'walk_to',params:{to:'field',spread:'region/1',regionOutside:[[[-100,-100],[100,-100],[100,100],[-100,100]]]}}]});
 assert.equal(r.ok,false);assert.match(!r.ok?r.diagnostic?.code??'':'',/region-full/);
});
