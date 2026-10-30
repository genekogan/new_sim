#!/usr/bin/env node
// Opt-in managed controller for an already paired folder. Never pairs, takes
// ownership, or changes a CLI credential. Stop any other controller first.
import {parseArgs} from 'node:util';
import {readFileSync,mkdirSync,writeFileSync,renameSync,lstatSync,openSync,closeSync,fstatSync,fchmodSync,fsyncSync,constants} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import {CodexHost} from './codex-host.mjs';
import {openJournal} from './journal.mjs';
import {createWorldClient} from './world-client.mjs';
import {runManaged} from './managed.mjs';
import {abortableSleep} from './receiver.mjs';
const evidenceError=e=>({code:typeof e?.code==='string'&&/^[A-Za-z0-9._:-]{1,100}$/.test(e.code)?e.code:'unclassified',status:Number.isInteger(e?.status)&&e.status>=100&&e.status<=599?e.status:null});
const metadataId=value=>typeof value==='string'&&/^[A-Za-z0-9._:-]{1,200}$/.test(value)?value:null;
const itemTypes=new Set(['userMessage','agentMessage','reasoning','commandExecution','fileChange','mcpToolCall','dynamicToolCall','webSearch','imageView','collabAgentToolCall','enteredReviewMode','exitedReviewMode','contextCompaction']);
const requestMethods=new Set(['item/commandExecution/requestApproval','item/fileChange/requestApproval','item/tool/call']);
const errorCategories=new Set(['contextWindowExceeded','sessionBudgetExceeded','usageLimitExceeded','rateLimitExceeded','flexUnavailable','serverOverloaded','cyberPolicy','misalignmentPolicyViolation','tooManyDenials','internalServerError','unauthorized','badRequest','threadRollbackFailed','sandboxError','other']);
const httpErrorVariants=new Set(['httpConnectionFailed','responseStreamConnectionFailed','responseStreamDisconnected','responseTooManyFailedAttempts']);
// CLI0.163 ErrorNotification's tagged union only. Never retain message,
// additionalDetails or arbitrary object keys/values, even when syntactically safe.
const hostErrorMetadata=error=>{
 const info=error?.codexErrorInfo;
 if(typeof info==='string')return {category:errorCategories.has(info)?info:'unknown'};
 if(info&&typeof info==='object'&&!Array.isArray(info)&&Object.keys(info).length===1){
  const [category]=Object.keys(info),details=info[category];
  if(httpErrorVariants.has(category))return {category,httpStatusCode:Number.isInteger(details?.httpStatusCode)&&details.httpStatusCode>=100&&details.httpStatusCode<=599?details.httpStatusCode:null};
  if(category==='activeTurnNotSteerable')return {category,turnKind:['review','compact'].includes(details?.turnKind)?details.turnKind:null};
 }
 return {category:'unknown'};
};
// Probe-only append evidence. No receiver wrapping, request arguments, config,
// credentials, model output or error messages. Writes happen per record; fsync
// is deferred to closure so observation latency excludes a per-row disk flush.
export function openEvidenceRecorder(path,{scope={},now=Date.now,onFailure=()=>{},writeRecord=writeFileSync,syncFile=fsyncSync}={}){
 let fd,closed=false,failure=null;const detach=[],sessionId=randomUUID(),base={sessionId,controllerPid:process.pid,worldId:scope.worldId??null,soulId:scope.soulId??null};
 const fail=cause=>{if(!failure){failure=Object.assign(Error('Local evidence recording failed'),{code:'EVIDENCE_IO',cause});onFailure(failure);}return failure;};
 const append=row=>{
  if(failure)throw failure;if(closed)throw fail(Error('Evidence recorder is closed'));
  try{writeRecord(fd,JSON.stringify({...row,at:row.at??now(),...base})+'\n');}catch(e){throw fail(e);}
 };
 try{
  const file=resolve(path);let old;try{old=lstatSync(file);}catch(e){if(e.code!=='ENOENT')throw e;}
  if(old&&(old.isSymbolicLink()||!old.isFile()||old.nlink!==1))throw Error('Evidence path must be a regular unlinked file');
  fd=openSync(file,constants.O_WRONLY|constants.O_APPEND|constants.O_CREAT|constants.O_NOFOLLOW|constants.O_NONBLOCK,0o600);
  const stat=fstatSync(fd);if(!stat.isFile()||stat.nlink!==1)throw Error('Evidence path must be a regular unlinked file');fchmodSync(fd,0o600);
  append({kind:'evidence-session',state:'started'});
 }catch(e){if(fd!==undefined)try{closeSync(fd)}catch{}throw fail(e);}
 return {
  append,get failure(){return failure;},
  wrapWorld(world){return {...world,read:async function(...args){
   if(failure)throw failure;if(closed)throw fail(Error('Evidence recorder is closed'));
   const command=args[0],requestedAt=now();let response;
   try{response=await Reflect.apply(world.read,world,args);}
   catch(error){append({kind:'world-read',origin:'agent',command,requestedAt,receivedAt:now(),error:evidenceError(error)});throw error;}
   append({kind:'world-read',origin:'agent',command,requestedAt,receivedAt:now(),response});return response;
  }};},
  bindHost(host){
   const hostId=randomUUID(),connect=host.connect;let actualModel=null;
   const identity=(threadId=host.threadId,turnId=null)=>({hostId,hostPid:Number.isSafeInteger(host.pid)?host.pid:null,threadId:metadataId(threadId),turnId:metadataId(turnId)});
   const record=row=>{try{append(row);}catch{}};
   host.connect=async function(...args){const connected=await Reflect.apply(connect,this,args);actualModel=typeof connected?.model==='string'?connected.model:null;append({kind:'host-session',state:'connected',hostId,hostPid:host.pid??null,threadId:host.threadId??null,model:actualModel,resumed:typeof args[0]?.threadId==='string'});return connected;};
   // Only the existing begin/steer ACK is timed; never await completed, change
   // arguments, introduce a timeout, retry, interrupt or replace an error/result.
   for(const operation of ['begin','steer']){
    const original=host[operation];if(typeof original!=='function')continue;
    host[operation]=async function(...args){
     const requestedAt=now(),started=performance.now(),promptBytes=typeof args[0]==='string'?Buffer.byteLength(args[0]):null,expectedTurnId=operation==='steer'?metadataId(args[1]??this.activeTurnId):null;
     let result;
     try{result=await Reflect.apply(original,this,args);}
     catch(error){record({kind:'host-rpc',operation,...identity(this.threadId,expectedTurnId),requestedAt,failedAt:now(),durationMs:Math.max(0,performance.now()-started),promptBytes,status:'rejected'});throw error;}
     record({kind:'host-rpc',operation,...identity(this.threadId,operation==='begin'?result?.turnId:expectedTurnId),requestedAt,acknowledgedAt:now(),durationMs:Math.max(0,performance.now()-started),promptBytes,status:'acknowledged'});return result;
    };
    detach.push(()=>{host[operation]=original;});
   }
   const event=e=>{
    const p=e.params??{},at=Number.isFinite(e.receivedAt)?e.receivedAt:now();
    if(['item/started','item/completed'].includes(e.method)){
     record({kind:'host-item',method:e.method,at,...identity(p.threadId??host.threadId,p.turnId),itemId:metadataId(p.item?.id),itemType:itemTypes.has(p.item?.type)?p.item.type:'unknown'});return;
    }
    if(e.method==='error'){
     record({kind:'host-error',method:'error',at,...identity(p.threadId??host.threadId,p.turnId),willRetry:typeof p.willRetry==='boolean'?p.willRetry:null,error:hostErrorMetadata(p.error)});return;
    }
    if(!['turn/started','turn/completed','thread/tokenUsage/updated'].includes(e.method))return;
    const reportedModel=p.model??p.turn?.model;if(typeof reportedModel==='string')actualModel=reportedModel;
    try{append({kind:'host-event',method:e.method,at:Number.isFinite(e.receivedAt)?e.receivedAt:now(),hostId,hostPid:host.pid??null,threadId:typeof p.threadId==='string'?p.threadId:host.threadId??null,turnId:p.turn?.id??p.turnId??null,model:actualModel,status:p.turn?.status??null,...(e.method==='thread/tokenUsage/updated'?{tokenUsage:p.tokenUsage??null}:{}),...(p.turn?.error?{error:evidenceError(p.turn.error)}:{})});}catch{}
   };
   const unsupported=e=>record({kind:'host-unsupported-request',at:now(),...identity(host.threadId,host.activeTurnId),method:requestMethods.has(e?.method)?e.method:'unknown'});
   host.on('event',event);host.on('unsupportedRequest',unsupported);detach.push(()=>{host.off('event',event);host.off('unsupportedRequest',unsupported);host.connect=connect;});return host;
  },
  close(details={}){
   if(closed){if(failure)throw failure;return;}
   try{if(!failure){append({...details,kind:'evidence-session',state:'closed'});syncFile(fd);}}catch(e){fail(e);}
   finally{closed=true;for(const stop of detach)stop();try{closeSync(fd)}catch(e){fail(e);}}
   if(failure)throw failure;
  },
 };
}
// Wait through a dead controller's lease, never bypass a live controller's
// renewals. Each attempt still uses the transactional claim and its fence.
export async function claimStartupLease(control,{signal,maxWaitMs=65000,pollMs=250,now=Date.now,sleep=abortableSleep,onWait=()=>{}}={}){
 if(!Number.isFinite(maxWaitMs)||maxWaitMs<0||!Number.isFinite(pollMs)||pollMs<1)throw Error('Invalid startup lease wait');
 const deadline=now()+maxWaitMs;let lastExpiry;
 while(!signal?.aborted){
  try{return control.claim();}catch(error){
   if(error.code!=='CONTROLLER_BUSY')throw error;
   const remaining=deadline-now();
   if(remaining<=0)throw Object.assign(Error('Timed out waiting for controller lease'),{code:'CONTROLLER_BUSY_TIMEOUT',expiresAt:error.expiresAt});
   const delayMs=Math.min(pollMs,remaining,Math.max(1,error.expiresAt-now()));
   if(lastExpiry!==error.expiresAt){onWait({state:'waiting',code:error.code,expiresAt:error.expiresAt,delayMs});lastExpiry=error.expiresAt;}
   await sleep(delayMs,signal);
  }
 }
 return null;
}
export async function main(argv=process.argv.slice(2),{signal,leaseWaitMs=65000}={}){
 const {values}=parseArgs({args:argv,options:{folder:{type:'string'},state:{type:'string'},instruction:{type:'string'},model:{type:'string'},effort:{type:'string',default:'low'},seconds:{type:'string'},'session-name':{type:'string'},evidence:{type:'string'},help:{type:'boolean'}}});
 if(values.help){console.log('node tools/soul-runtime/run.mjs --folder <paired-folder> [--instruction <text-file>] [--model <advertised-model>] [--seconds <bounded-run>] [--evidence <local-jsonl>]');return;}
 const folder=resolve(values.folder??process.cwd()),state=resolve(values.state??join(folder,'.soul-runtime'));
 const seconds=values.seconds===undefined?null:Number(values.seconds);if(seconds!==null&&(!Number.isFinite(seconds)||seconds<1||seconds>7*86400))throw Error('seconds must be1..604800');
 const stop=new AbortController(),quit=()=>stop.abort(),externalAbort=()=>stop.abort(signal?.reason);
 process.once('SIGINT',quit);process.once('SIGTERM',quit);signal?.addEventListener('abort',externalAbort,{once:true});if(signal?.aborted)externalAbort();
 let journal,ownership,owner,ownerRenewal,timer,evidence,runFailure=null,ownershipFailure=null,evidenceFailure=null;const ownedHosts=new Set();
 try{
 if(stop.signal.aborted)return;
 const credential=join(folder,'.eden-agent.json');if(lstatSync(credential).isSymbolicLink())throw Error('Linked pairing file refused');
 const paired=JSON.parse(readFileSync(credential,'utf8'));
 if(!paired.world||!paired.soul||!paired.token)throw Error('Folder must already be paired to one Soul');
 let world=createWorldClient({world:paired.world,token:paired.token,expectedSoulId:paired.soul});
 const cfg=await fetch(paired.world.replace(/\/$/,'')+'/v1/config',{redirect:'error',signal:AbortSignal.any([stop.signal,AbortSignal.timeout(15000)])});
 if(!cfg.ok)throw Error('Cannot verify world identity');const config=await cfg.json();if(!config.worldId)throw Error('World identity unavailable');
 const instruction=values.instruction?readFileSync(resolve(values.instruction),'utf8'):undefined;
 if(instruction&&Buffer.byteLength(JSON.stringify(instruction))>16000)throw Error('Initial instruction exceeds16000 JSON-encoded bytes');
 const scope={worldId:config.worldId,soulId:paired.soul};
 if(values.evidence){evidence=openEvidenceRecorder(values.evidence,{scope,onFailure:e=>{evidenceFailure=e;stop.abort(e);}});world=evidence.wrapWorld(world);}
 journal=openJournal(state,scope);
 ownership=openJournal(join(folder,'.soul-runtime-owner'),scope);
 timer=seconds?setTimeout(quit,seconds*1000):null;
 const startedAt=new Date().toISOString();let model=values.model??null;
 const saveStatus=s=>{const out={at:new Date().toISOString(),startedAt,controllerPid:process.pid,soulId:paired.soul,worldId:config.worldId,...s},early=['host-started','session-created','host-closed'].includes(s.state);if(early)console.log(JSON.stringify(out));writeFileSync(join(state,'status.json.tmp'),JSON.stringify(out,null,2),{mode:0o600});renameSync(join(state,'status.json.tmp'),join(state,'status.json'));if(!early&&s.state!=='receiving')console.log(JSON.stringify(out));};
 try{owner=await claimStartupLease(ownership.control,{signal:stop.signal,maxWaitMs:leaseWaitMs,onWait:saveStatus});}
 catch(error){saveStatus({state:'blocked',code:error.code??'runtime.failure',reason:error.message});throw error;}
 if(!owner){saveStatus({state:'stopped'});return;}
 ownerRenewal=setInterval(()=>{try{owner=ownership.control.renew(owner);}catch(e){ownershipFailure=e;stop.abort(e);}},5000);
 const cwd=join(state,'host');mkdirSync(cwd,{recursive:true,mode:0o700});
  await runManaged({journal,world,instruction,signal:stop.signal,onState:saveStatus,createHost:()=>{
   const host=new CodexHost({cwd,model,effort:values.effort,name:values['session-name']??`Sim Soul — ${paired.soul}`});
   evidence?.bindHost(host);
   ownedHosts.add(host);host.on('lifecycle',saveStatus);
   host.on('event',e=>{if(e.method==='thread/tokenUsage/updated'){writeFileSync(join(state,'usage.json'),JSON.stringify({at:new Date().toISOString(),threadId:host.threadId,model:host.model,usage:e.params.tokenUsage},null,2),{mode:0o600});}if(host.model)model=host.model;});
   return host;
  }});
  if(ownershipFailure||evidenceFailure)throw evidenceFailure??ownershipFailure;
 }catch(error){runFailure=error;if(!stop.signal.aborted||ownershipFailure||evidenceFailure)throw evidenceFailure??ownershipFailure??error;}
 finally{
  stop.abort();clearInterval(ownerRenewal);await Promise.allSettled([...ownedHosts].map(host=>host.close()));
  const proofs=[...ownedHosts].map(host=>host.closeProof??{hostPid:host.pid??null,threadId:host.threadId,groupClosed:false,groupVerification:'unverified'});
  if(owner)try{ownership.control.release(owner)}catch{}ownership?.close();clearTimeout(timer);process.removeListener('SIGINT',quit);process.removeListener('SIGTERM',quit);signal?.removeEventListener('abort',externalAbort);journal?.close();
  console.log(JSON.stringify({state:'controller-closed',controllerPid:process.pid,ownedHosts:proofs,ownedProcessesExited:proofs.every(p=>p.groupClosed===true)}));
  evidence?.close({failed:!!runFailure,ownedProcessesExited:proofs.every(p=>p.groupClosed===true)});
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(e=>{console.error(JSON.stringify({state:'blocked',code:e.code??'runtime.failure',reason:e.message}));process.exitCode=1;});
