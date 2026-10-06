// P0 October 6: exact saved Alice failures. "go to the classroom" was refused
// while she slept during quiet renewal; "go for a swim in the pond" had no
// registered swim binding and the model plan failed schema. Fake minds, $0.
import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {retainedCommonsShoreFactory,nativeSleepSnapshotFactoryV1,COMMONS_PERSONAL_RESOURCES} from '@sim/engine-mars';
import {humanCompilerOutputV1Schema} from '@sim/engine-contract';
import type {WorldState as NativeWorld} from '../../../mars/viewer/engine/world/types.ts';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
import {LivingWorld} from './living.ts';
import {Brain} from './brain.ts';
import {IntentControlV2} from './intent-control.ts';
import {installCommonsProvisionCards} from './commons-provisions.ts';
import {basicHumanGoalV1,readHumanCapabilitiesV1} from './human-capabilities.ts';
import {normalizeModelOutputV1} from './human-compiler.ts';
import {buildApp} from './http.ts';
import type {Hub} from './hub.ts';
const factory=nativeSleepSnapshotFactoryV1(await retainedCommonsShoreFactory());
async function setup(t:TestContext,start:'standing'|'asleep'){
 const f=fixture(':memory:',factory,{durableClockV1:true});f.souls.enableLifecycle();
 await accept<unknown>(f.host,new LivingWorld(f.host).install(['Residents follow directions and rest.']));for(let i=0;i<4;i++)f.host.tickOnce();
 await invite(f,'alice');const row=await accept(f.host,f.souls.create('dev:alice',{name:'Alice',description:'Synthetic owner'}));
 await accept(f.host,f.host.installCommonsProvisionsV1());await accept(f.host,f.host.installRetainedCommonsShoreV1());await accept(f.host,f.host.installNativeSleepSnapshotV1());f.brain.quiesce();
 const brain=new Brain(f.host,f.db,{...f.brain.cfg,budgetUsdPerDay:0},{clients:()=>0,onCall(){},onCamera(){},onTicker(){},onNarrative(){}},{intentV2Choices:true});
 t.after(()=>{brain.quiesce();f.host.stop();f.db.close();});await installCommonsProvisionCards(f.host,brain);
 await accept<unknown>(f.host,f.host.enableIntentSequencesV1());await accept<unknown>(f.host,f.host.enableIntentExecutionRetentionV1());await accept<unknown>(f.host,f.host.enableIntentNativeSequenceCompletionV1());await accept<unknown>(f.host,f.host.enableIntentHumanSleepTransitionV1());
 const body=()=>(f.host.engine.world as NativeWorld).entities[row.entity_id];
 if(start==='asleep'){
  await accept(f.host,f.host.enqueue('decision','fixture:sleep',{soulId:row.id,entityId:row.entity_id,option:'sleep',label:'sleep on own mat',steps:[{verb:'mars:sleep',params:{mat:'commons-mat-1',duration:600,returnTo:COMMONS_PERSONAL_RESOURCES[0].sleepReturn}}],reevalTicks:1e9,fallback:false,trigger:'fixture'}));
  for(let i=0;i<3000&&body().human?.sleepPose?.standingFraction!==0;i++){f.host.tickOnce();if(i%10===0)await setImmediate();}assert.equal(body().human?.sleepPose?.standingFraction,0);
 }
 const service=new IntentControlV2(f.host,brain,f.souls,{closedGoalsV1:true,registeredActivitiesV1:true}),scope=service.ownerScope({userId:row.owner,expiresAt:Number.MAX_SAFE_INTEGER},row.id);
 const submit=async(requestId:string,words:string)=>{await accept(f.host,service.submit(scope,{contract:'soul-intent/2',op:'upsert',requestId,words}));await accept(f.host,service.settled());return service.lookup(scope,requestId);};
 const mind=()=>f.host.minds.get(row.id)!;
 const attempts=(intentId:string)=>Object.values(f.host.intentHistoryOf(row.id).attempts).filter(a=>a.intent.intentId===intentId);
 return {...f,brain,row,body,service,scope,submit,mind,attempts};
}
async function run(f:Awaited<ReturnType<typeof setup>>,ticks:number,until:()=>boolean){for(let i=0;i<ticks&&!until();i++){f.host.tickOnce();if(i%20===0)await setImmediate();}return until();}

test('asleep during quiet renewal: walk is accepted with the specific condition, waits, then natively walks and completes',async t=>{
 const f=await setup(t,'asleep');const day=f.host.living!.lastDay;
 await accept(f.host,f.host.enqueue('rules','world',{quiet:true,day,why:'overdue quiet checkpoint'}));assert.equal(f.host.quietBarrier,true);
 const before=f.host.engine.stateHash(),receipt=await f.submit('p0-classroom-equivalent','go to commons-bench-west');
 assert.equal(receipt.phase,'understood',JSON.stringify(receipt));if(receipt.phase!=='understood')throw Error('no plan');
 assert.match(receipt.revision.interpretation.summary,/Alice is asleep while Eden quietly renews before first light/);assert.match(receipt.revision.interpretation.summary,/Walk to /);
 assert.equal(f.host.engine.stateHash(),before,'acceptance must not move or wake the sleeper');assert.equal(f.db.events(f.host.worldId).filter(e=>e.kind==='intent-sleep-stop-v1').length,0);
 const intentId=receipt.revision.intentId;
 assert.ok(await run(f,20000,()=>!f.host.quietBarrier),'renewal finishes on its own');
 assert.ok(await run(f,4000,()=>f.attempts(intentId).some(a=>a.phase==='completed')),JSON.stringify(f.attempts(intentId)));
 const done=f.attempts(intentId).find(a=>a.phase==='completed')!;assert.ok(done.tick>0);
 const bench=(f.host.engine.world as NativeWorld).entities['commons-bench-west'];if(bench){const p=f.body().pose.p;assert.ok(Math.hypot(p[0]-bench.pose.p[0],p[2]-bench.pose.p[2])<4,'arrived near the named target');}
 assert.deepEqual(f.host.engine.runtime.violations,[]);assert.equal(f.db.paidCost(),0);
 t.diagnostic(`accepted during quiet; completed tick=${done.tick}`);
});

test('asleep without quiet: wake-first path still used (no regression)',async t=>{
 const f=await setup(t,'asleep'),receipt=await f.submit('wake','go to commons-bench-west');assert.equal(receipt.phase,'understood');if(receipt.phase!=='understood')throw Error('no plan');
 assert.match(receipt.revision.interpretation.summary,/^Wake safely first/);
 assert.ok(await run(f,300,()=>f.body().human?.activity==='walk'));assert.equal(f.db.paidCost(),0);
});

test('seated and moving starting states: walk is accepted, body safely transitions and arrives',async t=>{
 for(const [start,words] of [['seated','go to shore-bank'],['moving','go to commons-bench-west'],['seated','go for a swim in the pond']] as const)await t.test(start+': '+words,async child=>{
  const f=await setup(child,'standing');
  const steps=start==='seated'?[{verb:'sit',params:{on:'commons-bench-west',seconds:600}}]:[{verb:'walk_to',params:{to:'shore-bank'}}];
  await accept(f.host,f.host.enqueue('decision','fixture:'+start,{soulId:f.row.id,entityId:f.row.entity_id,option:start,label:start,steps,reevalTicks:1e9,fallback:false,trigger:'fixture'}));
  assert.ok(await run(f,3000,()=>start==='seated'?f.body().human?.activity==='sit':f.body().human?.activity==='walk'),'fixture reached '+start);
  const receipt=await f.submit('go-'+start,words);
  assert.equal(receipt.phase,'understood',JSON.stringify(receipt));if(receipt.phase!=='understood')throw Error('no plan');
  const intentId=receipt.revision.intentId;
  assert.ok(await run(f,6000,()=>f.attempts(intentId).some(a=>a.phase==='completed')),JSON.stringify({summary:receipt.revision.interpretation.summary,attempts:f.attempts(intentId)}));
  assert.deepEqual(f.host.engine.runtime.violations,[]);assert.equal(f.db.paidCost(),0);
  child.diagnostic(`${start}: ${receipt.revision.interpretation.summary}`);
 });
});

test('exact swim words: supported pond binding, native admission/start/completion with actual swimming',async t=>{
 const f=await setup(t,'standing'),receipt=await f.submit('p0-swim','go for a swim in the pond');
 assert.equal(receipt.phase,'understood',JSON.stringify(receipt));if(receipt.phase!=='understood')throw Error('no plan');
 assert.deepEqual(receipt.revision.interpretation.humanGoalPlan?.kind==='planned'&&receipt.revision.interpretation.humanGoalPlan.goals,[{goal:'activity',bindingId:'activity:swim:shore-water'}]);
 const intentId=receipt.revision.intentId,seen=new Set<string>();
 assert.ok(await run(f,8000,()=>{const a=f.body().human?.activity;if(a)seen.add(a);return f.attempts(intentId).some(x=>x.phase==='completed');}),JSON.stringify({attempts:f.attempts(intentId),seen:[...seen]}));
 assert.ok(seen.has('swim'),'body actually swam: '+[...seen].join(','));
 assert.deepEqual(f.host.engine.runtime.violations,[]);assert.equal(f.db.paidCost(),0);
 t.diagnostic('activities observed: '+[...seen].join(','));
});

test('swim paraphrases and classroom phrasing resolve without a model; unsafe forms do not',async t=>{
 const f=await setup(t,'standing'),read=readHumanCapabilitiesV1(f.host,f.mind(),{registeredActivitiesV1:true});
 for(const words of ['go for a swim in the pond','Go swimming.','take a dip in the pond','swim','please go for a swim now','have a swim in the water','go to the pond for a swim','swim in the lake']){
  const out=basicHumanGoalV1(words,read,false);assert.deepEqual(out?.goal,{goal:'activity',bindingId:'activity:swim:shore-water'},words);
 }
 assert.match(basicHumanGoalV1('swim in the lake',read,false)!.note!,/lake here is scenery/);
 assert.equal(basicHumanGoalV1('swim in the lake',read,true),null,'strict other water is not silently substituted');
 for(const words of ["don't swim",'swim tomorrow','swim when it is warm'])assert.equal(basicHumanGoalV1(words,read,false)?.goal?.goal==='activity',false,words);
 for(const words of ['head to commons-bench-west','walk over to commons-bench-west','go back to commons-bench-west'])assert.equal(basicHumanGoalV1(words,read,false)?.goal?.goal,'walk',words);
});

test('model plan missing optional structure is normalized; no_action extras dropped; future words still refused later',()=>{
 const hash='a'.repeat(64);
 assert.equal(humanCompilerOutputV1Schema.safeParse({kind:'plan',goals:[{goal:'activity',bindingId:'activity:swim:shore-water'}],explanation:'Swim.'}).success,false,'raw missing registryHash fails');
 const plan=humanCompilerOutputV1Schema.parse(normalizeModelOutputV1({kind:'plan',goals:[{goal:'activity',bindingId:'activity:swim:shore-water'}],explanation:'Swim.'},hash));
 assert.equal(plan.kind,'plan');if(plan.kind==='plan'){assert.deepEqual(plan.trigger,{kind:'now'});assert.equal(plan.registryHash,hash);}
 assert.equal(humanCompilerOutputV1Schema.safeParse(normalizeModelOutputV1({kind:'no_action',reason:'needs_clarification',explanation:'Which?',trigger:{kind:'now'},goals:[]},hash)).success,true);
 assert.equal(humanCompilerOutputV1Schema.safeParse(normalizeModelOutputV1({kind:'plan',goals:[{goal:'swim'}],explanation:'x'},hash)).success,false,'unknown goal still fails');
});

test('G414 own-request diagnostics: strict scoped DTO with canonical attempts; foreign and anonymous get nothing',async t=>{
 const {ownRequestDiagnosticsV1Schema}=await import('./own-request-diagnostics.ts');
 const f=await setup(t,'standing'),receipt=await f.submit('diag-swim','go for a swim in the pond');assert.equal(receipt.phase,'understood');if(receipt.phase!=='understood')throw Error('no plan');
 await run(f,8000,()=>f.attempts(receipt.revision.intentId).some(a=>a.phase==='completed'));
 const app=buildApp({cfg:{...f.brain.cfg,build:'p0-test-build'},db:f.db,host:f.host,auth:f.auth,brain:f.brain,souls:f.souls,intentV2:f.service,hub:{clients:new Map(),refreshMe(){}} as unknown as Hub}),path=(id:string)=>`/v1/souls/${f.row.id}/intent-v2/requests/${id}/diagnostics`,get=(id:string,auth?:string)=>app.request(path(id),auth?{headers:{authorization:auth}}:{});
 const res=await get('diag-swim','Bearer dev:alice');assert.equal(res.status,200);assert.equal(res.headers.get('cache-control'),'no-store');const dto=ownRequestDiagnosticsV1Schema.parse(await res.json());
 assert.equal(dto.stage,'understood');assert.equal(dto.soulId,f.row.id);assert.equal(dto.entityId,f.row.entity_id);assert.equal(dto.source.ownerId,'dev:alice');
 assert.equal(dto.resolution?.goal,'activity');assert.equal(dto.resolution?.bindingId,'activity:swim:shore-water');assert.equal(dto.resolution?.destination,'Swim in the supported pond');
 assert.deepEqual(['accepted','started','completed'].map(p=>dto.attempts?.some(a=>a.phase===p)),[true,true,true],JSON.stringify(dto.attempts));
 assert.ok(dto.server.createdAt>0&&dto.server.updatedAt>=dto.server.createdAt);assert.equal(dto.server.build,'p0-test-build');
 const text=JSON.stringify(dto);for(const secret of ['sim_','apiKey','anthropic','raw','reasoning'])assert.ok(!text.includes(secret),secret);
 const refused=await f.submit('diag-unknown','teleport me to the moon base');assert.equal(refused.phase,'refused');
 const r=ownRequestDiagnosticsV1Schema.parse(await (await get('diag-unknown','Bearer dev:alice')).json());assert.equal(r.stage,'refused');assert.ok(r.code);assert.ok(r.validation||r.unavailable?.some(u=>u.field==='validation'));
 await invite(f,'bob');assert.equal((await get('diag-swim','Bearer dev:bob')).status,404);
 assert.ok([401,404].includes((await get('diag-swim')).status));assert.equal((await get('no-such','Bearer dev:alice')).status,404);
 if(process.env.P0_DIAGNOSTICS_OUT)(await import('node:fs')).writeFileSync(process.env.P0_DIAGNOSTICS_OUT,JSON.stringify({scope:{worldId:f.host.worldId,soulId:f.row.id,ownerId:'dev:alice',entityId:f.row.entity_id},understood:dto,refused:r}));
 t.diagnostic(JSON.stringify({unavailable:dto.unavailable?.map(u=>u.field),refusedCode:r.code}));
});
