import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Db} from '../../apps/server/src/db.ts';
import {GodMode} from '../../apps/server/src/god/god.ts';
import {contextTargets,contextEnclosed} from '../../apps/server/src/god/context-view-scene.ts';
import {genesis,cases} from './fixture.mjs';
import {bindCases} from './bindings.mjs';
test('frozen five-case fixture resolves actual published room before any renderer runs',()=>{
 const db=new Db(':memory:'),god=new GodMode(db,{genesis,worldId:'context-baseline-1',ownerId:null,tick:()=>1,emit(){},assetDir:mkdtempSync(join(tmpdir(),'context-binding-check-'))});
 try{
  const targets=contextTargets(god.model).map(t=>({...t,enclosed:contextEnclosed(god.model,t)}));
  const bindings=bindCases(cases,[...god.model.entities.values()],targets),room=bindings.find(b=>b.id==='enclosed-room');
  assert.equal(bindings.length,5);assert.notEqual(room.slot,'ground');
  const hall=god.model.entities.get(room.entity);
  assert.equal(god.model.slotsOf(hall).find(s=>s.id===room.slot)?.kind,'room');
  assert.equal(god.model.slotsOf(hall).find(s=>s.id==='ground')?.kind,'floor');
  assert.equal(targets.find(t=>t.ref===bindings.find(b=>b.id==='interior-seat').ref)?.enclosed,true);
  assert.throws(()=>bindCases(cases,[...god.model.entities.values()],targets.filter(t=>t.ref!==room.ref)),/exactly one enclosed room/);
  console.info(JSON.stringify({fixtureBindings:bindings.map(({id,ref,slot})=>({id,ref,slot}))}));
 }finally{db.close();}
});

test('real authored part bindings retain entity, room, seat-slot, point and region scope', () => {
 const db=new Db(':memory:'),god=new GodMode(db,{genesis,worldId:'context-baseline-1',ownerId:null,tick:()=>1,emit(){},assetDir:mkdtempSync(join(tmpdir(),'context-part-scope-'))});
 try {
  const hall=god.model.get('hall'),seat=god.model.get('hall/podium');
  const room=god.model.slotsOf(hall).find(s=>s.kind==='room'),slot=god.model.slotsOf(seat).find(s=>s.kind==='seat');
  const result=god.act({ops:[{op:'set',id:hall.id,about:{...hall.about,parts:[
   {id:'bound',title:'Actual bench',anchor:{kind:'entity',ref:seat.id}},
   {id:'room',title:'Actual room',anchor:{kind:'entity',ref:hall.id,slot:room.id}},
   {id:'slot',title:'Seat position',anchor:{kind:'entity',ref:seat.id,slot:slot.id}},
   {id:'point',title:'Speaking position',anchor:{kind:'local',point:[2,1,2],stand:[2,0,2],level:0}},
   {id:'region',title:'Discussion corner',anchor:{kind:'local',point:[3,0,3],stand:[3,0,3],level:0,region:[[2,2],[4,2],[4,4],[2,4]]}}
  ]}}]});
  assert.equal(result.accepted,true,JSON.stringify(result));
  const parts=contextTargets(god.model).filter(t=>t.part);
  assert.deepEqual(Object.fromEntries(parts.map(t=>[t.part,t.scope])),{bound:'entity',room:'room',slot:'slot',point:'point',region:'region'});
  assert.equal(parts.find(t=>t.part==='bound').entity,seat.id);
  assert.deepEqual(parts.find(t=>t.part==='region').region,[[2,2],[4,2],[4,4],[2,4]]);
 } finally { db.close(); }
});
