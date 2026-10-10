import test from 'node:test';
import assert from 'node:assert/strict';
import {Runtime} from '../runtime/runtime.ts';
import {decodeSnapshot} from '../runtime/snapshot.ts';
import {createRegistry,servicesFor,ENGINE_INVARIANTS} from '../api/registry.ts';
import {groundSleepFixture} from '../scenarios/sleep.ts';
import {NATIVE_SLEEP_SNAPSHOT_V1,readSleep,sleepSafetyIssue} from '../activities/sleep.ts';
import {component} from '../world/factory.ts';
import {itemEntity} from '../items/model.ts';
import type {Spatial} from '../spatial/service.ts';

function setup() {
  const f=groundSleepFixture([0,0],.4),registry=createRegistry(),services=servicesFor({'ground-sleep':f.scene});
  f.p.duration=60;
  const rt=new Runtime(f.world,registry,services(f.world),ENGINE_INVARIANTS);
  rt.services.nativeSleepSnapshotV1=NATIVE_SLEEP_SNAPSHOT_V1;
  const action=rt.submit('sleep',f.p,{preempt:false});
  for(let i=0;i<2000&&readSleep(rt,action.id)?.mode!=='sleeping';i++)rt.step();
  assert.equal(readSleep(rt,action.id)?.mode,'sleeping');assert.deepEqual(rt.violations,[]);
  return {...f,rt,registry,services};
}
function safety(rt:Runtime) {
  const before=rt.stateHash(),result=sleepSafetyIssue(rt,rt.world.entities.sleeper);
  assert.equal(rt.stateHash(),before,'derived clearance cannot change canonical state');
  return result;
}

// Deliberate hypothetical fixture changes exercise safety reads, not a claim
// that an operator may install geometry intersecting an occupied body.
test('sleep clearance keeps first-obstacle diagnostic order after static rebase and removal',()=>{
  const f=setup();assert.equal(safety(f.rt),undefined);
  const wall=(id:string)=>({id,obb:{c:[0,0] as [number,number],half:[.1,.1] as [number,number],yaw:0},y0:0,y1:2});
  f.rt.world.obstacleEdits={'z-wall':wall('z-wall'),'a-wall':wall('a-wall')};
  const sp=f.rt.services.spatial as Spatial;assert.equal(sp.refreshForWorld(f.rt.world),true);
  assert.deepEqual(safety(f.rt)?.subjects,['sleeper','mat','a-wall']);
  assert.deepEqual(safety(f.rt)?.subjects,['sleeper','mat','a-wall']);
  f.rt.world.obstacleEdits={'z-wall':wall('z-wall')};assert.equal(sp.refreshForWorld(f.rt.world),true);
  assert.deepEqual(safety(f.rt)?.subjects,['sleeper','mat','z-wall']);
  f.rt.world.obstacleEdits={};assert.equal(sp.refreshForWorld(f.rt.world),true);assert.equal(safety(f.rt),undefined);
});
test('component transforms and movable item phase/support changes invalidate sleep obstruction reads',()=>{
  const f=setup();assert.equal(safety(f.rt),undefined);
  f.rt.world.entities.bench=component('bench','bench-6ft',[6,0,6]);assert.equal(safety(f.rt),undefined);
  f.rt.world.entities.bench.pose.p=[0,0,0];assert.deepEqual(safety(f.rt)?.subjects,['sleeper','mat','bench']);
  f.rt.world.entities.bench.pose.p=[6,0,6];assert.equal(safety(f.rt),undefined);
  f.rt.world.entities.bowl=itemEntity('bowl','bowl',[0,.03,0]);assert.deepEqual(safety(f.rt)?.subjects,['sleeper','mat','bowl']);
  f.rt.world.entities.bowl.phase='carried';f.rt.world.entities.bowl.support={kind:'in-hand',by:'visitor',hand:'left'};
  assert.equal(safety(f.rt),undefined);
  f.rt.world.entities.bowl.phase='staged';f.rt.world.entities.bowl.support={kind:'ground'};
  assert.deepEqual(safety(f.rt)?.subjects,['sleeper','mat','bowl']);
});
test('moving people and actual actor ownership/hands remain live after warmed clearance',()=>{
  const f=setup();assert.equal(safety(f.rt),undefined);
  f.rt.world.entities.visitor.pose.p=[0,0,0];assert.equal(safety(f.rt)?.code,'sleep.occupied');
  f.rt.world.entities.visitor.pose.p=[6,0,4];assert.equal(safety(f.rt),undefined);
  f.rt.world.entities.sleeper.human!.hands={left:[0,0,0]};assert.equal(safety(f.rt)?.code,'sleep.hands');
  delete f.rt.world.entities.sleeper.human!.hands;
  const task=f.rt.world.entities.sleeper.human!.task!;f.rt.records.get(task)!.params={actor:'visitor',mat:'mat',duration:60};
  assert.equal(safety(f.rt)?.code,'sleep.ownership');
});
test('support and exact mat geometry remain live without relying on an obstacle cache hit',()=>{
  const f=setup();assert.equal(safety(f.rt),undefined);
  f.scene.surfaces[0].obb.half=[.1,.1];assert.equal(safety(f.rt)?.code,'sleep.unsupported');
  f.scene.surfaces[0].obb.half=[12,12];assert.equal(safety(f.rt),undefined);
  f.rt.world.regions.mat.polygon.forEach(p=>{p[0]+=1;});assert.equal(safety(f.rt)?.code,'sleep.anchor-support');
});
test('cold active-sleep restoration has independent derived clearance and identical continuation',()=>{
  const f=setup();assert.equal(safety(f.rt),undefined);
  const raw=JSON.parse(JSON.stringify(f.rt.snapshot()));
  const copy=Runtime.restore(raw,f.registry,f.services(decodeSnapshot(raw).world),ENGINE_INVARIANTS);
  assert.equal(copy.stateHash(),f.rt.stateHash());assert.equal(safety(copy),undefined);
  copy.world.entities.visitor.pose.p=[0,0,0];assert.equal(safety(copy)?.code,'sleep.occupied');assert.equal(safety(f.rt),undefined);
  copy.world.entities.visitor.pose.p=[6,0,4];
  for(let i=0;i<80;i++){f.rt.step();copy.step();assert.equal(copy.stateHash(),f.rt.stateHash());}
  assert.deepEqual(copy.violations,[]);
});
