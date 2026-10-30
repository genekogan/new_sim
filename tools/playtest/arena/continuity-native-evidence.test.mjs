import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {eventsFixture} from '../../../apps/server/src/edge/events/testing.ts';
import {AgentInbox} from '../../../apps/server/src/inbox.ts';
import {captureNativeEvidence} from '../../../apps/server/src/edge/events/evidence-capture.ts';
import {createNativeEvidenceExporter,readNativeCapture} from './continuity-native-evidence.mjs';
async function setup(t,{limits={},writer}={}){
 const f=eventsFixture(['A','B','Foreign'],{comms:{retainEvents:2,fetch:null,sweepMs:0}}),root=realpathSync(mkdtempSync(join(tmpdir(),'native-export-'))),captureDirectory=join(root,'capture'),directory=join(root,'export'),configPath=join(root,'scope.json');
 f.db.db.exec('ALTER TABLE edge_receipts_v1 ADD COLUMN detail TEXT;CREATE TABLE edge_refusals_v1(world_id TEXT,at INTEGER,tick INTEGER,soul_id TEXT,verb TEXT,capability TEXT,code TEXT,reason TEXT,x REAL,z REAL)');new AgentInbox(f.db,f.host.worldId);
 const scope={runId:'run-test',worldId:f.host.worldId,soulIds:[f.id('A'),f.id('B')]};writeFileSync(configPath,JSON.stringify({...scope,directory:captureDirectory,...limits}),{mode:0o600});
 const capture=captureNativeEvidence({gate:{configPath,devAuth:true,bindHost:'127.0.0.1'},db:f.db,worldId:scope.worldId,comms:f.runtime,now:()=>f.clock.now,heartbeatMs:10,...(writer?{write:writer}:{})});
 let exporter;const start=()=>exporter=createNativeEvidenceExporter({databasePath:f.db.path,captureDirectory,directory,...scope,now:()=>f.clock.now});
 t.after(()=>{exporter?.close();capture.close();f.destroy();rmSync(root,{recursive:true,force:true});});
 const heartbeat=async()=>{const g=capture.status().generation;for(let n=0;n<100&&capture.status().generation<=g;n++)await new Promise(r=>setTimeout(r,2));assert.ok(capture.status().generation>g);};
 const rows=()=>readFileSync(join(directory,'native-snapshots.jsonl'),'utf8').trim().split('\n').map(l=>JSON.parse(l)).filter(r=>r.schema==='continuity-native-row/1');
 return {...f,root,captureDirectory,directory,scope,capture,start,heartbeat,rows};
}
test('readonly canonical export includes zero-hearer speech and real turns with source keys, excluding foreign records and credential columns',async t=>{
 const f=await setup(t);f.at('A',0,0);f.at('B',100,0);f.at('Foreign',200,0);
 f.db.db.prepare('UPDATE souls SET token_hash=? WHERE id=?').run('CREDENTIAL_CANARY',f.id('A'));
 f.db.db.prepare('INSERT INTO edge_comms_subscriptions(world_id,soul_id,url,secret,cursor,created_at) VALUES(?,?,?,?,?,?)').run(f.scope.worldId,f.id('A'),'http://CREDENTIAL_CANARY','CREDENTIAL_CANARY',0,0);
 const said=await f.post('A','/v1/edge/say',{text:'One isolated native observation'});assert.equal(said.body.said.heardBy,0);
 await f.post('Foreign','/v1/edge/say',{text:'FOREIGN_PRIVATE_CANARY'});
 f.at('B',1,0);const invite=await f.post('A','/v1/edge/converse',{op:'start',with:[f.id('B')],text:'Native opening'}),cv=invite.body.conversation.id;
 await f.post('B','/v1/edge/converse',{op:'accept',conversation:cv,text:'IGNORED_ACCEPT_CANARY'});await f.post('B','/v1/edge/converse',{op:'say',conversation:cv,text:'Native actual reply'});
 const dbBefore=readFileSync(f.db.path),walPath=f.db.path+'-wal',walBefore=existsSync(walPath)?readFileSync(walPath):null;
 const exporter=f.start(),snapshot=exporter.poll();await f.heartbeat();const audit=exporter.audit(snapshot,{t0:f.capture.status().startedAt,cutoffAt:f.clock.now});assert.equal(audit.status,'pass',JSON.stringify(audit));
 const rows=f.rows(),text=JSON.stringify(rows);assert.ok(rows.some(r=>r.table==='edge_comms_speech'&&r.row.id===said.body.said.id));assert.ok(rows.some(r=>r.table==='edge_comms_turns'&&r.row.conversation_id===cv&&r.row.text==='Native actual reply'));
 assert.ok(!text.includes('CREDENTIAL_CANARY'));assert.ok(!text.includes('FOREIGN_PRIVATE_CANARY'));assert.ok(!text.includes('IGNORED_ACCEPT_CANARY'));assert.ok(rows.every(r=>r.row.world_id===f.scope.worldId));assert.ok(rows.every(r=>r.key&&r.snapshotId&&r.sha256));
 assert.deepEqual(readFileSync(f.db.path),dbBefore);if(walBefore)assert.deepEqual(readFileSync(walPath),walBefore,'readonly extraction never migrates or writes the native database');
 assert.equal(audit.effectsComplete,undefined);assert.match(audit.limits,/qualification pass/);
});
test('all committed recipient sequences survive pruning; a final snapshot needs a later healthy capture heartbeat',async t=>{
 const f=await setup(t),exporter=f.start();for(let n=1;n<=50;n++)f.runtime.streams.deliver(f.id('A'),'world',n,{text:'event-'+n});
 const captured=readNativeCapture(f.captureDirectory);assert.equal(captured.records.filter(r=>r.kind==='recipient-event').length,0,'status is a sealed prefix until heartbeat advances it');
 const snapshot=exporter.poll();assert.ok(snapshot.heads.find(h=>h.soul_id===f.id('A')).floor>0);assert.equal(exporter.audit(snapshot,{t0:f.clock.now,cutoffAt:f.clock.now}).status,'unknown');
 await f.heartbeat();const audit=exporter.audit(snapshot,{t0:f.clock.now,cutoffAt:f.clock.now});assert.equal(audit.status,'pass',JSON.stringify(audit));assert.equal(readNativeCapture(f.captureDirectory).records.filter(r=>r.kind==='recipient-event').length,50);
});
test('writer overflow or a pruned uncaptured interval invalidates coverage even if some native rows remain',async t=>{
 const f=await setup(t,{limits:{maxEvents:2}}),exporter=f.start();for(let n=1;n<=50;n++)f.runtime.streams.deliver(f.id('A'),'world',n,{text:'event-'+n});
 assert.equal(f.capture.status().healthy,false);const snapshot=exporter.poll();await f.heartbeat();const audit=exporter.audit(snapshot,{t0:f.clock.now,cutoffAt:f.clock.now});assert.equal(audit.status,'unknown');assert.ok(audit.missing.some(s=>s.includes('sticky capture failure')));assert.ok(audit.missing.some(s=>s.includes('stream gap')));
});
test('equal timestamps do not drop canonical rows or mutable versions; missing sources never silently certify completeness',async t=>{
 const f=await setup(t),exporter=f.start();const one=await f.post('A','/v1/edge/say',{text:'first same-time effect'});f.db.db.prepare('INSERT INTO edge_receipts_v1(world_id,receipt_id,soul_id,capability,phase,accepted_tick,created_at,detail) VALUES(?,?,?,?,?,?,?,?)').run(f.scope.worldId,'r-version',f.id('A'),'read:here','started',1,f.clock.now,null);exporter.poll();f.db.db.prepare("UPDATE edge_receipts_v1 SET phase='completed' WHERE receipt_id='r-version'").run();const two=await f.post('A','/v1/edge/say',{text:'second same-time effect'});const snapshot=exporter.poll();await f.heartbeat();assert.equal(exporter.audit(snapshot,{t0:f.clock.now,cutoffAt:f.clock.now}).status,'pass');
 const speech=f.rows().filter(r=>r.table==='edge_comms_speech');assert.ok(speech.some(r=>r.row.id===one.body.said.id));assert.ok(speech.some(r=>r.row.id===two.body.said.id));assert.equal(new Set(speech.map(r=>r.row.at)).size,1);assert.deepEqual(f.rows().filter(r=>r.table==='edge_receipts_v1'&&r.row.receipt_id==='r-version').map(r=>r.row.phase),['started','completed']);
 f.db.db.exec('DROP TABLE edge_idempotency_v1');const incomplete=exporter.poll();await f.heartbeat();const audit=exporter.audit(incomplete,{t0:f.clock.now,cutoffAt:f.clock.now});assert.equal(audit.status,'unknown');assert.ok(audit.missing.some(s=>s.includes('edge_idempotency_v1')));
});
test('capture tampering, source scope mismatch and a cutoff not yet observed stay unqualified',async t=>{
 const f=await setup(t),exporter=f.start(),snapshot=exporter.poll();await f.heartbeat();assert.equal(exporter.audit(snapshot,{t0:f.clock.now,cutoffAt:f.clock.now+1}).status,'unknown');
 assert.throws(()=>createNativeEvidenceExporter({databasePath:f.db.path,captureDirectory:f.captureDirectory,directory:join(f.root,'foreign'),...f.scope,worldId:'wrong-world'}),/SCOPE_MISMATCH/);
 const path=join(f.captureDirectory,'native-capture.jsonl'),raw=readFileSync(path,'utf8');writeFileSync(path,raw.replace('capture-start','capture-false'));
 assert.throws(()=>readNativeCapture(f.captureDirectory),/CHAIN_MISMATCH/);assert.equal(exporter.audit(snapshot,{t0:f.clock.now,cutoffAt:f.clock.now}).status,'unknown');
});

test('owner queue pruning gaps and changed native owner binding cannot claim full coverage',async t=>{
 const f=await setup(t),exporter=f.start();f.db.db.prepare('INSERT INTO soul_inbox_queue_v1(world_id,scope,owner,n,id,text,sent_at) VALUES(?,?,?,?,?,?,?)').run(f.scope.worldId,'soul:'+f.id('A'),'dev:A',2,'msg-2','second native owner request',f.clock.now);const snapshot=exporter.poll();await f.heartbeat();const coverage=exporter.audit(snapshot,{t0:f.clock.now,cutoffAt:f.clock.now});assert.equal(coverage.status,'unknown');assert.ok(coverage.missing.some(s=>s.includes('owner queue gap')));f.db.db.prepare('UPDATE souls SET owner=? WHERE id=?').run('dev:new-owner',f.id('A'));assert.throws(()=>exporter.poll(),/SOUL_SCOPE_CHANGED/);
});

test('idempotency export filters response routes before reading bodies',async t=>{
 const f=await setup(t),insert=f.db.db.prepare('INSERT INTO edge_idempotency_v1(world_id,soul_id,route,key,hash,status,body,at) VALUES(?,?,?,?,?,?,?,?)');
 for(const route of ['POST /v1/edge/body','POST /v1/edge/plan/private-export','PATCH /v1/edge/private'])insert.run(f.scope.worldId,f.id('A'),route,'unsafe','h',200,JSON.stringify({private:'UNSUPPORTED_ROUTE_CANARY'}),f.clock.now);
 for(const route of ['POST /v1/edge/act','POST /v1/edge/say','POST /v1/edge/converse','POST /v1/edge/plan','PATCH /v1/edge/plan/p_1','DELETE /v1/edge/plan/p_1','POST /v1/edge/objects/o_1/act'])insert.run(f.scope.worldId,f.id('A'),route,'safe','h',200,'{"accepted":true}',f.clock.now);
 const exporter=f.start(),snapshot=exporter.poll();await f.heartbeat();const coverage=exporter.audit(snapshot,{t0:f.clock.now,cutoffAt:f.clock.now});
 const rows=f.rows().filter(r=>r.table==='edge_idempotency_v1');assert.equal(rows.length,7);assert.ok(!JSON.stringify(f.rows()).includes('UNSUPPORTED_ROUTE_CANARY'));assert.match(coverage.limits,/unsupported-route/);
});

test('historical heartbeat gap is sticky after later regular heartbeats; paused native tick alone is healthy',async t=>{
 const f=await setup(t),exporter=f.start(),t0=f.clock.now;
 for(let i=0;i<6;i++){f.clock.now+=1000;await f.heartbeat();}
 assert.equal(f.capture.status().healthy,true,'capture health does not require native tick progress');
 const healthy=readNativeCapture(f.captureDirectory);assert.ok(healthy.records.filter(r=>r.kind==='capture-heartbeat').length>=6);
 f.clock.now+=6000;await f.heartbeat();assert.equal(f.capture.status().failure,'CAPTURE_HEARTBEAT_GAP');
 for(let i=0;i<2;i++){f.clock.now+=1000;await f.heartbeat();}
 assert.equal(f.capture.status().failure,'CAPTURE_HEARTBEAT_GAP');const snapshot=exporter.poll();await f.heartbeat();const audit=exporter.audit(snapshot,{t0,cutoffAt:f.clock.now});assert.equal(audit.status,'unknown');assert.ok(audit.missing.includes('sticky capture failure'));assert.ok(audit.missing.includes('continuous capture heartbeat interval missing'));
});

test('owner boundary detects observed tail reset without blaming messages arriving after the snapshot',async t=>{
 const f=await setup(t),exporter=f.start(),insert=f.db.db.prepare('INSERT INTO soul_inbox_queue_v1(world_id,scope,owner,n,id,text,sent_at) VALUES(?,?,?,?,?,?,?)'),first=exporter.poll();
 insert.run(f.scope.worldId,'soul:'+f.id('A'),'dev:A',1,'msg-1','native owner task',f.clock.now);await f.heartbeat();assert.equal(exporter.audit(first,{t0:f.clock.now,cutoffAt:f.clock.now}).status,'pass','post-snapshot owner arrival is not a counter reset');
 f.db.db.prepare('DELETE FROM soul_inbox_queue_v1 WHERE world_id=? AND scope=?').run(f.scope.worldId,'soul:'+f.id('A'));const reset=exporter.poll();await f.heartbeat();const audit=exporter.audit(reset,{t0:f.clock.now,cutoffAt:f.clock.now});assert.equal(audit.status,'unknown');assert.ok(audit.missing.some(s=>s.includes('owner queue counter reset')));
});
