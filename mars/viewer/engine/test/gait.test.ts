import test from 'node:test';
import assert from 'node:assert/strict';
import {Runtime,DT} from '../runtime/runtime.ts';
import {DEFAULT_INVARIANTS,speedWithinCap,maxStepPerTick} from '../runtime/invariants.ts';
import {Spatial} from '../spatial/service.ts';
import {emptyWorld,human,addAll} from '../world/factory.ts';
import {walkTo,walkSchemaNow,GAIT_SPEED_CAPS,CLIMB_SPEED,type Gait} from '../locomotion/walk.ts';
import {provingGround} from '../scenes/proving-ground.ts';
import type {SpatialScene} from '../spatial/types.ts';
import type {ActionDef} from '../actions/types.ts';

const scene:SpatialScene={bounds:[-30,-12,30,12],levels:[{id:0,y:0,label:'Dry test ground'}],surfaces:[{id:'ground',level:0,y:0,obb:{c:[0,0],half:[30,12],yaw:0}}],obstacles:[],links:[]};
const registry=()=>new Map<string,ActionDef>([['walk_to',walkTo]]);
function fixture(blocked=false){const base=structuredClone(scene);if(blocked)base.obstacles.push({id:'wall',obb:{c:[0,0],half:[.2,4],yaw:0},y0:0,y1:2,kind:'wall'});return {base,rt:new Runtime(addAll(emptyWorld('gait',base),human('h',-20,0)),registry(),{spatial:new Spatial(base)},DEFAULT_INVARIANTS)};}
function travel(gait?:Gait,blocked=false){const {rt}=fixture(blocked),h=rt.world.entities.h,rec=rt.submit('walk_to',{actor:'h',x:20,z:0,...(gait?{gait}:{})});assert.equal(rec.status,'executing',rec.diagnostic?.message);let max=0,steps=0,previous=[...h.pose.p];const activities=new Set<string>();
  while(rt.isActive(rec.id)&&steps++<2000){rt.step();activities.add(h.human!.activity);max=Math.max(max,h.human!.speed??0);assert.ok(Math.hypot(h.pose.p[0]-previous[0],h.pose.p[2]-previous[2])<=(GAIT_SPEED_CAPS[gait??'walk']*DT)+1e-8);previous=[...h.pose.p];}
  assert.equal(rec.status,'completed',rec.diagnostic?.message);assert.deepEqual(rt.violations,[]);assert.ok(Math.hypot(h.pose.p[0]-20,h.pose.p[2])<.06);assert.equal(h.human!.activity,'idle');return {steps,max,activities,hash:rt.stateHash()};}

test('explicit jog/run reach 2.5/4 m/s, finish sooner, and publish their matching activity',()=>{
  const walk=travel(),same=travel('walk'),jog=travel('jog'),run=travel('run');assert.deepEqual(same,walk,'an explicit walk preserves legacy movement');
  assert.ok(jog.steps<walk.steps*.75);assert.ok(run.steps<jog.steps*.8);assert.equal(jog.max,2.5);assert.equal(run.max,4);assert.ok(jog.activities.has('jog'));assert.ok(run.activities.has('run'));
});
test('running keeps the corridor and collision invariants around a wall',()=>{assert.ok(travel('run',true).activities.has('run'));});
test('a run to an upper level retains the ordinary slow stair controller',()=>{
  const base=provingGround(),rt=new Runtime(addAll(emptyWorld('proving-ground',base),human('h',-8,10)),registry(),{spatial:new Spatial(base)},DEFAULT_INVARIANTS),h=rt.world.entities.h;
  const r=rt.submit('walk_to',{actor:'h',x:10,z:10,level:1,gait:'run'});assert.equal(r.status,'executing');let climb=false;
  for(let i=0;i<1600&&rt.isActive(r.id);i++){rt.step();if(h.human!.activity==='climb-up'){climb=true;assert.ok((h.human!.speed??0)<=CLIMB_SPEED*1.05);}}
  assert.equal(r.status,'completed',r.diagnostic?.message);assert.equal(climb,true);assert.equal(h.human!.level,1);assert.deepEqual(rt.violations,[]);
});
test('schema retains walk cap unless the faster gait is explicit',()=>{
  const p={actor:'h',x:1,z:0};assert.equal(walkSchemaNow().safeParse({...p,speed:2.5}).success,false);assert.equal(walkSchemaNow().safeParse({...p,gait:'jog',speed:2.6}).success,false);assert.equal(walkSchemaNow().safeParse({...p,gait:'run',speed:4.01}).success,false);assert.equal(walkSchemaNow().safeParse({...p,gait:'run',speed:4}).success,true);assert.equal(walkSchemaNow().safeParse({...p,gait:'sprint'}).success,false);
});
test('unsupported body refuses before any physical effect; running cancellation stops safely',()=>{
  const {rt}=fixture(),h=rt.world.entities.h;h.body={family:'floater'};const before=rt.stateHash();const no=rt.submit('walk_to',{actor:'h',x:20,z:0,gait:'run'});assert.equal(no.status,'failed');assert.equal(no.diagnostic?.code,'gait.unsupported-body');assert.deepEqual(h.pose.p,[-20,0,0]);assert.equal(h.human!.task,undefined);assert.equal(rt.stateHash(),before);
  delete h.body;const r=rt.submit('walk_to',{actor:'h',x:20,z:0,gait:'run'});for(let i=0;i<100;i++)rt.step();assert.equal(h.human!.activity,'run');rt.cancel(r.id);const at=[...h.pose.p];for(let i=0;i<10;i++)rt.step();assert.deepEqual(h.pose.p,at);assert.equal(h.human!.activity,'idle');assert.equal(h.human!.speed,undefined);assert.deepEqual(rt.violations,[]);
});
test('mid-run snapshot restores the same gait and continues deterministically',()=>{
  const {rt,base}=fixture();const a=rt.submit('walk_to',{actor:'h',x:20,z:0,gait:'run'});for(let i=0;i<100;i++)rt.step();const copy=Runtime.restore(JSON.parse(JSON.stringify(rt.snapshot())),registry(),{spatial:new Spatial(base)},DEFAULT_INVARIANTS);assert.equal(copy.stateHash(),rt.stateHash());
  for(let i=0;i<400&&rt.isActive(a.id);i++){rt.step();copy.step();assert.equal(copy.stateHash(),rt.stateHash());}assert.equal(a.status,'completed');assert.deepEqual(copy.violations,[]);
});
test('faster gait bounds still catch overspeed and teleport faults',()=>{
  const {rt}=fixture(),h=rt.world.entities.h;maxStepPerTick(rt);Object.assign(h.human!,{activity:'run',speed:4.3});h.pose.p[0]+=.4;rt.world.tick++;assert.equal(speedWithinCap(rt)[0]?.code,'motion.overspeed');assert.equal(maxStepPerTick(rt)[0]?.code,'motion.teleport');
});
