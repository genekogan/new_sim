import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {adaptIndependentProbe,readIndependentProbeEvidence} from './evidence.mjs';
import {scoreContinuity,observedHolds} from './oracle.mjs';
const fixtures=JSON.parse(readFileSync(new URL('./fixtures.json',import.meta.url))),oracles=JSON.parse(readFileSync(new URL('./oracles.json',import.meta.url)));
const a='reader-a',b='reader-b',body=(actor,t,kind='body')=>({kind,actor,soulId:'soul-'+actor,source:'here',requestedAt:t-10,receivedAt:t,at:t+1,tick:t/100,me:{pos:[74,0,-7],posture:'seated',seat:actor+'-chair#seat',activity:'read'}});
const event=(id,at,kind,data={})=>({id,at,kind,data});
const record=(seq,payload,source='world')=>({seq,source,event_id:payload.id,payload,received_at:payload.at+10,handled_at:null});
function input(){
 const started={id:'r1',capability:'read:read.e-chair',phase:'started',acceptedTick:123,startedTick:124,endedTick:null},ended={...started,phase:'completed',endedTick:999,endedAt:{pos:[74,0,-7],posture:'standing'}};
 return {scenarioId:'eden-reading-duo',run:{kind:'development-only',worldId:'world-1',startedAt:1000,seconds:4,model:'same-model',effort:'low',actors:[{id:a,soulId:'soul-'+a,releaseOffsetSec:0,instructionId:'instruction-a'},{id:b,soulId:'soul-'+b,releaseOffsetSec:0,instructionId:'instruction-b'}]},timeline:[body(a,900,'setup-body'),body(b,910,'setup-body'),...Array.from({length:5},(_,i)=>[body(a,1000+i*1000),body(b,1000+i*1000)]).flat(),{kind:'controller-release',actor:a,scheduledAt:1000,releasedAt:1002,instructionId:'instruction-a',pid:99,at:1003}],journals:{
  [a]:{identity:{world:'world-1',soul:'soul-'+a},events:[record(1,event('c_1',1100,'conversation.turn',{conversation:'conv',turn:{seq:1,at:1100,text:'Are you coming?'}})),record(2,event('c_2',1200,'receipt.started',{receipt:started})),record(3,event('c_3',4200,'receipt.terminal',{receipt:ended}))],operations:[{id:'op-read',status:'settled',at:1250,request:{type:'write',command:'act',args:{capability:started.capability}},response:{accepted:true,receipt:started}},{id:'op-say',status:'settled',at:2000,request:{type:'write',command:'say',args:{text:'model narration must not become native evidence'}},response:{said:{id:'sp_canonical',tick:25}}}]},
  [b]:{identity:{world:'world-1',soul:'soul-'+b},events:[record(1,event('c_1',1120,'speech.to-me',{saidId:'sp_canonical',text:'Native words'}))],operations:[]}
 }};
}
test('legacy development probe retains useful current bodies and identities but cannot fabricate T0, latency or semantic completeness',()=>{
 const x=input();x.timeline=x.timeline.filter(r=>r.kind!=='setup-body');for(const row of x.timeline)if(row.kind==='body'){delete row.source;delete row.requestedAt;delete row.receivedAt;}
 const e=adaptIndependentProbe(x);assert.equal(e.t0,null);assert.equal(e.participants[a].samples[0].currentBody,true);assert.equal(e.participants[a].samples[0].pos.src,'here');assert.equal(e.participants[a].samples[0].perceptionSampleStartedAt,null);assert.equal(e.participants[a].samples[0].provenance,'legacy-body-row-here');
 const n=e.notifications.find(n=>n.actor===a);assert.equal(n.eventId,'c_1');assert.equal(n.receivedAt,1110);assert.equal(n.persistedAt,null);assert.equal(n.notifiedAt,null);assert.equal(n.firstRelevantEffectAt,null);assert.equal(n.healthyRunning,undefined);
 assert.equal(e.fixtureVerified,false);assert.equal(e.effectsComplete,false);assert.equal(e.notificationsComplete,false);assert.equal(e.participants[a].coverageComplete,false);assert.equal(e.semantic,undefined);assert.equal(e.disturbances,undefined);assert.equal(e.restart,undefined);assert.equal(e.lostAddressedEventIds,undefined);
 assert.match(e.adaptation.receivedEvents[0].evidence[0],/reader-a\/runtime\/continuity.sqlite#events\/seq=1/);assert.ok(!JSON.stringify(e).includes('model narration'));
});
test('a read intent during approach cannot become physical reading evidence',()=>{
 const x=input(),row=x.timeline.find(r=>r.actor===a&&r.kind==='body'&&r.receivedAt===1000);row.me={...row.me,posture:'standing',seat:null,activity:'read',actualActivity:{kind:'walk'}};
 const sample=adaptIndependentProbe(x).participants[a].samples.find(s=>s.t===1000);
 assert.equal(sample.reportedIntentActivity,'read');assert.equal(sample.activity,'walk');assert.equal(sample.instrument,null);assert.equal(sample.activityProvenance,'explicit-native-actual-activity');assert.equal(sample.currentBody,true);assert.deepEqual(sample.pos,{x:74,z:-7,region:null,src:'here'});assert.equal(sample.posture,'standing');assert.equal(sample.seat,null);
 const hold=observedHolds({samples:[sample],phase:{region:{pos:[74,-7],radiusM:1},activities:['read'],holdSec:0},from:1000,to:1000,coverageComplete:true});assert.equal(hold.status,'fail');assert.equal(hold.windows.length,0);
 row.me.actualActivity={kind:'read'};const reading=adaptIndependentProbe(x).participants[a].samples.find(s=>s.t===1000);assert.equal(reading.activity,'read');assert.equal(observedHolds({samples:[reading],phase:{region:{pos:[74,-7],radiusM:1},activities:['read'],holdSec:0},from:1000,to:1000,coverageComplete:true}).status,'pass');
});
test('legacy or missing actual activity stays unknown while native seat and position evidence survives',()=>{
 const x=input();for(const row of x.timeline)if(row.kind==='body')delete row.source;
 const sample=adaptIndependentProbe(x).participants[a].samples.find(s=>s.t===1000);assert.equal(sample.activity,null);assert.equal(sample.instrument,null);assert.equal(sample.activityProvenance,'unknown');assert.equal(sample.reportedIntentActivity,'read');assert.equal(sample.currentBody,true);assert.equal(sample.pos.src,'here');assert.equal(sample.seat,a+'-chair#seat');assert.equal(sample.posture,'seated');
 const explicit=input(),row=explicit.timeline.find(r=>r.actor===a&&r.kind==='body'&&r.receivedAt===1000);row.me.actualActivity={kind:'play-music',instrument:'violin'};
 const playing=adaptIndependentProbe(explicit).participants[a].samples.find(s=>s.t===1000);assert.equal(playing.activity,'play-music');assert.equal(playing.instrument,'violin');assert.equal(playing.reportedIntentActivity,'read');assert.equal(playing.seat,a+'-chair#seat');
 row.source='lastReceipt';const unverified=adaptIndependentProbe(explicit).participants[a].samples.find(s=>s.t===1000);assert.equal(unverified.activity,null);assert.equal(unverified.activityProvenance,'unknown');assert.equal(unverified.currentBody,false);assert.equal(unverified.pos.src,'unknown');
});
test('native receipt observations supply lifecycle UTC without converting ticks or terminal body pose; canonical speech time remains unknown',()=>{
 const e=adaptIndependentProbe(input()),r=e.participants[a].receipts[0];assert.equal(e.t0,1000);assert.equal(r.observedAcceptedAt,1200);assert.equal(r.observedEndedAt,4200);assert.equal(r.phase,'completed');assert.equal(r.acceptedTick,123);assert.deepEqual(r.endedAt.pos,[74,0,-7]);assert.equal(r.timestampEvidence.accepted.kind,'native-receipt-event');
 const speech=e.effects.find(e=>e.type==='speech');assert.equal(speech.id,'sp_canonical');assert.equal(speech.operationId,'op-say');assert.equal(speech.at,null);assert.equal(speech.responseObservedAt,2000);assert.ok(!e.effects.some(e=>e.id==='c_1'),'per-recipient cursors are delivery identities, not canonical effects');
 const source=e.adaptation.controllerReleases[0];assert.equal(source.scheduledAt,1000);assert.equal(source.releasedAt,1002);assert.equal(source.initialInstructionId,'instruction-a');assert.match(source.evidence[0],/timeline.jsonl#L/);
 const late=input();late.journals[a].events=late.journals[a].events.filter(e=>e.event_id!=='c_3');late.journals[a].operations[0].response={receipt:{...r,observedAcceptedAt:undefined,observedEndedAt:undefined,timestampEvidence:undefined,phase:'completed'}};late.journals[a].operations[0].at=9000;
 const recovered=adaptIndependentProbe(late).participants[a].receipts[0];assert.equal(recovered.observedEndedAt,null);assert.equal(recovered.terminalStateObservedAt,9000,'late settlement/readback observes a state, not its original completion time');
});
test('durable and host acknowledgements join exact actor/source/event identities and relevance requires explicit native linkage',()=>{
 const x=input();x.timeline.push({kind:'runtime',actor:a,state:'events-persisted',committedAt:1150,events:[{source:'world',id:'c_1'}],at:1151},{kind:'runtime',actor:a,state:'events-persisted',committedAt:1170,events:[{source:'world',id:'c_1'}],at:1171},{kind:'runtime',actor:a,state:'host-notified',mode:'steer',threadId:'thread-a',turnId:'turn-a',events:[{source:'world',id:'c_1'}],at:1300});
 x.nativeEffects=[{id:'sp_canonical',actor:a,type:'speech',at:1500,evidence:['public-speech.json#/sp_canonical']}];x.responses=[{actor:a,source:'world',eventId:'c_1',effectId:'sp_canonical',evidence:['review.json#/response-1']}];x.audits={healthyWindows:[{actor:a,from:1000,to:5000,evidence:['health.json#/a']} ]};
 const e=adaptIndependentProbe(x),n=e.notifications.find(n=>n.actor===a),other=e.notifications.find(n=>n.actor===b);assert.equal(n.persistedAt,1150);assert.equal(n.notifiedAt,1300);assert.equal(n.firstRelevantEffectAt,1500);assert.equal(n.healthyRunning,true);assert.equal(other.persistedAt,null);assert.equal(other.notifiedAt,null);assert.equal(other.firstRelevantEffectAt,null);assert.equal(e.effects.find(e=>e.id==='sp_canonical').respondsToEventId,'c_1');assert.ok(n.evidence.some(s=>s.includes('timeline.jsonl#L')));
 const scored=scoreContinuity({fixtures,oracles,evidence:e});assert.equal(scored.rows.find(r=>r.id==='notification:c_1:visible-response').status,'pass');assert.equal(scored.status,'unknown');
 delete x.responses;const unlinked=adaptIndependentProbe(x);assert.equal(unlinked.notifications.find(n=>n.actor===a).firstRelevantEffectAt,null,'a nearby native effect alone is not evidence of relevance');
});
test('no completeness flag without source-cited interval audit; observation gaps and missing expected events remain explicit',()=>{
 const x=input(),audit={complete:true,from:1000,to:5000,evidence:['audit.json#/entire-interval']};x.annotations={fixtureVerified:true,effectsComplete:true,participants:{[a]:{coverageComplete:true}}};
 x.audits={fixture:{...audit,verified:true},participants:{[a]:{...audit,receiptsComplete:true}},effects:{...audit,from:999},notifications:{...audit,expected:[{actor:a,source:'world',eventId:'c_missing'}],lostAddressedEventIds:['reader-a:world:c_missing']}};
 const e=adaptIndependentProbe(x);assert.equal(e.fixtureVerified,true);assert.equal(e.participants[a].coverageComplete,true);assert.equal(e.participants[b].coverageComplete,false);assert.equal(e.effectsComplete,false,'audit for a different interval cannot certify this one');assert.equal(e.notificationsComplete,true);assert.deepEqual(e.lostAddressedEventIds,['reader-a:world:c_missing']);assert.ok(e.notifications.some(n=>n.eventId==='c_missing'&&n.persistedAt===null));
 x.timeline.push({kind:'observation-error',actor:a,at:2500,code:'timeout'});assert.equal(adaptIndependentProbe(x).participants[a].coverageComplete,false);
 delete x.audits.fixture.evidence;assert.equal(adaptIndependentProbe(x).fixtureVerified,false);
});
test('observer body polling is not an agent errand read and mutable dispatch timestamps are not invented',()=>{
 const x=input();x.timeline.push({kind:'world-read',actor:a,origin:'observer',command:'here',requestedAt:4000,receivedAt:4010,response:{here:{me:{pos:[0,0]}}}},{kind:'world-read',actor:a,origin:'agent',command:'observe',requestedAt:4100,receivedAt:4110,response:{here:{me:{pos:[0,0]}}}});
 x.journals[a].operations.push({id:'uncertain-op',status:'uncertain',at:4500,request:{type:'write',command:'say',args:{text:'maybe spoken'}},response:null},{id:'dispatch-record',status:'dispatching',at:4600,request:{type:'write',command:'act',args:{}},response:null});
 const e=adaptIndependentProbe(x);assert.deepEqual(e.participants[a].reads.map(r=>[r.command,r.at]),[['observe',4110]]);assert.equal(e.adaptation.operations.find(o=>o.id==='uncertain-op').dispatchRecordedAt,null);assert.equal(e.adaptation.operations.find(o=>o.id==='dispatch-record').dispatchRecordedAt,4600);assert.ok(!e.effects.some(e=>e.operationId==='uncertain-op'));
});
test('explore adapter distinguishes native local surroundings from route-only, remote and observer evidence without request arguments',()=>{
 const response={contract:'eden-edge/1',tick:88,around:{tick:88,people:[],things:['Commons podium (object) · 9m ahead'],places:[{id:'deck',name:'Commons Deck',m:9,dir:'E'}],untrusted:true},route:{query:'faraway destination',found:false}},native={kind:'world-read',actor:a,origin:'agent',command:'explore',requestedAt:4000,receivedAt:4010,response};
 const x=input();x.timeline.push(native);const r=adaptIndependentProbe(x).participants[a].reads[0];
 assert.equal(r.origin,'agent');assert.equal(r.inspection.kind,'native-local-around');assert.equal(r.inspection.tick,88);assert.equal(r.inspection.facts.length,2);assert.match(r.inspection.evidence[0],/timeline.jsonl#L\d+\/response\/around$/);assert.ok(!JSON.stringify(r.inspection).includes('faraway destination'),'remote route query is never a local observation fact');
 for(const change of [{response:{contract:'eden-edge/1',tick:88,route:{query:'field',found:true}}},{response:{...response,view:{place:'remote'}}},{response:{...response,around:{...response.around,remote:true}}},{response:{...response,around:{...response.around,things:[],places:[]}}},{response:{...response,tick:89}}]){
  const bad=input();bad.timeline.push({...native,...change});assert.equal(adaptIndependentProbe(bad).participants[a].reads[0].inspection,undefined);
 }
 for(const change of [{origin:'observer'},{response:{error:{code:'unavailable'}}},{requestedAt:4020}]){const bad=input();bad.timeline.push({...native,...change});assert.equal(adaptIndependentProbe(bad).participants[a].reads.length,0);}
});
test('fixture body endpoint samples and explicitly sourced setup receipts survive without inventing a model thread',()=>{
 const x=input();x.run.fixtureActors=[{id:'occupant',soulId:'fixture-soul'}];x.timeline.push({ ...body('occupant',950,'setup-body'),soulId:'fixture-soul'},...Array.from({length:5},(_,i)=>({...body('occupant',1100+i*1000,'fixture-body'),soulId:'fixture-soul'})));
 x.nativeReceipts=[{actor:'occupant',observedAt:940,receipt:{id:'seat-setup',capability:'sit:fixture-seat',phase:'completed'},evidence:['setup.json#/fixture-receipt']}];const e=adaptIndependentProbe(x),fixture=e.fixtureActors.occupant;assert.equal(e.t0,1000);assert.equal(fixture.samples.at(-1).t,5100);assert.equal(fixture.receipts[0].id,'seat-setup');assert.equal(fixture.coverageComplete,false);assert.equal(fixture.threadId,undefined);
});
test('foreign actor/Soul/world journals and unproven source bodies cannot be silently attached',()=>{
 const wrongSoul=input();wrongSoul.journals[a].identity.soul='other';assert.throws(()=>adaptIndependentProbe(wrongSoul),/scope mismatch/);
 const wrongWorld=input();wrongWorld.journals[b].identity.world='other';assert.throws(()=>adaptIndependentProbe(wrongWorld),/scope mismatch/);
 const wrongBody=input();wrongBody.timeline[0].soulId='foreign';assert.throws(()=>adaptIndependentProbe(wrongBody),/scope mismatch/);
 const uncertain=input();uncertain.timeline.find(r=>r.kind==='body').source='lastReceipt';assert.equal(adaptIndependentProbe(uncertain).participants[a].samples.find(s=>s.t===1000).currentBody,false);
 const wrongCanonical=input();wrongCanonical.nativeEffects=[{id:'sp_canonical',actor:b,type:'speech',at:1500,evidence:['public-speech.json#/conflict']}];assert.throws(()=>adaptIndependentProbe(wrongCanonical),/Conflicting native effect/);
 const wrongReceipt=input();wrongReceipt.journals[a].events[2].payload.data.receipt.capability='read:other';assert.throws(()=>adaptIndependentProbe(wrongReceipt),/receipt identity\/scope conflict/);
});
test('artifact loader reads SQLite without migrations or mutations and preserves physical JSONL line pointers',t=>{
 const out=mkdtempSync(join(tmpdir(),'continuity-adapter-'));t.after(()=>rmSync(out,{recursive:true,force:true}));const x=input();writeFileSync(join(out,'run.json'),JSON.stringify(x.run));writeFileSync(join(out,'timeline.jsonl'),'\n'+x.timeline.map(r=>JSON.stringify(r)).join('\n')+'\n');writeFileSync(join(out,'.eden-agent.json'),'DO NOT READ THIS CREDENTIAL CANARY');
 const snapshots=[];
 for(const actor of [a,b]){const folder=join(out,actor,'runtime');mkdirSync(folder,{recursive:true});const file=join(folder,'continuity.sqlite'),db=new DatabaseSync(file),j=x.journals[actor];db.exec('CREATE TABLE identity(singleton INTEGER PRIMARY KEY,world TEXT,soul TEXT);CREATE TABLE events(seq INTEGER PRIMARY KEY,source TEXT,event_id TEXT,payload TEXT,received_at INTEGER,handled_at INTEGER);CREATE TABLE operations(id TEXT,request TEXT,response TEXT,status TEXT,at INTEGER)');db.prepare('INSERT INTO identity VALUES(1,?,?)').run(j.identity.world,j.identity.soul);for(const r of j.events)db.prepare('INSERT INTO events VALUES(?,?,?,?,?,?)').run(r.seq,r.source,r.event_id,JSON.stringify(r.payload),r.received_at,r.handled_at);for(const r of j.operations)db.prepare('INSERT INTO operations VALUES(?,?,?,?,?)').run(r.id,JSON.stringify(r.request),JSON.stringify(r.response),r.status,r.at);db.close();snapshots.push([file,readFileSync(file)]);}
 const e=readIndependentProbeEvidence(out,{scenarioId:x.scenarioId});assert.equal(e.t0,1000);assert.equal(e.participants[a].samples[0].source,'timeline.jsonl#L2');assert.equal(e.notifications[0].eventId,'c_1');assert.ok(!JSON.stringify(e).includes('CREDENTIAL CANARY'));for(const [file,before] of snapshots)assert.deepEqual(readFileSync(file),before,'read-only extraction must not migrate or rewrite runtime journal');
});
test('agent read sidecar keeps its source and refuses foreign Soul evidence',t=>{
 const out=mkdtempSync(join(tmpdir(),'continuity-read-evidence-'));t.after(()=>rmSync(out,{recursive:true,force:true}));
 const run={worldId:'w',startedAt:1000,seconds:1,actors:[{id:a,soulId:'soul-'+a,agentEvidence:'agent-evidence.jsonl'}]};
 mkdirSync(join(out,a));writeFileSync(join(out,'run.json'),JSON.stringify(run));writeFileSync(join(out,'timeline.jsonl'),'');
 const path=join(out,a,'agent-evidence.jsonl'),row={kind:'world-read',origin:'agent',worldId:'w',soulId:'soul-'+a,command:'here',requestedAt:1100,receivedAt:1200,response:{here:{me:{pos:[0,0]}}}};
 writeFileSync(path,JSON.stringify(row)+'\n');
 const e=readIndependentProbeEvidence(out,{scenarioId:'eden-reading-duo'});
 assert.deepEqual(e.participants[a].reads,[{command:'here',origin:'agent',at:1200,requestedAt:1100,evidence:[a+'/agent-evidence.jsonl#L1']}]);
 assert.equal(e.participants[a].samples.length,0,'agent reads are not invented observer body samples');
 writeFileSync(path,JSON.stringify({...row,soulId:'foreign'})+'\n');
 assert.throws(()=>readIndependentProbeEvidence(out),/world\/Soul scope mismatch/);
});
test('adapter preserves explicit most-specific field membership and level provenance without promoting ancestry',()=>{
 const x=input(),row=x.timeline.find(r=>r.actor===a&&r.kind==='body'&&r.receivedAt===1000);row.me.place='mimos';row.me.placePath=['mimos','field'];
 let s=adaptIndependentProbe(x).participants[a].samples.find(s=>s.t===1000);assert.equal(s.place,'mimos');assert.equal(s.placeProvenance,'explicit-native-most-specific-place');assert.equal(s.levelProvenance,'native-place-membership');assert.equal(s.level,null);
 row.me.level=1;s=adaptIndependentProbe(x).participants[a].samples.find(s=>s.t===1000);assert.equal(s.level,1);assert.equal(s.levelProvenance,'explicit-native-level');
 delete row.source;s=adaptIndependentProbe(x).participants[a].samples.find(s=>s.t===1000);assert.equal(s.placeProvenance,'unknown');
 const plain=adaptIndependentProbe(input());assert.equal(plain.fieldReturnBinding,undefined);assert.equal(plain.errandReports,undefined);assert.equal(plain.worldId,'world-1');
 x.annotations={fieldReturnBinding:{worldId:'world-1',evidence:['preflight#field']},errandReports:[{actor:a,effectId:'sp_canonical',readSource:'source',grounded:true,evidence:['review#report']}]};const annotated=adaptIndependentProbe(x);assert.deepEqual(annotated.fieldReturnBinding,x.annotations.fieldReturnBinding);assert.deepEqual(annotated.errandReports,x.annotations.errandReports);
});

test('common runner release and native-only response stay observable without a managed journal',()=>{
 const x=input();x.run.arm='existing-headless-seat';x.journals={};
 x.timeline.find(r=>r.kind==='controller-release').kind='actor-release';
 x.expectedNotifications=[{actor:a,source:'world',eventId:'c_native',createdAt:1200,evidence:['native.jsonl#L1']}];
 x.nativeEffects=[{actor:a,id:'reply-native',type:'speech',at:2400,evidence:['native.jsonl#L2']}];
 x.responses=[{actor:a,source:'world',eventId:'c_native',effectId:'reply-native',evidence:['review.json#/reply']}];
 x.audits={healthyWindows:[{actor:a,from:1000,to:5000,evidence:['health.json#/window']}]};
 x.annotations={effectAudit:{version:'explicit-audit',evidence:['review.json#/effects']}};
 const e=adaptIndependentProbe(x),n=e.notifications[0];
 assert.equal(e.adaptation.controllerReleases.length,1);assert.equal(n.healthyRunning,true);
 assert.equal(n.createdAt,1200);assert.equal(n.firstRelevantEffectAt,2400);assert.equal(n.persistedAt,null);assert.equal(n.notifiedAt,null);
 assert.deepEqual(e.effectAudit,x.annotations.effectAudit);
 const score=scoreContinuity({fixtures,oracles,evidence:e});
 assert.equal(score.rows.find(r=>r.id==='notification:c_native:visible-response').status,'pass');
 assert.equal(score.rows.find(r=>r.id==='notification:c_native:receive').status,'unknown');
 x.expectedNotifications[0].evidence=[];assert.equal(adaptIndependentProbe(x).notifications[0].healthyRunning,undefined);
});

test('captured receipt events preserve native terminal time while later database snapshots remain observation-only',()=>{
 const x=input();x.journals={};const receipt={id:'native-receipt',capability:'read:here',phase:'completed'};
 x.nativeReceipts=[{actor:a,receipt,observedAt:4800,evidence:['native-snapshots.jsonl#L2']}];
 assert.equal(adaptIndependentProbe(x).participants[a].receipts[0].observedEndedAt,null);
 x.nativeReceipts.push({actor:a,receipt,kind:'native-receipt-event',observedAt:4200,evidence:['native-capture.jsonl#L9']});
 const r=adaptIndependentProbe(x).participants[a].receipts[0];assert.equal(r.observedEndedAt,4200);assert.equal(r.timestampEvidence.terminal.kind,'native-receipt-event');assert.equal(r.timestampEvidence.terminal.source,'native-capture.jsonl#L9');
 x.nativeReceipts[1].evidence=[];assert.equal(adaptIndependentProbe(x).participants[a].receipts[0].observedEndedAt,null);
});
