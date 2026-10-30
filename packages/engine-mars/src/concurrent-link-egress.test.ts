import test from 'node:test';
import assert from 'node:assert/strict';
import {marsFactory,GREEN_FIELD_WORLD,type MarsEngine} from './engine.ts';
import {nextEntityPhysics,type WorldEditV1} from './entity-physics.ts';
import {bodySpatial} from '../../../mars/viewer/engine/bodies/navigation.ts';
import {DT} from '../../../mars/viewer/engine/runtime/runtime.ts';
import {groundFact} from './ground-bridge.ts';
import {emptyGround} from '../../ground/src/index.ts';

const factory=await marsFactory(GREEN_FIELD_WORLD);
const A='h_upper000',C='h_lower000';
const goalA={x:-2,z:4,level:0},goalC={x:2,z:4,level:0};
function use(e:MarsEngine,actor:string,goal:{x:number;z:number;level:number}){
 const result=e.perform({actor,label:'concurrent landing egress',steps:[{verb:'mars:walk_to',params:goal}]});assert.equal(result.ok,true,JSON.stringify(result));return result.id;
}
function until(e:MarsEngine,done:()=>boolean,limit=900){for(let i=0;i<limit;i++){e.step();if(done())return i+1;}assert.fail('native condition not reached within '+limit+' ticks');}
function exOf(e:MarsEngine,actor:string):any{return [...(e as any).rt.services.walkExecs.values()].find((ex:any)=>ex.actor===actor);}
function physical(e:MarsEngine,before?:Map<string,number[]>,ids:readonly string[]=[A,C]){
 const rt=(e as any).rt;
 for(const actor of ids){
  const b=e.world.entities[actor],ex=exOf(e,actor),leg=ex?.route.legs[ex.leg];
  if(leg?.kind==='link'&&ex.phase==='climb'){
   const points=[[leg.link.from.p[0],leg.link.from.y,leg.link.from.p[1]],...leg.link.path,[leg.link.to.p[0],leg.link.to.y,leg.link.to.p[1]]];
   const distance=(p:number[],a:number[],b:number[])=>{const d=b.map((v,i)=>v-a[i]),n=d.reduce((s,v)=>s+v*v,0),t=n?Math.max(0,Math.min(1,d.reduce((s,v,i)=>s+v*(p[i]-a[i]),0)/n)):0;return Math.hypot(...p.map((v,i)=>v-a[i]-t*d[i]));};
   assert.ok(points.slice(1).some((p:number[],i:number)=>distance(b.pose.p,points[i],p)<1e-6),'climber remains on authored link geometry');
  }else{
   const sp=bodySpatial(rt,actor),p:[number,number]=[b.pose.p[0],b.pose.p[2]],floor=sp.levelAt(b.human!.level,p),y=b.human!.level===0&&sp.ground?sp.ground.standY(...p):floor?.y;
   assert.ok(floor&&y!==undefined&&Math.abs(y-b.pose.p[1])<.031,'ordinary walk remains on actual floor support');
  }
  if(before){const old=before.get(actor)!;assert.ok(Math.hypot(...b.pose.p.map((v,i)=>v-old[i]))<=1.4*DT+.005,'no teleport or added movement budget');}
 }
 const a=e.world.entities[ids[0]].pose.p,c=e.world.entities[ids[1]].pose.p;
 assert.ok(Math.hypot(a[0]-c[0],(a[1]-c[1])*.5,a[2]-c[2])>=.54-1e-7,'native stair separation remains intact');
 assert.deepEqual(e.runtime.violations,[]);
}
function stepPhysical(e:MarsEngine,ids:readonly string[]=[A,C]){const before=new Map(ids.map(id=>[id,[...e.world.entities[id].pose.p]]));e.step();physical(e,before,ids);}
function fixture(enabled=false,ids:readonly string[]=[A,C],reverseSetup=false,halfX=1.725,upperX=-1.1,crowd=false){
 const e=factory.create(factory.genesis('concurrent-link-egress')) as MarsEngine;
 const edit:WorldEditV1={contract:'world-edit/1',seq:1,hash:'',levels:[{id:1,y:.381,label:'intermediate landing'}],set:{
  landing:{surfaces:[{id:'landing-floor',level:1,y:.381,obb:{c:[0,0],half:[halfX,.55],yaw:0}}]},
  stair:{links:[{id:'descending-flight',kind:'stairs',from:{level:0,p:[0,1.5],y:0},to:{level:1,p:[0,0],y:.381},width:.68,heading:-Math.PI/2,path:[[0,0,1.5],[0,.127,1],[0,.254,.5],[0,.381,0]],usable:true}]},
 }};edit.hash=nextEntityPhysics(undefined,edit).hash;e.applyWorldEditV1(edit);
 e.configureRuntimePolicy({sleepBlockTicks:1200,occupiedLinkRoutingV1:true,...(enabled?{concurrentLinkEgressV1:true}:{})});
 if(crowd){
  const actor='h_pocket000';e.spawnHuman({id:actor,soul:'s_'+actor,label:actor,near:{at:[-2,3],first:true}});use(e,actor,{x:1.2,z:0,level:1});until(e,()=>e.programOf(actor)===null);assert.equal(e.world.entities[actor].human!.level,1);
 }
 const placement=[[ids[0],{x:upperX,z:0,level:1}],[ids[1],{x:.5,z:.22,level:1}]] as const;
 for(const [actor]of reverseSetup?[...placement].reverse():placement)e.spawnHuman({id:actor,soul:'s_'+actor,label:actor,near:{at:[-2,3],first:true}});
 for(const [actor,point]of placement){
  use(e,actor,point);until(e,()=>e.programOf(actor)===null);assert.equal(e.world.entities[actor].human!.level,point.level);
  assert.ok(Math.hypot(e.world.entities[actor].pose.p[0]-point.x,e.world.entities[actor].pose.p[2]-point.z)<.1,'fixture bodies reached their native starting goals');
 }
 return e;
}
function conflictingWalks(e:MarsEngine){
 use(e,A,goalA);
 until(e,()=>exOf(e,A)?.phase==='climb');
 use(e,C,goalC);
}
function resizeLanding(e:MarsEngine,halfX:number){
 const edit:WorldEditV1={contract:'world-edit/1',seq:2,hash:'',levels:[{id:1,y:.381,label:'intermediate landing'}],set:{landing:{surfaces:[{id:'landing-floor',level:1,y:.381,obb:{c:[0,0],half:[halfX,.55],yaw:0}}]}}};
 edit.hash=nextEntityPhysics(e.world.entityPhysicsV1,edit).hash;e.applyWorldEditV1(edit);
}

test('default policy reproduces a climber/person versus landing/passage cycle',()=>{
 const e=fixture();conflictingWalks(e);
 until(e,()=>[...e.runtime.records.values()].some((r:any)=>r.diagnostic?.code==='deadlock.cycle'),500);
 const a=exOf(e,A),c=exOf(e,C);assert.equal(a.phase,'climb');assert.equal(c.phase,'walk');assert.equal(e.world.entities[A].human!.activity,'climb-wait');assert.equal(e.world.entities[C].human!.activity,'wait');
 const cycle=[...e.runtime.records.values()].find((r:any)=>r.diagnostic?.code==='deadlock.cycle')!.diagnostic as any;
 assert.ok(cycle.details.movers.some((m:any)=>m.mover===A&&m.code==='traffic.person'&&m.blockedBy.includes(C)));
 assert.ok(cycle.details.movers.some((m:any)=>m.mover===C&&m.code==='traffic.yield'&&m.blockedBy.includes(A)));
 physical(e);
});

test('a native supported side pocket exists before adding automatic courtesy',()=>{
 const e=fixture();conflictingWalks(e);until(e,()=>e.world.entities[A].human!.activity==='climb-wait');
 // This isolated physical probe deliberately replaces C's request only to prove
 // the candidate pocket is reachable. The automatic repair must retain its goal.
 use(e,C,{x:1.2,z:0,level:1});
 for(let i=0;i<900&&e.programOf(C)!==null;i++)stepPhysical(e);
 assert.equal(e.programOf(C),null);assert.equal(e.world.entities[C].human!.level,1);assert.ok(e.world.entities[C].pose.p[0]>1.1);
 for(let i=0;i<900&&e.programOf(A)!==null;i++)stepPhysical(e);
 assert.equal(e.programOf(A),null);assert.equal(e.world.entities[A].human!.level,0);
});

test('opt-in landing courtesy preserves both original goals and reaches them physically',()=>{
 const e=fixture(true);conflictingWalks(e);let courtesy=false;
 for(let i=0;i<1500&&(e.programOf(A)!==null||e.programOf(C)!==null);i++){
  stepPhysical(e);const c=exOf(e,C);if(c?.detour){courtesy=true;assert.deepEqual(c.goal,{level:goalC.level,p:[goalC.x,goalC.z]});}
 }
 assert.ok(courtesy,'a real short courtesy detour is used');
 assert.equal(e.programOf(A),null,JSON.stringify(exOf(e,A)));assert.equal(e.programOf(C),null,JSON.stringify(exOf(e,C)));
 for(const [actor,goal]of [[A,goalA],[C,goalC]] as const){assert.equal(e.world.entities[actor].human!.level,0);assert.ok(Math.hypot(e.world.entities[actor].pose.p[0]-goal.x,e.world.entities[actor].pose.p[2]-goal.z)<.1);}
});

function finishBoth(e:MarsEngine,ids:readonly string[]=[A,C]){
 for(let i=0;i<1500&&ids.some(id=>e.programOf(id)!==null);i++)stepPhysical(e,ids);
 for(const [index,actor]of ids.entries()){
  const goal=index===0?goalA:goalC;assert.equal(e.programOf(actor),null,JSON.stringify(exOf(e,actor)));
  assert.equal(e.world.entities[actor].human!.level,0);assert.ok(Math.hypot(e.world.entities[actor].pose.p[0]-goal.x,e.world.entities[actor].pose.p[2]-goal.z)<.1);
 }
}

function finishLockstep(e:MarsEngine,copy:MarsEngine){
 assert.equal(copy.stateHash(),e.stateHash());
 for(let i=0;i<1500&&[A,C].some(id=>e.programOf(id)!==null||copy.programOf(id)!==null);i++){
  stepPhysical(e);stepPhysical(copy);
  assert.equal(copy.stateHash(),e.stateHash(),'restored state hash at continuation tick '+(i+1));
  assert.deepEqual([...copy.runtime.records],[...e.runtime.records],'restored native records at continuation tick '+(i+1));
  for(const id of [A,C])assert.deepEqual(copy.world.entities[id].pose,e.world.entities[id].pose,'restored pose at continuation tick '+(i+1));
 }
 for(const id of [A,C]){assert.equal(e.programOf(id),null);assert.equal(copy.programOf(id),null);}
}

test('reversed identities and actor insertion retain physical arrival',()=>{
 const ids=[C,A],e=fixture(true,ids,true);use(e,ids[0],goalA);until(e,()=>exOf(e,ids[0])?.phase==='climb');use(e,ids[1],goalC);
 let detoured=false;for(let i=0;i<100&&!detoured;i++){stepPhysical(e,ids);detoured=!!exOf(e,ids[1])?.detour;}
 assert.ok(detoured);finishBoth(e,ids);
});

test('reversed goal submission still reaches both original goals',()=>{
 const e=fixture(true);use(e,C,goalC);use(e,A,goalA);finishBoth(e);
});

test('snapshot during the supported courtesy resumes both retained goals',()=>{
 const e=fixture(true);conflictingWalks(e);until(e,()=>exOf(e,C)?.detour?.stage==='going');
 const copy=factory.restore(e.snapshot()) as MarsEngine;
 assert.equal(exOf(copy,C)?.detour?.egress,true);assert.deepEqual(exOf(copy,C)?.goal,{level:0,p:[goalC.x,goalC.z]});
 finishLockstep(e,copy);
 assert.deepEqual(copy.world.entities[A].pose,e.world.entities[A].pose);assert.deepEqual(copy.world.entities[C].pose,e.world.entities[C].pose);
});

test('failed courtesy search is bounded per geometry epoch across snapshot',()=>{
 const e=fixture(true),count={value:0};
 const denyPocket=(engine:MarsEngine)=>{const sp=bodySpatial((engine as any).rt,C),original=sp.routeAround;sp.routeAround=function(world:any,profile:any,from:any,to:any,around:any){if(to.level===1){count.value++;return {ok:false,reason:'no-route'} as any;}return original.call(this,world,profile,from,to,around);};};
 denyPocket(e);conflictingWalks(e);until(e,()=>!!exOf(e,A)?.linkYield);
 assert.equal(count.value,1);const attempt=structuredClone(exOf(e,A).linkYield);
 for(let i=0;i<100;i++)stepPhysical(e);assert.equal(count.value,1);assert.deepEqual(exOf(e,A).linkYield,attempt);assert.equal(exOf(e,C).detour,undefined);
 const copy=factory.restore(e.snapshot()) as MarsEngine;denyPocket(copy);
 const budget=structuredClone((copy as any).rt.services.replanBudget);
 // Cache reconstruction alone must neither repeat a search nor spend the
 // shared per-tick planning budget. The exact failed episode survives.
 for(let i=0;i<100;i++){stepPhysical(e);stepPhysical(copy);assert.equal(copy.stateHash(),e.stateHash());assert.deepEqual([...copy.runtime.records],[...e.runtime.records]);}
 assert.equal(count.value,1);assert.deepEqual(exOf(copy,A).linkYield,attempt);assert.deepEqual((copy as any).rt.services.replanBudget,budget);
 for(let i=0;i<100;i++)stepPhysical(copy);assert.equal(count.value,1);assert.deepEqual(exOf(copy,A).linkYield,attempt);
});

test('old person budget is reset only after actual supported courtesy progress',()=>{
 const e=fixture(true);conflictingWalks(e);until(e,()=>exOf(e,C)?.detour?.stage==='going');
 const c=exOf(e,C),start=[...e.world.entities[C].pose.p];c.peopleReplans=6;
 let resumed=false;for(let i=0;i<200&&!resumed;i++){
  stepPhysical(e);const current=exOf(e,C);if(current.detour)assert.equal(current.peopleReplans,6);else {resumed=true;assert.equal(current.peopleReplans,0);}
 }
 assert.ok(resumed);assert.ok(Math.hypot(...e.world.entities[C].pose.p.map((v,i)=>v-start[i]))>.1);finishBoth(e);
});


test('no supported side pocket stays blocked without repeated searches or body projection',()=>{
 const e=fixture(true,[A,C],false,.975,-.6);conflictingWalks(e);until(e,()=>!!exOf(e,A)?.linkYield);
 const attempt=structuredClone(exOf(e,A).linkYield),before=new Map([A,C].map(id=>[id,[...e.world.entities[id].pose.p]]));
 for(let i=0;i<150;i++)stepPhysical(e);
 assert.equal(exOf(e,C).detour,undefined);assert.deepEqual(exOf(e,A).linkYield,attempt);
 // The original climber may advance a few centimetres before the native
 // person-stop settles. Every actual step was still checked above.
 for(const id of [A,C])assert.ok(Math.hypot(...e.world.entities[id].pose.p.map((v,i)=>v-before.get(id)![i]))<.1);
 assert.notEqual(e.programOf(A),null);assert.notEqual(e.programOf(C),null);
});


test('reversed native stepping order snapshots a pending courtesy and resumes safely',()=>{
 const e=fixture(true);conflictingWalks(e);until(e,()=>!!exOf(e,C));
 // Exercise the other legal action ordering without changing a body, request,
 // route, wait edge or admission. The blocked landing walker now steps first.
 const live=(e as any).rt.live,entries=[...live.entries()];live.clear();for(const [id,action]of entries.reverse())live.set(id,action);
 until(e,()=>[A,C].some(id=>exOf(e,id)?.detour?.egress&&exOf(e,id)?.detour?.stage==='pending'));
 const pending=[A,C].find(id=>exOf(e,id)?.detour?.stage==='pending')!;
 assert.equal(exOf(e,pending).detour.egress,true);assert.ok(exOf(e,pending).detour.planned);
 const copy=factory.restore(e.snapshot()) as MarsEngine;finishLockstep(e,copy);
});


test('a nearby body leaving a pocket admits one new search without periodic retries',()=>{
 const e=fixture(true,[A,C],false,1.725,-1.1,true);conflictingWalks(e);until(e,()=>!!exOf(e,A)?.linkYield);
 const attempt=structuredClone(exOf(e,A).linkYield);assert.ok(attempt.nearby.h_pocket000);
 for(let i=0;i<40;i++)stepPhysical(e);assert.equal(exOf(e,C).detour,undefined);assert.deepEqual(exOf(e,A).linkYield,attempt);
 e.removeEntity('h_pocket000');until(e,()=>!!exOf(e,C)?.detour?.egress);
 assert.equal(exOf(e,A).linkYield.epoch,attempt.epoch,'human departure changes occupancy, not static geometry');assert.deepEqual(exOf(e,A).linkYield.nearby,{});finishBoth(e);
});

test('a real landing edit invalidates the cached failed-search episode',()=>{
 const e=fixture(true);let searches=0;
 const sp=bodySpatial((e as any).rt,C),original=sp.routeAround;
 sp.routeAround=function(world:any,profile:any,from:any,to:any,around:any){if(to.level===1){searches++;return {ok:false,reason:'no-route'} as any;}return original.call(this,world,profile,from,to,around);};
 conflictingWalks(e);until(e,()=>!!exOf(e,A)?.linkYield);const attempt=structuredClone(exOf(e,A).linkYield);
 for(let i=0;i<20;i++)stepPhysical(e);assert.equal(searches,1);
 resizeLanding(e,1.8);until(e,()=>searches===2);assert.notEqual(exOf(e,A).linkYield.epoch,attempt.epoch);
 for(let i=0;i<20;i++)stepPhysical(e);assert.equal(searches,2);
});

test('a real landing edit discards a pending route into removed support',()=>{
 const e=fixture(true);conflictingWalks(e);until(e,()=>!!exOf(e,C));
 const live=(e as any).rt.live,entries=[...live.entries()];live.clear();for(const [id,action]of entries.reverse())live.set(id,action);
 until(e,()=>exOf(e,C)?.detour?.stage==='pending');
 const planned=exOf(e,C).detour.planned,spot=exOf(e,C).detour.spot;
 assert.ok(Math.abs(spot[0])>.7,'courtesy target uses the outer pocket');
 resizeLanding(e,.975);const sp=bodySpatial((e as any).rt,C);sp.sync(e.world);
 assert.notEqual(sp.epoch,planned.epoch);
 stepPhysical(e);assert.notEqual(exOf(e,C).route,planned.route,'invalidated cached route was not installed');
 for(let i=0;i<40;i++)stepPhysical(e);
});

test('paged-ground attachment preserves the saved namespace before overlay reconstruction',()=>{
 const e=fixture(true);e.installGroundV1(groundFact(emptyGround(128),1,{paged:true}));
 const epoch=e.navEpochV1(),copy=factory.restore(e.snapshot()) as MarsEngine;
 assert.equal(copy.navEpochV1(),epoch,'ground attachment and overlay rebuild retain the saved namespace');
 for(let i=0;i<20;i++){e.step();copy.step();assert.equal(copy.stateHash(),e.stateHash());assert.deepEqual([...copy.runtime.records],[...e.runtime.records]);}
 resizeLanding(copy,1.8);assert.ok(copy.navEpochV1()>epoch,'a later real edit still advances the epoch');
});
