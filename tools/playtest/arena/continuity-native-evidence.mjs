// Passive readonly native export. No actor calls, credentials, migrations or
// automatic completeness inferred from a final database snapshot.
import {DatabaseSync} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,lstatSync,realpathSync,mkdirSync,openSync,writeSync,fsyncSync,closeSync,writeFileSync,renameSync} from 'node:fs';
import {join,isAbsolute} from 'node:path';
const hash=x=>createHash('sha256').update(x).digest('hex');
const fail=code=>Object.assign(Error(code),{code});
const json=x=>typeof x==='string'?JSON.parse(x):x;
const canonical=x=>JSON.stringify(x);
const same=(a,b)=>[...a].sort().join('\0')===[...b].sort().join('\0');
const privateJson=(path,value)=>{writeFileSync(path+'.tmp',JSON.stringify(value,null,2)+'\n',{mode:0o600});renameSync(path+'.tmp',path);};
const readFile=(path,max)=>{const s=lstatSync(path);if(!s.isFile()||s.isSymbolicLink()||s.size>max)throw fail('INVALID_NATIVE_EVIDENCE_FILE');return readFileSync(path,'utf8');};
export function readNativeCapture(directory,{maxBytes=1024*1024*1024}={}){
 const status=JSON.parse(readFile(join(directory,'capture-status.json'),65536));
 if(status.schema!=='continuity-native-capture/1'||!Number.isSafeInteger(status.index)||status.index<1)throw fail('INVALID_CAPTURE_STATUS');
 const text=readFile(join(directory,'native-capture.jsonl'),maxBytes),lines=text.split('\n'),records=[];let previousHash='';
 for(let i=0;i<status.index;i++){
  if(!lines[i])throw fail('CAPTURE_PREFIX_MISSING');
  const record=JSON.parse(lines[i]),{hash:actual,...body}=record;
  if(record.index!==i+1||record.previousHash!==previousHash||record.epoch!==status.epoch||record.runId!==status.runId||record.worldId!==status.worldId||hash(canonical(body))!==actual)throw fail('CAPTURE_CHAIN_MISMATCH');
  previousHash=actual;records.push({...record,evidence:`native-capture.jsonl#L${i+1}`});
 }
 if(previousHash!==status.lastHash)throw fail('CAPTURE_STATUS_HASH_MISMATCH');
 return {status,records};
}
const TABLES={
 souls:['id','world_id','entity_id','owner','retired_at'],
 edge_comms_heads:['world_id','soul_id','head','floor'],
 edge_comms_stream:['world_id','soul_id','seq','tick','at','kind','body'],
 edge_comms_speech:['world_id','id','soul_id','tick','at','channel','text','heard_by'],
 edge_comms_turns:['world_id','conversation_id','seq','soul_id','tick','at','text'],
 edge_comms_conversations:['world_id','id','state','created_at','updated_at','body'],
 edge_comms_object_log:['world_id','object_id','version','soul_id','action','params','tick','at'],
 edge_comms_object_refs:['world_id','soul_id','client_ref','response','at'],
 edge_receipts_v1:['world_id','receipt_id','soul_id','capability','phase','accepted_tick','started_tick','ended_tick','code','reason','program_id','client_ref','created_at','detail'],
 edge_refusals_v1:['rowid','world_id','at','tick','soul_id','verb','capability','code','reason','x','z'],
 edge_idempotency_v1:['world_id','soul_id','route','key','hash','status','body','at'],
 soul_inbox_queue_v1:['world_id','scope','owner','n','id','text','sent_at','delivered_at','acknowledged_at','reply','outcome','result','result_at','result_by'],
};
const KEYS={souls:['id'],edge_comms_heads:['soul_id'],edge_comms_stream:['soul_id','seq'],edge_comms_speech:['id'],edge_comms_turns:['conversation_id','seq'],edge_comms_conversations:['id'],edge_comms_object_log:['object_id','version'],edge_comms_object_refs:['soul_id','client_ref'],edge_receipts_v1:['receipt_id'],edge_refusals_v1:['rowid'],edge_idempotency_v1:['soul_id','route','key'],soul_inbox_queue_v1:['scope','owner','n']};
const OPTIONAL=new Set(['result_by']);
export function createNativeEvidenceExporter({databasePath,captureDirectory,directory,runId,worldId,soulIds,maxBytes=128*1024*1024,maxRows=200000,now=Date.now}){
 if(![databasePath,captureDirectory,directory].every(p=>typeof p==='string'&&isAbsolute(p))||!Array.isArray(soulIds)||!soulIds.length||soulIds.length>16||soulIds.some(id=>typeof id!=='string'||!id)||new Set(soulIds).size!==soulIds.length||typeof runId!=='string'||typeof worldId!=='string'||!Number.isSafeInteger(maxBytes)||maxBytes<1024||!Number.isSafeInteger(maxRows)||maxRows<1)throw fail('INVALID_NATIVE_EXPORT_SCOPE');
 const stat=lstatSync(databasePath);if(!stat.isFile()||stat.isSymbolicLink())throw fail('INVALID_NATIVE_DATABASE');
 const initial=readNativeCapture(captureDirectory);
 if(initial.status.databaseIdentity?.dev!==stat.dev||initial.status.databaseIdentity?.ino!==stat.ino)throw fail('CAPTURE_DATABASE_IDENTITY_MISMATCH');
 if(initial.status.databasePath!==databasePath&&realpathSync(initial.status.databasePath)!==realpathSync(databasePath))throw fail('CAPTURE_DATABASE_MISMATCH');
 if(initial.status.worldId!==worldId||initial.status.runId!==runId||!same(initial.status.soulIds,soulIds))throw fail('CAPTURE_SCOPE_MISMATCH');
 const bindings=new Map((initial.status.bindings??[]).map(b=>[b.soulId,b]));if(bindings.size!==soulIds.length||soulIds.some(id=>!bindings.get(id)?.owner||!bindings.get(id)?.bodyId))throw fail('CAPTURE_BINDING_MISSING');
 const db=new DatabaseSync(databasePath,{readOnly:true});let fd;try{mkdirSync(directory,{mode:0o700});fd=openSync(join(directory,'native-snapshots.jsonl'),'wx',0o600);}catch(error){db.close();throw error;}
 const versions=new Map(),rowsByTable=new Map(),snapshots=new Map();let bytes=0,line=0,failure=null,closed=false;
 const epoch=initial.status.epoch,ids=new Set(soulIds),marks=soulIds.map(()=>'?').join(','),baseHeads=new Map(initial.status.startHeads.map(h=>[h.soulId,h.head]));
 const record=value=>{const data=Buffer.from(JSON.stringify(value)+'\n');if(bytes+data.length>maxBytes)throw fail('NATIVE_EXPORT_OVERFLOW');let offset=0;while(offset<data.length){const n=writeSync(fd,data,offset,data.length-offset);if(n<=0)throw fail('NATIVE_EXPORT_SHORT_WRITE');offset+=n;}bytes+=data.length;line++;return `native-snapshots.jsonl#L${line}`;};
 const publish=value=>privateJson(join(directory,'export-status.json'),{schema:'continuity-native-export/1',runId,worldId,epoch,at:now(),closed,failure,bytes,rows:versions.size,...value});
 function poll(){
  if(closed||failure)throw fail(failure??'NATIVE_EXPORT_CLOSED');
  const requestedAt=now(),snapshotId=randomUUID(),missing=[],tables={};let heads=[],scannedRows=0,scannedBytes=0;
  try{
   const sourceStat=lstatSync(databasePath);if(sourceStat.dev!==stat.dev||sourceStat.ino!==stat.ino)throw fail('NATIVE_DATABASE_REPLACED');
   const capture=readNativeCapture(captureDirectory);if(capture.status.epoch!==epoch||capture.status.worldId!==worldId||capture.status.runId!==runId||!same(capture.status.soulIds,soulIds))throw fail('CAPTURE_SCOPE_CHANGED');
   if(capture.status.closed)throw fail('NATIVE_CAPTURE_CLOSED');
   if(capture.status.healthy!==true||capture.status.failure)throw fail('NATIVE_CAPTURE_UNHEALTHY');
   const turnRefs=new Map(),conversationIds=new Set();
   const learn=e=>{if(typeof e?.conversation==='string'){conversationIds.add(e.conversation);if(Number.isSafeInteger(e.turn?.seq)){const list=turnRefs.get(e.conversation)??new Set();list.add(e.turn.seq);turnRefs.set(e.conversation,list);}}};
   for(const r of capture.records)if(r.kind==='recipient-event'&&ids.has(r.soulId))learn(r.event);
   db.exec('BEGIN');
   const exists=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('souls','edge_comms_heads','edge_comms_stream','edge_comms_speech','edge_comms_turns','edge_comms_conversations','edge_comms_object_log','edge_comms_object_refs','edge_receipts_v1','edge_refusals_v1','edge_idempotency_v1','soul_inbox_queue_v1')").all().map(r=>r.name));
   // Owner send inserts MAX(n)+1 before pruning only acknowledged n<=newN-100.
   // Thus native pruning preserves the tail; observed counter resets invalidate.
   const read=(table,where,args)=>{
    if(!exists.has(table)){missing.push(table);return [];}
    const available=new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c=>c.name));
    const cols=TABLES[table].filter(c=>c==='rowid'||available.has(c));
    if(TABLES[table].some(c=>c!=='rowid'&&!available.has(c)&&!OPTIONAL.has(c)))missing.push(table+':columns');
    if(!cols.length)return [];
    const rows=[];for(const source of db.prepare(`SELECT ${cols.join(',')} FROM ${table} WHERE ${where}`).iterate(...args)){const row={...source};scannedRows++;scannedBytes+=Buffer.byteLength(JSON.stringify(row));if(scannedRows>maxRows||scannedBytes>maxBytes)throw fail('NATIVE_EXPORT_SCAN_OVERFLOW');rows.push(row);}return rows;
   };
   tables.souls=read('souls',`world_id=? AND id IN (${marks})`,[worldId,...soulIds]);
   if(tables.souls.length!==soulIds.length||tables.souls.some(s=>s.retired_at!==null||s.owner!==bindings.get(s.id)?.owner||s.entity_id!==bindings.get(s.id)?.bodyId))throw fail('NATIVE_EXPORT_SOUL_SCOPE_CHANGED');
   heads=tables.edge_comms_heads=read('edge_comms_heads',`world_id=? AND soul_id IN (${marks})`,[worldId,...soulIds]);
   tables.edge_comms_stream=read('edge_comms_stream',`world_id=? AND soul_id IN (${marks})`,[worldId,...soulIds]).filter(r=>r.seq>(baseHeads.get(r.soul_id)??Infinity));
   for(const e of tables.edge_comms_stream)learn(json(e.body));
   tables.edge_comms_speech=read('edge_comms_speech',`world_id=? AND (soul_id IN (${marks}) OR EXISTS(SELECT 1 FROM json_each(heard_by) h WHERE h.value IN (${marks})))`,[worldId,...soulIds,...soulIds]);
   const turns=read('edge_comms_turns',`world_id=? AND soul_id IN (${marks})`,[worldId,...soulIds]);
   for(const [conversation,seqs]of turnRefs)for(const seq of seqs)turns.push(...read('edge_comms_turns','world_id=? AND conversation_id=? AND seq=?',[worldId,conversation,seq]));
   tables.edge_comms_turns=[...new Map(turns.map(r=>[JSON.stringify([r.conversation_id,r.seq]),r])).values()];for(const r of turns)conversationIds.add(r.conversation_id);
   const conversations=read('edge_comms_conversations',`world_id=? AND json_extract(body,'$.createdBy') IN (${marks})`,[worldId,...soulIds]);
   for(const id of conversationIds)conversations.push(...read('edge_comms_conversations','world_id=? AND id=?',[worldId,id]));
   tables.edge_comms_conversations=[...new Map(conversations.map(r=>[r.id,r])).values()];
   for(const table of ['edge_comms_object_log','edge_comms_object_refs','edge_receipts_v1','edge_refusals_v1'])tables[table]=read(table,`world_id=? AND soul_id IN (${marks})`,[worldId,...soulIds]);
   const actionRoutes="(route IN ('POST /v1/edge/act','POST /v1/edge/say','POST /v1/edge/converse','POST /v1/edge/plan') OR route LIKE 'PATCH /v1/edge/plan/%' OR route LIKE 'DELETE /v1/edge/plan/%' OR route LIKE 'POST /v1/edge/objects/%/act')";
   tables.edge_idempotency_v1=read('edge_idempotency_v1',`world_id=? AND soul_id IN (${marks}) AND ${actionRoutes}`,[worldId,...soulIds]);
   tables.soul_inbox_queue_v1=[];
   for(const s of tables.souls)tables.soul_inbox_queue_v1.push(...read('soul_inbox_queue_v1','world_id=? AND scope=? AND owner=?',[worldId,'soul:'+s.id,s.owner]));
   db.exec('COMMIT');
   for(const [table,rows]of Object.entries(tables)){
    const remembered=rowsByTable.get(table)??new Map();rowsByTable.set(table,remembered);
    for(const row of rows){const key=JSON.stringify([worldId,...KEYS[table].map(k=>row[k])]),digest=hash(canonical(row)),identity=table+':'+key;if(versions.get(identity)===digest)continue;
     if(!versions.has(identity)&&versions.size>=maxRows)throw fail('NATIVE_EXPORT_ROW_OVERFLOW');
     const evidence=record({schema:'continuity-native-row/1',snapshotId,requestedAt,observedAt:now(),table,key,row,sha256:digest});versions.set(identity,digest);remembered.set(key,{row,evidence});
    }
   }
   const captureGenerationAtEnd=JSON.parse(readFile(join(captureDirectory,'capture-status.json'),65536)).generation;
   const ownerBoundaries=soulIds.map(soulId=>({soulId,owner:bindings.get(soulId).owner,n:Math.max(initial.status.ownerHeads?.find(h=>h.soulId===soulId)?.n??0,...capture.records.filter(r=>r.kind==='capture-heartbeat').flatMap(r=>r.ownerHeads??[]).filter(h=>h.soulId===soulId&&h.owner===bindings.get(soulId).owner).map(h=>h.n))}));
   const snapshot={snapshotId,requestedAt,receivedAt:now(),captureGenerationAtEnd,heads,ownerBoundaries,ownerHeads:soulIds.map(id=>({soulId:id,owner:bindings.get(id).owner,n:Math.max(0,...tables.soul_inbox_queue_v1.filter(r=>r.scope==='soul:'+id).map(r=>r.n))})),missing:[...new Set(missing)],counts:Object.fromEntries(Object.entries(tables).map(([k,v])=>[k,v.length]))};snapshot.evidence=record({schema:'continuity-native-snapshot/1',...snapshot});fsyncSync(fd);snapshots.set(snapshotId,snapshot);publish({lastSnapshot:snapshot});return snapshot;
  }catch(error){if(db.isTransaction)db.exec('ROLLBACK');failure=typeof error.code==='string'&&/^[A-Z0-9_]{1,80}$/.test(error.code)?error.code:'NATIVE_EXPORT_FAILED';try{publish({});}catch{}throw fail(failure);}
 }
 function audit(snapshot,{t0,cutoffAt}={}){
  const missing=[];let capture;
  try{capture=readNativeCapture(captureDirectory);}catch{missing.push('capture chain/status unavailable');}
  const known=snapshots.get(snapshot?.snapshotId);if(!known||known!==snapshot)missing.push('unknown snapshot boundary');
  if(!Number.isFinite(t0)||!Number.isFinite(cutoffAt)||cutoffAt<t0)missing.push('declared trial interval');
  if(failure)missing.push(failure);
  if(snapshot?.missing?.length)missing.push(...snapshot.missing.map(t=>'missing native source '+t));
  if(capture){const s=capture.status;if(s.epoch!==epoch||s.runId!==runId||s.worldId!==worldId||!same(s.soulIds,soulIds))missing.push('capture scope/epoch changed');
   const gap=s.limits?.maxHeartbeatGapMs,beats=capture.records.filter(r=>['capture-start','capture-heartbeat','capture-end'].includes(r.kind)).map(r=>r.observedAt),bracket=beats.filter((time,i)=>time>=t0&&time<=cutoffAt||time<t0&&(beats[i+1]??Infinity)>=t0||time>cutoffAt&&(beats[i-1]??-Infinity)<=cutoffAt);
   if(!Number.isFinite(gap)||gap<1||!bracket.length||bracket[0]>t0||bracket.at(-1)<cutoffAt||bracket.some((time,i)=>i>0&&(time<bracket[i-1]||time-bracket[i-1]>gap)))missing.push('continuous capture heartbeat interval missing');
   if(!s.healthy||s.failure)missing.push('sticky capture failure');if(s.startedAt>t0)missing.push('capture started after T0');
   if(!Number.isSafeInteger(s.generation)||s.generation<=(snapshot?.captureGenerationAtEnd??Infinity)||s.heartbeatAt<(snapshot?.receivedAt??Infinity))missing.push('capture heartbeat has not crossed snapshot boundary');
   if((snapshot?.requestedAt??-Infinity)<cutoffAt)missing.push('snapshot predates cutoff');
   if(s.heads.some(h=>s.lastSeq[h.soulId]!==h.head))missing.push('capture callback high-water mismatch');
   const sequences=new Map(soulIds.map(id=>[id,new Set()]));
   for(const r of capture.records)if(r.kind==='recipient-event'&&sequences.has(r.soulId))sequences.get(r.soulId).add(r.seq);
   for(const {row}of rowsByTable.get('edge_comms_stream')?.values()??[])sequences.get(row.soul_id)?.add(row.seq);
   if(!Array.isArray(s.ownerHeads)||s.ownerHeads.length!==soulIds.length)missing.push('initial owner queue boundary missing');
   else for(const h of s.ownerHeads){const observedMax=snapshot?.ownerBoundaries?.find(q=>q.soulId===h.soulId&&q.owner===h.owner)?.n??h.n;const end=snapshot?.ownerHeads?.find(x=>x.soulId===h.soulId&&x.owner===h.owner)?.n,seen=new Set([...rowsByTable.get('soul_inbox_queue_v1')?.values()??[]].filter(x=>x.row.scope==='soul:'+h.soulId&&x.row.owner===h.owner).map(x=>x.row.n));if(!Number.isSafeInteger(end)||end<h.n||end<observedMax)missing.push('owner queue counter reset '+h.soulId);else for(let n=h.n+1;n<=end;n++)if(!seen.has(n)){missing.push(`owner queue gap ${h.soulId}:${n}..${end}`);break;}}
   for(const id of soulIds){const start=baseHeads.get(id),end=snapshot?.heads?.find(h=>h.soul_id===id)?.head??start;
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||end<start){missing.push('stream head invalid '+id);continue;}
    for(let n=start+1;n<=end;n++)if(!sequences.get(id).has(n)){missing.push(`stream gap ${id}:${n}..${end}; floor=${snapshot.heads.find(h=>h.soul_id===id)?.floor??0}`);break;}
   }
  }
  const result={schema:'continuity-native-coverage/1',runId,worldId,snapshotId:snapshot?.snapshotId,from:t0,to:cutoffAt,status:missing.length?'unknown':'pass',missing,evidence:[snapshot?.evidence,'capture-status.json','native-capture.jsonl'].filter(Boolean),limits:'Coverage of the allowlisted native sources only; no crash-zero-loss, endpoint/cardinality/causal/semantic audit, model incorporation, complete uncached/unsupported-route HTTP request history or qualification pass inferred. World outage is instrumentation unknown.'};
  try{publish({coverage:result});}catch{failure='NATIVE_EXPORT_STATUS_FAILED';result.status='unknown';result.missing.push(failure);}return result;
 }
 return {poll,audit,close(){if(closed)return;closed=true;try{fsyncSync(fd);}finally{closeSync(fd);db.close();}}};
}
