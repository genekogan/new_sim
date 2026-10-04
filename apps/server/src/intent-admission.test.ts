import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { toyFactory } from '@sim/engine-toy';
import { marsFactory } from '@sim/engine-mars';
import type { Engine, EngineFactory } from '@sim/engine-contract';
import { INTENT_V2, intentAdmissionPayloadV2Schema, intentAdmissionFactV2, publicEvent, type DecisionPayload } from '@sim/protocol';
import { Db } from './db.ts';
import { WorldHost, StaleIntentAttempt, UnrecordedIntentAdmission } from './world.ts';
import { IntentPublisher } from './intent-publisher.ts';
import { IntentRequests, type IntentRequestScope } from './intent-requests.ts';

const native=await marsFactory({scene:'eden-camp',arrival:[16,-10],arrivalPlace:'bunkhouse',reference:[16,-9],grounds:{id:'grounds',name:'grounds'}});
async function accept<T>(host:WorldHost,promise:Promise<T>){host.drainInputs();return promise;}
async function fixture(t:TestContext,factory:EngineFactory=native,durable=false){
  const dir=durable?mkdtempSync(join(tmpdir(),'core-admission-')):null,path=dir?join(dir,'world.db'):':memory:';
  const db=new Db(path);t.after(()=>{db.close();if(dir)rmSync(dir,{recursive:true,force:true});});
  db.upsertUser({id:'owner',role:'user',email:null,wallet:null});db.setInvited('owner','fixture');
  const host=new WorldHost(db,factory,'admission-fixture',1e9,'admission-world');host.boot();
  db.createSoul({id:'s_A',entityId:'h_A',worldId:host.worldId,owner:'owner',name:'Alice',description:'fixture',native:false});
  await accept(host,host.enqueue('birth','fixture',{soulId:'s_A',entityId:'h_A',owner:'owner',name:'Alice',description:'fixture'}));
  const scope:IntentRequestScope={worldId:host.worldId,soulId:'s_A',source:{kind:'owner',ownerId:'owner',principalId:'PRIVATE_PRINCIPAL',channel:'web'},currentAuthority:()=>true};
  const store=new IntentRequests(db),publisher=new IntentPublisher(host,store);
  const request=await accept(host,publisher.receive(scope,{contract:INTENT_V2,op:'upsert',requestId:'purpose',words:'PRIVATE_WORDS go to the campfire'}));assert.ok(request.reservation.created);
  const result=await accept(host,publisher.publish(scope,request.reservation,{summary:'PRIVATE_MEANING Walk to the fire.',agenda:[{card:'go to',target:'campfire'}],trigger:{kind:'now'}}));
  assert.equal(result.receipt?.phase,'understood');const revision=result.receipt!.phase==='understood'?result.receipt.revision:null;assert.ok(revision);
  const ref={intentId:revision.intentId,version:revision.version};
  const decision:DecisionPayload={soulId:'s_A',entityId:'h_A',option:'go:campfire',label:'go to campfire',steps:[{verb:'walk_to',params:{to:'campfire',standoff:1.5}}],card:'go to',target:'campfire',approachLen:1,reevalTicks:1e9,fallback:false,trigger:'new-intent-v2'};
  return {db,host,scope,publisher,store,ref,decision,path,factory};
}

test('native admission is explicitly associated, private, and unchanged by model-free log and snapshot readers',async t=>{
  const f=await fixture(t);
  const decision=await accept(f.host,f.host.enqueueIntentDecision('brain:reflex',f.decision,f.ref,()=>true));
  const e=f.db.events(f.host.worldId).find(e=>e.kind==='intent-admission-v2');assert.ok(e);
  const out=intentAdmissionFactV2(e).outcome;assert.equal(out.phase,'accepted');
  assert.equal(out.evidence.seq,decision.seq);assert.equal(out.evidence.tick,decision.tick);assert.deepEqual(out.intent,f.ref);
  assert.equal(out.activityId,f.host.engine.programOf('h_A'));assert.equal(f.host.engine.world.tick,0,'no engine tick was needed to report admission');
  assert.equal(f.host.intentHistoryOf('s_A').intents[f.ref.intentId].status,'active');
  const publicText=JSON.stringify(f.db.events(f.host.worldId).map(publicEvent));
  for(const marker of ['PRIVATE_WORDS','PRIVATE_MEANING','PRIVATE_PRINCIPAL',f.ref.intentId,out.attemptId])assert.ok(!publicText.includes(marker),marker);
  assert.ok(!JSON.stringify(f.host.kernelView()).includes(f.ref.intentId));
  const expected=f.host.intentHistoryOf('s_A'),hash=f.host.engine.stateHash();
  const replay=new WorldHost(f.db,f.factory,'admission-fixture',1e9,f.host.worldId);assert.equal(replay.boot().from,'genesis');
  assert.deepEqual(replay.intentHistoryOf('s_A'),expected);assert.equal(replay.engine.stateHash(),hash);
  replay.saveSnapshot(true);const restarted=new WorldHost(f.db,f.factory,'admission-fixture',1e9,f.host.worldId);assert.equal(restarted.boot().from,'snapshot');
  assert.deepEqual(restarted.intentHistoryOf('s_A'),expected);assert.equal(restarted.engine.stateHash(),hash);assert.equal(f.db.paidCost(),0);
});

test('a real native refusal records blocked admission, never accepted or started',async t=>{
  const f=await fixture(t);f.decision.steps=[{verb:'walk_to',params:{to:[400,400]}}];
  const decision=await accept(f.host,f.host.enqueueIntentDecision('brain:reflex',f.decision,f.ref,()=>true));
  const e=f.db.events(f.host.worldId).find(e=>e.kind==='intent-admission-v2');assert.ok(e);
  const out=intentAdmissionFactV2(e).outcome;assert.equal(out.phase,'blocked');assert.equal(out.evidence.seq,decision.seq);
  assert.ok(out.phase==='blocked' && out.reason.length);assert.equal(f.host.engine.programOf('h_A'),null);
  assert.equal(f.host.intentHistoryOf('s_A').intents[f.ref.intentId].status,'active');assert.deepEqual(f.host.engine.runtime.violations,[]);
});

test('later withdrawal, owner change and legacy will each prevent a prepared purpose attempt before logging',async t=>{
  for(const change of ['withdraw','owner','legacy'] as const)await t.test(change,async child=>{
    const f=await fixture(child);let changeAccepted:Promise<unknown>|undefined;
    if(change==='withdraw'){
      const r=await accept(f.host,f.publisher.receive(f.scope,{contract:INTENT_V2,requestId:'withdraw',op:'withdraw',edit:{intentId:f.ref.intentId,expectedVersion:f.ref.version}}));assert.ok(r.reservation.created);
      changeAccepted=f.publisher.publish(f.scope,r.reservation);
    }else if(change==='legacy'){
      changeAccepted=f.host.enqueue('intent','fixture',{soulId:'s_A',intent:{agenda:[{card:'rest',target:null}],text:'rest here'},source:'web'});
    }else if(change==='owner')f.db.db.prepare('UPDATE souls SET owner=? WHERE id=?').run('other','s_A');
    const queued=f.host.enqueueIntentDecision('brain:reflex',f.decision,f.ref,()=>true);
    const rejected=assert.rejects(queued,StaleIntentAttempt);f.host.drainInputs();await rejected;
    if(changeAccepted)await changeAccepted;
    assert.equal(f.db.events(f.host.worldId).filter(e=>e.kind==='decision'||e.kind==='intent-admission-v2').length,0);assert.equal(f.host.engine.programOf('h_A'),null);
  });
});

test('private admission origins and progress claims cannot be supplied in its strict payload',()=>{
  const p={contract:INTENT_V2,worldId:'w',soulId:'s',intent:{intentId:'i',version:1},attemptId:'a',activityId:'p1',decision:{seq:1,tick:0,entityId:'h'},phase:'accepted'};
  assert.ok(intentAdmissionPayloadV2Schema.safeParse(p).success);
  for(const field of [{seq:2},{tick:0},{evidence:{seq:1,tick:0,kind:'controller'}},{phase:'started'},{phase:'completed'},{source:{ownerId:'other'}}])assert.ok(!intentAdmissionPayloadV2Schema.safeParse({...p,...field}).success);
  assert.throws(()=>intentAdmissionFactV2({kind:'intent-admission-v2',seq:1,tick:0,payload:p}),/must follow/);
  assert.throws(()=>intentAdmissionFactV2({kind:'intent-admission-v2',seq:2,tick:0,payload:{...p,decision:{seq:1,tick:2,entityId:'h'}}}),/future/);
});

test('an admission write failure reports accepted decision uncertainty and does not undo or reissue its actual native program',async t=>{
  const f=await fixture(t),append=f.db.appendEvent.bind(f.db);
  f.db.appendEvent=(world,event)=>{if(event.kind==='intent-admission-v2')throw new Error('fixture writer failure');append(world,event);};
  const queued=f.host.enqueueIntentDecision('brain:reflex',f.decision,f.ref,()=>true),rejected=assert.rejects(queued,UnrecordedIntentAdmission);
  f.host.drainInputs();await rejected;assert.ok(f.host.engine.programOf('h_A'));
  assert.equal(f.db.events(f.host.worldId).filter(e=>e.kind==='decision').length,1);assert.deepEqual(f.host.intentHistoryOf('s_A').attempts,{});
  f.db.appendEvent=append;const restarted=new WorldHost(f.db,f.factory,'admission-fixture',1e9,f.host.worldId);restarted.boot();
  assert.equal(restarted.engine.stateHash(),f.host.engine.stateHash());assert.deepEqual(restarted.intentHistoryOf('s_A').attempts,{});
});

test('physical recovery retains historical admission while excluding its failed physical decision',async t=>{
  const wrap=(engine:Engine)=>{let armed=false;const perform=engine.perform.bind(engine),step=engine.step.bind(engine);
    engine.perform=program=>{if(program.label==='admission fault')armed=true;return perform(program);};
    engine.step=()=>{if(armed)throw new Error('fixture physical failure');return step();};return engine;};
  const factory={...toyFactory,create:world=>wrap(toyFactory.create(world)),restore:snapshot=>wrap(toyFactory.restore(snapshot))} satisfies EngineFactory;
  const f=await fixture(t,factory);f.host.saveSnapshot(true);
  const decision={...f.decision,label:'admission fault',option:'rest',card:'rest',target:null,approachLen:0,steps:[{verb:'rest',params:{seconds:1}}]};
  await accept(f.host,f.host.enqueueIntentDecision('brain:reflex',decision,f.ref,()=>true));const expected=f.host.intentHistoryOf('s_A');
  f.host.tickOnce();const recovery=f.db.events(f.host.worldId).find(e=>e.payload?.recovery);assert.ok(recovery);
  assert.ok(!recovery.payload.recovery.events.some((e:any)=>e.kind==='decision'));assert.ok(recovery.payload.recovery.events.some((e:any)=>e.kind==='intent-admission-v2'));
  assert.deepEqual(f.host.intentHistoryOf('s_A'),expected);assert.equal(f.host.engine.programOf('h_A'),null,'historical admission is not current execution');
  const restarted=new WorldHost(f.db,factory,'admission-fixture',1e9,f.host.worldId);restarted.boot();assert.deepEqual(restarted.intentHistoryOf('s_A'),expected);
});

for(const phase of ['before-fact','after-fact'] as const)test(`real worker termination ${phase} preserves honest admission history without reissuing work`,async t=>{
  const f=await fixture(t,toyFactory,true),worker=new Worker(new URL('../test/fixtures/intent-admission-worker.ts',import.meta.url),{workerData:{path:f.path,phase},execArgv:[]});
  t.after(()=>worker.terminate());const code=await new Promise<number>((resolve,reject)=>{worker.once('error',reject);worker.once('exit',resolve);});assert.equal(code,23);
  const restarted=new WorldHost(f.db,toyFactory,'admission-fixture',1e9,f.host.worldId);restarted.boot();
  assert.equal(f.db.events(f.host.worldId).filter(e=>e.kind==='decision').length,1);assert.ok(restarted.engine.programOf('h_A'));
  const attempts=Object.values(restarted.intentHistoryOf('s_A').attempts);assert.equal(attempts.length,phase==='after-fact'?1:0);
  if(attempts.length)assert.equal(attempts[0].phase,'accepted');assert.equal(f.db.paidCost(),0);
});
