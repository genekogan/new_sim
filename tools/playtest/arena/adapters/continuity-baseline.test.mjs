import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {mkdtempSync,mkdirSync,readFileSync,statSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runContinuityBaseline,nameBaselineThread} from './continuity-baseline.mjs';
import {buildArgs,COMMAND_DISCIPLINE} from './codex-headless.mjs';

const line=e=>`process.stdout.write(${JSON.stringify(JSON.stringify(e)+'\n')});`;
const gone=pid=>{try{process.kill(-pid,0);return false;}catch(e){return e.code==='ESRCH';}};
function fixture(t){
 const root=mkdtempSync(join(tmpdir(),'continuity-baseline-')),cwd=join(root,'seat'),directory=join(root,'evidence'),children=[];mkdirSync(cwd,{mode:0o700});
 t.after(()=>{for(const child of children)try{process.kill(-child.pid,'SIGKILL');}catch{}rmSync(root,{recursive:true,force:true});});
 const calls=[],states=[];
 const run=(script,options={},deps={})=>runContinuityBaseline({cwd,directory,text:'Meet at the declared UTC, then finish the original errand.',model:'requested-model',effort:'low',remainingSeconds:5,onState:s=>states.push(s),...options},{command:process.execPath,commandArgs:['-e',script,'--'],termGraceMs:30,...deps,spawnProcess:(command,args,opts)=>{calls.push({command,args,opts});const child=spawn(command,args,opts);children.push(child);return child;}});
 return {root,cwd,directory,calls,states,children,run,rows:()=>readFileSync(join(directory,'stream.ndjson'),'utf8').trim().split('\n').map(JSON.parse)};
}
function metadata(cwd,{nameError=null,readCwd=cwd,readId='thread-one',closeProof={hostPid:null,startFailed:true,groupClosed:true,groupVerification:'absent'},onRequest=()=>{}}={}){
 const calls=[];return {calls,host:{request:async(method,args)=>{
  calls.push({method,args});onRequest(method,args);
  if(method==='thread/read')return {thread:{id:readId,cwd:readCwd,status:{type:'active'}}};
  if(method==='thread/name/set'&&nameError)throw Object.assign(Error('SYNTHETIC_PRIVATE_ERROR_NOT_FOR_CALLBACK'),{code:nameError});return {};
 },send(message){calls.push(message);},async close(){calls.push({method:'close'});return closeProof;}}};
}

test('streams before completion, preserves existing args/full window and names the registered active thread administratively',async t=>{
 const f=fixture(t),named=[],callbacks=[],text='Full owner instruction with original deadlines.',script=
  line({type:'thread.started',thread_id:'thread-one'})+
  line({type:'session.metadata',model:'actual-model',reasoning_effort:'low'})+
  line({type:'item.started',item:{id:'tool-one',type:'command_execution',command:'node eden.mjs here'}})+
  line({type:'item.completed',item:{id:'tool-one',type:'command_execution',command:'node eden.mjs here',aggregated_output:'SYNTHETIC_PRIVATE_TOOL_OUTPUT',exit_code:0}})+
  line({type:'item.completed',item:{id:'reply-one',type:'agent_message',text:'Done.'}})+
  line({type:'turn.completed',usage:{input_tokens:10,cached_input_tokens:3,output_tokens:2}})+
  'process.stderr.write("SYNTHETIC_PRIVATE_STDERR");setTimeout(()=>process.exit(0),100);';
 const result=await f.run(script,{text,remainingSeconds:3610,name:'Sim baseline — Reader',cliVersion:'codex-cli 0.synthetic',onState:s=>{
  callbacks.push(s);
  if(s.state==='thread-created'){
   assert.ok(f.rows().some(r=>r.type==='thread.started'),'event is durably streamed before registry callback');
   named.push(s.threadId);
  }
 }},{createMetadataHost:()=>metadata(f.cwd,{onRequest:method=>{if(method==='thread/name/set'){assert.deepEqual(named,['thread-one']);assert.equal(gone(f.children[0].pid),false,'name is set while exec is active');}}}).host});
 assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0].args.slice(3),buildArgs({resume:false,threadId:null,model:'requested-model',effort:'low',text}));
 assert.ok(f.calls[0].args.at(-1).startsWith(COMMAND_DISCIPLINE+'\n\n'+text));assert.equal(f.calls[0].opts.detached,true);
 assert.deepEqual(f.calls[0].opts.stdio,['ignore','pipe','pipe']);assert.equal(result.deadlineAt-result.startedAt,3610000);
 assert.equal(result.stopReason,'exited');assert.equal(result.exit.code,0);assert.equal(result.ownedProcessesExited,true);assert.equal(result.threadId,'thread-one');
 assert.equal(result.naming.status,'named');assert.equal(result.naming.attempts,1);assert.equal(result.actualModel,'actual-model');assert.equal(result.actualEffort,'low');
 assert.equal(result.cliVersion,'codex-cli 0.synthetic');assert.equal(result.usage.inputTokens,10);assert.equal(result.toolCalls.length,1);
 assert.ok(callbacks.some(s=>s.state==='tool-completed'&&s.commandSha256&&s.exitCode===0));
 assert.doesNotMatch(JSON.stringify(callbacks),/SYNTHETIC_PRIVATE|node eden\.mjs/);
 assert.equal(result.stderrRetainedBytes,0);assert.ok(result.stderrBytes>0);
 assert.equal(statSync(f.directory).mode&0o777,0o700);assert.equal(statSync(join(f.directory,'stream.ndjson')).mode&0o777,0o600);
});

test('cutoff terminates the exact group including a TERM-resistant child; no automatic resume',async t=>{
 const f=fixture(t),script=line({type:'thread.started',thread_id:'thread-one'})+
  'const {spawn}=require("node:child_process");const c=spawn(process.execPath,["-e",'+JSON.stringify('process.on("SIGTERM",()=>{});setInterval(()=>{},1000)')+'],{stdio:"ignore"});'+
  'process.stdout.write(JSON.stringify({type:"synthetic.child",pid:c.pid})+String.fromCharCode(10));process.on("SIGTERM",()=>{});setInterval(()=>{},1000);';
 const result=await f.run(script,{remainingSeconds:.3});
 assert.equal(result.stopReason,'cutoff');assert.equal(f.calls.length,1);assert.equal(result.ownedProcessesExited,true);assert.equal(gone(result.pid),true);
 assert.ok(f.rows().some(r=>r.type==='synthetic.child'));assert.equal(result.actualEffort,null,'requested effort alone is not verification');
 assert.equal(result.deadlineAt-result.startedAt,300,'inference cutoff is unchanged by cleanup grace');
 assert.ok(result.endedAt-result.startedAt<6500,'cutoff plus bounded post-kill cleanup');
});

test('a normally exited leader still cleans an inherited child group',async t=>{
 const f=fixture(t),script=line({type:'thread.started',thread_id:'thread-one'})+
  'require("node:child_process").spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"}).unref();process.exit(0);';
 const result=await f.run(script);
 assert.equal(result.stopReason,'exited');assert.equal(result.exit.code,0);assert.equal(result.ownedProcessesExited,true);assert.equal(gone(result.pid),true);
});

test('abort closes a running group; pre-abort never starts a child',async t=>{
 const f=fixture(t),stop=new AbortController();
 const result=await f.run(line({type:'thread.started',thread_id:'thread-one'})+'setInterval(()=>{},1000);',{signal:stop.signal,onState:s=>{if(s.state==='thread-created')stop.abort();}});
 assert.equal(result.stopReason,'aborted');assert.equal(result.ownedProcessesExited,true);
 const g=fixture(t),before=new AbortController();before.abort();
 const skipped=await g.run('',{signal:before.signal});assert.equal(g.calls.length,0);assert.equal(skipped.exit.notStarted,true);
});

test('stream limits and callback failures stop inference without exposing stderr or arbitrary errors',async t=>{
 for(const [script,options,deps,code]of [
  ['process.stdout.write("x".repeat(200));setInterval(()=>{},1000);',{}, {maxLineBytes:100},'STDOUT_LINE_LIMIT'],
  [line({type:'synthetic',value:'x'.repeat(200)}).repeat(4)+'setInterval(()=>{},1000);',{}, {maxStdoutBytes:500},'STDOUT_TOTAL_LIMIT'],
  [line({type:'thread.started',thread_id:'thread-one'})+'setInterval(()=>{},1000);',{onState:s=>{if(s.state==='thread-created')throw Error('SYNTHETIC_PRIVATE_CALLBACK');}}, {},'STATE_CALLBACK_FAILED'],
 ]){
  const f=fixture(t),result=await f.run(script,options,deps);assert.equal(result.failureCode,code);assert.equal(result.ownedProcessesExited,true);
  assert.doesNotMatch(JSON.stringify(result),/SYNTHETIC_PRIVATE_CALLBACK/);
 }
 const f=fixture(t),result=await f.run('process.stderr.write("x".repeat(1000));',{},{maxStderrBytes:10});
 assert.equal(result.stderrTruncated,true);assert.equal(result.stderrBytes,1000);assert.equal(result.stderrRetainedBytes,0);
});

test('executable failure records safe failure evidence and no nonexistent ownership',async t=>{
 const f=fixture(t),result=await f.run('',{},{command:'/nonexistent-continuity-codex',commandArgs:[]});
 assert.equal(result.stopReason,'start-failed');assert.equal(result.failureCode,'ENOENT');assert.equal(result.pid,null);assert.equal(result.execProof.groupClosed,true);
 assert.ok(f.rows().some(r=>r.type==='baseline.result'));assert.equal(result.threadObserved,false);
});

test('resume uses only the requested native thread; a different created thread is retained as failed identity evidence',async t=>{
 const f=fixture(t),result=await f.run(line({type:'thread.started',thread_id:'different-thread'})+'setInterval(()=>{},1000);',{resumeThreadId:'expected-thread'});
 assert.deepEqual(f.calls[0].args.slice(3,5),['exec','resume']);assert.equal(f.calls[0].args.at(-2),'expected-thread');
 assert.equal(f.calls.length,1);assert.equal(result.failureCode,'THREAD_ID_CHANGED');assert.equal(result.threadId,'different-thread');
 assert.ok(f.states.some(s=>s.state==='thread-created'&&s.threadId==='different-thread'));assert.equal(result.ownedProcessesExited,true);
});

test('metadata helpers check exact cwd, never start/resume inference and retry one naming refusal only after exec closes',async t=>{
 const f=fixture(t),wrong=metadata(f.cwd,{readCwd:f.root});
 const refused=await nameBaselineThread({threadId:'thread-one',cwd:f.cwd,name:'Sim baseline'},{createHost:()=>wrong.host});
 assert.equal(refused.status,'failed');assert.equal(refused.code,'THREAD_CWD_MISMATCH');
 assert.deepEqual(wrong.calls.map(c=>c.method),['initialize','initialized','thread/read','close']);
 const attempts=[];
 const result=await f.run(line({type:'thread.started',thread_id:'thread-one'})+'setTimeout(()=>process.exit(0),70);',{name:'Sim baseline'},{createMetadataHost:()=>{
  const attempt=metadata(f.cwd,{nameError:attempts.length===0?'SYNTHETIC_REFUSAL':null,onRequest:method=>{if(method==='thread/name/set'&&attempts.length===2)assert.equal(gone(f.children[0].pid),true);}});attempts.push(attempt);return attempt.host;
 }});
 assert.equal(result.naming.status,'named');assert.equal(result.naming.attempts,2);
 assert.deepEqual(attempts.map(a=>a.calls.map(c=>c.method)),Array(2).fill(['initialize','initialized','thread/read','thread/name/set','close']));
 assert.equal(f.states.filter(s=>s.state==='thread-name-failed').length,1);assert.doesNotMatch(JSON.stringify(f.states),/SYNTHETIC_PRIVATE_ERROR/);
});

test('uncertain exec or administrative group closure is never called verified',async t=>{
 const f=fixture(t),result=await f.run('',{},{killProcess:(pid,sig)=>{if(sig===0)throw Object.assign(Error('denied'),{code:'EPERM'});return process.kill(pid,sig);}});
 assert.equal(result.execProof.groupClosed,false);assert.equal(result.execProof.groupVerification,'unverified');assert.equal(result.ownedProcessesExited,false);
 const g=fixture(t),r=await g.run(line({type:'thread.started',thread_id:'thread-one'}),{name:'Sim baseline'},{createMetadataHost:()=>metadata(g.cwd,{closeProof:{hostPid:123,groupClosed:false,groupVerification:'unverified'}}).host});
 assert.equal(r.execProof.groupClosed,true);assert.equal(r.ownedProcessesExited,false);assert.equal(r.metadataGroups[0].groupClosed,false);
});

// In-memory process fixtures exercise reaping without Codex, inference or a
// real descendant. Leader exit zero is intentionally independent of the group.
function reapingFixture(t,killProcess){
 const f=fixture(t),child=new EventEmitter();child.pid=900005;
 for(const name of ['stdout','stderr']){child[name]=new EventEmitter();child[name].readableEnded=true;child[name].destroy=()=>{};}
 return {f,run:()=>runContinuityBaseline({cwd:f.cwd,directory:f.directory,text:'Synthetic cleanup only.',model:'synthetic-model',effort:'low',remainingSeconds:.01},
  {termGraceMs:1,killProcess,spawnProcess:()=>{queueMicrotask(()=>child.emit('exit',0,null));return child;}})};
}
test('default group verification accepts delayed post-kill reaping beyond the old one-second bound',async t=>{
 let killed=false,probes=0;const calls=[],p=reapingFixture(t,(pid,sig)=>{
  calls.push([pid,sig]);if(sig==='SIGKILL')killed=true;
  if(sig===0&&killed&&++probes===51)throw Object.assign(Error('reaped'),{code:'ESRCH'});
 });
 const result=await p.run();
 assert.equal(probes,51,'ESRCH appears only after 50 post-kill delays (1.25 seconds)');
 assert.equal(result.exit.code,0);assert.equal(result.execProof.groupClosed,true);assert.equal(result.execProof.groupVerification,'absent');assert.equal(result.ownedProcessesExited,true);
 assert.deepEqual(calls.filter(([,sig])=>sig!==0),[[-900005,'SIGTERM'],[-900005,'SIGKILL']]);assert.ok(calls.every(([pid])=>pid===-900005));
 assert.equal(result.stopReason,'exited');assert.equal(result.deadlineAt-result.startedAt,10,'cleanup does not extend the original inference deadline');
});
test('default five-second verification exhausts without certifying a surviving group',async t=>{
 let killed=false;const calls=[],p=reapingFixture(t,(pid,sig)=>{calls.push([pid,sig]);if(sig==='SIGKILL')killed=true;});
 t.mock.timers.enable({apis:['Date','setTimeout'],now:100000});
 const running=p.run();await new Promise(setImmediate);
 t.mock.timers.tick(1);await new Promise(setImmediate);assert.equal(killed,true);
 const verificationStartedAt=Date.now();
 for(let n=0;n<200;n++){t.mock.timers.tick(25);await new Promise(setImmediate);}
 const result=await running;
 assert.equal(result.endedAt-verificationStartedAt,5000);assert.equal(result.exit.code,0);assert.equal(result.execProof.groupClosed,false);assert.equal(result.execProof.groupVerification,'unverified');assert.equal(result.ownedProcessesExited,false);
 assert.deepEqual(calls.filter(([,sig])=>sig!==0),[[-900005,'SIGTERM'],[-900005,'SIGKILL']]);assert.equal(result.stopReason,'exited');assert.equal(result.deadlineAt-result.startedAt,10);
});

test('invalid or nonfresh options fail before a process and ephemeral is not silently substituted',async t=>{
 const f=fixture(t);
 for(const options of [{remainingSeconds:undefined},{remainingSeconds:0},{resumeThreadId:''},{ephemeral:true}])await assert.rejects(f.run('',options),{code:'INVALID_BASELINE_OPTIONS'});
 assert.equal(f.calls.length,0);mkdirSync(f.directory);
 await assert.rejects(f.run(''),{code:'EEXIST'});assert.equal(f.calls.length,0);
});
