// Mechanical, once-only fixture disturbances. Observations never reach an actor;
// only the frozen send boundary may write, and an ACK never proves delivery.
import {createHash} from 'node:crypto';
const fault=code=>Object.assign(Error(code),{code});
const id=x=>typeof x==='string'&&/^[-A-Za-z0-9_]{1,120}$/.test(x);
const cited=x=>Array.isArray(x)&&x.length>0&&x.length<=64&&x.every(s=>typeof s==='string'&&s.length>0&&s.length<=1000);
const stamp=x=>typeof x==='number'&&Number.isFinite(x)?x:typeof x==='string'&&/(Z|[+-]\d\d:\d\d)$/.test(x)&&Number.isFinite(Date.parse(x))?Date.parse(x):NaN;
const sha=x=>createHash('sha256').update(x).digest('hex');
const clone=x=>structuredClone(x);
const pos=x=>Array.isArray(x)&&[2,3].includes(x.length)&&x.every(Number.isFinite)?[x[0],x.at(-1)]:x&&Number.isFinite(x.x)&&Number.isFinite(x.z)&&x.src!=='lastReceipt'?[x.x,x.z]:null;
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const social=new Set(['scheduled-event','moving-body-journey','garden-group-overlap']);
const releases=new Set(['scheduled-release','initial-supplement','staggered-releases']);

/** Native receipt timestamps are acceptedAtUtc/observedAcceptedAt/acceptedAt,
 * never simulation ticks. Inputs and callbacks carry private source pointers;
 * snapshot() contains no body history or cross-agent prompt material.
 * send(request) returns {status:'accepted'|'refused'|'uncertain', evidence,
 * effectId?,operationId?}. Native delivery must independently match one of
 * those exact IDs. A timeout may return uncertain with a known operation ID.
 */
export function createContinuityDisturbances({scenario,t0,cutoffAt,worldId,actors,evidence,maxSampleGapMs=2000},{now=Date.now,send,onRecord=()=>{}}={}){
 if(!scenario||!id(scenario.id)||!Number.isFinite(t0)||!Number.isFinite(cutoffAt)||cutoffAt<=t0||!id(worldId)||!Array.isArray(actors)||!actors.length||actors.length>5||!cited(evidence)||maxSampleGapMs!==2000||typeof send!=='function'||typeof onRecord!=='function')throw fault('INVALID_DISTURBANCE_CONFIG');
 if(Buffer.byteLength(JSON.stringify(scenario))>128*1024)throw fault('DISTURBANCE_FIXTURE_BOUND');
 evidence=clone(evidence);
 const spec=clone(scenario),mapping=new Map(),souls=new Set();
 for(const a of actors){if(!id(a?.actorId)||!id(a.soulId)||mapping.has(a.actorId)||souls.has(a.soulId))throw fault('INVALID_DISTURBANCE_ACTORS');mapping.set(a.actorId,a.soulId);souls.add(a.soulId);}
 if(!Array.isArray(spec.actors)||!equal([...mapping.keys()].sort(),spec.actors.map(a=>a.id).sort())||!Array.isArray(spec.disturbances)||spec.disturbances.length>16)throw fault('INVALID_DISTURBANCE_FIXTURE');
 const rows=new Map(),bodies=new Map(actors.map(a=>[a.actorId,[]])),receipts=new Map(actors.map(a=>[a.actorId,new Map()])),runs=new Map(actors.map(a=>[a.actorId,[]]));
 let closed=false,lastNow=-Infinity,inputFailure=null,inFlight=null;
 const clock=()=>{const at=now();if(!Number.isFinite(at)||at<lastNow)throw fault('DISTURBANCE_CLOCK_REVERSED');lastNow=at;return at;};
 const record=(kind,row)=>onRecord({kind,at:clock(),id:row.id,scheduledAt:row.scheduledAt,triggerProof:clone(row.triggerProof),firstMotionContradiction:clone(row.firstMotionContradiction??null),dispatch:clone(row.dispatch),delivered:row.delivered,status:row.status,reason:row.reason});
 for(const d of spec.disturbances){
  if(!id(d.id)||rows.has(d.id)||!d.trigger||!Array.isArray(d.trigger.recipients)||!d.trigger.recipients.length||new Set(d.trigger.recipients).size!==d.trigger.recipients.length||d.trigger.recipients.some(a=>!mapping.has(a)))throw fault('INVALID_DISTURBANCE_FIXTURE');
  const k=d.trigger.kind,managed=social.has(k);
  if(managed&&(d.trigger.maximumDelaySec!==2||!['world','owner'].includes(d.trigger.deliveryKind)||typeof d.text!=='string'||!d.text.trim()||Buffer.byteLength(d.text)>4096))throw fault('INVALID_DISTURBANCE_FIXTURE');
  if(k==='scheduled-event'&&(!Number.isFinite(d.trigger.offsetSec)||d.trigger.offsetSec<0))throw fault('INVALID_DISTURBANCE_FIXTURE');
  if(k==='moving-body-journey'&&(d.trigger.minimumOnsetSec!==5||d.trigger.maximumTriggerWaitSec!==180||!Array.isArray(d.trigger.capabilityVerbs)||!d.trigger.capabilityVerbs.length||d.trigger.capabilityVerbs.some(v=>!['walk','read','sit'].includes(v))||d.trigger.recipients.length!==1))throw fault('INVALID_DISTURBANCE_FIXTURE');
  if(k==='garden-group-overlap'&&(d.trigger.minimumOverlapSec!==10||!Number.isFinite(spec.timing?.meetingOffsetSec)||!pos(spec.venue?.gardenRegion?.pos)||!Number.isFinite(spec.venue.gardenRegion.radiusM)||spec.venue.gardenRegion.radiusM<=0))throw fault('INVALID_DISTURBANCE_FIXTURE');
  rows.set(d.id,{id:d.id,spec:d,status:managed?'waiting':releases.has(k)?'record-only':'external',scheduledAt:k==='scheduled-event'?t0+d.trigger.offsetSec*1000:null,triggerProof:null,dispatch:null,delivered:false,deliveryEvents:[],pendingDeliveries:[],releaseEvents:[],reason:null,onset:null,evictedThrough:null});
 }
 const scope=r=>{if(closed)throw fault('DISTURBANCES_CLOSED');if(r?.worldId!==worldId||mapping.get(r.actorId)!==r.soulId||!cited(r.evidence))throw fault('DISTURBANCE_SCOPE_MISMATCH');};
 const unmet=(r,reason)=>{if(r.dispatch)return;r.status='unmet';r.reason=reason;record('disturbance-unmet',r);};
 const latch=(r,scheduledAt,triggerProof)=>{if(r.triggerProof||r.status!=='waiting')return;r.scheduledAt=scheduledAt;r.triggerProof=triggerProof;r.status='triggered';record('disturbance-trigger',r);};
 const invalidate=(r,reason,proof)=>{if(r.firstMotionContradiction)return;r.firstMotionContradiction=proof;r.status='invalid';r.reason=reason;record('disturbance-first-trigger-invalid',r);};
 const motionPair=(a,b,r)=>a.at>=r.acceptedAt&&b.at>a.at&&b.at-a.at<=maxSampleGapMs&&(r.endedAt===null||b.at<=r.endedAt)&&a.current&&b.current&&Math.hypot(a.pos[0]-b.pos[0],a.pos[1]-b.pos[1])>0;
 function evaluate(){
  for(const r of rows.values()){
   const s=r.spec.trigger;
   if(s.kind==='moving-body-journey'){
    const actor=s.recipients[0],samples=bodies.get(actor),rs=[...receipts.get(actor).values()].filter(x=>x.acceptedAt>=t0&&s.capabilityVerbs.some(v=>x.capability.startsWith(v+':')));
    // Receipt callbacks may follow body observations. Correct an earlier onset
    // while its original window is still actionable; never substitute a later
    // known journey, or rewrite a dispatch which already happened.
    const choices=rs.flatMap(receipt=>{const i=samples.findIndex((b,i)=>i>0&&motionPair(samples[i-1],b,receipt));return i<0?[]:[{receipt,one:samples[i-1],two:samples[i]}];}).sort((a,b)=>a.two.at-b.two.at||a.receipt.acceptedAt-b.receipt.acceptedAt||a.receipt.id.localeCompare(b.receipt.id));
    const c=choices[0],old=r.onset,earlier=c&&(!old||c.two.at<old.at||c.two.at===old.at&&(c.receipt.acceptedAt<old.acceptedAt||c.receipt.acceptedAt===old.acceptedAt&&c.receipt.id<old.receiptId));
    if(earlier){
     const onset={receiptId:c.receipt.id,acceptedAt:c.receipt.acceptedAt,from:c.one.at,at:c.two.at,evidence:[...c.receipt.evidence,...c.one.evidence,...c.two.evidence]};
     if(r.dispatch){
      invalidate(r,'earlier-first-motion-discovered-after-dispatch',onset);
      continue;
     }
     if(['waiting','triggered'].includes(r.status)){r.onset=onset;r.scheduledAt=onset.at+s.minimumOnsetSec*1000;r.triggerProof=null;r.status='waiting';}
    }
    const provedReceipt=r.triggerProof&&receipts.get(actor).get(r.triggerProof.receiptId);
    if(r.dispatch&&provedReceipt&&provedReceipt.endedAt!==null&&provedReceipt.endedAt<r.triggerProof.motionToAt){invalidate(r,'journey-ended-before-dispatched-motion-proof',{receiptId:provedReceipt.id,endedAt:provedReceipt.endedAt,motionToAt:r.triggerProof.motionToAt,evidence:clone(provedReceipt.evidence)});continue;}
    if(!['waiting','triggered'].includes(r.status))continue;
    if(r.onset){
     const receipt=receipts.get(actor).get(r.onset.receiptId),due=r.scheduledAt;
     const i=samples.findIndex((b,i)=>i>0&&b.at>=due&&motionPair(samples[i-1],b,receipt));
     if(i<0&&r.triggerProof){r.triggerProof=null;r.status='waiting';record('disturbance-motion-proof-retracted',r);}
     if(i>=0){const one=samples[i-1],two=samples[i];latch(r,due,{kind:s.kind,observedAt:two.at,receiptId:receipt.id,receiptAcceptedAt:receipt.acceptedAt,receiptAcceptanceProvenance:receipt.acceptanceProvenance,motionOnsetFromAt:r.onset.from,motionOnsetAt:r.onset.at,motionFromAt:one.at,motionToAt:two.at,evidence:[...r.onset.evidence.slice(0,48),...one.evidence.slice(0,8),...two.evidence.slice(0,8)]});}
    }
   }else if(r.status==='waiting'&&s.kind==='garden-group-overlap'){
    const groups=spec.actors.map(a=>runs.get(a.id)),starts=[...new Set(groups.flat().map(w=>w.from))].sort((a,b)=>a-b),duration=s.minimumOverlapSec*1000;
    for(const from of starts){const selected=groups.map(ws=>ws.find(w=>w.from<=from&&w.to>=from+duration));if(selected.every(Boolean)){const to=from+duration;latch(r,to,{kind:s.kind,observedAt:to,proofAvailableAt:clock(),overlapFrom:from,overlapTo:to,bodyIntervals:selected.map((w,i)=>({actor:spec.actors[i].id,from:w.from,to:w.to,evidence:[...w.firstEvidence.slice(0,4),...w.lastEvidence.slice(0,4)]})),evidence:selected.flatMap(w=>[...w.firstEvidence.slice(0,4),...w.lastEvidence.slice(0,4)])});break;}}
   }
  }
 }
 function observeBody(input){
  scope(input);const at=stamp(input.at),receivedAt=stamp(input.receivedAt),p=pos(input.pos),list=bodies.get(input.actorId);
  if(!Number.isFinite(at)||at!==receivedAt||at>clock()||input.source!=='here'||typeof input.currentBody!=='boolean'||input.currentBody&&!p)throw fault('INVALID_DISTURBANCE_BODY');
  const b={at,pos:p,current:input.currentBody,evidence:clone(input.evidence)},prior=list.at(-1);
  if(prior&&at<=prior.at){if(equal(prior,b))return;throw fault('DISTURBANCE_BODY_ORDER');}
  if(at<t0||at>cutoffAt)return;
  list.push(b);if(list.length>64){const removed=list.shift();for(const r of rows.values())if(r.spec.trigger.kind==='moving-body-journey'&&r.spec.trigger.recipients.includes(input.actorId))r.evictedThrough=removed.at;}
  const region=spec.venue?.gardenRegion,meeting=t0+(spec.timing?.meetingOffsetSec??0)*1000,release=t0+(spec.actors.find(a=>a.id===input.actorId)?.releaseOffsetSec??0)*1000,windows=runs.get(input.actorId);
  if(region&&at>=Math.max(meeting,release)){
   const inside=b.current&&p&&Math.hypot(p[0]-region.pos[0],p[1]-region.pos[1])<=region.radiusM,last=windows.at(-1);
   if(inside){if(last&&last.open&&at-last.to<=maxSampleGapMs){last.to=at;last.lastEvidence=b.evidence;}else {windows.push({from:at,to:at,firstEvidence:b.evidence,lastEvidence:b.evidence,open:true});if(windows.length>32){windows.shift();for(const r of rows.values())if(r.spec.trigger.kind==='garden-group-overlap'&&r.status==='waiting')unmet(r,'first-overlap-history-unavailable');}}}
   else if(last)last.open=false;
  }
  evaluate();
 }
 function observeReceipt(input){
  scope(input);const r=input.receipt,acceptanceProvenance=r?.acceptedAtUtc!==undefined?'native-utc':r?.observedAcceptedAt!==undefined?'first-observed-acceptance':r?.acceptanceProvenance,acceptedAt=stamp(r?.acceptedAtUtc??r?.observedAcceptedAt??(['native-utc','first-observed-acceptance'].includes(acceptanceProvenance)?r?.acceptedAt:undefined)),end=r?.endedAtUtc??r?.observedEndedAt??r?.endedAt,endedAt=end===undefined||end===null?null:stamp(end),observedAt=stamp(input.observedAt);
  if(!id(r?.id)||typeof r.capability!=='string'||r.capability.length>300||!Number.isFinite(acceptedAt)||!Number.isFinite(observedAt)||acceptedAt>observedAt||observedAt>clock()||endedAt!==null&&(!Number.isFinite(endedAt)||endedAt<acceptedAt||endedAt>observedAt)||['completed','failed','replaced','cancelled','canceled'].includes(r.phase)&&endedAt===null)throw fault('INVALID_DISTURBANCE_RECEIPT');
  const rs=receipts.get(input.actorId),old=rs.get(r.id),value={id:r.id,capability:r.capability,acceptedAt,acceptanceProvenance,endedAt,evidence:clone(input.evidence)};
  if(old&&(old.capability!==value.capability||old.acceptedAt!==acceptedAt||old.endedAt!==null&&old.endedAt!==endedAt))throw fault('DISTURBANCE_RECEIPT_CONFLICT');
  if(!old&&rs.size>=64){inputFailure='DISTURBANCE_RECEIPT_BOUND';throw fault(inputFailure);}
  if(!old)for(const row of rows.values())if(row.spec.trigger.kind==='moving-body-journey'&&row.spec.trigger.recipients.includes(input.actorId)&&row.spec.trigger.capabilityVerbs.some(v=>value.capability.startsWith(v+':'))&&acceptedAt>=t0&&row.evictedThrough!==null&&acceptedAt<=row.evictedThrough&&row.status==='waiting')unmet(row,'first-motion-history-unavailable');
  rs.set(r.id,value);evaluate();
 }
 function observeRelease(input){
  scope(input);const scheduledAt=stamp(input.scheduledAt),releasedAt=stamp(input.releasedAt);
  if(!Number.isFinite(scheduledAt)||!Number.isFinite(releasedAt)||typeof input.initialInstructionId!=='string'||!input.initialInstructionId||input.initialInstructionId.length>300||releasedAt>clock())throw fault('INVALID_DISTURBANCE_RELEASE');
  for(const r of rows.values())if(releases.has(r.spec.trigger.kind)&&r.spec.trigger.recipients.includes(input.actorId)){
   const expected=t0+(spec.actors.find(a=>a.id===input.actorId)?.releaseOffsetSec??0)*1000;
   const value={actor:input.actorId,scheduledAt,releasedAt,deliveredAt:releasedAt,initialInstructionId:input.initialInstructionId,evidence:clone(input.evidence)},old=r.releaseEvents.find(e=>e.actor===input.actorId);
   if(old){if(!equal(old,value))throw fault('DISTURBANCE_RELEASE_CONFLICT');continue;}r.releaseEvents.push(value);
   if(scheduledAt!==expected||releasedAt<expected||releasedAt-expected>2000||releasedAt>cutoffAt){r.status='unmet';r.reason='release-outside-frozen-schedule';}
   if(r.spec.trigger.recipients.every(a=>r.releaseEvents.some(e=>e.actor===a))){
    r.delivered=true;r.scheduledAt=Math.min(...r.releaseEvents.map(e=>e.scheduledAt));r.deliveredAt=Math.max(...r.releaseEvents.map(e=>e.releasedAt));
    r.triggerProof={kind:r.spec.trigger.kind,observedAt:r.deliveredAt,...(r.spec.trigger.kind==='staggered-releases'?{releases:clone(r.releaseEvents)}:{releasedAt:r.deliveredAt,initialInstructionId:input.initialInstructionId}),evidence:r.releaseEvents.flatMap(e=>e.evidence.slice(0,8))};
    if(r.status!=='unmet')r.status='release-recorded';
   }record('disturbance-release-observed',r);
  }
 }
 function observeDelivery(input){
  scope(input);const r=rows.get(input.disturbanceId),d=r?.dispatch,createdAt=stamp(input.createdAt);
  if(!d||input.dispatchId!==d.id||!r.spec.trigger.recipients.includes(input.actorId)||input.source!==r.spec.trigger.deliveryKind||typeof input.eventId!=='string'||!input.eventId||input.eventId.length>300||[input.effectId,input.operationId].some(x=>x!==undefined&&(typeof x!=='string'||!x||x.length>300))||!Number.isFinite(createdAt)||createdAt<d.attemptedAt||createdAt>clock()||!cited(input.linkageEvidence))throw fault('INVALID_DISTURBANCE_DELIVERY');
  if(d.status==='pending'){if(r.pendingDeliveries.length>=16)throw fault('DISTURBANCE_DELIVERY_BOUND');r.pendingDeliveries.push(clone(input));return;}
  if(['effectId','operationId'].some(k=>d[k]&&input[k]!==undefined&&input[k]!==d[k])||!['effectId','operationId'].some(k=>d[k]&&input[k]===d[k]))throw fault('DISTURBANCE_DELIVERY_UNLINKED');
  const value={actor:input.actorId,soulId:input.soulId,eventId:input.eventId,source:input.source,createdAt,effectId:input.effectId??null,operationId:input.operationId??null,evidence:[...input.evidence,...input.linkageEvidence].slice(0,64)},old=r.deliveryEvents.find(x=>x.actor===input.actorId);
  if(old){if(!equal(old,value))throw fault('DISTURBANCE_DELIVERY_CONFLICT');return;}
  r.deliveryEvents.push(value);
  if(r.spec.trigger.recipients.every(a=>r.deliveryEvents.some(e=>e.actor===a))){r.delivered=true;r.deliveredAt=Math.max(...r.deliveryEvents.map(e=>e.createdAt));if(!r.firstMotionContradiction){r.status=r.deliveredAt<=cutoffAt&&r.deliveredAt-r.scheduledAt<=2000?'delivered':'delivered-late';r.reason=r.status==='delivered-late'?'native-delivery-outside-frozen-window':null;}}
  record('disturbance-native-delivery',r);
 }
 async function dispatch(){
  evaluate();for(const r of rows.values()){
   const at=clock(),s=r.spec.trigger;if(!social.has(s.kind)||r.dispatch||!['waiting','triggered'].includes(r.status))continue;
   if(inputFailure){unmet(r,inputFailure);continue;}
   if(s.kind==='scheduled-event'&&at>=r.scheduledAt)latch(r,r.scheduledAt,{kind:s.kind,observedAt:at,evidence:clone(evidence)});
   if(s.kind==='moving-body-journey'&&!r.triggerProof){if(r.scheduledAt!==null&&at>r.scheduledAt+2000||at>t0+s.maximumTriggerWaitSec*1000)unmet(r,'first-motion-trigger-unmet');}
   if(!r.triggerProof){if(at>=cutoffAt)unmet(r,'cutoff-without-trigger');continue;}
   if(at>=cutoffAt||at>r.scheduledAt+2000||r.scheduledAt<t0||s.kind==='moving-body-journey'&&r.scheduledAt>t0+s.maximumTriggerWaitSec*1000){unmet(r,'first-trigger-window-missed');continue;}
   const request={id:r.id,dispatchId:sha(JSON.stringify([worldId,t0,spec.id,r.id])),worldId,text:r.spec.text,deliveryKind:s.deliveryKind,recipients:s.recipients.map(actorId=>({actorId,soulId:mapping.get(actorId)})),scheduledAt:r.scheduledAt,triggerProof:clone(r.triggerProof)};
   r.dispatch={id:request.dispatchId,attemptedAt:at,ackAt:null,status:'pending',effectId:null,operationId:null,evidence:[]};r.status='dispatching';record('disturbance-dispatch',r);
   const controller=new AbortController();let timer,ack;
   try{ack=await Promise.race([Promise.resolve().then(()=>send({...clone(request),signal:controller.signal})),new Promise(resolve=>{timer=setTimeout(()=>{controller.abort();resolve({status:'uncertain',evidence:[]});},Math.max(1,Math.min(cutoffAt,r.scheduledAt+2000)-at));})]);}
   catch{ack={status:'uncertain',evidence:[]};}finally{clearTimeout(timer);}
   r.dispatch.ackAt=clock();
   if(ack&&['accepted','refused','uncertain'].includes(ack.status)&&cited(ack.evidence))Object.assign(r.dispatch,{status:ack.status,effectId:typeof ack.effectId==='string'&&ack.effectId.length>0&&ack.effectId.length<=300?ack.effectId:null,operationId:typeof ack.operationId==='string'&&ack.operationId.length>0&&ack.operationId.length<=300?ack.operationId:null,evidence:clone(ack.evidence)});
   else r.dispatch.status='uncertain';
   if(!r.firstMotionContradiction)r.status='awaiting-native-delivery';record('disturbance-dispatch-ack',r);
   for(const delivery of r.pendingDeliveries.splice(0)){try{observeDelivery(delivery);}catch{r.reason='unlinked-native-delivery-observed';record('disturbance-delivery-unlinked',r);}}
  }
 }
 const tick=()=>{if(closed)return Promise.resolve(snapshot());if(inFlight)return inFlight;inFlight=dispatch().then(snapshot).finally(()=>{inFlight=null;});return inFlight;};
 function snapshot(){return {schema:'continuity-disturbances/1',scenarioId:spec.id,worldId,t0,cutoffAt,closed,inputFailure,disturbances:Object.fromEntries([...rows].map(([key,r])=>[key,{id:r.id,status:r.status,reason:r.reason,recipients:clone(r.spec.trigger.recipients),scheduledAt:r.scheduledAt,triggerProof:clone(r.triggerProof),firstMotionContradiction:clone(r.firstMotionContradiction??null),dispatch:clone(r.dispatch),delivered:r.delivered,deliveredAt:r.deliveredAt??null,deliveryEvents:clone(r.deliveryEvents),releaseEvents:clone(r.releaseEvents),evidence:clone(evidence)}])),limits:'Bounded passive native observations; dispatch ACK is not recipient delivery. No retries, coaching, world movement, occupancy or restart control.'};}
 function finish(){if(inFlight)throw fault('DISTURBANCE_SEND_ACTIVE');if(!closed){for(const r of rows.values())if(social.has(r.spec.trigger.kind)&&!r.dispatch&&['waiting','triggered'].includes(r.status))unmet(r,'observation-ended-before-dispatch');closed=true;}return snapshot();}
 return {observeBody,observeReceipt,observeRelease,observeDelivery,tick,snapshot,finish};
}
