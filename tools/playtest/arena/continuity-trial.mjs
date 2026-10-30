#!/usr/bin/env node
// Common mechanical trial lifetime. This is not a scorer or a qualification
// certificate. No continuation prompts, world writes, or cross-Soul relay.
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {StringDecoder} from 'node:string_decoder';
import {mkdirSync,readFileSync,writeFileSync,appendFileSync,lstatSync,renameSync} from 'node:fs';
import {resolve,join,basename,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createWorldClient} from '../../soul-runtime/world-client.mjs';
import {abortableSleep} from '../../soul-runtime/receiver.mjs';
import {probeSessions,verifyOwnedProbeExit,probeArchivalStatus} from './probe-sessions.mjs';
import {runContinuityBaseline,buildContinuityBaselineArgs} from './adapters/continuity-baseline.mjs';
import {createContinuityUsageGuard,validateUsageLimits,createUsageTail} from './continuity-usage.mjs';
import {createTrialNativeEvidence} from './continuity-native-lifecycle.mjs';
import {createManagedRestartObserver,inspectRestartProcess,baselineAutomaticRestartCapability} from './continuity-restart.mjs';

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

// Pre-T0 served-world settle gate (garden r3 repair 1). Identical in both arms;
// on unless a config explicitly sets settleGate:false. It moves only boot->T0.
export const SETTLE_GATE_DEFAULTS=Object.freeze({minTickAdvance:200,probes:5,intervalMs:1000,maxLatencyMs:100,minTicksPerSec:18,timeoutMs:120000});
const SETTLE_GATE_BOUNDS={minTickAdvance:[0,1e6,true],probes:[2,100,true],intervalMs:[100,60000,true],maxLatencyMs:[1,10000,true],minTicksPerSec:[0.001,1000,false],timeoutMs:[1000,3600000,true]};
export function settleGateConfig(value){
 if(value===false)return null;
 if(value!==undefined&&(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!Object.hasOwn(SETTLE_GATE_BOUNDS,k))))throw fault('INVALID_SETTLE_GATE_CONFIG');
 const gate={...SETTLE_GATE_DEFAULTS,...value};
 for(const [k,[min,max,integer]]of Object.entries(SETTLE_GATE_BOUNDS))if(!Number.isFinite(gate[k])||gate[k]<min||gate[k]>max||integer&&!Number.isInteger(gate[k]))throw fault('INVALID_SETTLE_GATE_CONFIG');
 if(gate.timeoutMs<=gate.intervalMs*(gate.probes-1))throw fault('INVALID_SETTLE_GATE_CONFIG');
 return gate;
}

export function validateContinuityTrial(config){
 const {directory,arm,purpose,seconds,model,effort,worldId,actors,fixtureActors=[]}=config;
 if(typeof directory!=='string'||!directory.trim()||!CONTINUITY_ARMS.includes(arm)||!['short','soak'].includes(purpose)||!Number.isFinite(seconds)||seconds<1||seconds>604800||purpose==='soak'&&seconds<7200||!label(model)||!label(effort)||!label(worldId)||!Array.isArray(actors)||actors.length<1||actors.length>5||!Array.isArray(fixtureActors)||fixtureActors.length>5)throw fault('INVALID_TRIAL_CONFIG');
 if(config.baselineEphemeral!==undefined&&(typeof config.baselineEphemeral!=='boolean'||config.baselineEphemeral&&(arm!==CONTINUITY_ARMS[0]||config.restart!==undefined)))throw fault('INVALID_BASELINE_EPHEMERAL_CONFIG');
 if(config.meetingOffsetSec!==undefined&&(!Number.isFinite(config.meetingOffsetSec)||config.meetingOffsetSec<0||config.meetingOffsetSec>=seconds))throw fault('INVALID_MEETING_OFFSET');
 if(purpose==='soak'&&config.usageGuard===undefined)throw fault('SOAK_USAGE_GUARD_REQUIRED');
 if(config.usageGuard!==undefined)validateUsageLimits(config.usageGuard);
 if(config.runId!==undefined&&!identifier(config.runId))throw fault('INVALID_RUN_ID');
 if(config.nativeEvidence!==undefined&&(!config.nativeEvidence||Object.keys(config.nativeEvidence).sort().join(',')!=='captureDirectory,databasePath'||!identifier(config.runId)||![config.nativeEvidence.databasePath,config.nativeEvidence.captureDirectory].every(p=>typeof p==='string'&&isAbsolute(p))))throw fault('INVALID_NATIVE_EVIDENCE_CONFIG');
 if(config.restart!==undefined&&(!config.restart||Object.keys(config.restart).sort().join(',')!=='actorId,setupId'||!identifier(config.restart.actorId)||!identifier(config.restart.setupId)||!identifier(worldId)||!Number.isSafeInteger(seconds*1000)||!actors.some(a=>a?.id===config.restart.actorId)))throw fault('INVALID_RESTART_CONFIG');
 if(config.cliVersion!==undefined&&config.cliVersion!==null&&!label(config.cliVersion))throw fault('INVALID_CLI_VERSION');
 settleGateConfig(config.settleGate);
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
 const controllers=new Map(),decoder=new StringDecoder('utf8');let sourceLine=0,exit=null,buffer='',failureCode=null,killTimer,drainTimer,shutdownTimer,leaderExited=false,stopping=false,pipeDrainTimedOut=false,finished=false,resolveDone,stderrBytes=0,stdoutBytes=0;
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
 const emit=(s,source)=>{
  const pid=s.state==='controller-started'?s.pid:s.controllerPid;
  if(Number.isInteger(pid)&&pid>0){const c=controllers.get(pid)??{pid,started:false,hostPids:new Set(),closed:null,closedHosts:[]};controllers.set(pid,c);if(s.state==='controller-started'){if(c.started)c.identityAmbiguous=true;c.started=true;}if(Number.isInteger(s.hostPid)&&s.hostPid>0)c.hostPids.add(s.hostPid);if(s.state==='controller-closed')c.closed=s;if(s.state==='host-closed')c.closedHosts.push({...s,evidence:[source]});}
  onState({...s,...(s.threadId?{cwd:join(state,'host')}:{ }),evidence:[source]});
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
   let at;while((at=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,at);buffer=buffer.slice(at+1);let state;try{state=JSON.parse(line);}catch{continue;}appendFileSync(join(directory,'controller.ndjson'),JSON.stringify(state)+'\n');emit(state,`${basename(directory)}/controller.ndjson:${++sourceLine}`);}
  }catch(error){failureCode=code(error);terminate();}
 });
 // Unstructured stderr may contain host configuration. Retain counts only.
 child.stderr.on('data',chunk=>{stderrBytes=Math.min(Number.MAX_SAFE_INTEGER,stderrBytes+chunk.length);});
 signal.addEventListener('abort',terminate,{once:true});if(signal.aborted)terminate();
 try{
  const creation={state:'launcher-spawned',launcherPid:child.pid,at:Date.now()};appendFileSync(join(directory,'controller.ndjson'),JSON.stringify(creation)+'\n');emit(creation,`${basename(directory)}/controller.ndjson:${++sourceLine}`);
  await completed;
 }catch(error){failureCode??=code(error);terminate();await completed;}finally{clearTimeout(killTimer);clearTimeout(drainTimer);clearTimeout(shutdownTimer);signal.removeEventListener('abort',terminate);}
 return {kind:'managed-continuity-runtime',launcherPid:child.pid,exit,failureCode,stderrBytes,stdoutBytes,pipeDrainTimedOut,evidenceComplete:!pipeDrainTimedOut,localSeconds,controllers:[...controllers.values()],endedAt:Date.now(),modelRequested:model,effortRequested:effort,actualModel:null,actualEffort:null,registrationOrdering:'emitted-before-child-name-rpc; parent-receipt registration is not synchronous durability'};
}


/** Inventory only a registered detached host group. No argv/environment or
 * whole-machine census. Independent tool groups are disabled by HOST_CONFIG. */
export function inspectTrialHostGroup(pgid){
 if(!Number.isSafeInteger(pgid)||pgid<2)throw fault('RESTART_GROUP_UNSAFE');
 let output;
 try{output=execFileSync('ps',['-x','-g',String(pgid),'-o','pid=,ppid=,pgid=,lstart='],{encoding:'utf8',timeout:250,maxBuffer:65536,stdio:['ignore','pipe','pipe']});}
 catch{throw fault('RESTART_GROUP_INSPECTION_UNKNOWN');}
 const lines=output.trim().split('\n');if(!output.trim()||lines.length>128)throw fault('RESTART_GROUP_INSPECTION_UNKNOWN');
 return lines.map(line=>{const m=line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);if(!m||Number(m[3])!==pgid)throw fault('RESTART_GROUP_INSPECTION_UNKNOWN');return {pid:Number(m[1]),ppid:Number(m[2]),pgid:Number(m[3]),startToken:m[4]};});
}

// Mechanical measurement only. Its only signals are those dispatched by the
// frozen observer. It neither restarts a controller nor sends agent/world input.
export function createTrialRestartProbe(config,deps={}){
 const {actorId,setupId,directory,worldId,soulId,originalInstructionSha256,cutoffAt}=config,now=deps.now??Date.now;
 const inspect=deps.inspectProcess??inspectRestartProcess,inspectGroup=deps.inspectGroup??inspectTrialHostGroup,killProcess=deps.killProcess??process.kill;
 const groupAbsent=pgid=>{try{killProcess(-pgid,0);return false;}catch(e){if(e.code==='ESRCH')return true;throw fault('RESTART_GROUP_ABSENCE_UNKNOWN');}};
 const observer=createManagedRestartObserver({actorId,setupId,journalPath:join(directory,'runtime','continuity.sqlite'),worldId,soulId,originalInstructionSha256,cutoffAt},{now,...(deps.readSnapshot?{readSnapshot:deps.readSnapshot}:{}),inspectProcess:inspect,...(deps.killProcess?{killProcess:deps.killProcess}:{}),preDispatch:()=>{const fresh=drainTurns({required:true});if(pending.length||fresh.pendingBytes||fresh.missing)throw fault('RESTART_HOST_TURN_REFRESH_INCOMPLETE');return {at:now(),reader:fresh,evidence:[`${basename(directory)}/agent-evidence.jsonl:${fresh.lines}`]};}});
 const tail=createUsageTail(join(directory,'agent-evidence.jsonl'),{maxLineBytes:4*1024*1024+8192,maxPollBytes:8*1024*1024});
 const controllers=new Map(),registered=new Map(),pending=[];let launcher=null,failureCode=null,reasonCode=null,ownershipLines=0,lastBinding=null,finished=false,reader=null;
 const sourceFile=`${basename(directory)}/restart-ownership.jsonl`,proofPath=join(directory,'restart-proof.json');
 writeFileSync(join(directory,'restart-ownership.jsonl'),'',{flag:'wx',mode:0o600});
 const fail=error=>{if(!failureCode){failureCode=/^RESTART_[A-Z_]+$/.test(error?.code??'')?error.code:'RESTART_EVIDENCE_UNKNOWN';reasonCode=code(error);}};
 const terminal=()=>['ready','fail','unknown','unexercised'].includes(observer.snapshot().state);
 const persist=()=>{const proof=snapshot();writeFileSync(proofPath+'.tmp',JSON.stringify(proof,null,2)+'\n',{mode:0o600});renameSync(proofPath+'.tmp',proofPath);return proof;};
 const snapshot=()=>({...observer.snapshot(),integration:{status:failureCode?'unknown':observer.snapshot().state,failureCode,reasonCode,pollMs:1000,hostInventory:'only explicitly registered detached host groups; runtime HOST_CONFIG disables tool/app/plugin execution',reader,proofSource:`${basename(directory)}/restart-proof.json`,ownershipSource:sourceFile}});
 const eventTime=s=>{const t=typeof s.at==='string'?Date.parse(s.at):s.at;if(!Number.isSafeInteger(t)||t<0)throw fault('RESTART_LIFECYCLE_TIME_UNKNOWN');return t;};
 const consumeTurn=(e,line)=>{
  if(e.kind!=='host-event'||!['turn/started','turn/completed'].includes(e.method))return;
  if(e.method==='turn/completed'&&['failed','interrupted'].includes(e.status))return;
  if(e.worldId!==worldId||e.soulId!==soulId||!Number.isSafeInteger(e.controllerPid)||!Number.isSafeInteger(e.hostPid)||!identifier(e.threadId)||!identifier(e.turnId)||!Number.isSafeInteger(e.at)||e.at<0||e.method==='turn/completed'&&e.status!=='completed')throw fault('RESTART_HOST_TURN_UNKNOWN');
  if(pending.length>=64)throw fault('RESTART_HOST_TURN_BACKLOG');
  pending.push({controllerPid:e.controllerPid,hostPid:e.hostPid,threadId:e.threadId,turnId:e.turnId,at:e.at,state:e.method==='turn/started'?'turn-started':'turn-completed',evidence:[`${basename(directory)}/agent-evidence.jsonl:${line}`]});
 };
 const drainTurns=({final=false,required=false}={})=>{
  reader=tail.poll((row,line)=>{try{consumeTurn(row,line);}catch(error){fail(error);}},{final,required});
  if(failureCode)throw fault(failureCode);
  for(let i=0;i<pending.length;){const e=pending[i],c=controllers.get(e.controllerPid);if(c?.started&&c.hosts.has(e.hostPid)&&c.threadId===e.threadId){observer.observeLifecycle({...e,actorId,worldId,soulId});pending.splice(i,1);}else i++;}
  if(final&&pending.length)throw fault('RESTART_HOST_TURN_OWNERSHIP_UNKNOWN');return reader;
 };
 return {
  observe(s){
   if(finished||failureCode||terminal()||!['launcher-spawned','controller-started','host-started','session-created','running','startup-reconciled','receiver-ready','controller-closed','host-closed'].includes(s.state))return;
   try{
    if(!Array.isArray(s.evidence)||!s.evidence.length)throw fault('RESTART_SOURCE_CITATION_MISSING');
    if(s.worldId!==undefined&&s.worldId!==worldId||s.soulId!==undefined&&s.soulId!==soulId)throw fault('RESTART_LIFECYCLE_SCOPE_UNKNOWN');
    if(s.state==='launcher-spawned'){if(launcher)throw fault('RESTART_LAUNCHER_AMBIGUOUS');launcher=inspect(s.launcherPid);if(!launcher)throw fault('RESTART_PROCESS_IDENTITY_UNKNOWN');return;}
    const pid=s.state==='controller-started'?s.pid:s.controllerPid;if(!Number.isSafeInteger(pid)||pid<2)return;
    if(!controllers.has(pid)){if(controllers.size>=16)throw fault('RESTART_CONTROLLER_LIMIT');controllers.set(pid,{pid,started:false,hosts:new Map(),closed:false});}
    const c=controllers.get(pid);
    if(s.state==='controller-started'){if(c.started)throw fault('RESTART_CONTROLLER_IDENTITY_AMBIGUOUS');c.started=true;c.birth=inspect(pid);c.source=s.evidence[0];if(!c.birth)throw fault('RESTART_PROCESS_IDENTITY_UNKNOWN');}
    if(['host-started','session-created'].includes(s.state)&&Number.isSafeInteger(s.hostPid)){
     const prior=c.hosts.get(s.hostPid);if(prior?.closed)throw fault('RESTART_GROUP_IDENTITY_AMBIGUOUS');
     if(!prior){if(c.hosts.size>=16)throw fault('RESTART_GROUP_LIMIT');const birth=inspect(s.hostPid);if(!birth||birth.pgid!==s.hostPid)throw fault('RESTART_GROUP_IDENTITY_UNKNOWN');c.hosts.set(s.hostPid,{birth,source:s.evidence[0],closed:false});}
     if(s.state==='session-created'){c.threadId=s.threadId;c.sessionHostPid=s.hostPid;}
    }
    if(s.state==='controller-closed')c.closed=true;
    if(s.state==='host-closed'){const host=c.hosts.get(s.hostPid);if(!host)throw fault('RESTART_CLOSED_HOST_IDENTITY_UNKNOWN');host.closed=true;host.closeProof={hostPid:s.hostPid,threadId:s.threadId??null,groupClosed:s.groupClosed,groupVerification:s.groupVerification,at:s.at,evidence:[host.source,...s.evidence],identity:structuredClone(host.birth)};}
    if(['controller-started','session-created','running','startup-reconciled','receiver-ready'].includes(s.state))observer.observeLifecycle({...s,actorId,worldId,soulId,controllerPid:pid,at:eventTime(s)});
   }catch(error){fail(error);}
  },
  poll({final=false,required=false}={}){
   if(finished)return snapshot();
   try{
    if(!failureCode&&!terminal()){
     drainTurns({final,required});
     const c=[...controllers.values()].filter(c=>c.started&&!c.closed).at(-1);
     const dead=observer.snapshot().oldOwnership?.controller.pid;
     const activeHosts=c?[...c.hosts].filter(([,h])=>!h.closed):[];
     if(c&&c.pid!==dead&&launcher){
      for(const [pgid,h]of c.hosts)if(h.closed&&(h.closeProof?.groupClosed!==true||h.closeProof?.groupVerification!=='absent'||!groupAbsent(pgid)))throw fault('RESTART_PRIOR_HOST_CLOSURE_UNPROVEN');
     }
     if(c&&c.pid!==dead&&launcher&&activeHosts.length){
      const groups=activeHosts.map(([pgid,h])=>{const members=inspectGroup(pgid).sort((a,b)=>a.pid-b.pid),leader=members.find(p=>p.pid===pgid);if(!leader||['pid','ppid','pgid','startToken'].some(k=>leader[k]!==h.birth[k]))throw fault('RESTART_GROUP_IDENTITY_CHANGED');return {pgid,members};}).sort((a,b)=>a.pgid-b.pgid);
      const binding=JSON.stringify({launcher,controller:c.birth,groups});
      if(binding!==lastBinding){
       if(ownershipLines>=64)throw fault('RESTART_OWNERSHIP_LIMIT');
       const ownership={actorId,setupId,worldId,soulId,launcher,controller:c.birth,groups,descendantsComplete:true,evidence:[c.source,...[...c.hosts.values()].map(h=>h.source).slice(0,5),`${sourceFile}:${ownershipLines+1}`]};
       appendFileSync(join(directory,'restart-ownership.jsonl'),JSON.stringify({at:now(),ownership})+'\n');ownershipLines++;lastBinding=binding;registered.set(c.pid,structuredClone(ownership));observer.registerOwnership(ownership);
      }
     }
     if(observer.snapshot().deathAt!==null||c&&activeHosts.some(([pid])=>pid===c.sessionHostPid))observer.tick();
    }
   }catch(error){fail(error);}
   try{return persist();}catch(error){fail(error);return snapshot();}
  },
  finish({required=false}={}){this.poll({final:true,required});finished=true;observer.finish();try{return persist();}catch(error){fail(error);return snapshot();}},
  attach(result){
   const proof=snapshot(),old=proof.oldOwnership;
   if(old&&proof.triggerExercised===true){const c=result.controllers?.find(c=>c.pid===old.controller.pid);const owned=registered.get(old.controller.pid);if(c&&owned){c.restartOwnership=structuredClone(owned);c.restartClosedHosts=[...(controllers.get(c.pid)?.hosts.values()??[])].filter(h=>h.closed).map(h=>structuredClone(h.closeProof));}result.restartProofs=[proof];}
   return result;
  },
  snapshot,
 };
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
 const baselineEphemeral=config.baselineEphemeral===true,gate=settleGateConfig(config.settleGate);
 let settleGate=gate?{status:'not-reached',config:gate}:{status:'disabled',config:null};
 const out=resolve(directory);mkdirSync(out,{mode:0o700}); // Atomic refusal of every existing output, even empty.
 const registry=(deps.registryFactory??probeSessions)(out),stop=new AbortController(),abort=()=>stop.abort();
 signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
 let startedAt=null,cutoffAt=null,endReason=null,failureCode=null,cutoffTimer,usageTimer,restartTimer,usageGuard=null,usageState=null,restartProbe=null,restartResult=null,nativeProbe=null,nativeResult=null;const rows=[],fixtures=[],tasks=[];
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
 const pollRestart=()=>{if(restartProbe)return restartProbe.poll({required:false});};
 const scheduleRestart=()=>{restartTimer=(deps.schedule??setTimeout)(()=>{pollRestart();if(!stop.signal.aborted&&!['ready','fail','unknown','unexercised'].includes(restartProbe.snapshot().integration.status))scheduleRestart();},1000);};
 const scheduleUsage=()=>{usageTimer=(deps.schedule??setTimeout)(()=>{checkUsage();if(!stop.signal.aborted)scheduleUsage();},1000);};
 // The sampler and the settle gate share this one native body read path.
 const observe=async(row,sampleSignal)=>{
  const requestedAt=now(),response=await row.world.read('here',{view:'body'},sampleSignal),me=response.here?.me;
  if(response.here?.view!=='body')throw fault('BODY_PROJECTION_UNVERIFIED');
  if(!me?.pos)throw fault('NATIVE_BODY_MISSING');
  return {requestedAt,receivedAt:now(),tick:response.here.tick,me};
 };
 const sample=async(row,kind,sampleSignal=stop.signal,phase=null)=>{
  const {requestedAt,receivedAt,tick,me}=await observe(row,sampleSignal);
  record(kind,{actor:row.actor.id,soulId:row.paired.soul,requestedAt,receivedAt,source:'here',view:'body',...(phase?{phase,participantCredit:false}:{}),tick,me:{place:me.place,pos:me.pos,posture:me.posture,seat:me.seat,activity:me.activity,actualActivity:me.actualActivity??null}});
 };
 // ~1Hz probes of one existing body until `probes` consecutive reads are each
 // <maxLatencyMs and (after the first) imply >=minTicksPerSec from the previous
 // receipt, and the served tick advanced >=minTickAdvance since the first gate
 // probe (the served world reports no boot tick). Failed reads reset the streak.
 // Not settled within timeoutMs refuses the trial: no T0, run.json or release.
 const settleWorld=async row=>{
  const startedGate=now(),deadline=startedGate+gate.timeoutMs;let probes=0,streak=0,firstTick=null,previous=null,last=null;
  const snapshot=status=>({status,config:gate,actor:row.actor.id,soulId:row.paired.soul,gateStartedAt:startedGate,settledAt:status==='settled'?last.receivedAt:null,waitMs:now()-startedGate,probes,streak,firstTick,lastTick:last?.tick??null,tickAdvance:last&&firstTick!==null?last.tick-firstTick:null,tickReference:'first-gate-probe'});
  settleGate=snapshot('waiting');
  for(;;){
   if(stop.signal.aborted){settleGate=snapshot('cancelled');throw fault('TRIAL_CANCELLED');}
   let probe=null,error=null;const requestedAt=now();
   try{probe=await observe(row,AbortSignal.any([stop.signal,AbortSignal.timeout(Math.max(1,deadline-now()))]));if(!Number.isSafeInteger(probe.tick))throw fault('SETTLE_TICK_UNKNOWN');}catch(e){error=code(e);}
   if(stop.signal.aborted){settleGate=snapshot('cancelled');throw fault('TRIAL_CANCELLED');}
   probes++;
   if(probe){
    firstTick??=probe.tick;
    const ticksPerSec=previous&&probe.receivedAt>previous.receivedAt?(probe.tick-previous.tick)*1000/(probe.receivedAt-previous.receivedAt):null,latencyMs=probe.receivedAt-probe.requestedAt,quick=latencyMs<gate.maxLatencyMs;
    const fast=quick&&ticksPerSec!==null&&ticksPerSec>=gate.minTicksPerSec;
    streak=fast?streak+1:quick?1:0;previous=quick?probe:null;last=probe;
    record('settle-probe',{actor:row.actor.id,soulId:row.paired.soul,requestedAt:probe.requestedAt,receivedAt:probe.receivedAt,source:'here',view:'body',tick:probe.tick,latencyMs,ticksPerSec,fast,streak,tickAdvance:probe.tick-firstTick});
   }else{streak=0;previous=null;record('settle-probe',{actor:row.actor.id,soulId:row.paired.soul,requestedAt,receivedAt:now(),source:'here',view:'body',tick:null,latencyMs:now()-requestedAt,ticksPerSec:null,fast:false,streak,code:error});}
   if(streak>=gate.probes&&last.tick-firstTick>=gate.minTickAdvance){settleGate=snapshot('settled');record('world-settled',{...settleGate,config:undefined});return;}
   const nextAt=Math.max(requestedAt+gate.intervalMs,now());
   if(nextAt>deadline){settleGate=snapshot('not-settled');record('world-not-settled',{...settleGate,config:undefined});throw fault('WORLD_NOT_SETTLED');}
   await sleep(nextAt-now(),stop.signal);
  }
 };
 try{
  const worlds=new Set(),souls=new Set();
  for(const actor of [...actors,...fixtureActors]){
   const paired=readPairing(resolve(actor.folder));
   // Validate loopback before constructing a client, even with injected config verification.
   const url=new URL(paired.world);if(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.username||url.password||url.search||url.hash)throw fault('LOOPBACK_DEVAUTH_REQUIRED');
   if(config.restart&&actor.id===config.restart.actorId&&!identifier(paired.soul))throw fault('INVALID_RESTART_SCOPE');
   if(souls.has(paired.soul))throw fault('SHARED_SOUL_REFUSED');souls.add(paired.soul);worlds.add(paired.world);
   const row={actor,paired,world:createWorld(paired),threads:new Set(),ephemeralThreads:new Set(),result:null,cleanupVerified:false};
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
  if(gate)await settleWorld(fixtures[0]??rows[0]);
  if(config.nativeEvidence){
   nativeProbe=(deps.createNativeEvidence??createTrialNativeEvidence)({...config.nativeEvidence,directory:join(out,'native-export'),runId:config.runId,worldId,soulIds:[...rows,...fixtures].map(r=>r.paired.soul)}, {now,sleep,schedule:deps.schedule??setTimeout,cancel:deps.cancelSchedule??clearTimeout,onFailure:reason=>{failureCode??=reason;endReason??='native-evidence-error';abort();}});
   const first=nativeProbe.start();if(first.failure)throw fault(first.failure);
  }
  if(stop.signal.aborted)throw fault('TRIAL_CANCELLED');
  startedAt=now();cutoffAt=startedAt+seconds*1000;
  for(const row of rows)row.instruction=renderTrialInstruction(row.actor.instruction,{startedAt,seconds,meetingOffsetSec:config.meetingOffsetSec});
  if(config.usageGuard){usageGuard=createContinuityUsageGuard({actors:rows.map(row=>({id:row.actor.id,kind:arm===CONTINUITY_ARMS[0]?'baseline':'managed',path:arm===CONTINUITY_ARMS[0]?join(row.directory,'baseline','stream.ndjson'):join(row.directory,'agent-evidence.jsonl')})),limits:config.usageGuard,now});checkUsage();scheduleUsage();}
  const checkCutoff=()=>{
   if(stop.signal.aborted)return;
   const remaining=cutoffAt-now();
   if(remaining>0){cutoffTimer=(deps.schedule??setTimeout)(checkCutoff,Math.max(1,Math.ceil(remaining)));return;}
   endReason??='cutoff';abort();
  };
  cutoffTimer=(deps.schedule??setTimeout)(checkCutoff,Math.max(0,cutoffAt-now()));
  if(config.restart){
   const target=rows.find(row=>row.actor.id===config.restart.actorId);
   if(arm===CONTINUITY_ARMS[0])restartResult={...baselineAutomaticRestartCapability(),actor:target.actor.id,setupId:config.restart.setupId,worldId,soulId:target.paired.soul,source:'existing-headless-seat single-exec workflow; no synthetic disturbance dispatched'};
   else {restartProbe=createTrialRestartProbe({...config.restart,directory:target.directory,worldId,soulId:target.paired.soul,originalInstructionSha256:sha(target.instruction),cutoffAt},{now,...(deps.restart??{})});scheduleRestart();}
  }
  const manifest={schema:'sim-continuity-trial/1',...(config.runId?{runId:config.runId}:{}),arm,purpose,seconds,startedAt,cutoffAt,meetingAt:config.meetingOffsetSec===undefined?null:startedAt+config.meetingOffsetSec*1000,modelRequested:model,effortRequested:effort,cliVersion:config.cliVersion??null,cliVersionSource:config.cliVersion?'caller-preflight':null,world,worldId,baselineEphemeral,baselineWake:false,disturbances:'unsupported: not dispatched by this runner',restartCoverage:config.restart?{...config.restart,kind:'checkpoint-future-wake',minimumFutureWakeMs:20000,triggerMaxDelayMs:5000,recoveryMaxMs:25000,pollMs:1000,proof:arm===CONTINUITY_ARMS[0]?'restart-proof.json':`${config.restart.actorId}/restart-proof.json`,baselineAssistedResume:false}:'unknown: no restart contract requested',qualification:'not assessed; orchestration evidence only',actors:rows.map(row=>({id:row.actor.id,soulId:row.paired.soul,releaseOffsetSec:row.actor.releaseOffsetSec??0,instructionTemplateSha256:sha(row.actor.instruction),instructionSha256:sha(row.instruction),...(row.baseline?{baseline:row.baseline,promptArgsSha256:sha(JSON.stringify(buildContinuityBaselineArgs({model,effort,text:row.instruction,ephemeral:baselineEphemeral})))}:{agentEvidence:'agent-evidence.jsonl',launchSourceSha256:sha(readFileSync(new URL('../../soul-runtime/launch.mjs',import.meta.url)))} )})),fixtureActors:fixtures.map(row=>({id:row.actor.id,soulId:row.paired.soul})),registration:'baseline synchronous callback before naming; candidate emitted creation before naming, parent durability occurs on receipt'};
  manifest.nativeEvidence=config.nativeEvidence?{kind:'allowlisted-native-capture',runId:config.runId,pollMs:1000,exportDirectory:'native-export',limits:'Capture is started before this runner; identical settings both arms. No inferred behavioral completeness.'}:null;
  manifest.settleGate=settleGate;
  manifest.usageGuard=config.usageGuard?{kind:'observed-usage-guard',limits:config.usageGuard,pollMs:1000,possibleInFlightOvershoot:true,billing:'not measured'}:null;
  privateJson(join(out,'run.json'),manifest);
  for(const row of rows)tasks.push((async()=>{
   const scheduledAt=startedAt+(row.actor.releaseOffsetSec??0)*1000;
   await sleep(Math.max(0,scheduledAt-now()),stop.signal);
   // Timers can resolve early; only the original absolute clock authorizes a
   // release. Recheck after every wake without shifting the trial deadline.
   let releasedAt=now();
   while(!stop.signal.aborted&&releasedAt<scheduledAt){await sleep(Math.max(1,Math.ceil(scheduledAt-releasedAt)),stop.signal);releasedAt=now();}
   if(stop.signal.aborted||releasedAt>=cutoffAt)return;
   const remainingSeconds=(cutoffAt-releasedAt)/1000,name=`Sim continuity — ${arm} — ${row.actor.id}`;
   const state=s=>{
    // This callback deliberately stays synchronous: baseline names only after it returns.
    if(['thread-created','session-created','session-recovered','running','host-closed'].includes(s.state)&&s.threadId){
     const ephemeral=s.ephemeral===true;
     registry.register({threadId:s.threadId,cwd:s.cwd??join(row.directory,'runtime','host'),name,ephemeral,recoveryMechanism:ephemeral?'ephemeral single Codex exec; no persistence, resume or automatic restart':arm===CONTINUITY_ARMS[0]?'native retained Codex exec thread; no journal or automatic restart':'durable Codex thread plus durable Soul journal'});
     row.threads.add(s.threadId);if(ephemeral)row.ephemeralThreads.add(s.threadId);
     // Retain actual ownership before rejecting a missing/contradictory mode.
     if(ephemeral!==baselineEphemeral||ephemeral&&s.resumed===true)throw fault('SESSION_PERSISTENCE_MODE_MISMATCH');
    }
    if(restartProbe&&row.actor.id===config.restart.actorId)restartProbe.observe(s);
    record('runtime',{actor:row.actor.id,...s});onState({actor:row.actor.id,...s});
   };
   record('actor-release',{actor:row.actor.id,scheduledAt,releasedAt,remainingSeconds});
   row.releasedAt=releasedAt;
   usageGuard?.activate(row.actor.id);
   row.result=await (arm===CONTINUITY_ARMS[0]?launchBaseline({cwd:row.baseline.cwd,directory:join(row.directory,'baseline'),text:row.instruction,model,effort,remainingSeconds,name,ephemeral:baselineEphemeral,cliVersion:config.cliVersion??null,signal:stop.signal,onState:state}):launchCandidate({folder:resolve(row.actor.folder),directory:row.directory,text:row.instruction,model,effort,remainingSeconds,name,signal:stop.signal,onState:state}));
   if(arm===CONTINUITY_ARMS[0]&&(row.result.ephemeral===true)!==baselineEphemeral)row.failureCode='SESSION_PERSISTENCE_MODE_MISMATCH';
   if(row.result.evidenceComplete===false)row.failureCode='ACTOR_EVIDENCE_INCOMPLETE';
   checkUsage([row.actor.id]);
   // Ordinary completion is behavior, not an infrastructure abort or permission
   // to manufacture another turn. Keep observing every actor until cutoff.
   record('actor-ended',{actor:row.actor.id,endedAt:now(),beforeCutoff:now()<cutoffAt,exit:row.result.exit,stopReason:row.result.stopReason??null,failureCode:row.result.failureCode??null});
  })().catch(error=>{row.failureCode=code(error);record('actor-error',{actor:row.actor.id,code:row.failureCode});}));
  // One sequential reader per body: a slow fixture must not hold every other
  // observer behind its response. Own slow reads still leave real gaps; neither
  // timestamps nor missing samples are reconstructed to meet the oracle bound.
  const samplers=[...rows,...fixtures].map(row=>(async()=>{
   let nextSample=startedAt;
   while(!stop.signal.aborted&&now()<cutoffAt){
    try{await sample(row,fixtures.includes(row)?'fixture-body':'body');}catch(error){if(!stop.signal.aborted)record('observation-error',{actor:row.actor.id,code:code(error)});}
    nextSample=Math.max(nextSample+1000,now());
    await sleep(Math.max(0,Math.min(nextSample,cutoffAt)-now()),stop.signal);
   }
  })());
  // Existing final cleanup also drains every sampler if a peer rejects. Normal
  // completion joins all readers before the independent fixture cutoff bracket.
  tasks.push(...samplers);await Promise.all(samplers);
  endReason??=stop.signal.aborted?'cancelled':'cutoff';
  // Verification-only fixture bracket uses a fresh bounded signal; participants
  // receive no extra action time or credit after the original cutoff.
  if(endReason==='cutoff')await Promise.all(fixtures.map(async row=>{
   try{await sample(row,'fixture-body',AbortSignal.timeout(10000),'cutoff-bracket');}
   catch(error){record('observation-error',{actor:row.actor.id,phase:'cutoff-bracket',code:code(error)});}
  }));
 }catch(error){failureCode??=code(error);endReason??=stop.signal.aborted?'cancelled':'infrastructure-error';}
 finally{
  abort();(deps.cancelSchedule??clearTimeout)(cutoffTimer);(deps.cancelSchedule??clearTimeout)(usageTimer);(deps.cancelSchedule??clearTimeout)(restartTimer);await Promise.allSettled(tasks);checkUsage([],true);
  if(restartProbe){const target=rows.find(row=>row.actor.id===config.restart.actorId);restartResult=restartProbe.finish({required:target.releasedAt!==undefined});if(target.result)restartProbe.attach(target.result);}
  if(nativeProbe){
   const nativeError=error=>{failureCode??='NATIVE_EVIDENCE_FINALIZATION_FAILED';nativeResult={schema:'continuity-native-lifecycle/1',status:'unknown',failure:code(error),coverage:null,priorSourceStatus:nativeResult?.coverage?.status??null,limits:'Native evidence finalization/persistence failed; no source completeness or qualification inferred.'};};
   try{nativeResult=await nativeProbe.finish({t0:startedAt,cutoffAt});if(!nativeResult||!['pass','unknown'].includes(nativeResult.status))throw fault('NATIVE_EVIDENCE_RESULT_INVALID');}catch(error){nativeError(error);}
   try{privateJson(join(out,'native-evidence.json'),nativeResult);}catch(error){nativeError(error);}
   if(nativeResult?.status!=='pass')failureCode??='NATIVE_SOURCE_COVERAGE_UNKNOWN';
  }
  if(config.restart&&arm===CONTINUITY_ARMS[0]&&restartResult)privateJson(join(out,'restart-proof.json'),restartResult);signal?.removeEventListener('abort',abort);
 }
 const verifyCandidate=deps.verifyCandidate??(result=>verifyOwnedProbeExit(result)),verifyBaseline=deps.verifyBaseline??verifyBaselineTrialExit;
 for(const row of rows){
  if(row.result)row.cleanupVerified=arm===CONTINUITY_ARMS[0]?verifyBaseline(row.result):verifyCandidate(row.result);
  if(row.threads.size&&!row.cleanupVerified)failureCode??='OWNED_CLEANUP_UNVERIFIED';
  if(row.result)privateJson(join(row.directory,'actor-result.json'),{exit:row.result.exit,failureCode:row.failureCode??row.result.failureCode??null,cleanupVerified:row.cleanupVerified,execProof:row.result.execProof??null,metadataGroups:row.result.metadataGroups??null,ephemeral:row.result.ephemeral===true,controllers:row.result.controllers?.map(controller=>({...controller,hostPids:[...(controller.hostPids??[])]}))??null,usage:row.result.usage??null,evidenceComplete:row.result.evidenceComplete??null,restartProofs:row.result.restartProofs??null});
 }
 const summary={schema:'sim-continuity-trial-result/1',arm,purpose,startedAt,cutoffAt,endedAt:now(),endReason,failureCode,qualification:'not assessed',coverage:{disturbances:'unknown',restart:'unknown',semanticOutcome:'not scored',actualEffort:'only authoritative host metadata; otherwise unknown'},actors:rows.map(row=>({id:row.actor.id,soulId:row.paired.soul,releasedAt:row.releasedAt??null,threads:[...row.threads],ephemeralThreads:[...row.ephemeralThreads],cleanupVerified:row.cleanupVerified,failureCode:row.failureCode??row.result?.failureCode??null,exit:row.result?.exit??null,actualModel:row.result?.actualModel??null,actualEffort:row.result?.actualEffort??null,endedBeforeCutoff:row.result?.endedAt!==undefined?row.result.endedAt<cutoffAt:null}))};
 // Any actor's own failure (code, nonzero exit, or signal death) fails the trial
 // summary without overwriting an earlier runner/native/cleanup failure code.
 summary.failedActors=summary.actors.filter(a=>a.failureCode||a.exit&&(a.exit.code!==0&&a.exit.code!=null||a.exit.code==null&&a.exit.signal!=null)).slice(0,64).map(a=>({id:a.id,exit:a.exit,failureCode:a.failureCode}));
 if(summary.failedActors.length)summary.failureCode??='ACTOR_FAILED';
 summary.settleGate=settleGate;
 summary.usageGuard=usageState;
 summary.restart=restartResult;
 summary.nativeEvidence=nativeResult;
 summary.coverage.nativeSources=nativeResult?.status??'unknown';
 if(config.restart)summary.coverage.restart=arm===CONTINUITY_ARMS[0]?'unsupported':restartResult?.integration?.status??'unknown';
 privateJson(join(out,'summary.json'),summary);
 for(const row of rows)if(row.cleanupVerified)for(const threadId of row.threads)registry.complete(threadId,{outcome:endReason==='cancelled'?'cancelled':failureCode||row.failureCode||row.result?.failureCode||row.result?.exit?.code!==0?'failed':'bounded-end',ownedProcessesExited:true,evidence:'summary.json;timeline.jsonl; exact owned process-group absence verified before archival'});
 let archived=[],archiveError=null;
 try{archived=await registry.archiveCompleted();}catch(error){archiveError=error;}
 privateJson(join(out,'archive-results.json'),archived);
 summary.archival=probeArchivalStatus(archived,{error:archiveError,expectedThreadIds:rows.flatMap(row=>[...row.threads]),ephemeralThreadIds:rows.flatMap(row=>[...row.ephemeralThreads])});
 privateJson(join(out,'summary-archival.tmp'),summary);renameSync(join(out,'summary-archival.tmp'),join(out,'summary.json'));
 return {...summary,archived};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const stop=new AbortController(),abort=()=>stop.abort();process.once('SIGINT',abort);process.once('SIGTERM',abort);
 runContinuityTrial({...JSON.parse(readFileSync(resolve(process.argv[2]),'utf8')),signal:stop.signal}).then(result=>{console.log(JSON.stringify({arm:result.arm,endReason:result.endReason,failureCode:result.failureCode,qualification:result.qualification}));if(result.failureCode||result.archival?.status==='incomplete')process.exitCode=1;}).catch(error=>{console.error(JSON.stringify({code:code(error)}));process.exitCode=1;}).finally(()=>{process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);});
}
