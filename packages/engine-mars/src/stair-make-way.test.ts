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
