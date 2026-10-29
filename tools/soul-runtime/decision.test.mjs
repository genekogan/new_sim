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
test('decision text budgets count encoded Unicode and escapes before durable retention',()=>{
 const payload={plan:'界'.repeat(5332),call:{type:'wait',command:'wait',arguments:'{}'},wakeAt:null};
 assert.equal(parseDecision(JSON.stringify(payload)).plan,payload.plan);
 assert.throws(()=>parseDecision(JSON.stringify({...payload,plan:'界'.repeat(5333)})),/durable plan.*JSON-encoded/);
 assert.throws(()=>parseDecision(JSON.stringify({...payload,plan:'\n'.repeat(8000)})),/durable plan.*JSON-encoded/);
 const allowed=JSON.stringify({text:'界'.repeat(5300)}),oversized=JSON.stringify({text:'界'.repeat(5333)});
 assert.equal(parseDecision(JSON.stringify({...payload,call:{...payload.call,arguments:allowed}})).call.args.text,'界'.repeat(5300));
 assert.throws(()=>parseDecision(JSON.stringify({...payload,call:{...payload.call,arguments:oversized}})),/call arguments.*JSON-encoded/);
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
test('conversation and reobservation retain a future activity wake across checkpoint recovery',async t=>{
 const {j,fence}=fixture(t),wakeAt=new Date(Date.now()+60000).toISOString();
 retainDecision(j,fence,{plan:'Read then leave',call:{type:'wait',command:'wait',args:{}},wakeAt});await applyPendingDecision(j,fence,{});
 retainDecision(j,fence,{plan:'Reply briefly then resume reading',call:{type:'write',command:'say',args:{text:'Hello'}},wakeAt:null});
 await applyPendingDecision(j,fence,{write:async()=>({said:{id:'s1'}})});assert.equal(j.control.checkpoint().value.wakeAt,wakeAt);
 retainDecision(j,fence,{plan:'Reobserve after greeting',call:{type:'read',command:'here',args:{}},wakeAt:null});
 await applyPendingDecision(j,fence,{read:async()=>({activity:'read'})});assert.equal(j.control.checkpoint().value.wakeAt,wakeAt);
 retainDecision(j,fence,{plan:'Owner cancelled the errand',call:{type:'wait',command:'wait',args:{cancelWake:true}},wakeAt:null});
 await applyPendingDecision(j,fence,{});assert.equal(j.control.checkpoint().value.wakeAt,null);
});
test('a due wake survives an earlier retained decision but is consumed by a later decision',async t=>{
 const {j,fence}=fixture(t),wakeAt=new Date(Date.now()-1000).toISOString();
 j.control.save(fence,0,{wakeAt});retainDecision(j,fence,{plan:'Handle due appointment',call:{type:'wait',command:'wait',args:{}},wakeAt:null});
 const c=j.control.checkpoint();j.control.save(fence,c.revision,{...c.value,pendingDecision:{...c.value.pendingDecision,retainedAt:Date.now()-2000}});
 await applyPendingDecision(j,fence,{});assert.equal(j.control.checkpoint().value.wakeAt,wakeAt);
 retainDecision(j,fence,{plan:'Due wake handled',call:{type:'wait',command:'wait',args:{}},wakeAt:null});await applyPendingDecision(j,fence,{});assert.equal(j.control.checkpoint().value.wakeAt,null);
});
const report=(id='m1')=>({plan:'Report actual outcome',call:{type:'write',command:'result',args:{id,outcome:'failed',text:'Could not complete before the appointment ended'}},wakeAt:null});
const reportResponse=d=>({inbox:{latest:{id:d.call.args.id,state:'acknowledged',result:d.call.args.text,outcome:d.call.args.outcome,resultAt:123}}});
test('rejected owner result and later plan loss do not erase original task; exact native result closes it',async t=>{
 const {j,fence}=fixture(t);j.ingest({source:'owner',after:null,cursor:'m1',events:[{id:'m1',text:'Read then return and report',sentAt:42}]});
 retainDecision(j,fence,report(),{events:j.pending()});await applyPendingDecision(j,fence,{write:async()=>{throw Object.assign(Error('result must be <=140 characters'),{status:400,uncertain:false});}});
 assert.equal(j.pending().length,0);assert.equal(j.openOwnerTasks().tasks[0].id,'m1');
 retainDecision(j,fence,{plan:'No task ID in my remembered plan',call:{type:'wait',command:'wait',args:{}},wakeAt:null});await applyPendingDecision(j,fence,{});
 assert.equal(j.openOwnerTasks().tasks[0].text,'Read then return and report');
 retainDecision(j,fence,report());await applyPendingDecision(j,fence,{write:async()=>reportResponse(report())});assert.equal(j.openOwnerTasks().totalOpen,0);
});
test('local owner task reads never reach the world and cannot close a task',async t=>{
 const {j,fence}=fixture(t);j.ingest({source:'owner',after:null,cursor:'m1',events:[{id:'m1',text:'Private intent',sentAt:1}]});let network=0;
 const world={read:async()=>{network++;throw Error('must stay local')}};
 for(const [command,args] of [['tasks',{after:0,limit:20}],['task',{id:'m1',offset:0}]]){
  const parsed=parseDecision(JSON.stringify({plan:'Inspect local outstanding owner intent',call:{type:'read',command,arguments:JSON.stringify(args)},wakeAt:null}));retainDecision(j,fence,parsed);const applied=await applyPendingDecision(j,fence,world);assert.equal(command==='tasks'?applied.response.tasks[0].text:applied.response.task.text,'Private intent');
 }
 assert.equal(network,0);assert.equal(j.openOwnerTasks().totalOpen,1);
 for(const [command,args] of [['tasks',{limit:21}],['tasks',{after:-1}],['task',{id:'m1',offset:-1}],['task',{}],['tasks',{unexpected:'field'}]])assert.throws(()=>parseDecision(JSON.stringify({plan:'',call:{type:'read',command,arguments:JSON.stringify(args)},wakeAt:null})),/Local|local/);
});
test('a maximum local text chunk can be incorporated with full instruction and plan budgets across restart',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'sim-decision-budget-'));let j=openJournal(dir,{worldId:'w',soulId:'s'});
 t.after(()=>{j.close();rmSync(dir,{recursive:true,force:true})});
 let fence=j.control.claim('test');const initialInstruction='i'.repeat(16000),plan='p'.repeat(15998);
 j.ingest({source:'owner',after:null,cursor:'large',events:[{id:'large',text:'x'.repeat(60000),sentAt:1}]});
 const read=parseDecision(JSON.stringify({plan,call:{type:'read',command:'task',arguments:'{"id":"large"}'},wakeAt:null}));
 retainDecision(j,fence,read,{events:j.pending(),initialInstruction});const observed=await applyPendingDecision(j,fence,{});
 assert.equal(Buffer.byteLength(JSON.stringify(observed.response)),32768);assert.equal(j.control.checkpoint().value.lastResult.task.nextOffset!==null,true);
 const report=parseDecision(JSON.stringify({plan,call:{type:'write',command:'result',arguments:'{"id":"large","outcome":"failed","text":"Owner cancelled this request"}'},wakeAt:null}));
 const id=retainDecision(j,fence,report);const retained=j.control.checkpoint().value;
 assert.equal(retained.lastResult,undefined);assert.equal(retained.plan,plan);assert.equal(retained.pendingDecision.decision.plan,undefined);
 j.control.prepare(fence,id,report.call);j.control.dispatch(fence,id);j.control.settle(fence,id,{inbox:{latest:{id:'large',state:'acknowledged',outcome:'failed',result:report.call.args.text,resultAt:123}}});
 j.control.release(fence);j.close();j=openJournal(dir,{worldId:'w',soulId:'s'});fence=j.control.claim('recovery');
 let writes=0;await applyPendingDecision(j,fence,{write:async()=>{writes++;throw Error('must not reissue settled result')}});
 assert.equal(writes,0);assert.equal(j.openOwnerTasks().totalOpen,0);assert.equal(j.control.checkpoint().value.initialInstruction,initialInstruction);assert.equal(j.control.checkpoint().value.plan,plan);assert.equal(j.control.checkpoint().value.pendingDecision,null);
});
test('settled result recovery closes owner task before checkpoint without reissuing public write',async t=>{
 const {j,fence}=fixture(t);j.ingest({source:'owner',after:null,cursor:'m1',events:[{id:'m1',text:'Read',sentAt:1}]});const d=report(),id=retainDecision(j,fence,d,{events:j.pending()});
 j.control.prepare(fence,id,d.call);j.control.dispatch(fence,id);j.control.settle(fence,id,reportResponse(d));
 const save=j.control.save;j.control.save=()=>{throw Error('crash before checkpoint')};let writes=0;
 await assert.rejects(applyPendingDecision(j,fence,{write:async()=>{writes++}}),/crash before checkpoint/);assert.equal(j.openOwnerTasks().totalOpen,0);assert.ok(j.control.checkpoint().value.pendingDecision);
 j.control.save=save;await applyPendingDecision(j,fence,{write:async()=>{writes++}});assert.equal(writes,0);assert.equal(j.openOwnerTasks().totalOpen,0);assert.equal(j.control.checkpoint().value.pendingDecision,null);
});
test('unknown lost result preserves task and native readback closes only when authoritatively satisfied',async t=>{
 const {j,fence}=fixture(t);j.ingest({source:'owner',after:null,cursor:'m1',events:[{id:'m1',text:'Read',sentAt:1}]});const d=report();retainDecision(j,fence,d);let writes=0,known=false;
 const world={write:async()=>{writes++;throw Error('lost')},reconcile:async()=>known?{state:'recorded',status:200,response:{...reportResponse(d),reconciliation:{evidence:'observed-native-state'}}}:{state:'unknown'}};
 await assert.rejects(applyPendingDecision(j,fence,world),{code:'OPERATION_UNCERTAIN'});assert.equal(j.openOwnerTasks().totalOpen,1);await assert.rejects(applyPendingDecision(j,fence,world),{code:'OPERATION_UNCERTAIN'});assert.equal(j.openOwnerTasks().totalOpen,1);
 known=true;await applyPendingDecision(j,fence,world);assert.equal(writes,1);assert.equal(j.openOwnerTasks().totalOpen,0);
});
