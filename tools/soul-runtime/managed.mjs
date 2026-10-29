// Restart only failures whose durable boundary is understood. No inference
// during backoff; pending effects are reconciled before a fresh model turn.
import {runSupervisor} from './supervisor.mjs';
import {abortableSleep} from './receiver.mjs';
const restartable=e=>e?.transient===true||['HOST_EXITED','HOST_REQUEST_TIMEOUT','HOST_INPUT_FAILED','OPERATION_UNCERTAIN'].includes(e?.code);
export async function runManaged({createHost,signal,onState=()=>{},sleep=abortableSleep,maxConsecutiveRestarts=8,...options}){
 let failures=0;
 while(!signal?.aborted){
  const host=createHost();let madeProgress=false;
  try{
   await runSupervisor({...options,host,signal,onState:s=>{if(s.state==='decision'){madeProgress=true;failures=0;}onState(s);}});
   return;
  }catch(error){
   if(signal?.aborted)return;
   if(!restartable(error)||++failures>maxConsecutiveRestarts){onState({state:'blocked',code:error.code??'runtime.failure',reason:error.message,pendingPreserved:true});throw error;}
   const delayMs=Math.min(30000,1000*2**Math.min(failures-1,5));
   onState({state:'recovering',code:error.code??'transport.failure',delayMs,attempt:failures,madeProgress,pendingPreserved:true});
   await sleep(delayMs,signal);
  }
 }
}
