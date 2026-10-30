import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,lstatSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createManagedRestartObserver,readManagedRestartSnapshot,baselineAutomaticRestartCapability} from './continuity-restart.mjs';

const sha=s=>createHash('sha256').update(s).digest('hex');
const identity=(pid,ppid,pgid,startToken=String(pid))=>({pid,ppid,pgid,startToken});
const row=(state,controllerPid,at,extra={})=>({state,actorId:'reader-b',worldId:'world-1',soulId:'s_reader',controllerPid,at,evidence:['controller.ndjson:10'],...extra});
function fixture(overrides={}){
 let time=100000,current={journalIdentity:sha('original-file'),worldId:'world-1',soulId:'s_reader',checkpoint:{revision:10,at:99000,threadId:'thread-1',pendingDecision:false,wakeAt:new Date(160000).toISOString(),lastCallType:'wait',lastDecisionId:'decision-1',initialInstructionSha256:sha('mission'),planSha256:sha('private plan')},controller:{generation:1,ownerSha256:sha('owner-1'),expiresAt:115000},operations:[],startupResponseId:'startup-1'};
 const launcher=identity(1000,999,900),controller=identity(1001,1000,900),host=identity(1100,1001,1100),tool=identity(1200,1100,1200);
 const processes=new Map([launcher,controller,host,tool].map(p=>[p.pid,p]));const calls=[];let sticky=false,inspectDelay=0,denied=false;
 const inspect=p=>{time+=inspectDelay;return processes.get(p)??null;};
 const kill=(target,signal)=>{
  calls.push({target,signal,at:time});const present=target>0?processes.has(target):[...processes.values()].some(p=>p.pgid===-target);
  if(denied&&signal===0)throw Object.assign(Error('denied'),{code:'EPERM'});
  if(!present)throw Object.assign(Error('absent'),{code:'ESRCH'});
  if(signal==='SIGKILL'){
   if(target>0){processes.delete(target);for(const p of processes.values())if(p.ppid===target)p.ppid=1;}
   else if(!sticky)for(const [key,p] of processes)if(p.pgid===-target)processes.delete(key);
  }
 };
 const ownership={actorId:'reader-b',setupId:'setup-1',worldId:'world-1',soulId:'s_reader',descendantsComplete:true,evidence:['owned-spawn-registry:1'],launcher:structuredClone(launcher),controller:structuredClone(controller),groups:[{pgid:1100,members:[structuredClone(host)]},{pgid:1200,members:[structuredClone(tool)]}]};
 const config={actorId:'reader-b',setupId:'setup-1',journalPath:'/synthetic/continuity.sqlite',worldId:'world-1',soulId:'s_reader',originalInstructionSha256:sha('mission'),cutoffAt:200000,...overrides};
 const observer=createManagedRestartObserver(config,{now:()=>time,readSnapshot:()=>structuredClone(current),inspectProcess:inspect,killProcess:kill});
 const arm=()=>{
  observer.registerOwnership(ownership);
  observer.observeLifecycle(row('session-created',1001,98000,{threadId:'thread-1',hostPid:1100,resumed:false}));
  observer.observeLifecycle(row('startup-reconciled',1001,98100,{generation:1,checkpointRevision:1,threadId:'thread-1',initialInstructionSha256:sha('mission'),wakeAt:null,pendingDecision:false,unreconciledOperations:0,startupResponseId:'startup-1'}));
  observer.observeLifecycle(row('running',1001,98200,{threadId:'thread-1'}));
  observer.observeLifecycle(row('turn-started',1001,98500,{turnId:'turn-1'}));observer.observeLifecycle(row('turn-completed',1001,98800,{turnId:'turn-1'}));
 };
 const recover=({omitOwner=false}={})=>{
  time=104000;current={...current,checkpoint:{...current.checkpoint,revision:11,at:102100},controller:{generation:2,ownerSha256:sha('owner-2'),expiresAt:119000},startupResponseId:'startup-2'};
  const c=identity(2001,1000,900),h=identity(2100,2001,2100);processes.set(c.pid,c);processes.set(h.pid,h);
  const owned={...ownership,controller:c,groups:[{pgid:2100,members:[h]}]};observer.registerOwnership(owned);
  observer.observeLifecycle(row('controller-started',2001,101500));
  observer.observeLifecycle(row('session-created',2001,102000,{threadId:'thread-1',hostPid:2100,resumed:true}));
  observer.observeLifecycle(row('startup-reconciled',2001,102100,{generation:2,checkpointRevision:11,threadId:'thread-1',initialInstructionSha256:sha('mission'),wakeAt:current.checkpoint.wakeAt,pendingDecision:false,unreconciledOperations:0,startupResponseId:'startup-2'}));
  observer.observeLifecycle(row('running',2001,102500,{threadId:'thread-1'}));
  observer.observeLifecycle(row('receiver-ready',2001,103000,{source:'world',successful:true}));
  if(!omitOwner)observer.observeLifecycle(row('receiver-ready',2001,103500,{source:'owner',successful:true}));
 };
 return {observer,arm,recover,calls,ownership,processes,get current(){return current;},set current(v){current=v;},setTime:n=>{time=n;},setSticky:value=>{sticky=value;},setInspectDelay:n=>{inspectDelay=n;},setDenied:value=>{denied=value;}};
}

test('wait trigger kills exact controller then identified host/tool groups once; launcher survives',()=>{
 const f=fixture();f.arm();const result=f.observer.tick();
 assert.equal(result.state,'recovering');assert.equal(result.triggerAt,100000);assert.equal(result.deathAt,100000);assert.equal(result.controllerExitAt,100000);assert.equal(result.oldGroupsAbsentAt,100000);
 assert.deepEqual(f.calls.filter(c=>c.signal==='SIGKILL').map(c=>c.target),[1001,-1100,-1200]);assert(f.processes.has(1000));
 f.observer.tick();assert.equal(f.calls.filter(c=>c.signal==='SIGKILL').length,3,'no replayed disturbance');
 assert.equal(result.before.checkpoint.initialInstructionSha256,sha('mission'));assert(!JSON.stringify(result).includes('private plan'));
});

test('explicit fresh fence/startup reconciliation and successful receivers establish actual readiness',()=>{
 const f=fixture();f.arm();f.observer.tick();f.recover();const result=f.observer.tick();
 assert.equal(result.state,'ready');assert.equal(result.recoveryStartedAt,101500);assert.equal(result.readyAt,103500);assert.equal(result.recoveryLatencyMs,3500);assert.equal(result.threadResumed,true);assert.equal(result.after.journalIdentity,result.before.journalIdentity);
 assert.equal(result.contract.cutoffAt,200000);assert.equal(result.contract.dispatcherRestarts,false);assert.equal(result.contract.baselineAssistedResume,false);
});

test('a new action before observer polling does not erase source-proved startup reconciliation or readiness',()=>{
 const f=fixture();f.arm();f.observer.tick();f.recover();f.current.checkpoint.revision=12;f.current.checkpoint.pendingDecision=true;f.current.operations=[{id:'new-operation',status:'dispatching',generation:2}];
 const result=f.observer.tick();assert.equal(result.state,'ready');assert.equal(result.readyAt,103500);assert.equal(result.postStartupWork.pendingDecision,true);assert.equal(result.postStartupWork.unsettledOperations[0].id,'new-operation');
 const g=fixture();g.arm();g.observer.tick();g.recover();g.current.checkpoint.pendingDecision=true;assert.equal(g.observer.tick().failure.code,'RESTART_STARTUP_PROOF_CONTRADICTION');
});

test('spawn/session/running alone, pre-request receiving and missing source success never mean ready',()=>{
 const f=fixture();f.arm();f.observer.tick();f.recover();
 const g=fixture();g.arm();g.observer.tick();g.setTime(104000);
 for(const state of ['controller-started','receiving'])g.observer.observeLifecycle(row(state,2001,103000));
 assert.equal(g.observer.tick().state,'recovering');assert.equal(g.observer.finish().failure.code,'RESTART_READINESS_UNPROVEN');
 const h=fixture();h.arm();h.observer.tick();h.observer.observeLifecycle(row('receiver-ready',2001,101000,{source:'world'}));assert.equal(h.observer.snapshot().failure.code,'RESTART_LIFECYCLE_INVALID');
});

test('only committed wait, future20s timer, no pending effects and full original cutoff margin qualify',()=>{
 for(const change of [s=>s.checkpoint.lastCallType='listen',s=>s.checkpoint.pendingDecision=true,s=>s.checkpoint.wakeAt=null,s=>s.checkpoint.wakeAt=new Date(119999).toISOString(),s=>s.controller.expiresAt=100000,s=>s.operations.push({id:'operation-1',status:'uncertain',generation:1})]){
  const f=fixture();change(f.current);f.arm();assert.equal(f.observer.tick().state,'watching');assert.equal(f.calls.filter(c=>c.signal==='SIGKILL').length,0);assert.equal(f.observer.finish().state,'unexercised');
 }
 const f=fixture({cutoffAt:124999});f.arm();assert.equal(f.observer.tick().state,'watching');assert.equal(f.observer.snapshot().triggerExercised,false);
});

test('changed process birth identity/ancestry, shared groups and incomplete inventory cannot be signalled',()=>{
 const f=fixture();f.processes.get(1001).startToken='reused';f.arm();assert.equal(f.observer.snapshot().failure.code,'RESTART_PROCESS_IDENTITY_CHANGED');assert.equal(f.calls.length,0);
 const g=fixture();g.ownership.groups[0].pgid=900;g.arm();assert.equal(g.observer.snapshot().failure.code,'RESTART_GROUP_UNSAFE');
 const h=fixture();h.ownership.descendantsComplete=false;h.arm();assert.equal(h.observer.snapshot().failure.code,'RESTART_OWNERSHIP_UNPROVEN');
 const i=fixture();i.ownership.groups[0].members[0].ppid=999;i.arm();assert.equal(i.observer.snapshot().failure.code,'RESTART_DESCENDANT_UNPROVEN');
});

test('PID reuse after registration is rechecked immediately before destructive dispatch',()=>{
 const f=fixture();f.arm();f.processes.get(1100).startToken='replacement';assert.equal(f.observer.tick().failure.code,'RESTART_PROCESS_IDENTITY_CHANGED');assert.equal(f.calls.filter(c=>c.signal==='SIGKILL').length,0);
});

test('an old committed wait cannot trigger while a newer host turn is active or owns a different fence',()=>{
 const f=fixture();f.arm();f.observer.observeLifecycle(row('turn-started',1001,99500,{turnId:'turn-2'}));assert.equal(f.observer.tick().state,'watching');assert.equal(f.calls.filter(c=>c.signal==='SIGKILL').length,0);
 const g=fixture();g.arm();g.current.controller.generation=2;g.current.controller.ownerSha256=sha('another-owner');assert.equal(g.observer.tick().state,'watching');assert.equal(g.calls.filter(c=>c.signal==='SIGKILL').length,0);
});

test('five-second trigger bound is rechecked after ownership inspection, before any destructive signal',()=>{
 const f=fixture();f.arm();f.setInspectDelay(1500);const result=f.observer.tick();assert.equal(result.failure.code,'RESTART_DISPATCH_LATE');assert.equal(result.triggerExercised,false);assert.equal(result.deathAt,null);assert.equal(f.calls.filter(c=>c.signal==='SIGKILL').length,0);
});

test('permission-denied group checks preserve unknown absence instead of declaring old writers gone',()=>{
 const f=fixture();f.arm();f.setDenied(true);const result=f.observer.tick();assert.equal(result.failure.code,'RESTART_ABSENCE_UNKNOWN');assert.equal(result.state,'unknown');assert.equal(result.oldGroupsAbsentAt,null);assert.equal(result.signals[0].target,1001);
});

test('remaining/unknown old writer groups cannot be called recovered or repeatedly killed',()=>{
 const f=fixture();f.setSticky(true);f.arm();assert.equal(f.observer.tick().state,'recovering');f.setTime(105001);assert.equal(f.observer.tick().failure.code,'RESTART_OLD_WRITERS_REMAIN');assert.equal(f.calls.filter(c=>c.signal==='SIGKILL').length,3);
});

test('new thread, journal replacement and contradictory original timer cannot pass recovery',()=>{
 for(const mutate of [s=>s.checkpoint.threadId='new-thread',s=>s.journalIdentity=sha('replaced')]){
  const f=fixture();f.arm();f.observer.tick();f.recover();mutate(f.current);assert.equal(f.observer.tick().failure.code,'RESTART_DURABLE_IDENTITY_CHANGED');
 }
 const f=fixture();f.arm();f.observer.tick();f.recover();f.observer.observeLifecycle(row('startup-reconciled',2001,102100,{generation:2,checkpointRevision:11,threadId:'thread-1',initialInstructionSha256:sha('mission'),wakeAt:new Date(170000).toISOString(),pendingDecision:false,unreconciledOperations:0,startupResponseId:'startup-2'}));assert.equal(f.observer.tick().failure.code,'RESTART_STARTUP_PROOF_CONTRADICTION');
});

test('missing one successful receiver adoption remains unready; late observation retains source ready time',()=>{
 const f=fixture();f.arm();f.observer.tick();f.recover();f.current.controller.expiresAt=140000;f.setTime(125100);const result=f.observer.tick();assert.equal(result.state,'ready');assert.equal(result.readyAt,103500);assert.equal(result.recoveryLatencyMs,3500);
 const g=fixture();g.arm();g.observer.tick();g.recover({omitOwner:true});assert.equal(g.observer.tick().state,'recovering');assert.equal(g.observer.finish().failure.code,'RESTART_READINESS_UNPROVEN');
});

test('recovery timeout is a capability failure; missing readiness at final stop remains unknown',()=>{
 const f=fixture();f.arm();f.observer.tick();f.setTime(125001);const result=f.observer.tick();assert.equal(result.state,'fail');assert.equal(result.failure.code,'RESTART_RECOVERY_TIMEOUT');
 const g=fixture();g.arm();g.observer.tick();assert.equal(g.observer.finish().state,'unknown');
 const baseline=baselineAutomaticRestartCapability();assert.equal(baseline.status,'fail');assert.equal(baseline.supported,false);assert.equal(baseline.triggerExercised,false);assert.equal(baseline.assistedResume,false);
});

test('terminal measurement never rearms or changes an already proved outcome on later runtime events',()=>{
 const f=fixture();f.arm();f.observer.tick();f.recover();f.observer.tick();const before=f.observer.snapshot();f.observer.observeLifecycle(row('startup-reconciled',2001,104000,{initialInstructionSha256:'unsafe'}));f.observer.registerOwnership({});assert.deepEqual(f.observer.tick(),before);
 const g=fixture();g.observer.finish();g.arm();assert.equal(g.observer.tick().state,'unexercised');assert.equal(g.calls.filter(c=>c.signal==='SIGKILL').length,0);
});

test('read-only journal snapshot is bounded, scoped and hashes private intent without migrations',t=>{
 const directory=mkdtempSync(join(tmpdir(),'continuity-restart-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));const path=join(directory,'continuity.sqlite');const db=new DatabaseSync(path);
 db.exec("CREATE TABLE identity(singleton INTEGER PRIMARY KEY,world TEXT,soul TEXT);CREATE TABLE checkpoint(singleton INTEGER PRIMARY KEY,revision INTEGER,payload TEXT,at INTEGER);CREATE TABLE controller(singleton INTEGER PRIMARY KEY,owner TEXT,generation INTEGER,expires_at INTEGER);CREATE TABLE operations(id TEXT,status TEXT,generation INTEGER,at INTEGER);CREATE TABLE startup_response_v1(singleton INTEGER PRIMARY KEY,id TEXT);");
 db.prepare('INSERT INTO identity VALUES(1,?,?)').run('world-1','s_reader');db.prepare('INSERT INTO checkpoint VALUES(1,1,?,99000)').run(JSON.stringify({threadId:'thread-1',initialInstruction:'SECRET_PRIVATE_MISSION',plan:'SECRET_PRIVATE_PLAN',lastCall:{type:'wait'},wakeAt:new Date(160000).toISOString(),pendingDecision:null,lastDecisionId:'decision-1'}));db.prepare('INSERT INTO controller VALUES(1,?,1,115000)').run('owner-1');db.exec("INSERT INTO startup_response_v1 VALUES(1,'startup-1')");db.close();
 const bytes=readFileSync(path),before=lstatSync(path);const result=readManagedRestartSnapshot(path);const after=lstatSync(path);
 assert.equal(result.worldId,'world-1');assert.equal(result.checkpoint.initialInstructionSha256,sha('SECRET_PRIVATE_MISSION'));assert(!JSON.stringify(result).includes('SECRET_PRIVATE'));assert.equal(after.ino,before.ino);assert.deepEqual(readFileSync(path),bytes);
 const check=new DatabaseSync(path,{readOnly:true});assert.equal(check.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table'").get().n,5);check.close();
});
