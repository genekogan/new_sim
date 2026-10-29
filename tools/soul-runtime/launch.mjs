#!/usr/bin/env node
// Small outer process owner: recover a killed controller, never restart explicit
// configuration/auth failures. Machine sleep/reboot is outside this process.
import {spawn} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {abortableSleep} from './receiver.mjs';
export async function superviseProcess({args=[],signal,seconds=null,onState=()=>{},spawnProcess=spawn,node=process.execPath,script=fileURLToPath(new URL('./run.mjs',import.meta.url)),maxDeaths=3}={}){
 if(seconds!==null&&(!Number.isFinite(seconds)||seconds<1||seconds>604800))throw Error('seconds must be1..604800');
 const stop=new AbortController(),abort=()=>stop.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
 const timer=seconds===null?null:setTimeout(abort,seconds*1000);let deaths=0,child;
 try{while(!stop.signal.aborted){
  const started=Date.now();child=spawnProcess(node,[script,...args],{stdio:'inherit'});
  let killTimer,hasExited=false;
  const completion=new Promise((resolve,reject)=>{child.once('error',e=>{hasExited=true;reject(e);});child.once('exit',(code,signal)=>{hasExited=true;resolve({code,signal});});});
  completion.catch(()=>{});
  const terminate=()=>{child.kill('SIGTERM');killTimer=setTimeout(()=>child.kill('SIGKILL'),10000);};
  stop.signal.addEventListener('abort',terminate,{once:true});
  if(stop.signal.aborted)terminate();
  let ended;
  try{onState({state:'controller-started',pid:child.pid});ended=await completion;}
  finally{if(!hasExited){terminate();await completion.catch(()=>{});}clearTimeout(killTimer);stop.signal.removeEventListener('abort',terminate);}
  if(stop.signal.aborted||ended.code===0)return;
  if(!ended.signal)throw Object.assign(Error('Controller exited with an explicit failure; state retained'),{code:'CONTROLLER_FAILED',exitCode:ended.code});
  if(Date.now()-started>=60000)deaths=0;
  if(++deaths>maxDeaths)throw Object.assign(Error('Controller repeatedly died; state retained'),{code:'CONTROLLER_DEATH_LIMIT'});
  onState({state:'controller-restarting',signal:ended.signal,attempt:deaths});
  await abortableSleep(1000*deaths,stop.signal);
 }}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
export async function main(argv=process.argv.slice(2)){
 const args=[...argv];let seconds=null;
 for(let i=0;i<args.length;i++){if(args[i]==='--seconds'){seconds=Number(args[i+1]);args.splice(i,2);i--;}else if(args[i].startsWith('--seconds=')){seconds=Number(args[i].slice(10));args.splice(i,1);i--;}}
 const stop=new AbortController(),quit=()=>stop.abort();process.once('SIGINT',quit);process.once('SIGTERM',quit);
 try{await superviseProcess({args,seconds,signal:stop.signal,onState:s=>console.log(JSON.stringify({at:new Date().toISOString(),...s}))});}
 finally{process.removeListener('SIGINT',quit);process.removeListener('SIGTERM',quit);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(e=>{console.error(JSON.stringify({state:'blocked',code:e.code??'launcher.failure',reason:e.message}));process.exitCode=1;});
