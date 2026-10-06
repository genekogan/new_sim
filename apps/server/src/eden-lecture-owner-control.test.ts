import type {SoulRow} from './db.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {edenLectureFactoryV1,edenGroundFactoryV1,retainedCommonsShoreFactory,commonsNewcomerResourcesFactory,nativeSleepSnapshotFactoryV1} from '@sim/engine-mars';
import {readFileSync} from 'node:fs';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
import {Brain} from './brain.ts';
import {IntentControlV2} from './intent-control.ts';
import {installEdenSteeringModeV1} from './eden-steering-mode.ts';
import {installOwnedEdenLectureCardV1,installOwnedEdenLectureControlsV1} from './eden-lecture-cards.ts';
import {readHumanCapabilitiesV1} from './human-capabilities.ts';
import {WorldHost} from './world.ts';
import {kernelHash} from '@sim/kernel';
import {MarsEngine} from '../../../packages/engine-mars/src/engine.ts';
async function setup(t:any){const factory=nativeSleepSnapshotFactoryV1(edenLectureFactoryV1(commonsNewcomerResourcesFactory(await edenGroundFactoryV1(await retainedCommonsShoreFactory({socialEdenV1:true,foodDeliveryV1:true}))))),f=fixture(':memory:',factory,{durableClockV1:true});f.brain.quiesce();f.souls.cfg.maxSoulsPerUser=9;f.souls.enableLifecycle();await invite(f,'operator');await invite(f,'other');const rows:SoulRow[]=[];for(let i=0;i<9;i++)rows.push(await accept(f.host,f.souls.create('dev:operator',{name:'Owned class '+i,description:'Synthetic same human owner lecture roster'})));for(const method of ['installCommonsProvisionsV1','installCommonsKitchenV1','installRetainedCommonsShoreV1'] as const)await accept<unknown>(f.host,f.host[method]());const layout=JSON.parse(readFileSync(new URL('../../../packages/engine-mars/src/fixtures/newcomer-layout.world-alternative.v2.json',import.meta.url),'utf8'));await accept(f.host,f.host.installCommonsNewcomerResourcesV1(layout.placements));await accept(f.host,f.host.installNativeSleepSnapshotV1());await accept(f.host,f.host.installEdenGroundV1());await accept(f.host,f.host.installEdenLectureV1({worldEast:'world-v2',id:'eden-classroom-1',origin:[42,-6],yaw:0,audienceSeats:20,lesson:'Learn from a world with a memory.'}));
 const brain=new Brain(f.host,f.db,{...f.brain.cfg,budgetUsdPerDay:0},{clients:()=>0,onCall(){},onCamera(){},onTicker(){},onNarrative(){}},{intentV2Choices:true}),service=new IntentControlV2(f.host,brain,f.souls,{closedGoalsV1:true,registeredActivitiesV1:true});await accept<unknown>(f.host,f.host.enableIntentSequencesV1());await installEdenSteeringModeV1(f.host,{closedGoalsV1:true,registeredActivitiesV1:true});const leader=f.host.minds.get(rows[0].id)!;await accept(f.host,installOwnedEdenLectureCardV1(f.host,brain,leader));t.after(()=>{brain.quiesce();f.host.stop();f.db.close();});return {...f,brain,service,leader,rows,factory};}
test('same human owner starts a real nine-body lecture through ordinary retained intent and gets native participation',async t=>{const f=await setup(t),scope=f.service.ownerScope({userId:'dev:operator',expiresAt:Number.MAX_SAFE_INTEGER},f.leader.soulId);assert.ok([...readHumanCapabilitiesV1(f.host,f.leader,{registeredActivitiesV1:true}).bindings.values()].some(b=>b.label==='host an eden lecture'));await accept(f.host,f.service.submit(scope,{contract:'soul-intent/2',op:'upsert',requestId:'owner-starts-lecture',words:'host an Eden lecture'}));await accept(f.host,f.service.settled());assert.equal(f.service.lookup(scope,'owner-starts-lecture').phase,'understood');let read:any;for(let i=0;i<3000;i++){f.host.tickOnce();if(i%10===0)await setImmediate();const id=[...f.host.engine.runtime.records.values()].find(r=>r.verb==='classroom_session')?.id;read=id?(f.host.engine as MarsEngine).lectureReadout(id):undefined;if(read?.phase==='presenting')break;}assert.equal(read?.phase,'presenting');assert.equal(read.physicalParticipants.filter((p:any)=>p.occupied).length,8);assert.equal(f.db.paidCost(),0);assert.deepEqual(f.host.engine.runtime.violations,[]);});
test('foreign or changed participant ownership removes the ordinary binding and fences queued admission before body effects',async t=>{const f=await setup(t),scope=f.service.ownerScope({userId:'dev:operator',expiresAt:Number.MAX_SAFE_INTEGER},f.leader.soulId);await accept(f.host,f.service.submit(scope,{contract:'soul-intent/2',op:'upsert',requestId:'prepared-owner-lecture',words:'host an Eden lecture'}));await accept(f.host,f.service.settled());const receipt=f.service.lookup(scope,'prepared-owner-lecture');assert.equal(receipt.phase,'understood');await f.brain.evaluate(f.leader,'new-intent-v2');f.db.db.prepare("UPDATE souls SET owner='dev:other' WHERE id=?").run(f.rows[8].id);f.host.drainInputs();await setImmediate();assert.equal([...f.host.engine.runtime.records.values()].filter(r=>r.verb==='classroom_session').length,0);assert.ok(![...readHumanCapabilitiesV1(f.host,f.leader,{registeredActivitiesV1:true}).bindings.values()].some(b=>b.label==='host an eden lecture'));assert.equal(f.db.paidCost(),0);});

for(const kind of ['advance','cancel'] as const)test('ordinary owned lecture '+kind+' records native control without pretending cleanup completed',async t=>{
 const f=await setup(t),scope=f.service.ownerScope({userId:'dev:operator',expiresAt:Number.MAX_SAFE_INTEGER},f.leader.soulId);await accept(f.host,f.service.submit(scope,{contract:'soul-intent/2',op:'upsert',requestId:'start-for-'+kind,words:'host an Eden lecture'}));await accept(f.host,f.service.settled());let id:string|undefined,read:any;for(let i=0;i<3000;i++){f.host.tickOnce();if(i%10===0)await setImmediate();id=[...f.host.engine.runtime.records.values()].find(r=>r.verb==='classroom_session')?.id;read=id?(f.host.engine as MarsEngine).lectureReadout(id):undefined;if(read?.phase==='presenting')break;}assert.equal(read?.phase,'presenting');const bodyProgramme=f.host.engine.programOf(f.leader.entityId);await accept(f.host,installOwnedEdenLectureControlsV1(f.host,f.brain,f.leader,id!));await accept(f.host,f.service.submit(scope,{contract:'soul-intent/2',op:'upsert',requestId:'control-'+kind,words:kind==='cancel'?'end my Eden lecture':'advance my Eden lecture'}));await accept(f.host,f.service.settled());assert.equal(f.service.lookup(scope,'control-'+kind).phase,'understood');await f.brain.evaluate(f.leader,'new-intent-v2');f.host.drainInputs();assert.equal(f.host.engine.programOf(f.leader.entityId),bodyProgramme,'control admission does not replace the owned body programme');const count=()=>[...f.host.engine.runtime.records.values()].filter(r=>r.verb==='classroom_control'&&(r.params as {session?:string}).session===id);for(let i=0;i<10&&!count().length;i++){f.host.tickOnce();await setImmediate();}assert.equal(count().length,1);assert.equal((count()[0].params as {intent:{kind:string}}).intent.kind,kind);
 const controlReceipt=f.service.lookup(scope,'control-'+kind);
 if(controlReceipt.phase!=='understood')throw Error('control interpretation disappeared');
 const ref=controlReceipt.revision.intentId;
 const controlOutcome=()=>Object.values(f.host.intentHistoryOf(f.leader.soulId).attempts).find(a=>a.intent.intentId===ref);
 for(let i=0;i<60&&controlOutcome()?.phase!=='completed';i++){f.host.tickOnce();await setImmediate();}
 assert.equal(controlOutcome()?.phase,'completed','the auxiliary control has its own observed completion');
 assert.notEqual((controlOutcome() as {activityId?:string}).activityId,bodyProgramme,'control outcome cannot claim the physical host programme');
 assert.equal(f.host.intentHistoryOf(f.leader.soulId).intents[ref].status,'active','completed attempt never silently fulfils retained owner purpose');
 assert.ok(f.host.engine.runtime.liveIds().includes(id!),'control completion is recorded while classroom remains in physical progress');
 if(kind==='cancel'){assert.ok(f.host.engine.runtime.liveIds().includes(id!),'recorded control is distinct from physical cleanup');f.brain.quiesce();for(let i=0;i<3000&&f.host.engine.runtime.liveIds().includes(id!);i++){f.host.tickOnce();if(i%10===0)await setImmediate();}assert.equal(f.host.engine.runtime.liveIds().includes(id!),false);assert.equal(f.host.engine.canSnapshot?.(),true);}else assert.equal(f.host.engine.runtime.liveIds().includes(id!),true);assert.deepEqual(f.host.engine.runtime.violations,[]);assert.equal(f.db.paidCost(),0);
 f.brain.quiesce();
 for(let i=0;i<9000&&f.host.engine.runtime.liveIds().includes(id!);i++){f.host.tickOnce();if(i%10===0)await setImmediate();}
 assert.equal(f.host.engine.runtime.liveIds().includes(id!),false,'ordinary controlled session reaches actual bounded completion');
 assert.equal(f.host.engine.canSnapshot?.(),true);
 const history=f.host.intentHistoryOf(f.leader.soulId),frontier={engine:f.host.engine.stateHash(),kernel:kernelHash(f.host.kernel)};
 f.host.saveSnapshot(true);
 for(const mode of ['snapshot','genesis']){
  if(mode==='genesis')f.db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(f.host.worldId);
  const restored=new WorldHost(f.db,f.factory,f.host.seed,1e9,f.host.worldId,{durableClockV1:true});
  assert.equal(restored.boot().from,mode);
  assert.deepEqual({engine:restored.engine.stateHash(),kernel:kernelHash(restored.kernel)},frontier);
  assert.deepEqual(restored.intentHistoryOf(f.leader.soulId),history);
  restored.stop();
 }
});

test('queued ordinary lecture control refuses changed participant ownership before altering the active session', async t => {
 const f=await setup(t),scope=f.service.ownerScope({userId:'dev:operator',expiresAt:Number.MAX_SAFE_INTEGER},f.leader.soulId);
 await accept(f.host,f.service.submit(scope,{contract:'soul-intent/2',op:'upsert',requestId:'start-before-control-authority-change',words:'host an Eden lecture'}));
 await accept(f.host,f.service.settled());
 let session:string|undefined,read:any;
 for(let i=0;i<3000;i++){
  f.host.tickOnce();if(i%10===0)await setImmediate();
  session=[...f.host.engine.runtime.records.values()].find(r=>r.verb==='classroom_session')?.id;
  read=session?(f.host.engine as MarsEngine).lectureReadout(session):undefined;
  if(read?.phase==='presenting')break;
 }
 assert.equal(read?.phase,'presenting');
 await accept(f.host,installOwnedEdenLectureControlsV1(f.host,f.brain,f.leader,session!));
 await accept(f.host,f.service.submit(scope,{contract:'soul-intent/2',op:'upsert',requestId:'end-before-authority-change',words:'end my Eden lecture'}));
 await accept(f.host,f.service.settled());
 assert.equal(f.service.lookup(scope,'end-before-authority-change').phase,'understood');
 const oldProgramme=f.host.engine.programOf(f.leader.entityId);
 await f.brain.evaluate(f.leader,'new-intent-v2');
 f.db.db.prepare("UPDATE souls SET owner='dev:other' WHERE id=?").run(f.rows[8].id);
 f.host.drainInputs();await setImmediate();
 assert.equal([...f.host.engine.runtime.records.values()].filter(r=>r.verb==='classroom_control'&&(r.params as {session?:string}).session===session).length,0);
 assert.equal(f.host.engine.programOf(f.leader.entityId),oldProgramme);
 assert.equal((f.host.engine as MarsEngine).lectureReadout(session!)?.phase,'presenting');
 assert.equal(f.host.engine.runtime.liveIds().includes(session!),true);
 assert.equal([...readHumanCapabilitiesV1(f.host,f.leader,{registeredActivitiesV1:true}).bindings.values()].filter(b=>b.steps.some(s=>s.verb==='control_classroom_v1')).length,0);
 assert.equal(f.db.paidCost(),0);
});
