// Private durable candidate storage. No HTTP, host activation or historical repair.
import { z } from 'zod';
import { hashOf } from '@sim/engine-contract';
import { createSoulSchema, lifecycleRequestIdSchema, lifecycleCursorSchema, type LogEvent } from '@sim/protocol';
import type { Db, SoulRow } from './db.ts';

const id=z.string().min(1).max(128);
const scopeSchema=z.object({worldId:id,soulId:id,owner:id,entityId:id}).strict();
const birthSchema=createSoulSchema.extend({native:z.boolean()}).strict();
const bodySchema=z.object({scope:scopeSchema,name:z.string().min(2).max(32),description:z.string().max(1200),native:z.boolean()}).strict();
export type LifecycleScope=z.infer<typeof scopeSchema>;
export type LifecycleOperation={requestId:string;scope:LifecycleScope;operation:'create'|'retire';state:'pending'|'recorded'|'complete'|'refused';
  name:string;description:string;native:boolean;revision:number;requestedAt:number;retirementAccepted:boolean;
  fact:{seq:number;tick:number;hash:string}|null;terminal:{seq:number;tick:number;hash:string}|null};
type Row={world_id:string;request_id:string;soul_id:string;owner_id:string;entity_id:string;operation:LifecycleOperation['operation'];state:LifecycleOperation['state'];
  body:string;body_hash:string;revision:number;requested_at:number;seq:number|null;tick:number|null;event_hash:string|null;
  terminal_seq:number|null;terminal_tick:number|null;terminal_hash:string|null};
type Guard=()=>boolean;

export class LifecycleJournal {
  db:Db;
  constructor(db:Db){this.db=db;}
  private transaction<T>(fn:()=>T):T{
    this.db.db.exec('BEGIN IMMEDIATE');
    try{const out=fn();this.db.db.exec('COMMIT');return out;}catch(error){this.db.db.exec('ROLLBACK');throw error;}
  }
  private guarded(guard:Guard){if(guard()!==true)throw new Error('Lifecycle acceptance authority changed');}
  private row(scope:LifecycleScope,requestId:string){return this.db.db.prepare('SELECT * FROM lifecycle_operations_v1 WHERE world_id=? AND request_id=? AND soul_id=? AND owner_id=? AND entity_id=?').get(scope.worldId,requestId,scope.soulId,scope.owner,scope.entityId) as Row|undefined;}
  private decode(row:Row):LifecycleOperation{
    const body=bodySchema.parse(JSON.parse(row.body));
    if(hashOf(body)!==row.body_hash||body.scope.worldId!==row.world_id||body.scope.soulId!==row.soul_id||body.scope.owner!==row.owner_id||body.scope.entityId!==row.entity_id)
      throw new Error('Lifecycle stored identity is inconsistent');
    const retirementAccepted=!!this.db.db.prepare("SELECT 1 FROM lifecycle_operations_v1 WHERE world_id=? AND soul_id=? AND owner_id=? AND entity_id=? AND operation='retire'").get(row.world_id,row.soul_id,row.owner_id,row.entity_id);
    return {requestId:row.request_id,scope:body.scope,operation:row.operation,state:row.state,name:body.name,description:body.description,native:body.native,
      revision:row.revision,requestedAt:row.requested_at,retirementAccepted,
      fact:row.seq===null?null:{seq:row.seq,tick:row.tick!,hash:row.event_hash!},
      terminal:row.terminal_seq===null?null:{seq:row.terminal_seq,tick:row.terminal_tick!,hash:row.terminal_hash!}};
  }
  private current(scope:LifecycleScope):SoulRow{
    const row=this.db.soul(scope.soulId);
    if(!row||row.world_id!==scope.worldId||row.owner!==scope.owner||row.entity_id!==scope.entityId)throw new Error('Lifecycle current identity changed');
    return row;
  }
  private checked(row:Row){const op=this.decode(row);if(op.fact)this.verifyFact(op);if(op.terminal)this.verifyTerminal(op);return op;}
  get(scope:LifecycleScope,requestId:string):LifecycleOperation|undefined{
    scope=scopeSchema.parse(scope);lifecycleRequestIdSchema.parse(requestId);const row=this.row(scope,requestId),current=this.db.soul(scope.soulId);
    if(!row||!current||current.world_id!==scope.worldId||current.owner!==scope.owner||current.entity_id!==scope.entityId)return undefined;
    return this.checked(row);
  }
  private insert(scope:LifecycleScope,requestId:string,operation:LifecycleOperation['operation'],row:SoulRow){
    const body={scope,name:row.name,description:row.description,native:!!row.native};
    this.db.db.prepare('INSERT INTO lifecycle_operations_v1(world_id,request_id,soul_id,owner_id,entity_id,operation,state,body,body_hash,revision,requested_at) VALUES (?,?,?,?,?,?,\'pending\',?,?,1,?)')
      .run(scope.worldId,requestId,scope.soulId,scope.owner,scope.entityId,operation,JSON.stringify(body),hashOf(body),Date.now());
    return this.get(scope,requestId)!;
  }
  acceptCreate(scope:LifecycleScope,requestId:string,input:unknown,guard:Guard):LifecycleOperation{
    scope=scopeSchema.parse(scope);lifecycleRequestIdSchema.parse(requestId);const birth=birthSchema.parse(input);
    return this.transaction(()=>{
      this.guarded(guard);
      const previous=this.get(scope,requestId);
      if(previous){if(previous.operation!=='create'||previous.name!==birth.name||previous.description!==birth.description||previous.native!==birth.native)throw new Error('Lifecycle operation identity conflict');this.current(scope);return previous;}
      this.db.createSoul({id:scope.soulId,worldId:scope.worldId,owner:scope.owner,entityId:scope.entityId,...birth});
      return this.insert(scope,requestId,'create',this.current(scope));
    });
  }
  acceptRetire(scope:LifecycleScope,requestId:string,guard:Guard):LifecycleOperation{
    scope=scopeSchema.parse(scope);lifecycleRequestIdSchema.parse(requestId);
    return this.transaction(()=>{
      this.guarded(guard);const previous=this.get(scope,requestId);const row=this.current(scope);
      if(previous){if(previous.operation!=='retire')throw new Error('Lifecycle operation identity conflict');return previous;}
      if(row.retired_at!==null)throw new Error('Lifecycle retirement was already accepted');
      const creation=this.db.db.prepare("SELECT state FROM lifecycle_operations_v1 WHERE world_id=? AND soul_id=? AND operation='create'").get(scope.worldId,scope.soulId) as {state:LifecycleOperation['state']}|undefined;
      if(creation&&creation.state!=='complete')throw new Error('Lifecycle creation is not admitted');
      this.db.retireSoul(scope.soulId);const accepted=this.insert(scope,requestId,'retire',row);
      this.db.db.prepare("UPDATE lifecycle_operations_v1 SET revision=revision+1 WHERE world_id=? AND soul_id=? AND operation='create' AND state='complete'").run(scope.worldId,scope.soulId);
      return accepted;
    });
  }
  private required(scope:LifecycleScope,requestId:string){const op=this.get(scope,requestId);if(!op)throw new Error('Lifecycle operation not found');return op;}
  private verifyFact(op:LifecycleOperation){
    if(!op.fact)throw new Error('Lifecycle physical fact missing');
    const e=this.db.events(op.scope.worldId,op.fact.seq-1,1)[0];
    if(!e||e.seq!==op.fact.seq||e.tick!==op.fact.tick||hashOf(e)!==op.fact.hash)throw new Error('Lifecycle physical fact changed');
  }
  private verifyTerminal(op:LifecycleOperation){
    const ref=op.terminal!;const e=this.db.events(op.scope.worldId,ref.seq-1,1)[0];
    if(!e||e.seq!==ref.seq||e.tick!==ref.tick||hashOf(e)!==ref.hash)throw new Error('Lifecycle terminal association changed');
  }
  record(scope:LifecycleScope,requestId:string,event:LogEvent,guard:Guard):LifecycleOperation{
    return this.transaction(()=>{
      this.guarded(guard);const op=this.required(scope,requestId),row=this.current(scope);
      const payload=op.operation==='create'?{soulId:scope.soulId,entityId:scope.entityId,owner:scope.owner,name:op.name,description:op.description}:{soulId:scope.soulId,entityId:scope.entityId};
      if(event.kind!==(op.operation==='create'?'birth':'retire')||hashOf(event.payload)!==hashOf(payload)||!Number.isSafeInteger(event.seq)||event.seq<1||!Number.isSafeInteger(event.tick)||event.tick<0||!Number.isSafeInteger(event.at)||event.at<0||event.author!==(op.operation==='create'&&op.native?'world':`soul:${scope.soulId}`))
        throw new Error('Lifecycle physical event does not match the accepted operation');
      if(op.state==='recorded'||op.state==='complete'){this.verifyFact(op);if(hashOf(event)!==op.fact!.hash)throw new Error('Lifecycle physical event retry conflict');return op;}
      if(op.state!=='pending'||(op.operation==='create'?row.retired_at!==null:row.retired_at===null))throw new Error('Lifecycle operation cannot record this physical fact');
      const head=this.db.tailEvents(scope.worldId,1)[0]?.seq??0;if(event.seq!==head+1)throw new Error('Lifecycle physical event is not the next sequence');
      this.db.appendEvent(scope.worldId,event);
      this.db.db.prepare('UPDATE lifecycle_operations_v1 SET state=\'recorded\',revision=revision+1,seq=?,tick=?,event_hash=? WHERE world_id=? AND request_id=?')
        .run(event.seq,event.tick,hashOf(event),scope.worldId,requestId);
      return this.required(scope,requestId);
    });
  }
  complete(scope:LifecycleScope,requestId:string,physicalGuard:Guard,terminalEvent?:LogEvent):LifecycleOperation{
    return this.transaction(()=>{
      this.guarded(physicalGuard);const op=this.required(scope,requestId);this.current(scope);this.verifyFact(op);
      if(op.state==='complete')return op;if(op.state!=='recorded')throw new Error('Lifecycle has no confirmed physical event');
      let terminal=op.fact!;
      if(op.operation==='retire'){
        const head=this.db.tailEvents(scope.worldId,1)[0]!;
        // A public checkpoint contains no operation/Soul/owner identity; its tick
        // lets model-free replay reach the actual delayed physical removal.
        if(!terminalEvent||terminalEvent.kind!=='rules'||terminalEvent.author!=='world'||hashOf(terminalEvent.payload)!==hashOf({checkpoint:'lifecycle-removal-confirmed'})||terminalEvent.seq!==head.seq+1||!Number.isSafeInteger(terminalEvent.tick)||terminalEvent.tick<head.tick||!Number.isSafeInteger(terminalEvent.at)||terminalEvent.at<0)
          throw new Error('Lifecycle removal needs an exact terminal checkpoint');
        this.db.appendEvent(scope.worldId,terminalEvent);terminal={seq:terminalEvent.seq,tick:terminalEvent.tick,hash:hashOf(terminalEvent)};
      }else if(terminalEvent)throw new Error('Lifecycle birth already has its terminal fact');
      this.db.db.prepare('UPDATE lifecycle_operations_v1 SET state=\'complete\',revision=revision+1,terminal_seq=?,terminal_tick=?,terminal_hash=? WHERE world_id=? AND request_id=?').run(terminal.seq,terminal.tick,terminal.hash,scope.worldId,requestId);
      return this.required(scope,requestId);
    });
  }
  refuseArrival(scope:LifecycleScope,requestId:string,guard:Guard):LifecycleOperation{
    return this.transaction(()=>{
      this.guarded(guard);const op=this.required(scope,requestId);const row=this.current(scope);
      if(op.state==='refused')return op;if(op.operation!=='create'||op.state!=='pending')throw new Error('Lifecycle accepted fact cannot become an arrival refusal');
      if(row.retired_at!==null)throw new Error('Lifecycle retirement is not an arrival refusal');
      this.db.retireSoul(scope.soulId); // Explicit G005: release count/name and revoke any improperly issued token atomically.
      this.db.db.prepare('UPDATE lifecycle_operations_v1 SET state=\'refused\',revision=revision+1 WHERE world_id=? AND request_id=?').run(scope.worldId,requestId);
      return this.required(scope,requestId);
    });
  }
  recover(worldId:string,limit=20):LifecycleOperation[]{
    id.parse(worldId);if(!Number.isInteger(limit)||limit<1||limit>20)throw new Error('Lifecycle recovery page limit');
    return (this.db.db.prepare("SELECT * FROM lifecycle_operations_v1 WHERE world_id=? AND state IN ('pending','recorded') ORDER BY requested_at,request_id LIMIT ?").all(worldId,limit) as Row[]).map(row=>this.checked(row));
  }
  ownerPage(worldId:string,owner:string,cursor:string|null=null){
    id.parse(worldId);id.parse(owner);let after:Row|undefined;
    if(cursor){lifecycleCursorSchema.parse(cursor);after=this.db.db.prepare('SELECT o.* FROM lifecycle_operations_v1 o JOIN souls s ON s.id=o.soul_id AND s.owner=o.owner_id AND s.world_id=o.world_id AND s.entity_id=o.entity_id WHERE o.world_id=? AND o.owner_id=? AND o.request_id=?').get(worldId,owner,cursor.slice(4)) as Row|undefined;if(!after)throw new Error('Lifecycle cursor not found');}
    const rows=this.db.db.prepare('SELECT o.* FROM lifecycle_operations_v1 o JOIN souls s ON s.id=o.soul_id AND s.owner=o.owner_id AND s.world_id=o.world_id AND s.entity_id=o.entity_id WHERE o.world_id=? AND o.owner_id=? AND (? IS NULL OR o.requested_at<? OR (o.requested_at=? AND o.request_id<?)) ORDER BY o.requested_at DESC,o.request_id DESC LIMIT 21')
      .all(worldId,owner,after?.requested_at??null,after?.requested_at??null,after?.requested_at??null,after?.request_id??null) as Row[];
    return {operations:rows.slice(0,20).map(row=>this.checked(row)),nextCursor:rows.length>20?'lc1_'+rows[19].request_id:null};
  }
}
