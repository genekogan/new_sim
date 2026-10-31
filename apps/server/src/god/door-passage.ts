// Soul Actions entry 31: a walk that a closed, permitted, hand-operated door walls off goes through that door. The Soul
// walks to the handle, opens it by hand (the same hand_actuator_v1 door-natural-v2 operation as "open the door"), walks
// through, closes it behind from the far side and walks on. A locked or private door on the only way is refused with a
// reason naming it. Only the one door walked through is ever named; doors elsewhere never enter the plan or the receipt.
import {actuatorPoint,HAND_OPEN_ANGLE} from '../../../../mars/viewer/engine/social/hand-actuator.ts';
import type {EdgeSoul} from '../edge/contract.ts';
import type {WorldModel} from '@sim/world-compiler';
import {actionsOf,actuatedState} from './actuators.ts';
import {isContactActuator,type ContactActuatorIntent,type ContactActuatorService} from './contact-actuator.ts';

type Step={verb:string;params:Record<string,unknown>};
type Engine={closedDoorsOnWalkV1?:(actor:string,steps:Step[])=>{goal:[number,number];doors:string[]}|null;walkFromReachesV1?:(actor:string,from:[number,number],steps:Step[])=>boolean};
export type DoorPassage={door:string;name:string;steps:Step[];direct:Step[];open:ContactActuatorIntent;note:string};
export type DoorPassageRefusal={refuse:true;code:string;reason:string};
/** How far past the door line the close is planned from (its far side). */
const FAR=1;
/** Where the walk stops before the hand takes over: door-local (along the wall to the latch side, out from it), metres. */
const STAGE=[.7,1.65];

export function createDoorPassage(d:{engine:()=>Engine;model:()=>WorldModel;contact:ContactActuatorService;access:(id:string,soul:EdgeSoul)=>{code:string;reason:string}|null}){
 /** The passage for a plain walk (`steps`) whose destination no walk reaches now; null when no closed door explains it. */
 return (soul:EdgeSoul,steps:Step[],what:string):DoorPassage|DoorPassageRefusal|null=>{
  const eng=d.engine(),found=eng.closedDoorsOnWalkV1?.(soul.entityId,steps);if(!found||!eng.walkFromReachesV1)return null;
  let refusal:DoorPassageRefusal|null=null;
  for(const id of found.doors){
   const m=d.model(),e=m.entities.get(id),def=e&&m.resolvedDef(e.def);if(!e||!def)continue;
   // a walk to the door itself (or to a spot at it) ends at the door, on this side: it is not a walk through it
   const at=m.worldPose(e);if(steps.some(s=>s.verb==='walk_to'&&s.params.to===id)||Math.hypot(found.goal[0]-at.x,found.goal[1]-at.z)<1.5)continue;
   if(!actionsOf(def).some(a=>a.name==='open'&&isContactActuator(def,a)))continue;
   const open=d.contact.plan(soul,id,'open',{open:false}),o=open?.params.opening;if(!open||!o)continue;
   const wp=m.worldPose(e),n:[number,number]=[Math.sin(wp.yaw),Math.cos(wp.yaw)],far:[number,number]=[wp.x-n[0]*o.side*FAR,wp.z-n[1]*o.side*FAR];
   const close=d.contact.plan(soul,id,'close',{from:far,open:true}),c=close?.params.opening;if(!close||!c||c.side===o.side)continue;
   // does the far side reach the destination (the door's own gap stays shut in this check: the far side is beyond it)?
   const end=actuatorPoint(c,0).root;if(!eng.walkFromReachesV1(soul.entityId,[end[0],end[2]],steps))continue;
   const name=e.name??id,denied=d.access(id,soul);
   if(denied){refusal??={refuse:true,code:denied.code,reason:`The way to ${what} goes through ${name}: ${denied.reason.replace(/[.\s]+$/,'')}. It was not opened.`};continue;}
   if(actuatedState(e,def).locked===true){refusal??={refuse:true,code:'door.locked',reason:`The way to ${what} goes through ${name}, which is locked. It was not opened.`};continue;}
   const intent=d.contact.prepare(soul,id,'open');if(!intent)continue;
   const passage={door:[wp.x,wp.z] as [number,number],from:o.side};
   const rest=steps[0]?.verb==='stand'?steps.slice(1):steps,openAt=actuatorPoint(o,o.from).root,closeAt=actuatorPoint(c,HAND_OPEN_ANGLE).root;
   const walk=(p:number[]):Step=>({verb:'walk_to',params:{to:[p[0],p[2]],standoff:0}});
   // The walk ends a step short of the door, in front of the latch side (out of the swing and of the way through); the hand
   // step takes the last metre itself once nobody else is at the door (a follower never walks into the leader's swing).
   const u=[Math.cos(wp.yaw),-Math.sin(wp.yaw)],stage=[wp.x+u[0]*STAGE[0]+n[0]*o.side*STAGE[1],0,wp.z+u[1]*STAGE[0]+n[1]*o.side*STAGE[1]];
   const legs=(first:number[]):Step[]=>[{verb:'stand',params:{}},walk(first),{verb:'mars:hand_actuator_v1',params:{...open.params,passage:{mode:'open',...passage}}},walk(closeAt),{verb:'mars:hand_actuator_v1',params:{...close.params,passage:{mode:'close',...passage}}},...rest];
   return {door:id,name,open:intent,note:`Through ${name}: opened it by hand on the way, and closed it behind unless someone was following.`,steps:legs(stage),direct:legs(openAt)};
  }
  return refusal;
 };
}
