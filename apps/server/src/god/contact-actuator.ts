// A contact actuator commits only after its admitted approach/arm gesture completes.
// Durable receipt intent, no per-tick object scan and no effect from an interrupted walk.
import { createHash } from 'node:crypto';
import { opSchema, contactStateKey, type WorldModel, type Op, type StoredDef } from '@sim/world-compiler';
import type { EdgeSoul } from '../edge/contract.ts';
import { actionsOf, actuatedState, thenPatch, whenRefusal } from './actuators.ts';
export const CONTACT_REACH = .8;
export type ContactActuatorIntent = { target:string; action:string; actor:string; owner:string; binding:string };
export const isContactActuator = (def:StoredDef, action:{name:string}) => contactStateKey(def,action.name)!==null;
const fail=(code:string,reason:string)=>({ok:false as const,code,reason});
export function createContactActuatorService(d:{model:()=>WorldModel;body:(id:string)=>{pose:{p:number[]};human?:unknown}|undefined;access:(id:string,soul:EdgeSoul)=>{code:string;reason:string}|null;record:(soul:EdgeSoul,id:string,action:string)=>void;commit:(ops:Op[],note:string,done:()=>void)=>{accepted:boolean}}){
 const binding=(id:string)=>{const m=d.model(),e=m.entities.get(id);return e?createHash('sha256').update(JSON.stringify([e,m.worldPose(e),m.resolvedDef(e.def)?.hash])).digest('hex'):null;};
 return {
  /** A few current public facts for compact nearby perception, never the full state. */
  facts(target:string){
   const m=d.model(),e=m.entities.get(target),def=e&&m.resolvedDef(e.def),key=def&&contactStateKey(def);
   if(!e||!def||!key)return null;const state=actuatedState(e,def),facts:Record<string,boolean>={};
   if(typeof state[key]==='boolean')facts[key]=state[key] as boolean;
   if(key==='open'&&typeof state.locked==='boolean')facts.locked=state.locked;
   return facts;
  },
  prepare(soul:EdgeSoul,target:string,action:string):ContactActuatorIntent|null{
   const m=d.model(),e=m.entities.get(target),def=e&&m.resolvedDef(e.def),a=def&&actionsOf(def).find(a=>a.name===action);
   return def&&a&&isContactActuator(def,a)?{target,action,actor:soul.entityId,owner:soul.owner,binding:binding(target)!}:null;
  },
  complete(soul:EdgeSoul,intent:ContactActuatorIntent,done:()=>void){
   if(intent.actor!==soul.entityId||intent.owner!==soul.owner)return fail('contact.identity-changed','The original Soul/body binding changed.');
   const m=d.model(),e=m.entities.get(intent.target),def=e&&m.resolvedDef(e.def),a=def&&actionsOf(def).find(a=>a.name===intent.action);
   if(!e||!def||!a||binding(intent.target)!==intent.binding)return fail('contact.target-changed','The target changed during the approach; no action was applied.');
   const denied=d.access(intent.target,soul);if(denied)return fail(denied.code,denied.reason);
   const b=d.body(soul.entityId),p=m.worldPose(e);if(!b?.human||(Math.hypot(b.pose.p[0]-p.x,b.pose.p[2]-p.z)>CONTACT_REACH||Math.abs(b.pose.p[1]-p.y)>1.2))return fail('contact.not-reached','Your hand did not reach the target; no action was applied.');
   const state=actuatedState(e,def),bad=whenRefusal(a,state,e.name??'object');if(bad)return fail(bad.code,bad.reason);
   const r=d.commit([opSchema.parse({op:'set',id:e.id,state:thenPatch(a,state)})],`${soul.soulId} ${a.name} ${e.name??e.id}`,()=>{d.record(soul,e.id,a.name);done();});
   return r.accepted?{ok:true as const}:fail('contact.commit-refused','The world refused the interaction.');
  }
 };
}
export type ContactActuatorService=ReturnType<typeof createContactActuatorService>;
