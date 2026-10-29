// Bounded development runner, NOT the sealed comparison scorer. One controller
// process and private journal per Soul; no speaking order or cross-agent relay.
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,appendFileSync,existsSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createWorldClient} from '../../soul-runtime/world-client.mjs';
import {abortableSleep} from '../../soul-runtime/receiver.mjs';
import {probeSessions,verifyOwnedProbeExit} from './probe-sessions.mjs';

export async function runIndependentProbe({directory,actors,fixtureActors=[],seconds,model,effort='low',signal,onState=()=>{}}){
 if(!Number.isFinite(seconds)||seconds<1||seconds>3600||!model||!Array.isArray(actors)||actors.length<2||actors.length>5)throw Error('Require bounded2..5-Soul probe and explicit model');
 if(new Set(actors.map(a=>a.id)).size!==actors.length||actors.some(a=>!/^[-a-zA-Z0-9]+$/.test(a.id)||!a.instruction?.trim()||a.instruction.length>16000||!Number.isFinite(a.releaseOffsetSec??0)||(a.releaseOffsetSec??0)<0||(a.releaseOffsetSec??0)>=seconds))throw Error('Invalid independent actor specification');
 const out=resolve(directory);if(existsSync(join(out,'summary.json'))||existsSync(join(out,'timeline.jsonl')))throw Error('Use a fresh probe output directory');
 mkdirSync(out,{recursive:true});
 // Single registry writer: this outer runner owns all sessions; Soul children
 // never open or mutate the run-level lifecycle manifest.
 const registry=probeSessions(out),stop=new AbortController(),abort=()=>stop.abort();
 signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
 let started=null,timer=null;const children=[],rows=[],fixtures=[],tasks=[];
 const record=(kind,data)=>appendFileSync(join(out,'timeline.jsonl'),JSON.stringify({at:Date.now(),kind,...data})+'\n');

 const script=fileURLToPath(new URL('../../soul-runtime/launch.mjs',import.meta.url));
 let failure=null;
 try{
  const souls=new Set(),worlds=new Set();
  for(const actor of actors){
   const folder=resolve(actor.folder),paired=JSON.parse(readFileSync(join(folder,'.eden-agent.json'),'utf8'));
   if(souls.has(paired.soul))throw Error('Two controllers cannot share a Soul');souls.add(paired.soul);worlds.add(paired.world);
   const actorDir=join(out,actor.id);mkdirSync(actorDir,{recursive:true});
   const instruction=join(actorDir,'instruction.txt');writeFileSync(instruction,actor.instruction,{mode:0o600});
   const state=join(actorDir,'runtime'),name=`Sim probe — ${actor.id}`;
   rows.push({actor,folder,paired,world:createWorldClient({world:paired.world,token:paired.token,timeoutMs:10000}),state,name,instruction,threadIds:new Set(),controllers:new Map(),exit:null});
  }
  for(const actor of fixtureActors){
   if(!/^[-a-zA-Z0-9]+$/.test(actor.id)||rows.some(r=>r.actor.id===actor.id)||fixtures.some(r=>r.actor.id===actor.id))throw Error('Invalid fixture identity');
   const paired=JSON.parse(readFileSync(join(resolve(actor.folder),'.eden-agent.json'),'utf8'));
   if(souls.has(paired.soul))throw Error('Fixture cannot share a controlled Soul');souls.add(paired.soul);worlds.add(paired.world);
   fixtures.push({actor,paired,world:createWorldClient({world:paired.world,token:paired.token,timeoutMs:10000})});
  }
  if(worlds.size!==1)throw Error('All actors must inhabit the same test world');
  const url=new URL([...worlds][0]);if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('Internal runner only permits isolated loopback worlds');
  const response=await fetch([...worlds][0]+'/v1/config',{redirect:'error',signal:AbortSignal.any([stop.signal,AbortSignal.timeout(10000)])});if(!response.ok)throw Error('Cannot verify isolated world configuration (HTTP '+response.status+')');
  const cfg=await response.json();if(!cfg.devAuth)throw Error('Internal runner requires devAuth world');
  const sample=async(row,kind,signal)=>{
   const requestedAt=Date.now(),h=await row.world.read('here',{},signal),me=h.here?.me;
   if(!me?.pos)throw Error('Missing current native body');
   record(kind,{actor:row.actor.id,soulId:row.paired.soul,requestedAt,receivedAt:Date.now(),source:'here',tick:h.here.tick,me:{place:me.place,pos:me.pos,posture:me.posture,seat:me.seat,activity:me.activity,actualActivity:me.actualActivity}});
  };
  // Establish current bodies before T0; setup work never consumes a trial's
  // release offset. This remains development evidence, not fixture approval.
  for(const row of [...rows,...fixtures])await sample(row,'setup-body',stop.signal);
  started=Date.now();timer=setTimeout(abort,seconds*1000);
  writeFileSync(join(out,'run.json'),JSON.stringify({kind:'development-only',startedAt:new Date(started).toISOString(),seconds,model,effort,world:[...worlds][0],worldId:cfg.worldId,actors:rows.map(r=>({id:r.actor.id,soulId:r.paired.soul,agentEvidence:'agent-evidence.jsonl',releaseOffsetSec:r.actor.releaseOffsetSec??0,instructionId:createHash('sha256').update(r.actor.instruction).digest('hex')})),fixtureActors:fixtures.map(r=>({id:r.actor.id,soulId:r.paired.soul})),recoveryMechanism:'durable Codex thread plus durable Soul journal; no journal-only claim'},null,2));
  for(const row of rows){
   tasks.push((async()=>{
    const scheduledAt=started+(row.actor.releaseOffsetSec??0)*1000;await abortableSleep(Math.max(0,scheduledAt-Date.now()),stop.signal);if(stop.signal.aborted)return;
    const remainingSeconds=Math.max(1,Math.ceil((started+seconds*1000-Date.now())/1000));
    const child=spawn(process.execPath,[script,'--folder',row.folder,'--state',row.state,'--instruction',row.instruction,'--model',model,'--effort',effort,'--session-name',row.name,'--evidence',join(out,row.actor.id,'agent-evidence.jsonl'),'--seconds',String(remainingSeconds)],{stdio:['ignore','pipe','pipe']});
    record('controller-release',{actor:row.actor.id,scheduledAt,releasedAt:Date.now(),instructionId:createHash('sha256').update(row.actor.instruction).digest('hex'),pid:child.pid});
    children.push(child);let buffer='';
    // 'close' follows stdout/stderr drain; final cleanup certificates must be
    // received before deciding whether any owned probe is safe to archive.
    const finished=new Promise((a,b)=>{child.once('exit',(code,signal)=>{row.exit={code,signal};});child.once('close',(code,signal)=>{row.exit??={code,signal};a(row.exit)});child.once('error',b)});
    let killTimer;const terminate=()=>{child.kill('SIGTERM');killTimer=setTimeout(()=>child.kill('SIGKILL'),15000)};
    stop.signal.addEventListener('abort',terminate,{once:true});if(stop.signal.aborted)terminate();
    child.stderr.on('data',()=>{});
    child.stdout.on('data',chunk=>{
     try{
     buffer+=chunk;if(buffer.length>1024*1024){failure='Controller diagnostic line exceeded bound';abort();return;}
     let at;while((at=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,at);buffer=buffer.slice(at+1);let state;try{state=JSON.parse(line)}catch{continue;}
      record('runtime',{actor:row.actor.id,...state});
      const controllerPid=state.state==='controller-started'?state.pid:state.controllerPid;
      if(Number.isInteger(controllerPid)&&controllerPid>0){
       const controller=row.controllers.get(controllerPid)??{pid:controllerPid,started:false,hostPids:new Set(),closed:null};row.controllers.set(controllerPid,controller);
       if(state.state==='controller-started')controller.started=true;
       if(Number.isInteger(state.hostPid)&&state.hostPid>0)controller.hostPids.add(state.hostPid);
       if(state.state==='controller-closed')controller.closed=state;
      }
      const threads=new Set(['session-created','running','host-closed'].includes(state.state)&&state.threadId?[state.threadId]:[]);
      if(state.state==='controller-closed')for(const host of state.ownedHosts??[])if(host.threadId)threads.add(host.threadId);
      for(const threadId of threads){row.threadIds.add(threadId);registry.register({threadId,cwd:join(row.state,'host'),name:row.name,recoveryMechanism:'durable Codex thread and Soul journal; creation registered before naming/observation'});}onState({actor:row.actor.id,...state});
     }
     }catch(error){failure=error.message;abort();}
    });
    try{await finished;if(!stop.signal.aborted){failure=`${row.actor.id} controller ended early`;abort();}}
    finally{clearTimeout(killTimer);stop.signal.removeEventListener('abort',terminate);}
   })().catch(error=>{failure=error.message;abort()}));
  }
  let nextSample=Date.now();
  while(!stop.signal.aborted){
   await Promise.all([...rows,...fixtures].map(async row=>{try{
    await sample(row,fixtures.includes(row)?'fixture-body':'body',stop.signal);
   }catch(error){if(!stop.signal.aborted)record('observation-error',{actor:row.actor.id,code:error.code,message:error.message});}}));
   nextSample+=1000;if(nextSample<Date.now())nextSample=Date.now();
   await abortableSleep(Math.max(0,nextSample-Date.now()),stop.signal);
  }
  // Verification-only sample brackets the cutoff for occupied fixtures. It
  // never extends participant action credit past the declared end.
  if(started&&Date.now()>=started+seconds*1000)for(const row of fixtures)try{await sample(row,'fixture-body',AbortSignal.timeout(10000));}catch(error){record('observation-error',{actor:row.actor.id,phase:'cutoff-bracket',message:error.message});}

 }catch(error){if(!stop.signal.aborted)failure=error.message;}
 finally{
  abort();clearTimeout(timer);await Promise.allSettled(tasks);signal?.removeEventListener('abort',abort);
  for(const row of rows){row.cleanupVerified=verifyOwnedProbeExit({exit:row.exit,controllers:[...row.controllers.values()]});if(!row.cleanupVerified&&row.controllers.size)failure??=`${row.actor.id} owned process cleanup is unverified; sessions retained unarchived`;}
  const summary={kind:'development-only',startedAt:started===null?null:new Date(started).toISOString(),endedAt:new Date().toISOString(),failure,actors:rows.map(r=>({id:r.actor.id,soulId:r.paired.soul,threads:[...r.threadIds],exit:r.exit,cleanupVerified:r.cleanupVerified,controllers:[...r.controllers.values()].map(c=>({...c,hostPids:[...c.hostPids]}))})),limits:'Bounded independent-agent exercise; no sealed A/B, latency SLA, or automatic semantic pass claim.'};
  writeFileSync(join(out,'summary.json'),JSON.stringify(summary,null,2));
  for(const row of rows)if(row.cleanupVerified)for(const threadId of row.threadIds)registry.complete(threadId,{outcome:failure||row.exit.code!==0?'failed':'bounded-end',ownedProcessesExited:true,evidence:'summary.json;timeline.jsonl: every controller and owned host group verified closed'});
  const archived=await registry.archiveCompleted();writeFileSync(join(out,'archive-results.json'),JSON.stringify(archived,null,2));
  return {...summary,archived};
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const config=JSON.parse(readFileSync(resolve(process.argv[2]),'utf8')),stop=new AbortController();
 process.once('SIGINT',()=>stop.abort());process.once('SIGTERM',()=>stop.abort());
 runIndependentProbe({...config,signal:stop.signal,onState:s=>{if(['running','blocked','recovering'].includes(s.state))console.log(JSON.stringify(s));}}).then(r=>{console.log(JSON.stringify(r));if(r.failure)process.exitCode=1;}).catch(e=>{console.error(e.message);process.exitCode=1});
}
