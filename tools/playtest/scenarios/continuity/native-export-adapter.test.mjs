import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,realpathSync,mkdirSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readNativeExportInputs} from './native-export-adapter.mjs';
import {adaptIndependentProbe} from './evidence.mjs';
import {observedHolds} from './oracle.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const keys={edge_comms_speech:['id'],edge_comms_turns:['conversation_id','seq'],edge_comms_conversations:['id'],edge_comms_stream:['soul_id','seq'],edge_comms_object_log:['object_id','version'],edge_receipts_v1:['receipt_id'],soul_inbox_queue_v1:['scope','owner','n'],edge_idempotency_v1:['soul_id','route','key']};
function fixture(t){
 const root=realpathSync(mkdtempSync(join(tmpdir(),'native-inputs-'))),captureDirectory=join(root,'capture'),exportDirectory=join(root,'export');mkdirSync(captureDirectory);mkdirSync(exportDirectory);t.after(()=>rmSync(root,{recursive:true,force:true}));
 const run={runId:'trial-1',worldId:'world-1',startedAt:1000,cutoffAt:3000,actors:[{id:'a',soulId:'soul-a'},{id:'b',soulId:'soul-b',releaseOffsetSec:.5}],fixtureActors:[]};
 const scope={schema:'continuity-native-capture/1',runId:run.runId,worldId:run.worldId,epoch:'epoch-1',soulIds:['soul-a','soul-b'],bindings:[{soulId:'soul-a',bodyId:'body-a',owner:'owner-a'},{soulId:'soul-b',bodyId:'body-b',owner:'owner-b'}],healthy:true,startedAt:900};
 const coverage={schema:'continuity-native-coverage/1',runId:run.runId,worldId:run.worldId,snapshotId:'final',from:1000,to:3000,status:'pass',missing:[],evidence:['native-snapshots.jsonl','native-capture.jsonl']},events=[],rows=[];
 const row=(table,value,snapshotId='early')=>rows.push({table,row:{world_id:run.worldId,...value},snapshotId});
 const event=(soulId,event)=>events.push({kind:'recipient-event',soulId,seq:Number(event.id.slice(2)),event});
 const publicEvent=event=>events.push({kind:'public-effect',event});
 const write=()=>{
  const all=[{kind:'capture-start'},...events,{kind:'capture-heartbeat'}];let last='';const lines=all.map((r,i)=>{const record={schema:'continuity-native-record/1',runId:run.runId,worldId:run.worldId,epoch:scope.epoch,index:i+1,observedAt:900+i,kind:r.kind,...r,previousHash:last};last=sha(JSON.stringify(record));return JSON.stringify({...record,hash:last});});writeFileSync(join(captureDirectory,'native-capture.jsonl'),lines.join('\n')+'\n');writeFileSync(join(captureDirectory,'capture-status.json'),JSON.stringify({...scope,index:lines.length,lastHash:last}));
  const output=rows.map(({table,row,snapshotId})=>({schema:'continuity-native-row/1',snapshotId,requestedAt:snapshotId==='early'?1800:run.cutoffAt,observedAt:snapshotId==='early'?1850:run.cutoffAt+100,table,key:JSON.stringify([run.worldId,...keys[table].map(k=>row[k])]),row,sha256:sha(JSON.stringify(row))}));output.push({schema:'continuity-native-snapshot/1',snapshotId:'early',requestedAt:1800,receivedAt:1900},{schema:'continuity-native-snapshot/1',snapshotId:'final',requestedAt:run.cutoffAt,receivedAt:run.cutoffAt+200});
  const data=output.map(r=>JSON.stringify(r)).join('\n')+'\n';writeFileSync(join(exportDirectory,'native-snapshots.jsonl'),data);writeFileSync(join(exportDirectory,'export-status.json'),JSON.stringify({schema:'continuity-native-export/1',runId:run.runId,worldId:run.worldId,epoch:scope.epoch,bytes:Buffer.byteLength(data),rows:new Set(output.filter(r=>r.table).map(r=>r.table+':'+r.key)).size,coverage}));
 };
 const read=options=>{write();return readNativeExportInputs({run,captureDirectory,exportDirectory,coverage,...options});};
 const speech=(id,soul_id='soul-a',at=1200,text='Native words')=>row('edge_comms_speech',{id,soul_id,tick:1,at,channel:'{"kind":"earshot"}',text,heard_by:'[]'});
 return {root,run,scope,coverage,events,rows,row,event,publicEvent,write,read,speech,captureDirectory,exportDirectory};
}
test('canonical effects, native event receipt phases and mutable versions preserve exact scoped source identities',t=>{
 const f=fixture(t);f.speech('sp-zero');f.publicEvent({kind:'speech',id:'sp-zero',at:1210,from:{soulId:'soul-a'},text:'Native words',heardBy:[],channel:{kind:'earshot'}});
 f.row('edge_comms_conversations',{id:'cv-one',created_at:1300,body:'{"createdBy":"soul-a"}'});f.row('edge_comms_turns',{conversation_id:'cv-one',seq:1,soul_id:'soul-a',tick:1,at:1300,text:'Actual invitation opening'});f.row('edge_comms_turns',{conversation_id:'cv-one',seq:2,soul_id:'soul-b',tick:2,at:1600,text:'Actual native reply'});
 f.publicEvent({kind:'conversation.member',at:1550,conversation:'cv-one',soul:{soulId:'soul-b'},change:'joined'});
 f.row('edge_idempotency_v1',{soul_id:'soul-b',route:'POST /v1/edge/converse',key:'accept-one',hash:'h',status:200,body:'{"accepted":true,"conversation":{"id":"cv-one","role":"member"}}',at:1550});
 f.event('soul-b',{id:'c_1',kind:'conversation.invite',tick:1,at:1500,conversation:'cv-one',text:'Actual invitation opening'});f.event('soul-a',{id:'c_1',kind:'conversation.turn',tick:2,at:1600,conversation:'cv-one',turn:{seq:2,at:1600,from:{soulId:'soul-b'},text:'Actual native reply'}});
 f.row('edge_comms_object_log',{object_id:'obj-one',version:2,soul_id:'soul-a',action:'mark',params:'{"x":1}',tick:3,at:1700});
 for(const phase of ['started','completed'])f.row('edge_receipts_v1',{receipt_id:'r-one',soul_id:'soul-a',capability:'read:here',phase,created_at:1200,detail:'{"chosen":{"seat":"chair#seat"}}'});
 f.event('soul-a',{id:'c_2',kind:'receipt',tick:1,at:1250,receipt:{id:'r-one',capability:'read:here',phase:'started'}});f.event('soul-a',{id:'c_3',kind:'receipt',tick:2,at:1750,receipt:{id:'r-one',capability:'read:here',phase:'completed'}});
 const r=f.read(),effects=r.inputs.nativeEffects;assert.equal(effects.filter(e=>e.id==='sp-zero').length,1);assert.equal(effects.find(e=>e.id==='sp-zero').at,1200,'spectator publication is not canonical speech time');assert.equal(effects.find(e=>e.id==='sp-zero').evidence.length,2);assert.ok(effects.some(e=>e.id==='cv-one:turn:2'&&e.actor==='b'&&e.text==='Actual native reply'));assert.ok(effects.some(e=>e.id==='object:obj-one:version:2'));assert.equal(r.native.publicEvents.length,2);assert.equal(r.native.receiptVersions.length,4);assert.ok(r.inputs.nativeReceipts.some(r=>r.kind==='native-receipt-event'&&r.observedAt===1750));assert.equal(r.inputs.expectedNotifications.length,2);assert.equal(new Set(r.inputs.expectedNotifications.map(n=>n.eventId)).size,1,'per-Soul c_1 identities remain distinct');assert.ok(effects.every(e=>e.respondsToEventId===undefined&&e.operationId===undefined));assert.ok(effects.every(e=>e.evidence.every(p=>p.startsWith(f.root)&&/#L\d+$/.test(p))));assert.equal(effects.filter(e=>e.type==='conversation-turn').length,2,'membership and accept response never create an extra turn');
});
test('source-only coverage cannot manufacture effect/notification completeness, client intake, or causal review',t=>{
 const f=fixture(t);f.speech('sp-alone');const r=f.read();assert.equal(r.mechanical.sourceCoverage,'pass');assert.equal(r.mechanical.status,'unknown');for(const key of ['effectsComplete','notificationsComplete','audits','responses','journals'])assert.equal(r.inputs[key],undefined);assert.ok(r.mechanical.missing.some(x=>x.includes('cardinality')));assert.equal(r.inputs.nativeEffects[0].at,1200);f.coverage.status='unknown';assert.equal(f.read().mechanical.sourceCoverage,'unknown');
});
test('pre-release and after-cutoff effects stay raw; undated live speech never gains an invented creation time',t=>{
 const f=fixture(t);f.speech('sp-before','soul-b',1400);f.speech('sp-after','soul-a',3100);f.speech('sp-inside','soul-b',1600);f.publicEvent({kind:'speech',id:'sp-undated',at:1700,from:{soulId:'soul-a'},text:'Native effect with no canonical row',heardBy:[],channel:{kind:'earshot'}});f.speech('sp-foreign','foreign-soul',1800);
 const r=f.read();assert.deepEqual(r.inputs.nativeEffects.map(e=>e.id),['sp-inside']);assert.equal(r.native.rowVersions.filter(r=>r.table==='edge_comms_speech').length,4);assert.equal(r.native.undatedEffects[0].id,'sp-undated');assert.ok(r.native.foreignAuthorFacts.some(e=>e.id==='sp-foreign'&&e.actor===undefined));assert.ok(r.mechanical.missing.some(x=>x.includes('timestamps')));
});
test('raw speech is not silently treated as addressed; stable source-backed names reuse native classification',t=>{
 const f=fixture(t);f.event('soul-b',{id:'c_1',kind:'speech',at:1600,tick:1,text:'Hello Beatrice, are you ready?',heardBy:2,where:{dist:1}});const unknown=f.read();assert.equal(unknown.inputs.expectedNotifications.length,0);assert.ok(unknown.mechanical.missing.some(x=>x.includes('public-name stability')));
 f.run.actors[1].publicName='Beatrice';f.run.actors[1].nameEvidence=['native-name.json#b'];assert.equal(f.read().inputs.expectedNotifications.length,0,'a manifest name alone is insufficient');
 const known=f.read({nameStabilityAudit:{complete:true,from:1000,to:3000,evidence:['names-audit.json#/stable']}});assert.equal(known.inputs.expectedNotifications[0].eventId,'c_1');assert.ok(known.inputs.expectedNotifications[0].evidence.includes('names-audit.json#/stable'));assert.equal(known.native.recipientEvents[0].classifiedKind,'speech.to-me');assert.ok(!known.mechanical.missing.some(x=>x.includes('public-name stability')));
});
test('native effect, recipient payload, receipt capability and owner immutable identity conflicts are rejected',t=>{
 const f=fixture(t);f.speech('sp-one');f.speech('sp-one','soul-b');assert.throws(()=>f.read(),/EFFECT_IDENTITY_CONFLICT/);f.rows.length=0;
 f.event('soul-a',{id:'c_1',kind:'conversation.turn',at:1600,tick:1,text:'one'});f.event('soul-a',{id:'c_1',kind:'conversation.turn',at:1600,tick:1,text:'different'});assert.throws(()=>f.read(),/RECIPIENT_PAYLOAD_CONFLICT/);f.events.length=0;
 for(const capability of ['read:here','sit:chair'])f.row('edge_receipts_v1',{receipt_id:'r-one',soul_id:'soul-a',capability,phase:'started',created_at:1200,detail:null});assert.throws(()=>f.read(),/RECEIPT_IDENTITY_CONFLICT/);f.rows.length=0;
 for(const id of ['msg-one','msg-two'])f.row('soul_inbox_queue_v1',{scope:'soul:soul-a',owner:'owner-a',n:1,id,text:'native owner request',sent_at:1500});assert.throws(()=>f.read(),/OWNER_IDENTITY_CONFLICT/);f.rows.length=0;
 for(const n of [1,2])f.row('soul_inbox_queue_v1',{scope:'soul:soul-a',owner:'owner-a',n,id:'msg-reused',text:'same text',sent_at:1500});assert.throws(()=>f.read(),/OWNER_IDENTITY_CONFLICT/);
});
test('scopes, hashes, snapshot provenance, coverage and bounded files are checked before normalization',t=>{
 const f=fixture(t);f.speech('sp-one');assert.throws(()=>f.read({run:{...f.run,runId:'other-run'}}),/SOURCE_SCOPE_MISMATCH/);assert.throws(()=>f.read({run:{...f.run,actors:[...f.run.actors,{id:'duplicate',soulId:'soul-a'}]}}),/ACTOR_SCOPE_INVALID/);assert.throws(()=>f.read({maxRows:1}),/BOUND|SCOPE/);assert.throws(()=>f.read({coverage:{...f.coverage,snapshotId:'unseen'}}),/COVERAGE_PROVENANCE/);
 f.write();const path=join(f.exportDirectory,'native-snapshots.jsonl'),raw=readFileSync(path,'utf8');writeFileSync(path,raw.replace('Native words','Wrong! words'));assert.throws(()=>readNativeExportInputs({run:f.run,captureDirectory:f.captureDirectory,exportDirectory:f.exportDirectory,coverage:f.coverage}),/HASH_OR_KEY/);
 f.rows[0].row.world_id='other-world';assert.throws(()=>f.read(),/HASH_OR_KEY/);
});

test('native owner messages retain immutable IDs and outcome versions without inventing client receipt; unsafe columns are refused',t=>{
 const f=fixture(t),base={scope:'soul:soul-a',owner:'owner-a',n:1,id:'msg-one',text:'Original owner task',sent_at:1500};
 f.row('soul_inbox_queue_v1',{...base,acknowledged_at:null,result:null});f.row('soul_inbox_queue_v1',{...base,acknowledged_at:1700,result:'Native accepted report',result_by:'agent',result_at:1750});
 const r=f.read();assert.equal(r.native.ownerMessages.length,2);assert.deepEqual(r.inputs.expectedNotifications.map(n=>[n.actor,n.source,n.eventId,n.createdAt]),[['a','owner','msg-one',1500]]);assert.equal(r.inputs.expectedNotifications[0].persistedAt,undefined);assert.equal(r.native.ownerMessages[1].row.result_by,'agent');
 f.rows[0].row.token_hash='SECRET_COLUMN_CANARY';assert.throws(()=>f.read(),/COLUMN_NOT_ALLOWLISTED/);
});

test('exported stream rows retain exact native cursor and time and reject reserved body overrides',t=>{
 const f=fixture(t);f.row('edge_comms_stream',{soul_id:'soul-a',seq:2,tick:3,at:1600,kind:'conversation.turn',body:'{"conversation":"cv-one","turn":{"seq":1,"at":1600,"from":{"soulId":"soul-b"},"text":"Actual turn"}}'});const r=f.read();assert.equal(r.inputs.expectedNotifications[0].eventId,'c_2');assert.equal(r.inputs.expectedNotifications[0].createdAt,1600);
 f.rows[0].row.body='{"at":100,"id":"c_999"}';assert.throws(()=>f.read(),/RESERVED_FIELD_CONFLICT/);
});

function compoundRead(f){
 const capability='book-club:book-club.chair',id='r-club';
 f.row('edge_receipts_v1',{receipt_id:id,soul_id:'soul-a',capability,phase:'started',program_id:'p1',created_at:1100,detail:'{"chosen":{"target":"book-club.chair"}}'});
 f.event('soul-a',{id:'c_1',kind:'receipt',tick:1,at:1200,receipt:{id,capability,phase:'started'}});
 const event={id:'c_2',kind:'activity.observed',tick:2,at:1501,observedAt:1500,worldId:'world-1',soulId:'soul-a',bodyId:'body-a',observation:'native-current-body',untrusted:false,receipt:{id,capability,phase:'started'},programId:'p1',action:{id:'a1',verb:'pose_v1',status:'executing',phase:'together'},body:{activity:'read',posture:'seated',occupiedSeats:['chair#seat']}};
 f.event('soul-a',event);
 f.event('soul-a',{id:'c_3',kind:'receipt',tick:3,at:2900,receipt:{id,capability,phase:'completed'}});
 return event;
}
test('compound reading preserves raw identity and joins only exact native body/receipt/program/slot proof',t=>{
 const f=fixture(t),event=compoundRead(f),r=f.read(),versions=r.inputs.nativeReceipts;
 assert.equal(r.mechanical.readingNormalization,'native-reading-lifecycle/2');
 assert.ok(versions.every(v=>v.receipt.capability==='book-club:book-club.chair'));
 assert.equal(versions.flatMap(v=>v.receipt.nativeReadLifecycles).length,1,'proof is attached once across mutable receipt versions');
 const proof=versions[0].receipt.nativeReadLifecycles[0];assert.deepEqual(proof.event,event);assert.ok(proof.evidence[0].includes('native-capture.jsonl#L'));assert.ok(proof.receiptEvidence[0].includes('native-snapshots.jsonl#L'));
 assert.equal(r.native.receiptVersions[0].receipt.programId,'p1');assert.ok(r.native.receiptVersions.every(v=>v.receipt.nativeReadLifecycles===undefined),'raw captured versions remain separate from normalized proof');
 assert.deepEqual(r.native.recipientEvents.find(f=>f.event.id==='c_2').event,event,'raw event is preserved');
});
test('compound reading rejects wrong native identity, program, nonread or ambiguous/unqualified slot rather than guessing capability aliases',t=>{
 const mutations=[e=>e.receipt.id='wrong',e=>e.receipt.capability='read:chair',e=>e.programId='wrong',e=>e.soulId='soul-b',e=>e.worldId='other',e=>e.bodyId='body-b',e=>e.body.activity='sit',e=>e.body.posture='standing',e=>e.body.occupiedSeats=['chair'],e=>e.body.occupiedSeats={length:1,0:'chair#seat'},e=>e.body.occupiedSeats=['chair#seat','other#seat'],e=>e.untrusted=true,e=>e.observation='model-text',e=>e.action.status='done',e=>e.action.verb='say',e=>e.observedAt=1600];
 for(const mutate of mutations){const f=fixture(t),event=compoundRead(f);mutate(event);assert.ok(f.read().inputs.nativeReceipts.every(v=>!v.receipt.nativeReadLifecycles.length));}
 const f=fixture(t);compoundRead(f);f.rows[0].row.program_id=null;assert.ok(f.read().inputs.nativeReceipts.every(v=>!v.receipt.nativeReadLifecycles.length),'an event program is not its own ledger corroboration');
 f.rows[0].row.program_id='p1';f.row('edge_receipts_v1',{...f.rows[0].row,program_id:'p2'});assert.ok(f.read().inputs.nativeReceipts.every(v=>!v.receipt.nativeReadLifecycles.length),'contradictory ledger programs grant no lifecycle');
});
test('captured compound read survives terminal events omitting program and reaches unchanged body-hold oracle',t=>{
 const f=fixture(t);f.run.t0=1000;f.run.cutoffAt=40000;f.coverage.to=40000;compoundRead(f);f.events.find(r=>r.event.id==='c_3').event.at=38000;
 const native=f.read(),timeline=Array.from({length:40},(_,i)=>({kind:'body',source:'here',actor:'a',soulId:'soul-a',requestedAt:1000+i*1000,receivedAt:1000+i*1000,me:{pos:[0,0],posture:'seated',seat:'chair#seat',activity:'book-club',actualActivity:{kind:i>0&&i<37?'read':'sit'}}}));
 const e=adaptIndependentProbe({run:f.run,timeline,nativeReceipts:native.inputs.nativeReceipts,audits:{participants:{a:{complete:true,from:1000,to:40000,receiptsComplete:true,evidence:['audit.json#/a']}}}}),r=e.participants.a.receipts[0];
 assert.equal(r.phase,'completed');assert.equal(r.programId,'p1');assert.equal(r.observedAcceptedAt,1200);assert.equal(r.observedEndedAt,38000);assert.equal(r.nativeReadLifecycles.length,1);assert.equal(r.capability,'book-club:book-club.chair');assert.equal(e.participants.a.coverageComplete,true);
 const holds=observedHolds({...e.participants.a,bindings:{chair:{entityId:'chair',slot:'seat'}},phase:{region:{pos:[0,0],radiusM:2},holdSec:30,postures:['seated'],activities:['read'],requireSeatRefs:['chair'],receipt:{verb:'read',targetRefs:['chair']}},from:1000,to:40000});
 assert.equal(holds.status,'pass');assert.equal(holds.windows[0].from,2000);assert.equal(holds.windows[0].to,37000);
});
