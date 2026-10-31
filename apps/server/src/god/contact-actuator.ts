// Contact effects commit at the recorded hand contact, with release still owned by the native action.
// Durable receipt intent, no per-tick object scan and no effect from an interrupted walk.
import {actuatorPoint,strokePoint,strokeRoot,STROKE_STAND,HAND_OPEN_ANGLE,type HandActuatorParams} from '../../../../mars/viewer/engine/social/hand-actuator.ts';
import { createHash } from 'node:crypto';
import { HUMAN_RADIUS } from '../../../../mars/viewer/engine/world/catalog.ts';
import { opSchema, contactStateKey, pinSlot, signupSlot, pollSlot, type WorldModel, type Op, type StoredDef } from '@sim/world-compiler';
import type { EdgeSoul } from '../edge/contract.ts';
import { actionPatch, actionsOf, actuatedState, boardTextProblem, isListAction, listProblem, pinNotes, pollChoice, pollLines, whenRefusal } from './actuators.ts';
export const CONTACT_REACH = .8;
export type ContactActuatorIntent = { target:string; action:string; actor:string; owner:string; binding:string; motionV1?:true; params?:Record<string,string> };
export const isContactActuator = (def:StoredDef, action:{name:string}) => contactStateKey(def,action.name)!==null;
const fail=(code:string,reason:string)=>({ok:false as const,code,reason});
export function createContactActuatorService(d:{levelAt?:(x:number,z:number,y:number)=>number;model:()=>WorldModel;body:(id:string)=>{pose:{p:number[]};human?:{hands?:{left?:number[];right?:number[]};handActuator?:import('../../../../mars/viewer/engine/social/hand-actuator.ts').HandActuatorMotion}}|undefined;access:(id:string,soul:EdgeSoul)=>{code:string;reason:string}|null;record:(soul:EdgeSoul,id:string,action:string,params?:Record<string,unknown>)=>void;commit:(ops:Op[],note:string,done:()=>void)=>{accepted:boolean}}){
 const binding=(id:string)=>{const m=d.model(),e=m.entities.get(id);return e?createHash('sha256').update(JSON.stringify([e,m.worldPose(e),m.resolvedDef(e.def)?.hash])).digest('hex'):null;};
 return {
  plan(soul:EdgeSoul,target:string,action:string,input:Record<string,unknown>={}){
   const m=d.model(),e=m.entities.get(target),def=e&&m.resolvedDef(e.def),body=d.body(soul.entityId);if(!e||!def||!body)return null;
   const wp=m.worldPose(e),me=body.pose.p,at:[number,number,number]=[wp.x,wp.y+1.04*wp.s,wp.z];
   const params:Omit<HandActuatorParams,'actor'>={target,at};let root:[number,number,number];
   if(contactStateKey(def,action)==='text'){
    // Stand square in front of the board's face; the hand works across the face from its centre.
    const face=(def.make.kind==='gen'?(def.make.args as {faces?:{at?:number[];w?:number;h?:number}[]})?.faces?.[0]:undefined);if(!face?.at)return null;
    const c=Math.cos(wp.yaw),s=Math.sin(wp.yaw),[fx,fy,fz]=face.at.map(v=>v*wp.s),centre:[number,number,number]=[wp.x+fx*c+fz*s,wp.y+fy,wp.z-fx*s+fz*c];
    const text=typeof input.text==='string'?input.text.trim():'',lines=action==='write'?Math.min(3,Math.max(text.split('\n').length,Math.ceil(text.length/34),1)):1,pin=action==='pin'||action==='unpin',list=['sign','unsign','vote'].includes(action);
    // Work across the upper part of the face, near shoulder height, not at the hip.
    const lift=Math.min(.12,(face.h??.4)*wp.s*.2);params.at=[centre[0]+s*.04,centre[1]+lift,centre[2]+c*.04];
    // A pinned note goes to (or comes down from) its own place on the cork, the slot the viewer draws it in.
    // Entry 25: a sign-up name goes on the sheet's next line (or comes off its own); a vote is a tally mark beside the option.
    if(list){const st=actuatedState(e,def),names=pinNotes(st),i=action==='vote'?Math.max(0,pollChoice(st,input.choice)):action==='sign'?names.length:Math.max(0,names.map(n=>n.by).indexOf(soul.soulId)),[dx,dy]=(action==='vote'?pollSlot(i):signupSlot(i)).map(v=>v*wp.s);params.at=[centre[0]+dx*c+s*.04,centre[1]+dy,centre[2]-dx*s+c*.04];}
    if(pin){const notes=pinNotes(actuatedState(e,def)),i=action==='pin'?notes.length:notes.map(n=>n.by).lastIndexOf(soul.soulId),[dx,dy]=pinSlot(Math.max(0,i)).map(v=>v*wp.s);params.at=[centre[0]+dx*c+s*.04,centre[1]+dy,centre[2]-dx*s+c*.04];}
    // Stand clear of the board's own footprint (its depth beyond the face) with a body radius to spare.
    const stand=Math.min(.7,Math.max(STROKE_STAND,(def.size.box[2]/2-(face.at[2]??0))*wp.s+HUMAN_RADIUS+.06-.04));
    params.stroke=list?{kind:action==='unsign'?'wipe':'write',yaw:wp.yaw,stand,width:action==='vote'?.1:Math.min(.16,(face.w??.4)*wp.s*.45),height:.05,lines:1,seconds:action==='unsign'?1.0:1.4}:pin?{kind:action==='unpin'?'wipe':'write',yaw:wp.yaw,stand,width:Math.min(.22,(face.w??.6)*wp.s*.25),height:.06,lines:1,seconds:action==='unpin'?1.2:1.6}:{kind:action==='erase'?'wipe':'write',yaw:wp.yaw,stand,width:Math.min(.55,(face.w??.6)*wp.s*.6),height:Math.min(.3,(face.h??.4)*wp.s*.5),lines,seconds:action==='erase'?2.4:Math.min(6,1.2+1.6*lines)};   // 1.2+1.6*3 is 6.000000000000001 in floating point; the schema caps a stroke at 6 s (a three-line note failed)
    root=strokeRoot(params.at,params.stroke,wp.y);
   }else if(def.components.opening){
    const shapes=def.make.kind==='gen'?(def.make.args as {shapes?:{role?:string;pivot?:number[];at?:number[];tint?:string}[]})?.shapes:undefined;
    const leaf=shapes?.find(s=>s.role==='door'&&s.pivot),knob=shapes?.find(s=>s.role==='door'&&s.tint==='brass');if(!leaf?.pivot)return null;
    const number=(key:string)=>Number(e.params?.[key]??def.params[key]?.default??1),sx=wp.s*number('sx'),sy=wp.s*number('sy');
    const hx=leaf.pivot[0]*sx,hz=(leaf.pivot[2]??0)*wp.s,c=Math.cos(wp.yaw),s=Math.sin(wp.yaw);
    const localZ=(me[0]-wp.x)*s+(me[2]-wp.z)*c;
    params.opening={bodyPolicy:'door-natural-v2',hinge:[wp.x+hx*c+hz*s,wp.y,wp.z-hx*s+hz*c],yaw:wp.yaw,radius:((knob?.at?.[0]??(Number(def.components.opening.width)/2-.1))-leaf.pivot[0])*sx,height:Number(def.components.opening.height)*sy,handleY:(knob?.at?.[1]??.85)*sy,from:actuatedState(e,def).open===true?HAND_OPEN_ANGLE:0,to:action==='open'?HAND_OPEN_ANGLE:0,side:localZ<0?-1:1};
    root=actuatorPoint(params.opening,params.opening.from).root;
   }else{const dx=me[0]-wp.x,dz=me[2]-wp.z,n=Math.hypot(dx,dz)||1;root=[wp.x+dx/n*.5,wp.y,wp.z+dz/n*.5];}
   return {params,root,level:d.levelAt?.(root[0],root[2],root[1])??0};
  },
  /** What a Soul reads when it completes `read:<sign>` (never in ambient perception for Soul-written boards). */
  sign(target:string){
   const m=d.model(),e=m.entities.get(target),def=e&&m.resolvedDef(e.def),sign=def?.components.sign as {lines?:string[]}|undefined;if(!e||!def||!sign)return null;
   const text=typeof e.state?.text==='string'&&e.state.text.trim()?e.state.text:(sign.lines??[]).join('\n');
   return {id:e.id,name:e.name??def.name.replace(/^core-/,''),text,...(def.tags?.includes('pinboard')?{notes:pinNotes(e.state??{})}:{}),...(def.tags?.includes('signup')?{title:String(e.state?.title??''),text:[String(e.state?.title??'Sign up'),...pinNotes(e.state??{}).map((n,i)=>`${i+1}. ${n.text}`)].join('\n')}:{}),...(def.tags?.includes('poll')?{title:String(e.state?.title??''),text:[String(e.state?.title??''),pollLines(e.state??{})].join('\n')}:{}),by:typeof e.state?.textBy==='string'&&e.state.textBy&&!def.tags?.some(t=>t==='poll'||t==='signup')?e.state.textBy:null,writable:!!def.tags?.includes('hand-writable')};
  },
  /** A few current public facts for compact nearby perception, never the full state. */
  facts(target:string){
   const m=d.model(),e=m.entities.get(target),def=e&&m.resolvedDef(e.def),key=def&&contactStateKey(def);
   if(!e||!def||!key)return null;const state=actuatedState(e,def),facts:Record<string,boolean>={};
   if(typeof state[key]==='boolean')facts[key]=state[key] as boolean;
   if(key==='open'&&typeof state.locked==='boolean')facts.locked=state.locked;
   return facts;
  },
  prepare(soul:EdgeSoul,target:string,action:string,input:Record<string,unknown>={}):ContactActuatorIntent|null{
   const m=d.model(),e=m.entities.get(target),def=e&&m.resolvedDef(e.def),a=def&&actionsOf(def).find(a=>a.name===action);
   if(!def||!a||!isContactActuator(def,a))return null;
   // Only the action's declared string params travel with the bound intent (board text, already validated at admission).
   const params=Object.fromEntries(Object.keys(a.params??{}).filter(k=>typeof input[k]==='string').map(k=>[k,(input[k] as string).trim()]));
   return {target,action,actor:soul.entityId,owner:soul.owner,binding:binding(target)!,motionV1:true,...(Object.keys(params).length?{params}:{})};
  },
  complete(soul:EdgeSoul,intent:ContactActuatorIntent,done:()=>void){
   if(intent.actor!==soul.entityId||intent.owner!==soul.owner)return fail('contact.identity-changed','The original Soul/body binding changed.');
   const m=d.model(),e=m.entities.get(intent.target),def=e&&m.resolvedDef(e.def),a=def&&actionsOf(def).find(a=>a.name===intent.action);
   if(!e||!def||!a||binding(intent.target)!==intent.binding)return fail('contact.target-changed','The target changed during the approach; no action was applied.');
   const denied=d.access(intent.target,soul);if(denied)return fail(denied.code,denied.reason);
   const b=d.body(soul.entityId),p=m.worldPose(e),motion=b?.human?.handActuator;
   const hand=b?.human?.hands?.left??b?.human?.hands?.right;
   const expected=motion?.opening?actuatorPoint(motion.opening,intent.action==='close'?motion.opening.to:motion.opening.from).hand:motion?.stroke?strokePoint(motion.at,motion.stroke,1):motion?.at;
   const reached=intent.motionV1?!!motion&&motion.target===intent.target&&!!hand&&!!expected&&Math.hypot(...hand.map((v,i)=>v-expected[i]))<.1&&Math.hypot(b!.pose.p[0]-hand[0],b!.pose.p[2]-hand[2])<.9&&Math.abs(b!.pose.p[1]-p.y)<1.2:!!b&&Math.hypot(b.pose.p[0]-p.x,b.pose.p[2]-p.z)<=CONTACT_REACH&&Math.abs(b.pose.p[1]-p.y)<=1.2;if(!b?.human||!reached)return fail('contact.not-reached','Your hand did not reach the target; no action was applied.');
   const state=actuatedState(e,def),bad=whenRefusal(a,state,e.name??'object');if(bad)return fail(bad.code,bad.reason);
   const text=isListAction(def,a)?listProblem(def,a,state,soul,intent.params??{}):contactStateKey(def,a.name)==='text'&&a.name==='write'?boardTextProblem(intent.params?.text):null;if(text)return fail(text.code,text.reason);
   const patch=actionPatch(def,a,state,intent.params??{},soul);if(contactStateKey(def,a.name)==='text'&&a.name==='write')patch.textBy=soul.soulId;
   const r=d.commit([opSchema.parse({op:'set',id:e.id,state:patch})],`${soul.soulId} ${a.name} ${e.name??e.id}`,()=>{d.record(soul,e.id,a.name,intent.params??{});done();});
   return r.accepted?{ok:true as const}:fail('contact.commit-refused','The world refused the interaction.');
  }
 };
}
export type ContactActuatorService=ReturnType<typeof createContactActuatorService>;
