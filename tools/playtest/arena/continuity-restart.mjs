// Measurement only: one declared managed-controller death, never a new recovery
// mechanism. The existing launcher remains alive and owns any restart.
import {DatabaseSync} from 'node:sqlite';
import {lstatSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const fault=code=>Object.assign(Error(code),{code});
const sha=value=>createHash('sha256').update(value).digest('hex');
const identifier=s=>typeof s==='string'&&/^[-a-zA-Z0-9_]{1,200}$/.test(s);
const hash=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const pid=n=>Number.isSafeInteger(n)&&n>1;
const time=n=>Number.isSafeInteger(n)&&n>=0;
const iso=s=>typeof s==='string'&&s.length<=40&&/(Z|[+-]\d\d:\d\d)$/.test(s)&&Number.isFinite(Date.parse(s));
const evidence=e=>Array.isArray(e)&&e.length>0&&e.length<=8&&e.every(s=>typeof s==='string'&&s.length>0&&s.length<=300&&!/[\u0000-\u001f\u007f]/.test(s));
const sameProcess=(a,b)=>a&&b&&a.pid===b.pid&&a.pgid===b.pgid&&a.startToken===b.startToken;
const processIdentity=p=>p&&pid(p.pid)&&Number.isSafeInteger(p.ppid)&&p.ppid>0&&pid(p.pgid)&&typeof p.startToken==='string'&&p.startToken.length>0&&p.startToken.length<=100&&!/[\u0000-\u001f\u007f]/.test(p.startToken);

/** Metadata only, no argv/environment and no whole-machine process search. */
export function inspectRestartProcess(processId){
 if(!pid(processId))throw fault('RESTART_PROCESS_ID_INVALID');
 let output;
 try{output=execFileSync('ps',['-p',String(processId),'-o','pid=,ppid=,pgid=,lstart='],{encoding:'utf8',timeout:250,maxBuffer:4096,stdio:['ignore','pipe','pipe']});}
 catch(e){if(e.status===1&&!String(e.stdout??'').trim())return null;throw fault('RESTART_PROCESS_INSPECTION_UNKNOWN');}
 const match=output.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
 if(!match||Number(match[1])!==processId)throw fault('RESTART_PROCESS_INSPECTION_UNKNOWN');
 return {pid:processId,ppid:Number(match[2]),pgid:Number(match[3]),startToken:match[4]};
}

/** Read-only consistent SQLite projection. Never openJournal or run migrations.
 * Private plan/task text is hashed in memory, never returned to the timeline. */
export function readManagedRestartSnapshot(path){
 let db;
 try{
  const before=lstatSync(path);if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1)throw fault('RESTART_JOURNAL_UNSAFE');
  db=new DatabaseSync(path,{readOnly:true});db.exec('PRAGMA busy_timeout=100; BEGIN');
  const identity=db.prepare('SELECT world,soul FROM identity WHERE singleton=1').get();
  const meta=db.prepare('SELECT revision,at,length(CAST(payload AS BLOB)) bytes FROM checkpoint WHERE singleton=1').get();
  if(!identity||!meta||meta.bytes>65536)throw fault('RESTART_CHECKPOINT_UNAVAILABLE');
  const value=JSON.parse(db.prepare('SELECT payload FROM checkpoint WHERE singleton=1').get().payload);
  const controller=db.prepare('SELECT owner,generation,expires_at FROM controller WHERE singleton=1').get();
  const count=db.prepare("SELECT COUNT(*) n FROM operations WHERE status<>'settled'").get().n;
  if(count>64)throw fault('RESTART_OPERATION_LIMIT');
  const operations=db.prepare("SELECT id,status,generation FROM operations WHERE status<>'settled' ORDER BY at,id LIMIT 64").all();
  const startup=db.prepare('SELECT id FROM startup_response_v1 WHERE singleton=1').get();
  db.exec('COMMIT');
  const after=lstatSync(path);if(before.dev!==after.dev||before.ino!==after.ino)throw fault('RESTART_JOURNAL_REPLACED');
  if(typeof identity.world!=='string'||identity.world.length>200||typeof identity.soul!=='string'||identity.soul.length>200||typeof value.initialInstruction!=='string'||Buffer.byteLength(value.initialInstruction)>16384||typeof value.plan!=='string'||Buffer.byteLength(value.plan)>16384||!controller||!identifier(controller.owner))throw fault('RESTART_CHECKPOINT_INVALID');
  if(!identifier(value.threadId)||value.wakeAt!=null&&!iso(value.wakeAt)||value.lastDecisionId!=null&&!identifier(value.lastDecisionId)||value.lastCall?.type!=null&&!['read','write','wait','listen'].includes(value.lastCall.type)||startup&&!identifier(startup.id)||operations.some(o=>!identifier(o.id)||!['prepared','dispatching','uncertain'].includes(o.status)||!Number.isSafeInteger(o.generation)))throw fault('RESTART_CHECKPOINT_INVALID');
  return {
   journalIdentity:sha(`${realpathSync(path)}:${before.dev}:${before.ino}`),worldId:identity.world,soulId:identity.soul,
   checkpoint:{revision:meta.revision,at:meta.at,threadId:value.threadId,pendingDecision:value.pendingDecision!==null&&value.pendingDecision!==undefined,wakeAt:value.wakeAt??null,lastCallType:value.lastCall?.type??null,lastDecisionId:value.lastDecisionId??null,initialInstructionSha256:sha(value.initialInstruction),planSha256:sha(value.plan)},
   controller:{generation:controller.generation,ownerSha256:sha(controller.owner),expiresAt:controller.expires_at},
   operations:operations.map(o=>({id:o.id,status:o.status,generation:o.generation})),startupResponseId:startup?.id??null,
  };
 }catch(e){throw fault(/^RESTART_[A-Z_]+$/.test(e.code??'')?e.code:'RESTART_JOURNAL_READ_UNKNOWN');}
 finally{db?.close();}
}

export function baselineAutomaticRestartCapability(){return {arm:'existing-headless-seat',capability:'automatic-whole-controller-restart',status:'fail',supported:false,triggerExercised:false,assistedResume:false,reason:'Existing one-exec workflow has no automatic restart; this is a capability result, not an infrastructure-invalid trial or an exercised death probe.'};}

/** Ownership comes from the outer process owner, not world/model output. Every
 * group/member must be an identified descendant of this exact controller; the
 * caller attests the registered tool-group inventory is complete. */
export function createManagedRestartObserver(config,{
 now=Date.now,readSnapshot=readManagedRestartSnapshot,inspectProcess=inspectRestartProcess,killProcess=process.kill,preDispatch=null,
}={}){
 const {actorId,setupId,journalPath,worldId,soulId,originalInstructionSha256,cutoffAt}=config;
 const minimumFutureWakeMs=config.minimumFutureWakeMs??20000,triggerMaxDelayMs=config.triggerMaxDelayMs??5000,recoveryMaxMs=config.recoveryMaxMs??25000;
 if(preDispatch!==null&&typeof preDispatch!=='function')throw fault('INVALID_RESTART_REFRESH');
 if(!identifier(actorId)||!identifier(setupId)||typeof journalPath!=='string'||!identifier(worldId)||!identifier(soulId)||!hash(originalInstructionSha256)||!time(cutoffAt)||minimumFutureWakeMs!==20000||triggerMaxDelayMs!==5000||recoveryMaxMs!==25000)throw fault('INVALID_RESTART_CONTRACT');
 let state='watching',failure=null,ownership=null,before=null,triggerAt=null,deathAt=null,controllerExitAt=null,oldGroupsAbsentAt=null,readyAt=null,recoveryStartedAt=null,oldOwnership=null,after=null,dispatchAttempted=false,preDispatchObservation=null;
 const signals=[],proofs=new Map(),lifecycle=[];
 const fail=(code,unknown=false)=>{failure??={code,at:now(),status:unknown?'unknown':'fail'};state=failure.status;};
 const scope=s=>s?.worldId===worldId&&s?.soulId===soulId&&s?.checkpoint?.initialInstructionSha256===originalInstructionSha256;
 const validSnapshot=s=>scope(s)&&hash(s.journalIdentity)&&time(s.checkpoint.at)&&Number.isSafeInteger(s.checkpoint.revision)&&s.checkpoint.revision>0&&identifier(s.checkpoint.threadId)&&Number.isSafeInteger(s.controller?.generation)&&s.controller.generation>0&&hash(s.controller.ownerSha256)&&time(s.controller.expiresAt)&&Array.isArray(s.operations)&&s.operations.length<=64;
 const liveFence=s=>s.controller.expiresAt>now();
 const eligible=s=>validSnapshot(s)&&liveFence(s)&&s.checkpoint.lastCallType==='wait'&&!s.checkpoint.pendingDecision&&s.operations.length===0&&Number.isFinite(Date.parse(s.checkpoint.wakeAt))&&Date.parse(s.checkpoint.wakeAt)-now()>=minimumFutureWakeMs&&cutoffAt-now()>=recoveryMaxMs;
 const initialOwnerProved=s=>{
  const row=proofs.get(ownership.controller.pid),startup=row?.startup,session=row?.session,running=row?.running;
  return startup&&session&&running&&row.activeTurn===null&&row.lastTurn?.state==='turn-completed'&&session.at<=startup.at&&startup.at<=running.at&&running.at<=row.lastTurn.at&&row.lastTurn.at<=s.checkpoint.at&&s.checkpoint.at<=now()&&startup.generation===s.controller.generation&&startup.checkpointRevision<=s.checkpoint.revision&&startup.initialInstructionSha256===originalInstructionSha256&&startup.threadId===s.checkpoint.threadId&&startup.startupResponseId===s.startupResponseId&&startup.pendingDecision===false&&startup.unreconciledOperations===0&&session.threadId===s.checkpoint.threadId&&running.threadId===s.checkpoint.threadId&&ownership.groups.some(g=>g.members.some(p=>p.pid===session.hostPid));
 };
 const absent=target=>{try{killProcess(target,0);return false;}catch(e){if(e.code==='ESRCH')return true;throw fault('RESTART_ABSENCE_UNKNOWN');}};
 const inspect=p=>{const observed=inspectProcess(p.pid);if(!sameProcess(observed,p))throw fault('RESTART_PROCESS_IDENTITY_CHANGED');return observed;};
 const validateOwnership=(p,{initial=false}={})=>{
  if(!p||p.actorId!==actorId||p.setupId!==setupId||p.worldId!==worldId||p.soulId!==soulId||p.descendantsComplete!==true||!evidence(p.evidence)||!processIdentity(p.launcher)||!processIdentity(p.controller)||p.controller.ppid!==p.launcher.pid||p.controller.pid===process.pid||p.launcher.pid===p.controller.pid||!Array.isArray(p.groups)||p.groups.length<1||p.groups.length>16)throw fault('RESTART_OWNERSHIP_UNPROVEN');
  const all=new Map([[p.controller.pid,p.controller]]),groupIds=new Set();
  for(const g of p.groups){
   if(!pid(g.pgid)||g.pgid===p.controller.pgid||g.pgid===p.launcher.pgid||groupIds.has(g.pgid)||!Array.isArray(g.members)||g.members.length<1||g.members.length>128)throw fault('RESTART_GROUP_UNSAFE');
   groupIds.add(g.pgid);
   for(const member of g.members){if(!processIdentity(member)||member.pgid!==g.pgid||all.has(member.pid)||member.pid===p.launcher.pid||member.pid===process.pid)throw fault('RESTART_GROUP_UNSAFE');all.set(member.pid,member);}
  }
  for(const g of p.groups)for(const member of g.members){
   const visited=new Set();let current=member;
   while(current.pid!==p.controller.pid){if(visited.has(current.pid)||!all.has(current.ppid))throw fault('RESTART_DESCENDANT_UNPROVEN');visited.add(current.pid);current=all.get(current.ppid);}
  }
  const launcher=inspect(p.launcher),controller=inspect(p.controller);
  if(controller.ppid!==launcher.pid)throw fault('RESTART_PROCESS_IDENTITY_CHANGED');
  for(const g of p.groups)for(const member of g.members){const observed=inspect(member);if(initial&&observed.ppid!==member.ppid)throw fault('RESTART_PROCESS_IDENTITY_CHANGED');}
  return p;
 };
 const attemptSignal=(target,role)=>{
  const at=now();if(at-triggerAt>triggerMaxDelayMs)throw fault('RESTART_DISPATCH_LATE');
  const record={target,role,signal:'SIGKILL',at,delivered:false};signals.push(record);
  try{killProcess(target,'SIGKILL');record.delivered=true;deathAt??=at;}
  catch(e){if(e.code==='ESRCH'&&deathAt!==null){record.alreadyAbsent=true;return;}throw fault('RESTART_SIGNAL_UNKNOWN');}
 };
 const ready=()=>{
  if(!ownership||ownership.controller.pid===oldOwnership.controller.pid||oldGroupsAbsentAt===null)return;
  validateOwnership(ownership);
  if(!sameProcess(ownership.launcher,oldOwnership.launcher))throw fault('RESTART_LAUNCHER_CHANGED');
  const s=readSnapshot(journalPath);after=s;
  if(!validSnapshot(s)||s.journalIdentity!==before.journalIdentity||s.checkpoint.threadId!==before.checkpoint.threadId)throw fault('RESTART_DURABLE_IDENTITY_CHANGED');
  if(!liveFence(s)||s.controller.generation<=before.controller.generation||s.controller.ownerSha256===before.controller.ownerSha256)return;
  const row=proofs.get(ownership.controller.pid);if(!row)return;
  const startup=row.startup,running=row.running,session=row.session,world=row.world,owner=row.owner;
  if(!startup||!running||!session||!world||!owner)return;
  if(startup.generation!==s.controller.generation||startup.checkpointRevision>s.checkpoint.revision||startup.initialInstructionSha256!==originalInstructionSha256||startup.wakeAt!==before.checkpoint.wakeAt||startup.threadId!==before.checkpoint.threadId||startup.pendingDecision!==false||startup.unreconciledOperations!==0||!identifier(startup.startupResponseId)||startup.startupResponseId!==s.startupResponseId||startup.startupResponseId===before.startupResponseId||session.resumed!==true||session.threadId!==before.checkpoint.threadId||running.threadId!==session.threadId||!ownership.groups.some(g=>g.members.some(p=>p.pid===session.hostPid)))throw fault('RESTART_STARTUP_PROOF_CONTRADICTION');
  // Reconciliation is an earlier committed boundary. A new legitimate decision
  // may already be pending by the time this observer reads the journal.
  if((s.checkpoint.pendingDecision||s.operations.length)&&(s.checkpoint.revision<=startup.checkpointRevision||s.operations.some(o=>o.generation!==startup.generation)))throw fault('RESTART_STARTUP_PROOF_CONTRADICTION');
  if([startup,running,session,world,owner].some(e=>e.at<deathAt||e.at>now())||world.at<startup.at||owner.at<startup.at||running.at<startup.at)throw fault('RESTART_READINESS_ORDER_INVALID');
  readyAt=Math.max(oldGroupsAbsentAt,startup.at,running.at,session.at,world.at,owner.at);if(readyAt-deathAt>recoveryMaxMs||readyAt>cutoffAt){fail('RESTART_RECOVERY_TIMEOUT');return;}state='ready';
 };
 return {
  registerOwnership(value){
   if(['ready','fail','unknown','unexercised'].includes(state))return this.snapshot();
   try{validateOwnership(value,{initial:true});if(oldOwnership&&sameProcess(value.controller,oldOwnership.controller))throw fault('RESTART_OLD_WRITER_REGISTERED');if(oldOwnership&&!sameProcess(value.launcher,oldOwnership.launcher))throw fault('RESTART_LAUNCHER_CHANGED');ownership=structuredClone(value);}
   catch(e){fail(e.code??'RESTART_OWNERSHIP_UNKNOWN',true);}
   return this.snapshot();
  },
  observeLifecycle(e){
   if(['ready','fail','unknown','unexercised'].includes(state))return this.snapshot();
   if(!e||e.actorId!==actorId||e.worldId!==worldId||e.soulId!==soulId||!pid(e.controllerPid)||!time(e.at)||!evidence(e.evidence))return this.snapshot();
   if(!['controller-started','session-created','running','startup-reconciled','receiver-ready','turn-started','turn-completed'].includes(e.state))return this.snapshot();
   const malformed=e.state==='session-created'&&(!identifier(e.threadId)||!pid(e.hostPid)||typeof e.resumed!=='boolean')||e.state==='running'&&!identifier(e.threadId)||e.state==='startup-reconciled'&&(!Number.isSafeInteger(e.generation)||e.generation<1||!Number.isSafeInteger(e.checkpointRevision)||e.checkpointRevision<1||!hash(e.initialInstructionSha256)||e.wakeAt!==null&&!iso(e.wakeAt)||!identifier(e.threadId)||typeof e.pendingDecision!=='boolean'||!Number.isSafeInteger(e.unreconciledOperations)||e.unreconciledOperations<0||e.unreconciledOperations>64||!identifier(e.startupResponseId))||e.state==='receiver-ready'&&(!['world','owner'].includes(e.source)||e.successful!==true)||['turn-started','turn-completed'].includes(e.state)&&!identifier(e.turnId);
   if(malformed){fail('RESTART_LIFECYCLE_INVALID',true);return this.snapshot();}
   if(['turn-started','turn-completed'].includes(e.state)){
    const row=proofs.get(e.controllerPid)??{};
    if(row.lastTurn&&e.at<row.lastTurn.at){fail('RESTART_TURN_ORDER_UNKNOWN',true);return this.snapshot();}
    if(e.state==='turn-completed'&&row.activeTurn!==e.turnId){fail('RESTART_TURN_PROOF_UNPROVEN',true);return this.snapshot();}
    row.activeTurn=e.state==='turn-started'?e.turnId:null;row.lastTurn={state:e.state,at:e.at,turnId:e.turnId,evidence:[...e.evidence]};proofs.set(e.controllerPid,row);return this.snapshot();
   }
   if(lifecycle.length>=64){fail('RESTART_LIFECYCLE_LIMIT',true);return this.snapshot();}
   // Retain bounded identities/pointers only, never arbitrary lifecycle payload.
   const record={state:e.state,controllerPid:e.controllerPid,at:e.at,evidence:[...e.evidence]};
   if(e.state==='session-created')Object.assign(record,{threadId:e.threadId,hostPid:e.hostPid,resumed:e.resumed});
   if(e.state==='running')record.threadId=e.threadId;
   if(e.state==='startup-reconciled')for(const key of ['generation','checkpointRevision','initialInstructionSha256','wakeAt','threadId','pendingDecision','unreconciledOperations','startupResponseId'])record[key]=e[key];
   if(e.state==='receiver-ready')Object.assign(record,{source:e.source,successful:true});
   lifecycle.push(record);const row=proofs.get(e.controllerPid)??{};proofs.set(e.controllerPid,row);
   if(e.state==='controller-started'&&deathAt!==null&&e.controllerPid!==oldOwnership.controller.pid)recoveryStartedAt??=e.at;
   if(e.state==='session-created')row.session=record;
   if(e.state==='running')row.running=record;
   if(e.state==='startup-reconciled')row.startup=record;
   if(e.state==='receiver-ready'&&['world','owner'].includes(e.source))row[e.source]=record;
   return this.snapshot();
  },
  tick(){
   if(['ready','fail','unknown','unexercised'].includes(state))return this.snapshot();
   try{
    if(deathAt===null){
     if(!ownership||!proofs.get(ownership.controller.pid)?.running)return this.snapshot();
     const current=readSnapshot(journalPath);
     if(!validSnapshot(current)){if(triggerAt!==null)throw fault('RESTART_CHECKPOINT_INVALID');return this.snapshot();}
     if(triggerAt===null){if(!eligible(current)||!initialOwnerProved(current))return this.snapshot();before=structuredClone(current);triggerAt=now();state='triggered';}
     if(now()-triggerAt>triggerMaxDelayMs){fail('RESTART_DISPATCH_LATE');return this.snapshot();}
     if(!ownership)return this.snapshot();
     if(!eligible(current)||!initialOwnerProved(current)||current.journalIdentity!==before.journalIdentity||current.controller.generation!==before.controller.generation||current.controller.ownerSha256!==before.controller.ownerSha256||current.checkpoint.threadId!==before.checkpoint.threadId||current.checkpoint.lastDecisionId!==before.checkpoint.lastDecisionId||current.checkpoint.wakeAt!==before.checkpoint.wakeAt)throw fault('RESTART_TRIGGER_CHANGED');
     validateOwnership(ownership,{initial:true});
     // Cross-process evidence is sampled, never an atomic idle-at-signal lock.
     // Drain the exact source after potentially slow ps calls, then reread the
     // durable boundary. No model/controller cooperation is introduced.
     const refresh=preDispatch?.();
     if(failure)throw fault('RESTART_DISPATCH_REFRESH_UNKNOWN');
     if(refresh&&typeof refresh.then==='function'||preDispatch&&(!refresh||!time(refresh.at)||refresh.at>now()||!evidence(refresh.evidence)))throw fault('RESTART_DISPATCH_REFRESH_UNKNOWN');
     const latest=readSnapshot(journalPath);
     preDispatchObservation={sampledAt:now(),hostTailRefreshedAt:refresh?.at??null,hostTail:refresh?.reader?{bytes:refresh.reader.bytes,lines:refresh.reader.lines,pendingBytes:refresh.reader.pendingBytes,missing:refresh.reader.missing}:null,evidence:refresh?.evidence??[],checkpointRevision:latest?.checkpoint?.revision??null,checkpointAt:latest?.checkpoint?.at??null,semantics:'Host tail and durable checkpoint sampled after process validation, immediately before dispatch checks; not atomic with SIGKILL or another process.'};
     if(!eligible(latest)||!initialOwnerProved(latest)||latest.journalIdentity!==before.journalIdentity||latest.controller.generation!==before.controller.generation||latest.controller.ownerSha256!==before.controller.ownerSha256||latest.checkpoint.threadId!==before.checkpoint.threadId||latest.checkpoint.revision!==current.checkpoint.revision||latest.checkpoint.lastDecisionId!==before.checkpoint.lastDecisionId||latest.checkpoint.wakeAt!==before.checkpoint.wakeAt)throw fault('RESTART_TRIGGER_CHANGED');
     if(dispatchAttempted)throw fault('RESTART_ALREADY_DISPATCHED');dispatchAttempted=true;oldOwnership=structuredClone(ownership);
     // Kill run first: the unchanged launcher must see signal death, not the
     // explicit configuration failure that a lost host can otherwise provoke.
     attemptSignal(oldOwnership.controller.pid,'controller');
     for(const group of oldOwnership.groups){
      if(absent(-group.pgid))continue;
      // A leader can have died/reparented after run was killed. Require at least
      // one still-live birth-identified member before signaling its exact group.
      const anchored=group.members.some(member=>sameProcess(inspectProcess(member.pid),member));
      if(!anchored)throw fault('RESTART_GROUP_IDENTITY_UNKNOWN');
      attemptSignal(-group.pgid,'host-or-tool-group');
     }
     state='recovering';
    }
    if(absent(oldOwnership.controller.pid))controllerExitAt??=now();
    const gone=controllerExitAt!==null&&oldOwnership.groups.every(g=>absent(-g.pgid));
    if(gone)oldGroupsAbsentAt??=now();
    if(!gone&&now()-triggerAt>triggerMaxDelayMs){fail('RESTART_OLD_WRITERS_REMAIN');return this.snapshot();}
    if(gone)ready();
    if(state!=='ready'&&(now()-deathAt>recoveryMaxMs||now()>cutoffAt)){fail('RESTART_RECOVERY_TIMEOUT');return this.snapshot();}
   }catch(e){
    const code=/^RESTART_[A-Z_]+$/.test(e.code??'')?e.code:'RESTART_OBSERVATION_UNKNOWN';
    const contradiction=deathAt!==null&&['RESTART_DURABLE_IDENTITY_CHANGED','RESTART_STARTUP_PROOF_CONTRADICTION','RESTART_READINESS_ORDER_INVALID','RESTART_LAUNCHER_CHANGED'].includes(code);
    fail(code,!contradiction);
   }
   return this.snapshot();
  },
  finish(){if(!['ready','fail','unknown'].includes(state)){if(deathAt!==null)fail('RESTART_READINESS_UNPROVEN',true);else state='unexercised';}return this.snapshot();},
  snapshot(){return {
   schema:'sim-continuity-managed-restart/1',actor:actorId,setupId,worldId,soulId,state,failure,
   contract:{kind:'checkpoint-future-wake',minimumFutureWakeMs,triggerMaxDelayMs,recoveryMaxMs,cutoffAt,dispatcherRestarts:false,baselineAssistedResume:false},
   triggerAt,deathAt,controllerExitAt,oldGroupsAbsentAt,recoveryStartedAt,readyAt,recoveryLatencyMs:readyAt===null?null:readyAt-deathAt,
   timestampSemantics:{deathAt:'first successfully delivered destructive signal',controllerExitAt:'first observed exact old controller PID absence',oldGroupsAbsentAt:'first observed absence of all identified old writer groups',readyAt:'maximum source startup/session/running/receiver proof time and old-writer absence observation; never spawn time'},
   triggerExercised:deathAt!==null,dispatchAttempted,preDispatchObservation:structuredClone(preDispatchObservation),signals:structuredClone(signals),before:before?structuredClone(before):null,after:after?structuredClone(after):null,
   oldOwnership:oldOwnership?structuredClone(oldOwnership):null,lifecycle:structuredClone(lifecycle),
   threadResumed:readyAt===null?null:after.checkpoint.threadId===before.checkpoint.threadId,
   hostTurns:[...proofs].filter(([,p])=>p.lastTurn).map(([controllerPid,p])=>({controllerPid,activeTurn:p.activeTurn,lastTurn:structuredClone(p.lastTurn)})),
   originalIntentRetained:'not scored; exact initial instruction/timer identity checked at startup, subsequent native/semantic outcomes still required',
   operationReconciliation:'source-cited startup proof and zero unresolved journal operations required; not proof of complete native effect enumeration',
   postStartupWork:readyAt===null?null:{checkpointRevision:after.checkpoint.revision,pendingDecision:after.checkpoint.pendingDecision,unsettledOperations:structuredClone(after.operations)},
   ownershipInventory:'Source-declared inventory of registered launched groups and exact leader/anchor identities. Group absence covers unlisted members in those groups; this is not an entire-machine descendant census.',
   limits:'Only identified owned controller and registered host/tool groups are disrupted. No launcher/world/machine-death claim; spawn/session/running alone never establishes ready.',
  };},
 };
}
