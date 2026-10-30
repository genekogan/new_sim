// Restart only failures whose durable boundary is understood. No inference
// during backoff; pending effects are reconciled before a fresh model turn.
import {runSupervisor,urgentRecovery} from './supervisor.mjs';
import {abortableSleep} from './receiver.mjs';
const restartable=e=>e?.transient===true||['HOST_EXITED','HOST_REQUEST_TIMEOUT','HOST_INPUT_FAILED','OPERATION_UNCERTAIN'].includes(e?.code);
export async function runManaged({createHost,signal,onState=()=>{},sleep=abortableSleep,maxConsecutiveRestarts=8,...options}){
 let failures=0,consumedUrgentTicket=null;
 while(!signal?.aborted){
  const host=createHost();let madeProgress=false;
  try{
   await runSupervisor({...options,host,signal,onState:s=>{if(s.state==='decision'){madeProgress=true;failures=0;}onState(s);}});
   return;
  }catch(error){
   if(signal?.aborted)return;
   if(error.code==='HOST_URGENT_TURN_TIMEOUT'){
    const marker=urgentRecovery(options.journal.control.checkpoint().value),proof=host.closeProof;
    const matching=error.urgentFallbackGranted===true&&marker?.fallbackUsed===true&&marker.id===error.urgentRecoveryId&&marker.turnId===error.urgentTurnId&&error.urgentHostPid===(host.pid??null)&&consumedUrgentTicket!==marker.id;
    if(!matching||!Number.isSafeInteger(host.pid)||host.pid<=0||proof?.groupClosed!==true||proof.groupVerification!=='absent'||proof.hostPid!==host.pid||proof.threadId!==options.journal.control.checkpoint().value.threadId){
     const blocked=Object.assign(Error('Urgent recovery ticket or old host-group absence is unverified; task state retained'),{code:matching?'URGENT_RECOVERY_CLEANUP_UNVERIFIED':'URGENT_RECOVERY_TICKET_INVALID'});
     onState({state:'blocked',code:blocked.code,pendingPreserved:true});throw blocked;
    }
    consumedUrgentTicket=marker.id;
    onState({state:'recovering',code:error.code,urgentRecoveryId:marker.id,delayMs:0,pendingPreserved:true});
    continue;
   }
   if(!restartable(error)||++failures>maxConsecutiveRestarts){onState({state:'blocked',code:error.code??'runtime.failure',reason:error.message,pendingPreserved:true});throw error;}
   const delayMs=Math.min(30000,1000*2**Math.min(failures-1,5));
   onState({state:'recovering',code:error.code??'transport.failure',delayMs,attempt:failures,madeProgress,pendingPreserved:true});
   await sleep(delayMs,signal);
  }
 }
}
