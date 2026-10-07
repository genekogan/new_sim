// Live 4970 deadlock (2026-10-07): a climber in climb-wait below an idle body at the deck stair head held
// programs.size > 0, so quiet renewal never compacted and every edge act waited for first light for hours.
import test from 'node:test';
import assert from 'node:assert/strict';
import {marsFactory,EDEN_SAFE_COMMONS_WORLD} from './engine.ts';
const factory=await marsFactory({...EDEN_SAFE_COMMONS_WORLD,safeCrewRemoval:true});
async function held(){const e=factory.create(factory.genesis('stair-make-way'));e.spawnHuman({id:'mover',label:'Synthetic stair climber',soul:'fixture'});e.spawnHuman({id:'blocker',label:'Synthetic idle stair-head occupant',soul:'fixture'});
 const b=e.perform({actor:'blocker',label:'ordinary landing arrival',steps:[{verb:'mars:walk_to',params:{x:9,z:-1.7,level:1}}]});assert.ok(b.ok);for(let i=0;i<600&&e.programOf('blocker');i++)e.step();assert.equal(e.programOf('blocker'),null);
 const p=e.perform({actor:'mover',label:'deck journey (not stopped)',steps:[{verb:'mars:walk_to',params:{x:9,z:-2.4,level:1}}]});assert.ok(p.ok);for(let i=0;i<600&&e.world.entities.mover.human!.activity!=='climb-wait';i++)e.step();assert.equal(e.world.entities.mover.human!.activity,'climb-wait');return e;}
test('without stairMakeWayV1 an idle stair-head body holds the climber and the quiet barrier',async()=>{
 const e=await held();e.beginQuiet!();for(let i=0;i<800;i++)e.step();assert.ok(e.programOf('mover'),'still held');assert.equal(e.isQuiet!(),false);
});
test('stairMakeWayV1: the idle body steps aside natively, the climber lands, quiet completes, snapshot continuation agrees',async()=>{
 const e=await held();e.configureRuntimePolicy!({sleepBlockTicks:1200,stairMakeWayV1:true} as any);e.beginQuiet!();const copy=factory.restore(e.snapshot());let quiet=false;
 for(let i=0;i<1500&&!quiet;i++){e.step();copy.step();assert.equal(copy.stateHash(),e.stateHash());quiet=e.isQuiet!();}
 assert.ok(quiet,'quiet barrier reached');assert.equal(e.world.entities.mover.human!.level,1);assert.equal(e.world.entities.blocker.human!.level,1,'blocker stepped, never dropped');
 assert.ok([...e.runtime.records.values()].some(r=>r.id.startsWith('blocker:make-way:')));assert.deepEqual(e.runtime.violations,[]);
});
test('stairMakeWayV1 outside quiet: the climber still arrives; a blocker with its own programme is never moved',async()=>{
 const e=await held();e.configureRuntimePolicy!({sleepBlockTicks:1200,stairMakeWayV1:true} as any);for(let i=0;i<1500&&e.programOf('mover');i++)e.step();assert.equal(e.programOf('mover'),null);assert.equal(e.world.entities.mover.human!.level,1);
 const f=await held();assert.ok(f.perform({actor:'blocker',label:'owned finite rest',steps:[{verb:'rest',params:{seconds:30}}]}).ok);f.configureRuntimePolicy!({sleepBlockTicks:1200,stairMakeWayV1:true} as any);
 for(let i=0;i<300;i++)f.step();assert.ok(f.programOf('blocker'),'its own programme keeps the body');assert.ok(![...f.runtime.records.values()].some(r=>r.id.startsWith('blocker:make-way:')));
});
test('stairMakeWayV1 also frees a climber whose programme was already stopped and is cancelling up to the landing (live shape)',async()=>{
 {const c=await held();c.stop(c.programOf('mover')!);c.beginQuiet!();for(let i=0;i<1500;i++)c.step();assert.equal(c.isQuiet!(),false,'control: stuck without the fact');}
 const e=await held();e.stop(e.programOf('mover')!);for(let i=0;i<5;i++)e.step();assert.equal(e.world.entities.mover.human!.activity,'climb-wait','still on the flight after stop');
 e.configureRuntimePolicy!({sleepBlockTicks:1200,stairMakeWayV1:true} as any);e.beginQuiet!();const copy=factory.restore(e.snapshot());let quiet=false;
 for(let i=0;i<1500&&!quiet;i++){e.step();copy.step();assert.equal(copy.stateHash(),e.stateHash());quiet=e.isQuiet!();}
 assert.ok(quiet,'quiet barrier reached');assert.equal(e.programOf('mover'),null);assert.ok([1,0].includes(e.world.entities.mover.human!.level!));assert.notEqual(e.world.entities.mover.human!.activity,'climb-wait');assert.deepEqual(e.runtime.violations,[]);
});
test('stairMakeWayV1 full landing (live crowd): no one can step aside, so the stopped climber retreats to the entry landing and quiet completes',async()=>{
 const run=async(policy:boolean)=>{const e=factory.create(factory.genesis('stair-full-landing'));
  for(const [id,x,z] of [['b2',10.04,-1.2],['b3',8.69,-1.71]] as [string,number,number][]){e.spawnHuman({id,label:'Synthetic idle deck occupant',soul:'fixture'});assert.ok(e.perform({actor:id,label:'deck arrival',steps:[{verb:'mars:walk_to',params:{x,z,level:1}}]}).ok);for(let i=0;i<900&&e.programOf(id);i++)e.step();assert.equal(e.world.entities[id].human!.level,1);}
  e.spawnHuman({id:'mover',label:'Synthetic stair climber',soul:'fixture'});assert.ok(e.perform({actor:'mover',label:'deck journey',steps:[{verb:'mars:walk_to',params:{x:9.16,z:-1.4,level:1}}]}).ok);
  for(let i=0;i<900&&e.world.entities.mover.human!.activity!=='climb-wait';i++)e.step();for(let i=0;i<300;i++)e.step();assert.equal(e.world.entities.mover.human!.activity,'climb-wait','stalled at the full stair head');
  e.stop(e.programOf('mover')!);if(policy)e.configureRuntimePolicy!({sleepBlockTicks:1200,stairMakeWayV1:true} as any);e.beginQuiet!();const copy=factory.restore(e.snapshot());let quiet=false;
  for(let i=0;i<2400&&!quiet;i++){e.step();copy.step();assert.equal(copy.stateHash(),e.stateHash());quiet=e.isQuiet!();}
  return {quiet,act:e.world.entities.mover.human!.activity,level:e.world.entities.mover.human!.level,violations:e.runtime.violations,deck:['b2','b3'].map(id=>e.world.entities[id].human!.level)};};
 const off=await run(false),on=await run(true);
 assert.equal(off.quiet,false,'control stuck');assert.equal(on.quiet,true,'quiet completes');assert.notEqual(on.act,'climb-wait');assert.deepEqual(on.deck,[1,1],'deck occupants never dropped');assert.deepEqual(on.violations,[]);
});
test('reflexTimeoutV1: outside quiet, a climb stalled at a full stair head is natively cancelled and the body gets free (control: programme ends but the body stays held forever)',async()=>{
 const run=async(policy:boolean)=>{const e=factory.create(factory.genesis('reflex-timeout'));
  for(const [id,x,z] of [['b2',10.04,-1.2],['b3',8.69,-1.71]] as [string,number,number][]){e.spawnHuman({id,label:'Synthetic idle deck occupant',soul:'fixture'});assert.ok(e.perform({actor:id,label:'deck arrival',steps:[{verb:'mars:walk_to',params:{x,z,level:1}}]}).ok);for(let i=0;i<900&&e.programOf(id);i++)e.step();}
  e.spawnHuman({id:'mover',label:'Synthetic stair climber',soul:'fixture'});if(policy)e.configureRuntimePolicy!({sleepBlockTicks:1200,stairMakeWayV1:true,reflexTimeoutV1:true} as any);
  const p=e.perform({actor:'mover',label:'deck journey',steps:[{verb:'mars:walk_to',params:{x:9.16,z:-1.4,level:1}}]});assert.ok(p.ok);
  const copy=factory.restore(e.snapshot());let ended:string|null=null;
  for(let i=0;i<3600&&!ended;i++){const out=e.step();copy.step();assert.equal(copy.stateHash(),e.stateHash());if(!e.programOf('mover'))ended='ended';}
  for(let i=0;i<2400&&e.world.entities.mover.human!.activity==='climb-wait';i++){e.step();copy.step();}
  return {ended,act:e.world.entities.mover.human!.activity,live:e.runtime.liveIds().length,violations:e.runtime.violations};};
 const off=await run(false),on=await run(true);
 assert.equal(off.act,'climb-wait','control: the body stays held on the flight with an orphaned live walk');assert.equal(off.live,1);
 assert.equal(on.ended,'ended');assert.notEqual(on.act,'climb-wait');assert.equal(on.live,0,'nothing left holding the body');assert.deepEqual(on.violations,[]);
});
