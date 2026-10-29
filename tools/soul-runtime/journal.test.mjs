import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {openJournal} from './journal.mjs';
const identity={worldId:'test-world',soulId:'test-soul'};
const event={id:'c_1',kind:'conversation.turn',text:'Are you coming?'};
function fixture(t){const directory=mkdtempSync(join(tmpdir(),'sim-journal-'));const handles=[];t.after(()=>{for(const h of handles)try{h.close()}catch{}rmSync(directory,{recursive:true,force:true})});return {directory,open(){const h=openJournal(directory,identity);handles.push(h);return h;}};}

test('process death after ingest retains an unhandled message and matching cursor',t=>{
 const f=fixture(t);const moduleUrl=new URL('./journal.mjs',import.meta.url).href;
 const child=spawnSync(process.execPath,['--input-type=module','-e',`import {openJournal} from ${JSON.stringify(moduleUrl)};const j=openJournal(process.argv[1],${JSON.stringify(identity)});j.ingest({source:'world',after:null,cursor:'c_1',events:[${JSON.stringify(event)}]});process.kill(process.pid,'SIGKILL');`,f.directory],{encoding:'utf8',timeout:10000});
 assert.equal(child.signal,'SIGKILL');const j=f.open();assert.equal(j.cursor('world'),'c_1');assert.deepEqual(j.pending().map(x=>x.event),[event]);
 j.handled('world','c_1','conversation response reconciled');j.close();const reopened=f.open();assert.equal(reopened.pending().length,0);assert.equal(reopened.cursor('world'),'c_1');
});
test('duplicate page is deduplicated; a changed event rolls the whole batch and cursor back',t=>{
 const j=fixture(t).open();j.ingest({source:'world',after:null,cursor:'c_1',events:[event]});
 assert.equal(j.ingest({source:'world',after:'c_1',cursor:'c_1',events:[{text:event.text,kind:event.kind,id:event.id}]}).inserted,0);
 assert.throws(()=>j.ingest({source:'world',after:'c_1',cursor:'c_3',events:[{id:'c_2',kind:'speech'}, {...event,text:'Changed'}]}),/different content/);
 assert.equal(j.cursor('world'),'c_1');assert.equal(j.pending().length,1);
});
test('two receiver connections cannot advance from the same stale cursor',t=>{
 const f=fixture(t),a=f.open(),b=f.open();a.ingest({source:'world',after:null,cursor:'c_1',events:[event]});
 assert.throws(()=>b.ingest({source:'world',after:null,cursor:'c_2',events:[{id:'c_2'}]}),/Stale/);assert.equal(b.cursor('world'),'c_1');
});
test('world identity is scoped, owner source separate, gaps require explicit reconciliation',t=>{
 const f=fixture(t),j=f.open();assert.throws(()=>openJournal(f.directory,{...identity,soulId:'other'}),/another world/);
 j.ingest({source:'owner',after:null,cursor:'message-1',events:[{id:'c_1',text:'Owner instruction'}]});
 const r=j.ingest({source:'world',after:null,cursor:'c_20',events:[],gap:true});assert.equal(j.gaps().length,1);assert.equal(j.pending().length,1);
 j.reconcileGap(r.gapId,'Fresh observation and receipt checked; missing conversation history remains unknown');assert.equal(j.gaps().length,0);assert.equal(j.cursor('owner'),'message-1');
});
test('handling requires a known event and cannot silently revise its outcome',t=>{
 const j=fixture(t).open();assert.throws(()=>j.handled('world','c_1','done'),/unknown/);j.ingest({source:'world',after:null,cursor:'c_1',events:[event]});
 assert.deepEqual(j.handled('world','c_1','responded'),{alreadyHandled:false});assert.deepEqual(j.handled('world','c_1','responded'),{alreadyHandled:true});assert.throws(()=>j.handled('world','c_1','ignored'),/already recorded/);
});
