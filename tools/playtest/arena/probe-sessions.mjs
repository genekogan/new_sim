// Internal playtest lifecycle only. Archival is independent of Soul success:
// a failed, completed probe keeps its evidence and can leave the sidebar too.
import {mkdirSync,writeFileSync,readFileSync,renameSync,openSync,closeSync,unlinkSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {CodexHost} from '../../soul-runtime/codex-host.mjs';

// Exit code alone cannot prove a killed controller cleaned its detached host.
// Require each controller's final certificate or its exact declared-death proof,
// and independently check owned processes. Unknown/EPERM is not absence.
export function verifyOwnedProbeExit({exit,controllers,restartProofs=[]},killProcess=process.kill){
 if(!Number.isInteger(exit?.code)||exit.signal||!Array.isArray(controllers)||!controllers.length)return false;
 const seen=new Set();
 for(const c of controllers){if(!processId(c?.pid)||c.identityAmbiguous===true||seen.has(c.pid))return false;seen.add(c.pid);}
 return controllers.every(c=>{
  const proof=c.closed;
  if(proof==null&&Array.isArray(restartProofs)&&restartProofs.some(p=>verifyRestartTermination(c,p,killProcess)))return true;
  if(c.started!==true||proof?.controllerPid!==c.pid||proof.ownedProcessesExited!==true||!Array.isArray(proof.ownedHosts)||!absentProcess(c.pid,killProcess))return false;
  const pids=new Set();
  for(const host of proof.ownedHosts){
   if(host.groupClosed!==true||host.groupVerification!=='absent')return false;
   if(!processId(host.hostPid)){if(host.hostPid===null&&host.startFailed===true)continue;return false;}
   pids.add(host.hostPid);
   try{killProcess(-host.hostPid,0);return false;}catch(e){if(e.code!=='ESRCH')return false;}
  }
  return [...(c.hostPids??[])].every(pid=>pids.has(pid));
 });
}

const processId=n=>Number.isSafeInteger(n)&&n>1;
const identifier=s=>typeof s==='string'&&/^[-a-zA-Z0-9_]{1,200}$/.test(s);
const evidence=e=>Array.isArray(e)&&e.length>0&&e.length<=8&&e.every(s=>typeof s==='string'&&s.length>0&&s.length<=300&&!/[\u0000-\u001f\u007f]/.test(s));
const processIdentity=p=>p&&processId(p.pid)&&Number.isSafeInteger(p.ppid)&&p.ppid>0&&processId(p.pgid)&&typeof p.startToken==='string'&&p.startToken.length>0&&p.startToken.length<=100&&!/[\u0000-\u001f\u007f]/.test(p.startToken);
const identity=p=>[p.pid,p.ppid,p.pgid,p.startToken];
const absentProcess=(target,killProcess)=>{try{killProcess(target,0);return false;}catch(e){return e.code==='ESRCH';}};

// Mirror the observer's bounded ownership graph contract, without inspecting or
// signaling processes. The trusted per-launch snapshot supplies birth/scope
// binding; a persisted proof with only the same numeric PID is insufficient.
function restartOwnership(owned){
 if(!owned||!['actorId','setupId','worldId','soulId'].every(k=>identifier(owned[k]))||owned.descendantsComplete!==true||!evidence(owned.evidence)||!processIdentity(owned.launcher)||!processIdentity(owned.controller)||owned.controller.pid===owned.launcher.pid||owned.controller.ppid!==owned.launcher.pid||!Array.isArray(owned.groups)||owned.groups.length<1||owned.groups.length>16)return null;
 const groups=new Set(),members=new Map([[owned.controller.pid,owned.controller]]);
 for(const group of owned.groups){
  if(!processId(group.pgid)||groups.has(group.pgid)||group.pgid===owned.controller.pgid||group.pgid===owned.launcher.pgid||!Array.isArray(group.members)||group.members.length<1||group.members.length>128)return null;
  groups.add(group.pgid);
  for(const member of group.members){if(!processIdentity(member)||member.pgid!==group.pgid||members.has(member.pid)||member.pid===owned.launcher.pid)return null;members.set(member.pid,member);}
 }
 for(const group of owned.groups)for(const member of group.members){
  const visited=new Set();let current=member;
  while(current.pid!==owned.controller.pid){if(visited.has(current.pid)||!members.has(current.ppid))return null;visited.add(current.pid);current=members.get(current.ppid);}
 }
 const binding=JSON.stringify({scope:['actorId','setupId','worldId','soulId'].map(k=>owned[k]),launcher:identity(owned.launcher),controller:identity(owned.controller),groups:[...owned.groups].sort((a,b)=>a.pgid-b.pgid).map(g=>[g.pgid,[...g.members].sort((a,b)=>a.pid-b.pid).map(identity)])});
 return {groups,members,binding};
}

// An intentionally killed controller cannot write its own final certificate.
// Accept only the typed observer's exact external termination evidence for that
// controller, then independently recheck every old writer's absence. This does
// not certify successful recovery, behavior, or any later controller's cleanup.
export function verifyRestartTermination(controller,proof,killProcess=process.kill){
 const at=n=>Number.isSafeInteger(n)&&n>=0;
 const owned=proof?.oldOwnership;
 if(controller?.started!==true||controller.identityAmbiguous===true||!processId(controller.pid)||proof?.schema!=='sim-continuity-managed-restart/1'||proof.dispatchAttempted!==true||proof.triggerExercised!==true||!at(proof.deathAt)||!at(proof.controllerExitAt)||!at(proof.oldGroupsAbsentAt)||proof.controllerExitAt<proof.deathAt||proof.oldGroupsAbsentAt<proof.controllerExitAt||owned?.controller?.pid!==controller.pid||!Array.isArray(proof.signals)||!proof.signals.some(s=>s?.target===controller.pid&&s.role==='controller'&&s.signal==='SIGKILL'&&s.delivered===true&&s.at===proof.deathAt))return false;
 const expected=restartOwnership(controller.restartOwnership),actual=restartOwnership(owned);
 if(!expected||!actual||expected.binding!==actual.binding||proof.actor!==owned.actorId||proof.setupId!==owned.setupId||proof.worldId!==owned.worldId||proof.soulId!==owned.soulId)return false;
 const {groups,members}=actual;
 if(![...(controller.hostPids??[])].every(p=>groups.has(p)))return false;
 for(const target of [...members.keys(),...[...groups].map(p=>-p)])if(!absentProcess(target,killProcess))return false;
 return true;
}

export function probeSessions(directory,{createHost=opts=>new CodexHost(opts)}={}){
 const root=resolve(directory),file=join(root,'probe-sessions.json');
 mkdirSync(root,{recursive:true});
 const load=()=>{let state;try{state=JSON.parse(readFileSync(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;state={schema:'sim-internal-probe-sessions/1',sessions:[]};}if(state.schema!=='sim-internal-probe-sessions/1')throw Error('Unknown probe session manifest');return state;};
 let state=load(),archiving=false;
 const save=()=>{writeFileSync(file+'.tmp',JSON.stringify(state,null,2)+'\n',{mode:0o600});renameSync(file+'.tmp',file);};
 // Synchronous short transactions; never hold the lock during host RPC. Refuse
 // contention instead of losing a second writer's registration or evidence.
 const mutate=fn=>{const lock=file+'.lock',fd=openSync(lock,'wx',0o600);try{writeFileSync(fd,String(process.pid));state=load();const result=fn();save();return result;}finally{closeSync(fd);unlinkSync(lock);}};
 return {
  register({threadId,cwd,name,ephemeral=false,recoveryMechanism}){
   if(!threadId||!name?.trim()||!recoveryMechanism)throw Error('Probe identity, readable name and recovery mechanism required');
   const absolute=resolve(cwd);if(!absolute.startsWith(root+'/'))throw Error('Probe host must be inside its evidence directory');
   return mutate(()=>{const existing=state.sessions.find(x=>x.threadId===threadId);
   if(existing){if(existing.cwd!==absolute||existing.ephemeral!==ephemeral)throw Error('Probe identity changed');return;}
   state.sessions.push({threadId,cwd:absolute,name,ephemeral,recoveryMechanism,registeredAt:new Date().toISOString(),terminal:false});});
  },
  complete(threadId,{outcome,ownedProcessesExited,evidence}={}){
   return mutate(()=>{const row=state.sessions.find(x=>x.threadId===threadId);if(!row)throw Error('Unregistered probe');
   if(ownedProcessesExited!==true||!evidence||!['passed','failed','bounded-end','cancelled'].includes(outcome))throw Error('Require terminal probe outcome, evidence and exited owned processes');
   Object.assign(row,{terminal:true,outcome,evidence,completedAt:new Date().toISOString()});});
  },
  async archiveCompleted(){
   if(archiving)throw Error('Probe archival already in progress');
   const pending=load().sessions.filter(x=>x.terminal&&!x.archivedAt&&!x.ephemeral);
   if(!pending.length)return [];
   const host=createHost({cwd:root});const results=[];archiving=true;
   try{
    await host.request('initialize',{clientInfo:{name:'sim_internal_probe_cleanup',version:'1'}});host.send({method:'initialized',params:{}});
    for(const row of pending){
     try{
      // No resume/start: never creates a chat or starts inference for cleanup.
      const result=await host.request('thread/read',{threadId:row.threadId,includeTurns:false});
      if(resolve(result.thread.cwd)!==row.cwd)throw Error('Stored thread does not match registered probe folder');
      const status=result.thread.status?.type??result.thread.status;
      if(!['idle','notLoaded'].includes(status))throw Error('Probe thread is not idle');
      await host.request('thread/archive',{threadId:row.threadId});
      row.archivedAt=new Date().toISOString();delete row.archiveError;
     }catch(error){row.archiveError=String(error.message);}
     const result=mutate(()=>{
      const current=state.sessions.find(x=>x.threadId===row.threadId);
      if(!current||current.cwd!==row.cwd||current.ephemeral!==row.ephemeral||!current.terminal)throw Error('Probe registry changed identity or terminal ownership');
      // RPC awaited against a snapshot. Preserve concurrently updated completion
      // outcome/evidence; merge only archive facts, never the stale whole row.
      if(row.archivedAt){current.archivedAt=row.archivedAt;delete current.archiveError;}
      else if(!current.archivedAt)current.archiveError=row.archiveError;
      return current.archivedAt?{threadId:row.threadId,archived:true}:{threadId:row.threadId,archived:false,error:current.archiveError};
     });results.push(result);
    }
   }finally{try{await host.close();}finally{archiving=false;}}
   return results;
  },
  snapshot:()=>structuredClone(load()),
 };
}
