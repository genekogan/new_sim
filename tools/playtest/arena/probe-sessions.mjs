// Internal playtest lifecycle only. Archival is independent of Soul success:
// a failed, completed probe keeps its evidence and can leave the sidebar too.
import {mkdirSync,writeFileSync,readFileSync,renameSync,openSync,closeSync,unlinkSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {CodexHost} from '../../soul-runtime/codex-host.mjs';

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
      row.archivedAt=new Date().toISOString();delete row.archiveError;results.push({threadId:row.threadId,archived:true});
     }catch(error){row.archiveError=String(error.message);results.push({threadId:row.threadId,archived:false,error:row.archiveError});}
     mutate(()=>{const current=state.sessions.find(x=>x.threadId===row.threadId);if(!current||current.cwd!==row.cwd)throw Error('Probe registry changed identity');Object.assign(current,row);});
    }
   }finally{try{await host.close();}finally{archiving=false;}}
   return results;
  },
  snapshot:()=>structuredClone(load()),
 };
}
