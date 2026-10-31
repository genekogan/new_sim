// Contact effects commit at the recorded hand contact, with release still owned by the native action.
// Durable receipt intent, no per-tick object scan and no effect from an interrupted walk.
import {actuatorPoint,strokePoint,strokeRoot,STROKE_STAND,HAND_OPEN_ANGLE,type HandActuatorParams} from '../../../../mars/viewer/engine/social/hand-actuator.ts';
import { createHash } from 'node:crypto';
import { isDry, stageWord } from './garden.ts';
import { HUMAN_RADIUS } from '../../../../mars/viewer/engine/world/catalog.ts';
import { opSchema, contactStateKey, gameSquare, gameSquareOf, gameStatus, type WorldModel, type Op, type StoredDef } from '@sim/world-compiler';
import type { EdgeSoul } from '../edge/contract.ts';
import { actionsOf, actuatedState, boardTextProblem, gamePatch, gameProblem, isGameAction, thenPatch, whenRefusal } from './actuators.ts';
export const CONTACT_REACH = .8;
export type ContactActuatorIntent = { target:string; action:string; actor:string; owner:string; binding:string; motionV1?:true; params?:Record<string,string> };
export const isContactActuator = (def:StoredDef, action:{name:string}) => contactStateKey(def,action.name)!==null;
const fail=(code:string,reason:string)=>({ok:false as const,code,reason});
export function createContactActuatorService(d:{levelAt?:(x:number,z:number,y:number)=>number;model:()=>WorldModel;body:(id:string)=>{pose:{p:number[]};human?:{hands?:{left?:number[];right?:number[]};handActuator?:import('../../../../mars/viewer/engine/social/hand-actuator.ts').HandActuatorMotion}}|undefined;access:(id:string,soul:EdgeSoul)=>{code:string;reason:string}|null;record:(soul:EdgeSoul,id:string,action:string,params?:Record<string,unknown>)=>void;/** Entry 43: compact facts of things that are not contact actuators (a kettle, a cup of tea), or null. */moreFacts?:(id:string)=>Record<string,unknown>|null;commit:(ops:Op[],note:string,done:()=>void)=>{accepted:boolean}}){
 const binding=(id:string)=>{const m=d.model(),e=m.entities.get(id);return e?createHash('sha256').update(JSON.stringify([e,m.worldPose(e),m.resolvedDef(e.def)?.hash])).digest('hex'):null;};
 return {
  plan(soul:EdgeSoul,target:string,action:string,input:Record<string,unknown>={}){
   const m=d.model(),e=m.entities.get(target),def=e&&m.resolvedDef(e.def),body=d.body(soul.entityId);if(!e||!def||!body)return null;
   const wp=m.worldPose(e),me=body.pose.p,at:[number,number,number]=[wp.x,wp.y+1.04*wp.s,wp.z];
   const params:Omit<HandActuatorParams,'actor'>={target,at};let root:[number,number,number],face:[number,number]|undefined;
   if(contactStateKey(def,action)==='text'){
    // Stand square in front of the board's face; the hand works across the face from its centre.
    const face=(def.make.kind==='gen'?(def.make.args as {faces?:{at?:number[];w?:number;h?:number}[]})?.faces?.[0]:undefined);if(!face?.at)return null;
    const c=Math.cos(wp.yaw),s=Math.sin(wp.yaw),[fx,fy,fz]=face.at.map(v=>v*wp.s),centre:[number,number,number]=[wp.x+fx*c+fz*s,wp.y+fy,wp.z-fx*s+fz*c];
    const text=typeof input.text==='string'?input.text.trim():'',lines=action==='write'?Math.min(3,Math.max(text.split('\n').length,Math.ceil(text.length/34),1)):1;
    // Work across the upper part of the face, near shoulder height, not at the hip.
    const lift=Math.min(.12,(face.h??.4)*wp.s*.2);params.at=[centre[0]+s*.04,centre[1]+lift,centre[2]+c*.04];
    // Stand clear of the board's own footprint (its depth beyond the face) with a body radius to spare.
    const stand=Math.min(.7,Math.max(STROKE_STAND,(def.size.box[2]/2-(face.at[2]??0))*wp.s+HUMAN_RADIUS+.06-.04));
    // Entry 27: a noughts-and-crosses mark goes to its own square (gameSquare, shared with the viewer's face)
    const mark=action==='mark'&&def.tags.includes('tictactoe')?gameSquareOf(input.square):-1;
    if(mark>=0){const [dx,dy]=gameSquare(mark).map(v=>v*wp.s);params.at=[centre[0]+dx*c+s*.04,centre[1]+dy,centre[2]-dx*s+c*.04];}
    params.stroke=mark>=0?{kind:'write',yaw:wp.yaw,stand,width:.1,height:.08,lines:1,seconds:1.2}:{kind:action==='erase'?'wipe':'write',yaw:wp.yaw,stand,width:Math.min(.55,(face.w??.6)*wp.s*.6),height:Math.min(.3,(face.h??.4)*wp.s*.5),lines,seconds:action==='erase'?2.4:Math.min(6,1.2+1.6*lines)};
    root=strokeRoot(params.at,params.stroke,wp.y);
   }else if(def.components.opening){
    const shapes=def.make.kind==='gen'?(def.make.args as {shapes?:{role?:string;pivot?:number[];at?:number[];tint?:string}[]})?.shapes:undefined;
    const leaf=shapes?.find(s=>s.role==='door'&&s.pivot),knob=shapes?.find(s=>s.role==='door'&&s.tint==='brass');if(!leaf?.pivot)return null;
    const number=(key:string)=>Number(e.params?.[key]??def.params[key]?.default??1),sx=wp.s*number('sx'),sy=wp.s*number('sy');
    const hx=leaf.pivot[0]*sx,hz=(leaf.pivot[2]??0)*wp.s,c=Math.cos(wp.yaw),s=Math.sin(wp.yaw);
    const localZ=(me[0]-wp.x)*s+(me[2]-wp.z)*c;
    params.opening={bodyPolicy:'door-natural-v2',hinge:[wp.x+hx*c+hz*s,wp.y,wp.z-hx*s+hz*c],yaw:wp.yaw,radius:((knob?.at?.[0]??(Number(def.components.opening.width)/2-.1))-leaf.pivot[0])*sx,height:Number(def.components.opening.height)*sy,handleY:(knob?.at?.[1]??.85)*sy,from:actuatedState(e,def).open===true?HAND_OPEN_ANGLE:0,to:action==='open'?HAND_OPEN_ANGLE:0,side:localZ<0?-1:1};
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
     // Entry 33 (take 4): a stand point beside the valve can leave the body ~40° off the valve when it arrives (a wall
     // torch approached along its wall); the Soul turns to face the valve on arrival, before the arm comes up, so the
     // reach is never added to a body turn (the hand actuator's own turn is then ~0).
     face=[params.at[0],params.at[2]];
    }}
   return {params,root,level:d.levelAt?.(root[0],root[2],root[1])??0,...(face?{face}:{})};
  },
  /** What a Soul reads when it completes `read:<sign>` (never in ambient perception for Soul-written boards). */
  sign(target:string){
   const m=d.model(),e=m.entities.get(target),def=e&&m.resolvedDef(e.def),sign=def?.components.sign as {lines?:string[]}|undefined;if(!e||!def||!sign)return null;
   const text=typeof e.state?.text==='string'&&e.state.text.trim()?e.state.text:(sign.lines??[]).join('\n');
   // Entry 27: a game board reads as its players, its state and the grid (world facts: the moves are the world's)
   if(def.tags?.includes('tictactoe')){const g=String(e.state?.text??'').padEnd(9,'.').slice(0,9),st=gameStatus(g),names=String(e.state?.players??'').split(',').filter(Boolean),who=(m:'X'|'O')=>names[m==='X'?0:1]??m;
    const head=names.length?`Noughts and crosses: ${who('X')} (X)${names[1]?` against ${names[1]} (O)`:''}; ${st.winner?`${who(st.winner)} won`:st.draw?'a draw':`${who(st.turn)} to play`}`:'Noughts and crosses: a new game, X to play';
    return {id:e.id,name:e.name??def.name.replace(/^core-/,''),text:[head,...[0,1,2].map(r=>[...g.slice(r*3,r*3+3)].map(ch=>ch==='.'?'·':ch).join(' '))].join('\n'),by:null,writable:true};}
   return {id:e.id,name:e.name??def.name.replace(/^core-/,''),text,by:typeof e.state?.textBy==='string'&&e.state.textBy?e.state.textBy:null,writable:!!def.tags?.includes('hand-writable')};
  },
  /** A few current public facts for compact nearby perception, never the full state. */
  facts(target:string){
   const m=d.model(),e=m.entities.get(target),def=e&&m.resolvedDef(e.def),key=def&&contactStateKey(def);
   // Entry 18: a thirsty planter says so (only when dry; a watered garden adds nothing)
   if(e&&def&&!key&&(def.state as Record<string,{type?:string}>).moisture?.type==='number'){
    const st=def.state as Record<string,{type?:string;default?:unknown}>,dry=isDry(e.state?.moisture??st.moisture?.default);
    // Entry 34: a growing planter says its stage in a word (and dry only when dry)
    const stage=st.growth?.type==='number'?stageWord(e.state?.growth??st.growth.default):null;
    return stage?{stage,...(dry?{dry:true}:{})}:dry?{dry:true}:null;}
   if(e&&def&&!key)return d.moreFacts?.(target)??null;
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
    const text=isGameAction(def,a)?gameProblem(a,state,soul,a.name==='mark'?intent.params?.square??'':undefined):contactStateKey(def,a.name)==='text'&&a.name==='write'?boardTextProblem(intent.params?.text):null;if(text)return fail(text.code,text.reason);
    const patch=isGameAction(def,a)?gamePatch(a,state,soul,intent.params?.square):thenPatch(a,state,intent.params??{});if(contactStateKey(def,a.name)==='text'&&a.name==='write')patch.textBy=soul.soulId;
    // A sprinkler coming on soaks the planters (things with numeric moisture) in its forward arc within reach, in the same commit:
    // one pass over the world at this event, never per tick.
    const soak:Op[]=[];
    if(def.tags?.includes('sprinkler')&&a.name==='switch-on'){const reach=Number(e.params?.reach??(def.params.reach as {default?:number}|undefined)?.default??3.5);
     for(const o of m.entities.values()){const od=o.id!==e.id&&m.resolvedDef(o.def);if(!od||(od.state as Record<string,{type?:string}>).moisture?.type!=='number')continue;const op=m.worldPose(o);const fx=Math.sin(p.yaw),fz=Math.cos(p.yaw);if(Math.hypot(op.x-p.x,op.z-p.z)<=reach&&(op.x-p.x)*fx+(op.z-p.z)*fz>0&&o.state?.moisture!==1)soak.push(opSchema.parse({op:'set',id:o.id,state:{moisture:1}}));}}
    const r=d.commit([opSchema.parse({op:'set',id:e.id,state:patch}),...soak],`${soul.soulId} ${a.name} ${e.name??e.id}`,()=>{d.record(soul,e.id,a.name,intent.params??{});done();});
   return r.accepted?{ok:true as const}:fail('contact.commit-refused','The world refused the interaction.');
  }
 };
}
export type ContactActuatorService=ReturnType<typeof createContactActuatorService>;
