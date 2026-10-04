// Internal opt-in native producer. Production bootstrap/HTTP do not install it.
import { TERMINAL } from '@sim/engine-contract';
import { probeNativeHumanBirth } from '@sim/engine-mars';
import { soulLifecycleSchema, ownerLifecycleListSchema, type SoulLifecycle } from '@sim/protocol';
import { LifecycleJournal, type LifecycleOperation } from './lifecycle-journal.ts';
import type { WorldHost } from './world.ts';

class LifecycleDeferred extends Error {}
const removalCheckpoint={checkpoint:'lifecycle-removal-confirmed'};
function refers(value:unknown,id:string):boolean {
  if(value===id)return true;
  if(Array.isArray(value))return value.some(v=>refers(v,id));
  return !!value&&typeof value==='object'&&Object.values(value).some(v=>refers(v,id));
}

/** Admission readiness is correspondence, not inactivity or an old revision.
 * The caller still checks current user/invitation/control authority separately. */
export function lifecycleBodyReady(host:WorldHost,op:LifecycleOperation):boolean {
  const s=op.scope,row=host.db.soul(s.soulId),body=host.engine.world.entities[s.entityId],mind=host.minds.get(s.soulId),thing=host.kernel.things[s.soulId];
  return !!row&&row.retired_at===null&&row.world_id===host.worldId&&s.worldId===host.worldId
    &&row.owner===s.owner&&row.entity_id===s.entityId&&row.name===op.name&&row.description===op.description
    &&body?.kind==='human'&&body.human?.soul===s.soulId&&body.label===op.name
    &&!!mind&&mind.entityId===s.entityId&&mind.owner===s.owner&&mind.name===op.name&&mind.description===op.description
    &&host.mindByEntity.get(s.entityId)===mind&&thing?.kind==='soul'&&thing.name===op.name
    &&thing.traits.body===s.entityId&&thing.traits.about===op.description&&!!host.kernel.decks[s.soulId];
}
export function lifecycleRemovalSettled(host:WorldHost,op:LifecycleOperation):boolean {
  const s=op.scope,row=host.db.soul(s.soulId);
  return !!row&&row.retired_at!==null&&row.world_id===host.worldId&&s.worldId===host.worldId&&row.owner===s.owner&&row.entity_id===s.entityId
    &&!host.engine.world.entities[s.entityId]&&host.engine.programOf(s.entityId)===null&&!host.engine.actorBorrowed?.(s.entityId)
    &&!host.minds.has(s.soulId)&&!host.mindByEntity.has(s.entityId)&&!host.kernel.things[s.soulId]&&!host.kernel.decks[s.soulId]
    &&!Object.values(host.kernel.things).some(t=>t.by===s.soulId)
    &&!Object.values(host.kernel.links).some(l=>l.from===s.soulId||l.to===s.soulId)
    &&![...host.engine.runtime.records.values()].some(r=>!TERMINAL.has(r.status)&&refers(r.params,s.entityId));
}

export function projectLifecycle(host:WorldHost,op:LifecycleOperation):SoulLifecycle {
  const fresh=new LifecycleJournal(host.db).get(op.scope,op.requestId);
  if(!fresh)throw new Error('Lifecycle projection lost its current private identity');op=fresh;
  const birth=op.operation==='create',complete=op.state==='complete',historical=birth&&complete&&op.retirementAccepted;
  const ready=birth&&complete&&!historical&&lifecycleBodyReady(host,op);
  const state=birth?(op.state==='refused'?'refused':complete?'admitted':'pending'):complete?'retired':'retiring';
  const held=birth&&op.state!=='refused'&&!historical;
  return soulLifecycleSchema.parse({contract:'soul-lifecycle/1',worldId:op.scope.worldId,requestId:op.requestId,
    soulId:op.scope.soulId,entityId:op.scope.entityId,name:op.name,operation:op.operation,state,
    revision:op.revision,requestedAt:op.requestedAt,fact:complete?{seq:op.terminal!.seq,tick:op.terminal!.tick}:null,ready,
    reason:historical?'retirement-accepted':op.state==='refused'?'arrival-unavailable':birth?(ready?null:'reconciling'):complete?null:'removal-pending',
    allocation:{countsTowardLimit:held,reservesName:held}});
}

export class LifecycleRunner {
  host:WorldHost;journal:LifecycleJournal;
  /** Invariant/persistence failures remain visible and require explicit review.
   * They are never ordinary refusal or an implicit logical release. */
  faults=new Map<string,unknown>();
  private inflight=new Set<string>();
  private recoveryAfter:{requestedAt:number;requestId:string}|undefined;
  private authority:(op:LifecycleOperation)=>boolean;
  constructor(host:WorldHost,journal:LifecycleJournal,authority:(op:LifecycleOperation)=>boolean){
    if(host.db!==journal.db||!host.engine.rulesVersion.startsWith('sim-mars/1+')||!host.engine.rulesVersion.endsWith('+crew-removal/1'))throw new Error('Lifecycle runner needs its native host journal and qualified crew-removal policy');
    this.host=host;this.journal=journal;this.authority=authority;
  }
  private current(op:LifecycleOperation){const current=this.journal.get(op.scope,op.requestId);if(!current||current.state!==op.state)throw new LifecycleDeferred('Lifecycle state changed');return current;}
  private queue(op:LifecycleOperation,promise:Promise<unknown>){
    this.inflight.add(op.requestId);
    void promise.catch(error=>{if(!(error instanceof LifecycleDeferred))this.faults.set(op.requestId,error);})
      .finally(()=>this.inflight.delete(op.requestId));
  }
  /** Explicit bounded reconciliation, invoked after boot and on owned ticks by
   * a future opt-in installer. It creates no timers, paid work or default hooks. */
  pump(){
    const page=this.journal.recover(this.host.worldId,20,this.recoveryAfter),last=page.at(-1);
    // Round-robin keyset scanning prevents twenty deferred requests from
    // starving later work. This is a bounded scan, not a capacity claim.
    this.recoveryAfter=page.length===20&&last?{requestedAt:last.requestedAt,requestId:last.requestId}:undefined;
    for(const op of page){
      if(this.inflight.has(op.requestId)||this.faults.has(op.requestId))continue;
      try{this.advance(op);}catch(error){if(!(error instanceof LifecycleDeferred))this.faults.set(op.requestId,error);}
    }
  }
  private advance(op:LifecycleOperation){
    const s=op.scope;
    if(op.state==='recorded'){
      if(op.operation==='create'){
        if(!lifecycleBodyReady(this.host,op))throw new Error('Accepted lifecycle birth lacks its canonical body/kernel/Mind');
        this.journal.complete(s,op.requestId,()=>lifecycleBodyReady(this.host,this.current(op)));return;
      }
      if(!lifecycleRemovalSettled(this.host,op))return;
      const guard=()=>{this.current(op);if(!lifecycleRemovalSettled(this.host,op))throw new LifecycleDeferred('Removal still owns native obligations');return true as const;};
      this.queue(op,this.host.enqueueChecked('rules','world',removalCheckpoint,guard,e=>this.journal.linkRemovalComplete(s,op.requestId,e,guard)));return;
    }
    if(op.operation==='retire'){
      const guard=()=>{this.current(op);const row=this.host.db.soul(s.soulId);if(!row||row.retired_at===null)throw new Error('Durable retirement lost its revocation');return true as const;};
      this.queue(op,this.host.enqueueChecked('retire',`soul:${s.soulId}`,{soulId:s.soulId,entityId:s.entityId},guard,e=>this.journal.linkAccepted(s,op.requestId,e,guard)));return;
    }
    const probe=()=>{
      this.current(op);if(!this.authority(op))throw new LifecycleDeferred('Current admission authority is unavailable');
      const row=this.host.db.soul(s.soulId);
      if(!row||row.retired_at!==null)throw new Error('Pending lifecycle birth lost its owned reservation');
      if(this.host.minds.has(s.soulId)||this.host.mindByEntity.has(s.entityId)||this.host.kernel.things[s.soulId]||this.host.kernel.decks[s.soulId])throw new Error('Pending lifecycle birth already owns canonical Mind/kernel identity');
      return probeNativeHumanBirth(this.host.engine,this.host.factory,{id:s.entityId,label:op.name,soul:s.soulId});
    };
    const preview=probe();
    if(preview.outcome==='deferred')return;
    if(preview.outcome==='unavailable'&&preview.diagnostic.code==='birth.arrival-unavailable'){
      this.journal.refuseArrival(s,op.requestId,()=>{
        const current=probe();return current.outcome==='unavailable'&&current.diagnostic.code==='birth.arrival-unavailable'
          &&!this.host.engine.world.entities[s.entityId]&&!this.host.minds.has(s.soulId)&&!this.host.kernel.things[s.soulId];
      });return;
    }
    if(preview.outcome!=='ready')throw new Error('Pending lifecycle birth has an unexpected existing/conflicting identity');
    // Probe again under the host writer lock, after any preceding queued event.
    // A changed placement remains pending; it is reclassified only by pump's
    // exact ordinary-unavailable path, never an arbitrary exception handler.
    const guard=()=>{const p=probe();if(p.outcome!=='ready')throw new LifecycleDeferred('Native admission changed');return true as const;};
    const payload={soulId:s.soulId,entityId:s.entityId,owner:s.owner,name:op.name,description:op.description};
    this.queue(op,this.host.enqueueChecked('birth',op.native?'world':`soul:${s.soulId}`,payload,guard,e=>this.journal.linkAccepted(s,op.requestId,e,guard)));
  }
  ownerPage(owner:string,cursor:string|null=null){
    const page=this.journal.ownerPage(this.host.worldId,owner,cursor);
    return ownerLifecycleListSchema.parse({contract:'owner-lifecycle-list/1',worldId:this.host.worldId,
      requests:page.operations.map(op=>projectLifecycle(this.host,op)),nextCursor:page.nextCursor});
  }
}
