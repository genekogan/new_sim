// P0 October 6: exact saved Alice failures. "go to the classroom" was refused
// while she slept during quiet renewal; "go for a swim in the pond" had no
// registered swim binding and the model plan failed schema. Fake minds, $0.
import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {retainedCommonsShoreFactory,nativeSleepSnapshotFactoryV1,COMMONS_PERSONAL_RESOURCES,edenLectureFactoryV1,edenGroundFactoryV1,commonsNewcomerResourcesFactory} from '@sim/engine-mars';
import {readFileSync} from 'node:fs';
import type {SoulRow} from './db.ts';
import {installEdenSteeringModeV1} from './eden-steering-mode.ts';
import {installOwnedEdenLectureCardV1,installOwnedEdenLectureReadinessV1} from './eden-lecture-cards.ts';
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
 const intentId=receipt.revision.intentId,seen=new Set<string>(),water={swim:0,tread:0};
 assert.ok(await run(f,8000,()=>{const a=f.body().human?.activity;if(a)seen.add(a);if(a==='swim'||a==='tread')water[a]++;return f.attempts(intentId).some(x=>x.phase==='completed');}),JSON.stringify({attempts:f.attempts(intentId),seen:[...seen]}));
 assert.ok(water.swim>=water.tread,'mostly moving swim, not treading in place: '+JSON.stringify(water));t.diagnostic('in-water ticks '+JSON.stringify(water));
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
 assert.equal(dto.stage,'understood');assert.equal(dto.words,'go for a swim in the pond');assert.equal(dto.soulId,f.row.id);assert.equal(dto.entityId,f.row.entity_id);assert.equal(dto.source.ownerId,'dev:alice');
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

// Lecture fixture copied from eden-lecture-owner-control.test.ts (same factory/installs).
async function lectureSetup(t:any,nativeContext=false){const factory=nativeSleepSnapshotFactoryV1(edenLectureFactoryV1(commonsNewcomerResourcesFactory(await edenGroundFactoryV1(await retainedCommonsShoreFactory({socialEdenV1:true,foodDeliveryV1:true}))))),f=fixture(':memory:',factory,{durableClockV1:true});f.brain.quiesce();f.souls.cfg.maxSoulsPerUser=9;f.souls.enableLifecycle();await invite(f,'operator');await invite(f,'other');const rows:SoulRow[]=[];for(let i=0;i<9;i++)rows.push(await accept(f.host,f.souls.create('dev:operator',{name:'Owned class '+i,description:'Synthetic same human owner lecture roster'})));for(const method of ['installCommonsProvisionsV1','installCommonsKitchenV1','installRetainedCommonsShoreV1'] as const)await accept<unknown>(f.host,f.host[method]());const layout=JSON.parse(readFileSync(new URL('../../../packages/engine-mars/src/fixtures/newcomer-layout.world-alternative.v2.json',import.meta.url),'utf8'));await accept(f.host,f.host.installCommonsNewcomerResourcesV1(layout.placements));await accept(f.host,f.host.installNativeSleepSnapshotV1());await accept(f.host,f.host.installEdenGroundV1());await accept(f.host,f.host.installEdenLectureV1({worldEast:'world-v2',id:'eden-classroom-1',origin:[42,-6],yaw:0,audienceSeats:20,lesson:'Learn from a world with a memory.'}));
 const brain=new Brain(f.host,f.db,{...f.brain.cfg,budgetUsdPerDay:0},{clients:()=>0,onCall(){},onCamera(){},onTicker(){},onNarrative(){}},{intentV2Choices:true,nativeActivityContextV1:nativeContext}),service=new IntentControlV2(f.host,brain,f.souls,{closedGoalsV1:true,registeredActivitiesV1:true});await accept<unknown>(f.host,f.host.enableIntentSequencesV1());await installEdenSteeringModeV1(f.host,{closedGoalsV1:true,registeredActivitiesV1:true});const leader=f.host.minds.get(rows[0].id)!;await accept(f.host,installOwnedEdenLectureCardV1(f.host,brain,leader));t.after(()=>{brain.quiesce();f.host.stop();f.db.close();});return {...f,brain,service,leader,rows,factory};}
test('busy lecture preparation (ready-wait and mid-walk): exact classroom and swim words are accepted and natively complete',{timeout:240000},async t=>{
 const f=await lectureSetup(t),scopeOf=(row:SoulRow)=>f.service.ownerScope({userId:'dev:operator',expiresAt:Number.MAX_SAFE_INTEGER},row.id);
 const attempts=(row:SoulRow,id:string)=>Object.values(f.host.intentHistoryOf(row.id).attempts).filter(a=>a.intent.intentId===id);
 const submit=async(row:SoulRow,requestId:string,words:string)=>{await accept(f.host,f.service.submit(scopeOf(row),{contract:'soul-intent/2',op:'upsert',requestId,words}));await accept(f.host,f.service.settled());const r=f.service.lookup(scopeOf(row),requestId);await f.brain.evaluate(f.host.minds.get(row.id)!,'new-intent-v2');f.host.drainInputs();return r;};
 const tick=async(n:number,until:()=>boolean)=>{for(let i=0;i<n&&!until();i++){f.host.tickOnce();if(i%10===0)await setImmediate();}return until();};
 const living=new LivingWorld(f.host);await accept<unknown>(f.host,living.install(['People may choose what to do and offer voluntary readiness.']));for(let i=0;i<8;i++){f.host.tickOnce();await setImmediate();}await accept(f.host,f.brain.enableEdenAutonomyV1());
 const prepared=await accept(f.host,installOwnedEdenLectureReadinessV1(f.host,f.brain,f.leader));assert.ok(prepared.readiness.length>=4);
 for(const [row,phase,words] of [[f.rows[1],'ready-wait','go to the classroom'],[f.rows[2],'mid-walk','go for a swim in the pond']] as const){
  const prep=await submit(row,'prep-'+row.id,'prepare for my Eden lecture');assert.equal(prep.phase,'understood',JSON.stringify(prep));
  const action=()=>{const p=f.host.engine.programOf(row.entity_id);return p?f.host.engine.programAction?.(p)?.action.verb??'wait':null;};
  assert.ok(await tick(3000,()=>phase==='ready-wait'?action()==='wait':action()==='walk_to'||action()==='wait'),phase+' reached: '+action());const observed=action();
  const seen=new Set<string>(),receipt=await submit(row,'p0-'+phase+'-'+row.id,words);
  assert.equal(receipt.phase,'understood',JSON.stringify(receipt));if(receipt.phase!=='understood')throw Error('no plan');
  const id=receipt.revision.intentId;
  assert.ok(await tick(8000,()=>{const a=(f.host.engine.world as NativeWorld).entities[row.entity_id].human?.activity;if(a)seen.add(a);return attempts(row,id).some(x=>x.phase==='completed');}),JSON.stringify({phase,words,summary:receipt.revision.interpretation.summary,attempts:attempts(row,id),seen:[...seen]}));
  if(words.includes('swim'))assert.ok(seen.has('swim'),[...seen].join(','));
  t.diagnostic(`${phase} (observed ${observed}) "${words}": ${receipt.revision.interpretation.summary} | ${[...seen].join(',')}`);
 }
 // 'go to class' resolves to the same classroom binding (race-free: no lecture handover can seat this body first).
 {const m3=f.host.minds.get(f.rows[3].id)!,read=readHumanCapabilitiesV1(f.host,m3,{registeredActivitiesV1:true});for(const w of ['go to class','go to the classroom','head to the lecture hall']){const g=basicHumanGoalV1(w,read,false)?.goal;assert.equal(g&&'bindingId' in g?g.bindingId:undefined,'walk:eden-classroom-1',w);}}
 assert.deepEqual(f.host.engine.runtime.violations,[]);assert.equal(f.db.paidCost(),0);
});

test('pond is multi-occupant: a bank gathering does not block it and four Souls swim, at least three at once, in spaced spots',{timeout:300000},async t=>{
 const f=await lectureSetup(t),scopeOf=(row:SoulRow)=>f.service.ownerScope({userId:'dev:operator',expiresAt:Number.MAX_SAFE_INTEGER},row.id);
 const body=(row:SoulRow)=>(f.host.engine.world as NativeWorld).entities[row.entity_id];
 const tick=async(n:number,until:()=>boolean)=>{for(let i=0;i<n&&!until();i++){f.host.tickOnce();if(i%10===0)await setImmediate();}return until();};
 const host=f.rows[1];
 await accept(f.host,f.host.enqueue('decision','fixture:bank-gathering',{soulId:host.id,entityId:host.entity_id,option:'host a gathering@shore-bank',label:'host a gathering at the bank',steps:[{verb:'walk_to',params:{to:'shore-bank'}},{verb:'gather',params:{at:'shore-bank',seconds:600}}],reevalTicks:1e9,fallback:false,trigger:'fixture'}));
 assert.ok(await tick(4000,()=>{const p=body(host).pose.p;return Math.hypot(p[0]+37.5,p[2])<2&&body(host).human?.activity!=='walk';}),'host stands at the bank centre: '+JSON.stringify(body(host).pose.p));
 const swimmers=f.rows.slice(2,6),ids:string[]=[];
 for(const row of swimmers){await accept(f.host,f.service.submit(scopeOf(row),{contract:'soul-intent/2',op:'upsert',requestId:'swim-'+row.id,words:'go for a swim'}));await accept(f.host,f.service.settled());const r=f.service.lookup(scopeOf(row),'swim-'+row.id);assert.equal(r.phase,'understood',JSON.stringify(r));if(r.phase!=='understood')throw Error('no plan');ids.push(r.revision.intentId);await f.brain.evaluate(f.host.minds.get(row.id)!,'new-intent-v2');f.host.drainInputs();}
 const swam=new Map<string,boolean>();
 let most=0,ps:number[][]=[];const completed=()=>swimmers.every((row,i)=>Object.values(f.host.intentHistoryOf(row.id).attempts).some(x=>x.intent.intentId===ids[i]&&x.phase==='completed'));const ok=await tick(14000,()=>{for(const r of swimmers)if(body(r).human?.activity==='swim')swam.set(r.id,true);const inWater=swimmers.filter(r=>['tread','swim'].includes(body(r).human?.activity??''));if(inWater.length>most){most=inWater.length;ps=inWater.map(r=>[...body(r).pose.p]);}return most>=3&&completed();});
 assert.ok(ok,'max simultaneous in water='+most+' '+swimmers.map((r,i)=>body(r).human?.activity+'@'+body(r).pose.p.map(v=>v.toFixed(1)).join(',')+' '+Object.values(f.host.intentHistoryOf(r.id).attempts).filter(x=>x.intent.intentId===ids[i]).map(x=>x.phase+':'+x.tick+(('reason' in x)?':'+x.reason:'')).join('|')).join(' ;; '));
 for(let i=0;i<ps.length;i++)for(let j=i+1;j<ps.length;j++)assert.ok(Math.hypot(ps[i][0]-ps[j][0],ps[i][2]-ps[j][2])>=1,'spaced bodies');
 assert.equal(swam.size,4,'all four actually swam');t.diagnostic('peak simultaneous swimmers '+most);assert.ok(Math.hypot(body(host).pose.p[0]+37.5,body(host).pose.p[2])<2,'gathering host was not displaced');
 assert.deepEqual(f.host.engine.runtime.violations,[]);assert.equal(f.db.paidCost(),0);
 t.diagnostic('four simultaneous swimmers at '+JSON.stringify(ps.map(p=>[p[0],p[2]])));
});

test('a place takes many bodies: someone at the classroom centre does not lock it; four arrive spaced',{timeout:300000},async t=>{
 const f=await lectureSetup(t),scopeOf=(row:SoulRow)=>f.service.ownerScope({userId:'dev:operator',expiresAt:Number.MAX_SAFE_INTEGER},row.id);
 const body=(row:SoulRow)=>(f.host.engine.world as NativeWorld).entities[row.entity_id];
 const tick=async(n:number,until:()=>boolean)=>{for(let i=0;i<n&&!until();i++){f.host.tickOnce();if(i%10===0)await setImmediate();}return until();};
 const region=f.host.engine.world.regions['eden-classroom-1'] as {polygon:[number,number][]},mid=region.polygon.reduce((a,p)=>[a[0]+p[0]/region.polygon.length,a[1]+p[1]/region.polygon.length],[0,0]);
 const parked=f.rows[1];
 await accept(f.host,f.host.enqueue('decision','fixture:stand-at-centre',{soulId:parked.id,entityId:parked.entity_id,option:'stand at the centre',label:'stand at the centre',steps:[{verb:'walk_to',params:{to:'eden-classroom-1'}},{verb:'rest',params:{seconds:600}}],reevalTicks:1e9,fallback:false,trigger:'fixture'}));
 assert.ok(await tick(4000,()=>Math.hypot(body(parked).pose.p[0]-mid[0],body(parked).pose.p[2]-mid[1])<1&&body(parked).human?.activity!=='walk'),'a body occupies the classroom centre');
 const walkers=f.rows.slice(2,6),ids:string[]=[];
 for(const row of walkers){await accept(f.host,f.service.submit(scopeOf(row),{contract:'soul-intent/2',op:'upsert',requestId:'class-'+row.id,words:'go to the classroom'}));await accept(f.host,f.service.settled());const r=f.service.lookup(scopeOf(row),'class-'+row.id);assert.equal(r.phase,'understood',JSON.stringify(r));if(r.phase!=='understood')throw Error('no plan');ids.push(r.revision.intentId);await f.brain.evaluate(f.host.minds.get(row.id)!,'new-intent-v2');f.host.drainInputs();}
 const done=()=>walkers.every((row,i)=>Object.values(f.host.intentHistoryOf(row.id).attempts).some(a=>a.intent.intentId===ids[i]&&a.phase==='completed'));
 assert.ok(await tick(12000,done),walkers.map((r,i)=>body(r).human?.activity+'@'+body(r).pose.p.map(v=>v.toFixed(1)).join(',')+' '+Object.values(f.host.intentHistoryOf(r.id).attempts).filter(x=>x.intent.intentId===ids[i]).map(x=>x.phase+':'+x.tick+(('reason' in x)?':'+x.reason:'')).join('|')).join(' ;; '));
 const ps=[...walkers,parked].map(r=>body(r).pose.p);for(let i=0;i<ps.length;i++)for(let j=i+1;j<ps.length;j++)assert.ok(Math.hypot(ps[i][0]-ps[j][0],ps[i][2]-ps[j][2])>=.9,'spaced bodies');
 assert.ok(Math.hypot(body(parked).pose.p[0]-mid[0],body(parked).pose.p[2]-mid[1])<1,'parked body not displaced');
 assert.deepEqual(f.host.engine.runtime.violations,[]);assert.equal(f.db.paidCost(),0);
 t.diagnostic('classroom arrivals at '+JSON.stringify(walkers.map(r=>[+body(r).pose.p[0].toFixed(1),+body(r).pose.p[2].toFixed(1)])));
});
