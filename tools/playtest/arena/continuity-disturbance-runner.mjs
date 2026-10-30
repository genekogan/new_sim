// Passive connection to the common trial's actual files. No actor reads, model
// prompts, relocation, credential access or replacement trial orchestration.
import {createHash} from 'node:crypto';
import * as sourceFs from 'node:fs';
import {mkdirSync,writeFileSync,renameSync,appendFileSync,realpathSync} from 'node:fs';
import {join,resolve,isAbsolute,basename} from 'node:path';
import {createUsageTail} from './continuity-usage.mjs';
import {createContinuityDisturbances} from './continuity-disturbances.mjs';
const fault=code=>Object.assign(Error(code),{code});
const id=x=>typeof x==='string'&&/^[-A-Za-z0-9_]{1,120}$/.test(x);
const hash=x=>createHash('sha256').update(x).digest('hex');
const digest=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const cited=x=>Array.isArray(x)&&x.length>0&&x.length<=16&&x.every(s=>typeof s==='string'&&s.length>0&&s.length<=1000);
const stamp=x=>typeof x==='number'&&Number.isFinite(x)?x:typeof x==='string'&&/(Z|[+-]\d\d:\d\d)$/.test(x)&&Number.isFinite(Date.parse(x))?Date.parse(x):NaN;
const same=(a,b)=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
const clone=x=>structuredClone(x);
// Snapshot only one opened regular file. Atomic status replacement can unlink
// an old inode between lookup/stat/read; reopen at most twice, never accept a
// symlink, hardlink, oversized file or unproved/torn snapshot.
export function readDisturbanceJson(path,{optional=false,maxBytes=256*1024,partial=false,onRetry=()=>{}}={},io=sourceFs){
 const source=['run.json','capture-status.json','export-status.json','native-evidence.json','summary.json'].includes(basename(path))?basename(path):'json-source';
 if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>256*1024)throw fault('INVALID_DISTURBANCE_SOURCE_BOUND');
 for(let attempt=1;attempt<=3;attempt++){
  let fd,step='open';
  const failed=(code,check,extra={})=>Object.assign(fault(code),{sourceFacts:{source,check,attempt,...extra}});
  const changed=check=>{if(attempt===3)throw failed('DISTURBANCE_SOURCE_UNSAFE',check);onRetry({source,check,attempt});};
  try{
   fd=io.openSync(path,io.constants.O_RDONLY|io.constants.O_NOFOLLOW|io.constants.O_NONBLOCK);
   step='canonical-path';if(io.realpathSync(path)!==path)throw failed('DISTURBANCE_SOURCE_UNSAFE',step);
   step='initial-stat';const before=io.fstatSync(fd);
   if(before.nlink===0){changed('unlinked-before-read');continue;}
   if(!before.isFile()||before.nlink!==1||before.size>maxBytes)throw failed('DISTURBANCE_SOURCE_UNSAFE','initial-file-type-links-or-size',{nlink:before.nlink,bytes:before.size});
   step='read';const buffer=Buffer.alloc(maxBytes+1);let bytes=0,n;
   while(bytes<buffer.length&&(n=io.readSync(fd,buffer,bytes,buffer.length-bytes,null))>0)bytes+=n;
   if(bytes>maxBytes)throw failed('DISTURBANCE_SOURCE_UNSAFE','read-size',{bytes});
   step='final-stat';const after=io.fstatSync(fd);
   if(after.nlink===0){changed('unlinked-after-read');continue;}
   if(!after.isFile()||after.nlink!==1||after.size>maxBytes)throw failed('DISTURBANCE_SOURCE_UNSAFE','final-file-type-links-or-size',{nlink:after.nlink,bytes:after.size});
   if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs||bytes!==after.size){changed('modified-during-read');continue;}
   const raw=buffer.subarray(0,bytes);if(partial&&!raw.toString('utf8').endsWith('\n'))return null;
   try{return JSON.parse(raw);}catch{throw failed('DISTURBANCE_SOURCE_JSON_INVALID','json-parse');}
  }catch(error){
   if(error.sourceFacts)throw error;
   if(optional&&fd===undefined&&error.code==='ENOENT')return null;
   throw failed(error.code==='ELOOP'?'DISTURBANCE_SOURCE_UNSAFE':'DISTURBANCE_SOURCE_MISSING',step,{errno:/^[A-Z0-9_]{1,40}$/.test(error.code??'')?error.code:'UNKNOWN'});
  }finally{if(fd!==undefined)io.closeSync(fd);}
 }
}
const tail=path=>createUsageTail(path,{maxLineBytes:256*1024,maxPollBytes:4*1024*1024,maxFileBytes:128*1024*1024,maxLinesPerPoll:10000});
function pollTail(reader,consume,options){let callbackError;try{return reader.poll((row,line)=>{try{consume(row,line);}catch(e){callbackError=e;throw e;}},options);}catch(e){throw callbackError??e;}}

/** start before calling runContinuityTrial. outputDirectory must be a separate
 * new sibling/private directory: this module never creates trialDirectory.
 * Transports return native response identities, never inferred matches:
 * world: {status,worldId,senderSoulId,speechId,evidence};
 * owner: {status,worldId,recipientSoulId,messageId,evidence}.
 * Uncertain sends without native identity remain unproved and are never resent.
 */
export function createContinuityDisturbanceRunner({trialDirectory,outputDirectory,captureDirectory,runId,worldId,scenario,actors,fixtureActors=[],worldSenders={},evidence,pollMs=250,manifestWaitMs=30000},{sendWorld,sendOwner,now=Date.now,onFailure=()=>{},schedule=setTimeout,cancel=clearTimeout}={}){
 if(![trialDirectory,outputDirectory,captureDirectory].every(p=>typeof p==='string'&&isAbsolute(p))||!id(runId)||!id(worldId)||!scenario||!id(scenario.id)||!Array.isArray(actors)||!actors.length||actors.length>5||!Array.isArray(fixtureActors)||fixtureActors.length>5||!cited(evidence)||!Number.isInteger(pollMs)||pollMs<1||pollMs>500||!Number.isInteger(manifestWaitMs)||manifestWaitMs<1||manifestWaitMs>600000)throw fault('INVALID_DISTURBANCE_RUNNER');
 const trial=resolve(trialDirectory),out=resolve(outputDirectory),capture=resolve(captureDirectory),spec=clone(scenario),senders=clone(worldSenders),scope=new Map(),participants=new Map(),fixtures=new Map(),souls=new Set();evidence=clone(evidence);
 if(out===trial||out.startsWith(trial+'/')||realpathSync(resolve(out,'..'))!==resolve(out,'..'))throw fault('DISTURBANCE_OUTPUT_MUST_BE_SEPARATE');
 for(const [list,map]of [[actors,participants],[fixtureActors,fixtures]])for(const a of list){if(!id(a.actorId)||!id(a.soulId)||scope.has(a.actorId)||souls.has(a.soulId))throw fault('INVALID_DISTURBANCE_RUNNER_SCOPE');map.set(a.actorId,a.soulId);scope.set(a.actorId,a.soulId);souls.add(a.soulId);}
 if(!same(participants.keys(),spec.actors?.map(a=>a.id)??[]))throw fault('INVALID_DISTURBANCE_RUNNER_SCOPE');
 const social=spec.disturbances.filter(d=>['scheduled-event','moving-body-journey','garden-group-overlap'].includes(d.trigger?.kind)),ownerRequired=social.some(d=>d.trigger.deliveryKind==='owner');
 for(const d of social){if(d.trigger.deliveryKind==='world'&&(!fixtures.has(senders[d.id])||typeof sendWorld!=='function')||d.trigger.deliveryKind==='owner'&&typeof sendOwner!=='function')throw fault('DISTURBANCE_TRANSPORT_MISSING');}
 mkdirSync(out,{mode:0o700});writeFileSync(join(out,'events.jsonl'),'',{flag:'wx',mode:0o600});
 const createdAt=now(),timelineTail=tail(join(trial,'timeline.jsonl')),captureTail=tail(join(capture,'native-capture.jsonl')),exportDirectory=join(trial,'native-export'),exportTail=tail(join(exportDirectory,'native-snapshots.jsonl'));
 let run=null,runDigest=null,dispatcher=null,failure=null,closed=false,stopping=false,started=false,timer=null,active=null,finishPromise=null,lastPollAt=null,eventLines=0,captureEpoch=null,captureGeneration=0,captureIndex=0,captureHash='',captureScopeHash=null,parsedCaptureIndex=0,parsedCaptureHash='',exportBytes=0,committedExportBytes=0,ownerSourceSeen=false,nativeSourceStatus='unknown';
 const sendAbort=new AbortController();
 const capturePending=[],exportPending=[],bindings=new Map(),sequences=new Map(),receipts=new Map(),deliveryFacts=new Map(),lastBodies=new Map();
 const counts={timeline:0,capture:0,export:0},sourceReadRetries={count:0,last:null};
 const readJson=(path,options={})=>readDisturbanceJson(path,{...options,onRetry:fact=>{sourceReadRetries.count++;sourceReadRetries.last={...fact,at:now()};if(sourceReadRetries.count<=32)record({kind:'source-read-retry',...sourceReadRetries.last});}});
 const persist=()=>{writeFileSync(join(out,'disturbances.json.tmp'),JSON.stringify(snapshot(),null,2)+'\n',{mode:0o600});renameSync(join(out,'disturbances.json.tmp'),join(out,'disturbances.json'));};
 const fail=value=>{if(!failure){const code=typeof value==='string'?value:value?.code;failure={code:/^[A-Z0-9_]{1,100}$/.test(code??'')?code:'DISTURBANCE_RUNNER_UNKNOWN',at:now(),...(value?.sourceFacts?{sourceFacts:clone(value.sourceFacts)}:{})};try{onFailure(clone(failure));}catch{}}};
 const record=r=>{appendFileSync(join(out,'events.jsonl'),JSON.stringify(r)+'\n');eventLines++;};
 const scoped=actorId=>({worldId,actorId,soulId:participants.get(actorId)});
 function rememberDelivery(value){const key=JSON.stringify([value.actorId,value.source,value.eventId]),old=deliveryFacts.get(key);if(old&&['actorId','source','eventId','createdAt','effectId','senderSoulId'].some(k=>old[k]!==value[k]))throw fault('NATIVE_DELIVERY_IDENTITY_CHANGED');if(old)return;if(deliveryFacts.size>=4096)throw fault('NATIVE_DELIVERY_HISTORY_BOUND');deliveryFacts.set(key,value);}
 function linkDeliveries(){
  if(!dispatcher)return;const state=dispatcher.snapshot();
  for(const row of Object.values(state.disturbances)){
   if(!row.dispatch?.effectId)continue;
   for(const fact of deliveryFacts.values())if(fact.effectId===row.dispatch.effectId&&row.recipients.includes(fact.actorId)&&fact.source===spec.disturbances.find(d=>d.id===row.id).trigger.deliveryKind&&(fact.source!=='world'||fact.senderSoulId===fixtures.get(senders[row.id]))){
    if(row.deliveryEvents.some(e=>e.actor===fact.actorId))continue;
    dispatcher.observeDelivery({...scoped(fact.actorId),disturbanceId:row.id,dispatchId:row.dispatch.id,eventId:fact.eventId,source:fact.source,createdAt:fact.createdAt,effectId:fact.effectId,evidence:[fact.evidence],linkageEvidence:[...row.dispatch.evidence,fact.linkageEvidence].slice(0,64)});
   }
  }
 }
 async function send(request){
  if(failure||closed||stopping||now()>=run.cutoffAt)return {status:'uncertain',evidence:['disturbance-runner#dispatch-suppressed']};
  request={...request,signal:AbortSignal.any([request.signal,sendAbort.signal])};
  let response;try{
   if(request.deliveryKind==='world'){
    const senderActorId=senders[request.id],senderSoulId=fixtures.get(senderActorId);response=await sendWorld({...request,senderActorId,senderSoulId});
    if(response?.worldId!==worldId||response?.senderSoulId!==senderSoulId)throw fault('WORLD_ACK_SCOPE_MISMATCH');
    if(!['accepted','refused','uncertain'].includes(response.status)||!cited(response.evidence))throw fault('WORLD_ACK_INVALID');
    return {status:response.status,effectId:typeof response.speechId==='string'&&response.speechId.length>0&&response.speechId.length<=300?response.speechId:undefined,evidence:response.evidence};
   }
   if(request.recipients.length!==1)throw fault('OWNER_DISTURBANCE_RECIPIENT_COUNT');
   response=await sendOwner(request);
   if(response?.worldId!==worldId||response?.recipientSoulId!==request.recipients[0].soulId)throw fault('OWNER_ACK_SCOPE_MISMATCH');
   if(!['accepted','refused','uncertain'].includes(response.status)||!cited(response.evidence))throw fault('OWNER_ACK_INVALID');
   return {status:response.status,effectId:typeof response.messageId==='string'&&response.messageId.length>0&&response.messageId.length<=300?response.messageId:undefined,evidence:response.evidence};
  }catch(error){record({kind:'transport-uncertain',id:request.id,at:now(),code:/^[A-Z0-9_]+$/.test(error?.code??'')?error.code:'NATIVE_SEND_UNCERTAIN'});return {status:'uncertain',evidence:[join(out,'events.jsonl')+'#L'+eventLines]};}
 }
 function loadRun(){
  const value=readJson(join(trial,'run.json'),{optional:true,partial:true});if(!value){if(run||now()-createdAt>manifestWaitMs)throw fault('TRIAL_MANIFEST_MISSING');return;}
  if(run){if(hash(JSON.stringify(value))!==runDigest)throw fault('TRIAL_MANIFEST_CHANGED');return;}
  if(value.schema!=='sim-continuity-trial/1'||value.runId!==runId||value.worldId!==worldId||!Number.isFinite(value.startedAt)||value.startedAt<createdAt||value.cutoffAt!==value.startedAt+spec.timing.endOffsetSec*1000||value.meetingAt!==value.startedAt+spec.timing.meetingOffsetSec*1000||!Array.isArray(value.actors)||!same(value.actors.map(a=>a.id),participants.keys())||!Array.isArray(value.fixtureActors)||!same(value.fixtureActors.map(a=>a.id),fixtures.keys()))throw fault('TRIAL_MANIFEST_SCOPE_MISMATCH');
  for(const a of value.actors)if(participants.get(a.id)!==a.soulId||(a.releaseOffsetSec??0)!==(spec.actors.find(s=>s.id===a.id).releaseOffsetSec??0)||!digest(a.instructionSha256))throw fault('TRIAL_MANIFEST_ACTOR_MISMATCH');
  for(const a of value.fixtureActors)if(fixtures.get(a.id)!==a.soulId)throw fault('TRIAL_MANIFEST_ACTOR_MISMATCH');
  if(ownerRequired&&(!value.nativeEvidence||value.nativeEvidence.exportDirectory!=='native-export'||value.nativeEvidence.runId!==runId))throw fault('OWNER_NATIVE_EXPORT_NOT_CONFIGURED');
  run=value;runDigest=hash(JSON.stringify(value));dispatcher=createContinuityDisturbances({scenario:spec,t0:run.startedAt,cutoffAt:run.cutoffAt,worldId,actors:[...participants].map(([actorId,soulId])=>({actorId,soulId})),evidence:[...evidence,join(trial,'run.json')]},{now,send,onRecord:record});
 }
 function captureStatus(){
  const status=readJson(join(capture,'capture-status.json'),{optional:!run,maxBytes:65536});if(!status)return null;
  if(status.schema!=='continuity-native-capture/1'||status.runId!==runId||status.worldId!==worldId||!Array.isArray(status.soulIds)||!same(status.soulIds,souls)||!Number.isSafeInteger(status.index)||status.index<1||!digest(status.lastHash)||typeof status.epoch!=='string'||!Number.isSafeInteger(status.generation)||status.generation<1||status.healthy!==true||status.failure||!Number.isFinite(status.heartbeatAt)||!Number.isSafeInteger(status.limits?.maxHeartbeatGapMs)||status.limits.maxHeartbeatGapMs<1||status.limits.maxHeartbeatGapMs>60000||now()-status.heartbeatAt>status.limits.maxHeartbeatGapMs||status.heartbeatAt>now())throw fault('NATIVE_CAPTURE_SCOPE_OR_HEALTH');
  if(run&&status.startedAt>run.startedAt)throw fault('NATIVE_CAPTURE_STARTED_AFTER_T0');
  if(!Number.isFinite(status.startedAt)||status.startedAt>now())throw fault('NATIVE_CAPTURE_STARTED_AFTER_T0');
  if(captureEpoch===null){
   captureEpoch=status.epoch;
   if(!Array.isArray(status.bindings)||status.bindings.length!==souls.size||!Array.isArray(status.startHeads)||status.startHeads.length!==souls.size)throw fault('NATIVE_CAPTURE_BINDINGS_MISSING');
   for(const b of status.bindings){if(!souls.has(b.soulId)||!b.owner||!b.bodyId||bindings.has(b.soulId))throw fault('NATIVE_CAPTURE_BINDINGS_MISMATCH');bindings.set(b.soulId,{owner:b.owner,bodyId:b.bodyId});}
   for(const h of status.startHeads){if(!souls.has(h.soulId)||sequences.has(h.soulId)||!Number.isSafeInteger(h.head)||h.head<0)throw fault('NATIVE_CAPTURE_HEAD_INVALID');sequences.set(h.soulId,h.head);}
   captureScopeHash=hash(JSON.stringify([status.bindings,status.startHeads,status.startedAt]));
  }
  if(status.epoch!==captureEpoch||status.generation<captureGeneration||status.index<captureIndex||status.index===captureIndex&&status.lastHash!==captureHash||status.closed&&(!run||now()<run.cutoffAt))throw fault('NATIVE_CAPTURE_CHANGED');
  if(!Array.isArray(status.bindings)||status.bindings.length!==bindings.size||status.bindings.some(b=>!bindings.has(b.soulId)||bindings.get(b.soulId).owner!==b.owner||bindings.get(b.soulId).bodyId!==b.bodyId))throw fault('NATIVE_CAPTURE_BINDINGS_MISMATCH');
  if(hash(JSON.stringify([status.bindings,status.startHeads,status.startedAt]))!==captureScopeHash)throw fault('NATIVE_CAPTURE_BINDINGS_MISMATCH');
  captureGeneration=status.generation;return status;
 }
 function receiptFact(row,pointer){
  const actor=[...participants].find(([,soul])=>soul===row.soulId)?.[0];if(!actor||!spec.disturbances.some(d=>d.trigger.kind==='moving-body-journey'&&d.trigger.recipients.includes(actor)))return;
  const e=row.event,r=e.receipt;if(!r?.id||typeof r.capability!=='string'||! /^(walk|read|sit):/.test(r.capability))return;
  const key=actor+':'+r.id,old=receipts.get(key);if(!old&&receipts.size>=64)throw fault('NATIVE_RECEIPT_HISTORY_BOUND');
  const terminal=['completed','failed','replaced','cancelled','canceled'].includes(r.phase);
  if(!old&&!['waiting','accepted'].includes(r.phase))throw fault('NATIVE_RECEIPT_ACCEPTANCE_MISSING');
  const value={actorId:actor,id:r.id,capability:r.capability,acceptedAtUtc:old?.acceptedAtUtc??e.at,phase:r.phase,endedAtUtc:terminal?e.at:old?.endedAtUtc,evidence:[...(old?.evidence??[]).slice(0,3),pointer]};
  if(old&&(old.capability!==r.capability||old.endedAtUtc!==undefined&&value.endedAtUtc!==old.endedAtUtc))throw fault('NATIVE_RECEIPT_CHANGED');
  receipts.set(key,value);if(dispatcher){dispatcher.observeReceipt({...scoped(actor),observedAt:now(),receipt:value,evidence:value.evidence});value.forwarded=true;}
 }
 function nativeRecord(row){
  const pointer=join(capture,'native-capture.jsonl')+'#L'+row.index;counts.capture++;
  if(row.kind!=='recipient-event')return;
  if(!souls.has(row.soulId)||!Number.isSafeInteger(row.seq)||row.seq!==sequences.get(row.soulId)+1||row.event?.id!=='c_'+row.seq||!Number.isFinite(row.event?.at)||row.event.at>now())throw fault('NATIVE_RECIPIENT_SEQUENCE_OR_SCOPE');sequences.set(row.soulId,row.seq);
  if(row.event.kind==='receipt')receiptFact(row,pointer);
  const actor=[...participants].find(([,soul])=>soul===row.soulId)?.[0],event=row.event;
  if(actor&&typeof event.saidId==='string'&&typeof event.from?.soulId==='string')rememberDelivery({actorId:actor,source:'world',eventId:event.id,createdAt:event.at,effectId:event.saidId,senderSoulId:event.from.soulId,evidence:pointer,linkageEvidence:pointer+'/event/saidId'});
 }
 function pollCapture(final=false){
  const status=captureStatus();if(!status){if(run)throw fault('NATIVE_CAPTURE_MISSING');return;}
  const result=pollTail(captureTail,(row,line)=>{const {hash:actual,...body}=row;if(row.schema!=='continuity-native-record/1'||row.index!==parsedCaptureIndex+1||row.index!==line||row.runId!==runId||row.worldId!==worldId||row.epoch!==captureEpoch||row.previousHash!==parsedCaptureHash||hash(JSON.stringify(body))!==actual)throw fault('NATIVE_CAPTURE_CHAIN_INVALID');parsedCaptureIndex++;parsedCaptureHash=actual;capturePending.push(row);if(capturePending.length>10000)throw fault('NATIVE_CAPTURE_PENDING_BOUND');},{required:!!run,final});
  if(result.missing)return;
  if(status.index>parsedCaptureIndex)throw fault('NATIVE_CAPTURE_COMMITTED_PREFIX_MISSING');
  const ready=[];let nextHash=captureHash;for(const row of capturePending){if(row.index>status.index)break;ready.push(row);nextHash=row.hash;}
  if(nextHash!==status.lastHash)throw fault('NATIVE_CAPTURE_COMMITTED_HASH_MISMATCH');
  capturePending.splice(0,ready.length);captureIndex=status.index;captureHash=status.lastHash;for(const row of ready)nativeRecord(row);
 }
 function timelineRow(r,line){
  counts.timeline++;if(!dispatcher)return;const actor=r.actor;if(!participants.has(actor))return;const pointer=join(trial,'timeline.jsonl')+'#L'+line;
  if(['body','setup-body'].includes(r.kind)){
   if(r.source!=='here'||r.soulId!==participants.get(actor)||!Number.isFinite(r.receivedAt)||r.receivedAt<run.startedAt||r.receivedAt>run.cutoffAt)return;
   const body={...scoped(actor),at:r.receivedAt,receivedAt:r.receivedAt,source:'here',currentBody:!!r.me?.pos,pos:r.me?.pos??null,evidence:[pointer]},old=lastBodies.get(actor);
   if(old?.at===body.at){if(JSON.stringify(old.pos)!==JSON.stringify(body.pos)||old.currentBody!==body.currentBody)throw fault('NATIVE_BODY_CLOCK_COLLISION');return;}lastBodies.set(actor,body);dispatcher.observeBody(body);
  }else if(r.kind==='observation-error'&&Number.isFinite(r.at)&&r.at>=run.startedAt&&r.at<=run.cutoffAt){const old=lastBodies.get(actor);if(old?.at===r.at)throw fault('NATIVE_BODY_CLOCK_COLLISION');const b={...scoped(actor),at:r.at,receivedAt:r.at,source:'here',currentBody:false,pos:null,evidence:[pointer]};lastBodies.set(actor,b);dispatcher.observeBody(b);
  }else if(r.kind==='actor-release'){
   const a=run.actors.find(a=>a.id===actor);dispatcher.observeRelease({...scoped(actor),scheduledAt:r.scheduledAt,releasedAt:r.releasedAt,initialInstructionId:'sha256:'+a.instructionSha256,evidence:[pointer,join(trial,'run.json')+'#/actors/'+actor+'/instructionSha256']});
  }
 }
 function pollOwner(final=false){
  if(!ownerRequired||!run)return;
  const status=readJson(join(exportDirectory,'export-status.json'),{optional:true,maxBytes:65536});if(!status){if(now()-run.startedAt>5000)throw fault('OWNER_NATIVE_EXPORT_MISSING');return;}
  if(status.schema!=='continuity-native-export/1'||status.runId!==runId||status.worldId!==worldId||status.epoch!==captureEpoch||status.failure||!Number.isSafeInteger(status.bytes)||status.bytes<committedExportBytes)throw fault('OWNER_EXPORT_SCOPE_MISMATCH');ownerSourceSeen=true;
  const result=pollTail(exportTail,(row,line)=>{exportBytes+=Buffer.byteLength(JSON.stringify(row)+'\n');exportPending.push({row,line,end:exportBytes});if(exportPending.length>10000)throw fault('OWNER_EXPORT_PENDING_BOUND');},{required:true,final});
  if(exportBytes!==result.bytes-result.pendingBytes||status.bytes>exportBytes)throw fault('OWNER_EXPORT_PREFIX_INVALID');
  while(exportPending.length&&exportPending[0].end<=status.bytes){const {row:r,line,end}=exportPending.shift();committedExportBytes=end;counts.export++;if(r.schema==='continuity-native-snapshot/1')continue;
   if(r.schema!=='continuity-native-row/1'||!r.row||hash(JSON.stringify(r.row))!==r.sha256||r.row.world_id!==worldId)throw fault('OWNER_EXPORT_ROW_INVALID');if(r.table!=='soul_inbox_queue_v1')continue;
   const row=r.row,soulId=typeof row.scope==='string'?row.scope.slice(5):null,actor=[...participants].find(([,soul])=>soul===soulId)?.[0];
   if(!souls.has(soulId)||row.scope!=='soul:'+soulId||row.owner!==bindings.get(soulId)?.owner||r.key!==JSON.stringify([worldId,row.scope,row.owner,row.n])||!id(row.id)||!Number.isFinite(stamp(row.sent_at)))throw fault('OWNER_NATIVE_ROW_SCOPE_MISMATCH');
   if(actor){const pointer=join(exportDirectory,'native-snapshots.jsonl')+'#L'+line;rememberDelivery({actorId:actor,source:'owner',eventId:row.id,createdAt:stamp(row.sent_at),effectId:row.id,evidence:pointer,linkageEvidence:pointer+'/row/id'});}
  }
  if(committedExportBytes!==status.bytes)throw fault('OWNER_EXPORT_COMMITTED_BOUNDARY_INVALID');
 }
 function poll({final=false}={}){
  if(closed)return snapshot();lastPollAt=now();
  try{
   loadRun();pollCapture(final);
   if(run){for(const r of receipts.values())if(!r.forwarded){dispatcher.observeReceipt({...scoped(r.actorId),observedAt:now(),receipt:r,evidence:r.evidence});r.forwarded=true;}
    pollTail(timelineTail,timelineRow,{required:true,final});pollOwner(final);linkDeliveries();
    if(!failure&&!stopping&&!active&&now()<run.cutoffAt)active=dispatcher.tick().then(()=>{linkDeliveries();persist();}).catch(e=>{fail(e);try{persist();}catch{fail('DISTURBANCE_RUNNER_EVIDENCE_FAILED');}}).finally(()=>{active=null;});
   }
  }catch(error){fail(error);}
  try{persist();}catch{fail('DISTURBANCE_RUNNER_EVIDENCE_FAILED');}return snapshot();
 }
 function snapshot(){return {schema:'continuity-disturbance-runner/1',runId,worldId,scenarioId:spec.id,createdAt,started,closed,status:failure?'unknown':!run?'awaiting-trial-manifest':closed?'closed':'observing',failure:clone(failure),pollMs,lastPollAt,sourceCounts:{...counts},sourceReadRetries:clone(sourceReadRetries),capture:{epoch:captureEpoch,index:captureIndex,hash:captureHash},ownerSourceSeen,nativeSourceStatus,dispatchPending:!!active,dispatcher:dispatcher?.snapshot()??null,evidence:{manifest:join(trial,'run.json'),timeline:join(trial,'timeline.jsonl'),capture:join(capture,'native-capture.jsonl'),output:join(out,'events.jsonl')},limits:'Observed native trigger and dispatch evidence only. Original dispatcher invalid/firstMotionContradiction is retained; delivered alone is not a pass. No actor assistance or qualification claim.'};}
 const start=()=>{if(started||closed)return snapshot();started=true;const again=()=>{if(closed)return;poll();if(!failure&&(!run||now()<run.cutoffAt))timer=schedule(again,pollMs);};again();return snapshot();};
 const settle=async()=>{if(active)await active;return snapshot();};
 const finish=()=>{if(finishPromise)return finishPromise;stopping=true;sendAbort.abort();finishPromise=(async()=>{cancel(timer);poll({final:true});if(active)await active;try{
  linkDeliveries();if(!run)throw fault('TRIAL_MANIFEST_MISSING');if(now()<run.cutoffAt)fail('DISTURBANCE_OBSERVATION_ENDED_EARLY');dispatcher?.finish();
  const native=readJson(join(trial,'native-evidence.json'),{optional:true}),summary=readJson(join(trial,'summary.json'),{optional:true}),coverage=native?.coverage;
  if(native?.schema!=='continuity-native-lifecycle/1'||native.status!=='pass'||native.failure||coverage?.status!=='pass'||coverage.runId!==runId||coverage.worldId!==worldId||coverage.from!==run.startedAt||coverage.to!==run.cutoffAt||summary?.schema!=='sim-continuity-trial-result/1'||summary.coverage?.nativeSources!=='pass'||hash(JSON.stringify(summary.nativeEvidence))!==hash(JSON.stringify(native)))throw fault('COMMON_NATIVE_SOURCE_COVERAGE_UNKNOWN');
  nativeSourceStatus='pass';
 }catch(error){fail(error);}closed=true;try{persist();}catch{fail('DISTURBANCE_RUNNER_EVIDENCE_FAILED');}return snapshot();})();return finishPromise;};
 persist();return {start,poll,settle,finish,snapshot};
}
