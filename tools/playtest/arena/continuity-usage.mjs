// Passive observation only. Token notifications can lag an in-flight request:
// this is a measured-usage stop guard, never a provider spending cap or billing.
import {openSync,closeSync,fstatSync,readSync,constants} from 'node:fs';
import {TextDecoder} from 'node:util';

const fault=code=>Object.assign(Error(code),{code});
const integer=n=>Number.isSafeInteger(n)&&n>=0;
const id=s=>typeof s==='string'&&/^[-a-zA-Z0-9_]{1,200}$/.test(s);
const fields=['inputTokens','cachedInputTokens','outputTokens','totalTokens'];
const zero=()=>Object.fromEntries(fields.map(k=>[k,0]));
export function validateUsageLimits(limits){
 if(!limits||Object.keys(limits).sort().join(',')!=='aggregate,perActor')throw fault('INVALID_USAGE_GUARD');
 for(const group of ['perActor','aggregate']){
  const value=limits[group];
  if(!value||Object.keys(value).sort().join(',')!=='outputTokens,totalTokens'||!Number.isSafeInteger(value.totalTokens)||value.totalTokens<1||!Number.isSafeInteger(value.outputTokens)||value.outputTokens<1||value.outputTokens>value.totalTokens)throw fault('INVALID_USAGE_GUARD');
 }
 return structuredClone(limits);
}

/** Bounded, append-only byte tail. Decode only complete lines, so a split UTF-8
 * character remains pending rather than being silently replaced. */
export function createUsageTail(path,{maxLineBytes=1024*1024,maxPollBytes=4*1024*1024,maxFileBytes=128*1024*1024,maxLinesPerPoll=10000}={}){
 for(const n of [maxLineBytes,maxPollBytes,maxFileBytes,maxLinesPerPoll])if(!Number.isSafeInteger(n)||n<1)throw fault('INVALID_USAGE_READER_BOUNDS');
 let offset=0,pending=Buffer.alloc(0),identity=null,anchor=Buffer.alloc(0),lines=0,failed=null;
 const decoder=new TextDecoder('utf-8',{fatal:true});
 return {
  poll(consume,{final=false,required=false}={}){
   if(failed)throw fault(failed);
   let fd;
   try{
    try{fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);}catch(e){
     if(e.code==='ENOENT'&&!identity&&!required)return {missing:true,bytes:offset,lines,pendingBytes:pending.length};
     throw fault(e.code==='ENOENT'?'USAGE_SOURCE_MISSING':'USAGE_SOURCE_UNSAFE');
    }
    const stat=fstatSync(fd);
    if(!stat.isFile()||stat.nlink!==1)throw fault('USAGE_SOURCE_UNSAFE');
    const key=`${stat.dev}:${stat.ino}`;
    if(identity&&identity!==key)throw fault('USAGE_SOURCE_REPLACED');
    identity=key;
    if(stat.size<offset)throw fault('USAGE_SOURCE_TRUNCATED');
    if(stat.size>maxFileBytes||stat.size-offset>maxPollBytes)throw fault('USAGE_READER_BACKLOG');
    if(anchor.length){const check=Buffer.alloc(anchor.length);if(readSync(fd,check,0,check.length,offset-anchor.length)!==check.length||!check.equals(anchor))throw fault('USAGE_SOURCE_REWRITTEN');}
    const chunk=Buffer.alloc(Math.min(65536,Math.max(1,stat.size-offset)));let count=0;
    while(offset<stat.size){
     const n=readSync(fd,chunk,0,Math.min(chunk.length,stat.size-offset),offset);if(!n)throw fault('USAGE_SOURCE_TRUNCATED');
     offset+=n;const data=Buffer.concat([pending,chunk.subarray(0,n)]);let start=0,end;
     while((end=data.indexOf(10,start))>=0){
      if(end-start>maxLineBytes)throw fault('USAGE_LINE_LIMIT');
      if(++count>maxLinesPerPoll)throw fault('USAGE_READER_BACKLOG');
      const bytes=data.subarray(start,end);start=end+1;lines++;
      if(!bytes.length)continue;
      let row;try{row=JSON.parse(decoder.decode(bytes));}catch{throw fault('USAGE_INVALID_NDJSON');}
      if(!row||typeof row!=='object'||Array.isArray(row))throw fault('USAGE_INVALID_NDJSON');
      consume(row,lines);
     }
     pending=Buffer.from(data.subarray(start));if(pending.length>maxLineBytes)throw fault('USAGE_LINE_LIMIT');
    }
    anchor=Buffer.alloc(Math.min(64,offset));if(anchor.length&&readSync(fd,anchor,0,anchor.length,offset-anchor.length)!==anchor.length)throw fault('USAGE_SOURCE_TRUNCATED');
    if(final&&pending.length)throw fault('USAGE_TRUNCATED_TAIL');
    return {missing:false,bytes:offset,lines,pendingBytes:pending.length};
   }catch(e){failed=/^USAGE_[A-Z_]+$/.test(e.code??'')?e.code:'USAGE_READ_FAILED';throw fault(failed);}
   finally{if(fd!==undefined)closeSync(fd);}
  },
 };
}

function counters(raw,kind){
 const v=kind==='managed'?{
  inputTokens:raw?.inputTokens,cachedInputTokens:raw?.cachedInputTokens,outputTokens:raw?.outputTokens,totalTokens:raw?.totalTokens,
  reasoning:raw?.reasoningOutputTokens,
 }:{inputTokens:raw?.input_tokens,cachedInputTokens:raw?.cached_input_tokens,outputTokens:raw?.output_tokens,totalTokens:raw?.total_tokens??(raw?.input_tokens+raw?.output_tokens),reasoning:raw?.reasoning_output_tokens};
 if(!fields.every(k=>integer(v[k]))||v.cachedInputTokens>v.inputTokens||v.totalTokens!==v.inputTokens+v.outputTokens||v.reasoning!==undefined&&(!integer(v.reasoning)||v.reasoning>v.outputTokens))throw fault('USAGE_INVALID_COUNTERS');
 return Object.fromEntries(fields.map(k=>[k,v[k]]));
}

export function createContinuityUsageGuard({actors,limits,now=Date.now,missingFileGraceMs=10000,readerOptions={}}){
 limits=validateUsageLimits(limits);
 if(!Array.isArray(actors)||!actors.length||actors.length>5||!Number.isSafeInteger(missingFileGraceMs)||missingFileGraceMs<0)throw fault('INVALID_USAGE_GUARD');
 const rows=new Map(),aggregate=zero();let trigger=null,finalized=false;
 for(const actor of actors){
  if(!id(actor.id)||rows.has(actor.id)||!['managed','baseline'].includes(actor.kind)||typeof actor.path!=='string')throw fault('INVALID_USAGE_GUARD');
  rows.set(actor.id,{id:actor.id,kind:actor.kind,tail:createUsageTail(actor.path,readerOptions),activatedAt:null,threads:new Map(),current:null,totals:zero(),unknowns:[],reader:null,final:false});
 }
 const unknown=(row,code)=>{if(!row.unknowns.includes(code))row.unknowns.push(code);trigger??={code:'USAGE_EVIDENCE_UNKNOWN',actor:row.id,reason:code,at:now()};};
 const epoch=(row,threadId)=>{
  if(!id(threadId))throw fault('USAGE_THREAD_UNKNOWN');
  if(!row.threads.has(threadId)){
   if(row.threads.size>=32)throw fault('USAGE_THREAD_LIMIT');
   row.threads.set(threadId,{threadId,epoch:row.threads.size+1,cumulative:zero(),updates:0,active:new Map(),pendingCompleted:0,turns:0});
  }
  return row.threads.get(threadId);
 };
 const update=(row,threadId,raw)=>{
  const t=epoch(row,threadId),next=counters(raw,row.kind);
  if(fields.some(k=>next[k]<t.cumulative[k]))throw fault('USAGE_COUNTER_REGRESSION');
  for(const k of fields){const delta=next[k]-t.cumulative[k];if(!integer(row.totals[k]+delta)||!integer(aggregate[k]+delta))throw fault('USAGE_COUNTER_OVERFLOW');}
  for(const k of fields){const delta=next[k]-t.cumulative[k];row.totals[k]+=delta;aggregate[k]+=delta;}
  t.cumulative=next;t.updates++;t.pendingCompleted=0;for(const key of t.active.keys())t.active.set(key,true);
  for(const [scope,used,budget] of [['actor',row.totals,limits.perActor],['aggregate',aggregate,limits.aggregate]])for(const k of ['totalTokens','outputTokens'])if(used[k]>=budget[k])trigger??={code:'USAGE_LIMIT_REACHED',actor:row.id,scope,field:k,observed:used[k],limit:budget[k],at:now()};
 };
 const consume=(row,e)=>{
  if(row.kind==='baseline'){
   if(e.type==='unparsed')throw fault('USAGE_UNPARSED_HOST_OUTPUT');
   if(e.type==='thread.started'){epoch(row,e.thread_id);row.current=e.thread_id;}
   else if(['turn.started','turn.completed','turn.failed'].includes(e.type)){
    if(!row.current)throw fault('USAGE_THREAD_UNKNOWN');
    const t=epoch(row,row.current);
    if(e.type==='turn.started'){if(t.active.size)throw fault('USAGE_TURN_OVERLAP');t.active.set('exec',false);t.turns++;}
    else if(e.type==='turn.failed')throw fault('USAGE_FAILED_TURN_UNKNOWN');
    else{update(row,row.current,e.usage);t.active.clear();}
   }
  }else if(e.kind==='host-session'&&e.state==='connected'){
   if(e.resumed===true&&!row.threads.has(e.threadId))throw fault('USAGE_UNSEEN_RESUMED_THREAD');
   epoch(row,e.threadId);
  }else if(e.kind==='host-event'){
   if(!['turn/started','turn/completed','thread/tokenUsage/updated'].includes(e.method))return;
   const t=epoch(row,e.threadId);
   if(e.method==='thread/tokenUsage/updated')update(row,e.threadId,e.tokenUsage?.total);
   else{
    if(!id(e.turnId))throw fault('USAGE_TURN_UNKNOWN');
    if(e.method==='turn/started'){
     if(t.active.has(e.turnId))return;
     if(t.turns>=50000||t.active.size>=32)throw fault('USAGE_TURN_LIMIT');
     t.active.set(e.turnId,false);t.turns++;
    }else{
     if(!t.active.has(e.turnId))throw fault('USAGE_TURN_UNKNOWN');
     if(!t.active.get(e.turnId))t.pendingCompleted++;
     t.active.delete(e.turnId);
    }
   }
  }
 };
 return {
  activate(actorId){const row=rows.get(actorId);if(!row||row.final)throw fault('INVALID_USAGE_ACTOR');row.activatedAt??=now();finalized=false;},
  poll({finalActorIds=[],finish=false}={}){
   for(const row of rows.values()){
    if(row.activatedAt===null){if(finish)row.final=true;continue;}
    if(row.final)continue;
    const final=finish||finalActorIds.includes(row.id);
    try{
     row.reader=row.tail.poll(e=>consume(row,e),{final,required:final||now()-row.activatedAt>=missingFileGraceMs});
     if(final){
      if(!row.threads.size||[...row.threads.values()].some(t=>!t.updates))unknown(row,'USAGE_NOT_OBSERVED');
      if([...row.threads.values()].some(t=>t.active.size||t.pendingCompleted))unknown(row,'USAGE_IN_FLIGHT_UNKNOWN');
     }
    }catch(e){unknown(row,e.code);}
    if(final)row.final=true;
   }
   finalized=[...rows.values()].every(row=>row.final);
   return this.snapshot();
  },
  snapshot(){return {
   schema:'sim-continuity-observed-usage/1',kind:'observed-usage-guard',status:trigger?.code==='USAGE_LIMIT_REACHED'?'limit-reached':trigger?'unknown':finalized?'complete':'monitoring',
   limits,aggregate:{...aggregate},trigger,possibleInFlightOvershoot:true,billing:'not measured',internalInferenceCalls:'unknown; host turns are not internal model request counts',
   actors:[...rows.values()].map(row=>({id:row.id,kind:row.kind,activatedAt:row.activatedAt,final:row.final,totals:{...row.totals},unknowns:[...row.unknowns],reader:row.reader,threads:[...row.threads.values()].map(t=>({threadId:t.threadId,epoch:t.epoch,cumulative:{...t.cumulative},updates:t.updates,observedTurnStarts:t.turns,inFlightTurns:t.active.size,unaccountedCompletedTurns:t.pendingCompleted}))})),
  };},
 };
}
