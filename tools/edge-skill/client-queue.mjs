import {existsSync,lstatSync,mkdirSync,openSync,closeSync,readFileSync,writeFileSync,renameSync,unlinkSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';

const TERMINAL=new Set(['completed','failed','replaced']);
const fail=message=>{throw Error('client queue: '+message);};
const stable=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9:._@-]{0,159}$/.test(value)?value:fail('invalid stable ID');
const safeText=(value,max=300)=>typeof value==='string'&&value.trim()&&value.length<=max?value.trim():fail('invalid text');
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value);
/** A queued public step that speaks: a say, or a conversation step carrying text. */
export const spokenStep=step=>!!step?.publicStep&&(typeof step.publicStep.say==='string'||typeof step.publicStep.text==='string');
/** A confirmed-refused step in an owner queue waits at most this long for a `fixes` repair (or until one
 * continuation attempt is refused); then it is skipped and the queue goes on with its next step. */
export const REFUSED_OWNER_STEP_MS=60_000;
const STALL_HINT='; the refused step is skipped at the next queue check and the owner queue goes on with its next step';
export function durationSeconds(value){
 if(typeof value==='number'&&Number.isFinite(value)&&value>0&&value<=86400)return value;
 const m=/^(\d+(?:\.\d+)?)(s|m|h)$/.exec(String(value));if(!m)fail('duration must be positive seconds or Ns/Nm/Nh');
 return durationSeconds(Number(m[1])*({s:1,m:60,h:3600}[m[2]]));
}
/** Local reply compatibility only: never turns "plan" into a server capability. */
export function replySteps(reply,depth=0){
 if(depth>4)fail('nested plan limit');
 if(!plain(reply))fail('reply must be an object');
 let value=reply.do;
 if(Array.isArray(reply.plan))value=reply.plan;
 if(plain(reply.plan)&&Array.isArray(reply.plan.steps))value=reply.plan.steps;
 if(reply.act==='plan'){value=reply.steps??reply.params?.steps;if(!Array.isArray(value))fail('plan needs steps array');}
 if(value===undefined&&reply.act)value=[reply];
 if(value===undefined)return [];
 if(!Array.isArray(value)||value.length>24)fail('reply must contain at most24 steps');
 value=value.flatMap(step=>plain(step)&&(step.act==='plan'||step.plan!==undefined)?replySteps(step.act==='plan'?{act:'plan',steps:step.steps??step.params?.steps}:{plan:step.plan},depth+1):[step]);
 if(value.length>24)fail('too many expanded steps');
 return value.map(step=>{
  if(!plain(step))fail('step must be an object');
  const act=step.act??step.do;if(act===undefined){if(JSON.stringify(step).length>4096)fail('public step too large');return structuredClone(step);}
  safeText(act);if(act==='plan')fail('plan needs a local steps array');
  const params=step.params??{};if(!plain(params)||JSON.stringify(params).length>4096)fail('invalid bounded params');
  const out={act,params:structuredClone(params)};for(const k of ['targetSoul','identityBasis'])if(step[k]!==undefined){if(JSON.stringify(step[k]).length>1024)fail('identity reference too large');out[k]=structuredClone(step[k]);}const nestedProtection=Object.hasOwn(params,'protected');if(step.protected!==undefined&&typeof step.protected!=='boolean'||nestedProtection&&typeof params.protected!=='boolean')fail('invalid client protection');if(step.protected!==undefined&&nestedProtection&&step.protected!==params.protected)fail('conflicting client protection');const protection=step.protected??(nestedProtection?params.protected:undefined);delete out.params.protected;if(protection!==undefined)out.protected=protection;if(step.fixes!==undefined)out.fixes=stable(step.fixes);
  if(step.for!==undefined){out.for=durationSeconds(step.for);out.params.seconds=out.for;}
  if(step.if!==undefined){if(!plain(step.if)||Object.keys(step.if).some(k=>!['place','nobodyNear'].includes(k)))fail('unknown guard');if(step.if.place!==undefined)stable(step.if.place);if(step.if.nobodyNear!==undefined&&step.if.nobodyNear!==true)fail('invalid near guard');out.if=structuredClone(step.if);}
  if(step.until!==undefined&&step.for!==undefined)fail('until hold and fixed for duration are distinct; omit for');
  if(step.until!==undefined){const u=typeof step.until==='string'?{event:step.until}:step.until;if(!plain(u)||Object.keys(u).some(k=>!['event','worldTime','worldMinutes'].includes(k))||Number(u.event!==undefined)+Number(u.worldTime!==undefined)+Number(u.worldMinutes!==undefined)!==1)fail('unknown until condition');if(u.event!==undefined)safeText(u.event,100);if(u.worldMinutes!==undefined&&(!Number.isFinite(u.worldMinutes)||u.worldMinutes<0))fail('invalid absolute world minute');if(u.worldTime!==undefined&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(u.worldTime))fail('invalid world time');out.until=structuredClone(u);}
  return out;
 });
}

/** One local writer, one body request. Dispatch intent is saved BEFORE transport;
 * uncertain replies retry only the SAME clientRef/body, relying on edge1 idempotency.
 * No model, server planner, body force, timetable, identity or credential access. */
export function openClientQueue(directory,{adapter,scope=null,now=Date.now,onWake=()=>{},onReceipt=()=>{},onChange=()=>{},isPaused=()=>false}={}){
 const root=resolve(directory),stateFile=join(root,'.client-queue.json'),lockFile=join(root,'.client-queue.lock');
 const safe=path=>{try{const s=lstatSync(path);if(s.isSymbolicLink()||s.nlink>1)fail('linked file refused');}catch(e){if(e.code!=='ENOENT')throw e;}return path;};
 if(lstatSync(root).isSymbolicLink())fail('linked root refused');
 const nonce=randomUUID();let closed=false,pumping=null;
 const read=path=>JSON.parse(readFileSync(safe(path),'utf8'));
 if(existsSync(lockFile)){
  const old=read(lockFile);if(!Number.isSafeInteger(old.pid)||old.pid<1)fail('invalid lease');
  let alive=true;try{process.kill(old.pid,0);}catch(e){if(e.code==='ESRCH')alive=false;else throw e;}
  if(alive)fail('another writer owns the queue lease');unlinkSync(lockFile);
 }
 const fd=openSync(safe(lockFile),'wx',0o600);writeFileSync(fd,JSON.stringify({version:1,pid:process.pid,nonce}));closeSync(fd);
 let state=existsSync(stateFile)?read(stateFile):{version:1,id:null,source:null,steps:[],at:0,notice:null};
 if(state.version!==1||!Array.isArray(state.steps)||state.steps.length>24||(state.scope&&state.scope!==scope)){unlinkSync(lockFile);fail('unsupported state');}
 state.scope??=scope;
 const lease=()=>{if(closed||read(lockFile).nonce!==nonce)fail('writer lease lost');};
 const snapshot=()=>structuredClone(state);
 const save=()=>{lease();safe(stateFile);const tmp=safe(stateFile+'.tmp');writeFileSync(tmp,JSON.stringify(state)+'\n',{mode:0o600});renameSync(tmp,stateFile);onChange(snapshot());};
 const notify=(reason,step)=>{state.notice={reason,step:step?.id,at:now()};save();onWake(reason,snapshot());};
 const current=()=>state.steps.find(s=>!['completed','cancelled','skipped','superseded'].includes(s.status));
 // R2 queue rule: one refused owner step never freezes the steps behind it (Basil 03:18-03:40).
 const refusedAttempts=new Map();
 const stalled=step=>state.source==='owner'&&step?.status==='failed'&&step.refusalConfirmed===true&&!step.receiptId&&!step.publicStep;
 const dropSpeechAfter=(index,act)=>{const dropped=[];for(const s of state.steps.slice(index+1))if(s.status==='pending'&&spokenStep(s)){s.status='skipped';s.redraft=true;s.reason=`drafted before ${String(act).slice(0,60)} was refused; not spoken`;dropped.push(s.id);}return dropped;};
 function skipRefused(step,why){
  const droppedSpeech=dropSpeechAfter(state.steps.indexOf(step),step.act);refusedAttempts.delete(step.id);
  step.status='skipped';step.skippedAfterRefusal=true;step.reason=`${String(step.reason??step.code??'refused').slice(0,160)} (refused; skipped ${why}; the queue went on)`;
  state.skips=[...(state.skips??[]),{stepId:step.id,act:step.act,code:step.code??null,why,at:now(),droppedSpeech}].slice(-24);
  notify('refused-step-skipped',step);
 }
 const condition=(step,context)=>{const u=step.until;if(!u)return true;if(u.event)return state.events?.some(e=>e.kind===u.event&&e.sequence>(step.untilAfterSequence??0));return Number.isFinite(context.worldMinutes)&&Number.isFinite(step.untilWorldMinutes)&&context.worldMinutes>=step.untilWorldMinutes;};
 const reference=(step,part)=>'queue-'+createHash('sha256').update(JSON.stringify([state.id,step.id,part,step.act,step.params])).digest('hex');
 async function send(step,body,part,pausedNow){
  if(pausedNow())return null;
  const before=structuredClone(step);
  const ref=reference(step,part);if(part==='stop')step.stopRequested=true;else step.clientRef=ref;step.status=part==='stop'?'stopping':'dispatching';step.attempts=(step.attempts??0)+1;save();
  if(pausedNow()){for(const key of Object.keys(step))delete step[key];Object.assign(step,before);save();return null;}
  let result;try{result=await adapter.send({...body,clientRef:ref});}catch(error){if(error.code==='local.attended'&&error.requestNotSent){for(const key of Object.keys(step))delete step[key];Object.assign(step,before);save();return null;}state.notice={reason:'transport-uncertain',step:step.id,at:now()};save();return null;}
  lease();if(!result?.accepted||!result.receipt?.id){step.status='failed';step.failedAt=now();step.refusalConfirmed=result?.accepted===false;step.code=result?.code??'transport.invalid-response';step.reason=result?.reason??'No accepted receipt';notify('refusal',step);return null;}
  return result.receipt;
 }
 async function drive(context={},paused=false){
  const pausedNow=()=>paused||isPaused();
  lease();
  for(const previous of state.previous??[]){if(previous.folded)continue;const r=await adapter.readReceipt(previous.receiptId).catch(()=>null);if(r&&TERMINAL.has(r.phase)){await onReceipt(r,previous);previous.folded=true;save();}}
  let step=current();
  if(stalled(step)&&!pausedNow()){const tries=refusedAttempts.get(step.id)??0,age=now()-(step.failedAt??state.notice?.at??state.at??0);
   if(tries>0||age>=REFUSED_OWNER_STEP_MS){skipRefused(step,tries>0?'after a continuation without a valid fixes repair was refused':`after ${Math.round(age/1000)} s without a fixes repair`);return drive(context,paused);}}
  if(!step||['failed','interrupted','blocked'].includes(step.status))return snapshot();
  if(step.receiptId){
   const receipt=await adapter.readReceipt(step.receiptId).catch(()=>null);lease();if(!receipt||receipt.id!==step.receiptId)return snapshot();step.receipt=receipt;step.lastReconciledAt=now();
   const reached=condition(step,context);if(step.stopRequested&&!step.stopReceiptId&&TERMINAL.has(receipt.phase)){const stop=await send(step,{capability:'stand:here',params:{}},'stop',pausedNow);if(!stop)return snapshot();step.stopReceiptId=stop.id;save();}
   if(!TERMINAL.has(receipt.phase)){
    if(step.until&&reached&&!pausedNow()){
     if(!step.stopReceiptId){const stop=await send(step,{capability:'stand:here',params:{}},'stop',pausedNow);if(!stop)return snapshot();step.stopReceiptId=stop.id;save();}
     const stop=await adapter.readReceipt(step.stopReceiptId).catch(()=>null);if(stop&&TERMINAL.has(stop.phase)){if(stop.phase!=='completed'){step.status='failed';notify('stop-refused',step);return snapshot();}await onReceipt(stop,step);}
     step.status='stopping';save();return snapshot();
    }
    step.status=receipt.phase==='waiting'?'waiting':'running';save();return snapshot();
   }
   if(!step.terminalFolded){await onReceipt(receipt,step);step.terminalFolded=true;save();}
   if(receipt.phase!=='completed'&&!(step.stopReceiptId&&receipt.phase==='replaced')){step.status=receipt.phase==='replaced'?'interrupted':'failed';notify(step.status,step);return snapshot();}
   if(step.stopReceiptId){const stop=await adapter.readReceipt(step.stopReceiptId).catch(()=>null);if(!stop||!TERMINAL.has(stop.phase))return snapshot();if(stop.phase!=='completed'){step.status='failed';notify('stop-refused',step);return snapshot();}}
   if(step.until&&!reached){
    // A genuine bounded native completion earns its effects; renewal is a new
    // qualified substep, never a fake claim that an already-ended body is held.
    step.renewal=(step.renewal??0)+1;step.receiptId=null;step.terminalFolded=false;step.status='pending';save();
   }else{step.status='completed';save();}
   context=adapter.context?await adapter.context():{...context,busy:null,placeId:receipt.endedAt?.place??context.placeId};step=current();if(!step)return snapshot();
  }
  if(pausedNow())return snapshot();
  if(step.publicStep){
   if(step.status==='dispatching'){step.status='blocked';notify('public-step-outcome-uncertain',step);return snapshot();}
   const before=step.status;step.status='dispatching';save();
   if(pausedNow()){step.status=before;save();return snapshot();}
   let result;try{result=await adapter.runPublic(step.publicStep);}catch(error){step.status='blocked';step.reason=String(error.message).slice(0,300);notify('public-step-outcome-uncertain',step);return snapshot();}
   lease();step.result=result;
   if(result?.requestNotSent&&result.acceptedMembership!==true){if(result.accepted===false){step.status=before;save();return snapshot();}step.status='blocked';step.reason=result.reason??'Prior effects are unconfirmed';notify('public-step-outcome-uncertain',step);return snapshot();}
   if(result?.receipt?.id){step.receiptId=result.receipt.id;step.receipt=result.receipt;step.status='running';save();return snapshot();}step.status=result?.again?'failed':'completed';save();if(result?.again){notify('public-step-refusal',step);return snapshot();}return drive(context,paused);
  }
  if(context.busy&&context.busy.id!==step.receiptId&&context.busy.id!==state.replaceReceiptId){step.status='blocked';notify('protected-action',step);return snapshot();}
  if(step.if?.place&&step.if.place!==context.placeId){step.status='blocked';notify('guard-place',step);return snapshot();}
  if(step.if?.nobodyNear&&(context.nearCount??0)>0){step.status='blocked';notify('guard-near',step);return snapshot();}
  if(step.until){
   if(step.until.worldMinutes!==undefined){step.untilWorldMinutes=step.until.worldMinutes;if(Number.isFinite(context.worldMinutes)&&context.worldMinutes>=step.untilWorldMinutes){step.status='skipped';step.reason='World deadline elapsed before activity start';save();return drive(context,paused);}}
   if(!step.holdProfile){const qualified=await adapter.holdProfile?.(step,context);if(!qualified||!Number.isFinite(qualified.seconds)||qualified.seconds<=0||qualified.seconds>600){step.status='blocked';notify('until-hold-unqualified',step);return snapshot();}step.holdProfile=qualified;step.untilAfterSequence=state.eventSequence??0;}
   if(step.until.worldTime&&!Number.isFinite(step.untilWorldMinutes)){if(!Number.isFinite(context.worldMinutes)){step.status='blocked';notify('clock-unavailable',step);return snapshot();}const minute=Number(step.until.worldTime.slice(0,2))*60+Number(step.until.worldTime.slice(3));step.untilWorldMinutes=Math.floor(context.worldMinutes/1440)*1440+minute;if(step.untilWorldMinutes<context.worldMinutes)step.untilWorldMinutes+=1440;}
  }
  const body={capability:step.act,params:step.until?{...step.params,seconds:step.holdProfile.seconds}:step.params??{}};
  const result=await send(step,body,'hold-'+(step.renewal??0),pausedNow);if(!result)return snapshot();step.receiptId=result.id;step.receipt=result;step.status=result.phase==='waiting'?'waiting':'running';state.notice=null;state.replaceReceiptId=null;save();return snapshot();
 }

 function enqueueNow(steps,{id=randomUUID(),source='mind',replace=false,force=false}={}){
   lease();stable(id);stable(source);const normalized=replySteps({do:steps});if(normalized.some(s=>!s.act&&(s.for||s.until||s.if)))fail('public steps cannot carry body conditions');
   if(normalized.some(s=>s.fixes!==undefined)){
    const active=current(),replacement=normalized[0];
    if(normalized.length!==1||!replacement.act||replacement.publicStep||/^(look|turn|face|glance)\b/i.test(replacement.act))fail('repair needs one replacement body step; original remaining steps are retained');
    if(!active||replacement.fixes!==active.id)fail('fixes must name the current failed body step, never a foreign, earlier or completed step');
    if(state.source==='owner'&&source==='owner'&&id!==state.id)fail('a new owner request must explicitly replace the queue; fixes continues its original request');
    if(active.publicStep||active.status!=='failed'||active.refusalConfirmed!==true||active.receiptId)fail('repair requires a confirmed refused body request; accepted, active or uncertain effects cannot be replayed');
    const index=state.steps.indexOf(active),next={...replacement,...(active.protected?{protected:true}:{}),id:`step-repair-${randomUUID()}`,status:'pending',attempts:0};
    // Truth rule: speech queued after the refused step was written before the refusal and may claim
    // an outcome that never happened. A repair never carries it: every unrun speech step after the
    // refused one in this plan is skipped (redraft:true) and the mind redrafts from actual results.
    const droppedSpeech=dropSpeechAfter(index,active.act);
    state.repairs=[...(state.repairs??[]),{failedStep:structuredClone(active),replacementStepId:next.id,requestedBy:id,requestedSource:source,at:now(),droppedSpeech}].slice(-24);
    state.steps[index]=next;state.notice=null;save();return snapshot();
   }
   if(state.id===id)return snapshot();
   const active=current();if(active&&!replace)fail('queue already has pending work');
   if(active&&state.source==='owner'&&source==='mind'&&replace)fail('an unfinished owner queue needs an explicit current fixes continuation, not an implicit mind replacement');
   if(['dispatching','stopping'].includes(active?.status)&&replace)fail('transport outcome uncertain; reconcile before replacement');
   // Protection the Soul set on its own autonomous step (mind, routine, commitment) guards against its own later
   // whims, never against its owner (Cleo 03:58). Protection the owner set still needs the owner's --force.
   const selfProtected=active?.protected&&state.source!=='owner';
   if(active?.protected&&replace&&!force&&!(selfProtected&&source==='owner'))fail('local protected step requires explicit owner force/attended takeover');
   const previous=[...(state.previous??[])];if(active?.receiptId)previous.push({...active,status:'superseded'});
   state={version:1,scope,id,source,at:now(),notice:null,events:[],eventSequence:0,previous:previous.slice(-50),replaceReceiptId:active?.receiptId??null,steps:normalized.map((s,i)=>({...s,...(!s.act?{publicStep:structuredClone(s.publicStep??s),act:s.say?'say':s.converse?'converse':s.publicStep?.act??'public-step'}:{}),id:`step-${i}-${randomUUID()}`,status:'pending',attempts:0}))};save();return snapshot();
 }

 return {
  snapshot,
  enqueue(steps,options){try{return enqueueNow(steps,options);}catch(error){const active=current();if(stalled(active)){refusedAttempts.set(active.id,(refusedAttempts.get(active.id)??0)+1);if(error.message.startsWith('client queue: '))error.message+=STALL_HINT;}throw error;}},
  event(event){lease();if(typeof event?.kind==='string'){state.eventSequence=(state.eventSequence??0)+1;state.events=[...(state.events??[]),{kind:event.kind,sequence:state.eventSequence}].slice(-100);save();}},
  pump(context={},paused=false){if(!pumping)pumping=drive(context,paused).finally(()=>{pumping=null;});return pumping;},
  resume(){lease();const s=current();if(s&&s.status==='blocked'&&state.notice?.reason!=='public-step-outcome-uncertain'){s.status='pending';state.notice=null;save();}return snapshot();},
  close(){if(closed)return;try{if(read(lockFile).nonce===nonce)unlinkSync(lockFile);}catch(e){if(e.code!=='ENOENT')throw e;}finally{closed=true;}},
 };
}
