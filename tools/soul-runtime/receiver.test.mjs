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

test('receiver readiness follows actual initial page commit, retries startup adoption and never acknowledges work',async t=>{
 const j=fixture(t),stop=new AbortController(),states=[],initials=[];let calls=0;
 await runReceiver({journal:j,source:'owner',signal:stop.signal,retryable:e=>e.transient===true,sleep:async()=>{},
  read:async({after,initial})=>{initials.push(initial);if(++calls===1)throw Object.assign(Error('offline'),{transient:true});if(calls===2)return {cursor:'owner_1',events:[{id:'owner_1',kind:'owner.message',text:'Keep original task'}]};assert.equal(after,'owner_1');stop.abort();return {cursor:after,events:[]};},
  onState:s=>{if(s.state==='receiver-ready'){assert.equal(j.cursor('owner'),'owner_1');assert.equal(j.pending()[0].event.id,'owner_1');}states.push(s);}});
 assert.deepEqual(initials,[true,true,false]);const ready=states.filter(s=>s.state==='receiver-ready');assert.equal(ready.length,1);assert.equal(ready[0].successful,true);assert.equal(ready[0].mode,'page-committed');assert.equal(j.pending().length,1);
});

test('validated stream adoption can establish transport readiness while the event read stays pending',async t=>{
 const j=fixture(t),stop=new AbortController(),states=[];let entered,release;const waiting=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 const running=runReceiver({journal:j,source:'world',signal:stop.signal,read:async({onReady,after})=>{onReady({mode:'stream-adopted',successful:true});entered();await gate;return {cursor:after,events:[]};},onState:s=>states.push(s)});
 await waiting;assert.equal(states.filter(s=>s.state==='receiver-ready').length,1);assert.equal(states.find(s=>s.state==='receiver-ready').mode,'stream-adopted');assert.equal(j.cursor('world'),null);assert.equal(j.pending().length,0);
 stop.abort();release();await running;assert.equal(j.cursor('world'),null,'adoption never advances a cursor or manufactures a page');
});

test('pre-request state, aborted pages and refused ingestion never produce successful page readiness',async t=>{
 const j=fixture(t),stop=new AbortController(),states=[];
 await runReceiver({journal:j,source:'owner',signal:stop.signal,read:async()=>{assert.equal(states.some(s=>s.state==='receiver-ready'),false);stop.abort();return {cursor:'ignored',events:[]};},onState:s=>states.push(s)});
 assert.equal(states.some(s=>s.state==='receiver-ready'),false);assert.equal(j.cursor('owner'),null);
 const rejected=[];await assert.rejects(runReceiver({journal:j,source:'world',read:async()=>({cursor:null,gap:true,events:[]}),onState:s=>rejected.push(s)}),/Gap needs/);assert.equal(rejected.some(s=>s.state==='receiver-ready'),false);
});
