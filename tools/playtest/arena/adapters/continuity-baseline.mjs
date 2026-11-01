// Existing Codex exec workflow, with passive streaming evidence and owned-group
// cleanup. No listener, continuation prompt, task journal or automatic restart.
import {spawn} from 'node:child_process';
import {mkdirSync,openSync,writeSync,fsyncSync,closeSync,realpathSync,statSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {StringDecoder} from 'node:string_decoder';
import {buildArgs,parseLine,summarize} from './codex-headless.mjs';
import {CodexHost} from '../../../soul-runtime/codex-host.mjs';

const delay=ms=>new Promise(r=>setTimeout(r,ms));
const hash=s=>createHash('sha256').update(s).digest('hex');
const identifier=s=>typeof s==='string'&&/^[-a-zA-Z0-9_]{1,200}$/.test(s);
const label=s=>typeof s==='string'&&s.trim()&&s.length<=200&&!/[\u0000-\u001f\u007f]/.test(s);
const errorCode=e=>typeof e?.code==='string'&&/^[-A-Z0-9_]{1,80}$/i.test(e.code)?e.code:'UNKNOWN';
const fault=code=>Object.assign(Error(code),{code});
const closedGroup=p=>p?.groupClosed===true&&p?.groupVerification==='absent';

/** Administrative metadata only. Never connect(), start/resume a thread or turn.
 * Returned closure proof covers this helper's independently owned app-server. */
export async function nameBaselineThread({threadId,cwd,name},{createHost=options=>new CodexHost(options)}={}){
 if(!identifier(threadId)||!label(name)||typeof cwd!=='string')throw fault('INVALID_THREAD_METADATA');
 const expected=realpathSync(cwd);let host,result,proof;
 try{
  host=createHost({cwd:expected,requestTimeoutMs:3000});
  await host.request('initialize',{clientInfo:{name:'sim_continuity_baseline_metadata',version:'1'}});
  host.send({method:'initialized',params:{}});
  const read=await host.request('thread/read',{threadId,includeTurns:false});
  if(read?.thread?.id!==threadId||typeof read?.thread?.cwd!=='string'||realpathSync(read.thread.cwd)!==expected)throw fault('THREAD_CWD_MISMATCH');
  await host.request('thread/name/set',{threadId,name:name.trim()});
  result={status:'named',threadId};
 }catch(error){result={status:'failed',threadId,code:errorCode(error)};}
 finally{
  if(host)try{proof=await host.close();if(!proof)throw fault('MISSING_METADATA_CLOSE_PROOF');}catch{proof={hostPid:host.pid??null,groupClosed:false,groupVerification:'unverified'};}
 }
 return {...result,closeProof:proof??{hostPid:null,groupClosed:false,groupVerification:'unverified'}};
}

// Keep the shipped durable argv identical. Ephemeral is a prospective explicit
// initial-exec option, never a fallback or a resumable persistence mode.
export function buildContinuityBaselineArgs({ephemeral=false,...options}){
 if(typeof ephemeral!=='boolean'||ephemeral&&(options.resume||options.threadId))throw fault('INVALID_BASELINE_OPTIONS');
 const args=buildArgs(options);
 return ephemeral?[args[0],'--ephemeral',...args.slice(1)]:args;
}

/** One process, one complete owner instruction, one absolute remaining bound.
 * directory must be fresh; its files are private and may contain raw model/tool
 * output. Synchronous onState receives bounded identifiers/counts/hashes, never text,
 * commands, command output, arbitrary stderr or exception messages.
 * cliVersion is an externally observed preflight fact, not inferred from model.
 * Explicit resume uses the existing exec resume path; no fresh-thread fallback.
 */
export async function runContinuityBaseline({cwd,directory,text,model,effort,remainingSeconds,resumeThreadId=null,name=null,cliVersion=null,prevCumulative=null,signal,onState=()=>{},ephemeral=false},
 {command='codex',commandArgs=[],spawnProcess=spawn,killProcess=process.kill,createMetadataHost,termGraceMs=1000,verifyMs=5000,maxLineBytes=1024*1024,maxStdoutBytes=64*1024*1024,maxStderrBytes=64*1024}={}){
 if(typeof cwd!=='string'||typeof directory!=='string'||typeof text!=='string'||!text.trim()||text.length>64000||!label(model)||!label(effort)||!Number.isFinite(remainingSeconds)||remainingSeconds<=0||remainingSeconds>604800||resumeThreadId!==null&&!identifier(resumeThreadId)||name!==null&&!label(name)||cliVersion!==null&&!label(cliVersion)||typeof ephemeral!=='boolean'||ephemeral&&(resumeThreadId!==null||prevCumulative!==null)||typeof onState!=='function'||typeof command!=='string'||!command||!Array.isArray(commandArgs)||!commandArgs.every(a=>typeof a==='string'))throw fault('INVALID_BASELINE_OPTIONS');
 for(const n of [termGraceMs,verifyMs,maxLineBytes,maxStdoutBytes,maxStderrBytes])if(!Number.isFinite(n)||n<1)throw fault('INVALID_BASELINE_BOUNDS');
 const folder=realpathSync(cwd);if(!statSync(folder).isDirectory())throw fault('INVALID_BASELINE_CWD');
 const root=resolve(directory);mkdirSync(root,{mode:0o700});
 const fd=openSync(join(root,'stream.ndjson'),'wx',0o600),stream=[],metadataGroups=[];
 let child,pid=null,exit=null,threadId=resumeThreadId,threadObserved=false,stopReason=null,failureCode=null,stdoutBytes=0,stderrBytes=0,stderrTruncated=false,closed=false,timer,naming=null,nameResult=null,namingAttempts=0,actualModel=null,reportedEffort=null;
 const startedAt=Date.now(),deadlineAt=startedAt+remainingSeconds*1000;
 const record=row=>{const bytes=Buffer.from(JSON.stringify(row)+'\n');let offset=0;while(offset<bytes.length){const n=writeSync(fd,bytes,offset,bytes.length-offset);if(n<=0)throw fault('EVIDENCE_WRITE_FAILED');offset+=n;}fsyncSync(fd);};
 let finish;const terminal=new Promise(r=>finish=r);
 const stop=(reason,code=null)=>{stopReason??=reason;failureCode??=code;finish();};
 const emit=row=>{try{const pending=onState(row);if(pending&&typeof pending.then==='function'){Promise.resolve(pending).catch(()=>{});stop('evidence-error','ASYNC_STATE_CALLBACK_UNSUPPORTED');}}catch{stop('evidence-error','STATE_CALLBACK_FAILED');}};
 const evidence=row=>{try{record(row);return true;}catch{stop('evidence-error','EVIDENCE_WRITE_FAILED');return false;}};
 const notify=(state,data={})=>{const row={state,at:Date.now(),...data};evidence({type:'baseline.lifecycle',...row});emit(row);};
 const abort=()=>stop('aborted');
 const groupStatus=()=>{
  if(!pid)return exit?.startFailed?'absent':'unverified';
  try{killProcess(-pid,0);return 'alive';}catch(e){return e.code==='ESRCH'?'absent':'unverified';}
 };
 const signalGroup=sig=>{if(pid)try{killProcess(-pid,sig);}catch{}};
 const waitGroup=async ms=>{const until=Date.now()+ms;let state;do{state=groupStatus();if(state!=='alive')return state;await delay(Math.min(25,Math.max(1,until-Date.now())));}while(Date.now()<until);return groupStatus();};
 const nameThread=()=>{
  if(ephemeral||!name||!threadObserved)return null;
  const ownedThreadId=threadId;
  namingAttempts++;notify('thread-naming',{threadId:ownedThreadId,attempt:namingAttempts});
  return nameBaselineThread({threadId:ownedThreadId,cwd:folder,name},{...(createMetadataHost?{createHost:createMetadataHost}:{})}).then(result=>{
   nameResult=result;metadataGroups.push(result.closeProof);
   notify(result.status==='named'?'thread-named':'thread-name-failed',{threadId:ownedThreadId,attempt:namingAttempts,...(result.code?{code:result.code}:{})});return result;
  }).catch(error=>{nameResult={status:'failed',threadId:ownedThreadId,code:errorCode(error)};notify('thread-name-failed',{threadId:ownedThreadId,attempt:namingAttempts,code:nameResult.code});return nameResult;});
 };
 const event=line=>{
  if(Buffer.byteLength(line)>maxLineBytes){stop('output-limit','STDOUT_LINE_LIMIT');return;}
  const parsed=parseLine(line);if(!parsed)return;
  const e={...parsed,_rx:Date.now()};if(!evidence(e))return;stream.push(e);
  if(e.type==='thread.started'){
   if(!identifier(e.thread_id)){stop('protocol-error','INVALID_THREAD_ID');return;}
   const previous=threadId;threadId=e.thread_id;threadObserved=true;
   // The outer owner registers this identity synchronously before any naming RPC.
   notify('thread-created',{threadId,cwd:folder,resumed:resumeThreadId!==null,ephemeral,name});
   if(ephemeral){nameResult={status:'not-applicable',reason:'ephemeral',threadId};notify('thread-name-not-applicable',{threadId,ephemeral:true,name});}
   if(previous&&previous!==threadId){stop('protocol-error','THREAD_ID_CHANGED');return;}
   if(!naming&&!stopReason)naming=nameThread();
  }
  for(const [key,value]of [['model',e.model],['effort',e.reasoning_effort]])if(typeof value==='string'&&/^[-a-zA-Z0-9_.]{1,100}$/.test(value)){
   if(key==='model')actualModel=value;else reportedEffort=value;
   notify('host-metadata',{field:key,value,source:e.type});
  }
  if(['item.started','item.completed'].includes(e.type)&&e.item?.type==='command_execution'){
   const item=e.item;notify(e.type==='item.started'?'tool-started':'tool-completed',{itemId:identifier(item.id)?item.id:null,tool:'command_execution',commandSha256:typeof item.command==='string'?hash(item.command):null,...(Number.isInteger(item.exit_code)?{exitCode:item.exit_code}:{}),outputBytes:typeof item.aggregated_output==='string'?Buffer.byteLength(item.aggregated_output):0});
  }
 };
 const canRead=()=>!closed&&!['output-limit','evidence-error','protocol-error'].includes(stopReason);
 let execProof,result;
 try{
  record({type:'baseline.config',at:startedAt,cwd:folder,modelRequested:model,effortRequested:effort,actualEffort:null,cliVersion,cliVersionSource:cliVersion?'caller-preflight':null,remainingSeconds,deadlineAt,resumeThreadId,name,instructionSha256:hash(text),recoveryMechanism:ephemeral?'ephemeral single Codex exec; no persistence, resume or automatic restart':'native retained Codex exec thread; no Soul journal or automatic restart',ephemeral});
  record({type:'harness_user',text,_rx:startedAt});
  signal?.addEventListener('abort',abort,{once:true});
  if(signal?.aborted){exit={code:null,signal:null,startFailed:true,notStarted:true};stop('aborted');}
  else{
   const args=buildContinuityBaselineArgs({threadId:resumeThreadId,resume:resumeThreadId!==null,model,effort,text,ephemeral});
   try{
    child=spawnProcess(command,[...commandArgs,...args],{cwd:folder,stdio:['ignore','pipe','pipe'],detached:true});pid=Number.isInteger(child.pid)&&child.pid>1?child.pid:null;
    child.once('error',error=>{exit={code:null,signal:null,startFailed:true};stop('start-failed',errorCode(error));});
    child.once('exit',(code,sig)=>{exit={code,signal:sig};finish();});
    const decoder=new StringDecoder('utf8');let buffer='';
    child.stdout.on('data',chunk=>{
     if(!canRead())return;
     stdoutBytes+=chunk.length;if(stdoutBytes>maxStdoutBytes){stop('output-limit','STDOUT_TOTAL_LIMIT');return;}
     buffer+=decoder.write(chunk);let at;
     while((at=buffer.indexOf('\n'))>=0&&canRead()){const line=buffer.slice(0,at);buffer=buffer.slice(at+1);event(line);}
     if(Buffer.byteLength(buffer)>maxLineBytes)stop('output-limit','STDOUT_LINE_LIMIT');
    });
    child.stdout.once('end',()=>{if(canRead()){buffer+=decoder.end();if(buffer)event(buffer);buffer='';}});
    child.stderr.on('data',chunk=>{stderrBytes=Math.min(Number.MAX_SAFE_INTEGER,stderrBytes+chunk.length);if(stderrBytes>maxStderrBytes)stderrTruncated=true;});
    child.stdout.once('error',()=>stop('stream-error','STDOUT_ERROR'));
    child.stderr.once('error',()=>stop('stream-error','STDERR_ERROR'));
    notify('process-started',{pid,cwd:folder,deadlineAt});
    timer=setTimeout(()=>stop('cutoff'),Math.max(0,deadlineAt-Date.now()));
   }catch(error){exit={code:null,signal:null,startFailed:true};stop('start-failed',errorCode(error));}
  }
  await terminal;
 }catch(error){failureCode??=errorCode(error);stopReason??='evidence-error';}
 finally{
  clearTimeout(timer);signal?.removeEventListener('abort',abort);
  // Even a normally exited leader can leave children behind in its owned group.
  if(groupStatus()!=='absent'){signalGroup('SIGTERM');if(await waitGroup(termGraceMs)!=='absent')signalGroup('SIGKILL');}
  // Descendant reaping can lag SIGKILL/leader exit. This grace verifies cleanup
  // after teardown signals, without extending the inference deadline. Only
  // ESRCH certifies group absence.
  const groupVerification=await waitGroup(verifyMs);
  execProof={pid,cwd:folder,threadId,exit,groupClosed:groupVerification==='absent',groupVerification:groupVerification==='absent'?'absent':'unverified'};
  // Drain any remaining pipe data after group teardown without waiting forever
  // for an escaped descendant holding a descriptor open.
  if(child)await Promise.race([new Promise(r=>{if(child.stdout.readableEnded)r();else child.stdout.once('end',r);}),delay(50)]);
  closed=true;child?.stdout.destroy();child?.stderr.destroy();
  notify('process-exited',{pid,threadId,exit,stopReason,groupClosed:execProof.groupClosed,groupVerification:execProof.groupVerification});
  if(naming)await naming;
  if(nameResult?.status==='failed'&&failureCode!=='THREAD_ID_CHANGED'&&execProof.groupClosed&&metadataGroups.every(closedGroup))await nameThread();
  let summary;try{summary=summarize(stream,prevCumulative);}catch{failureCode??='STREAM_SUMMARY_FAILED';summary={usage:null,cumulative:prevCumulative,finalText:null,toolCalls:[]};}
  result={kind:'existing-headless-seat',cwd:folder,directory:root,pid,threadId,threadObserved,resumeThreadId,startedAt,endedAt:Date.now(),deadlineAt,stopReason:stopReason??'exited',failureCode,exit,modelRequested:model,effortRequested:effort,actualModel,actualEffort:reportedEffort,cliVersion,ephemeral,name,naming:nameResult?{status:nameResult.status,attempts:namingAttempts,...(nameResult.code?{code:nameResult.code}:{}),...(nameResult.reason?{reason:nameResult.reason}:{})}:null,execProof,metadataGroups,ownedProcessesExited:execProof.groupClosed&&metadataGroups.every(closedGroup),stdoutBytes,stderrBytes,stderrTruncated,stderrRetainedBytes:0,usage:summary.usage,cumulative:summary.cumulative,finalText:summary.finalText,toolCalls:summary.toolCalls};
  result.evidenceComplete=evidence({type:'baseline.result',...result,evidenceComplete:true});
  if(!result.evidenceComplete){result.failureCode=failureCode;result.stopReason='evidence-error';}
  closeSync(fd);
 }
 return result;
}
