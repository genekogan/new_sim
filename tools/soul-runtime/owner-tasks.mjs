// Private local owner intent, independent of model plans and notification state.
// Closed identities/proof remain as tombstones; only open intent has a hard cap.
export const DEFAULT_OWNER_TASK_LIMITS=Object.freeze({tasks:1000,bytes:8*1024*1024});
const DELIVERY_BYTES=32768;
const jsonBytes=value=>Buffer.byteLength(JSON.stringify(value));
const boundedInteger=(v,min,max,name)=>{if(!Number.isSafeInteger(v)||v<min||v>max)throw Error('Invalid owner task '+name);return v;};
const taskId=id=>{if(typeof id!=='string'||!id.length||id.length>200)throw Error('Invalid owner task id');return id;};

// An accepted dispatch or a model's narration is insufficient. This is the
// native terminal record, or readback of that effect, for precisely this call.
function terminalProof(op){
 const call=op.request,args=call?.args,m=op.response?.inbox?.latest;
 if(op.status!=='settled'||call?.type!=='write'||call.command!=='result'||op.response?.accepted===false||op.response?.error||!args||typeof args.id!=='string'||!args.id.length||args.id.length>200||typeof args.text!=='string'||!args.text.trim()||args.text.length>140||/[\r\n]/.test(args.text)||!['done','failed'].includes(args.outcome))return null;
 if(!m||m.id!==args.id||m.state!=='acknowledged'||m.resultBy==='server'||!Number.isFinite(m.resultAt)||m.result!==args.text.trim()||m.outcome!==args.outcome)return null;
 return {id:args.id,outcome:m.outcome,result:m.result,evidence:op.response.reconciliation?.evidence==='observed-native-state'?'observed-native-state':'native-result-response'};
}

export function attachOwnerTasks(db,{now,transaction,control,limits={}}){
 if(!limits||typeof limits!=='object'||Array.isArray(limits)||Object.keys(limits).some(k=>!(k in DEFAULT_OWNER_TASK_LIMITS)))throw Error('Invalid owner task limits');
 const policy=Object.freeze({...DEFAULT_OWNER_TASK_LIMITS,...limits});
 boundedInteger(policy.tasks,0,1000,'limit');boundedInteger(policy.bytes,0,8*1024*1024,'byte limit');
 const stats=()=>{
  const r=db.prepare('SELECT * FROM owner_task_storage_v1 WHERE singleton=1').get();
  return {policy,totalOpen:r.open_tasks,openBytes:r.open_bytes,unknownIntentCount:r.unknown_tasks,closedIdentities:r.closed_tasks};
 };
 const assertCapacity=()=>{
  const s=stats();if(s.totalOpen>policy.tasks||s.openBytes>policy.bytes)throw Object.assign(Error('Owner task backlog full; retain cursor until native results close existing tasks'),{code:'OWNER_TASK_BACKLOG_FULL',transient:true,source:'owner',bucket:'owner-tasks',...s});
 };
 const capture=(row)=>{
  if(db.prepare('SELECT 1 FROM owner_tasks_v1 WHERE id=?').get(row.event_id))return;
  const event=JSON.parse(row.payload),intent=typeof event?.text==='string'?event.text:null,sentAt=Number.isFinite(event?.sentAt)?event.sentAt:null;
  const unknown=intent===null?(row.compacted_at!==null?'compacted-before-owner-task-ledger':'owner-payload-missing-text'):null;
  const bytes=jsonBytes({id:row.event_id,text:intent,sentAt,sourceEventSequence:row.seq,intentUnknown:!!unknown,unknownReason:unknown});
  db.prepare('INSERT INTO owner_tasks_v1(id,event_seq,text,sent_at,unknown_reason,intent_bytes) VALUES(?,?,?,?,?,?)').run(row.event_id,row.seq,intent,sentAt,unknown,bytes);
 };
 const close=(op)=>{
  const proof=terminalProof(op);if(!proof)return {closed:false};
  const old=db.prepare('SELECT closed_at FROM owner_tasks_v1 WHERE id=?').get(proof.id);
  if(old&&old.closed_at!==null)return {closed:true,alreadyClosed:true,id:proof.id};
  // A result may precede intake. A closed identity prevents its later owner
  // page (or a restart migration) from reopening a completed request.
  db.prepare(`INSERT INTO owner_tasks_v1(id,intent_bytes,closed_at,outcome,result,operation_id,evidence) VALUES(?,0,?,?,?,?,?)
   ON CONFLICT(id) DO UPDATE SET text=NULL,sent_at=NULL,unknown_reason=NULL,intent_bytes=0,closed_at=excluded.closed_at,outcome=excluded.outcome,result=excluded.result,operation_id=excluded.operation_id,evidence=excluded.evidence`).run(proof.id,now(),proof.outcome,proof.result,op.id,proof.evidence);
  return {closed:true,alreadyClosed:false,id:proof.id,evidence:proof.evidence};
 };
 transaction(()=>{
  db.exec(`CREATE TABLE IF NOT EXISTS owner_tasks_v1(id TEXT PRIMARY KEY,event_seq INTEGER UNIQUE,text TEXT,sent_at INTEGER,unknown_reason TEXT,intent_bytes INTEGER NOT NULL,closed_at INTEGER,outcome TEXT,result TEXT,operation_id TEXT,evidence TEXT);
   CREATE INDEX IF NOT EXISTS owner_tasks_open_v1 ON owner_tasks_v1(event_seq) WHERE closed_at IS NULL;
   CREATE TABLE IF NOT EXISTS owner_task_storage_v1(singleton INTEGER PRIMARY KEY CHECK(singleton=1),open_tasks INTEGER NOT NULL,open_bytes INTEGER NOT NULL,unknown_tasks INTEGER NOT NULL,closed_tasks INTEGER NOT NULL);`);
  const migrate=!db.prepare('SELECT 1 FROM owner_task_storage_v1 WHERE singleton=1').get();
  if(migrate)db.exec('INSERT INTO owner_task_storage_v1 VALUES(1,0,0,0,0)');
  const contribution=p=>({open_tasks:`(${p}.closed_at IS NULL)`,open_bytes:`CASE WHEN ${p}.closed_at IS NULL THEN ${p}.intent_bytes ELSE 0 END`,unknown_tasks:`(${p}.closed_at IS NULL AND ${p}.unknown_reason IS NOT NULL)`,closed_tasks:`(${p}.closed_at IS NOT NULL)`});
  for(const kind of ['INSERT','UPDATE']){
   const fresh=contribution('NEW'),old=contribution('OLD');
   db.exec(`CREATE TRIGGER IF NOT EXISTS owner_tasks_${kind.toLowerCase()}_v1 AFTER ${kind} ON owner_tasks_v1 BEGIN UPDATE owner_task_storage_v1 SET ${Object.keys(fresh).map(k=>`${k}=${k}+(${fresh[k]})${kind==='UPDATE'?`-(${old[k]})`:''}`).join(',')} WHERE singleton=1; END;`);
  }
  if(migrate){
   for(const row of db.prepare("SELECT seq,event_id,payload,compacted_at FROM events WHERE source='owner' ORDER BY seq").iterate())capture(row);
   for(const row of db.prepare("SELECT id,request,status,response FROM operations WHERE status='settled' AND json_extract(request,'$.command')='result' AND json_extract(request,'$.type')='write' ORDER BY at,id").iterate())close({...row,request:JSON.parse(row.request),response:JSON.parse(row.response)});
  }
  // Refuse an excessive legacy backlog explicitly; never discard old intent
  // or commit a partially populated ledger to make migration appear complete.
  assertCapacity();
 });
 const project=r=>({id:r.id,sourceEventSequence:r.event_seq,text:r.text,sentAt:r.sent_at,intentUnknown:r.unknown_reason!==null,...(r.unknown_reason?{unknownReason:r.unknown_reason}:{})});
 return {
  capture,assertCapacity,stats,
  closeFromOperation(fence,id){return transaction(()=>{control.assertOwner(fence);return close(control.operation(id));});},
  page({after=0,limit=20}={}){
   boundedInteger(after,0,Number.MAX_SAFE_INTEGER,'cursor');boundedInteger(limit,1,20,'page limit');
   const rows=db.prepare('SELECT * FROM owner_tasks_v1 WHERE closed_at IS NULL AND event_seq>? ORDER BY event_seq LIMIT ?').all(after,limit),s=stats();
   const remaining=db.prepare('SELECT COUNT(*) AS n FROM owner_tasks_v1 WHERE closed_at IS NULL AND event_seq>?').get(after).n;
   // Reserve identity metadata for every selected task before fitting text.
   // Native owner messages are <=1000 characters; legacy larger payloads can
   // always be read exactly using bounded local task(id,offset) chunks.
   const result={tasks:rows.map(r=>({...project(r),text:r.text===null?null:undefined,...(r.text===null?{}:{textOmitted:true,textCharacters:[...r.text].length,retrieve:{command:'task',args:{id:r.id,offset:0}}})})),totalOpen:s.totalOpen,unknownIntentCount:s.unknownIntentCount,nextCursor:remaining>rows.length?rows.at(-1).event_seq:null,omitted:s.totalOpen-rows.length};
   for(let i=0;i<rows.length;i++){
    const previous=result.tasks[i];result.tasks[i]=project(rows[i]);
    if(jsonBytes(result)>DELIVERY_BYTES)result.tasks[i]=previous;
   }
   if(jsonBytes(result)>DELIVERY_BYTES)throw Error('Owner task identity projection exceeds delivery bound');
   return result;
  },
  task({id,offset=0}={}){
   taskId(id);boundedInteger(offset,0,65536,'text offset');
   const row=db.prepare('SELECT * FROM owner_tasks_v1 WHERE id=? AND closed_at IS NULL').get(id);
   if(!row)return {task:null,note:'No open local owner task with this id'};
   const characters=row.text===null?[]:[...row.text];if(offset>characters.length)throw Error('Owner task text offset exceeds length');
   const result={task:{...project(row),text:row.text===null?null:'',textOffset:offset,textCharacters:characters.length,nextOffset:null}};
   let low=0,high=characters.length-offset;
   while(low<high){const mid=Math.ceil((low+high)/2);result.task.text=characters.slice(offset,offset+mid).join('');result.task.nextOffset=offset+mid<characters.length?offset+mid:null;if(jsonBytes(result)<=DELIVERY_BYTES)low=mid;else high=mid-1;}
   result.task.text=row.text===null?null:characters.slice(offset,offset+low).join('');result.task.nextOffset=offset+low<characters.length?offset+low:null;
   return result;
  },
 };
}
