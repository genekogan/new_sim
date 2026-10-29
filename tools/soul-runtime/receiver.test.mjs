import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openJournal} from './journal.mjs';
import {receivePage,runReceiver,runWakeDispatcher} from './receiver.mjs';
function fixture(t){const dir=mkdtempSync(join(tmpdir(),'sim-receiver-'));const j=openJournal(dir,{worldId:'w',soulId:'s'});t.after(()=>{j.close();rmSync(dir,{recursive:true,force:true})});return j;}
const page={cursor:'c_1',events:[{id:'c_1',kind:'conversation.turn',text:'Hello'}]};
test('host notification failure leaves pending facts durable while new events can arrive',async t=>{
 const j=fixture(t),abort=new AbortController();let wakes=0;const delays=[];
 await receivePage(j,'world',async()=>page);
 await runWakeDispatcher({journal:j,signal:abort.signal,notify:async({pending})=>{
  if(++wakes===1){assert.equal(pending.length,1);throw Object.assign(Error('host reconnecting'),{transient:true});}
  assert.equal(pending.length,2);abort.abort();
 },retryable:e=>e.transient===true,sleep:async ms=>{delays.push(ms);if(ms===1000)await receivePage(j,'world',async()=>({cursor:'c_2',events:[{id:'c_2',kind:'conversation.turn'}]}));}});
 assert.equal(wakes,2);assert.equal(delays[0],1000);assert.equal(j.pending().length,2);
});
test('transport retry retains cursor and terminal revocation does not loop',async t=>{
 const j=fixture(t);const cursors=[];let reads=0;
 await assert.rejects(runReceiver({journal:j,source:'world',read:async({after})=>{cursors.push(after);if(++reads===1)throw Object.assign(Error('network'),{transient:true});throw Error('control.revoked')},notify:async()=>{},retryable:e=>e.transient===true,sleep:async()=>{}}),/control.revoked/);
 assert.deepEqual(cursors,[null,null]);assert.equal(j.pending().length,0);
});
test('restart offers already-durable unhandled events without a new server message',async t=>{
 const j=fixture(t);j.ingest({source:'world',after:null,...page});const abort=new AbortController();let wake=false;
 await runWakeDispatcher({journal:j,signal:abort.signal,notify:async({pending})=>{assert.equal(pending[0].event.id,'c_1');wake=true;abort.abort()}});
 assert.equal(wake,true);assert.equal(j.pending().length,1);
});
test('aborted fetch never advances cursor; gaps remain visible to decision owner',async t=>{
 const j=fixture(t),abort=new AbortController();const result=await receivePage(j,'world',async()=>{abort.abort();return page},{signal:abort.signal});assert.equal(result.aborted,true);assert.equal(j.cursor('world'),null);
 await receivePage(j,'world',async()=>({cursor:'c_20',events:[],gap:true}));assert.equal(j.gaps().length,1);
});

test('receiver continues ingestion while host notification remains unresolved',async t=>{
 const j=fixture(t);await receivePage(j,'world',async()=>page);const abort=new AbortController();let release,entered;
 const notifying=new Promise(r=>entered=r),held=new Promise(r=>release=r);
 const dispatch=runWakeDispatcher({journal:j,signal:abort.signal,notify:async()=>{entered();await held;}});
 await notifying;
 await receivePage(j,'world',async()=>({cursor:'c_2',events:[{id:'c_2',kind:'speech'}]}));
 assert.equal(j.cursor('world'),'c_2');assert.equal(j.pending().length,2);abort.abort();release();await dispatch;
});

test('more than a page of unhandled events does not starve newer alerts',async t=>{
 const j=fixture(t),abort=new AbortController();
 j.ingest({source:'world',after:null,cursor:'c_1000',events:Array.from({length:1000},(_,i)=>({id:'c_'+(i+1)}))});
 j.ingest({source:'world',after:'c_1000',cursor:'c_1001',events:[{id:'c_1001',kind:'conversation.invite'}]});
 const batches=[];
 await runWakeDispatcher({journal:j,signal:abort.signal,sleep:async()=>{},notify:async({pending})=>{batches.push(pending.length);if(pending.some(e=>e.event.id==='c_1001'))abort.abort();}});
 assert.deepEqual(batches,[1000,1]);assert.equal(j.pending(1000,1000)[0].event.id,'c_1001');
});

test('durable intake telemetry follows commit and never reports refused intake',async t=>{
 const j=fixture(t),proof=[];
 await receivePage(j,'world',async()=>page,{onCommitted:e=>{assert.equal(j.cursor('world'),page.cursor);assert.equal(j.pending()[0].event.id,page.events[0].id);proof.push(e);}});
 assert.equal(proof[0].state,'events-persisted');assert.equal(proof[0].events[0].id,page.events[0].id);assert.ok(Number.isFinite(proof[0].committedAt));
 await assert.rejects(receivePage(j,'world',async()=>({cursor:'bad',events:[{...page.events[0],kind:'different'}]}),{onCommitted:e=>proof.push(e)}));
 assert.equal(proof.length,1);
});

test('journal pressure exposes structured retry cause without advancing refused intake',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'sim-receiver-pressure-'));
 const j=openJournal(dir,{worldId:'w',soulId:'s',retention:{worldPendingEvents:1}});
 t.after(()=>{j.close();rmSync(dir,{recursive:true,force:true});});
 j.ingest({source:'world',after:null,cursor:'quiet',events:[{id:'quiet',salience:1}]});
 const stop=new AbortController(),states=[];
 await runReceiver({journal:j,source:'world',signal:stop.signal,retryable:e=>e.transient===true,
  read:async({after})=>{assert.equal(after,'quiet');return {cursor:'urgent',events:[{id:'urgent',kind:'conversation.turn',salience:3}]};},
  onState:s=>states.push(s),sleep:async()=>stop.abort()});
 const retry=states.find(s=>s.state==='retrying');assert.equal(retry.code,'JOURNAL_BACKLOG_FULL');assert.equal(retry.source,'world');assert.equal(retry.delayMs,1000);
 assert.equal(j.cursor('world'),'quiet');assert.deepEqual(j.pending().map(p=>p.event.id),['quiet']);
 assert.equal(states.some(s=>s.state==='events-persisted'),false);
});
