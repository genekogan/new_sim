import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,appendFileSync,statSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CONTINUITY_ARMS,validateContinuityTrial,prepareR400Seat,runContinuityTrial,runManagedTrialActor,verifyBaselineTrialExit} from './continuity-trial.mjs';
import {verifyOwnedProbeExit} from './probe-sessions.mjs';

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
 const deps={now:clock.now,sleep:clock.sleep,schedule:clock.schedule,cancelSchedule:clock.cancelSchedule,loadPairing:folder=>({world:'http://127.0.0.1:19999',soul:'s_'+folder.split('/').at(-1),token:'opaque-never-logged'}),createWorld:paired=>({async read(command,args,signal){assert.equal(command,'here');assert.deepEqual(args,{});samples.push({soul:paired.soul,at:clock.now(),aborted:signal.aborted});return {here:{tick:samples.length,me:{pos:{x:1,z:2},place:'p_native',activity:{kind:'read'},actualActivity:{kind:'walk'},posture:'stand',seat:null}}};}}),verifyWorld:async()=>({devAuth:true,worldId:'fresh-world'}),registryFactory:()=>registry,prepareBaseline:(folder,cwd)=>{mkdirSync(cwd);return {cwd,revision:'verified-test',artifacts:{}};},launchBaseline:launch,launchCandidate:launch,verifyBaseline:()=>true,verifyCandidate:()=>true};
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
 const native=f.rows().find(row=>row.kind==='body');assert.equal(native.me.activity.kind,'read');assert.equal(native.me.actualActivity.kind,'walk');
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
  return {here:{tick:observations,me:{pos:{x:0,z:0},actualActivity:null}}};
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
 let count=0;f.deps.createWorld=()=>({async read(command,args,signal){if(++count>2)await new Promise(r=>signal.addEventListener('abort',r,{once:true}));return {here:{me:{pos:[0,0]}}};}});
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
 let count=0;f.deps.createWorld=()=>({async read(){if(++count>2)await f.clock.sleep(3000);return {here:{me:{pos:[0,0]}}};}});
 const pending=runContinuityTrial(f.config,f.deps);await f.clock.tick(3000);const result=await pending;
 assert.equal(result.endReason,'usage-guard');assert.equal(result.failureCode,'USAGE_LIMIT_REACHED');assert.equal(result.usageGuard.trigger.at,101000);assert(f.calls.every(c=>c.signal.aborted));
});
