#!/usr/bin/env node
// Opt-in managed controller for an already paired folder. Never pairs, takes
// ownership, or changes a CLI credential. Stop any other controller first.
import {parseArgs} from 'node:util';
import {readFileSync,mkdirSync,writeFileSync,renameSync,lstatSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {CodexHost} from './codex-host.mjs';
import {openJournal} from './journal.mjs';
import {createWorldClient} from './world-client.mjs';
import {runManaged} from './managed.mjs';
import {abortableSleep} from './receiver.mjs';
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
 const {values}=parseArgs({args:argv,options:{folder:{type:'string'},state:{type:'string'},instruction:{type:'string'},model:{type:'string'},effort:{type:'string',default:'low'},seconds:{type:'string'},help:{type:'boolean'}}});
 if(values.help){console.log('node tools/soul-runtime/run.mjs --folder <paired-folder> [--instruction <text-file>] [--model <advertised-model>] [--seconds <bounded-run>]');return;}
 const folder=resolve(values.folder??process.cwd()),state=resolve(values.state??join(folder,'.soul-runtime'));
 const seconds=values.seconds===undefined?null:Number(values.seconds);if(seconds!==null&&(!Number.isFinite(seconds)||seconds<1||seconds>7*86400))throw Error('seconds must be1..604800');
 const stop=new AbortController(),quit=()=>stop.abort(),externalAbort=()=>stop.abort(signal?.reason);
 process.once('SIGINT',quit);process.once('SIGTERM',quit);signal?.addEventListener('abort',externalAbort,{once:true});if(signal?.aborted)externalAbort();
 let journal,ownership,owner,ownerRenewal,timer,ownershipFailure=null;
 try{
 if(stop.signal.aborted)return;
 const credential=join(folder,'.eden-agent.json');if(lstatSync(credential).isSymbolicLink())throw Error('Linked pairing file refused');
 const paired=JSON.parse(readFileSync(credential,'utf8'));
 if(!paired.world||!paired.soul||!paired.token)throw Error('Folder must already be paired to one Soul');
 const world=createWorldClient({world:paired.world,token:paired.token});
 const cfg=await fetch(paired.world.replace(/\/$/,'')+'/v1/config',{redirect:'error',signal:AbortSignal.any([stop.signal,AbortSignal.timeout(15000)])});
 if(!cfg.ok)throw Error('Cannot verify world identity');const config=await cfg.json();if(!config.worldId)throw Error('World identity unavailable');
 const instruction=values.instruction?readFileSync(resolve(values.instruction),'utf8'):undefined;
 if(instruction&&Buffer.byteLength(instruction)>16000)throw Error('Initial instruction exceeds16KiB');
 const scope={worldId:config.worldId,soulId:paired.soul};
 journal=openJournal(state,scope);
 ownership=openJournal(join(folder,'.soul-runtime-owner'),scope);
 timer=seconds?setTimeout(quit,seconds*1000):null;
 const startedAt=new Date().toISOString();let model=values.model??null;
 const saveStatus=s=>{const out={at:new Date().toISOString(),startedAt,soulId:paired.soul,worldId:config.worldId,...s};writeFileSync(join(state,'status.json.tmp'),JSON.stringify(out,null,2),{mode:0o600});renameSync(join(state,'status.json.tmp'),join(state,'status.json'));if(s.state!=='receiving')console.log(JSON.stringify(out));};
 try{owner=await claimStartupLease(ownership.control,{signal:stop.signal,maxWaitMs:leaseWaitMs,onWait:saveStatus});}
 catch(error){saveStatus({state:'blocked',code:error.code??'runtime.failure',reason:error.message});throw error;}
 if(!owner){saveStatus({state:'stopped'});return;}
 ownerRenewal=setInterval(()=>{try{owner=ownership.control.renew(owner);}catch(e){ownershipFailure=e;stop.abort(e);}},5000);
 const cwd=join(state,'host');mkdirSync(cwd,{recursive:true,mode:0o700});
  await runManaged({journal,world,instruction,signal:stop.signal,onState:saveStatus,createHost:()=>{
   const host=new CodexHost({cwd,model,effort:values.effort});
   host.on('event',e=>{if(e.method==='thread/tokenUsage/updated'){writeFileSync(join(state,'usage.json'),JSON.stringify({at:new Date().toISOString(),threadId:host.threadId,model:host.model,usage:e.params.tokenUsage},null,2),{mode:0o600});}if(host.model)model=host.model;});
   return host;
  }});
  if(ownershipFailure)throw ownershipFailure;
 }catch(error){if(!stop.signal.aborted||ownershipFailure)throw ownershipFailure??error;}
 finally{stop.abort();clearInterval(ownerRenewal);if(owner)try{ownership.control.release(owner)}catch{}ownership?.close();clearTimeout(timer);process.removeListener('SIGINT',quit);process.removeListener('SIGTERM',quit);signal?.removeEventListener('abort',externalAbort);journal?.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(e=>{console.error(JSON.stringify({state:'blocked',code:e.code??'runtime.failure',reason:e.message}));process.exitCode=1;});
