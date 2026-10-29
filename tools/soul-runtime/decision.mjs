// Durable boundary between model decisions and public effects. Planning text is
// private agent state; only a world response/receipt proves an external effect.
import {randomUUID} from 'node:crypto';
export const DECISION_SCHEMA={type:'object',additionalProperties:false,required:['plan','call','wakeAt'],properties:{
 plan:{type:'string',description:'Compact durable task state: current goal and original constraints, completed receipt IDs, current step, suspended work, deadlines and next step. Do not claim unobserved completion.'},
 call:{type:'object',additionalProperties:false,required:['type','command','arguments'],properties:{type:{type:'string',enum:['read','write','wait']},command:{type:'string'},arguments:{type:'string',description:'A JSON object of arguments. For wait use {} for event-only or {seconds:N} for a relative wall-clock wakeup.'}}},
 wakeAt:{type:['string','null'],description:'ISO8601 wall-clock wakeup with timezone, or null to wait for messages or action results.'},
}};
const READS=new Set(['resync','here','observe','explore','resolve','receipt','conversations','turns','calendar','reminders','object']);
const WRITES=new Set(['act','say','converse','ack','result','remind','object']);
export function parseDecision(text,{now=Date.now}={}){
 const value=JSON.parse(text);
 if(!value||Object.keys(value).sort().join(',')!=='call,plan,wakeAt')throw Error('Decision fields differ from contract');
 if(typeof value.plan!=='string'||value.plan.length>16000)throw Error('Invalid durable plan');
 const call=value.call;if(!call||Object.keys(call).sort().join(',')!=='arguments,command,type')throw Error('Invalid call');
 if(typeof call.arguments!=='string'||call.arguments.length>16000)throw Error('Invalid call arguments');
 const args=JSON.parse(call.arguments);if(!args||typeof args!=='object'||Array.isArray(args))throw Error('Call arguments must be an object');
 if(call.type==='read'?!READS.has(call.command):call.type==='write'?!WRITES.has(call.command):call.type!=='wait')throw Error('Unsupported decision command');
 if(value.wakeAt!==null&&(typeof value.wakeAt!=='string'||!/(Z|[+-]\d{2}:\d{2})$/.test(value.wakeAt)||!Number.isFinite(Date.parse(value.wakeAt))))throw Error('Wakeup needs explicit wall clock/timezone');
 let wakeAt=value.wakeAt;
 if(call.type==='wait'&&args.seconds!==undefined){
  if(!Number.isFinite(args.seconds)||args.seconds<1||args.seconds>86400)throw Error('Relative wait must be1..86400 seconds');
  const relative=now()+Math.round(args.seconds*1000);wakeAt=new Date(wakeAt===null?relative:Math.min(relative,Date.parse(wakeAt))).toISOString();
 }
 return {...value,wakeAt,call:{type:call.type,command:call.command,args}};
}
export function retainDecision(journal,fence,decision,{events=[],threadId,initialInstruction}={}){
 const c=journal.control.checkpoint();if(c.value?.pendingDecision)throw Error('Previous decision must be reconciled first');
 const id=randomUUID();const pendingDecision={id,decision,eventIds:events.map(e=>({source:e.source,id:e.event.id})),retainedAt:Date.now()};
 journal.control.save(fence,c.revision,{...c.value,threadId:threadId??c.value?.threadId,initialInstruction:c.value?.initialInstruction??initialInstruction??null,plan:decision.plan,pendingDecision});
 return id;
}
export async function applyPendingDecision(journal,fence,world,{signal}={}){
 const c=journal.control.checkpoint(),pending=c.value?.pendingDecision;if(!pending)return {applied:false};
 journal.control.assertOwner(fence);
 const {id,decision}=pending,call=decision.call;let response=null;
 if(call.type==='read'){
  const gaps=call.command==='resync'?journal.gaps():[];
  response=await world.read(call.command,call.args,signal);
  if(call.command==='resync')for(const gap of gaps)journal.reconcileGap(gap.seq,'Current observation/conversations refreshed; past missing events remain incomplete. Decision '+id);
 }
 else if(call.type==='write'&&journal.gaps().length&&!journal.control.hasOperation(id)){
  response={accepted:false,error:{code:'continuity.resync-required',message:'World event history has a gap. Read resync before writing; retain uncertainty about missing history.'}};
 }
 else if(call.type==='write'){
  let op=journal.control.prepare(fence,id,call);
  if(op.status==='prepared'){
   journal.control.dispatch(fence,id);
   try{response=await world.write(call.command,call.args,id,signal);}
   catch(e){
    // Even a transport with incomplete error classification must not cause
    // automatic re-execution of a potentially accepted world command.
    if(e.uncertain===false && e.status>=400 && e.status<500){
     response={accepted:false,error:{code:e.code??'refused',message:e.message,status:e.status}};
    }else{
     journal.control.uncertain(fence,id);
     throw Object.assign(Error('World operation needs reconciliation'),{code:'OPERATION_UNCERTAIN',operationId:id,cause:e});
    }
   }
   journal.control.settle(fence,id,response);op=journal.control.operation(id);
  }
  if(op.status!=='settled'&&world.reconcile){
   const known=await world.reconcile(call,id,signal);
   if(known.state==='recorded'){
    const observed=known.status>=400?{accepted:false,error:known.response?.error??{code:'refused',status:known.status}}:known.response;
    journal.control.settle(fence,id,observed);op=journal.control.operation(id);
   }
  }
  if(op.status!=='settled')throw Object.assign(Error('Earlier operation needs reconciliation'),{code:'OPERATION_UNCERTAIN',operationId:id});
  response=op.response;
 }
 journal.control.assertOwner(fence);
 // Mark incorporation only after decision and result are durable. It is NOT
 // the public owner ack/result, and does not assert goal completion.
 for(const event of pending.eventIds)journal.handled(event.source,event.id,'incorporated:'+id);
 const latest=journal.control.checkpoint();
 if(latest.value?.pendingDecision?.id!==id)throw Error('Pending decision changed while applying');
 const receipt=response?.receipt??null;
 journal.control.save(fence,latest.revision,{...latest.value,pendingDecision:null,lastDecisionId:id,lastCall:call,lastResult:response,wakeAt:decision.wakeAt,lastReceipt:receipt??latest.value.lastReceipt??null});
 return {applied:true,id,call,response,wakeAt:decision.wakeAt};
}
