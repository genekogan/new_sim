// Explicit read-only bridge from a development probe to the oracle contract.
// No credentials, model plans, narration, world requests or journal migrations.
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,lstatSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {withKinematics} from '../../observer/kinematics.mjs';

const time=v=>typeof v==='number'&&Number.isFinite(v)?v:typeof v==='string'&&/(Z|[+-]\d\d:\d\d)$/.test(v)&&Number.isFinite(Date.parse(v))?Date.parse(v):null;
const cited=v=>Array.isArray(v)&&v.length>0&&v.every(s=>typeof s==='string'&&s.trim());
const key=(actor,source,id)=>JSON.stringify([actor,source,id]);
const terminal=r=>['completed','failed','replaced','cancelled','canceled'].includes(r?.phase);
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const decode=v=>typeof v==='string'?JSON.parse(v):v;
const unique=v=>[...new Set(v)];
const actorId=id=>{if(typeof id!=='string'||!/^[-A-Za-z0-9_]+$/.test(id))throw Error('Invalid evidence actor id');return id;};
// In this native contract explore always calls authenticated /around. Its
// optional route query is separate: only around's current local facts count.
// No request arguments or model text are needed to establish that distinction.
function localAround(response,source){
 const around=response?.around,keys=['tick','people','things','places','found','floors','unvisited','untrusted'];
 if(response?.error||response?.accepted===false||response?.remote!==undefined||response?.view!==undefined||response?.contract!=='eden-edge/1'||!object(around)||Object.keys(around).some(k=>!keys.includes(k))||!Number.isSafeInteger(around.tick)||around.tick<0||response.tick!==undefined&&response.tick!==around.tick)return null;
 if(!['people','things','places'].every(k=>Array.isArray(around[k])))return null;
 const facts=[];
 for(const kind of ['people','things'])for(const text of around[kind])if(typeof text==='string'&&text.trim())facts.push({kind,text});
 for(const place of around.places)if(object(place)&&typeof place.id==='string'&&typeof place.name==='string'&&Number.isFinite(place.m)&&place.m>=0&&typeof place.dir==='string')facts.push({kind:'place',id:place.id,name:place.name,m:place.m,dir:place.dir});
 return facts.length?{kind:'native-local-around',tick:around.tick,facts,evidence:[source+'/response/around']}:null;
}
const nativeBody=(r,source)=>{
 const observed=time(r.receivedAt)??time(r.at),start=time(r.requestedAt),explicit=r.source==='here',legacy=r.source===undefined&&r.kind==='body';
 const sample=withKinematics({source}, {me:r.me,tick:r.tick},{startedAt:start,endedAt:observed,mono:r.mono});
 // me.activity describes the current intent/open receipt, including approach.
 // Only the separate native body activity establishes what is physical now.
 const actual=(explicit||legacy)&&object(r.me?.actualActivity)&&typeof r.me.actualActivity.kind==='string'&&r.me.actualActivity.kind.trim()?r.me.actualActivity:null;
 sample.reportedIntentActivity=r.me?.activity??null;
 sample.activity=actual?.kind??null;sample.instrument=typeof actual?.instrument==='string'?actual.instrument:null;
 sample.activityProvenance=actual?'explicit-native-actual-activity':'unknown';
 // here.me.place is the first non-occupier returned by native, same-level
 // PlaceIndex membership. A district/ancestor label is never substituted.
 sample.placeProvenance=explicit&&typeof r.me?.place==='string'&&r.me.place?'explicit-native-most-specific-place':'unknown';
 sample.levelProvenance=Number.isFinite(r.me?.level)?'explicit-native-level':sample.placeProvenance==='explicit-native-most-specific-place'?'native-place-membership':'unknown';
 if(!explicit&&!legacy){sample.pos=sample.pos?{...sample.pos,src:'unknown'}:null;}
 return {...sample,currentBody:!!sample.pos&&(explicit||legacy),provenance:explicit?'explicit-native-here':legacy?'legacy-body-row-here':'unverified-source'};
};
const scopedAudit=(a,from,to)=>a?.complete===true&&from!==null&&to!==null&&time(a.from)===from&&time(a.to)===to&&cited(a.evidence);
const dense=(samples,from,to,gap)=>{
 const rows=samples.filter(s=>time(s.t)!==null&&s.t>=from&&s.t<=to).sort((a,b)=>a.t-b.t);
 return rows.length>0&&rows[0].t<=from+gap&&rows.at(-1).t>=to-gap&&rows.every((s,i)=>s.currentBody===true&&(!i||s.t-rows[i-1].t<=gap));
};

/** Pure adapter. `annotations` contains explicit oracle-contract inputs (e.g.
 * source-cited bindings, disturbances, semantic review), never inferred answers.
 * Completeness requires interval-scoped `audits`, not a successful probe exit.
 * `nativeEffects` must come from public native logs; `responses` is an explicit
 * source-cited relevance annotation, not a guessed nearest effect in time. */
export function adaptIndependentProbe({run,timeline=[],journals={},scenarioId=run?.scenarioId,t0:declaredT0,cutoff:declaredCutoff,maxSampleGapSec=2,annotations={},audits={},nativeEffects=[],nativeReceipts=[],expectedNotifications=[],responses=[],sources={}}){
 if(!object(run)||!Array.isArray(run.actors)||!Array.isArray(timeline)||!Number.isFinite(maxSampleGapSec)||maxSampleGapSec<=0)throw Error('Invalid probe evidence inputs');
 const runSource=sources.run??'run.json',timelineSource=sources.timeline??'timeline.jsonl',missing=[],issues=[];
 const entries=timeline.map((r,i)=>({r,source:r.sourcePointer??`${timelineSource}#L${i+1}`}));
 const people=[...run.actors,...(run.fixtureActors??[])];for(const a of people)actorId(a.id);
 if(new Set(people.map(a=>a.id)).size!==people.length)throw Error('Duplicate evidence actor identity');
 const souls=people.map(a=>a.soulId).filter(x=>typeof x==='string');if(new Set(souls).size!==souls.length)throw Error('Independent actors cannot share a Soul');
 const inventory=new Map(people.map(a=>[a.id,a]));
 for(const {r} of entries)if(inventory.has(r.actor)&&r.soulId!==undefined&&r.soulId!==inventory.get(r.actor).soulId)throw Error('Timeline Soul scope mismatch for '+r.actor);
 const setup=entries.filter(({r,source})=>r.kind==='setup-body'&&r.source==='here'&&time(r.receivedAt)!==null&&nativeBody(r,source).currentBody);
 const started=time(run.startedAt),setupKnown=started!==null&&people.every(a=>setup.some(({r})=>r.actor===a.id&&time(r.receivedAt)<=started));
 // Legacy startedAt was before preflight. It cannot silently become sealed T0.
 const t0=time(declaredT0)??time(run.t0)??(setupKnown?started:null),cutoff=time(declaredCutoff)??time(run.cutoffAt)??(t0!==null&&Number.isFinite(run.seconds)?t0+run.seconds*1000:null);
 if(t0===null)missing.push('authoritative post-setup T0');if(cutoff===null)missing.push('trial cutoff');
 const participants=Object.create(null),fixtureActors=Object.create(null),received=new Map(),receipts=new Map(),operations=[],releases=[];
 for(const a of people){const target=run.actors.some(p=>p.id===a.id)?participants:fixtureActors;target[a.id]={samples:[],receipts:[],reads:[],coverageComplete:false};receipts.set(a.id,new Map());}
 const addReceipt=(actor,r,observedAt,source,kind)=>{
  if(!object(r)||typeof r.id!=='string'||typeof r.capability!=='string')return;
  const map=receipts.get(actor),list=map.get(r.id)??[];
  if(r.soulId!==undefined&&r.soulId!==inventory.get(actor).soulId||list.some(x=>x.receipt.capability!==r.capability))throw Error('Native receipt identity/scope conflict');
  list.push({receipt:r,at:observedAt,source,kind});map.set(r.id,list);
 };
 for(const {r,source} of entries){
  const target=participants[r.actor]??fixtureActors[r.actor];if(!target)continue;
  if(['body','fixture-body','setup-body'].includes(r.kind))target.samples.push(nativeBody(r,source));
  if(r.kind==='observation-error')target.samples.push({t:time(r.receivedAt)??time(r.at),pos:null,currentBody:false,source,observationError:r.code??r.message??'missing native body'});
  if(['controller-release','actor-release'].includes(r.kind))releases.push({actor:r.actor,scheduledAt:time(r.scheduledAt),releasedAt:time(r.releasedAt),initialInstructionId:r.instructionId??null,pid:r.pid??null,evidence:[source]});
  if(r.kind==='world-read'&&r.origin==='agent'&&typeof r.command==='string'&&time(r.receivedAt)!==null&&time(r.requestedAt)!==null&&time(r.requestedAt)<=time(r.receivedAt)&&object(r.response)&&!r.response.error&&r.response.accepted!==false){
   const inspection=r.command==='explore'?localAround(r.response,source):null;
   target.reads.push({command:r.command,origin:'agent',at:time(r.receivedAt),requestedAt:time(r.requestedAt),evidence:[source],...(inspection?{inspection}:{})});
  }
 }
 const worlds=new Set();
 for(const a of run.actors){
  const j=journals[a.id];if(!j){missing.push(a.id+': journal');continue;}
  const path=j.source??`${a.id}/runtime/continuity.sqlite`;
  if(!j.identity||j.identity.soul!==a.soulId||run.worldId!==undefined&&j.identity.world!==run.worldId)throw Error('Journal world/Soul scope mismatch for '+a.id);
  worlds.add(j.identity.world);
  for(const event of j.events??[]){
   const payload=decode(event.payload),id=event.event_id??payload?.id,source=`${path}#events/seq=${event.seq}/source=${encodeURIComponent(event.source)}/id=${encodeURIComponent(id)}`;
   if(typeof id!=='string'||!['owner','world'].includes(event.source))continue;
   if(payload?.id!==undefined&&payload.id!==id)throw Error('Journal event payload identity mismatch');
   const value={actor:a.id,source:event.source,eventId:id,kind:payload?.kind??null,createdAt:time(event.source==='owner'?payload?.sentAt:payload?.at),receivedAt:time(event.received_at),handledAt:time(event.handled_at),payloadCompacted:payload===null,evidence:[source],payload};
   received.set(key(a.id,event.source,id),value);
   const r=payload?.data?.receipt??payload?.receipt;if(r)addReceipt(a.id,r,value.createdAt,source,'native-receipt-event');
  }
  for(const raw of j.operations??[]){
   const request=decode(raw.request),response=decode(raw.response),source=`${path}#operations/id=${encodeURIComponent(raw.id)}`;
   operations.push({actor:a.id,id:raw.id,status:raw.status,command:request?.command,request,response,observedAt:time(raw.at),evidence:[source],dispatchRecordedAt:raw.status==='dispatching'?time(raw.at):null});
   if(raw.status==='settled'&&response?.receipt)addReceipt(a.id,response.receipt,time(raw.at),source,response.reconciliation?'readback-observed':'settled-native-response');
  }
 }
 if(worlds.size>1)throw Error('Participant journals belong to different worlds');
 for(const n of nativeReceipts){
  if(!inventory.has(n.actor)||!cited(n.evidence)){issues.push('Native receipt lacks actor scope or source citation');continue;}
  for(const source of n.evidence)addReceipt(n.actor,n.receipt,time(n.observedAt),source,n.kind==='native-receipt-event'?'native-receipt-event':'explicit-native-observation');
 }
 // Each phase's first native observation is retained. Neither world ticks nor
 // receipt.endedAt (a terminal body pose) are interpreted as UTC timestamps.
 for(const [actor,map] of receipts){
  const target=participants[actor]??fixtureActors[actor];
  for(const list of map.values()){
   const dated=list.filter(x=>x.at!==null).sort((a,b)=>a.at-b.at),ends=dated.filter(x=>terminal(x.receipt)),chosen=ends.at(-1)??dated.at(-1)??list.at(-1),first=dated[0],end=ends.find(x=>x.kind==='native-receipt-event');
   // A late readback proves the terminal state was observed by then. It does
   // not date the actual completion and cannot extend an activity's interval.
   target.receipts.push({...chosen.receipt,observedAcceptedAt:first?.at??null,observedEndedAt:end?.at??null,terminalStateObservedAt:ends[0]?.at??null,timestampEvidence:{accepted:first?{at:first.at,kind:first.kind,source:first.source}:null,terminal:end?{at:end.at,kind:end.kind,source:end.source}:null},evidence:unique(list.map(x=>x.source))});
  }
 }
 const acknowledgements=new Map(),hostDeliveries=new Map();
 for(const {r,source} of entries){
  if(r.kind!=='runtime'||!participants[r.actor])continue;
  const commit=r.state==='events-persisted'?time(r.committedAt):null,notified=r.state==='host-notified'&&['start','steer'].includes(r.mode)&&typeof r.threadId==='string'&&r.threadId.length>0&&typeof r.turnId==='string'&&r.turnId.length>0?time(r.at):null;
  for(const e of r.events??[]){
   if(!['owner','world'].includes(e.source)||typeof e.id!=='string')continue;
   for(const [map,at] of [[acknowledgements,commit],[hostDeliveries,notified]])if(at!==null){const k=key(r.actor,e.source,e.id),prior=map.get(k);if(!prior||at<prior.at)map.set(k,{at,source});}
  }
 }
 const effects=new Map();
 const mergeEffect=e=>{
  if(typeof e?.id!=='string'||!inventory.has(e.actor))return;
  const k=key(e.actor,'effect',e.id),old=effects.get(k);
  if([...effects.values()].some(x=>x.id===e.id&&x.actor!==e.actor)||old&&(['operationId','type'].some(f=>old[f]!==undefined&&e[f]!==undefined&&old[f]!==e[f])||time(old.at)!==null&&time(e.at)!==null&&time(old.at)!==time(e.at)))throw Error('Conflicting native effect identity or timestamp');
  effects.set(k,{...old,...e,at:time(e.at)??old?.at??null,evidence:unique([...(old?.evidence??[]),...(e.evidence??[])])});
 };
 for(const op of operations){
  if(op.status!=='settled'||op.response?.accepted===false||op.response?.error)continue;
  const response=op.response;
  if(op.command==='say'&&typeof response?.said?.id==='string')mergeEffect({id:response.said.id,operationId:op.id,actor:op.actor,type:'speech',at:time(response.said.at),responseObservedAt:op.observedAt,evidence:op.evidence});
  if(op.command==='act'&&typeof response?.receipt?.id==='string')mergeEffect({id:response.receipt.id,operationId:op.id,actor:op.actor,type:'action',at:null,responseObservedAt:op.observedAt,evidence:op.evidence});
  if(op.command==='converse'&&typeof response?.conversation==='string'&&Number.isSafeInteger(response.turn?.seq))mergeEffect({id:`${response.conversation}:turn:${response.turn.seq}`,operationId:op.id,actor:op.actor,type:'conversation-turn',at:time(response.turn.at),evidence:op.evidence});
 }
 for(const e of nativeEffects){if(!cited(e.evidence)){issues.push('Native effect '+e.id+' lacks source citation');continue;}mergeEffect({...e,at:time(e.at)});}
 const declared=new Map();for(const n of [...expectedNotifications,...(audits.notifications?.expected??[])]){
  if(!participants[n.actor]||!['owner','world'].includes(n.source)||typeof n.eventId!=='string')throw Error('Invalid expected notification identity');
  declared.set(key(n.actor,n.source,n.eventId),n);
 }
 for(const [k,event] of received)if(event.source==='owner'||['speech.to-me','mention','conversation.invite','conversation.turn'].includes(event.kind))if(!declared.has(k))declared.set(k,{actor:event.actor,source:event.source,eventId:event.eventId});
 const notifications=[];
 for(const [k,n] of declared){
  const event=received.get(k),commit=acknowledgements.get(k),host=hostDeliveries.get(k),response=responses.find(r=>key(r.actor,r.source,r.eventId)===k),effect=response?[...effects.values()].find(e=>e.id===response.effectId):null;
  if(effect&&response&&effect.respondsToEventId===undefined)effect.respondsToEventId=n.eventId;
  const createdAt=event?.createdAt??(cited(n.evidence)?time(n.createdAt):null);
  const health=audits.healthyWindows?.find(w=>w.actor===n.actor&&createdAt!==null&&time(w.from)!==null&&time(w.to)!==null&&createdAt>=time(w.from)&&createdAt<=time(w.to)&&cited(w.evidence));
  notifications.push({eventId:n.eventId,actor:n.actor,source:n.source,createdAt,receivedAt:event?.receivedAt??null,persistedAt:event&&commit?commit.at:null,notifiedAt:host?.at??null,firstRelevantEffectAt:effect?.at??null,relevantEffectId:response?.effectId??null,relevanceEvidence:response?.evidence??[],...(health?{healthyRunning:true}:{}),evidence:unique([...(event?.evidence??[]),...(commit?[commit.source]:[]),...(host?[host.source]:[]),...(n.evidence??[])])});
 }
 for(const a of run.actors){const from=t0===null?null:t0+(a.releaseOffsetSec??0)*1000,ev=participants[a.id],audit=audits.participants?.[a.id];ev.coverageComplete=scopedAudit(audit,from,cutoff)&&audit.receiptsComplete===true&&dense(ev.samples,from,cutoff,maxSampleGapSec*1000);}
 for(const a of run.fixtureActors??[]){const ev=fixtureActors[a.id],audit=audits.fixtureActors?.[a.id];ev.coverageComplete=scopedAudit(audit,t0,cutoff)&&audit.receiptsComplete===true&&dense(ev.samples,t0,cutoff,maxSampleGapSec*1000);}
 const effectsComplete=scopedAudit(audits.effects,t0,cutoff),notificationsComplete=scopedAudit(audits.notifications,t0,cutoff)&&Array.isArray(audits.notifications.expected)&&Array.isArray(audits.notifications.lostAddressedEventIds)&&audits.notifications.expected.every(n=>declared.has(key(n.actor,n.source,n.eventId)));
 const supplied={};for(const name of ['bindings','fieldReturnBinding','errandReports','disturbances','setup','restart','presentation','semantic','completionAudit','marsReturnTargetRefs','effectAudit'])if(annotations[name]!==undefined)supplied[name]=annotations[name];
 if(!scopedAudit(audits.fixture,t0,cutoff)||audits.fixture?.verified!==true)missing.push('both-arm fixture preflight audit');
 if(!acknowledgements.size)missing.push('post-commit event acknowledgements');if(!hostDeliveries.size)missing.push('acknowledged host notifications');
 return {schema:'continuity-evidence/1',scenarioId,worldId:run.worldId??[...worlds][0]??null,t0, ...supplied,participants,fixtureActors,effects:[...effects.values()],notifications,effectsComplete,notificationsComplete,fixtureVerified:scopedAudit(audits.fixture,t0,cutoff)&&audits.fixture.verified===true,...(notificationsComplete?{lostAddressedEventIds:audits.notifications.lostAddressedEventIds}:{}),adaptation:{schema:'independent-probe-adaptation/1',cutoff,missing,issues,controllerReleases:releases,receivedEvents:[...received.values()].map(({payload,...e})=>e),operations:operations.map(({request,response,...op})=>op),sources:{run:runSource,timeline:timelineSource},limits:'No inferred semantic review, event causality, completeness, native effect timestamp, sealed comparison or soak acceptance. receivedAt is pre-commit intake time; persistedAt is an explicit durable-by acknowledgement. Native receipt timestamps are first observations, not tick-to-UTC conversions.'}};
}

/** Reads exactly the run artifacts and declared participant journals. Opening a
 * journal here never calls openJournal, migrates schema, or changes a cursor. */
export function readIndependentProbeEvidence(directory,options={}){
 const out=resolve(directory);if(lstatSync(out).isSymbolicLink())throw Error('Linked evidence directory refused');
 const read=file=>{const path=join(out,file),stat=lstatSync(path);if(stat.isSymbolicLink()||!stat.isFile())throw Error('Evidence input must be a regular unlinked file');return readFileSync(path,'utf8');};
 const run=JSON.parse(read('run.json')),timeline=[];
 for(const [i,line] of read('timeline.jsonl').split('\n').entries())if(line.trim())timeline.push({...JSON.parse(line),sourcePointer:`timeline.jsonl#L${i+1}`});
 const journals=Object.create(null);
 for(const a of run.actors??[]){
  actorId(a.id);
  if(a.agentEvidence!==undefined){
   if(a.agentEvidence!=='agent-evidence.jsonl')throw Error('Unexpected agent evidence filename');
   const file=`${a.id}/${a.agentEvidence}`;
   if(lstatSync(join(out,a.id)).isSymbolicLink())throw Error('Linked agent evidence directory refused');
   for(const [i,line] of read(file).split('\n').entries())if(line.trim()){
    const r=JSON.parse(line);
    if(r.soulId!==a.soulId||run.worldId!==undefined&&r.worldId!==run.worldId)throw Error('Agent evidence world/Soul scope mismatch');
    timeline.push({...r,actor:a.id,sourcePointer:`${file}#L${i+1}`});
   }
  }
  actorId(a.id);const source=`${a.id}/runtime/continuity.sqlite`,file=join(out,source);let stat;
  try{for(const part of [join(out,a.id),join(out,a.id,'runtime')])if(lstatSync(part).isSymbolicLink())throw Error('Linked evidence journal directory refused');stat=lstatSync(file);}catch(e){if(e.code==='ENOENT')continue;throw e;}
  if(stat.isSymbolicLink()||!stat.isFile())throw Error('Evidence journal must be a regular unlinked file');
  const db=new DatabaseSync(file,{readOnly:true});
  try{
   db.exec('BEGIN');const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name));
   journals[a.id]={source,identity:tables.has('identity')?db.prepare('SELECT world,soul FROM identity WHERE singleton=1').get():null,events:tables.has('events')?db.prepare('SELECT * FROM events ORDER BY seq').all():[],operations:tables.has('operations')?db.prepare('SELECT * FROM operations ORDER BY at,id').all():[]};db.exec('COMMIT');
  }finally{db.close();}
 }
 return adaptIndependentProbe({...options,run,timeline,journals});
}
