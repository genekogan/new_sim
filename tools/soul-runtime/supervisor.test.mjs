import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openJournal} from './journal.mjs';
import {runSupervisor} from './supervisor.mjs';
import {abortableSleep} from './receiver.mjs';
const waitDecision={plan:'Resume the reading appointment after interruption',call:{type:'wait',command:'',arguments:'{}'},wakeAt:null};
class Host extends EventEmitter{
 constructor(){super();this.threadId='thread';this.calls=[];this.steers=[];this.closed=false;}
 async connect(){}
 async begin(prompt){this.calls.push(JSON.parse(prompt));this.activeTurnId='t'+this.calls.length;let resolve;const completed=new Promise(r=>resolve=r);this.finish=decision=>{this.activeTurnId=null;resolve({status:'completed',text:JSON.stringify(decision)});};this.rejectTurn=()=>resolve({status:'interrupted'});return {turnId:this.activeTurnId,completed};}
 async steer(text){this.steers.push(JSON.parse(text));}
 async close(){this.closed=true;this.rejectTurn?.();}
}
async function until(fn){for(let n=0;n<200;n++){if(fn())return;await new Promise(r=>setTimeout(r,5));}throw Error('Condition timed out');}
function setup(t){const dir=mkdtempSync(join(tmpdir(),'sim-supervisor-'));const journal=openJournal(dir,{worldId:'w',soulId:'s'});const host=new Host(),stop=new AbortController();t.after(()=>{journal.close();rmSync(dir,{recursive:true,force:true});});let reads=0;const world={read:async()=>({here:'library'}),worldPage:async({after,signal})=>{reads++;await abortableSleep(10000,signal);return {cursor:after,events:[]};},ownerPage:async({after,signal})=>{await abortableSleep(10000,signal);return {cursor:after,events:[]};}};return {journal,host,stop,world,reads:()=>reads};}
test('event during inference is durably steered and obsolete action is discarded',async t=>{
 const f=setup(t);let effects=0;f.world.write=async()=>{effects++;return {accepted:true};};
 const running=runSupervisor({...f,instruction:'Read then attend appointment',signal:f.stop.signal});
 await until(()=>f.host.calls.length===1);
 f.journal.ingest({source:'world',after:null,cursor:'c_1',events:[{id:'c_1',kind:'conversation.turn',text:'Hello'}]});
 await until(()=>f.host.steers.length===1);
 assert.equal(f.journal.pending().length,1);
 f.host.finish({...waitDecision,call:{type:'write',command:'say',arguments:'{"text":"obsolete"}'}});
 await until(()=>f.host.calls.length===2);assert.equal(effects,0);assert.equal(f.host.calls[1].pending.length,1);
 f.host.finish(waitDecision);await until(()=>f.journal.pending().length===0);
 assert.equal(f.journal.control.checkpoint().value.initialInstruction,'Read then attend appointment');
 await new Promise(r=>setTimeout(r,150));assert.equal(f.host.calls.length,2,'waiting must not poll the model');
 f.stop.abort();await running;assert.equal(f.host.closed,true);
});
test('host failure stops intake and releases the local controller',async t=>{
 const f=setup(t);const running=runSupervisor({...f,instruction:'Read',signal:f.stop.signal});
 await until(()=>f.host.calls.length===1);f.host.emit('fault',Error('inference unavailable'));
 await assert.rejects(running,/inference unavailable/);assert.equal(f.host.closed,true);
 const next=f.journal.control.claim('successor');assert.ok(next.generation>1);
});
test('external stop interrupts a pending model turn instead of waiting indefinitely',async t=>{
 const f=setup(t);const running=runSupervisor({...f,instruction:'Read',signal:f.stop.signal});
 await until(()=>f.host.calls.length===1);f.stop.abort();await running;assert.equal(f.host.closed,true);
});
test('fresh adoption starts at observed head rather than replying to old historical speech',async t=>{
 const f=setup(t);f.world.read=async()=>({streamCursor:'c_88'});let firstCursor;
 f.world.worldPage=async({after,signal})=>{firstCursor=after;await abortableSleep(10000,signal);return {cursor:after,events:[]};};
 const running=runSupervisor({...f,instruction:'Read',signal:f.stop.signal});await until(()=>f.host.calls.length===1);assert.equal(firstCursor,'c_88');f.stop.abort();await running;
});
test('continuing world chatter cannot starve effects, but a new owner cancellation always invalidates them',async t=>{
 const f=setup(t);let effects=0;f.world.write=async()=>{effects++;return {accepted:true}};
 const running=runSupervisor({...f,instruction:'Reply then leave',signal:f.stop.signal});
 const say={...waitDecision,call:{type:'write',command:'say',arguments:'{"text":"I must go now"}'}};
 for(let n=1;n<=2;n++){
  await until(()=>f.host.calls.length===n);f.journal.ingest({source:'world',after:n===1?null:'c_'+(n-1),cursor:'c_'+n,events:[{id:'c_'+n,kind:'speech.to-me',salience:3}]});
  await until(()=>f.host.steers.length===n);f.host.finish(say);
 }
 await until(()=>f.host.calls.length===3);f.journal.ingest({source:'owner',after:null,cursor:'cancel',events:[{id:'cancel',text:'Stop; do not speak'}]});
 await until(()=>f.host.steers.length===3);f.host.finish(say);await until(()=>f.host.calls.length===4);assert.equal(effects,0);
 f.journal.ingest({source:'world',after:'c_2',cursor:'c_3',events:[{id:'c_3',kind:'speech.to-me',salience:3}]});await until(()=>f.host.steers.length===4);
 // The fourth turn includes cancellation and chooses a read, which may proceed
 // despite continuing chatter. The late chatter remains pending for next turn.
 f.host.finish({...waitDecision,call:{type:'read',command:'here',arguments:'{}'}});await until(()=>f.host.calls.length===5);
 assert.equal(f.host.calls[4].lastCall.command,'here');assert.equal(f.host.calls[4].pending.some(e=>e.event.id==='c_3'),true);assert.equal(effects,0);
 f.stop.abort();await running;
});
test('handled original owner identity reaches every recovery prompt even when saved plan forgot it',async t=>{
 const f=setup(t),id='msg_original';f.journal.ingest({source:'owner',after:null,cursor:id,events:[{id,text:'Read, return, and report the outcome',sentAt:42}]});f.journal.handled('owner',id,'incorporated:old-decision');
 const fence=f.journal.control.claim('old');f.journal.control.save(fence,0,{plan:'I cannot see a reportable request ID',threadId:'thread'});f.journal.control.release(fence);
 const running=runSupervisor({...f,signal:f.stop.signal});
 try{
  await until(()=>f.host.calls.length===1);const prompt=f.host.calls[0];assert.equal(prompt.pending.length,0);assert.equal(prompt.openOwnerTasks.tasks[0].id,id);assert.equal(prompt.openOwnerTasks.tasks[0].text,'Read, return, and report the outcome');assert.match(prompt.plan,/cannot see/);
  f.host.finish({...waitDecision,call:{type:'read',command:'tasks',arguments:'{}'}});await until(()=>f.host.calls.length===2);assert.equal(f.host.calls[1].lastResult.tasks[0].id,id);assert.equal(f.host.calls[1].openOwnerTasks.tasks[0].id,id);
 }finally{f.stop.abort();await running;}
});
test('host-notified start and steer are emitted only after acknowledgement and list exactly bounded delivered facts',async t=>{
 const f=setup(t),states=[];f.journal.ingest({source:'world',after:null,cursor:'old30',events:Array.from({length:30},(_,i)=>({id:'old'+(i+1),text:'x'.repeat(3000),salience:3}))});
 const begin=f.host.begin.bind(f.host),steer=f.host.steer.bind(f.host);let acceptStart,acceptSteer;
 const startGate=new Promise(r=>acceptStart=r),steerGate=new Promise(r=>acceptSteer=r);
 f.host.begin=async(...args)=>{const turn=await begin(...args);await startGate;return turn;};f.host.steer=async(...args)=>{await steer(...args);await steerGate;};
 const running=runSupervisor({...f,signal:f.stop.signal,onState:s=>states.push(s)});
 try{
  await until(()=>f.host.calls.length===1);assert.equal(states.some(s=>s.state==='host-notified'),false);acceptStart();await until(()=>states.some(s=>s.state==='host-notified'));
  const started=states.find(s=>s.state==='host-notified');assert.equal(started.mode,'start');assert.deepEqual(started.events,f.host.calls[0].pending.map(p=>({source:p.source,id:p.event.id})));assert.ok(started.events.length<30);assert.equal(started.turnId,'t1');assert.equal(started.threadId,'thread');assert.ok(Number.isFinite(started.at));
  f.journal.ingest({source:'world',after:'old30',cursor:'new30',events:Array.from({length:30},(_,i)=>({id:'new'+(i+1),text:'x'.repeat(3000),salience:3}))});await until(()=>f.host.steers.length===1);assert.equal(states.filter(s=>s.state==='host-notified').length,1);
  acceptSteer();await until(()=>states.filter(s=>s.state==='host-notified').length===2);const steered=states.filter(s=>s.state==='host-notified')[1];assert.equal(steered.mode,'steer');assert.deepEqual(steered.events,f.host.steers[0].pending.map(p=>({source:p.source,id:p.event.id})));assert.ok(steered.events.length<30);assert.equal(f.journal.pending().length,60,'delivery telemetry never marks incorporation');
 }finally{acceptStart();acceptSteer();f.stop.abort();await running;}
});
test('failed steer acknowledgement never claims host delivery',async t=>{
 const f=setup(t),states=[];f.host.steer=async()=>{throw Error('stale turn')};const running=runSupervisor({...f,signal:f.stop.signal,onState:s=>states.push(s)});
 try{
  await until(()=>f.host.calls.length===1);f.journal.ingest({source:'world',after:null,cursor:'c1',events:[{id:'c1',kind:'conversation.turn'}]});await new Promise(r=>setTimeout(r,150));assert.equal(states.some(s=>s.state==='host-notified'&&s.mode==='steer'),false);assert.equal(f.journal.pending().length,1);
 }finally{f.stop.abort();await running;}
});
