// A contact switch commits only after its admitted approach/arm gesture completes.
// Durable receipt intent, no per-tick object scan and no effect from an interrupted walk.
import { createHash } from 'node:crypto';
import { opSchema, type WorldModel, type Op } from '@sim/world-compiler';
import type { EdgeSoul } from '../edge/contract.ts';
import { actionsOf, actuatedState, thenPatch, whenRefusal } from './actuators.ts';
export const SWITCH_REACH = .8;
export type ContactSwitchIntent = { target:string; action:string; actor:string; owner:string; binding:string };
export const isContactSwitch = (def: {components: {light?:unknown}; actions?:unknown}, action:{name:string}) => !!def.components.light && ['switch-on','switch-off'].includes(action.name);
const fail=(code:string,reason:string)=>({ok:false as const,code,reason});
export function createContactSwitchService(d:{model:()=>WorldModel;body:(id:string)=>{pose:{p:number[]};human?:unknown}|undefined;access:(id:string,soul:EdgeSoul)=>{code:string;reason:string}|null;record:(soul:EdgeSoul,id:string,action:string)=>void;commit:(ops:Op[],note:string,done:()=>void)=>{accepted:boolean}}){
 const binding=(id:string)=>{const m=d.model(),e=m.entities.get(id);return e?createHash('sha256').update(JSON.stringify([e,m.worldPose(e),m.resolvedDef(e.def)?.hash])).digest('hex'):null;};
 return {
  prepare(soul:EdgeSoul,target:string,action:string):ContactSwitchIntent|null{
   const m=d.model(),e=m.entities.get(target),def=e&&m.resolvedDef(e.def),a=def&&actionsOf(def).find(a=>a.name===action);
   return def&&a&&isContactSwitch(def,a)?{target,action,actor:soul.entityId,owner:soul.owner,binding:binding(target)!}:null;
  },
  complete(soul:EdgeSoul,intent:ContactSwitchIntent,done:()=>void){
   if(intent.actor!==soul.entityId||intent.owner!==soul.owner)return fail('switch.identity-changed','The original Soul/body binding changed.');
   const m=d.model(),e=m.entities.get(intent.target),def=e&&m.resolvedDef(e.def),a=def&&actionsOf(def).find(a=>a.name===intent.action);
   if(!e||!def||!a||binding(intent.target)!==intent.binding)return fail('switch.target-changed','The light changed during the approach; no switch was applied.');
   const denied=d.access(intent.target,soul);if(denied)return fail(denied.code,denied.reason);
   const b=d.body(soul.entityId),p=m.worldPose(e);if(!b?.human||(Math.hypot(b.pose.p[0]-p.x,b.pose.p[2]-p.z)>SWITCH_REACH||Math.abs(b.pose.p[1]-p.y)>1.2))return fail('switch.not-reached','Your hand did not reach the light; no switch was applied.');
   const state=actuatedState(e,def),bad=whenRefusal(a,state,e.name??'light');if(bad)return fail(bad.code,bad.reason);
   const r=d.commit([opSchema.parse({op:'set',id:e.id,state:thenPatch(a,state)})],`${soul.soulId} ${a.name} ${e.name??e.id}`,()=>{d.record(soul,e.id,a.name);done();});
   return r.accepted?{ok:true as const}:fail('switch.commit-refused','The world refused the switch.');
  }
 };
}
export type ContactSwitchService=ReturnType<typeof createContactSwitchService>;
