import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {commsFixture} from './edge/comms/testing.ts';
import {tx} from './edge/comms/store.ts';
import {captureNativeEvidence,readEvidenceCaptureScope,type CaptureGate} from './edge/events/evidence-capture.ts';
function setup(t:TestContext,limits:Record<string,number>={}){
 const f=commsFixture(['A','B','Foreign'],{retainEvents:2,fetch:null,sweepMs:0}),root=realpathSync(mkdtempSync(join(tmpdir(),'native-capture-'))),configPath=join(root,'scope.json'),directory=join(root,'capture');
 writeFileSync(configPath,JSON.stringify({runId:'run-test',worldId:f.host.worldId,soulIds:[f.id('A'),f.id('B')],directory,...limits}),{mode:0o600});
 const gate:CaptureGate={configPath,devAuth:true,bindHost:'127.0.0.1'};let capture:ReturnType<typeof captureNativeEvidence>|undefined;
 const start=(options:Partial<Parameters<typeof captureNativeEvidence>[0]>={})=>capture=captureNativeEvidence({gate,db:f.db,worldId:f.host.worldId,comms:f.runtime,now:()=>f.clock.now,heartbeatMs:100000,...options});
 t.after(()=>{capture?.close();f.destroy();rmSync(root,{recursive:true,force:true});});
 const records=()=>readFileSync(join(directory,'native-capture.jsonl'),'utf8').trim().split('\n').map(l=>JSON.parse(l));
 return {...f,root,configPath,directory,gate,start,records};
}
test('requested capture fails closed without real dev auth, loopback, exact scope and private config',t=>{
 const f=setup(t);for(const gate of [{...f.gate,devAuth:false},{...f.gate,bindHost:'0.0.0.0'}])assert.throws(()=>readEvidenceCaptureScope(gate,f.host.worldId),/LOOPBACK_DEVAUTH/);
 assert.throws(()=>readEvidenceCaptureScope(f.gate,'other-world'),/SCOPE_INVALID/);assert.equal(existsSync(f.directory),false);
 writeFileSync(f.configPath,JSON.stringify({runId:'r',worldId:f.host.worldId,soulIds:['s_missing'],directory:f.directory}),{mode:0o600});assert.throws(()=>f.start(),/SOUL_SCOPE_INVALID/);assert.equal(existsSync(f.directory),false);
});
test('after-commit capture preserves every scoped recipient even when one committed batch prunes old rows',t=>{
 const f=setup(t),capture=f.start();
 assert.throws(()=>tx(f.db.db,()=>{f.runtime.streams.deliver(f.id('A'),'world',1,{text:'rolled-back'});throw Error('rollback');}),/rollback/);
 assert.equal(f.records().filter(r=>r.kind==='recipient-event').length,0);
 tx(f.db.db,()=>{for(let n=1;n<=50;n++)f.runtime.streams.deliver(f.id('A'),'world',n,{text:'native-'+n});f.runtime.streams.deliver(f.id('Foreign'),'world',1,{text:'FOREIGN_SOURCE_CANARY'});});
 const events=f.records().filter(r=>r.kind==='recipient-event');assert.deepEqual(events.map(r=>r.seq),Array.from({length:50},(_,i)=>i+1));assert.ok(capture.status().heads.find(h=>h.soulId===f.id('A'))!.floor>0);assert.equal(capture.status().healthy,true);
 assert.ok(!JSON.stringify(f.records()).includes('FOREIGN_SOURCE_CANARY'));assert.ok(!JSON.stringify(f.records()).includes('rolled-back'));
 capture.close();const end=f.records().at(-1);assert.equal(end.kind,'capture-end');assert.equal(end.endHeads.find((h:any)=>h.soulId===f.id('A')).head,50);
 const size=readFileSync(join(f.directory,'native-capture.jsonl')).length;f.runtime.streams.deliver(f.id('A'),'world',60,{text:'after-unsubscribe'});assert.equal(readFileSync(join(f.directory,'native-capture.jsonl')).length,size);
});
test('zero-hearer speech and actual conversation turn are captured; accept text never becomes a spoken turn',async t=>{
 const f=setup(t);f.start();f.at('A',0,0);f.at('B',100,0);f.at('Foreign',200,0);
 const spoken=await f.post('A','/v1/edge/say',{text:'Native isolated speech'});assert.equal(spoken.status,200);assert.equal(spoken.body.said.heardBy,0);
 f.at('B',1,0);const start=await f.post('A','/v1/edge/converse',{op:'start',with:[f.id('B')],text:'Actual invitation opening'});assert.equal(start.status,200);const id=start.body.conversation.id;
 const joined=await f.post('B','/v1/edge/converse',{op:'accept',conversation:id,text:'ACCEPT_TEXT_MUST_NOT_BECOME_TURN'});assert.equal(joined.status,200);
 await f.post('B','/v1/edge/converse',{op:'say',conversation:id,text:'Actual native reply'});
 const records=f.records(),effects=records.filter(r=>r.kind==='public-effect');assert.ok(effects.some(r=>r.event.id===spoken.body.said.id));assert.ok(effects.some(r=>r.event.kind==='conversation.turn'&&r.event.turn.text==='Actual native reply'));assert.ok(!JSON.stringify(records).includes('ACCEPT_TEXT_MUST_NOT_BECOME_TURN'));
 const recipient=records.find(r=>r.kind==='recipient-event'&&r.event.kind==='conversation.turn');assert.ok(recipient);assert.ok(recipient.event.id.startsWith('c_'));assert.equal(recipient.event.conversation,id);
});
test('append exception and overflow are sticky coverage invalidation, never swallowed as healthy success',t=>{
 const f=setup(t);let reject=false;const capture=f.start({write:(fd,buffer,offset,length)=>{if(reject)throw Error('TOKEN_SHOULD_NOT_ESCAPE');return requireWrite(fd,buffer,offset,length);}});
 reject=true;f.runtime.streams.deliver(f.id('A'),'world',1,{text:'safe native event'});assert.equal(capture.status().healthy,false);assert.equal(capture.status().failure,'CAPTURE_APPEND_FAILED');
 const status=readFileSync(join(f.directory,'capture-status.json'),'utf8');assert.ok(!status.includes('TOKEN_SHOULD_NOT_ESCAPE'));capture.close();assert.equal(capture.status().healthy,false);
});
import {writeSync as requireWrite} from 'node:fs';
test('finite event bound invalidates capture without stopping committed native delivery',t=>{
 const f=setup(t,{maxEvents:2}),capture=f.start();f.runtime.streams.deliver(f.id('A'),'world',1,{text:'one'});f.runtime.streams.deliver(f.id('A'),'world',2,{text:'two'});
 assert.equal(capture.status().failure,'CAPTURE_OVERFLOW');assert.equal(f.runtime.streams.head(f.id('A')),2);assert.equal(capture.status().healthy,false);
});

test('owner/body binding change invalidates capture before exporting the new owner private event',t=>{
 const f=setup(t),capture=f.start();f.db.db.prepare('UPDATE souls SET owner=? WHERE id=?').run('dev:new-owner',f.id('A'));f.runtime.streams.deliver(f.id('A'),'world',1,{text:'NEW_OWNER_PRIVATE_CANARY'});assert.equal(capture.status().failure,'CAPTURE_SOUL_SCOPE_CHANGED');assert.ok(!JSON.stringify(f.records()).includes('NEW_OWNER_PRIVATE_CANARY'));
});
