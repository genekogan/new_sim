// Native own-body observations, not receipt completion or a social-task verdict.
// Action phase changes trigger a coalesced read after the tick; no model polling.
import type {WorldHost, HostListener} from '../../world.ts';
import type {Db} from '../../db.ts';
import type {WorldState as NativeWorld} from '../../../../../mars/viewer/engine/world/types.ts';
import {bodyState} from '../../body-state.ts';

type Receipt = {receipt_id:string;capability:string;phase:string;program_id:string;accepted_tick:number;detail:string|null};
const TRANSITION = new Set(['idle','wait','walk','jog','run','cycle','sit-down','stand-up']);
export function activityObserver({host,db,deliver,now=Date.now}:{host:WorldHost;db:Db;deliver:(soulId:string,tick:number,body:Record<string,unknown>)=>unknown;now?:()=>number}) {
 const affected=new Set<string>(),last=new Map<string,{program:string;key:string}>();
 let catchUp=true,closed=false;
 const enabled=()=>!!host.engine?.runtime?.records&&typeof host.engine.programOf==='function';
 const listener:HostListener={
  onRuntimeEvent(e){
   if(closed||!enabled()||e.type!=='action')return;
   const p=host.engine.runtime.records.get(e.id)?.params as {actor?:unknown;actors?:unknown}|undefined;
   if(typeof p?.actor==='string'&&host.mindByEntity.has(p.actor))affected.add(p.actor);
   if(Array.isArray(p?.actors))for(const actor of p.actors)if(typeof actor==='string'&&host.mindByEntity.has(actor))affected.add(actor);
  },
  onProgram(e){if(last.get(e.actor)?.program===e.id&&e.kind!=='step')last.delete(e.actor);},
  afterTickComplete(tick){
   if(closed||!enabled()||tick!==host.engine.world.tick)return;
   const refresh=catchUp;catchUp=false;
   if(refresh)for(const m of host.minds.values())affected.add(m.entityId);
   const actors=[...affected];affected.clear();
   for(const actor of actors){
    // An advisory observer must never break the completed native tick. Retry on
    // a later native transition/restart; never manufacture a successful event.
    try{
     const m=host.mindByEntity.get(actor),s=m&&db.soul(m.soulId),program=host.engine.programOf(actor);
     if(!m||!s||s.world_id!==host.worldId||s.retired_at!==null||s.entity_id!==actor||s.owner!==m.owner||!m.owner||m.owner==='system'||!program){last.delete(actor);continue;}
     const r=db.db.prepare("SELECT receipt_id,capability,phase,program_id,accepted_tick,detail FROM edge_receipts_v1 WHERE world_id=? AND soul_id=? AND program_id=? AND phase='started' ORDER BY accepted_tick DESC LIMIT 1").get(host.worldId,m.soulId,program) as Receipt|undefined;
     if(!r){last.delete(actor);continue;}
     const entity=(host.engine.world as NativeWorld).entities[actor],h=entity?.human,body=bodyState(host,actor);
     if(!h||!body||typeof h.activity!=='string'||TRANSITION.has(h.activity)){last.delete(actor);continue;}
     const current=host.engine.programAction?.(program),programmeAction=current&&host.engine.runtime.records.get(current.action.id);
     const pose=programmeAction?.params as {actor?:string;activity?:string}|undefined;
     // Pose actions publish actual activity without replacing human.task. A
     // matching active programme action and actual pose are both required.
     const action=pose?.actor===actor&&pose.activity===h.activity?programmeAction:typeof h.task==='string'?host.engine.runtime.records.get(h.task):undefined;
     const params=action?.params as {actor?:string;actors?:string[]}|undefined;
     if(!action||action.status!=='executing'||action.requestedTick<r.accepted_tick||!(params?.actor===actor||params?.actors?.includes(actor)))continue;
     const holds=(host.engine.nativeSeatHoldsV1?.(actor)??[]).filter(hold=>{const rec=host.engine.runtime.records.get(hold.action);return rec?.status==='executing'&&rec.phase==='occupied';});
     if(holds.length>4)continue; // ambiguous/unbounded seat projection stays absent
     const seats=holds.map(hold=>hold.slot).sort();
     const belongs=(id:string,ancestor=action.id):boolean=>{
      for(let depth=0;depth<16;depth++){if(id===ancestor)return true;const rec=host.engine.runtime.records.get(id);if(!rec?.parent)return false;id=rec.parent;}return false;
     };
     // Usually the active body task is the programme action or its ancestor.
     // A seat claim may instead outlive the sit step while its programme rests:
     // require the exact chosen seat and occupied native body in that case.
     const chosen=(r.detail?JSON.parse(r.detail):{}).chosen as {slot?:string;seat?:string;target?:string}|undefined;
     const chosenSeat=chosen?.slot?seats.includes(chosen.slot):[chosen?.seat,chosen?.target].some(id=>typeof id==='string'&&seats.some(slot=>slot.split('#')[0]===id));
     const linked=current?.programId===program&&current.actor===actor&&current.action.status==='executing'&&(belongs(action.id,current.action.id)||belongs(current.action.id));
     const heldSit=!current&&r.capability.startsWith('sit:')&&body.posture==='seated'&&h.activity==='sit'&&seats.length===1&&chosenSeat&&holds.some(hold=>hold.action===action.id||belongs(hold.action));
     if(!linked&&!heldSit)continue;
     // A reservation and a sit-down animation are not actual occupied seating.
     if(['sit','take_slot'].includes(action.verb)&&action.phase!=='occupied')continue;
     const ownBody={...body,...(h.instrument?{instrument:h.instrument}:{}),occupiedSeats:seats};
     const key=JSON.stringify([r.receipt_id,body.posture,body.activity,h.instrument??null,seats]);
     if(last.get(actor)?.key===key)continue;
     deliver(m.soulId,tick,{worldId:host.worldId,soulId:m.soulId,bodyId:actor,observedAt:now(),observation:'native-current-body',reason:refresh?'catch-up':'native-transition',receipt:{id:r.receipt_id,capability:r.capability,phase:r.phase},programId:program,action:{id:action.id,verb:action.verb,status:action.status,...(action.phase?{phase:action.phase}:{})},body:ownBody,note:'Current activity observation only; receipt remains open. This is not completion, elapsed hold or delivered content.',untrusted:false});
     last.set(actor,{program,key});
    }catch{/* missing native binding or failed stream append remains unproven */}
   }
  },
 };
 return {listener,close(){closed=true;affected.clear();last.clear();}};
}
