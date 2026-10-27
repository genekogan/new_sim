import test from 'node:test';
import assert from 'node:assert/strict';
import {WorldModel,CORE_KIT,applyBatch} from '../../packages/world-compiler/src/index.ts';
import {planFixture,approvedFixture,verifyFixture,assertFixturePreview,parseFixtureArgs,existingPhysicalProblems} from './fixtures.mjs';
function world(){const w=new WorldModel({constants:{ground:'land'},seed:'fixtures-test'});for(const d of CORE_KIT.filter(d=>['core-bench','core-pond'].includes(d.name)))w.defineDef(d,'core',0);return w;}
const snap=w=>({...structuredClone(w.snapshot()),worldId:'fixture-test'});
function apply(w,b){const p=applyBatch(w,b,'god',0,{trusted:true});assert.equal(p.result.accepted,true,JSON.stringify(p.result));return p;}
test('approved fixtures preserve the source, verify exact placement, and become no-ops',()=>{
 for(const key of ['mars-two','eden-2026']){
  const w=world(),before=snap(w),p=planFixture(before,key,'fixture-test');
  const fresh=planFixture(before,key,'fixture-test');assert.notEqual(p.planId,fresh.planId);assert.notEqual(p.batch.clientRef,fresh.batch.clientRef);
  apply(w,p.batch);const after=snap(w);assert.deepEqual(verifyFixture(before,after,p),[]);
  assert.equal(planFixture(after,key,'fixture-test').noop,true);
  assert.equal(before.entities.length,0,'prediction must not mutate preimage');
  const wrong=structuredClone(after);wrong.entities[0].p[1]+=1;assert.ok(verifyFixture(before,wrong,p).includes('exact fixture mismatch'));
  assert.throws(()=>planFixture(wrong,key,'fixture-test'),/existing fixture differs/);
 }
});
test('world and operation boundaries reject before planning',()=>{
 const s={worldId:'wrong'};Object.defineProperty(s,'entities',{get(){throw Error('must not inspect entities');}});
 assert.throws(()=>planFixture(s,'mars-two','fixture-test'),/wrong live world/);
 assert.throws(()=>planFixture(s,'mars-two'),/explicit expected/);
 assert.throws(()=>approvedFixture('hello-hamlet'),/only mars-two and eden-2026/);
 assert.throws(()=>parseFixtureArgs(['apply','mars-two','folder','receipt']),/expected-world-id/);
 assert.equal(parseFixtureArgs(['plan','mars-two','folder','receipt','--expected-world-id','fixture-test']).expectedWorldId,'fixture-test');
});
test('preview rejects repairs, extra operations, body movement, and warnings',()=>{
 const p=planFixture(snap(world()),'mars-two','fixture-test');
 const ok={accepted:true,id:'preview',expect:{},summary:p.predictedSummary};assert.doesNotThrow(()=>assertFixturePreview(ok,p));
 for(const changed of [{warnings:['repair']},{wouldMove:[{id:'soul'}]},{summary:{...p.predictedSummary,upserts:2}},{summary:{...p.predictedSummary,removes:1}},{summary:{...p.predictedSummary,defs:['unplanned@1']}},{summary:{...p.predictedSummary,world:['weather']}},{accepted:false}])assert.throws(()=>assertFixturePreview({...ok,...changed},p));
});
test('public counter normalization preserves existing entities instead of reusing their IDs',()=>{
 const w=world();apply(w,{ops:[{op:'place',def:'core/bench@1',name:'old-bench',p:[80,0,80]}]});
 const s=snap(w);s.contract='world/1';s.counter=s.seq;s.seq=0;delete s.editSeq;
 const p=planFixture(s,'mars-two','fixture-test');assert.equal(p.predictedSummary.upserts,1);
 const changed=structuredClone(s);changed.entities[0].p[0]++;assert.match(existingPhysicalProblems(s,changed)[0],/old-bench/);
 const missing=structuredClone(s);missing.entities=[];assert.equal(existingPhysicalProblems(s,missing).length,1);
});
test('unplanned entities and definition edits fail post-apply verification',()=>{
 const w=world(),before=snap(w),p=planFixture(before,'eden-2026','fixture-test');apply(w,p.batch);apply(w,{ops:[{op:'place',def:'core/bench@1',name:'unplanned',p:[80,0,80]}]});
 assert.ok(verifyFixture(before,snap(w),p).some(s=>s.includes('unplanned new entity')));
 const terrain=snap(w);terrain.ground.base+=1;assert.ok(verifyFixture(before,terrain,p).includes('unplanned ground change'));
 const after=snap(w);after.defs[0].description='edited';assert.ok(verifyFixture(before,after,p).includes('unplanned definition change'));
});
