// Contact effects commit at the recorded hand contact, with release still owned by the native action.
// Durable receipt intent, no per-tick object scan and no effect from an interrupted walk.
import {actuatorPoint,opPoint,HAND_OPEN_ANGLE,type HandActuatorParams} from '../../../../mars/viewer/engine/social/hand-actuator.ts';
import { createHash } from 'node:crypto';
import { HUMAN_RADIUS } from '../../../../mars/viewer/engine/world/catalog.ts';
import { opSchema, contactStateKey, type WorldModel, type Op, type StoredDef } from '@sim/world-compiler';
import type { EdgeSoul } from '../edge/contract.ts';
import { actionsOf, actuatedState, thenPatch, whenRefusal } from './actuators.ts';
export const CONTACT_REACH = .8;
export type ContactActuatorIntent = { target:string; action:string; actor:string; owner:string; binding:string; motionV1?:true; /** entry 32: a passage's close re-locks the latch */ relock?:true; /** entry 32: a leg of a walk through the door */ passage?:true };
/** Soul Actions entry 32: the hand operations on a lockable door that are not the leaf itself. */
const LOCK_OPS=new Set(['lock','unlock','knock']);
type Refusal={code:string;reason:string};
export const isContactActuator = (def:StoredDef, action:{name:string}) => contactStateKey(def,action.name)!==null;
const fail=(code:string,reason:string)=>({ok:false as const,code,reason});
export function createContactActuatorService(d:{levelAt?:(x:number,z:number,y:number)=>number;model:()=>WorldModel;body:(id:string)=>{pose:{p:number[]};human?:{hands?:{left?:number[];right?:number[]};handActuator?:import('../../../../mars/viewer/engine/social/hand-actuator.ts').HandActuatorMotion}}|undefined;access:(id:string,soul:EdgeSoul)=>{code:string;reason:string}|null;
 /** entry 32: the thing's owner (a name) and whether it is this Soul; null when nobody owns it */ owner?:(id:string,soul:EdgeSoul)=>{name:string;mine:boolean}|null;
 /** entry 32: a knock on the leaf landed (the first rap): tell those who hear it */ knock?:(soul:EdgeSoul,id:string)=>void;
 record:(soul:EdgeSoul,id:string,action:string)=>void;commit:(ops:Op[],note:string,done:()=>void)=>{accepted:boolean}}){
 const binding=(id:string)=>{const m=d.model(),e=m.entities.get(id);return e?createHash('sha256').update(JSON.stringify([e,m.worldPose(e),m.resolvedDef(e.def)?.hash])).digest('hex'):null;};
 return {
  /** `from`/`open` (entry 31's door passage): plan as if the body stood at `from` and the door were already open/shut. */
  plan(soul:EdgeSoul,target:string,action:string,opts?:{from?:[number,number];open?:boolean}){
   const m=d.model(),e=m.entities.get(target),def=e&&m.resolvedDef(e.def),body=d.body(soul.entityId);if(!e||!def||!body)return null;
   const wp=m.worldPose(e),me=opts?.from?[opts.from[0],body.pose.p[1],opts.from[1]]:body.pose.p,at:[number,number,number]=[wp.x,wp.y+1.04*wp.s,wp.z];
   const params:Omit<HandActuatorParams,'actor'>={target,at};let root:[number,number,number];
   if(def.components.opening){
    const shapes=def.make.kind==='gen'?(def.make.args as {shapes?:{role?:string;pivot?:number[];at?:number[];tint?:string}[]})?.shapes:undefined;
    const leaf=shapes?.find(s=>s.role==='door'&&s.pivot),knob=shapes?.find(s=>s.role==='door'&&s.tint==='brass');if(!leaf?.pivot)return null;
    const number=(key:string)=>Number(e.params?.[key]??def.params[key]?.default??1),sx=wp.s*number('sx'),sy=wp.s*number('sy');
    const hx=leaf.pivot[0]*sx,hz=(leaf.pivot[2]??0)*wp.s,c=Math.cos(wp.yaw),s=Math.sin(wp.yaw);
    const localZ=(me[0]-wp.x)*s+(me[2]-wp.z)*c;
    if(LOCK_OPS.has(action)&&def.tags.includes('lockable'))params.op=action as 'lock'|'unlock'|'knock';
    params.opening={bodyPolicy:'door-natural-v2',hinge:[wp.x+hx*c+hz*s,wp.y,wp.z-hx*s+hz*c],yaw:wp.yaw,radius:((knob?.at?.[0]??(Number(def.components.opening.width)/2-.1))-leaf.pivot[0])*sx,height:Number(def.components.opening.height)*sy,handleY:(knob?.at?.[1]??.85)*sy,from:(opts?.open??actuatedState(e,def).open===true)?HAND_OPEN_ANGLE:0,to:action==='open'?HAND_OPEN_ANGLE:0,side:localZ<0?-1:1};
    root=actuatorPoint(params.opening,params.opening.from).root;
   }else{
    // A def's part tinted `valve` (a tap handle) is where the hand goes; otherwise the old switch height at the centre.
    const shapes=def.make.kind==='gen'?(def.make.args as {shapes?:{tint?:string;at?:number[]}[]})?.shapes:undefined,valve=shapes?.find(s=>s.tint==='valve'&&s.at);
    if(valve?.at){const c=Math.cos(wp.yaw),s=Math.sin(wp.yaw),[vx,vy,vz]=valve.at.map(v=>v*wp.s);params.at=[wp.x+vx*c+vz*s,wp.y+vy,wp.z-vx*s+vz*c];}
    const dx=me[0]-params.at[0],dz=me[2]-params.at[2],n=Math.hypot(dx,dz)||1;root=[params.at[0]+dx/n*.5,wp.y,params.at[2]+dz/n*.5];
    if(valve?.at){
     // Stand beside the valve, clear of the thing's own footprint (a basin, a tray) by a body radius: of eight
     // directions around the valve, the one nearest the Soul's approach whose stand point is outside.
     const c=Math.cos(wp.yaw),s=Math.sin(wp.yaw),[hx,,hz]=def.size.box.map(v=>v*wp.s/2),outside=(p:number[])=>{const lx=(p[0]-wp.x)*c-(p[2]-wp.z)*s,lz=(p[0]-wp.x)*s+(p[2]-wp.z)*c;return Math.abs(lx)>hx+HUMAN_RADIUS||Math.abs(lz)>hz+HUMAN_RADIUS;};
     const want=Math.atan2(dz,dx),best=Array.from({length:8},(_,i)=>i*Math.PI/4).map(a=>[params.at[0]+Math.cos(a)*.55,wp.y,params.at[2]+Math.sin(a)*.55,Math.abs(((a-want+Math.PI*3)%(Math.PI*2))-Math.PI)]).filter(outside).sort((p,q)=>p[3]-q[3])[0];
     if(best)root=[best[0],best[1],best[2]];
    }}
   // entry 32: after knocking, step back beside the door (latch side, out of its swing and of the way through) to wait
   const o=params.opening,after:[number,number]|undefined=params.op==='knock'&&o?[+(wp.x+Math.cos(wp.yaw)*1.35+Math.sin(wp.yaw)*o.side*1.3).toFixed(3),+(wp.z-Math.sin(wp.yaw)*1.35+Math.cos(wp.yaw)*o.side*1.3).toFixed(3)]:undefined;
   return {params,root,level:d.levelAt?.(root[0],root[2],root[1])??0,...(after?{after}:{})};
  },
  /** Entry 32: who may lock, unlock and knock on a lockable door. Its owner locks and unlocks it (key outside, thumb-turn
   *  inside); a door nobody owns locks for anyone. Knocking is for the outside (the front) of a closed door. A non-owner
   *  inside never needs `unlock`: a walk out turns the thumb-turn on the way (door-passage.ts). */
  policy(soul:EdgeSoul,target:string,action:string):Refusal|null{
   if(!LOCK_OPS.has(action))return null;
   const m=d.model(),e=m.entities.get(target),def=e&&m.resolvedDef(e.def);if(!e||!def?.tags.includes('lockable'))return null;
   const name=e.name??'the door',side=this.side(soul,target);
   if(action==='knock')return side==='inside'?{code:'door.inside',reason:`You are inside ${name}; knocking is for someone outside it.`}:null;
   const own=d.owner?.(target,soul);
   if(own&&!own.mine)return {code:'door.not-yours',reason:`Only ${own.name} can ${action} ${name}; it is ${own.name}'s.${action==='unlock'&&side==='inside'?' From inside you can always just walk out: the thumb-turn opens as you go.':''}`};
   return null;
  },
  /** Which side of a door this Soul's body is on: the back (local -z) is the inside. */
  side(soul:EdgeSoul,target:string):'inside'|'outside'|null{
   const m=d.model(),e=m.entities.get(target),b=d.body(soul.entityId);if(!e||!b)return null;
   const p=m.worldPose(e);return (b.pose.p[0]-p.x)*Math.sin(p.yaw)+(b.pose.p[2]-p.z)*Math.cos(p.yaw)<0?'inside':'outside';
  },
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
   return def&&a&&isContactActuator(def,a)?{target,action,actor:soul.entityId,owner:soul.owner,binding:binding(target)!,motionV1:true}:null;
  },
  complete(soul:EdgeSoul,intent:ContactActuatorIntent,done:()=>void){
   if(intent.actor!==soul.entityId||intent.owner!==soul.owner)return fail('contact.identity-changed','The original Soul/body binding changed.');
   const m=d.model(),e=m.entities.get(intent.target),def=e&&m.resolvedDef(e.def),a=def&&actionsOf(def).find(a=>a.name===intent.action);
   if(!e||!def||!a||binding(intent.target)!==intent.binding)return fail('contact.target-changed','The target changed during the approach; no action was applied.');
   const denied=d.access(intent.target,soul);if(denied)return fail(denied.code,denied.reason);
   const b=d.body(soul.entityId),p=m.worldPose(e),motion=b?.human?.handActuator;
   const hand=b?.human?.hands?.left??b?.human?.hands?.right;
   const expected=motion?.opening&&motion.op?opPoint(motion.opening,motion.op,0):motion?.opening?actuatorPoint(motion.opening,intent.action==='close'?motion.opening.to:motion.opening.from).hand:motion?.at;
   const reached=intent.motionV1?!!motion&&motion.target===intent.target&&!!hand&&!!expected&&Math.hypot(...hand.map((v,i)=>v-expected[i]))<.1&&Math.hypot(b!.pose.p[0]-hand[0],b!.pose.p[2]-hand[2])<.9&&Math.abs(b!.pose.p[1]-p.y)<1.2:!!b&&Math.hypot(b.pose.p[0]-p.x,b.pose.p[2]-p.z)<=CONTACT_REACH&&Math.abs(b.pose.p[1]-p.y)<=1.2;if(!b?.human||!reached)return fail('contact.not-reached','Your hand did not reach the target; no action was applied.');
   const state=actuatedState(e,def);
   // entry 32: a walk's thumb-turn on a door somebody unlocked meanwhile has nothing left to do
   if(intent.passage&&a.name==='unlock'&&state.locked!==true){done();return {ok:true as const};}
   const bad=whenRefusal(a,state,e.name??'object');if(bad)return fail(bad.code,bad.reason);
   // entry 32: a knock changes nothing in the world; those who hear it are told once
   if(a.name==='knock'&&def.tags.includes('lockable')){d.knock?.(soul,e.id);d.record(soul,e.id,a.name);done();return {ok:true as const};}
   const r=d.commit([opSchema.parse({op:'set',id:e.id,state:{...thenPatch(a,state),...(intent.relock&&a.name==='close'&&typeof state.locked==='boolean'?{locked:true}:{})}})],`${soul.soulId} ${a.name} ${e.name??e.id}`,()=>{
    // entry 32: a guest's thumb-turn on the way out is part of the walk, not an `unlock` of theirs (that is the owner's)
    if(!(intent.passage&&a.name==='unlock'))d.record(soul,e.id,a.name);done();});
   return r.accepted?{ok:true as const}:fail('contact.commit-refused','The world refused the interaction.');
  }
 };
}
export type ContactActuatorService=ReturnType<typeof createContactActuatorService>;
