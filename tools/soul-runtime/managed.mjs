// Restart only failures whose durable boundary is understood. No inference
// during backoff; pending effects are reconciled before a fresh model turn.
import {runSupervisor} from './supervisor.mjs';
import {decisionProgress,saveRecoveryCheckpoint} from './decision.mjs';
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
   if(['HOST_URGENT_TURN_TIMEOUT','HOST_DECISION_PROGRESS_TIMEOUT'].includes(error.code)){
    const marker=decisionProgress(options.journal.control.checkpoint().value),grant=marker?.grant,proof=host.closeProof;
    const matching=error.urgentFallbackGranted===true&&marker?.fallbackUsed===true&&marker.phase==='fallback-reserved'&&marker.id===error.progressRecoveryId&&grant?.id===error.urgentRecoveryId&&grant.turnId===error.urgentTurnId&&grant.hostPid===(host.pid??null)&&error.urgentHostPid===(host.pid??null)&&consumedUrgentTicket!==marker.id;
    if(!matching||!Number.isSafeInteger(host.pid)||host.pid<=0||proof?.groupClosed!==true||proof.groupVerification!=='absent'||proof.hostPid!==host.pid||proof.threadId!==options.journal.control.checkpoint().value.threadId){
     const prefix=error.code==='HOST_URGENT_TURN_TIMEOUT'?'URGENT_RECOVERY':'DECISION_PROGRESS';
     const blocked=Object.assign(Error('Active recovery ticket or old host-group absence is unverified; task state retained'),{code:matching?prefix+'_CLEANUP_UNVERIFIED':prefix+'_TICKET_INVALID'});
     onState({state:'blocked',code:blocked.code,pendingPreserved:true});throw blocked;
    }
    const fence=options.journal.control.claim();
    try{
     const c=options.journal.control.checkpoint(),current=decisionProgress(c.value);
     if(current?.id!==marker.id||current.phase!=='fallback-reserved'||current.window>=3)throw Object.assign(Error('Active recovery reservation changed'),{code:'DECISION_PROGRESS_STATE_INVALID'});
     saveRecoveryCheckpoint(options.journal,fence,c.revision,{...c.value,decisionProgressV1:{...current,phase:'ready',window:current.window+1,deadlineAt:Date.now()+(options.activeDecisionMs??30000),turnId:null,hostPid:null,grant:{...grant,oldGroupAbsent:true,threadId:proof.threadId}}});
    }finally{options.journal.control.release(fence);}
    consumedUrgentTicket=marker.id;
    onState({state:'recovering',code:error.code,urgentRecoveryId:marker.id,delayMs:0,pendingPreserved:true});
    continue;
   }
   const checkpoint=options.journal.control.checkpoint().value;
   if(decisionProgress(checkpoint)&&!checkpoint.pendingDecision&&restartable(error)){
    const blocked=Object.assign(Error('Active episode has no matching verified fallback grant'),{code:'DECISION_PROGRESS_RECOVERY_UNCONFIRMED'});onState({state:'blocked',code:blocked.code,pendingPreserved:true});throw blocked;
   }
   if(!restartable(error)||++failures>maxConsecutiveRestarts){onState({state:'blocked',code:error.code??'runtime.failure',reason:error.message,pendingPreserved:true});throw error;}
   const delayMs=Math.min(30000,1000*2**Math.min(failures-1,5));
   onState({state:'recovering',code:error.code??'transport.failure',delayMs,attempt:failures,madeProgress,pendingPreserved:true});
   await sleep(delayMs,signal);
  }
 }
}
