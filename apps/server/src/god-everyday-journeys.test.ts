// Bounded native journey diagnosis: current a479 authored Mars kitchen entry.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { fixture, factory, invite, accept } from '../test/native-owner-fixture.ts';
import { EdgeLedger } from './edge/ledger/ledger.ts';
import { GodMode } from './god/god.ts';
import { GroundHost } from './god/ground-host.ts';
import { installEngineBridge } from './god/engine-bridge.ts';
import { inPoly } from './edge/ledger/places.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
for(const yaw of [0,37*Math.PI/180]) test(`ordinary entry phrases reach the authored raised Mars kitchen floor (yaw ${yaw})`, {timeout: 45000}, async t => {
  const w = fixture(':memory:', factory, {durableClockV1: true}); w.brain.quiesce();
  const god = new GodMode(w.db, {worldId:w.host.worldId, ownerId:'owner', tick:()=>w.host.engine.world.tick, emit(){}});
  new GroundHost(w.db,w.host,god);
  const edge = new EdgeLedger(w.host,w.db), bridge = installEngineBridge({host:w.host,god,edge,log(){},worldClock:false,worldLore:false});
  t.after(()=>{w.brain.quiesce();w.host.stop();edge.comms?.close();w.db.close();});
  const tick = async (n=4) => {for(let i=0;i<n;i++){w.host.tickOnce();if(i%20===0){await setImmediate();w.host.drainInputs();}}};
  await tick();
  const placed = god.act({ops:[{op:'place',def:'core/mars-kitchen@2',name:'kitchen',p:[-20,-20],r:yaw}]} as any);
  assert.equal(placed.accepted,true,JSON.stringify(placed));await tick();
  await invite(w,'walker');const row:any=await accept(w.host,w.souls.create('dev:walker',{name:'Walker',description:'enters the kitchen'}));await tick();
  const soul={soulId:row.id,entityId:row.entity_id,name:row.name,owner:row.owner}, E=w.host.engine as any;
  const building=bridge.nav.thing('kitchen')!, rooms=bridge.nav.things().filter(x=>x.kind==='room'&&x.ref.startsWith('kitchen/'));
  assert.ok(building?.stands?.[0] && rooms.length===2,'the shipped kitchen footprint has an entrance and two rooms');
  const front=building.stands![0], dx=front[0]-building.at[0], dz=front[1]-building.at[1], d=Math.hypot(dx,dz);
  const start:[number,number]=yaw===0?[front[0],front[1]+8]:[front[0]+8*dx/d,front[1]+8*dz/d];
  const offer=edge.capabilities(soul).find(c=>c.id==='walk:kitchen');
  assert.ok(offer?.available);assert.doesNotMatch(offer.label,/closed/,'entry offer does not claim a closed front door');
  const results:any[]=[];
  for(const ask of ['walk:kitchen/dining-hall','go into the kitchen','enter the kitchen']) {
    await accept(w.host,w.host.enqueue('edge-relocate','test:kitchen-outside',{...soul,to:start,why:'start outside the actual authored kitchen entrance'}));await tick();
    const a:any=await accept(w.host,edge.act(soul,{capability:ask}));
    assert.equal(a.accepted,true,JSON.stringify({ask,a}));
    let receipt:any;
    for(let i=0;i<1800;i++){receipt=edge.receipt(soul.soulId,a.receipt.id);if(['completed','failed','cancelled'].includes(receipt?.phase))break;await tick(1);}
    const body=E.world.entities[soul.entityId], matching=rooms.filter(r=>r.level===body.human.level&&inPoly(body.pose.p[0],body.pose.p[2],r.poly!));
    results.push({ask,end:[...body.pose.p],level:body.human.level,matching:matching.map(r=>r.ref),receipt});
  }
  console.log(JSON.stringify({case:'kitchen-entry',yaw,start,building,goal:bridge.nav.goal(building,start,soul.entityId),rooms:rooms.map(r=>({ref:r.ref,level:r.level,at:r.at,poly:r.poly,entry:r.entry})),results}));
  for(const result of results) {
    assert.equal(result.receipt?.phase,'completed',JSON.stringify(result));
    assert.ok(result.matching.length,`${result.ask}: completion stands on an actual kitchen room floor`);
  }
  assert.deepEqual(E.runtime.violations,[]);
});


test('an explicit closed door of a multi-room building keeps its exterior approach', {timeout:15000}, async t=>{
  const w=fixture(':memory:',factory,{durableClockV1:true});w.brain.quiesce();
  const god=new GodMode(w.db,{worldId:w.host.worldId,ownerId:'owner',tick:()=>w.host.engine.world.tick,emit(){}});
  const edge=new EdgeLedger(w.host,w.db),bridge=installEngineBridge({host:w.host,god,edge,log(){},worldClock:false,worldLore:false});
  t.after(()=>{w.brain.quiesce();w.host.stop();edge.comms?.close();w.db.close();});
  const settle=async()=>{for(let i=0;i<4;i++){w.host.tickOnce();await setImmediate();w.host.drainInputs();}};
  const {ref:_ref,hash:_hash,by:_by,born:_born,...definition}=god.model.resolvedDef('core/cottage@1')!;
  const placed=god.act({ops:[
    {op:'define',def:{...definition,name:'closed-cottage-control',state:{...definition.state,doors:{type:'json',default:{}}}}},
    {op:'place',def:'closed-cottage-control@1',name:'closed-house',p:[20,-20],state:{doors:{'front-door':'closed'}}},
  ]} as any);
  assert.equal(placed.accepted,true,JSON.stringify(placed));await settle();
  const building=bridge.nav.thing('closed-house')!, rooms=bridge.nav.things().filter(x=>x.kind==='room'&&x.ref.startsWith('closed-house/'));
  assert.ok(building.inside && !building.doorOpen && rooms.length>1,'an actual explicit closed door and multiple rooms');
  const goal=bridge.nav.goal(building,[20,-8]);assert.ok(goal);
  assert.ok(!rooms.some(r=>r.level===goal.level&&inPoly(goal.p[0],goal.p[1],r.poly!)),'the closed-door walk goal stays outside');
  assert.ok(rooms.every(r=>bridge.nav.goal(r,[20,-8])===null),'the native route check refuses every interior behind the closed door');
});
