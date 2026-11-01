import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,appendFileSync,rmSync,truncateSync,renameSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createUsageTail,createContinuityUsageGuard,validateUsageLimits} from './continuity-usage.mjs';

const limits={perActor:{totalTokens:1000,outputTokens:100},aggregate:{totalTokens:1500,outputTokens:150}};
const total=(inputTokens,outputTokens=10,cachedInputTokens=0)=>({inputTokens,outputTokens,cachedInputTokens,totalTokens:inputTokens+outputTokens});
const update=(threadId,input,output=10,cached=0)=>({kind:'host-event',method:'thread/tokenUsage/updated',threadId,tokenUsage:{total:total(input,output,cached)}});
const host=(threadId,resumed=false)=>({kind:'host-session',state:'connected',threadId,resumed});
const turn=(method,turnId='turn-1',threadId='thread-1')=>({kind:'host-event',method,threadId,turnId});
const baseline=(input=50,output=5,cached=20)=>[{type:'thread.started',thread_id:'thread-1'},{type:'turn.started'},{type:'turn.completed',usage:{input_tokens:input,output_tokens:output,cached_input_tokens:cached}}];
function fixture(t,kind='managed',options={}){
 const root=mkdtempSync(join(tmpdir(),'continuity-usage-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const path=join(root,'usage.ndjson');let time=0;
 const guard=createContinuityUsageGuard({actors:[{id:'a',kind,path}],limits,now:()=>time,...options});
 const append=(...rows)=>appendFileSync(path,rows.map(x=>JSON.stringify(x)+'\n').join(''));
 return {root,path,guard,append,tick:n=>{time+=n;},final:()=>guard.poll({finalActorIds:['a']})};
}

test('finite explicit total/output limits reject ambiguous or unsafe budgets',()=>{
 assert.deepEqual(validateUsageLimits(limits),limits);
 for(const value of [null,{}, {...limits,aggregate:{totalTokens:Infinity,outputTokens:10}},{...limits,perActor:{totalTokens:10,outputTokens:11}},{...limits,perActor:{totalTokens:10,outputTokens:0}},{...limits,other:1}])assert.throws(()=>validateUsageLimits(value),{code:'INVALID_USAGE_GUARD'});
});

test('same-thread cumulative high-water survives restart; a new thread adds an epoch',t=>{
 const f=fixture(t);f.guard.activate('a');f.append(host('thread-1'),update('thread-1',100,10,80));
 assert.equal(f.guard.poll().aggregate.totalTokens,110);
 assert.equal(f.guard.poll().aggregate.totalTokens,110,'repeated poll is not a new charge');
 f.append(host('thread-1',true),update('thread-1',100,10,80),update('thread-1',130,15,100),host('thread-2'),update('thread-2',20,2,5));
 const result=f.final();assert.equal(result.status,'complete');assert.equal(result.aggregate.totalTokens,167);assert.equal(result.aggregate.cachedInputTokens,105);
 assert.deepEqual(result.actors[0].threads.map(x=>[x.threadId,x.epoch,x.cumulative.totalTokens]),[['thread-1',1,145],['thread-2',2,22]]);
 assert.equal(result.aggregate.totalTokens,result.aggregate.inputTokens+result.aggregate.outputTokens,'cached input is not added a second time');
});

test('baseline uses existing cumulative exec usage, preserves thread epochs and never reads tool content',t=>{
 const f=fixture(t,'baseline');f.guard.activate('a');f.append(...baseline());
 assert.equal(f.guard.poll().aggregate.totalTokens,55);
 f.append({type:'item.completed',item:{type:'command_execution',command:'private payload must not escape',aggregated_output:'SECRET_RAW_TEST'}},{type:'turn.started'},{type:'turn.completed',usage:{input_tokens:80,output_tokens:8,cached_input_tokens:30}},{type:'thread.started',thread_id:'thread-2'},{type:'turn.started'},{type:'turn.completed',usage:{input_tokens:10,output_tokens:1,cached_input_tokens:0}});
 const result=f.final();assert.equal(result.status,'complete');assert.equal(result.aggregate.totalTokens,99);assert.equal(result.actors[0].threads.length,2);assert(!JSON.stringify(result).includes('SECRET_RAW_TEST'));assert(!JSON.stringify(result).includes('private payload'));
});

test('split UTF-8 and partial NDJSON are retained until a complete line arrives',t=>{
 const f=fixture(t);const tail=createUsageTail(f.path);const bytes=Buffer.from(JSON.stringify({text:'snow ☃',value:1})+'\n');const split=bytes.indexOf(Buffer.from('☃'))+1;
 writeFileSync(f.path,bytes.subarray(0,split));const rows=[];assert.equal(tail.poll(r=>rows.push(r)).pendingBytes,split);assert.deepEqual(rows,[]);
 appendFileSync(f.path,bytes.subarray(split,bytes.length-1));tail.poll(r=>rows.push(r));assert.deepEqual(rows,[]);
 appendFileSync(f.path,'\n');tail.poll(r=>rows.push(r),{final:true});assert.deepEqual(rows,[{text:'snow ☃',value:1}]);
});

test('prelaunch missing files are harmless; activated missing final/grace-expired sources fail',t=>{
 const f=fixture(t);assert.equal(f.guard.poll().status,'monitoring');f.guard.activate('a');assert.equal(f.guard.poll().status,'monitoring');f.tick(10000);
 assert.equal(f.guard.poll().trigger.reason,'USAGE_SOURCE_MISSING');
 const g=fixture(t);g.guard.activate('a');assert.equal(g.final().trigger.reason,'USAGE_SOURCE_MISSING');
});

test('truncated partial tail, invalid UTF-8 and source replacement are explicit unknowns',t=>{
 const f=fixture(t);f.guard.activate('a');f.append(update('thread-1',10));appendFileSync(f.path,'{"kind":');assert.equal(f.final().trigger.reason,'USAGE_TRUNCATED_TAIL');
 const g=fixture(t);g.guard.activate('a');writeFileSync(g.path,Buffer.from([0xc3,0x28,10]));assert.equal(g.final().trigger.reason,'USAGE_INVALID_NDJSON');
 const h=fixture(t);h.guard.activate('a');h.append(update('thread-1',10));h.guard.poll();renameSync(h.path,h.path+'.old');h.append(update('thread-1',20));assert.equal(h.final().trigger.reason,'USAGE_SOURCE_REPLACED');
});

test('truncation, in-place tail rewrite, links and oversized backlog never silently reset accounting',t=>{
 const f=fixture(t);f.guard.activate('a');f.append(update('thread-1',10));f.guard.poll();truncateSync(f.path,0);assert.equal(f.final().trigger.reason,'USAGE_SOURCE_TRUNCATED');
 const g=fixture(t);g.guard.activate('a');g.append(update('thread-1',10));g.guard.poll();writeFileSync(g.path,JSON.stringify(update('thread-1',20))+'\n');assert.equal(g.final().trigger.reason,'USAGE_SOURCE_REWRITTEN');
 const h=fixture(t);h.guard.activate('a');writeFileSync(join(h.root,'target'),'{}\n');symlinkSync(join(h.root,'target'),h.path);assert.equal(h.final().trigger.reason,'USAGE_SOURCE_UNSAFE');
 const j=fixture(t,'managed',{readerOptions:{maxPollBytes:10}});j.guard.activate('a');j.append(update('thread-1',10));assert.equal(j.final().trigger.reason,'USAGE_READER_BACKLOG');
 const k=fixture(t,'managed',{readerOptions:{maxLineBytes:10}});k.guard.activate('a');k.append(update('thread-1',10));assert.equal(k.final().trigger.reason,'USAGE_LINE_LIMIT');
});

test('invalid totals, cached subsets, regression, missing identity and unseen resumes stop conservatively',t=>{
 const cases=[['USAGE_INVALID_COUNTERS',{...update('thread-1',10),tokenUsage:{total:{...total(10),totalTokens:999}}}],['USAGE_INVALID_COUNTERS',update('thread-1',10,2,11)],['USAGE_INVALID_COUNTERS',update('thread-1',-1)],['USAGE_THREAD_UNKNOWN',update(null,10)],['USAGE_UNSEEN_RESUMED_THREAD',host('new-thread',true)]];
 for(const [reason,event] of cases){const f=fixture(t);f.guard.activate('a');f.append(event);assert.equal(f.final().trigger.reason,reason);}
 const f=fixture(t);f.guard.activate('a');f.append(update('thread-1',100),update('thread-1',99));const result=f.final();assert.equal(result.trigger.reason,'USAGE_COUNTER_REGRESSION');assert.equal(result.aggregate.totalTokens,110);
});

test('in-flight and unaccounted completed turns remain unknown at final closure',t=>{
 const f=fixture(t);f.guard.activate('a');f.append(turn('turn/started'),update('thread-1',30));assert.equal(f.final().trigger.reason,'USAGE_IN_FLIGHT_UNKNOWN');
 const g=fixture(t);g.guard.activate('a');g.append(update('thread-1',30),turn('turn/started'),turn('turn/completed'));assert.equal(g.final().trigger.reason,'USAGE_IN_FLIGHT_UNKNOWN');
 const h=fixture(t);h.guard.activate('a');h.append(turn('turn/started'),update('thread-1',30),turn('turn/completed'));assert.equal(h.final().status,'complete');
 const i=fixture(t,'baseline');i.guard.activate('a');i.append({type:'thread.started',thread_id:'thread-1'},{type:'turn.started'});assert.equal(i.final().status,'unknown');
});

test('per-actor and aggregate budgets stop on the first observed limit, including output',t=>{
 const f=fixture(t);f.guard.activate('a');f.append(update('thread-1',900,100));const r=f.guard.poll();assert.equal(r.status,'limit-reached');assert.equal(r.trigger.scope,'actor');assert.equal(r.possibleInFlightOvershoot,true);assert.equal(r.billing,'not measured');
 const root=mkdtempSync(join(tmpdir(),'continuity-budget-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const actors=['a','b'].map(id=>({id,kind:'managed',path:join(root,id)}));for(const actor of actors)writeFileSync(actor.path,JSON.stringify(update('thread-'+actor.id,750,10))+'\n');
 const guard=createContinuityUsageGuard({actors,limits});for(const actor of actors)guard.activate(actor.id);const combined=guard.poll();assert.equal(combined.trigger.scope,'aggregate');assert.equal(combined.aggregate.totalTokens,1520);
 const g=fixture(t);g.guard.activate('a');g.append(update('thread-1',0,100));assert.equal(g.guard.poll().trigger.field,'outputTokens');
});
