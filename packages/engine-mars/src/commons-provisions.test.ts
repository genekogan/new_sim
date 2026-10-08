import {nativeEntity} from './native-test-state.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {commonsProvisionsFactory} from './commons-provisions-engine.ts';
import {COMMONS_PERSONAL_RESOURCES} from './commons-provisions.ts';
import {marsFactory,EDEN_SAFE_COMMONS_WORLD} from './engine.ts';
const factory=await commonsProvisionsFactory();
test('retained dry world adds finite meals and ground mats; actual native take/eat/put and sleep survive exact snapshots',async()=>{
  const e=factory.create(factory.genesis('commons-provisions-proof'));e.spawnHuman({id:'h_A',label:'Synthetic native actor',soul:'s_A'});
  const original=structuredClone(e.world.entities.h_A),preview=e.previewCommonsProvisionsV1!();assert.ok(preview.ok);if(!preview.ok)return;e.adoptCommonsProvisionsV1!(preview.transition);
  assert.deepEqual(e.world.entities.h_A,original);assert.equal(COMMONS_PERSONAL_RESOURCES.filter(r=>nativeEntity(e,r.bowl).contents?.fraction===1).length,8);
  const r=COMMONS_PERSONAL_RESOURCES[0];
  let p=e.perform({actor:'h_A',label:'eat prepared meal',steps:[{verb:'mars:take_item',params:{item:r.bowl,hand:'left'}},{verb:'mars:take_item',params:{item:r.spoon,hand:'right'}},{verb:'mars:eat',params:{bowl:r.bowl,spoon:r.spoon}},{verb:'mars:put_item',params:{item:r.spoon,surfaceSlot:'ground'}},{verb:'mars:put_item',params:{item:r.bowl,surfaceSlot:'ground'}}]});assert.equal(p.ok,true,JSON.stringify(p));
  let terminal:any;
  for(let i=0;i<3000&&!terminal;i++){const out=e.step();terminal=out.programs.find(x=>x.id===p.id&&['completed','failed'].includes(x.kind));assert.deepEqual(e.runtime.violations,[]);}
  assert.equal(terminal?.kind,'completed',JSON.stringify(terminal));assert.equal(nativeEntity(e,r.bowl).contents!.fraction,0);assert.ok(!nativeEntity(e,'h_A').human!.grip);assert.equal(factory.restore(e.snapshot()).stateHash(),e.stateHash());
  p=e.perform({actor:'h_A',label:'ground sleep',steps:[{verb:'mars:sleep',params:{mat:r.mat,duration:2,returnTo:r.sleepReturn}}]});assert.equal(p.ok,true,JSON.stringify(p));terminal=undefined;let prone=false;
  for(let i=0;i<2500&&!terminal;i++){const out=e.step();if(nativeEntity(e,'h_A').human!.sleepPose)prone=true;terminal=out.programs.find(x=>x.id===p.id&&['completed','failed'].includes(x.kind));assert.deepEqual(e.runtime.violations,[]);}
  assert.equal(terminal?.kind,'completed',JSON.stringify(terminal));assert.ok(prone);assert.equal(factory.restore(e.snapshot()).stateHash(),e.stateHash());
  const old=await marsFactory({...EDEN_SAFE_COMMONS_WORLD,safeCrewRemoval:true});assert.equal(old.canReplayHistory!(e.rulesVersion),false);assert.throws(()=>old.restore(e.snapshot()),/reader-required/);
});
