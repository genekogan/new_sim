import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openJournal} from './journal.mjs';
import {runSupervisor,AMBIENT_WAKE_MS} from './supervisor.mjs';
import {abortableSleep} from './receiver.mjs';

const origin=Date.parse('2026-10-30T12:00:00.000Z');
const flush=async()=>{for(let i=0;i<20;i++)await new Promise(setImmediate);};
const wait=(args={})=>({plan:'Preserve the original open task while waiting for observations',call:{type:'wait',command:'wait',arguments:JSON.stringify(args)},wakeAt:null});
const ambient=(id,speaker='s_native_speaker')=>({id,kind:'speech.ambient',raw:'speech',salience:1,about:{soulId:speaker},data:{from:{soulId:speaker},text:'An ordinary native public remark.'}});
class Host extends EventEmitter{
 constructor(journal){super();this.journal=journal;this.threadId='exact-durable-thread';this.calls=[];this.beginScopes=[];this.steers=[];this.interrupts=[];this.connections=[];this.activeTurnId=null;}
 async connect(options){this.connections.push(options);}
 async begin(text){assert.equal(this.activeTurnId,null);this.beginScopes.push(this.journal.control.checkpoint().value.listenTo);this.calls.push(JSON.parse(text));this.activeTurnId='turn-'+this.calls.length;let resolve;const completed=new Promise(r=>resolve=r);this.finish=decision=>{this.activeTurnId=null;resolve({status:'completed',text:JSON.stringify(decision)});};return {turnId:this.activeTurnId,completed};}
 async steer(text){this.steers.push(JSON.parse(text));return {accepted:true};}
 async interrupt(turnId){this.interrupts.push(turnId);}
 async close(){if(this.activeTurnId){this.activeTurnId=null;this.finish(wait());}}
}
function fixture(t,{legacy}={}){
 t.mock.timers.enable({apis:['Date','setTimeout','setInterval'],now:origin});
 const directory=mkdtempSync(join(tmpdir(),'sim-idle-default-')),commands=[],states=[];
 let journal=openJournal(directory,{worldId:'world',soulId:'s_subject'}),host=new Host(journal),stop=new AbortController();
 if(legacy!==undefined){const fence=journal.control.claim('existing');journal.control.save(fence,0,legacy);journal.control.release(fence);}
 const initial=journal.control.checkpoint();
 const world={read:async command=>{commands.push(['read',command]);return {here:'native current place'};},write:async command=>{commands.push(['write',command]);return {accepted:true};}};
 for(const method of ['ownerPage','worldPage'])world[method]=async({after,signal})=>{await abortableSleep(60000,signal);return {cursor:after,events:[]};};
 const start=()=>{const task=runSupervisor({journal,host,world,signal:stop.signal,onState:s=>states.push(s)});task.catch(()=>{});return task;};
 let running=start();
 const ingest=event=>journal.ingest({source:'world',after:journal.cursor('world'),cursor:event.id,events:[event]});
 const cleanup=async()=>{stop.abort();await running.catch(()=>{});journal.close();rmSync(directory,{recursive:true,force:true});};
 const reopen=async()=>{stop.abort();await running;journal.close();journal=openJournal(directory,{worldId:'world',soulId:'s_subject'});host=new Host(journal);stop=new AbortController();running=start();};
 return {get journal(){return journal;},get host(){return host;},commands,states,initial,ingest,reopen,cleanup};
}
test('a fresh journal persists nearby attention before inference and wakes an idle wait for native public speech',async t=>{
 const f=fixture(t);
 try{
  assert.deepEqual(f.initial,{revision:0,value:null,at:null});await flush();assert.equal(f.host.calls.length,1);f.host.finish(wait());await flush();assert.equal(f.journal.control.checkpoint().value.lastCall.type,'wait');
  f.ingest(ambient('native-public'));t.mock.timers.tick(AMBIENT_WAKE_MS-1);await flush();assert.equal(f.host.calls.length,1,'native ambient remains batched, never an immediate model poll');
  t.mock.timers.tick(101);await flush();assert.equal(f.host.calls.length,2,'a fresh idle controller should hear native public speech without a model-authored subscription');
  assert.equal(f.host.beginScopes[0],'nearby','the default must be durable before the first inference starts');assert.equal(f.host.calls[0].listenTo,'nearby');assert.equal(f.host.calls[1].listenTo,'nearby');assert.ok(f.host.calls[1].pending.some(x=>x.event.id==='native-public'));assert.equal(f.host.steers.length,0);assert.equal(f.host.interrupts.length,0);assert.equal(f.journal.pending().length,1,'waking does not incorporate or acknowledge speech');assert.deepEqual(f.commands,[['read','observe']]);
 }finally{await f.cleanup();}
});
for(const saved of [{name:'explicit empty',value:{listenTo:[]},expected:[]},{name:'legacy absent',value:{},expected:[]},{name:'explicit selected speaker',value:{listenTo:['s_selected']},expected:['s_selected']},{name:'explicit nearby',value:{listenTo:'nearby'},expected:'nearby'}])test('saved '+saved.name+' scope survives adoption without a new default',async t=>{
 const f=fixture(t,{legacy:saved.value});
 try{
  assert.equal(f.initial.revision,1);await flush();assert.deepEqual(f.host.calls[0].listenTo,saved.expected);f.host.finish(wait());await flush();assert.deepEqual(f.journal.control.checkpoint().value.listenTo,saved.expected);
  f.ingest(ambient('unselected','s_other'));t.mock.timers.tick(AMBIENT_WAKE_MS+100);await flush();assert.equal(f.host.calls.length,saved.expected==='nearby'?2:1);assert.equal(f.host.steers.length,0);assert.equal(f.host.interrupts.length,0);
  if(Array.isArray(saved.expected)&&saved.expected.length){f.ingest(ambient('selected','s_selected'));t.mock.timers.tick(AMBIENT_WAKE_MS+100);await flush();t.mock.timers.tick(100);await flush();assert.equal(f.host.calls.length,2);assert.ok(f.host.calls[1].pending.some(x=>x.event.id==='selected'));assert.deepEqual(f.host.calls[1].listenTo,['s_selected']);}
 }finally{await f.cleanup();}
});
test('an explicit mute chosen on a fresh journal survives an idle wait',async t=>{
 const f=fixture(t);
 try{
  await flush();f.host.finish(wait({listenTo:[]}));await flush();assert.deepEqual(f.journal.control.checkpoint().value.listenTo,[]);f.ingest(ambient('muted-public'));t.mock.timers.tick(AMBIENT_WAKE_MS*2);await flush();assert.equal(f.host.calls.length,1);assert.equal(f.host.steers.length,0);assert.equal(f.journal.pending().length,1);assert.deepEqual(f.commands,[['read','observe']]);
  await f.reopen();await flush();assert.deepEqual(f.host.beginScopes[0],[]);assert.deepEqual(f.host.calls[0].listenTo,[]);f.host.finish(wait());await flush();f.ingest(ambient('muted-after-reopen'));t.mock.timers.tick(AMBIENT_WAKE_MS*2);await flush();assert.equal(f.host.calls.length,1,'reopening must not restore nearby over an explicit saved mute');
 }finally{await f.cleanup();}
});
test('empty idle time does not create inference and native ambient never interrupts active inference',async t=>{
 const f=fixture(t);
 try{
  await flush();f.ingest(ambient('during-active'));t.mock.timers.tick(AMBIENT_WAKE_MS*2);await flush();assert.equal(f.host.calls.length,1);assert.equal(f.host.steers.length,0);assert.equal(f.host.interrupts.length,0);
  f.host.finish(wait({listenTo:[]}));await flush();const count=f.host.calls.length;t.mock.timers.tick(AMBIENT_WAKE_MS*2);await flush();assert.equal(f.host.calls.length,count);assert.equal(f.host.steers.length,0);assert.equal(f.host.interrupts.length,0);
 }finally{await f.cleanup();}
});
test('authenticated owner authority wakes ahead of the ambient batch and makes no automatic public effect',async t=>{
 const f=fixture(t);
 try{
  await flush();f.host.finish(wait());await flush();f.ingest(ambient('queued-public'));t.mock.timers.tick(100);await flush();f.journal.ingest({source:'owner',after:null,cursor:'owner-update',events:[{id:'owner-update',text:'An authenticated update to the current task.'}]});t.mock.timers.tick(100);await flush();t.mock.timers.tick(100);await flush();assert.equal(f.host.calls.length,2);assert.ok(Date.now()<origin+AMBIENT_WAKE_MS);assert.equal(f.host.calls[1].pending[0].event.id,'owner-update');assert.ok(f.host.calls[1].pending.some(x=>x.event.id==='queued-public'));assert.deepEqual(f.commands,[['read','observe']]);
 }finally{await f.cleanup();}
});

test('fresh nearby attention survives an idle checkpoint and reopening the same journal',async t=>{
 const f=fixture(t);
 try{
  await flush();f.host.finish(wait());await flush();const before=f.journal.control.checkpoint();assert.equal(before.value.listenTo,'nearby');assert.equal(before.value.decisionProgressV1,undefined);
  await f.reopen();await flush();assert.equal(f.host.calls.length,1);assert.equal(f.host.connections[0].threadId,'exact-durable-thread');assert.equal(f.host.beginScopes[0],'nearby');assert.equal(f.host.calls[0].listenTo,'nearby');f.host.finish(wait());await flush();
  t.mock.timers.tick(AMBIENT_WAKE_MS*2);await flush();assert.equal(f.host.calls.length,1,'a reopened nearby listener does not poll during silence');
  f.ingest(ambient('after-reopen'));t.mock.timers.tick(AMBIENT_WAKE_MS+100);await flush();t.mock.timers.tick(100);await flush();assert.equal(f.host.calls.length,2);assert.ok(f.host.calls[1].pending.some(x=>x.event.id==='after-reopen'));assert.equal(f.host.steers.length,0);assert.equal(f.host.interrupts.length,0);
 }finally{await f.cleanup();}
});
test('a saved deadline wakes before the fresh nearby ambient batch',async t=>{
 const f=fixture(t),wakeAt=new Date(origin+1000).toISOString();
 try{
  await flush();f.host.finish({...wait(),wakeAt});await flush();assert.equal(f.journal.control.checkpoint().value.wakeAt,wakeAt);f.ingest(ambient('before-deadline'));
  t.mock.timers.tick(999);await flush();assert.equal(f.host.calls.length,1);t.mock.timers.tick(101);await flush();assert.equal(f.host.calls.length,2);assert.ok(Date.now()<origin+AMBIENT_WAKE_MS);assert.equal(f.host.calls[1].scheduledWakeAt,wakeAt);assert.equal(f.host.calls[1].listenTo,'nearby');assert.ok(f.host.calls[1].pending.some(x=>x.event.id==='before-deadline'));assert.equal(f.journal.control.checkpoint().value.wakeAt,wakeAt);assert.equal(f.host.steers.length,0);assert.deepEqual(f.commands,[['read','observe']]);
 }finally{await f.cleanup();}
});
test('explicit local mute preserves an outstanding deadline without polling',async t=>{
 const f=fixture(t),wakeAt=new Date(origin+2000).toISOString();
 try{
  await flush();f.host.finish({...wait(),call:{type:'listen',command:'listen',arguments:'{"listenTo":[]}'},wakeAt});await flush();assert.equal(f.host.calls.length,2);assert.deepEqual(f.host.calls[1].listenTo,[]);assert.equal(f.host.calls[1].scheduledWakeAt,wakeAt);f.host.finish(wait());await flush();assert.equal(f.journal.control.checkpoint().value.wakeAt,wakeAt);
  f.ingest(ambient('muted-before-deadline'));t.mock.timers.tick(1999);await flush();assert.equal(f.host.calls.length,2);t.mock.timers.tick(101);await flush();assert.equal(f.host.calls.length,3);assert.deepEqual(f.host.calls[2].listenTo,[]);assert.equal(f.host.calls[2].scheduledWakeAt,wakeAt);assert.equal(f.host.steers.length,0);assert.equal(f.host.interrupts.length,0);assert.deepEqual(f.commands,[['read','observe']]);
 }finally{await f.cleanup();}
});
