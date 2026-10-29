import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openJournal} from './journal.mjs';
import {parseDecision,retainDecision,applyPendingDecision} from './decision.mjs';
function fixture(t){const dir=mkdtempSync(join(tmpdir(),'sim-decision-'));const j=openJournal(dir,{worldId:'w',soulId:'s'});t.after(()=>{j.close();rmSync(dir,{recursive:true,force:true})});return {j,fence:j.control.claim('test')};}
const decision=()=>parseDecision(JSON.stringify({plan:'Go read, then return. Still pending.',call:{type:'write',command:'act',arguments:'{"capability":"read:here"}'},wakeAt:null}));
test('retained decision survives before execution and replay of settled result does not repeat effect',async t=>{
 const {j,fence}=fixture(t);j.ingest({source:'owner',after:null,cursor:'m1',events:[{id:'m1',text:'Read then return'}]});const events=j.pending();const id=retainDecision(j,fence,decision(),{events,initialInstruction:'Read then return'});
 j.control.prepare(fence,id,decision().call);j.control.dispatch(fence,id);j.control.settle(fence,id,{accepted:true,receipt:{id:'r_1',phase:'started'}});
 let calls=0;const r=await applyPendingDecision(j,fence,{write:async()=>{calls++;throw Error('duplicate')}});assert.equal(calls,0);assert.equal(r.response.receipt.id,'r_1');assert.equal(j.pending().length,0);assert.equal(j.control.checkpoint().value.pendingDecision,null);assert.match(j.control.checkpoint().value.plan,/Still pending/);
});
test('lost write response leaves original task and operation pending rather than retrying',async t=>{
 const {j,fence}=fixture(t);retainDecision(j,fence,decision());let calls=0;const world={write:async()=>{calls++;throw Error('response dropped')}};
 await assert.rejects(applyPendingDecision(j,fence,world),{code:'OPERATION_UNCERTAIN'});await assert.rejects(applyPendingDecision(j,fence,world),{code:'OPERATION_UNCERTAIN'});assert.equal(calls,1);assert.equal(j.control.operations()[0].status,'uncertain');assert.ok(j.control.checkpoint().value.pendingDecision);
});
test('crash after event handling but before final checkpoint can finish idempotently',async t=>{
 const {j,fence}=fixture(t);j.ingest({source:'world',after:null,cursor:'c_1',events:[{id:'c_1'}]});const d={plan:'Wait for appointment',call:{type:'wait',command:'',args:{}},wakeAt:'2026-10-30T10:00:00Z'};const id=retainDecision(j,fence,d,{events:j.pending()});j.handled('world','c_1','incorporated:'+id);
 await applyPendingDecision(j,fence,{});assert.equal(j.control.checkpoint().value.wakeAt,d.wakeAt);assert.equal(j.pending().length,0);
});
test('decision rejects arbitrary commands and timezone-free deadlines',()=>{
 assert.throws(()=>parseDecision(JSON.stringify({plan:'',call:{type:'write',command:'shell',arguments:'{}'},wakeAt:null})),/Unsupported/);
 assert.throws(()=>parseDecision(JSON.stringify({plan:'',call:{type:'wait',command:'',arguments:'{}'},wakeAt:'2026-10-30T10:00:00'})),/timezone/);
});
test('explicit refusal is observed and recoverable without replaying the operation',async t=>{
 const {j,fence}=fixture(t);retainDecision(j,fence,decision());let calls=0;
 const r=await applyPendingDecision(j,fence,{write:async()=>{calls++;throw Object.assign(Error('Seat occupied'),{code:'seat.occupied',status:409,uncertain:false});}});
 assert.equal(r.response.accepted,false);assert.equal(r.response.error.code,'seat.occupied');assert.equal(j.control.operations().length,0);assert.equal(j.control.checkpoint().value.pendingDecision,null);assert.equal(calls,1);
});
test('restart recovers a lost response from authoritative lookup without a second write',async t=>{
 const {j,fence}=fixture(t);const id=retainDecision(j,fence,decision());let calls=0;
 const world={write:async()=>{calls++;throw Error('response dropped')},reconcile:async(call,key)=>{assert.equal(key,id);return {state:'recorded',status:200,response:{accepted:true,receipt:{id:'r_recovered',phase:'completed'}}}}};
 await assert.rejects(applyPendingDecision(j,fence,world),{code:'OPERATION_UNCERTAIN'});
 const result=await applyPendingDecision(j,fence,world);assert.equal(result.response.receipt.id,'r_recovered');assert.equal(calls,1);assert.equal(j.control.operations().length,0);
});
test('unknown lookup does not cause a retry or erase pending intent',async t=>{
 const {j,fence}=fixture(t);retainDecision(j,fence,decision());const world={write:async()=>{throw Error('lost')},reconcile:async()=>({state:'unknown'})};
 await assert.rejects(applyPendingDecision(j,fence,world),{code:'OPERATION_UNCERTAIN'});await assert.rejects(applyPendingDecision(j,fence,world),{code:'OPERATION_UNCERTAIN'});assert.ok(j.control.checkpoint().value.pendingDecision);
});
test('retention gap prevents writes until explicit resync, without claiming lost history was recovered',async t=>{
 const {j,fence}=fixture(t);j.ingest({source:'world',after:null,cursor:'c_50',events:[],gap:true});let writes=0;
 const world={write:async()=>{writes++;return {}},read:async command=>{assert.equal(command,'resync');return {historyIncomplete:true,observation:{place:'library'},conversations:[]};}};
 retainDecision(j,fence,decision());const blocked=await applyPendingDecision(j,fence,world);assert.equal(blocked.response.error.code,'continuity.resync-required');assert.equal(writes,0);assert.equal(j.gaps().length,1);
 retainDecision(j,fence,{plan:'Reobserve; past speech may be missing',call:{type:'read',command:'resync',args:{}},wakeAt:null});const fresh=await applyPendingDecision(j,fence,world);assert.equal(fresh.response.historyIncomplete,true);assert.equal(j.gaps().length,0);
});
test('a new event gap cannot erase an already-dispatched operation awaiting reconciliation',async t=>{
 const {j,fence}=fixture(t);const id=retainDecision(j,fence,decision());j.control.prepare(fence,id,decision().call);j.control.dispatch(fence,id);
 j.ingest({source:'world',after:null,cursor:'c_50',events:[],gap:true});
 const result=await applyPendingDecision(j,fence,{reconcile:async()=>({state:'recorded',status:200,response:{accepted:true,receipt:{id:'r1'}}})});assert.equal(result.response.receipt.id,'r1');assert.equal(j.gaps().length,1);assert.equal(j.control.operations().length,0);
});
test('relative activity waits calculate a durable UTC deadline and preserve an earlier appointment',()=>{
 const now=()=>Date.parse('2026-10-29T20:00:00Z');const payload={plan:'Read briefly',call:{type:'wait',command:'wait',arguments:'{"seconds":30}'},wakeAt:null};
 assert.equal(parseDecision(JSON.stringify(payload),{now}).wakeAt,'2026-10-29T20:00:30.000Z');
 assert.equal(parseDecision(JSON.stringify({...payload,wakeAt:'2026-10-29T16:00:10-04:00'}),{now}).wakeAt,'2026-10-29T20:00:10.000Z');
 assert.throws(()=>parseDecision(JSON.stringify({...payload,call:{...payload.call,arguments:'{"seconds":-1}'}})),/Relative wait/);
});
