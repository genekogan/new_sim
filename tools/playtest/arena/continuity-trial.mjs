#!/usr/bin/env node
// Common mechanical trial lifetime. This is not a scorer or a qualification
// certificate. No continuation prompts, world writes, or cross-Soul relay.
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {StringDecoder} from 'node:string_decoder';
import {mkdirSync,readFileSync,writeFileSync,appendFileSync,lstatSync,renameSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createWorldClient} from '../../soul-runtime/world-client.mjs';
import {abortableSleep} from '../../soul-runtime/receiver.mjs';
import {probeSessions,verifyOwnedProbeExit} from './probe-sessions.mjs';
import {runContinuityBaseline} from './adapters/continuity-baseline.mjs';
import {buildArgs} from './adapters/codex-headless.mjs';
import {createContinuityUsageGuard,validateUsageLimits} from './continuity-usage.mjs';

export const CONTINUITY_ARMS=['existing-headless-seat','managed-continuity-runtime'];
export const R400_ARTIFACTS=Object.freeze({
 revision:'da5269cd089a98627d231e72e739245598ed2a93',
 'eden.mjs':'35d327c94841402474b3fd8e587bd6472f696243ff551a590164cea201d774eb',
 'skill.md':'39427d64d27cd98e156bb75b43b47f1b96a19db4012b3f280c9cf1c568f6f0d8',
});
const sha=value=>createHash('sha256').update(value).digest('hex');
const label=value=>typeof value==='string'&&value.trim().length>0&&value.length<=200&&!/[\u0000-\u001f\u007f]/.test(value);
const identifier=value=>typeof value==='string'&&/^[-a-zA-Z0-9_]{1,100}$/.test(value);
const code=error=>typeof error?.code==='string'&&/^[-a-zA-Z0-9_]{1,80}$/.test(error.code)?error.code:'TRIAL_ERROR';
const fault=value=>Object.assign(Error(value),{code:value});
const regularBytes=(path,maxBytes)=>{const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>maxBytes)throw fault('INVALID_LOCAL_ARTIFACT');return readFileSync(path);};
const privateJson=(path,value)=>writeFileSync(path,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});

export function validateContinuityTrial(config){
 const {directory,arm,purpose,seconds,model,effort,worldId,actors,fixtureActors=[]}=config;
 if(typeof directory!=='string'||!directory.trim()||!CONTINUITY_ARMS.includes(arm)||!['short','soak'].includes(purpose)||!Number.isFinite(seconds)||seconds<1||seconds>604800||purpose==='soak'&&seconds<7200||!label(model)||!label(effort)||!label(worldId)||!Array.isArray(actors)||actors.length<1||actors.length>5||!Array.isArray(fixtureActors)||fixtureActors.length>5)throw fault('INVALID_TRIAL_CONFIG');
 if(config.meetingOffsetSec!==undefined&&(!Number.isFinite(config.meetingOffsetSec)||config.meetingOffsetSec<0||config.meetingOffsetSec>=seconds))throw fault('INVALID_MEETING_OFFSET');
 if(purpose==='soak'&&config.usageGuard===undefined)throw fault('SOAK_USAGE_GUARD_REQUIRED');
 if(config.usageGuard!==undefined)validateUsageLimits(config.usageGuard);
 if(config.cliVersion!==undefined&&config.cliVersion!==null&&!label(config.cliVersion))throw fault('INVALID_CLI_VERSION');
 const ids=new Set();
 for(const actor of [...actors,...fixtureActors]){
  if(!actor||!identifier(actor.id)||ids.has(actor.id)||typeof actor.folder!=='string'||!actor.folder.trim())throw fault('INVALID_TRIAL_ACTOR');
  ids.add(actor.id);
 }
 for(const actor of actors)if(typeof actor.instruction!=='string'||!actor.instruction.trim()||Buffer.byteLength(JSON.stringify(actor.instruction))>16384||!Number.isFinite(actor.releaseOffsetSec??0)||(actor.releaseOffsetSec??0)<0||(actor.releaseOffsetSec??0)>=seconds)throw fault('INVALID_TRIAL_INSTRUCTION');
 for(const actor of actors)renderTrialInstruction(actor.instruction,{startedAt:0,seconds,meetingOffsetSec:config.meetingOffsetSec});
 return config;
}

// Expand only declared clock placeholders, once after setup. Late actors receive
// the same appointment/cutoff, never a newly shifted deadline.
export function renderTrialInstruction(text,{startedAt,seconds,meetingOffsetSec}){
 const values={startUTC:new Date(startedAt).toISOString(),completionUTC:new Date(startedAt+seconds*1000).toISOString()};
 if(meetingOffsetSec!==undefined)values.meetingUTC=new Date(startedAt+meetingOffsetSec*1000).toISOString();
 const result=text.replace(/\{(startUTC|meetingUTC|completionUTC)\}/g,(_,key)=>{if(!values[key])throw fault('UNBOUND_INSTRUCTION_CLOCK');return values[key];});
 if(Buffer.byteLength(JSON.stringify(result))>16384)throw fault('INVALID_TRIAL_INSTRUCTION');
 return result;
}

// Baseline onboarding must already be complete. Never fetch today's served
// CLI/skill into a claimed R400 seat. Only these verified files and its opaque
// pairing are copied; journals/history from an earlier actor are not reused.
export function prepareR400Seat(folder,directory){
 const artifacts={},files={};
 for(const name of ['eden.mjs','skill.md']){
  const bytes=regularBytes(join(folder,name),2*1024*1024);
  if(sha(bytes)!==R400_ARTIFACTS[name])throw fault('R400_ARTIFACT_MISMATCH');
  files[name]=bytes;
  artifacts[name]={sha256:sha(bytes),bytes:bytes.length};
 }
 const pairing=regularBytes(join(folder,'.eden-agent.json'),16384);
 mkdirSync(directory,{mode:0o700});
 for(const name of ['eden.mjs','skill.md'])writeFileSync(join(directory,name),files[name],{flag:'wx',mode:0o600});
 writeFileSync(join(directory,'.eden-agent.json'),pairing,{flag:'wx',mode:0o600});
 return {cwd:directory,revision:R400_ARTIFACTS.revision,artifacts};
}

function loadPairing(folder){
 const paired=JSON.parse(regularBytes(join(folder,'.eden-agent.json'),16384).toString('utf8'));
 if(!label(paired.world)||!label(paired.soul)||typeof paired.token!=='string'||!paired.token)throw fault('INVALID_PAIRING');
 return paired;
}
async function verifyDevWorld(world,signal){
 const url=new URL(world);
 if(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.username||url.password||url.search||url.hash)throw fault('LOOPBACK_DEVAUTH_REQUIRED');
 const response=await fetch(world.replace(/\/$/,'')+'/v1/config',{redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(10000)])});
 if(!response.ok)throw fault('WORLD_CONFIG_UNAVAILABLE');
 const config=await response.json();if(config.devAuth!==true)throw fault('LOOPBACK_DEVAUTH_REQUIRED');
 return config;
}

// Existing launcher/controller unchanged. Parent registration happens on receipt
// of emitted session-created, not synchronously before the child's naming RPC.
// Final controller closure manifests also recover IDs if naming fails.
export async function runManagedTrialActor({folder,directory,text,model,effort,remainingSeconds,name,signal,onState=()=>{}}, {spawnProcess=spawn,termGraceMs=15000,drainMs=1000}={}){
 if(!Number.isFinite(remainingSeconds)||remainingSeconds<=0||remainingSeconds>604800||!Number.isFinite(termGraceMs)||termGraceMs<1||!Number.isFinite(drainMs)||drainMs<1)throw fault('INVALID_MANAGED_ACTOR_BOUNDS');
 const instruction=join(directory,'instruction.txt'),state=join(directory,'runtime');
 writeFileSync(instruction,text,{flag:'wx',mode:0o600});
 const script=fileURLToPath(new URL('../../soul-runtime/launch.mjs',import.meta.url));
 // The outer signal owns the original absolute cutoff. launch.mjs requires a
 // local bound >=1s even when a late release has less than a second remaining.
 const localSeconds=Math.max(1,remainingSeconds);
 const args=[script,'--folder',folder,'--state',state,'--instruction',instruction,'--model',model,'--effort',effort,'--session-name',name,'--evidence',join(directory,'agent-evidence.jsonl'),'--seconds',String(localSeconds)];
 writeFileSync(join(directory,'controller.ndjson'),'',{flag:'wx',mode:0o600});
 const child=spawnProcess(process.execPath,args,{stdio:['ignore','pipe','pipe']});
 const controllers=new Map(),decoder=new StringDecoder('utf8');let exit=null,buffer='',failureCode=null,killTimer,drainTimer,shutdownTimer,leaderExited=false,stopping=false,pipeDrainTimedOut=false,finished=false,resolveDone,stderrBytes=0,stdoutBytes=0;
 const done=()=>{if(finished)return;finished=true;resolveDone();};
 const forceDrain=()=>{
  if(finished)return;
  pipeDrainTimedOut=true;failureCode??='MANAGED_PIPE_DRAIN_TIMEOUT';
  // A descendant may retain a pipe without being an owned child/group. Close
  // our read ends; never guess or kill its PID. Incomplete manifests stay unknown.
  child.stdout.destroy();child.stderr.destroy();done();
 };
 const terminate=()=>{
  if(stopping||finished)return;stopping=true;
  if(!leaderExited){child.kill('SIGTERM');killTimer=setTimeout(()=>{if(!leaderExited)child.kill('SIGKILL');},termGraceMs);}
  shutdownTimer=setTimeout(forceDrain,termGraceMs+drainMs);
 };
 const emit=s=>{
  const pid=s.state==='controller-started'?s.pid:s.controllerPid;
  if(Number.isInteger(pid)&&pid>0){const c=controllers.get(pid)??{pid,started:false,hostPids:new Set(),closed:null};controllers.set(pid,c);if(s.state==='controller-started')c.started=true;if(Number.isInteger(s.hostPid)&&s.hostPid>0)c.hostPids.add(s.hostPid);if(s.state==='controller-closed')c.closed=s;}
  onState({...s,...(s.threadId?{cwd:join(state,'host')}:{})});
  if(s.state==='controller-closed')for(const host of s.ownedHosts??[])if(host.threadId)onState({state:'session-recovered',threadId:host.threadId,cwd:join(state,'host')});
 };
 const completed=new Promise(resolve=>{
  resolveDone=resolve;
  child.once('error',error=>{failureCode=code(error);exit={code:null,signal:null,startFailed:true};done();});
  child.once('exit',(value,signal)=>{leaderExited=true;exit={code:value,signal};clearTimeout(killTimer);clearTimeout(shutdownTimer);drainTimer=setTimeout(forceDrain,drainMs);});
  child.once('close',(value,signal)=>{exit??={code:value,signal};done();});
 });
 child.stdout.on('data',chunk=>{
  if(failureCode||finished)return;
  try{
   stdoutBytes+=chunk.length;if(stdoutBytes>64*1024*1024)throw fault('CONTROLLER_OUTPUT_LIMIT');
   buffer+=decoder.write(chunk);if(Buffer.byteLength(buffer)>1024*1024)throw fault('CONTROLLER_LINE_LIMIT');
   let at;while((at=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,at);buffer=buffer.slice(at+1);let state;try{state=JSON.parse(line);}catch{continue;}appendFileSync(join(directory,'controller.ndjson'),JSON.stringify(state)+'\n');emit(state);}
  }catch(error){failureCode=code(error);terminate();}
 });
 // Unstructured stderr may contain host configuration. Retain counts only.
 child.stderr.on('data',chunk=>{stderrBytes=Math.min(Number.MAX_SAFE_INTEGER,stderrBytes+chunk.length);});
 signal.addEventListener('abort',terminate,{once:true});if(signal.aborted)terminate();
 try{await completed;}finally{clearTimeout(killTimer);clearTimeout(drainTimer);clearTimeout(shutdownTimer);signal.removeEventListener('abort',terminate);}
 return {kind:'managed-continuity-runtime',exit,failureCode,stderrBytes,stdoutBytes,pipeDrainTimedOut,evidenceComplete:!pipeDrainTimedOut,localSeconds,controllers:[...controllers.values()],endedAt:Date.now(),modelRequested:model,effortRequested:effort,actualModel:null,actualEffort:null,registrationOrdering:'emitted-before-child-name-rpc; parent-receipt registration is not synchronous durability'};
}

export function verifyBaselineTrialExit(result,killProcess=process.kill){
 if(result?.ownedProcessesExited!==true||!result.execProof||!Array.isArray(result.metadataGroups))return false;
 return [result.execProof,...result.metadataGroups].every(proof=>{
  if(proof?.groupClosed!==true||proof.groupVerification!=='absent')return false;
  const pid=proof.pid??proof.hostPid;
  if(pid===null)return proof.exit?.startFailed===true||proof.startFailed===true;
  if(!Number.isInteger(pid)||pid<2)return false;
  try{killProcess(-pid,0);return false;}catch(error){return error.code==='ESRCH';}
 });
}

/** Caller owns fresh-world/fixture preflight and frozen task text. This driver
 * owns only releases, passive samples, the cutoff and exact terminal cleanup.
 * Injectable boundaries are for synthetic tests, never alternate arm behavior.
 */
export async function runContinuityTrial(config,deps={}){
 validateContinuityTrial(config);
 const {directory,arm,purpose,seconds,model,effort,worldId,actors,fixtureActors=[],signal,onState=()=>{}}=config;
 const now=deps.now??Date.now,sleep=deps.sleep??abortableSleep,readPairing=deps.loadPairing??loadPairing,createWorld=deps.createWorld??(paired=>createWorldClient({world:paired.world,token:paired.token,timeoutMs:10000})),verifyWorld=deps.verifyWorld??verifyDevWorld;
 const launchCandidate=deps.launchCandidate??runManagedTrialActor,launchBaseline=deps.launchBaseline??runContinuityBaseline,prepareBaseline=deps.prepareBaseline??prepareR400Seat;
 const out=resolve(directory);mkdirSync(out,{mode:0o700}); // Atomic refusal of every existing output, even empty.
 const registry=(deps.registryFactory??probeSessions)(out),stop=new AbortController(),abort=()=>stop.abort();
 signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
 let startedAt=null,cutoffAt=null,endReason=null,failureCode=null,cutoffTimer,usageTimer,usageGuard=null,usageState=null;const rows=[],fixtures=[],tasks=[];
 writeFileSync(join(out,'timeline.jsonl'),'',{flag:'wx',mode:0o600});
 const record=(kind,data={})=>{try{appendFileSync(join(out,'timeline.jsonl'),JSON.stringify({at:now(),kind,...data})+'\n');}catch{failureCode='TRIAL_EVIDENCE_WRITE_FAILED';abort();throw fault(failureCode);}};
 const checkUsage=(finalActorIds=[],finish=false)=>{
  if(!usageGuard)return;
  try{
   usageState=usageGuard.poll({finalActorIds,finish});
   writeFileSync(join(out,'usage-guard.json.tmp'),JSON.stringify(usageState,null,2)+'\n',{mode:0o600});renameSync(join(out,'usage-guard.json.tmp'),join(out,'usage-guard.json'));
   if(usageState.trigger){failureCode??=usageState.trigger.code;endReason??='usage-guard';abort();}
  }catch{failureCode??='USAGE_GUARD_EVIDENCE_FAILED';endReason??='usage-guard';abort();}
 };
 const scheduleUsage=()=>{usageTimer=(deps.schedule??setTimeout)(()=>{checkUsage();if(!stop.signal.aborted)scheduleUsage();},1000);};
 const sample=async(row,kind,sampleSignal=stop.signal,phase=null)=>{
  const requestedAt=now(),response=await row.world.read('here',{},sampleSignal),me=response.here?.me;
  if(!me?.pos)throw fault('NATIVE_BODY_MISSING');
  record(kind,{actor:row.actor.id,soulId:row.paired.soul,requestedAt,receivedAt:now(),source:'here',...(phase?{phase,participantCredit:false}:{}),tick:response.here.tick,me:{place:me.place,pos:me.pos,posture:me.posture,seat:me.seat,activity:me.activity,actualActivity:me.actualActivity??null}});
 };
 try{
  const worlds=new Set(),souls=new Set();
  for(const actor of [...actors,...fixtureActors]){
   const paired=readPairing(resolve(actor.folder));
   // Validate loopback before constructing a client, even with injected config verification.
   const url=new URL(paired.world);if(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.username||url.password||url.search||url.hash)throw fault('LOOPBACK_DEVAUTH_REQUIRED');
   if(souls.has(paired.soul))throw fault('SHARED_SOUL_REFUSED');souls.add(paired.soul);worlds.add(paired.world);
   const row={actor,paired,world:createWorld(paired),threads:new Set(),result:null,cleanupVerified:false};
   if(actors.includes(actor)){
    row.directory=join(out,actor.id);mkdirSync(row.directory,{mode:0o700});
    if(arm===CONTINUITY_ARMS[0])row.baseline=prepareBaseline(resolve(actor.folder),join(row.directory,'seat'));
    rows.push(row);
   }else fixtures.push(row);
  }
  if(worlds.size!==1)throw fault('SHARED_WORLD_REQUIRED');
  const world=[...worlds][0],verified=await verifyWorld(world,stop.signal);
  if(verified.devAuth!==true)throw fault('LOOPBACK_DEVAUTH_REQUIRED');
  if(verified.worldId!==worldId)throw fault('WORLD_ID_MISMATCH');
  for(const row of [...rows,...fixtures])await sample(row,'setup-body');
  if(stop.signal.aborted)throw fault('TRIAL_CANCELLED');
  startedAt=now();cutoffAt=startedAt+seconds*1000;
  for(const row of rows)row.instruction=renderTrialInstruction(row.actor.instruction,{startedAt,seconds,meetingOffsetSec:config.meetingOffsetSec});
  if(config.usageGuard){usageGuard=createContinuityUsageGuard({actors:rows.map(row=>({id:row.actor.id,kind:arm===CONTINUITY_ARMS[0]?'baseline':'managed',path:arm===CONTINUITY_ARMS[0]?join(row.directory,'baseline','stream.ndjson'):join(row.directory,'agent-evidence.jsonl')})),limits:config.usageGuard,now});checkUsage();scheduleUsage();}
  cutoffTimer=(deps.schedule??setTimeout)(()=>{endReason??='cutoff';abort();},Math.max(0,cutoffAt-now()));
  const manifest={schema:'sim-continuity-trial/1',arm,purpose,seconds,startedAt,cutoffAt,meetingAt:config.meetingOffsetSec===undefined?null:startedAt+config.meetingOffsetSec*1000,modelRequested:model,effortRequested:effort,cliVersion:config.cliVersion??null,cliVersionSource:config.cliVersion?'caller-preflight':null,world,worldId,baselineWake:false,disturbances:'unsupported: not dispatched by this runner',restartCoverage:'unknown: no typed restart contract implemented',qualification:'not assessed; orchestration evidence only',actors:rows.map(row=>({id:row.actor.id,soulId:row.paired.soul,releaseOffsetSec:row.actor.releaseOffsetSec??0,instructionTemplateSha256:sha(row.actor.instruction),instructionSha256:sha(row.instruction),...(row.baseline?{baseline:row.baseline,promptArgsSha256:sha(JSON.stringify(buildArgs({model,effort,text:row.instruction})))}:{agentEvidence:'agent-evidence.jsonl',launchSourceSha256:sha(readFileSync(new URL('../../soul-runtime/launch.mjs',import.meta.url)))} )})),fixtureActors:fixtures.map(row=>({id:row.actor.id,soulId:row.paired.soul})),registration:'baseline synchronous callback before naming; candidate emitted creation before naming, parent durability occurs on receipt'};
  manifest.usageGuard=config.usageGuard?{kind:'observed-usage-guard',limits:config.usageGuard,pollMs:1000,possibleInFlightOvershoot:true,billing:'not measured'}:null;
  privateJson(join(out,'run.json'),manifest);
  for(const row of rows)tasks.push((async()=>{
   const scheduledAt=startedAt+(row.actor.releaseOffsetSec??0)*1000;
   await sleep(Math.max(0,scheduledAt-now()),stop.signal);if(stop.signal.aborted||now()>=cutoffAt)return;
   const remainingSeconds=(cutoffAt-now())/1000,name=`Sim continuity — ${arm} — ${row.actor.id}`;
   const state=s=>{
    // This callback deliberately stays synchronous: baseline names only after it returns.
    if(['thread-created','session-created','session-recovered','running','host-closed'].includes(s.state)&&s.threadId){registry.register({threadId:s.threadId,cwd:s.cwd??join(row.directory,'runtime','host'),name,recoveryMechanism:arm===CONTINUITY_ARMS[0]?'native retained Codex exec thread; no journal or automatic restart':'durable Codex thread plus durable Soul journal'});row.threads.add(s.threadId);}
    record('runtime',{actor:row.actor.id,...s});onState({actor:row.actor.id,...s});
   };
   record('actor-release',{actor:row.actor.id,scheduledAt,releasedAt:now(),remainingSeconds});
   row.releasedAt=now();
   usageGuard?.activate(row.actor.id);
   row.result=await (arm===CONTINUITY_ARMS[0]?launchBaseline({cwd:row.baseline.cwd,directory:join(row.directory,'baseline'),text:row.instruction,model,effort,remainingSeconds,name,cliVersion:config.cliVersion??null,signal:stop.signal,onState:state}):launchCandidate({folder:resolve(row.actor.folder),directory:row.directory,text:row.instruction,model,effort,remainingSeconds,name,signal:stop.signal,onState:state}));
   if(row.result.evidenceComplete===false)row.failureCode='ACTOR_EVIDENCE_INCOMPLETE';
   checkUsage([row.actor.id]);
   // Ordinary completion is behavior, not an infrastructure abort or permission
   // to manufacture another turn. Keep observing every actor until cutoff.
   record('actor-ended',{actor:row.actor.id,endedAt:now(),beforeCutoff:now()<cutoffAt,exit:row.result.exit,stopReason:row.result.stopReason??null,failureCode:row.result.failureCode??null});
  })().catch(error=>{row.failureCode=code(error);record('actor-error',{actor:row.actor.id,code:row.failureCode});}));
  let nextSample=startedAt;
  while(!stop.signal.aborted&&now()<cutoffAt){
   await Promise.all([...rows,...fixtures].map(async row=>{try{await sample(row,fixtures.includes(row)?'fixture-body':'body');}catch(error){if(!stop.signal.aborted)record('observation-error',{actor:row.actor.id,code:code(error)});}}));
   nextSample=Math.max(nextSample+1000,now());
   await sleep(Math.max(0,Math.min(nextSample,cutoffAt)-now()),stop.signal);
  }
  endReason??=stop.signal.aborted?'cancelled':'cutoff';
  // Verification-only fixture bracket uses a fresh bounded signal; participants
  // receive no extra action time or credit after the original cutoff.
  if(endReason==='cutoff')await Promise.all(fixtures.map(async row=>{
   try{await sample(row,'fixture-body',AbortSignal.timeout(10000),'cutoff-bracket');}
   catch(error){record('observation-error',{actor:row.actor.id,phase:'cutoff-bracket',code:code(error)});}
  }));
 }catch(error){failureCode??=code(error);endReason??=stop.signal.aborted?'cancelled':'infrastructure-error';}
 finally{
  abort();(deps.cancelSchedule??clearTimeout)(cutoffTimer);(deps.cancelSchedule??clearTimeout)(usageTimer);await Promise.allSettled(tasks);checkUsage([],true);signal?.removeEventListener('abort',abort);
 }
 const verifyCandidate=deps.verifyCandidate??(result=>verifyOwnedProbeExit(result)),verifyBaseline=deps.verifyBaseline??verifyBaselineTrialExit;
 for(const row of rows){
  if(row.result)row.cleanupVerified=arm===CONTINUITY_ARMS[0]?verifyBaseline(row.result):verifyCandidate(row.result);
  if(row.threads.size&&!row.cleanupVerified)failureCode??='OWNED_CLEANUP_UNVERIFIED';
  if(row.result)privateJson(join(row.directory,'actor-result.json'),{exit:row.result.exit,failureCode:row.failureCode??row.result.failureCode??null,cleanupVerified:row.cleanupVerified,execProof:row.result.execProof??null,metadataGroups:row.result.metadataGroups??null,controllers:row.result.controllers?.map(controller=>({...controller,hostPids:[...(controller.hostPids??[])]}))??null,usage:row.result.usage??null,evidenceComplete:row.result.evidenceComplete??null});
 }
 const summary={schema:'sim-continuity-trial-result/1',arm,purpose,startedAt,cutoffAt,endedAt:now(),endReason,failureCode,qualification:'not assessed',coverage:{disturbances:'unknown',restart:'unknown',semanticOutcome:'not scored',actualEffort:'only authoritative host metadata; otherwise unknown'},actors:rows.map(row=>({id:row.actor.id,soulId:row.paired.soul,releasedAt:row.releasedAt??null,threads:[...row.threads],cleanupVerified:row.cleanupVerified,failureCode:row.failureCode??row.result?.failureCode??null,exit:row.result?.exit??null,actualModel:row.result?.actualModel??null,actualEffort:row.result?.actualEffort??null,endedBeforeCutoff:row.result?.endedAt!==undefined?row.result.endedAt<cutoffAt:null}))};
 summary.usageGuard=usageState;
 privateJson(join(out,'summary.json'),summary);
 for(const row of rows)if(row.cleanupVerified)for(const threadId of row.threads)registry.complete(threadId,{outcome:endReason==='cancelled'?'cancelled':failureCode||row.failureCode||row.result?.failureCode||row.result?.exit?.code!==0?'failed':'bounded-end',ownedProcessesExited:true,evidence:'summary.json;timeline.jsonl; exact owned process-group absence verified before archival'});
 const archived=await registry.archiveCompleted();privateJson(join(out,'archive-results.json'),archived);
 return {...summary,archived};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const stop=new AbortController(),abort=()=>stop.abort();process.once('SIGINT',abort);process.once('SIGTERM',abort);
 runContinuityTrial({...JSON.parse(readFileSync(resolve(process.argv[2]),'utf8')),signal:stop.signal}).then(result=>{console.log(JSON.stringify({arm:result.arm,endReason:result.endReason,failureCode:result.failureCode,qualification:result.qualification}));if(result.failureCode)process.exitCode=1;}).catch(error=>{console.error(JSON.stringify({code:code(error)}));process.exitCode=1;}).finally(()=>{process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);});
}
