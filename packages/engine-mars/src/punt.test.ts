import test from 'node:test';
import assert from 'node:assert/strict';
import {connectedCommonsShoreFactory} from './connected-shore-engine.ts';
import {marsFactory,GREEN_FIELD_WORLD} from './engine.ts';
import {groundFact} from './ground-bridge.ts';
import type {MarsEngine} from './engine.ts';
import type {Ground} from '../../ground/src/index.ts';
import {connectedCommonsShoreFixture} from './connected-shore.ts';
import {puntCandidates} from './punt.ts';
import {carrierEntity,stepCarriers} from '../../../mars/viewer/engine/vehicles/carrier.ts';

test('native pond punt carries two rowers at water level, turns, returns them to dry bank and restores exactly',async()=>{
  const factory=await connectedCommonsShoreFactory(),e=factory.create(factory.genesis('punt')) as MarsEngine,spec=e.puntCandidatesV1()[0];
  const entities=()=>e.world.entities as Record<string,any>;
  assert.equal(spec.id,'eden-punt');assert.equal(e.previewCarrierV1(spec),null);assert.equal(e.installCarrierV1(spec),true);
  e.spawnHuman({id:'a',label:'A',soul:'a'});
  const a=e.perform({actor:'a',label:'Row a loop',steps:[{verb:'walk_to',params:{to:spec.bank!.door.filter((_,i)=>i!==1),standoff:0}},{verb:'mars:carrier_ride',params:{carrier:spec.id,throughReturn:true}}]});
  assert.ok(a.ok,JSON.stringify(a));
  for(let i=0;i<2500&&entities().a.human!.carrier?.phase!=='seated';i++)e.step();
  assert.equal(entities().a.human!.activity,'row');assert.ok(e.programOf('a'),'the loop programme stays open after boarding');
  e.spawnHuman({id:'b',label:'B',soul:'b'});
  const b=e.perform({actor:'b',label:'Row together',steps:[{verb:'walk_to',params:{to:spec.bank!.door.filter((_,i)=>i!==1),standoff:0}},{verb:'mars:carrier_ride',params:{carrier:spec.id,throughReturn:true}}]});
  assert.ok(b.ok,JSON.stringify(b));
  // Hold departure while the second resident reaches the plank (as an ordinary invitation does).
  const boat=entities()[spec.id] as any;boat.carrier.departAtTick=e.world.tick+2500;
  for(let i=0;i<2500&&entities().b.human!.carrier?.phase!=='seated';i++)e.step();
  assert.equal(entities().b.human!.activity,'row');
  let restored:MarsEngine|undefined,turned=false,water=false;
  for(let i=0;i<4400&&(e.programOf('a')||e.programOf('b'));i++){
    e.step();
    if(restored){restored.step();assert.equal(restored.stateHash(),e.stateHash());}
    turned ||= Math.abs(boat.pose.yaw)>.6;
    if(boat.carrier.phase==='aloft'){water=true;assert.equal(boat.pose.p[1],-2);assert.ok(e.programOf('a'));}
    if(water&&!restored&&i%20===0)restored=factory.restore(e.snapshot()) as MarsEngine;
  }
  assert.ok(water&&turned);assert.equal(e.programOf('a'),null);assert.equal(e.programOf('b'),null);
  for(const actor of ['a','b']){assert.equal(entities()[actor].human!.carrier,undefined);assert.ok(entities()[actor].pose.p[0]>-46);assert.equal(entities()[actor].human!.shore?.depthMetres,0);}
  assert.deepEqual(e.runtime.violations,[]);
});

test('world-engine calm area waters qualify; tiny waters, absent water, forged banks and dry routes refuse',async()=>{
  const factory=await marsFactory({...GREEN_FIELD_WORLD,safeCrewRemoval:true,walkBlockV1:true}),e=factory.create(factory.genesis('water')) as MarsEngine;
  assert.deepEqual(e.puntCandidatesV1(),[]);
  const g:Ground={schema:'ground/1',base:0,extent:[-50,-50,50,50],waters:[{id:'pond',area:[[-12,-12],[12,-12],[12,12],[-12,12]],level:-.2}],landforms:[{id:'bed',kind:'carve',area:[[-12,-12],[12,-12],[12,12],[-12,12]],bed:-1.4,edge:1}]};
  e.installGroundV1(groundFact(g,0));
  const spec=e.puntCandidatesV1()[0];assert.ok(spec);assert.equal(e.previewCarrierV1(spec),null);
  const dry=structuredClone(spec);dry.routeKeys![8].p[0]=40;assert.equal(e.previewCarrierV1(dry)?.code,'punt.unsupported-water');
  const bank=structuredClone(spec);bank.bank!.door=[0,-.2,0];assert.equal(e.previewCarrierV1(bank)?.code,'punt.unsupported-water');
  assert.equal(e.installCarrierV1(spec),true);
  e.spawnHuman({id:'rower',label:'Rower',soul:'rower'});
  const programme={actor:'rower',label:'Row after an owner edit',steps:[{verb:'walk_to',params:{to:[spec.bank!.door[0],spec.bank!.door[2]],standoff:0}},{verb:'mars:carrier_ride',params:{carrier:spec.id,throughReturn:true}}]};
  assert.equal(e.canPerform(programme),null);
  e.installGroundV1(groundFact({...g,waters:[]},1));
  const before=e.stateHash();assert.equal(e.canPerform(programme)?.code,'punt.unsupported-water');assert.equal(e.stateHash(),before,'boarding refuses without moving the body after the owner removes its water');
  const failed=e.perform(programme);assert.equal(failed.ok,false);assert.equal(e.stateHash(),before);
  const tiny:Ground={...g,waters:[{id:'tiny',area:[[0,0],[3,0],[3,3],[0,3]],level:-.2}]};e.installGroundV1(groundFact(tiny,1));assert.deepEqual(e.puntCandidatesV1(),[]);
});

test('an early rear-rower stop steps around the occupied front thwart and leaves the other rider safe',async()=>{
  const fixture=await connectedCommonsShoreFixture(),world=fixture.genesis('early-stop'),rt=fixture.create(world),spec=puntCandidates(rt,fixture.renderScene())[0];
  const boat=carrierEntity(spec,0);assert.ok(!('code'in boat));world.entities[boat.id]=boat;
  const board=(id:string)=>{world.entities[id]=fixture.human(id,spec.bank!.door[0],spec.bank!.door[2]);world.entities[id].pose.p=[...spec.bank!.door];(rt.services.carrierBankContact as (rt:unknown,actor:string)=>void)(rt,id);return rt.submit('carrier_ride',{actor:id,carrier:boat.id,throughReturn:true});};
  const step=()=>{stepCarriers(rt);rt.step();},a=board('a');
  for(let i=0;i<300&&world.entities.a.human!.carrier?.phase!=='seated';i++)step();
  const b=board('b');for(let i=0;i<300&&world.entities.b.human!.carrier?.phase!=='seated';i++)step();
  assert.ok(rt.isActive(a.id)&&rt.isActive(b.id));rt.cancel(a.id);
  for(let i=0;i<400&&world.entities.a.human!.carrier;i++)step();
  assert.equal(world.entities.a.human!.carrier,undefined);assert.equal(world.entities.a.human!.shore?.depthMetres,0);
  assert.ok(world.entities.b.human!.carrier);assert.deepEqual(rt.violations,[]);
});
