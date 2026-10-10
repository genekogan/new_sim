import test from 'node:test';
import assert from 'node:assert/strict';
import {Runtime} from '../runtime/runtime.ts';
import {DEFAULT_INVARIANTS} from '../runtime/invariants.ts';
import {Spatial} from '../spatial/service.ts';
import type {SpatialScene} from '../spatial/types.ts';
import {emptyWorld,human,addAll} from '../world/factory.ts';
import {walkTo} from '../locomotion/walk.ts';
import {dist2} from '../core/math.ts';
import type {RuntimeInternals} from '../runtime/snapshot.ts';

// Numeric phase-state fixture transcribed from the closed Mars p440 child
// a203470-53 at tick679475 (779edb99). The separate audit runs that actual
// snapshot. This fixture owns synthetic actors and supported flat ground.
function settled(policy=false) {
  const scene:SpatialScene={bounds:[-20,-20,0,0],levels:[{id:0,y:0,label:'ground'}],surfaces:[{id:'soil',level:0,y:0,obb:{c:[-10,-10],half:[10,10],yaw:0}}],obstacles:[],links:[]};
  const world=addAll(emptyWorld('settle-fixture',scene),human('walker',-13.033187190117726,-10.704727105060599),human('neighbor',-12.55,-10.950000000000001));
  const rt=new Runtime(world,new Map([['walk_to',walkTo]]),{spatial:new Spatial(scene)},DEFAULT_INVARIANTS);
  const action=rt.submit('walk_to',{actor:'walker',x:-13.1096,z:-11});
  assert.equal(action.status,'executing');
  const ex=(rt as unknown as RuntimeInternals).live.get(action.id)!.exec as Parameters<typeof walkTo.step>[1];
  ex.segs=[{a:[-13.23884532861572,-10.966552978979964],b:[-13.1096,-11],s0:0,len:.1335030268724283,cap:Infinity}];
  ex.s=ex.total=.1335030268724283;ex.offset=.3049999999999999;ex.v=.05;
  if(policy)rt.services.walkSettleWaitV1=true;
  return {rt,action};
}
test('held final sidestep publishes its actual obstruction only under prospective policy',()=>{
  const old=settled(),next=settled(true),pose=structuredClone(old.rt.world.entities.walker.pose);
  for(let i=0;i<80;i++)old.rt.step();
  assert.deepEqual(old.rt.world.entities.walker.pose,pose);
  assert.equal(old.action.phase,'settle');assert.equal(old.action.diagnostic,undefined);
  next.rt.step();
  assert.deepEqual(next.rt.world.entities.walker.pose,pose,'reporting cannot penetrate or teleport');
  assert.equal(next.action.status,'blocked');assert.equal(next.action.diagnostic?.code,'traffic.person');
  assert.deepEqual(next.action.diagnostic?.subjects,['walker','neighbor']);
  assert.equal(next.rt.world.entities.walker.human!.activity,'wait');
  assert.ok(dist2([-13.1096,-11],[-12.55,-10.95])>.56,'the endpoint is free; the inward segment is obstructed');
  assert.deepEqual(next.rt.violations,[]);assert.deepEqual(old.rt.violations,[]);
  for(let i=0;i<1200&&next.rt.isActive(next.action.id);i++)next.rt.step();
  assert.equal(next.action.status,'completed','ordinary native courtesy/recovery frees the supported route');
  assert.deepEqual(next.rt.violations,[]);
});
test('unobstructed terminal walk retains completion and no new policy-default properties',()=>{
  for(const enabled of [false,true]){
    const {rt,action}=settled(enabled);delete rt.world.entities.neighbor;
    for(let i=0;i<120&&rt.isActive(action.id);i++)rt.step();
    assert.equal(action.status,'completed');assert.deepEqual(rt.violations,[]);
    if(!enabled)assert.equal(Object.hasOwn(rt.services,'walkSettleWaitV1'),false);
  }
});
