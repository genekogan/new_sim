// Durable boundary between model decisions and public effects. Planning text is
// private agent state; only a world response/receipt proves an external effect.
import {randomUUID} from 'node:crypto';
import {responseReference,responseProjection,receiptProjection,validateResponseArguments} from './responses.mjs';
export const DECISION_SCHEMA={type:'object',additionalProperties:false,required:['plan','call','wakeAt'],properties:{
 plan:{type:'string',description:'Compact durable task state: current goal and original constraints, completed receipt IDs, current step, suspended work, deadlines and next step. Do not claim unobserved completion.'},
 call:{type:'object',additionalProperties:false,required:['type','command','arguments'],properties:{type:{type:'string',enum:['read','write','listen','wait']},command:{type:'string'},arguments:{type:'string',description:'A JSON object of arguments. Local type listen, command listen: exactly {listenTo:[observed Soul IDs]}, {listenTo:"nearby"}, or {listenTo:[]} to durably configure attention and immediately continue to the next decision. Wait sleeps: {} for events, {seconds:N} for a relative wake; wait may also configure listenTo before sleeping. Wakeup and listening survive other calls independently. Use wait {cancelWake:true} only to cancel the saved wakeup.'}}},
 wakeAt:{type:['string','null'],description:'ISO8601 wall-clock wakeup with timezone, or null for no new wakeup. A listen configuration preserves the saved wakeup when null and immediately continues; it never sleeps.'},
}};
const READS=new Set(['help','response','tasks','task','resync','here','observe','explore','resolve','receipt','conversations','turns','calendar','reminders','object']);
const WRITES=new Set(['act','say','converse','ack','result','remind','object']);
export function listeningScope(value){
 if(value==='nearby')return value;
 if(!Array.isArray(value)||value.length>12||value.some(id=>typeof id!=='string'||!/^s_[A-Za-z0-9_-]{1,198}$/.test(id)))throw Error('listenTo needs up to12 observed Soul IDs, "nearby", or [] to clear');
 return [...new Set(value)].sort();
}
export function parseDecision(text,{now=Date.now}={}){
 const value=JSON.parse(text);
 if(!value||Object.keys(value).sort().join(',')!=='call,plan,wakeAt')throw Error('Decision fields differ from contract');
 if(typeof value.plan!=='string'||value.plan.length>16000||Buffer.byteLength(JSON.stringify(value.plan))>16000)throw Error('Invalid durable plan: JSON-encoded text must be <=16000 bytes');
 const call=value.call;if(!call||Object.keys(call).sort().join(',')!=='arguments,command,type')throw Error('Invalid call');
 if(typeof call.arguments!=='string'||call.arguments.length>16000||Buffer.byteLength(JSON.stringify(call.arguments))>16000)throw Error('Invalid call arguments: JSON-encoded text must be <=16000 bytes');
 const args=JSON.parse(call.arguments);if(!args||typeof args!=='object'||Array.isArray(args))throw Error('Call arguments must be an object');
 if(call.type==='read'?!READS.has(call.command):call.type==='write'?!WRITES.has(call.command):call.type==='listen'?call.command!=='listen':call.type!=='wait')throw Error('Unsupported decision command');
 if(call.type==='listen'&&Object.keys(args).sort().join(',')!=='listenTo')throw Error('Listen needs exactly listenTo; use wait for sleeping or cancelling a wakeup');
 if(call.type==='read'&&['tasks','task'].includes(call.command)){
  const fields=call.command==='tasks'?['after','limit']:['id','offset'];
  if(Object.keys(args).some(k=>!fields.includes(k)))throw Error('Invalid local owner task arguments');
  if(call.command==='tasks'&&(args.after!==undefined&&(!Number.isSafeInteger(args.after)||args.after<0)||args.limit!==undefined&&(!Number.isInteger(args.limit)||args.limit<1||args.limit>20)))throw Error('Local tasks needs nonnegative sequence after and limit 1..20');
  if(call.command==='task'&&(typeof args.id!=='string'||!args.id.length||args.id.length>200||args.offset!==undefined&&(!Number.isSafeInteger(args.offset)||args.offset<0||args.offset>65536)))throw Error('Local task needs id and nonnegative text offset');
 }
 if(call.type==='read'&&call.command==='response')validateResponseArguments(args);
 if(Object.hasOwn(args,'listenTo')){if(!['listen','wait'].includes(call.type))throw Error('Only wait or listen can change listenTo');args.listenTo=listeningScope(args.listenTo);}
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
 // The next choice incorporates the preceding observation. Drop that call/result
 // atomically with retaining the choice, and store its plan only once: recovery
 // needs the call/wake and checkpoint plan, not another copy of the old result.
 const {plan,...execution}=decision;
 const id=randomUUID();const pendingDecision={id,decision:execution,eventIds:events.map(e=>({source:e.source,id:e.event.id})),retainedAt:Date.now()};
 const {lastResult,lastCall,...previous}=c.value??{};
 if(previous.lastReceipt)previous.lastReceipt=receiptProjection(previous.lastReceipt);
 journal.control.save(fence,c.revision,{...previous,threadId:threadId??c.value?.threadId,initialInstruction:c.value?.initialInstruction??initialInstruction??null,plan,pendingDecision});
 return id;
}
export async function applyPendingDecision(journal,fence,world,{signal}={}){
 const c=journal.control.checkpoint(),pending=c.value?.pendingDecision;if(!pending)return {applied:false};
 journal.control.assertOwner(fence);
 const {id,decision}=pending,call=decision.call;let response=null,reference=null;
 if(call.type==='listen')response={local:true,listenTo:listeningScope(call.args.listenTo)};
 else if(call.type==='read'){
  if(call.command==='response')response=journal.control.response(call.args);
  else{
   let saved=journal.control.readResult(id);
   if(!saved){
    const gaps=call.command==='resync'?journal.gaps():[];let resyncThrough=call.command==='resync'?gaps.reduce((last,g)=>Math.max(last,g.seq),0):null;
    if(call.command==='tasks')response=journal.openOwnerTasks(call.args);
    else if(call.command==='task')response=journal.ownerTask(call.args);
    else try{response=await world.read(call.command,call.args,signal);}
    catch(e){
     // Native validation/not-found/conflict is an observation for replanning.
     // Auth, transport and transient server failures retain the pending read.
     if(![400,404,409,422].includes(e.status)||e.uncertain!==false)throw e;
     response={accepted:false,error:{code:e.code??'read-refused',message:e.message,status:e.status}};resyncThrough=null;
    }
    reference=journal.control.retainReadResult(fence,id,response,{resyncThrough});saved={response,reference,resyncThrough};
   }
   ({response,reference}=saved);
   if(call.command==='resync')for(const gap of journal.gaps())if(gap.seq<=saved.resyncThrough)journal.reconcileGap(gap.seq,'Current observation/conversations refreshed; past missing events remain incomplete. Decision '+id);
  }
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
  reference=responseReference('operation',id,JSON.stringify(response));
  // Closure inspects the durable settled operation's exact native result.
  // Do this before finalizing the decision: a settle->crash recovery repeats
  // this idempotently and cannot lose the original task between checkpoints.
  if(call.command==='result')journal.closeOwnerTaskFromOperation(fence,id);
 }
 journal.control.assertOwner(fence);
 // Mark incorporation only after decision and result are durable. It is NOT
 // the public owner ack/result, and does not assert goal completion.
 let incorporated=0;
 for(const event of pending.eventIds)if(!journal.handled(event.source,event.id,'incorporated:'+id).alreadyHandled)incorporated++;
 const latest=journal.control.checkpoint();
 if(latest.value?.pendingDecision?.id!==id)throw Error('Pending decision changed while applying');
 const receipt=response?.receipt==null?null:receiptProjection(response.receipt,reference);
 // Null means no newly scheduled wake, not cancellation of suspended work.
 // A due wake is consumed only by a committed non-configuration decision that
 // was retained after its deadline. Local listening configuration never consumes
 // it, so the immediate next choice still sees the outstanding reminder.
 const priorWake=latest.value.wakeAt;
 const wakeAt=decision.wakeAt??(call.type==='listen'?priorWake??null:call.type==='wait'&&call.args.cancelWake===true?null:priorWake&&Date.parse(priorWake)>pending.retainedAt?priorWake:null);
 const {lastResult,...previous}=latest.value;
 const listenTo=['listen','wait'].includes(call.type)&&Object.hasOwn(call.args,'listenTo')?listeningScope(call.args.listenTo):latest.value.listenTo??[];
 const finalized={...previous,pendingDecision:null,lastDecisionId:id,lastCall:call,wakeAt,listenTo,lastReceipt:receipt??receiptProjection(latest.value.lastReceipt)??null};
 // Count the actual surrounding checkpoint, including the lastResult key and
 // comma, before deciding whether this complete observation fits inline.
 const envelopeBytes=Buffer.byteLength(JSON.stringify({...finalized,lastResult:null}))-4;
 const bytesLimit=Math.max(0,Math.min(32768,65536-envelopeBytes-128));
 journal.control.save(fence,latest.revision,{...finalized,lastResult:responseProjection(response,reference,{bytesLimit})});
 return {applied:true,id,call,response,wakeAt,incorporated};
}
