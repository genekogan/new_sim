import test from 'node:test';
import assert from 'node:assert/strict';
import {marsFactory,EDEN_SAFE_COMMONS_WORLD} from './engine.ts';
const factory=await marsFactory({...EDEN_SAFE_COMMONS_WORLD,safeCrewRemoval:true});
async function blocked(){const e=factory.create(factory.genesis('quiet-landing-courtesy'));e.spawnHuman({id:'mover',label:'Synthetic native stair mover',soul:'fixture'});e.spawnHuman({id:'blocker',label:'Synthetic native idle landing occupant',soul:'fixture'});
 const b=e.perform({actor:'blocker',label:'ordinary landing arrival',steps:[{verb:'mars:walk_to',params:{x:9,z:-1.7,level:1}}]});assert.ok(b.ok);for(let i=0;i<600&&e.programOf('blocker');i++)e.step();assert.equal(e.programOf('blocker'),null);assert.equal(e.world.entities.blocker.human!.level,1);
 const p=e.perform({actor:'mover',label:'ordinary requested deck journey',steps:[{verb:'mars:walk_to',params:{x:9,z:-2.4,level:1}}]});assert.ok(p.ok);for(let i=0;i<600&&e.world.entities.mover.human!.activity!=='climb-wait';i++)e.step();assert.equal(e.world.entities.mover.human!.activity,'climb-wait');e.stop(p.id);return {e,p};}
test('existing quiet drain uses native courtesy for free idle landing occupant, safely drains stair and survives snapshot continuation',async()=>{
 const {e,p}=await blocked();e.beginQuiet!();const before=[...e.world.entities.blocker.pose.p];for(let i=0;i<30;i++)e.step();assert.deepEqual(e.world.entities.blocker.pose.p,before);assert.ok(e.runtime.liveIds().length,'default policy retains blocked cleanup');
 e.configureRuntimePolicy!({sleepBlockTicks:1200,quietLandingCourtesyV1:true});const snap=e.snapshot(),copy=factory.restore(snap);let moved=false,ended=false;
 for(let i=0;i<700&&!ended;i++){const out=e.step();copy.step();assert.equal(copy.stateHash(),e.stateHash());assert.deepEqual(e.runtime.violations,[]);moved ||= Math.hypot(e.world.entities.blocker.pose.p[0]-before[0],e.world.entities.blocker.pose.p[2]-before[2])>.2;ended=e.isQuiet!();}
 assert.ok(moved);assert.ok(ended);assert.equal(e.programOf('mover'),null);assert.equal(e.world.entities.mover.human!.level,1);assert.ok([...e.runtime.records.values()].some(r=>r.id.startsWith('blocker:make-way:')&&r.status==='completed'));assert.equal(factory.restore(e.snapshot()).stateHash(),e.stateHash());
});
test('idle landing courtesy never takes over a body with its own existing programme',async()=>{
 const {e}=await blocked();assert.ok(e.perform({actor:'blocker',label:'existing owned finite rest',steps:[{verb:'rest',params:{seconds:30}}]}).ok);e.configureRuntimePolicy!({sleepBlockTicks:1200,quietLandingCourtesyV1:true});e.beginQuiet!();const before=[...e.world.entities.blocker.pose.p];for(let i=0;i<80;i++)e.step();assert.deepEqual(e.world.entities.blocker.pose.p,before);assert.ok(e.programOf('blocker'));assert.ok(![...e.runtime.records.values()].some(r=>r.id.startsWith('blocker:make-way:')));assert.deepEqual(e.runtime.violations,[]);
});
