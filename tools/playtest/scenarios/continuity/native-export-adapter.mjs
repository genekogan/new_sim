// Passive, bounded normalization only. Causality, logical writes, semantic
// review and final completeness remain explicit caller/reviewer inputs.
import {createHash} from 'node:crypto';
import {readFileSync,lstatSync,realpathSync} from 'node:fs';
import {isAbsolute,join} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {readNativeCapture} from '../../arena/continuity-native-evidence.mjs';
import {classify} from '../../../../apps/server/src/edge/events/envelope.ts';
const fail=code=>Object.assign(Error(code),{code});
const hash=x=>createHash('sha256').update(x).digest('hex');
const obj=x=>x&&typeof x==='object'&&!Array.isArray(x);
const label=x=>typeof x==='string'&&/^[-A-Za-z0-9_]{1,120}$/.test(x);
const cited=x=>Array.isArray(x)&&x.length>0&&x.every(s=>typeof s==='string'&&s.trim());
const time=x=>typeof x==='number'&&Number.isFinite(x)?x:typeof x==='string'&&/(Z|[+-]\d\d:\d\d)$/.test(x)&&Number.isFinite(Date.parse(x))?Date.parse(x):null;
const decode=x=>typeof x==='string'?JSON.parse(x):x;
const equal=(a,b)=>isDeepStrictEqual(a,b);
const unique=x=>[...new Set(x)];
const KEYS={souls:['id'],edge_comms_heads:['soul_id'],edge_comms_stream:['soul_id','seq'],edge_comms_speech:['id'],edge_comms_turns:['conversation_id','seq'],edge_comms_conversations:['id'],edge_comms_object_log:['object_id','version'],edge_comms_object_refs:['soul_id','client_ref'],edge_receipts_v1:['receipt_id'],edge_refusals_v1:['rowid'],edge_idempotency_v1:['soul_id','route','key'],soul_inbox_queue_v1:['scope','owner','n']};
// Frozen exporter projection; unexpected columns are refused rather than
// accidentally forwarding a dump/credential-bearing source under this schema.
const COLUMNS={
 souls:'id world_id entity_id owner retired_at',
 edge_comms_heads:'world_id soul_id head floor',
 edge_comms_stream:'world_id soul_id seq tick at kind body',
 edge_comms_speech:'world_id id soul_id tick at channel text heard_by',
 edge_comms_turns:'world_id conversation_id seq soul_id tick at text',
 edge_comms_conversations:'world_id id state created_at updated_at body',
 edge_comms_object_log:'world_id object_id version soul_id action params tick at',
 edge_comms_object_refs:'world_id soul_id client_ref response at',
 edge_receipts_v1:'world_id receipt_id soul_id capability phase accepted_tick started_tick ended_tick code reason program_id client_ref created_at detail',
 edge_refusals_v1:'rowid world_id at tick soul_id verb capability code reason x z',
 edge_idempotency_v1:'world_id soul_id route key hash status body at',
 soul_inbox_queue_v1:'world_id scope owner n id text sent_at delivered_at acknowledged_at reply outcome result result_at result_by',
};
const paths=(directory,file)=>join(directory,file);
function read(path,max){const s=lstatSync(path);if(!s.isFile()||s.isSymbolicLink()||s.size>max)throw fail('NATIVE_INPUT_FILE_INVALID');return readFileSync(path);}

/** run.runId is explicit and frozen; directory names never establish identity.
 * Optional nameStabilityAudit={complete:true,from,to,evidence} plus actor
 * publicName/nameEvidence enables the existing native speech classifier.
 * No annotations/responses/audits are manufactured or consumed here. */
export function readNativeExportInputs({run,captureDirectory,exportDirectory,coverage,maxBytes=128*1024*1024,maxRows=200000,nameStabilityAudit=null}){
 if(!obj(run)||!label(run.runId)||!label(run.worldId)||!Array.isArray(run.actors)||!run.actors.length||!Array.isArray(run.fixtureActors??[])||!Number.isSafeInteger(maxBytes)||maxBytes<1024||maxBytes>1024*1024*1024||!Number.isSafeInteger(maxRows)||maxRows<1||maxRows>1000000)throw fail('NATIVE_INPUT_SCOPE_INVALID');
 for(const dir of [captureDirectory,exportDirectory])if(typeof dir!=='string'||!isAbsolute(dir)||realpathSync(dir)!==dir||!lstatSync(dir).isDirectory())throw fail('NATIVE_INPUT_DIRECTORY_INVALID');
 const people=[...run.actors,...(run.fixtureActors??[])];
 if(people.length>16||people.some(a=>!label(a.id)||!label(a.soulId))||new Set(people.map(a=>a.id)).size!==people.length||new Set(people.map(a=>a.soulId)).size!==people.length)throw fail('NATIVE_INPUT_ACTOR_SCOPE_INVALID');
 const actors=new Map(people.map(a=>[a.soulId,a])),participants=new Set(run.actors.map(a=>a.id));
 const t0=time(run.t0)??time(run.startedAt),cutoff=time(run.cutoffAt);
 if(t0===null||cutoff===null||cutoff<t0||people.some(a=>a.releaseOffsetSec!==undefined&&(!Number.isFinite(a.releaseOffsetSec)||a.releaseOffsetSec<0)))throw fail('NATIVE_INPUT_INTERVAL_INVALID');
 const statusPath=paths(exportDirectory,'export-status.json'),capturePath=paths(captureDirectory,'native-capture.jsonl'),exportPath=paths(exportDirectory,'native-snapshots.jsonl');
 const capture=readNativeCapture(captureDirectory,{maxBytes}),s=capture.status,status=JSON.parse(read(statusPath,65536));
 if(capture.records.length>maxRows||s.runId!==run.runId||s.worldId!==run.worldId||!Array.isArray(s.soulIds)||!equal([...s.soulIds].sort(),[...actors.keys()].sort())||status.schema!=='continuity-native-export/1'||status.runId!==run.runId||status.worldId!==run.worldId||status.epoch!==s.epoch)throw fail('NATIVE_INPUT_SOURCE_SCOPE_MISMATCH');
 const bindings=new Map((s.bindings??[]).map(b=>[b.soulId,b]));
 if(bindings.size!==actors.size||[...actors.keys()].some(id=>!bindings.get(id)?.owner||!bindings.get(id)?.bodyId))throw fail('NATIVE_INPUT_BINDING_MISSING');
 const raw=read(exportPath,maxBytes);if(raw.length+lstatSync(capturePath).size>maxBytes||!Number.isSafeInteger(status.bytes)||status.bytes<0||status.bytes>raw.length)throw fail('NATIVE_INPUT_BOUND_EXCEEDED');
 const prefix=raw.subarray(0,status.bytes).toString('utf8');if(prefix&&!prefix.endsWith('\n'))throw fail('NATIVE_EXPORT_PREFIX_INCOMPLETE');
 const records=prefix.split('\n').filter(Boolean).map((line,i)=>({...JSON.parse(line),sourcePointer:`${exportPath}#L${i+1}`}));if(records.length+capture.records.length>maxRows)throw fail('NATIVE_INPUT_ROW_BOUND_EXCEEDED');
 const snapshots=new Map(),versions=[],missing=[],issues=[],uniqueKeys=new Set();
 for(const r of records){
  if(r.schema==='continuity-native-snapshot/1'){
   if(typeof r.snapshotId!=='string'||snapshots.has(r.snapshotId)||time(r.requestedAt)===null||time(r.receivedAt)===null||r.receivedAt<r.requestedAt)throw fail('NATIVE_SNAPSHOT_IDENTITY_INVALID');snapshots.set(r.snapshotId,r);
  }else if(r.schema==='continuity-native-row/1'){
   if(!KEYS[r.table]||!obj(r.row)||KEYS[r.table].some(k=>!(typeof r.row[k]==='string'&&r.row[k].length>0)&&!(Number.isSafeInteger(r.row[k])&&r.row[k]>=0))||r.row.world_id!==run.worldId||hash(JSON.stringify(r.row))!==r.sha256||r.key!==JSON.stringify([run.worldId,...KEYS[r.table].map(k=>r.row[k])]))throw fail('NATIVE_SOURCE_HASH_OR_KEY_MISMATCH');
   const row=r.row,actor=actors.get(row.soul_id??row.id);
   if(Object.keys(row).some(k=>!COLUMNS[r.table].split(' ').includes(k)))throw fail('NATIVE_SOURCE_COLUMN_NOT_ALLOWLISTED');
   if(r.table==='souls'&&(!actor||row.owner!==bindings.get(actor.soulId)?.owner||row.entity_id!==bindings.get(actor.soulId)?.bodyId||row.retired_at!==null))throw fail('NATIVE_SOUL_BINDING_CONFLICT');
   if(['edge_comms_heads','edge_comms_stream','edge_comms_object_log','edge_comms_object_refs','edge_receipts_v1','edge_refusals_v1','edge_idempotency_v1'].includes(r.table)&&!actors.has(row.soul_id))throw fail('NATIVE_ROW_SOUL_SCOPE_MISMATCH');
   if(r.table==='soul_inbox_queue_v1'){const id=typeof row.scope==='string'?row.scope.slice(5):null;if(row.scope!=='soul:'+id||!actors.has(id)||row.owner!==bindings.get(id)?.owner)throw fail('NATIVE_OWNER_SCOPE_MISMATCH');}
   uniqueKeys.add(r.table+':'+r.key);versions.push(r);
  }else throw fail('NATIVE_EXPORT_RECORD_SCHEMA_INVALID');
 }
 if(uniqueKeys.size!==status.rows)throw fail('NATIVE_EXPORT_ROW_COUNT_MISMATCH');
 for(const r of versions){const snap=snapshots.get(r.snapshotId);if(!snap||r.requestedAt!==snap.requestedAt||time(r.observedAt)===null||r.observedAt<r.requestedAt||r.observedAt>snap.receivedAt)throw fail('NATIVE_ROW_SNAPSHOT_PROVENANCE_INVALID');}
 if(!obj(coverage)||coverage.schema!=='continuity-native-coverage/1'||coverage.runId!==run.runId||coverage.worldId!==run.worldId||time(coverage.from)!==t0||time(coverage.to)!==cutoff||!['pass','unknown'].includes(coverage.status)||!snapshots.has(coverage.snapshotId)||!equal(status.coverage,coverage))throw fail('NATIVE_COVERAGE_PROVENANCE_MISMATCH');
 const final=snapshots.get(coverage.snapshotId);if(final.requestedAt<cutoff)missing.push('final native snapshot predates cutoff');
 if(coverage.status!=='pass'||status.failure||!s.healthy||s.failure)missing.push('allowlisted native source coverage is not healthy/pass');
 const inWindow=(actor,at)=>{const a=people.find(p=>p.id===actor),from=t0+(participants.has(actor)?a?.releaseOffsetSec??0:0)*1000;return Number.isFinite(at)&&at>=from&&at<=cutoff;};
 const pointer=r=>`${capturePath}#L${r.index}`;
 const native={recipientEvents:[],publicEvents:[],ownerMessages:[],receiptVersions:[],objectVersions:[],operationResponses:[],refusals:[],rowVersions:versions,snapshots:[...snapshots.values()],foreignAuthorFacts:[]};
 const eventMap=new Map(),effectMap=new Map(),receiptIdentity=new Map(),ownerIdentity=new Map(),ownerIds=new Map();
 const addEvent=(soulId,event,source)=>{
  if(!actors.has(soulId)||!obj(event)||!/^c_[0-9]+$/.test(event.id)||!Number.isFinite(event.at)||typeof event.kind!=='string')throw fail('NATIVE_RECIPIENT_IDENTITY_INVALID');
  const key=JSON.stringify([run.worldId,soulId,event.id]),old=eventMap.get(key);if(old&&!equal(old.event,event))throw fail('NATIVE_RECIPIENT_PAYLOAD_CONFLICT');
  if(old){old.evidence=unique([...old.evidence,source]);return;}eventMap.set(key,{worldId:run.worldId,soulId,actor:actors.get(soulId).id,event,evidence:[source]});
 };
 const addEffect=e=>{
  if(typeof e.id!=='string'||!e.id||!cited(e.evidence)||e.at!==null&&!Number.isFinite(e.at))throw fail('NATIVE_EFFECT_IDENTITY_INVALID');
  const old=effectMap.get(e.id);if(old){for(const k of ['actor','soulId','type','text','at','nativeIdentity','heardBy','channel','conversation','seq','object','version','action','params','capability'])if(old[k]!==undefined&&old[k]!==null&&e[k]!==undefined&&e[k]!==null&&!equal(old[k],e[k]))throw fail('NATIVE_EFFECT_IDENTITY_CONFLICT');effectMap.set(e.id,{...old,...e,at:e.at??old.at,evidence:unique([...old.evidence,...e.evidence])});}else effectMap.set(e.id,e);
 };
 const effect=(soulId,value)=>{if(typeof soulId!=='string'||!soulId)throw fail('NATIVE_EFFECT_AUTHOR_MISSING');const a=actors.get(soulId);addEffect({...(a?{actor:a.id}:{}),soulId,...value});};
 const addReceipt=(soulId,receipt,observedAt,source,kind)=>{
  if(!actors.has(soulId)||!obj(receipt)||typeof receipt.id!=='string'||typeof receipt.capability!=='string'||receipt.soulId!==undefined&&receipt.soulId!==soulId)throw fail('NATIVE_RECEIPT_IDENTITY_INVALID');
  const identity=receiptIdentity.get(receipt.id),expected=[soulId,receipt.capability];if(identity&&!equal(identity,expected))throw fail('NATIVE_RECEIPT_IDENTITY_CONFLICT');receiptIdentity.set(receipt.id,expected);
  native.receiptVersions.push({actor:actors.get(soulId).id,receipt:{...receipt,soulId},observedAt,kind,evidence:[source]});
  effect(soulId,{id:receipt.id,type:'action',at:null,capability:receipt.capability,nativeIdentity:[run.worldId,receipt.id],evidence:[source]});
 };
 for(const r of capture.records){
  if(r.kind==='recipient-event'){if(r.seq!==Number(r.event?.id?.slice(2)))throw fail('NATIVE_RECIPIENT_SEQUENCE_MISMATCH');addEvent(r.soulId,r.event,pointer(r));}
  else if(r.kind==='public-effect'){if(!obj(r.event))throw fail('NATIVE_PUBLIC_EVENT_INVALID');native.publicEvents.push({event:r.event,observedAt:r.observedAt,evidence:[pointer(r)]});}
 }
 for(const r of versions){const row=r.row,source=r.sourcePointer;
  if(r.table==='edge_comms_stream'){const body=decode(row.body);if(!obj(body)||['id','kind','tick','at'].some(k=>Object.hasOwn(body,k)))throw fail('NATIVE_STREAM_RESERVED_FIELD_CONFLICT');addEvent(row.soul_id,{...body,id:'c_'+row.seq,kind:row.kind,tick:row.tick,at:row.at},source);}
  if(r.table==='edge_comms_speech')effect(row.soul_id,{id:row.id,type:'speech',at:row.at,text:row.text,heardBy:decode(row.heard_by),channel:decode(row.channel),nativeIdentity:[run.worldId,row.id],evidence:[source]});
  if(r.table==='edge_comms_conversations'){const body=decode(row.body);if(typeof body?.createdBy==='string')effect(body.createdBy,{id:`${row.id}:start`,type:'conversation-start',at:row.created_at,conversation:row.id,nativeIdentity:[run.worldId,row.id,'start'],evidence:[source]});}
  if(r.table==='edge_comms_turns')effect(row.soul_id,{id:`${row.conversation_id}:turn:${row.seq}`,type:'conversation-turn',at:row.at,text:row.text,conversation:row.conversation_id,seq:row.seq,nativeIdentity:[run.worldId,row.conversation_id,row.seq],evidence:[source]});
  if(r.table==='edge_comms_object_log'){native.objectVersions.push(r);effect(row.soul_id,{id:`object:${row.object_id}:version:${row.version}`,type:'object-action',at:row.at,object:row.object_id,version:row.version,action:row.action,params:decode(row.params),nativeIdentity:[run.worldId,row.object_id,row.version],evidence:[source]});}
  if(r.table==='edge_receipts_v1'){
   // Partial raw ledger history, not ledger.view(): a stored started phase may
   // be presented publicly as waiting for an invitation. Outcomes are not in
   // this projection. Actual activity comes from body samples, not this phase.
   const receipt={...decode(row.detail??'{}'),id:row.receipt_id,capability:row.capability,phase:row.phase,acceptedTick:row.accepted_tick,startedTick:row.started_tick,endedTick:row.ended_tick,code:row.code,reason:row.reason,clientRef:row.client_ref};
   addReceipt(row.soul_id,receipt,r.observedAt,source,'explicit-native-observation');effect(row.soul_id,{id:row.receipt_id,type:'action',at:row.created_at,capability:row.capability,nativeIdentity:[run.worldId,row.receipt_id],evidence:[source]});
  }
  if(r.table==='soul_inbox_queue_v1'){
   const soulId=row.scope.slice(5),identity=JSON.stringify([run.worldId,row.scope,row.owner,row.n]),immutable=[row.id,row.text,row.sent_at],old=ownerIdentity.get(identity);
   if(old&&!equal(old,immutable))throw fail('NATIVE_OWNER_IDENTITY_CONFLICT');const idKey=JSON.stringify([row.scope,row.owner,row.id]),oldN=ownerIds.get(idKey);if(oldN!==undefined&&oldN!==row.n)throw fail('NATIVE_OWNER_IDENTITY_CONFLICT');ownerIds.set(idKey,row.n);ownerIdentity.set(identity,immutable);native.ownerMessages.push({actor:actors.get(soulId).id,row,observedAt:r.observedAt,evidence:[source]});
  }
  if(['edge_idempotency_v1','edge_comms_object_refs'].includes(r.table))native.operationResponses.push(r);
  if(r.table==='edge_refusals_v1')native.refusals.push(r);
 }
 // Live effects supplement rows lost before reconciliation. Membership/closure
 // and object messages without canonical action IDs remain raw facts, never a
 // guessed write author or fabricated native effect identity.
 for(const r of native.publicEvents){const e=r.event,source=r.evidence;
  if(e.kind==='speech'&&typeof e.id==='string')effect(e.from?.soulId,{id:e.id,type:'speech',at:null,text:e.text,heardBy:e.heardBy,channel:e.channel,nativeIdentity:[run.worldId,e.id],evidence:source});
  else if(e.kind==='conversation.turn'&&typeof e.conversation==='string'&&Number.isSafeInteger(e.turn?.seq))effect(e.turn.from?.soulId,{id:`${e.conversation}:turn:${e.turn.seq}`,type:'conversation-turn',at:e.turn.at,text:e.turn.text,conversation:e.conversation,seq:e.turn.seq,nativeIdentity:[run.worldId,e.conversation,e.turn.seq],evidence:source});
  else if(e.kind==='conversation.start'&&typeof e.conversation==='string')effect(e.from?.soulId,{id:`${e.conversation}:start`,type:'conversation-start',at:null,conversation:e.conversation,nativeIdentity:[run.worldId,e.conversation,'start'],evidence:source});
  else issues.push('raw public event requires canonical identity/authorship review: '+e.kind);
 }
 native.recipientEvents=[...eventMap.values()];const expected=new Map();
 const stableNames=nameStabilityAudit?.complete===true&&time(nameStabilityAudit.from)===t0&&time(nameStabilityAudit.to)===cutoff&&cited(nameStabilityAudit.evidence);
 for(const fact of native.recipientEvents){const {event:e,soulId,actor,evidence}=fact,a=actors.get(soulId),nameKnown=stableNames&&typeof a.publicName==='string'&&a.publicName.trim()&&cited(a.nameEvidence);
  const classified=e.kind==='speech'?classify(e,{soulId,name:nameKnown?a.publicName:''}).kind:e.kind;fact.classifiedKind=classified;fact.classificationEvidence=nameKnown?[...a.nameEvidence,...nameStabilityAudit.evidence]:[];
  if(e.kind==='speech'&&!nameKnown)missing.push('native recipient public-name stability for '+actor);
  const receipt=e.receipt??e.data?.receipt;if(receipt&&e.kind==='receipt')addReceipt(soulId,receipt,e.at,evidence[0],'native-receipt-event');
  if(participants.has(actor)&&inWindow(actor,e.at)&&['speech.to-me','mention','conversation.invite','conversation.turn','invite'].includes(classified))expected.set(JSON.stringify([actor,'world',e.id]),{actor,source:'world',eventId:e.id,createdAt:e.at,evidence:unique([...evidence,...fact.classificationEvidence])});
 }
 for(const {actor,row,evidence}of native.ownerMessages)if(participants.has(actor)&&inWindow(actor,row.sent_at))expected.set(JSON.stringify([actor,'owner',row.id]),{actor,source:'owner',eventId:row.id,createdAt:row.sent_at,evidence});
 native.foreignAuthorFacts=[...effectMap.values()].filter(e=>!e.actor);
 const nativeEffects=[...effectMap.values()].filter(e=>e.actor&&inWindow(e.actor,e.at));
 // Null-timestamp effects remain visible in raw facts; they cannot be granted
 // behavioral timing merely from collector observation time.
 const undated=[...effectMap.values()].filter(e=>!Number.isFinite(e.at));if(undated.length)missing.push('native effect timestamps for '+undated.map(e=>e.id).join(','));
 missing.push('complete endpoint/operation enumeration and cardinality audit','source-cited causal response linkage and cross-key intent review','fixture/body/agent-read/semantic audits');
 return {schema:'continuity-native-inputs/1',inputs:{nativeEffects,nativeReceipts:native.receiptVersions.filter(r=>r.observedAt<=cutoff),expectedNotifications:[...expected.values()]},native:{...native,undatedEffects:undated},mechanical:{runId:run.runId,worldId:run.worldId,epoch:s.epoch,interval:{from:t0,to:cutoff},sourceCoverage:coverage.status,status:missing.length?'unknown':'pass',missing:unique(missing),issues:unique(issues),sourceCoverageEvidence:[statusPath,`${exportPath}#L${records.indexOf(final)+1}`,paths(captureDirectory,'capture-status.json')],limits:'Source coverage is not effectsComplete, notificationsComplete, model incorporation or qualification. Captured events prove native delivery, not client persistence or host receipt. Pre-release/post-cutoff facts remain raw only; receipt history may establish initial ongoing activity without crediting early behavior.'},sources:{capture:capturePath,export:exportPath,status:statusPath}};
}
