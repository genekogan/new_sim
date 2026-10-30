import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createHash} from 'node:crypto';
import {PassThrough} from 'node:stream';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,appendFileSync,statSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CONTINUITY_ARMS,validateContinuityTrial,prepareR400Seat,runContinuityTrial,runManagedTrialActor,verifyBaselineTrialExit} from './continuity-trial.mjs';
import {verifyOwnedProbeExit,probeSessions} from './probe-sessions.mjs';
import {buildContinuityBaselineArgs} from './adapters/continuity-baseline.mjs';

const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
const usageLimits={perActor:{totalTokens:1000000,outputTokens:100000},aggregate:{totalTokens:2000000,outputTokens:200000}};
function usageEvidence(args,arm){
 const baseline=arm===CONTINUITY_ARMS[0];mkdirSync(args.directory,{recursive:true});
 const rows=baseline?[{type:'thread.started',thread_id:'usage-thread'},{type:'turn.started'},{type:'turn.completed',usage:{input_tokens:50,cached_input_tokens:20,output_tokens:5}}]:[{kind:'host-session',state:'connected',threadId:'usage-thread',resumed:false},{kind:'host-event',method:'turn/started',threadId:'usage-thread',turnId:'turn-1'},{kind:'host-event',method:'thread/tokenUsage/updated',threadId:'usage-thread',tokenUsage:{total:{inputTokens:50,cachedInputTokens:20,outputTokens:5,totalTokens:55}}},{kind:'host-event',method:'turn/completed',threadId:'usage-thread',turnId:'turn-1'}];
 writeFileSync(join(args.directory,baseline?'stream.ndjson':'agent-evidence.jsonl'),rows.map(x=>JSON.stringify(x)+'\n').join(''));
}
class Clock{
 time=100000;sequence=0;timers=new Map();
 now=()=>this.time;
 schedule=(fn,ms)=>{const id=++this.sequence;this.timers.set(id,{fn,at:this.time+ms});return id;};
 cancelSchedule=id=>this.timers.delete(id);
 sleep=(ms,signal)=>{if(signal?.aborted||ms<=0)return Promise.resolve();return new Promise(resolve=>{let id;const done=()=>{this.cancelSchedule(id);signal?.removeEventListener('abort',done);resolve();};id=this.schedule(done,ms);signal?.addEventListener('abort',done,{once:true});});};
 async tick(ms){const target=this.time+ms;await flush();for(;;){const entry=[...this.timers].filter(([,v])=>v.at<=target).sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];if(!entry)break;this.time=entry[1].at;this.timers.delete(entry[0]);entry[1].fn();await flush();}this.time=target;await flush();}
}
function fixture(t,overrides={}){
 const root=mkdtempSync(join(tmpdir(),'continuity-trial-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const clock=new Clock(),calls=[],lifecycle=[],samples=[];
 const config={directory:join(root,'trial'),arm:CONTINUITY_ARMS[0],purpose:'short',seconds:3,model:'declared-model',effort:'high',worldId:'fresh-world',actors:[{id:'a',folder:join(root,'a'),instruction:'Whole original mission A'},{id:'b',folder:join(root,'b'),instruction:'Whole original mission B'}],...overrides};
 const registry={register(row){lifecycle.push(['register',row]);},complete(id,row){lifecycle.push(['complete',id,row]);},async archiveCompleted(){lifecycle.push(['archive']);return [];}};
 const launch=async args=>{
  calls.push(args);const id=args.cwd?.includes('/a/')?'a':args.directory.includes('/a/')?'a':'b';
  args.onState({state:config.arm===CONTINUITY_ARMS[0]?'thread-created':'session-created',threadId:'thread-'+id,cwd:args.cwd??join(args.directory,'runtime','host')});
  lifecycle.push(['name','thread-'+id]);
  if(config.usageGuard)usageEvidence(args,config.arm);
  await clock.sleep(config.seconds*1000,args.signal);
  lifecycle.push(['closed','thread-'+id]);
  return {exit:{code:0,signal:null},endedAt:clock.now(),ownedProcessesExited:true,evidenceComplete:true};
 };
 const deps={now:clock.now,sleep:clock.sleep,schedule:clock.schedule,cancelSchedule:clock.cancelSchedule,loadPairing:folder=>({world:'http://127.0.0.1:19999',soul:'s_'+folder.split('/').at(-1),token:'opaque-never-logged'}),createWorld:paired=>({async read(command,args,signal){assert.equal(command,'here');assert.deepEqual(args,{view:'body'});samples.push({soul:paired.soul,at:clock.now(),aborted:signal.aborted});return {here:{view:'body',tick:samples.length,me:{pos:{x:1,z:2},place:'p_native',activity:{kind:'read'},actualActivity:{kind:'walk'},posture:'stand',seat:null}}};}}),verifyWorld:async()=>({devAuth:true,worldId:'fresh-world'}),registryFactory:()=>registry,prepareBaseline:(folder,cwd)=>{mkdirSync(cwd);return {cwd,revision:'verified-test',artifacts:{}};},launchBaseline:launch,launchCandidate:launch,verifyBaseline:()=>true,verifyCandidate:()=>true};
 return {root,clock,calls,lifecycle,samples,config,deps,rows:()=>readFileSync(join(config.directory,'timeline.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)};
}

test('explicit arm/model/effort, bounded instructions, and a continuous >=7200-second soak',()=>{
 const good={directory:'/unused',arm:CONTINUITY_ARMS[1],purpose:'soak',seconds:7200,usageGuard:usageLimits,model:'chosen',effort:'low',worldId:'w',actors:[{id:'a',folder:'/unused/a',instruction:'mission'}]};
 assert.equal(validateContinuityTrial(good),good);
 assert.doesNotThrow(()=>validateContinuityTrial({...good,seconds:604800}));
 for(const change of [{seconds:7199},{seconds:604801},{model:undefined},{effort:undefined},{arm:undefined},{actors:[{...good.actors[0],releaseOffsetSec:7200}]},{actors:[{...good.actors[0],instruction:'😀'.repeat(4096)}]}])assert.throws(()=>validateContinuityTrial({...good,...change}));
});

test('ordinary early baseline exit preserves peers and every passive sample through the full cutoff',async t=>{
 const f=fixture(t);const normal=f.deps.launchBaseline;
 f.deps.launchBaseline=async args=>{
  if(!args.cwd.includes('/a/'))return normal(args);
  f.calls.push(args);args.onState({state:'thread-created',threadId:'thread-a',cwd:args.cwd});f.lifecycle.push(['name','thread-a']);
  return {exit:{code:0,signal:null},endedAt:f.clock.now(),ownedProcessesExited:true,evidenceComplete:true};
 };
 const pending=runContinuityTrial(f.config,f.deps);await flush();
 assert.equal(f.calls.length,2);assert.equal(f.calls[1].signal.aborted,false);
 await f.clock.tick(2000);assert.equal(f.calls[1].signal.aborted,false);
 assert.equal(f.rows().filter(row=>row.kind==='body'&&row.actor==='a').length,3);
 await f.clock.tick(1000);const result=await pending;
 assert.equal(result.endReason,'cutoff');assert.equal(result.cutoffAt-result.startedAt,3000);
 assert.equal(result.endedAt,result.cutoffAt);assert.equal(f.calls.length,2,'no synthetic continuation after early completion');
 assert.equal(result.actors[0].endedBeforeCutoff,true);assert.equal(result.qualification,'not assessed');
 for(const id of ['a','b']){
  assert(f.lifecycle.findIndex(row=>row[0]==='register'&&row[1].threadId==='thread-'+id)<f.lifecycle.findIndex(row=>row[0]==='name'&&row[1]==='thread-'+id));
 }
 assert(f.lifecycle.findIndex(row=>row[0]==='closed')<f.lifecycle.findIndex(row=>row[0]==='complete'));
 const manifest=JSON.parse(readFileSync(join(f.config.directory,'run.json'),'utf8'));
 assert.equal(manifest.modelRequested,'declared-model');assert.equal(manifest.effortRequested,'high');assert.equal(manifest.baselineWake,false);
 assert.equal(manifest.actors[0].instructionSha256.length,64);assert.equal(manifest.actors[0].promptArgsSha256.length,64);
 assert.equal(result.actors[0].actualEffort,null);
 const native=f.rows().find(row=>row.kind==='body');assert.equal(native.me.activity.kind,'read');assert.equal(native.me.actualActivity.kind,'walk');assert.equal(native.source,'here');assert.equal(native.view,'body');
 assert(!readFileSync(join(f.config.directory,'timeline.jsonl'),'utf8').includes('opaque-never-logged'));
 assert.equal(statSync(f.config.directory).mode&0o777,0o700);assert.equal(statSync(join(f.config.directory,'timeline.jsonl')).mode&0o777,0o600);
});

test('setup precedes T0 and delayed releases get only the original remaining lifetime',async t=>{
 const f=fixture(t,{seconds:4,actors:[{id:'a',folder:'/test/a',instruction:'A'},{id:'b',folder:'/test/b',instruction:'B',releaseOffsetSec:1.5}]});
 const verify=f.deps.verifyWorld;f.deps.verifyWorld=async()=>{f.clock.time+=2000;return verify();};
 const pending=runContinuityTrial(f.config,f.deps);await flush();assert.equal(f.calls.length,1);
 await f.clock.tick(1500);assert.equal(f.calls.length,2);assert.equal(f.calls[1].remainingSeconds,2.5);
 await f.clock.tick(2500);const result=await pending;assert.equal(result.startedAt,102000);assert.equal(result.cutoffAt,106000);
 assert.equal(f.calls[1].text,'B');assert.equal(f.calls[1].model,f.calls[0].model);assert.equal(f.calls[1].effort,f.calls[0].effort);
});

test('soak is one uninterrupted two-hour state lifetime, with one launch per actor',async t=>{
 const f=fixture(t,{purpose:'soak',seconds:7200,usageGuard:usageLimits,actors:[{id:'a',folder:'/test/a',instruction:'Long strategic wait'}]});
 const pending=runContinuityTrial(f.config,f.deps);await flush();assert.equal(f.calls[0].remainingSeconds,7200);
 await f.clock.tick(7200000);const result=await pending;
 assert.equal(result.cutoffAt-result.startedAt,7200000);assert.equal(f.calls.length,1);assert.equal(f.rows().filter(row=>row.kind==='body').length,7200);
 assert.equal(result.usageGuard.status,'complete');assert.equal(result.usageGuard.aggregate.totalTokens,55,'cumulative counters are not summed per sample');
});

test('unverified cleanup is retained and never completed or archived as a terminal session',async t=>{
 const f=fixture(t);f.deps.verifyBaseline=()=>false;
 const pending=runContinuityTrial(f.config,f.deps);await f.clock.tick(3000);const result=await pending;
 assert.equal(result.failureCode,'OWNED_CLEANUP_UNVERIFIED');assert(result.actors.every(actor=>!actor.cleanupVerified));
 assert.equal(f.lifecycle.filter(row=>row[0]==='complete').length,0);
});

test('fresh-output refusal includes existing empty directories and linked paths',async t=>{
 const f=fixture(t);mkdirSync(f.config.directory);
 await assert.rejects(runContinuityTrial(f.config,f.deps),{code:'EEXIST'});
 const target=join(f.root,'target');mkdirSync(target);const linked=join(f.root,'linked');symlinkSync(target,linked);
 await assert.rejects(runContinuityTrial({...f.config,directory:linked},f.deps),{code:'EEXIST'});
});

test('nonloopback worlds and mismatched native world identity never launch an actor',async t=>{
 const f=fixture(t);f.deps.loadPairing=()=>({world:'https://sim.eden.art/w/live',soul:'s_a',token:'opaque'});
 const result=await runContinuityTrial(f.config,f.deps);assert.equal(result.failureCode,'LOOPBACK_DEVAUTH_REQUIRED');assert.equal(f.calls.length,0);
 const g=fixture(t);g.deps.verifyWorld=async()=>({worldId:'another-world',devAuth:true});
 const mismatch=await runContinuityTrial(g.config,g.deps);assert.equal(mismatch.failureCode,'WORLD_ID_MISMATCH');assert.equal(g.calls.length,0);
 const h=fixture(t);h.deps.verifyWorld=async()=>({worldId:'fresh-world',devAuth:false});
 const noDevAuth=await runContinuityTrial(h.config,h.deps);assert.equal(noDevAuth.failureCode,'LOOPBACK_DEVAUTH_REQUIRED');assert.equal(h.calls.length,0);
});

test('the absolute cutoff aborts slow native observations as well as actors',async t=>{
 const f=fixture(t);let observations=0;
 f.deps.createWorld=()=>({async read(command,args,signal){
  if(++observations>2)await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));
  return {here:{view:'body',tick:observations,me:{pos:{x:0,z:0},actualActivity:null}}};
 }});
 const pending=runContinuityTrial(f.config,f.deps);await flush();assert.equal(f.calls.length,2);
 await f.clock.tick(3000);const result=await pending;
 assert.equal(result.endReason,'cutoff');assert.equal(result.endedAt,result.cutoffAt);assert(f.calls.every(call=>call.signal.aborted));
});

test('fixture-only cutoff bracket uses a fresh signal and never extends participant credit',async t=>{
 const f=fixture(t,{fixtureActors:[{id:'occupied',folder:'/test/occupied'}]});
 const pending=runContinuityTrial(f.config,f.deps);await f.clock.tick(3000);const result=await pending;
 const brackets=f.rows().filter(row=>row.phase==='cutoff-bracket');assert.equal(brackets.length,1);
 assert.equal(brackets[0].actor,'occupied');assert.equal(brackets[0].kind,'fixture-body');assert.equal(brackets[0].participantCredit,false);assert.equal(brackets[0].requestedAt,result.cutoffAt);
 assert.equal(f.samples.filter(row=>row.soul==='s_occupied').at(-1).aborted,false,'independent bounded signal survives trial abort');
 assert(f.rows().filter(row=>row.kind==='body').every(row=>row.requestedAt<result.cutoffAt));
});

test('a slow fixture cannot hold fast participant observers behind a shared batch',async t=>{
 const f=fixture(t,{seconds:4,fixtureActors:[{id:'occupied',folder:'/test/occupied'}]}),normal=f.deps.createWorld,counts=new Map(),active=new Map(),maxActive=new Map();
 f.deps.createWorld=paired=>{const client=normal(paired);return {async read(command,args,signal){
  const id=paired.soul,n=(counts.get(id)??0)+1;counts.set(id,n);active.set(id,(active.get(id)??0)+1);maxActive.set(id,Math.max(maxActive.get(id)??0,active.get(id)));
  try{if(id==='s_occupied'&&n===2)await f.clock.sleep(2500,signal);return await client.read(command,args,signal);}finally{active.set(id,active.get(id)-1);}
 }};};
 const pending=runContinuityTrial(f.config,f.deps);await f.clock.tick(2000);
 for(const actor of ['a','b'])assert.deepEqual(f.rows().filter(r=>r.kind==='body'&&r.actor===actor).map(r=>r.requestedAt),[100000,101000,102000]);
 assert.equal(f.rows().filter(r=>r.kind==='fixture-body').length,0,'the actual fixture response remains pending');
 await f.clock.tick(2000);const result=await pending;
 assert.equal(result.cutoffAt,104000);assert.equal(result.endedAt,104000);assert([...maxActive.values()].every(n=>n===1));assert([...active.values()].every(n=>n===0));
 assert.equal(f.rows().find(r=>r.kind==='fixture-body'&&r.phase===undefined).receivedAt,102500,'no synthetic on-time fixture sample');
});

test('slow own observations remain nonoverlapping and retain gaps beyond the frozen two-second bound',async t=>{
 const f=fixture(t,{seconds:5}),normal=f.deps.createWorld,counts=new Map(),active=new Map(),maxActive=new Map();
 f.deps.createWorld=paired=>{const client=normal(paired);return {async read(command,args,signal){
  const id=paired.soul,n=(counts.get(id)??0)+1;counts.set(id,n);active.set(id,(active.get(id)??0)+1);maxActive.set(id,Math.max(maxActive.get(id)??0,active.get(id)));
  try{if(id==='s_a'&&n===3)await f.clock.sleep(2500,signal);return await client.read(command,args,signal);}finally{active.set(id,active.get(id)-1);}
 }};};
 const pending=runContinuityTrial(f.config,f.deps);await f.clock.tick(5000);const result=await pending;
 const a=f.rows().filter(r=>r.kind==='body'&&r.actor==='a'),b=f.rows().filter(r=>r.kind==='body'&&r.actor==='b');
 assert.deepEqual(a.slice(0,2).map(r=>[r.requestedAt,r.receivedAt]),[[100000,100000],[101000,103500]]);
 assert.equal(a[1].receivedAt-a[0].receivedAt,3500,'own unavailable interval stays visible instead of being normalized');
 assert.deepEqual(b.map(r=>r.receivedAt),[100000,101000,102000,103000,104000]);
 assert([...maxActive.values()].every(n=>n===1));assert([...active.values()].every(n=>n===0));assert.equal(result.endedAt,result.cutoffAt);
});

test('cutoff joins a cancelled fixture observation before its verification-only bracket',async t=>{
 const f=fixture(t,{fixtureActors:[{id:'occupied',folder:'/test/occupied'}]}),normal=f.deps.createWorld;let count=0,inflight=0,maxInflight=0,cancelledReadFinished=false,bracketAfterDrain=false;
 f.deps.createWorld=paired=>{const client=normal(paired);if(paired.soul!=='s_occupied')return client;return {async read(command,args,signal){
  count++;inflight++;maxInflight=Math.max(maxInflight,inflight);
  try{if(count===2){await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));cancelledReadFinished=true;}else if(count===3)bracketAfterDrain=cancelledReadFinished&&inflight===1;return await client.read(command,args,signal);}finally{inflight--;}
 }};};
 const pending=runContinuityTrial(f.config,f.deps);await f.clock.tick(3000);const result=await pending;
 assert.equal(maxInflight,1);assert.equal(inflight,0);assert.equal(bracketAfterDrain,true);assert.equal(result.endedAt,result.cutoffAt);
 const bracket=f.rows().find(r=>r.phase==='cutoff-bracket');assert.equal(bracket.participantCredit,false);assert.equal(bracket.requestedAt,result.cutoffAt);
});

test('late managed release keeps the original subsecond cutoff',async t=>{
 const f=fixture(t,{arm:CONTINUITY_ARMS[1],seconds:1,actors:[{id:'a',folder:'/test/a',instruction:'Late mission',releaseOffsetSec:0.75}]});
 const pending=runContinuityTrial(f.config,f.deps);await f.clock.tick(750);assert.equal(f.calls.length,1);assert.equal(f.calls[0].remainingSeconds,0.25);
 await f.clock.tick(250);const result=await pending;assert.equal(result.endedAt,result.cutoffAt);assert.equal(f.calls[0].signal.aborted,true);
});

test('cancellation stops the existing arm without manufacturing restart coverage',async t=>{
 const f=fixture(t,{arm:CONTINUITY_ARMS[1],seconds:10});const stop=new AbortController();
 const pending=runContinuityTrial({...f.config,signal:stop.signal},f.deps);await flush();await f.clock.tick(1000);stop.abort();await flush();const result=await pending;
 assert.equal(result.endReason,'cancelled');assert.equal(f.calls.length,2);assert.equal(result.coverage.restart,'unknown');
 assert(f.lifecycle.filter(row=>row[0]==='complete').every(row=>row[2].outcome==='cancelled'));
});

test('R400 inputs are hash-verified before any baseline seat is created',t=>{
 const f=fixture(t);const folder=join(f.root,'wrong-baseline');mkdirSync(folder);writeFileSync(join(folder,'eden.mjs'),'current or corrupt CLI');writeFileSync(join(folder,'skill.md'),'current skill');
 assert.throws(()=>prepareR400Seat(folder,join(f.root,'copied-seat')),{code:'R400_ARTIFACT_MISMATCH'});
});

test('baseline closure independently verifies every exec and metadata group, including denied checks',()=>{
 const result={ownedProcessesExited:true,execProof:{pid:123,groupClosed:true,groupVerification:'absent'},metadataGroups:[{hostPid:124,groupClosed:true,groupVerification:'absent'}]};
 const observed=[];assert.equal(verifyBaselineTrialExit(result,pid=>{observed.push(pid);throw Object.assign(Error(),{code:'ESRCH'});}),true);assert.deepEqual(observed,[-123,-124]);
 assert.equal(verifyBaselineTrialExit(result,()=>{throw Object.assign(Error(),{code:'EPERM'});}),false);
 assert.equal(verifyBaselineTrialExit({...result,metadataGroups:[{hostPid:124,groupClosed:false,groupVerification:'unverified'}]},()=>{throw Object.assign(Error(),{code:'ESRCH'});}),false);
});

test('managed adapter uses existing launch, private evidence and exact cleanup manifests',async t=>{
 const f=fixture(t),directory=join(f.root,'managed');mkdirSync(directory);const stop=new AbortController(),states=[];
 const child=new EventEmitter();child.pid=221;child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>true;
 let spawned;
 const pending=runManagedTrialActor({folder:'/paired/current',directory,text:'entire mission',model:'declared-model',effort:'high',remainingSeconds:0.25,name:'Readable trial',signal:stop.signal,onState:row=>states.push(row)},{spawnProcess:(command,args,options)=>{spawned={command,args,options};return child;}});
 child.stdout.write(JSON.stringify({state:'controller-started',pid:222})+'\n');
 child.stdout.write(JSON.stringify({state:'session-created',controllerPid:222,threadId:'t1',hostPid:223})+'\n');
 child.stdout.write(JSON.stringify({state:'controller-closed',controllerPid:222,ownedProcessesExited:true,ownedHosts:[{hostPid:223,threadId:'t1',groupClosed:true,groupVerification:'absent'}]})+'\n');
 child.emit('exit',0,null);child.emit('close',0,null);const result=await pending;
 assert(spawned.args[0].endsWith('/soul-runtime/launch.mjs'));assert.equal(spawned.args[spawned.args.indexOf('--seconds')+1],'1');assert.equal(result.localSeconds,1);assert(spawned.args.includes('--evidence'));
 assert.equal(readFileSync(join(directory,'instruction.txt'),'utf8'),'entire mission');assert.equal(result.controllers[0].closed.ownedProcessesExited,true);
 assert(states.some(row=>row.state==='session-recovered'&&row.threadId==='t1'));assert.equal(result.actualEffort,null);
});

test('managed leader exit with an inherited pipe but no close drains within a bound and retains unknown cleanup',async t=>{
 const f=fixture(t),directory=join(f.root,'escaped-pipe');mkdirSync(directory);const stop=new AbortController(),signals=[];
 const child=new EventEmitter();child.pid=321;child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=signal=>{signals.push(signal);return true;};
 const pending=runManagedTrialActor({folder:'/paired/current',directory,text:'mission',model:'declared-model',effort:'high',remainingSeconds:10,name:'Readable trial',signal:stop.signal},{spawnProcess:()=>child,drainMs:2,termGraceMs:2});
 child.stdout.write(JSON.stringify({state:'controller-started',pid:322})+'\n');
 child.stdout.write(JSON.stringify({state:'session-created',controllerPid:322,threadId:'retained-thread',hostPid:323})+'\n');
 child.emit('exit',0,null); // Escaped descendant retains both pipes; no close follows.
 const result=await pending;
 assert.equal(result.pipeDrainTimedOut,true);assert.equal(result.failureCode,'MANAGED_PIPE_DRAIN_TIMEOUT');assert.equal(result.evidenceComplete,false);
 assert.equal(child.stdout.destroyed,true);assert.equal(child.stderr.destroyed,true);assert.deepEqual(signals,[],'no PID guessed or signalled after leader exit');
 assert.equal(verifyOwnedProbeExit(result,()=>{throw Object.assign(Error(),{code:'ESRCH'});}),false);
});

test('managed abort also bounds a launcher which never reports exit or close',async t=>{
 const f=fixture(t),directory=join(f.root,'stuck-launcher');mkdirSync(directory);const stop=new AbortController(),signals=[];
 const child=new EventEmitter();child.pid=421;child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=signal=>{signals.push(signal);return true;};
 const pending=runManagedTrialActor({folder:'/paired/current',directory,text:'mission',model:'declared-model',effort:'high',remainingSeconds:10,name:'Readable trial',signal:stop.signal},{spawnProcess:()=>child,drainMs:2,termGraceMs:2});
 stop.abort();const result=await pending;
 assert.deepEqual(signals,['SIGTERM','SIGKILL']);assert.equal(result.exit,null);assert.equal(result.pipeDrainTimedOut,true);assert.equal(child.stdout.destroyed,true);
});

for(const arm of CONTINUITY_ARMS)test('clock templates freeze after setup and remain shared for late actor: '+arm,async t=>{
 const f=fixture(t,{arm,seconds:4,meetingOffsetSec:2,actors:[{id:'a',folder:'/test/a',instruction:'Meet {meetingUTC}; done {completionUTC}.'},{id:'b',folder:'/test/b',instruction:'Meet {meetingUTC}; done {completionUTC}.',releaseOffsetSec:1.5}]});
 const verify=f.deps.verifyWorld;f.deps.verifyWorld=async()=>{f.clock.time+=2000;return verify();};
 const pending=runContinuityTrial(f.config,f.deps);await flush();
 assert.equal(f.calls[0].text,'Meet 1970-01-01T00:01:44.000Z; done 1970-01-01T00:01:46.000Z.');
 await f.clock.tick(1500);assert.equal(f.calls[1].text,f.calls[0].text);
 await f.clock.tick(2500);await pending;
 const manifest=JSON.parse(readFileSync(join(f.config.directory,'run.json'),'utf8'));
 assert.equal(manifest.meetingAt,104000);assert.notEqual(manifest.actors[0].instructionTemplateSha256,manifest.actors[0].instructionSha256);
});
test('unbound meeting clock and invalid appointment fail before creating any run',t=>{
 const f=fixture(t);
 assert.throws(()=>validateContinuityTrial({...f.config,actors:[{...f.config.actors[0],instruction:'Meet {meetingUTC}'}]}),{code:'UNBOUND_INSTRUCTION_CLOCK'});
 for(const meetingOffsetSec of [-1,3,NaN])assert.throws(()=>validateContinuityTrial({...f.config,meetingOffsetSec}),{code:'INVALID_MEETING_OFFSET'});
});

test('prospective soaks require explicit finite observed usage limits',t=>{
 const f=fixture(t,{purpose:'soak',seconds:7200});
 assert.throws(()=>validateContinuityTrial(f.config),{code:'SOAK_USAGE_GUARD_REQUIRED'});
 assert.throws(()=>validateContinuityTrial({...f.config,usageGuard:{...usageLimits,aggregate:{totalTokens:null,outputTokens:10}}}),{code:'INVALID_USAGE_GUARD'});
 assert.doesNotThrow(()=>validateContinuityTrial({...f.config,usageGuard:usageLimits}));
});

for(const arm of CONTINUITY_ARMS)test('observed aggregate guard stops both owned actors and preserves cleanup: '+arm,async t=>{
 const f=fixture(t,{arm,seconds:10,usageGuard:{perActor:{totalTokens:1000,outputTokens:100},aggregate:{totalTokens:100,outputTokens:100}}});
 // Both body reads hang after setup. Usage still polls on its independent timer.
 let count=0;f.deps.createWorld=()=>({async read(command,args,signal){if(++count>2)await new Promise(r=>signal.addEventListener('abort',r,{once:true}));return {here:{view:'body',me:{pos:[0,0]}}};}});
 const pending=runContinuityTrial(f.config,f.deps);await flush();assert.equal(f.calls.length,2);
 await f.clock.tick(1000);const result=await pending;
 assert.equal(result.endReason,'usage-guard');assert.equal(result.failureCode,'USAGE_LIMIT_REACHED');assert.equal(result.endedAt,101000);assert(result.actors.every(a=>a.cleanupVerified));
 assert(f.calls.every(c=>c.signal.aborted));assert.equal(f.lifecycle.filter(x=>x[0]==='closed').length,2);assert.equal(f.lifecycle.filter(x=>x[0]==='complete').length,2);assert(f.lifecycle.filter(x=>x[0]==='complete').every(x=>x[2].outcome==='failed'));
 const persisted=JSON.parse(readFileSync(join(f.config.directory,'usage-guard.json'),'utf8'));assert.equal(persisted.aggregate.totalTokens,110);assert.equal(persisted.status,'limit-reached');assert.equal(persisted.possibleInFlightOvershoot,true);assert.equal(persisted.billing,'not measured');assert.equal(statSync(join(f.config.directory,'usage-guard.json')).mode&0o777,0o600);
 const manifest=JSON.parse(readFileSync(join(f.config.directory,'run.json'),'utf8'));assert.equal(manifest.usageGuard.kind,'observed-usage-guard');assert.deepEqual(manifest.usageGuard.limits,f.config.usageGuard);
});

test('unknown final tail remains a failed guard result after owned cleanup, without exposing raw content',async t=>{
 const f=fixture(t,{usageGuard:usageLimits});const normal=f.deps.launchBaseline;
 f.deps.launchBaseline=async args=>{const result=await normal(args);appendFileSync(join(args.directory,'stream.ndjson'),'{"SECRET_RAW_TAIL":');return result;};
 const pending=runContinuityTrial(f.config,f.deps);await f.clock.tick(3000);const result=await pending;
 assert.equal(result.failureCode,'USAGE_EVIDENCE_UNKNOWN');assert.equal(result.usageGuard.status,'unknown');assert(result.usageGuard.actors.every(a=>a.unknowns.includes('USAGE_TRUNCATED_TAIL')));assert(result.actors.every(a=>a.cleanupVerified));
 assert(!JSON.stringify(result.usageGuard).includes('SECRET_RAW_TAIL'));assert(f.lifecycle.filter(x=>x[0]==='complete').every(x=>x[2].outcome==='failed'));
});

test('an abort rejection cannot overwrite the guard stop reason or budget failure',async t=>{
 const f=fixture(t,{seconds:10,usageGuard:{perActor:{totalTokens:1000,outputTokens:100},aggregate:{totalTokens:100,outputTokens:100}}});
 f.deps.sleep=async(ms,signal)=>{await f.clock.sleep(ms,signal);if(signal.aborted)throw Object.assign(Error('synthetic abort'),{code:'ABORT_ERR'});};
 const pending=runContinuityTrial(f.config,f.deps);await f.clock.tick(1000);const result=await pending;
 assert.equal(result.endReason,'usage-guard');assert.equal(result.failureCode,'USAGE_LIMIT_REACHED');assert(result.actors.every(a=>a.cleanupVerified));
});

test('original cutoff cannot overwrite a prior guard stop while an observation drains',async t=>{
 const f=fixture(t,{seconds:2,usageGuard:{perActor:{totalTokens:1000,outputTokens:100},aggregate:{totalTokens:100,outputTokens:100}}});
 let count=0;f.deps.createWorld=()=>({async read(){if(++count>2)await f.clock.sleep(3000);return {here:{view:'body',me:{pos:[0,0]}}};}});
 const pending=runContinuityTrial(f.config,f.deps);await f.clock.tick(3000);const result=await pending;
 assert.equal(result.endReason,'usage-guard');assert.equal(result.failureCode,'USAGE_LIMIT_REACHED');assert.equal(result.usageGuard.trigger.at,101000);assert(f.calls.every(c=>c.signal.aborted));
});

// Even an apparently clean final close cannot disambiguate two launches that
// reused one PID. Keep their evidence and refuse automatic archival.
test('managed adapter preserves duplicate launch ambiguity instead of collapsing cleanup identity',async t=>{
 const f=fixture(t),directory=join(f.root,'reused-pid');mkdirSync(directory);
 const child=new EventEmitter();child.pid=521;child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>true;
 const pending=runManagedTrialActor({folder:'/paired/current',directory,text:'mission',model:'declared-model',effort:'low',remainingSeconds:10,name:'Readable trial',signal:new AbortController().signal},{spawnProcess:()=>child});
 for(const row of [{state:'controller-started',pid:522},{state:'controller-started',pid:522},{state:'controller-closed',controllerPid:522,ownedProcessesExited:true,ownedHosts:[]}])child.stdout.write(JSON.stringify(row)+'\n');
 child.emit('exit',0,null);child.emit('close',0,null);const result=await pending;
 assert.equal(result.controllers[0].identityAmbiguous,true);
 assert.equal(verifyOwnedProbeExit(result,()=>{throw Object.assign(Error(),{code:'ESRCH'});}),false);
});


test('restart scope and runId are explicit prospective configuration',t=>{
 const f=fixture(t),restart={actorId:'a',setupId:'declared-setup'};
 assert.doesNotThrow(()=>validateContinuityTrial({...f.config,restart,runId:'explicit-run'}));
 for(const change of [{restart:null},{restart:{...restart,actorId:'missing'}},{restart:{...restart,minimumFutureWakeMs:1}},{restart:{...restart,setupId:''}},{runId:''},{runId:'x'.repeat(101)},{restart,seconds:3.00001}])assert.throws(()=>validateContinuityTrial({...f.config,...change}));
});

test('baseline restart declaration records unsupported/unexercised without another launch or assistance',async t=>{
 const f=fixture(t,{restart:{actorId:'a',setupId:'declared-setup'},runId:'explicit-run'});
 f.deps.restart={killProcess(){assert.fail('baseline never dispatches a death');},inspectProcess(){assert.fail('baseline never inventories managed ownership');}};
 const pending=runContinuityTrial(f.config,f.deps);await f.clock.tick(3000);const result=await pending;
 assert.equal(f.calls.length,2);assert.equal(result.coverage.restart,'unsupported');assert.equal(result.restart.supported,false);assert.equal(result.restart.triggerExercised,false);assert.equal(result.restart.assistedResume,false);assert.equal(result.failureCode,null);
 const manifest=JSON.parse(readFileSync(join(f.config.directory,'run.json'),'utf8'));assert.equal(manifest.runId,'explicit-run');assert.equal(manifest.restartCoverage.minimumFutureWakeMs,20000);assert.equal(manifest.restartCoverage.recoveryMaxMs,25000);assert.equal(manifest.restartCoverage.triggerMaxDelayMs,5000);
 assert.equal(JSON.parse(readFileSync(join(f.config.directory,'restart-proof.json'),'utf8')).triggerExercised,false);
});

function managedRestartFixture(t,{eligible=true,omitOwner=false,missingEvidence=false,unknownInventory=false,slowObservation=false,missingLaterClose=false,wrongEvidenceScope=false,priorHostRestart=false,priorHostUnverified=false,reusedHostPid=false,turnDuringInspection=false,...overrides}={}){
 const f=fixture(t,{arm:CONTINUITY_ARMS[1],seconds:40,actors:[{id:'a',folder:'/synthetic/a',instruction:'Retain original strategic task'}],restart:{actorId:'a',setupId:'frozen-setup'},...overrides});
 const sha=s=>createHash('sha256').update(s).digest('hex'),processes=new Map(),signals=[];let current,child,args,activeController=1001,activeHost=1100,controllerInspections=0;
 const identity=(pid,ppid,pgid)=>({pid,ppid,pgid,startToken:'birth-'+pid});
 const add=(controller,host)=>{for(const p of [identity(controller,1000,900),identity(host,controller,host),identity(host+1,host,host)])processes.set(p.pid,p);};
 processes.set(1000,identity(1000,999,900));add(1001,1100);
 const emit=s=>child.stdout.write(JSON.stringify({at:f.clock.now(),worldId:'fresh-world',soulId:'s_a',...s})+'\n');
 const startup=(controller,host,resumed=false,sameController=false)=>{
  if(!sameController)emit({state:'controller-started',pid:controller});emit({state:'host-started',controllerPid:controller,hostPid:host});emit({state:'session-created',controllerPid:controller,hostPid:host,threadId:'thread-a',resumed});
  emit({state:'startup-reconciled',controllerPid:controller,generation:current.controller.generation,checkpointRevision:current.checkpoint.revision,threadId:'thread-a',initialInstructionSha256:sha(args.text),wakeAt:resumed?current.checkpoint.wakeAt:null,pendingDecision:false,unreconciledOperations:0,startupResponseId:current.startupResponseId});
  emit({state:'running',controllerPid:controller,threadId:'thread-a'});emit({state:'receiver-ready',controllerPid:controller,source:'world',successful:true});if(!resumed||!omitOwner)emit({state:'receiver-ready',controllerPid:controller,source:'owner',successful:true});
 };
 const kill=(target,signal)=>{
  const found=target>0?processes.has(target):[...processes.values()].some(p=>p.pgid===-target);
  if(!found)throw Object.assign(Error('absent'),{code:'ESRCH'});
  if(signal===0)return;
  signals.push({target,signal,at:f.clock.now()});assert.equal(signal,'SIGKILL');
  if(target>0){processes.delete(target);for(const p of processes.values())if(p.ppid===target)p.ppid=1;
   f.clock.schedule(()=>{activeController=2001;activeHost=2100;add(activeController,activeHost);current={...current,checkpoint:{...current.checkpoint,revision:current.checkpoint.revision+1,at:f.clock.now()},controller:{generation:current.controller.generation+1,ownerSha256:sha('owner-'+(current.controller.generation+1)),expiresAt:f.clock.now()+15000},startupResponseId:'startup-'+(current.controller.generation+1)};startup(activeController,activeHost,true);},1000);
  }else for(const [id,p]of processes)if(p.pgid===-target)processes.delete(id);
 };
 f.deps.restart={inspectProcess:pid=>{if(turnDuringInspection&&pid===1001&&++controllerInspections===3)appendFileSync(join(args.directory,'agent-evidence.jsonl'),JSON.stringify({kind:'host-event',method:'turn/started',controllerPid:1001,hostPid:activeHost,worldId:'fresh-world',soulId:'s_a',threadId:'thread-a',turnId:'urgent-new-turn',at:f.clock.now()})+'\n');return processes.has(pid)?structuredClone(processes.get(pid)):null;},inspectGroup:pgid=>{if(unknownInventory)throw Object.assign(Error('unknown'),{code:'RESTART_GROUP_INSPECTION_UNKNOWN'});return [...processes.values()].filter(p=>p.pgid===pgid).map(p=>structuredClone(p));},readSnapshot:()=>structuredClone(current),killProcess:kill};
 f.deps.verifyCandidate=result=>verifyOwnedProbeExit(result,kill);
 f.deps.launchCandidate=call=>{
  args=call;f.calls.push(call);child=new EventEmitter();child.pid=1000;child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=signal=>{assert.equal(signal,'SIGTERM');for(const [id,p]of processes)if(id===1000||id===activeController||p.pgid===activeHost)processes.delete(id);if(!missingLaterClose)emit({state:'controller-closed',controllerPid:activeController,ownedProcessesExited:true,ownedHosts:[{hostPid:activeHost,threadId:'thread-a',groupClosed:true,groupVerification:'absent'}]});child.emit('exit',0,null);child.emit('close',0,null);return true;};
  current={journalIdentity:sha('same-journal'),worldId:'fresh-world',soulId:'s_a',checkpoint:{revision:1,at:f.clock.now(),threadId:'thread-a',pendingDecision:false,wakeAt:new Date(f.clock.now()+(eligible?60000:10000)).toISOString(),lastCallType:'wait',lastDecisionId:'decision-1',initialInstructionSha256:sha(call.text),planSha256:sha('private plan')},controller:{generation:1,ownerSha256:sha('owner-1'),expiresAt:f.clock.now()+15000},operations:[],startupResponseId:'startup-1'};
  const result=runManagedTrialActor(call,{spawnProcess:()=>child,termGraceMs:2,drainMs:2});
  startup(activeController,activeHost);
  if(priorHostRestart){
   emit({state:'host-closed',controllerPid:activeController,hostPid:activeHost,threadId:'thread-a',groupClosed:!priorHostUnverified,groupVerification:priorHostUnverified?'unverified':'absent'});
   for(const [id,p]of processes)if(p.pgid===activeHost)processes.delete(id);
   activeHost=reusedHostPid?activeHost:1200;add(activeController,activeHost);
   current={...current,checkpoint:{...current.checkpoint,revision:2},controller:{generation:2,ownerSha256:sha('host-restart-owner'),expiresAt:f.clock.now()+15000},startupResponseId:'startup-host-restart'};
   startup(activeController,activeHost,true,true);
  }
  if(!missingEvidence)writeFileSync(join(call.directory,'agent-evidence.jsonl'),['turn/started','turn/completed'].map((method,i)=>JSON.stringify({kind:'host-event',method,controllerPid:1001,hostPid:activeHost,worldId:wrongEvidenceScope?'foreign-world':'fresh-world',soulId:'s_a',threadId:'thread-a',turnId:'turn-1',at:f.clock.now(),status:i?'completed':null})+'\n').join(''),{mode:0o600});
  return result;
 };
 if(slowObservation){let reads=0;f.deps.createWorld=()=>({async read(command,params,signal){if(++reads>1)await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));return {here:{view:'body',tick:reads,me:{pos:[0,0],actualActivity:null}}};}});}
 return {...f,signals,processes};
}

test('managed restart wires actual lifecycle, bounded evidence tail, exact ownership and original cutoff',async t=>{
 const f=managedRestartFixture(t,{slowObservation:true});const pending=runContinuityTrial(f.config,f.deps);await f.clock.tick(2000);
 assert.deepEqual(f.signals.map(s=>s.target),[1001,-1100]);assert(f.processes.has(1000),'observer never kills the launcher');
 await f.clock.tick(38000);const result=await pending;
 assert.equal(result.cutoffAt,140000);assert.equal(result.endedAt,140000);assert.equal(result.qualification,'not assessed');assert.equal(result.restart.state,'ready');assert.equal(result.restart.integration.status,'ready');assert.equal(result.restart.readyAt,102000);assert.equal(result.restart.deathAt,101000);assert.equal(result.restart.threadResumed,true);assert.equal(result.actors[0].cleanupVerified,true);
 assert.equal(f.calls.length,1,'only the existing launcher performs the automatic recovery');assert.equal(result.restart.contract.cutoffAt,result.cutoffAt);assert.equal(f.signals.length,2,'once-only dispatch even during a blocked passive read');
 const actor=JSON.parse(readFileSync(join(f.config.directory,'a','actor-result.json'),'utf8'));assert.equal(actor.controllers[0].closed,null);assert.equal(actor.controllers[0].restartOwnership.controller.startToken,'birth-1001');assert.equal(actor.controllers[1].closed.controllerPid,2001);assert.equal(actor.restartProofs.length,1);
 const raw=readFileSync(join(f.config.directory,'a','restart-proof.json'),'utf8');assert(!raw.includes('private plan'));assert(!raw.includes('Retain original strategic task'));assert(result.restart.hostTurns[0].lastTurn.evidence[0].includes('agent-evidence.jsonl:2'));assert.equal(statSync(join(f.config.directory,'a','restart-proof.json')).mode&0o777,0o600);
});

test('managed no-eligible-wait run remains unexercised without manufactured death or wake',async t=>{
 const f=managedRestartFixture(t,{eligible:false});const pending=runContinuityTrial(f.config,f.deps);await f.clock.tick(40000);const result=await pending;
 assert.deepEqual(f.signals,[]);assert.equal(result.restart.state,'unexercised');assert.equal(result.restart.triggerExercised,false);assert.equal(result.restart.integration.status,'unexercised');assert.equal(result.actors[0].cleanupVerified,true);assert.equal(f.calls.length,1);
});

for(const missing of ['owner readiness','host evidence','process inventory'])test('managed restart preserves explicit missing/unknown evidence: '+missing,async t=>{
 const f=managedRestartFixture(t,{omitOwner:missing==='owner readiness',missingEvidence:missing==='host evidence',unknownInventory:missing==='process inventory'});
 const pending=runContinuityTrial(f.config,f.deps);await f.clock.tick(40000);const result=await pending;
 assert.equal(result.endReason,'cutoff');assert.equal(result.endedAt,140000);assert.equal(result.qualification,'not assessed');assert.equal(result.actors[0].cleanupVerified,true);
 if(missing==='owner readiness'){assert.equal(result.restart.state,'fail');assert.equal(result.restart.failure.code,'RESTART_RECOVERY_TIMEOUT');assert.equal(result.restart.readyAt,null);assert.equal(f.signals.length,2);}
 else {assert.equal(result.restart.integration.status,'unknown');assert(result.restart.integration.failureCode);assert.deepEqual(f.signals,[]);}
});


test('restart eligibility never shifts the cutoff for a late release',async t=>{
 const f=managedRestartFixture(t,{actors:[{id:'a',folder:'/synthetic/a',instruction:'Retain original strategic task',releaseOffsetSec:20}]});
 const pending=runContinuityTrial(f.config,f.deps);await f.clock.tick(40000);const result=await pending;
 assert.equal(result.actors[0].releasedAt,120000);assert.equal(result.cutoffAt,140000);assert.equal(result.restart.contract.cutoffAt,140000);assert.equal(result.restart.state,'unexercised');assert.deepEqual(f.signals,[]);assert.equal(f.calls[0].remainingSeconds,20);
});

test('restart cannot credit host turns from another native world',async t=>{
 const f=managedRestartFixture(t,{wrongEvidenceScope:true});const pending=runContinuityTrial(f.config,f.deps);await f.clock.tick(40000);const result=await pending;
 assert.equal(result.restart.integration.status,'unknown');assert.equal(result.restart.integration.failureCode,'RESTART_HOST_TURN_UNKNOWN');assert.deepEqual(f.signals,[]);
});

test('intentional old-controller proof never fabricates replacement-controller normal closure',async t=>{
 const f=managedRestartFixture(t,{missingLaterClose:true});const pending=runContinuityTrial(f.config,f.deps);await f.clock.tick(40000);const result=await pending;
 assert.equal(result.restart.state,'ready');assert.equal(result.actors[0].cleanupVerified,false);assert.equal(result.failureCode,'OWNED_CLEANUP_UNVERIFIED');assert.equal(f.lifecycle.filter(e=>e[0]==='complete').length,0);
});


test('closed prior host before first poll does not close its controller or poison later dispatch/cleanup',async t=>{
 const f=managedRestartFixture(t,{priorHostRestart:true});const pending=runContinuityTrial(f.config,f.deps);await f.clock.tick(40000);const result=await pending;
 assert.deepEqual(f.signals.map(s=>s.target),[1001,-1200]);assert.equal(result.restart.state,'ready');assert.equal(result.actors[0].cleanupVerified,true);
 const actor=JSON.parse(readFileSync(join(f.config.directory,'a','actor-result.json'),'utf8')),old=actor.controllers[0];
 assert.deepEqual(old.hostPids,[1100,1200]);assert.equal(old.closed,null);assert.equal(old.closedHosts[0].hostPid,1100);assert.deepEqual(old.restartOwnership.groups.map(g=>g.pgid),[1200]);assert.equal(old.restartClosedHosts[0].hostPid,1100);assert.ok(old.restartClosedHosts[0].evidence.every(s=>s.includes('controller.ndjson:')));
});
for(const variation of [{priorHostUnverified:true},{reusedHostPid:true}])test('prior host lifecycle ambiguity remains unknown without dispatch: '+JSON.stringify(variation),async t=>{
 const f=managedRestartFixture(t,{priorHostRestart:true,...variation});const pending=runContinuityTrial(f.config,f.deps);await f.clock.tick(40000);const result=await pending;
 assert.equal(result.restart.integration.status,'unknown');assert.deepEqual(f.signals,[]);
});


test('fresh host-tail read after ps validation blocks dispatch when an urgent decision starts during inspection',async t=>{
 const f=managedRestartFixture(t,{turnDuringInspection:true});const pending=runContinuityTrial(f.config,f.deps);await f.clock.tick(40000);const result=await pending;
 assert.deepEqual(f.signals,[]);assert.equal(result.restart.state,'unknown');assert.equal(result.restart.failure.code,'RESTART_TRIGGER_CHANGED');assert.equal(result.restart.dispatchAttempted,false);assert.equal(result.restart.preDispatchObservation.hostTail.lines,3);assert.match(result.restart.preDispatchObservation.semantics,/not atomic/);assert.equal(result.actors[0].cleanupVerified,true);
});

 test('native capture brackets the same cutoff and finalizes after owned actors close',async t=>{
 const f=fixture(t,{runId:'native-1',nativeEvidence:{databasePath:'/owned/sim.db',captureDirectory:'/owned/capture'},fixtureActors:[{id:'occupant',folder:'/test/occupant'}]});let finished;
 f.deps.createNativeEvidence=(scope,deps)=>{assert.deepEqual(scope.soulIds,['s_a','s_b','s_occupant']);assert.equal(scope.runId,'native-1');return {start(){assert.equal(f.calls.length,0);return {first:{requestedAt:deps.now()},failure:null};},async finish(interval){finished=interval;assert(f.lifecycle.some(r=>r[0]==='closed'));assert.equal(deps.now(),103000);return {status:'unknown',failure:'CLOSE_FSYNC_FAILED',coverage:{status:'pass'}};}};};
 const pending=runContinuityTrial(f.config,f.deps);await f.clock.tick(3000);const result=await pending;
 assert.deepEqual(finished,{t0:100000,cutoffAt:103000});assert.equal(result.coverage.nativeSources,'unknown','wrapper failure outranks stale source coverage');assert.equal(result.cutoffAt,103000);assert.equal(result.qualification,'not assessed');
});
 test('native source preflight failure closes collector without launching models',async t=>{
 const f=fixture(t,{runId:'native-1',nativeEvidence:{databasePath:'/owned/sim.db',captureDirectory:'/owned/capture'}});let closed=false;
 f.deps.createNativeEvidence=()=>({start:()=>({failure:'CAPTURE_SCOPE_MISMATCH'}),async finish(x){assert.equal(x.t0,null);closed=true;return {status:'unknown',coverage:null};}});
 const r=await runContinuityTrial(f.config,f.deps);assert.equal(r.failureCode,'CAPTURE_SCOPE_MISMATCH');assert.equal(f.calls.length,0);assert.equal(closed,true);
 assert.throws(()=>validateContinuityTrial({...f.config,runId:undefined}),/INVALID_NATIVE_EVIDENCE_CONFIG/);
});

for(const mode of ['finish-rejected','result-write-refused'])test('native finalization failure preserves unknown and still verifies/archives owned actors: '+mode,async t=>{
 const f=fixture(t,{runId:'native-failure',nativeEvidence:{databasePath:'/owned/sim.db',captureDirectory:'/owned/capture'}});let verified=0,finished=0;
 f.deps.verifyBaseline=()=>{verified++;return true;};
 f.deps.createNativeEvidence=()=>({start(){if(mode==='result-write-refused')writeFileSync(join(f.config.directory,'native-evidence.json'),'existing private artifact');return {failure:null};},async finish(){finished++;assert.equal(f.lifecycle.filter(r=>r[0]==='closed').length,2);if(mode==='finish-rejected')throw Object.assign(Error('SOURCE_DETAIL_MUST_NOT_ESCAPE'),{code:'NATIVE_FINAL_FAILED'});return {status:'pass',coverage:{status:'pass'}};}});
 const pending=runContinuityTrial(f.config,f.deps);await f.clock.tick(3000);const result=await pending;
 assert.equal(finished,1);assert.equal(verified,2);assert.equal(result.failureCode,'NATIVE_EVIDENCE_FINALIZATION_FAILED');assert.equal(result.nativeEvidence.status,'unknown');assert.equal(result.nativeEvidence.coverage,null);assert.equal(result.coverage.nativeSources,'unknown');assert.equal(result.cutoffAt,103000);assert.equal(result.endReason,'cutoff');assert.equal(result.qualification,'not assessed');assert.equal(f.lifecycle.filter(r=>r[0]==='complete').length,2);assert.ok(f.lifecycle.some(r=>r[0]==='archive'));assert.ok(result.actors.every(r=>r.cleanupVerified));assert.ok(!JSON.stringify(result).includes('SOURCE_DETAIL_MUST_NOT_ESCAPE'));
 if(mode==='result-write-refused')assert.equal(readFileSync(join(f.config.directory,'native-evidence.json'),'utf8'),'existing private artifact','do not overwrite prior evidence to hide the write error');
});


test('physical sampler requires explicit native body projection and never silently accepts rich fallback',async t=>{
 const f=fixture(t),normal=f.deps.createWorld;
 f.deps.createWorld=paired=>{const client=normal(paired);return {async read(command,args,signal){const result=await client.read(command,args,signal);delete result.here.view;return result;}};};
 const result=await runContinuityTrial(f.config,f.deps);assert.equal(result.failureCode,'BODY_PROJECTION_UNVERIFIED');assert.equal(result.startedAt,null);
 assert.equal(f.calls.length,0,'an old or ignored query fails mechanical setup before any actor launch');
 assert.equal(f.rows().filter(r=>['setup-body','body','fixture-body'].includes(r.kind)).length,0);
});

for(const outcome of ['acknowledged','read-refused','metadata-close-unverified','metadata-setup-threw'])test('archival postcondition is separate from behavioral qualification: '+outcome,async t=>{
 const f=fixture(t),rows=['thread-a','thread-b'].map(threadId=>({threadId,archived:outcome!=='read-refused',metadataHostCloseProof:{hostPid:900,groupClosed:outcome!=='metadata-close-unverified',groupVerification:outcome==='metadata-close-unverified'?'unverified':'absent'}}));
 f.deps.registryFactory=()=>({register(){},complete(){},async archiveCompleted(){if(outcome==='metadata-setup-threw')throw Error('metadata setup failure');return rows;}});
 const pending=runContinuityTrial(f.config,f.deps);await f.clock.tick(3000);const result=await pending;
 assert.equal(result.failureCode,null);assert.equal(result.qualification,'not assessed');assert.equal(result.endReason,'cutoff');assert.equal(result.archival.status,outcome==='acknowledged'?'acknowledged':'incomplete');assert.equal(result.archival.sidebarVerification,'not-checked');
 const stored=JSON.parse(readFileSync(join(f.config.directory,'summary.json'),'utf8'));assert.deepEqual(stored.archival,result.archival);assert.equal(stored.failureCode,null);assert.deepEqual(JSON.parse(readFileSync(join(f.config.directory,'archive-results.json'),'utf8')),outcome==='metadata-setup-threw'?[]:rows);
});


test('ephemeral is an explicit no-restart baseline-only configuration',()=>{
 const good={directory:'/unused',arm:CONTINUITY_ARMS[0],purpose:'short',seconds:3,model:'chosen',effort:'low',worldId:'w',actors:[{id:'a',folder:'/unused/a',instruction:'mission'}]};
 assert.equal(validateContinuityTrial({...good,baselineEphemeral:true}).baselineEphemeral,true);
 for(const change of [{baselineEphemeral:'true'},{baselineEphemeral:true,arm:CONTINUITY_ARMS[1]},{baselineEphemeral:true,restart:{actorId:'a',setupId:'setup'}}])assert.throws(()=>validateContinuityTrial({...good,...change}),{code:'INVALID_BASELINE_EPHEMERAL_CONFIG'});
 assert.doesNotThrow(()=>validateContinuityTrial({...good,restart:{actorId:'a',setupId:'setup'}}));
});

test('ephemeral common trial registers exact mode, completes cleanup, skips metadata/archive and preserves passive lifetime',async t=>{
 const f=fixture(t,{baselineEphemeral:true});let registry,helpers=0;
 f.deps.registryFactory=directory=>(registry=probeSessions(directory,{createHost:()=>{helpers++;assert.fail('ephemeral has no metadata/archive helper');}}));
 f.deps.launchBaseline=async args=>{
  f.calls.push(args);assert.equal(args.ephemeral,true);
  const id=args.cwd.includes('/a/')?'a':'b',threadId='temporary-'+id;
  args.onState({state:'thread-created',threadId,cwd:args.cwd,ephemeral:true,resumed:false,name:args.name});
  assert.equal(registry.snapshot().sessions.find(r=>r.threadId===threadId).ephemeral,true,'mode is durable in registry on first creation callback');
  await f.clock.sleep(3000,args.signal);
  return {ephemeral:true,exit:{code:0,signal:null},endedAt:f.clock.now(),ownedProcessesExited:true,evidenceComplete:true};
 };
 const pending=runContinuityTrial(f.config,f.deps);await f.clock.tick(3000);const result=await pending;
 assert.equal(result.failureCode,null);assert.equal(result.endReason,'cutoff');assert.equal(result.cutoffAt-result.startedAt,3000);assert.equal(f.calls.length,2);assert.equal(helpers,0);
 assert.equal(result.archival.status,'not-applicable');assert.deepEqual(result.archival.notApplicableThreadIds,['temporary-a','temporary-b']);assert.deepEqual(result.archival.acknowledgedThreadIds,[]);assert.equal(result.archival.sidebarVerification,'not-checked');assert.deepEqual(result.archived,[]);
 assert.ok(registry.snapshot().sessions.every(r=>r.ephemeral&&r.terminal&&!r.archivedAt));assert.ok(result.actors.every(r=>r.cleanupVerified&&r.ephemeralThreads.length===1));
 assert.equal(f.rows().filter(r=>r.kind==='body'&&r.actor==='a').length,3);
 const manifest=JSON.parse(readFileSync(join(f.config.directory,'run.json'),'utf8'));
 assert.equal(manifest.baselineEphemeral,true);
 assert.equal(manifest.actors[0].promptArgsSha256,createHash('sha256').update(JSON.stringify(buildContinuityBaselineArgs({ephemeral:true,model:f.config.model,effort:f.config.effort,text:f.calls[0].text}))).digest('hex'));
 assert.equal(JSON.parse(readFileSync(join(f.config.directory,'a','actor-result.json'),'utf8')).ephemeral,true);
 assert.equal(JSON.parse(readFileSync(join(f.config.directory,'summary.json'),'utf8')).archival.status,'not-applicable');
});

test('ephemeral does not exempt unverified process cleanup from failure',async t=>{
 const f=fixture(t,{baselineEphemeral:true});
 f.deps.launchBaseline=async args=>{args.onState({state:'thread-created',threadId:'temporary-'+(args.cwd.includes('/a/')?'a':'b'),cwd:args.cwd,ephemeral:true});return {ephemeral:true,exit:{code:0},ownedProcessesExited:false};};
 f.deps.verifyBaseline=()=>false;
 const pending=runContinuityTrial(f.config,f.deps);await f.clock.tick(3000);const result=await pending;
 assert.equal(result.failureCode,'OWNED_CLEANUP_UNVERIFIED');assert.ok(result.actors.every(r=>!r.cleanupVerified));assert.equal(f.lifecycle.filter(r=>r[0]==='complete').length,0);
});

test('requested ephemeral cannot hide a durable or missing-mode session from archive accounting',async t=>{
 const f=fixture(t,{baselineEphemeral:true});
 // The existing synthetic durable backend omits ephemeral, so it must not gain
 // an exemption just because the requested config said ephemeral.
 const pending=runContinuityTrial(f.config,f.deps);await f.clock.tick(3000);const result=await pending;
 assert.ok(f.lifecycle.filter(r=>r[0]==='register').every(r=>r[1].ephemeral===false));
 assert.ok(result.actors.every(r=>r.failureCode==='SESSION_PERSISTENCE_MODE_MISMATCH'&&r.ephemeralThreads.length===0));
 assert.equal(result.archival.status,'incomplete');assert.deepEqual(result.archival.failedThreadIds,['thread-a','thread-b']);
});


test('early timer resolution cannot release a late actor before its original absolute deadline',async t=>{
 const f=fixture(t,{seconds:4,actors:[{id:'a',folder:'/test/a',instruction:'A'},{id:'b',folder:'/test/b',instruction:'B',releaseOffsetSec:1.5}]});
 let early=true;const sleep=f.deps.sleep;
 f.deps.sleep=(ms,signal)=>{if(early&&ms===1500){early=false;return sleep(ms-9,signal);}return sleep(ms,signal);};
 const pending=runContinuityTrial(f.config,f.deps);await f.clock.tick(1491);
 assert.equal(f.calls.length,1,'the early wake is not authority to release B');
 await f.clock.tick(9);assert.equal(f.calls.length,2);assert.equal(f.calls[1].remainingSeconds,2.5);
 const release=f.rows().find(r=>r.kind==='actor-release'&&r.actor==='b');assert.equal(release.scheduledAt,101500);assert.equal(release.releasedAt,101500);
 await f.clock.tick(2500);const result=await pending;assert.equal(result.cutoffAt,104000);assert.equal(result.endReason,'cutoff');
});


test('cancellation during an early-release recheck cannot launch the delayed actor',async t=>{
 const stop=new AbortController(),f=fixture(t,{signal:stop.signal,seconds:4,actors:[{id:'a',folder:'/test/a',instruction:'A'},{id:'b',folder:'/test/b',instruction:'B',releaseOffsetSec:1.5}]});
 let early=true;const sleep=f.deps.sleep;f.deps.sleep=(ms,signal)=>{if(early&&ms===1500){early=false;return sleep(ms-9,signal);}return sleep(ms,signal);};
 const pending=runContinuityTrial(f.config,f.deps);await f.clock.tick(1491);assert.equal(f.calls.length,1);stop.abort();await flush();const result=await pending;
 assert.equal(f.calls.length,1);assert.ok(!f.rows().some(r=>r.kind==='actor-release'&&r.actor==='b'));assert.equal(result.cutoffAt,104000);
});

test('an early cutoff callback rearms against the original absolute deadline before abort or native finalization',async t=>{
 const f=fixture(t,{runId:'cutoff-early',nativeEvidence:{databasePath:'/owned/sim.db',captureDirectory:'/owned/capture'}});let early=true,finalizedAt=null;
 f.deps.schedule=(fn,ms)=>{if(early&&ms===3000){early=false;return f.clock.schedule(fn,ms-18);}return f.clock.schedule(fn,ms);};
 f.deps.createNativeEvidence=()=>({start:()=>({failure:null}),async finish({cutoffAt}){finalizedAt=f.clock.now();return finalizedAt>=cutoffAt?{status:'pass',coverage:{status:'pass'}}:{status:'unknown',coverage:null};}});
 const pending=runContinuityTrial(f.config,f.deps);await flush();assert.equal(f.calls.length,2);
 await f.clock.tick(2982);assert.equal(early,false);assert.ok(f.calls.every(c=>!c.signal.aborted),'an early timer wake cannot end the declared observation interval');assert.equal(finalizedAt,null);
 await f.clock.tick(17);assert.ok(f.calls.every(c=>!c.signal.aborted));assert.equal(finalizedAt,null);
 await f.clock.tick(1);const result=await pending;
 assert.equal(result.startedAt,100000);assert.equal(result.cutoffAt,103000);assert.equal(result.endedAt,result.cutoffAt);assert.equal(result.endReason,'cutoff');assert.equal(finalizedAt,result.cutoffAt);assert.equal(result.nativeEvidence.status,'pass');assert.equal(result.failureCode,null);assert.ok(f.calls.every(c=>c.remainingSeconds===3));
});

test('external cancellation during early cutoff rearm remains cancelled without extending actor deadlines',async t=>{
 const stop=new AbortController(),f=fixture(t,{signal:stop.signal});let early=true,callbacks=0;
 f.deps.schedule=(fn,ms)=>f.clock.schedule(()=>{callbacks++;fn();},early&&ms===3000?(early=false,ms-18):ms);
 const pending=runContinuityTrial(f.config,f.deps);await flush();await f.clock.tick(2982);assert.equal(callbacks,1);assert.ok(f.calls.every(c=>!c.signal.aborted));
 stop.abort();await flush();const result=await pending;assert.equal(result.endReason,'cancelled');assert.equal(result.endedAt,102982);assert.equal(result.cutoffAt,103000);assert.ok(f.calls.every(c=>c.remainingSeconds===3));
 await f.clock.tick(18);assert.equal(callbacks,1,'the pending rearm is cleared after external cancellation');assert.equal(result.endReason,'cancelled');
});

for(const existingFailure of [null,'CAPTURE_HEARTBEAT_GAP'])test('requested native coverage unknown returns a nonclean result and preserves prior failure: '+existingFailure,async t=>{
 const f=fixture(t,{runId:'native-unknown',nativeEvidence:{databasePath:'/owned/sim.db',captureDirectory:'/owned/capture'}});
 f.deps.createNativeEvidence=(scope,deps)=>({start:()=>({failure:null}),async finish(){if(existingFailure)deps.onFailure(existingFailure);return {status:'unknown',coverage:null,failure:null};}});
 const pending=runContinuityTrial(f.config,f.deps);await flush();await f.clock.tick(3000);const result=await pending;
 assert.equal(result.failureCode,existingFailure??'NATIVE_SOURCE_COVERAGE_UNKNOWN');assert.equal(result.coverage.nativeSources,'unknown');assert.deepEqual(result.nativeEvidence,{status:'unknown',coverage:null,failure:null});assert.equal(result.qualification,'not assessed');
 assert.ok(result.actors.every(a=>a.cleanupVerified&&a.exit.code===0&&a.failureCode===null),'clean actor exits remain actual facts, not proof of native coverage');assert.ok(f.lifecycle.filter(r=>r[0]==='complete').every(r=>r[2].outcome==='failed'));
});
