// Contact effects commit at the recorded hand contact, with release still owned by the native action.
// Durable receipt intent, no per-tick object scan and no effect from an interrupted walk.
import {actuatorHand,actuatorPoint,slidePoint,HAND_OPEN_ANGLE,type HandActuatorParams} from '../../../../mars/viewer/engine/social/hand-actuator.ts';
import { createHash } from 'node:crypto';
import { opSchema, contactStateKey, containerInside, DRAWER_TRAVEL, type WorldModel, type Op, type StoredDef } from '@sim/world-compiler';
import type { EdgeSoul } from '../edge/contract.ts';
import { actionsOf, actuatedState, thenPatch, whenRefusal } from './actuators.ts';
export const CONTACT_REACH = .8;
export type ContactActuatorIntent = { target:string; action:string; actor:string; owner:string; binding:string; motionV1?:true };
export const isContactActuator = (def:StoredDef, action:{name:string}) => contactStateKey(def,action.name)!==null;
const fail=(code:string,reason:string)=>({ok:false as const,code,reason});
export function createContactActuatorService(d:{levelAt?:(x:number,z:number,y:number)=>number;model:()=>WorldModel;body:(id:string)=>{pose:{p:number[]};human?:{hands?:{left?:number[];right?:number[]};handActuator?:import('../../../../mars/viewer/engine/social/hand-actuator.ts').HandActuatorMotion}}|undefined;access:(id:string,soul:EdgeSoul)=>{code:string;reason:string}|null;record:(soul:EdgeSoul,id:string,action:string)=>void;commit:(ops:Op[],note:string,done:()=>void)=>{accepted:boolean}}){
 const binding=(id:string)=>{const m=d.model(),e=m.entities.get(id);return e?createHash('sha256').update(JSON.stringify([e,m.worldPose(e),m.resolvedDef(e.def)?.hash])).digest('hex'):null;};
 return {
  plan(soul:EdgeSoul,target:string,action:string){
   const m=d.model(),e=m.entities.get(target),def=e&&m.resolvedDef(e.def),body=d.body(soul.entityId);if(!e||!def||!body)return null;
   const wp=m.worldPose(e),me=body.pose.p,at:[number,number,number]=[wp.x,wp.y+1.04*wp.s,wp.z];
   const params:Omit<HandActuatorParams,'actor'>={target,at};let root:[number,number,number];
   if(def.tags.includes('hand-drawer')){
    // a drawer slides straight out of the front (+z): the hand takes its knob, the body stands half a metre in front
    const shapes=def.make.kind==='gen'?(def.make.args as {shapes?:{role?:string;at?:number[];tint?:string}[]})?.shapes:undefined,knob=shapes?.find(s=>s.role==='drawer'&&s.tint==='brass'&&s.at);if(!knob?.at)return null;
    const c=Math.cos(wp.yaw),s=Math.sin(wp.yaw),[kx,ky,kz]=knob.at.map(v=>v*wp.s),travel=DRAWER_TRAVEL*wp.s;
    params.slide={at:[wp.x+kx*c+kz*s,wp.y+ky,wp.z-kx*s+kz*c],dir:[s,c],travel,from:actuatedState(e,def).open===true?travel:0,to:action==='open'?travel:0,floorY:wp.y};
    root=slidePoint(params.slide,params.slide.from).root;
   }else if(def.components.opening||def.tags.includes('hand-cabinet')){
    const shapes=def.make.kind==='gen'?(def.make.args as {shapes?:{role?:string;pivot?:number[];at?:number[];size?:number[];tint?:string}[]})?.shapes:undefined;
    const leaf=shapes?.find(s=>s.role==='door'&&s.pivot),knob=shapes?.find(s=>s.role==='door'&&['brass','chrome'].includes(s.tint??''));if(!leaf?.pivot)return null;
    const number=(key:string)=>Number(e.params?.[key]??def.params[key]?.default??1),sx=wp.s*number('sx'),sy=wp.s*number('sy');
    const hx=leaf.pivot[0]*sx,hz=(leaf.pivot[2]??0)*wp.s,c=Math.cos(wp.yaw),s=Math.sin(wp.yaw);
    const localZ=(me[0]-wp.x)*s+(me[2]-wp.z)*c;
    params.opening={bodyPolicy:'door-natural-v2',...(def.tags.includes('wall-window')?{floorY:me[1]}:{}),hinge:[wp.x+hx*c+hz*s,wp.y,wp.z-hx*s+hz*c],yaw:wp.yaw,radius:((knob?.at?.[0]??(Number(def.components.opening?.width??leaf.size?.[0]??.8)/2-.1))-leaf.pivot[0])*sx,height:Number(def.components.opening?.height??leaf.size?.[1]??1.8)*sy,handleY:(knob?.at?.[1]??.85)*sy,from:actuatedState(e,def).open===true?HAND_OPEN_ANGLE:0,to:action==='open'?HAND_OPEN_ANGLE:0,side:def.tags.some(t=>['wall-window','hand-cabinet'].includes(t))?1:localZ<0?-1:1};
    if(def.tags.includes('wall-window')&&(wp.y+params.opening.handleY-me[1]>1.65||wp.y+params.opening.handleY-me[1]<.35))return null;
    root=actuatorPoint(params.opening,params.opening.from).root;
   }else{const dx=me[0]-wp.x,dz=me[2]-wp.z,n=Math.hypot(dx,dz)||1;root=[wp.x+dx/n*.5,wp.y,wp.z+dz/n*.5];}
   // entry 42: a body carrying something in the hand this would use operates with the other, free hand
   const busy=body.human?.hands,usual=actuatorHand(params.opening),other=usual==='left'?'right':'left';
   if(busy&&(busy.left||busy.right)&&!body.human?.handActuator&&!(busy[usual]&&busy[other]))params.hand=busy[usual]?other:usual;
   return {params,root,level:d.levelAt?.(root[0],root[2],root[1])??0};
  },
  /** A few current public facts for compact nearby perception, never the full state. */
  facts(target:string){
   const m=d.model(),e=m.entities.get(target),def=e&&m.resolvedDef(e.def),key=def&&contactStateKey(def);
   if(!e||!def||!key)return null;const state=actuatedState(e,def),facts:Record<string,boolean|string[]>={};
   if(typeof state[key]==='boolean')facts[key]=state[key] as boolean;
   if(key==='open'&&typeof state.locked==='boolean')facts.locked=state.locked;
   // entry 42: what is inside an open container (names only, at most its few places); nothing while it is shut
   const ins=state.open===true?containerInside(def):null;
   if(ins){const slots=new Set(ins.slots.map(s=>s.id)),holds:string[]=[];for(const c of m.children.get(target)??[]){const x=m.entities.get(c);if(x&&slots.has(x.in.slot??''))holds.push(x.name??(m.resolvedDef(x.def)?.name.replace(/^core-/,'')??'something'));}if(holds.length)facts.holds=holds.sort();}
   return facts;
  },
  prepare(soul:EdgeSoul,target:string,action:string):ContactActuatorIntent|null{
   const m=d.model(),e=m.entities.get(target),def=e&&m.resolvedDef(e.def),a=def&&actionsOf(def).find(a=>a.name===action);
   return def&&a&&isContactActuator(def,a)?{target,action,actor:soul.entityId,owner:soul.owner,binding:binding(target)!,motionV1:true}:null;
  },
  complete(soul:EdgeSoul,intent:ContactActuatorIntent,done:()=>void){
   if(intent.actor!==soul.entityId||intent.owner!==soul.owner)return fail('contact.identity-changed','The original Soul/body binding changed.');
   const m=d.model(),e=m.entities.get(intent.target),def=e&&m.resolvedDef(e.def),a=def&&actionsOf(def).find(a=>a.name===intent.action);
   if(!e||!def||!a||binding(intent.target)!==intent.binding)return fail('contact.target-changed','The target changed during the approach; no action was applied.');
   const denied=d.access(intent.target,soul);if(denied)return fail(denied.code,denied.reason);
   const b=d.body(soul.entityId),p=m.worldPose(e),motion=b?.human?.handActuator;
   const hand=motion?.hand?b?.human?.hands?.[motion.hand]:b?.human?.hands?.left??b?.human?.hands?.right;
   const expected=motion?.opening?actuatorPoint(motion.opening,intent.action==='close'?motion.opening.to:motion.opening.from).hand:motion?.slide?slidePoint(motion.slide,intent.action==='close'?motion.slide.to:motion.slide.from).hand:motion?.at;
   const reached=intent.motionV1?!!motion&&motion.target===intent.target&&!!hand&&!!expected&&Math.hypot(...hand.map((v,i)=>v-expected[i]))<.1&&Math.hypot(b!.pose.p[0]-hand[0],b!.pose.p[2]-hand[2])<.9&&Math.abs(b!.pose.p[1]-p.y)<1.2:!!b&&Math.hypot(b.pose.p[0]-p.x,b.pose.p[2]-p.z)<=CONTACT_REACH&&Math.abs(b.pose.p[1]-p.y)<=1.2;if(!b?.human||!reached)return fail('contact.not-reached','Your hand did not reach the target; no action was applied.');
   const state=actuatedState(e,def),bad=whenRefusal(a,state,e.name??'object');if(bad)return fail(bad.code,bad.reason);
   const r=d.commit([opSchema.parse({op:'set',id:e.id,state:thenPatch(a,state)})],`${soul.soulId} ${a.name} ${e.name??e.id}`,()=>{d.record(soul,e.id,a.name);done();});
   return r.accepted?{ok:true as const}:fail('contact.commit-refused','The world refused the interaction.');
  }
 };
}
export type ContactActuatorService=ReturnType<typeof createContactActuatorService>;
