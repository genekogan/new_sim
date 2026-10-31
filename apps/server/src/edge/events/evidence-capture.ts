// Explicit dev-only measurement. Never feeds an actor or changes a native act.
// Each captured record synchronously fsyncs: apply identical capture settings to
// both arms; measurement is bounded and durable, not performance-neutral.
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,lstatSync,realpathSync,mkdirSync,openSync,writeSync,fsyncSync,closeSync,writeFileSync,renameSync} from 'node:fs';
import {isAbsolute,dirname,join} from 'node:path';
import type {Db} from '../../db.ts';
import type {CommsRuntime} from '../comms/index.ts';
import type {StreamEvent} from '../comms/stream.ts';
export type CaptureGate={configPath:string;devAuth:boolean;bindHost:string};
type Scope={runId:string;worldId:string;soulIds:string[];directory:string;maxEvents:number;maxBytes:number;maxHeartbeatGapMs:number};
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
const label=(v:unknown):v is string=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,120}$/.test(v);
const fault=(code:string)=>Object.assign(Error(code),{code});
export function readEvidenceCaptureScope(gate:CaptureGate,worldId:string):Scope{
 if(gate.devAuth!==true||!['127.0.0.1','localhost','::1','[::1]'].includes(gate.bindHost))throw fault('CAPTURE_REQUIRES_LOOPBACK_DEVAUTH');
 if(!isAbsolute(gate.configPath))throw fault('CAPTURE_CONFIG_PATH');
 const stat=lstatSync(gate.configPath);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16384||(stat.mode&0o077)!==0)throw fault('CAPTURE_CONFIG_NOT_PRIVATE');
 const c=JSON.parse(readFileSync(gate.configPath,'utf8'));
 if(!c||typeof c!=='object'||Object.keys(c).some(k=>!['runId','worldId','soulIds','directory','maxEvents','maxBytes','maxHeartbeatGapMs'].includes(k))||!label(c.runId)||c.worldId!==worldId||!Array.isArray(c.soulIds)||!c.soulIds.length||c.soulIds.length>16||!c.soulIds.every(label)||new Set(c.soulIds).size!==c.soulIds.length||typeof c.directory!=='string'||!isAbsolute(c.directory))throw fault('CAPTURE_SCOPE_INVALID');
 const maxEvents=c.maxEvents??100000,maxBytes=c.maxBytes??128*1024*1024,maxHeartbeatGapMs=c.maxHeartbeatGapMs??5000;
 if(!Number.isSafeInteger(maxEvents)||maxEvents<1||maxEvents>1000000||!Number.isSafeInteger(maxBytes)||maxBytes<1024||maxBytes>1024*1024*1024||!Number.isSafeInteger(maxHeartbeatGapMs)||maxHeartbeatGapMs<2000||maxHeartbeatGapMs>60000)throw fault('CAPTURE_LIMIT_INVALID');
 if(realpathSync(dirname(c.directory))!==dirname(c.directory))throw fault('CAPTURE_OUTPUT_PARENT_SYMLINK');
 return {...c,maxEvents,maxBytes,maxHeartbeatGapMs};
}
export function captureNativeEvidence({gate,db,worldId,comms,now=Date.now,write=writeSync,sync=fsyncSync,heartbeatMs=1000}:{gate:CaptureGate;db:Db;worldId:string;comms:CommsRuntime;now?:()=>number;write?:(fd:number,buffer:Uint8Array,offset:number,length:number)=>number;sync?:typeof fsyncSync;heartbeatMs?:number}){
 const scope=readEvidenceCaptureScope(gate,worldId),souls=new Set(scope.soulIds),conversations=new Set<string>(),objects=new Set<string>();
 const binding=(id:string)=>db.db.prepare('SELECT world_id,owner,entity_id,retired_at FROM souls WHERE id=?').get(id) as {world_id:string;owner:string;entity_id:string;retired_at:number|null}|undefined;
 const bindings=scope.soulIds.map(soulId=>{const row=binding(soulId);if(!row||row.world_id!==worldId||row.retired_at!==null||!row.owner||row.owner==='system'||!row.entity_id)throw fault('CAPTURE_SOUL_SCOPE_INVALID');return {soulId,owner:row.owner,bodyId:row.entity_id};});
 const scopeStable=()=>bindings.every(b=>{const row=binding(b.soulId);return row?.world_id===worldId&&row.retired_at===null&&row.owner===b.owner&&row.entity_id===b.bodyId;});
 mkdirSync(scope.directory,{mode:0o700});
 const fd=openSync(join(scope.directory,'native-capture.jsonl'),'wx',0o600),epoch=randomUUID(),startedAt=now(),sourceStat=db.path===':memory:'?null:lstatSync(db.path),databaseIdentity=sourceStat?{dev:sourceStat.dev,ino:sourceStat.ino}:null;
 let lastHeartbeatAt=startedAt;
 let index=0,bytes=0,events=0,generation=0,previousHash='',failure:string|null=null,closed=false,timer:ReturnType<typeof setInterval>|undefined;
 const lastSeq=new Map<string,number>();
 const heads=()=>scope.soulIds.map(soulId=>{const row=db.db.prepare('SELECT head,floor FROM edge_comms_heads WHERE world_id=? AND soul_id=?').get(worldId,soulId) as {head:number;floor:number}|undefined;return {soulId,head:row?.head??0,floor:row?.floor??0};});
 let startHeads:ReturnType<typeof heads>=[];
 const readOwnerHeads=()=>db.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='soul_inbox_queue_v1'").get()?bindings.map(b=>({soulId:b.soulId,owner:b.owner,n:(db.db.prepare('SELECT MAX(n) AS n FROM soul_inbox_queue_v1 WHERE world_id=? AND scope=? AND owner=?').get(worldId,'soul:'+b.soulId,b.owner) as {n:number|null}).n??0})):null;
 const ownerHeads=readOwnerHeads();
 const status=()=>({schema:'continuity-native-capture/1',runId:scope.runId,worldId,epoch,databasePath:db.path,databaseIdentity,soulIds:scope.soulIds,bindings,generation,startedAt,heartbeatAt:now(),closed,healthy:failure===null,failure,index,bytes,events,lastHash:previousHash,startHeads,ownerHeads,heads:heads(),lastSeq:Object.fromEntries(lastSeq),limits:{maxEvents:scope.maxEvents,maxBytes:scope.maxBytes,heartbeatMs,maxHeartbeatGapMs:scope.maxHeartbeatGapMs},limitsNote:'After-commit observer; no crash-zero-loss guarantee. Missing heartbeat, world outage or capture failure invalidates coverage.'});
 const publish=()=>{generation++;try{if(!scopeStable())failure??='CAPTURE_SOUL_SCOPE_CHANGED';const target=join(scope.directory,'capture-status.json'),temp=target+'.tmp';writeFileSync(temp,JSON.stringify(status())+'\n',{mode:0o600});renameSync(temp,target);}catch{failure??='CAPTURE_STATUS_WRITE_FAILED';}};
 const append=(kind:string,data:Record<string,unknown>)=>{
  if(failure||closed)return;
  try{
   if(!scopeStable())throw fault('CAPTURE_SOUL_SCOPE_CHANGED');
   const body={schema:'continuity-native-record/1',runId:scope.runId,worldId,epoch,index:index+1,observedAt:now(),kind,...data,previousHash},raw=JSON.stringify(body),row={...body,hash:hash(raw)},line=Buffer.from(JSON.stringify(row)+'\n');
   if(events>=scope.maxEvents||bytes+line.length>scope.maxBytes)throw fault('CAPTURE_OVERFLOW');
   let offset=0;while(offset<line.length){const n=write(fd,line,offset,line.length-offset);if(!Number.isSafeInteger(n)||n<=0)throw fault('CAPTURE_SHORT_WRITE');offset+=n;}sync(fd);
   bytes+=line.length;index++;events++;previousHash=row.hash;
  }catch(e){failure=['CAPTURE_OVERFLOW','CAPTURE_SOUL_SCOPE_CHANGED'].includes((e as {code?:string}).code??'')?(e as {code:string}).code:'CAPTURE_APPEND_FAILED';publish();}
 };
 const recipient=(soulId:string,event:StreamEvent)=>{
  if(!souls.has(soulId)||closed||failure)return;
  try{
   const seq=Number(event.id.slice(2)),before=lastSeq.get(soulId);
   if(!/^c_[0-9]+$/.test(event.id)||!Number.isSafeInteger(seq)||before===undefined||seq!==before+1){failure??='CAPTURE_SEQUENCE_GAP';publish();return;}
   const e=event as Record<string,any>;if(typeof e.conversation==='string')conversations.add(e.conversation);if(typeof e.object==='string')objects.add(e.object);
   append('recipient-event',{soulId,seq,event});if(!failure)lastSeq.set(soulId,seq);
  }catch{failure??='CAPTURE_EVENT_CALLBACK_FAILED';publish();}
 };
 const spectator=(event:Parameters<Parameters<CommsRuntime['onSpectator']>[0]>[0])=>{
  if(closed||failure)return;
  try{
   const e=event as Record<string,any>,author=e.from?.soulId??e.turn?.from?.soulId??e.soul?.soulId;
   const known=typeof e.conversation==='string'&&conversations.has(e.conversation)||typeof e.object==='string'&&objects.has(e.object);
   const scopedObject=typeof e.object==='string'&&!!db.db.prepare(`SELECT 1 FROM edge_comms_object_log WHERE world_id=? AND object_id=? AND soul_id IN (${scope.soulIds.map(()=>'?').join(',')}) LIMIT 1`).get(worldId,e.object,...scope.soulIds);
   const relevant=scopedObject||souls.has(author)||Array.isArray(e.heardBy)&&e.heardBy.some((id:unknown)=>typeof id==='string'&&souls.has(id))||Array.isArray(e.invited)&&e.invited.some((r:any)=>souls.has(r?.soulId))||known;
   if(!relevant)return;
   if(typeof e.conversation==='string')conversations.add(e.conversation);
   append('public-effect',{event});
  }catch{failure??='CAPTURE_EFFECT_CALLBACK_FAILED';publish();}
 };
 // Installation and the initial boundary are synchronous: no native HTTP action
 // can interleave between subscribing and seeding its per-Soul high-water.
 const offEvent=comms.streams.onEvent(recipient),offSpectator=comms.onSpectator(spectator);
 try{
  startHeads=heads();for(const h of startHeads)lastSeq.set(h.soulId,h.head);
  append('capture-start',{scope:{soulIds:scope.soulIds},startHeads});if(failure)throw fault(failure);
  publish();if(failure)throw fault(failure);
  timer=setInterval(()=>{
   try{const time=now(),tick=comms.core.tick();if(time-lastHeartbeatAt>scope.maxHeartbeatGapMs)failure??='CAPTURE_HEARTBEAT_GAP';if(time<lastHeartbeatAt)failure??='CAPTURE_CLOCK_REVERSED';lastHeartbeatAt=time;append('capture-heartbeat',{tick,heads:heads(),ownerHeads:readOwnerHeads()});}catch{failure??='CAPTURE_HEARTBEAT_FAILED';}publish();
  },heartbeatMs);timer.unref();
 }catch(e){offEvent();offSpectator();closeSync(fd);throw e;}
 return {directory:scope.directory,status,close(){if(closed)return;clearInterval(timer);offEvent();offSpectator();append('capture-end',{endHeads:heads()});closed=true;try{sync(fd);}catch{failure??='CAPTURE_FINAL_SYNC_FAILED';}try{closeSync(fd);}catch{failure??='CAPTURE_CLOSE_FAILED';}publish();}};
}
