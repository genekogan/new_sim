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
