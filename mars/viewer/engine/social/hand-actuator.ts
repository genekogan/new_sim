// Recorded, finite hand contact. Native roots own the step around a hinged leaf;
// viewers use this SAME timeline for the panel and the arm's reach/release weight.
import {z} from 'zod';
import type {ActionDef,Diagnostic} from '../actions/types.ts';
import type {Runtime} from '../runtime/runtime.ts';
import type {Entity} from '../world/types.ts';
import type {Spatial} from '../spatial/service.ts';
import {dcos,dsin,heading,type Vec3} from '../core/math.ts';
import {HUMAN_RADIUS} from '../world/catalog.ts';
export const HAND_REACH_SECONDS=.65,HAND_SWING_SECONDS=2.2,HAND_RELEASE_SECONDS=.7;
export const HAND_IDLE_HANDOFF_SECONDS=1.2;
export const HAND_OPEN_ANGLE=-Math.PI*.48;
const vec=z.tuple([z.number().finite(),z.number().finite(),z.number().finite()]);
const opening=z.object({floorY:z.number().finite().optional(),hinge:vec,yaw:z.number().finite(),radius:z.number().min(.2).max(2),height:z.number().min(.3).max(3),handleY:z.number().min(.3).max(2),from:z.number().min(-1.6).max(0),to:z.number().min(-1.6).max(0),side:z.union([z.literal(1),z.literal(-1)]),bodyPolicy:z.literal('door-natural-v2').optional()}).strict();
// Soul Actions entry 24: a drawer slides straight out along `dir` (the chest's front, world xz); `at` is the knob closed,
// `from`/`to` the travel out (m). The hand stays on the knob; the body keeps half a metre in front of it, facing the chest.
const slide=z.object({at:vec,dir:z.tuple([z.number().finite(),z.number().finite()]),travel:z.number().min(.05).max(.8),from:z.number().min(0).max(.8),to:z.number().min(0).max(.8),floorY:z.number().finite()}).strict();
// Soul Actions entry 42: `hand` names the free hand when the other one carries something (a bowl in the right hand, the
// drawer opened with the left); absent, the side's default hand as before.
// `reach`: a slower, deliberate reach (s; default HAND_REACH_SECONDS), as entry 37's radio knob: the storage drawer (entry 42)
// pulls out of a 0.65 s reach peaked at 0.087 m per 50 ms mid-reach (take 3); its knob is reached in 0.9 s.
export const handActuatorParams=z.object({actor:z.string(),target:z.string(),at:vec,opening:opening.optional(),slide:slide.optional(),hand:z.enum(['left','right']).optional(),reach:z.number().min(.3).max(2).optional()}).strict();
export type HandActuatorParams=z.infer<typeof handActuatorParams>;
export type HandActuatorMotion=Omit<HandActuatorParams,'actor'> & {startTick:number;actionId?:string;abortedAt?:number;abortWeight?:number};
const smooth=(v:number)=>{const k=Math.max(0,Math.min(1,v));return k*k*(3-2*k);};
export const handReachSeconds=(m:Pick<HandActuatorMotion,'reach'>)=>m.reach??HAND_REACH_SECONDS;
export function handSwingSeconds(m:Pick<HandActuatorMotion,'opening'|'slide'>){
 if(m.slide)return Math.max(1,Math.abs(m.slide.to-m.slide.from)*3.2);   // a drawer: about a second, an ordinary pull
 const o=m.opening;if(!o)return 0;
 if(o.bodyPolicy==='door-natural-v2')return Math.max(HAND_SWING_SECONDS,(Math.abs(o.to-o.from)*(o.radius+.42)+.35)*1.5/1.2);
 // Slow a larger opted-in leaf rather than exceeding ordinary walking speed.
 return Math.max(HAND_SWING_SECONDS,Math.abs(o.to-o.from)*Math.hypot(o.radius+(o.side<0?-.5:0),.42)*1.5/1.2);
}
export function handActuatorFrame(m:HandActuatorMotion,seconds:number){
 const R=handReachSeconds(m),swing=handSwingSeconds(m),releaseAt=R+swing;
 const commitAt=m.opening?.to===0||m.slide?.to===0?releaseAt:R;
 const k=smooth(((m.abortedAt??seconds)-R)/(swing||1));
 const angle=m.opening?m.opening.from+(m.opening.to-m.opening.from)*k:0,pos=m.slide?m.slide.from+(m.slide.to-m.slide.from)*k:0;
 const weight=m.abortedAt!==undefined?(m.abortWeight??0)*(1-smooth((seconds-m.abortedAt)/HAND_RELEASE_SECONDS))
   :smooth(seconds/R)*(1-smooth((seconds-releaseAt)/HAND_RELEASE_SECONDS));
 const armDownAt=(m.abortedAt??releaseAt)+HAND_RELEASE_SECONDS,idleBlend=smooth((seconds-armDownAt)/HAND_IDLE_HANDOFF_SECONDS);
 const idleWeight=m.abortedAt!==undefined||seconds<R?1-weight:idleBlend;
 return {angle,pos,weight,idleBlend,idleWeight,armDown:seconds>=armDownAt,commitAt,done:seconds>=armDownAt+HAND_IDLE_HANDOFF_SECONDS,contact:m.abortedAt===undefined&&seconds>=commitAt};
}
/** Three's local-Y rotation convention, converted to the native world frame. */
export function actuatorPoint(o:NonNullable<HandActuatorParams['opening']>,angle:number){
 const a=o.yaw+angle,c=dcos(a),s=dsin(a),[x,y,z]=o.hinge;
 const centre:Vec3=[x+c*o.radius,y+o.handleY,z-s*o.radius];
 const hand:Vec3=[centre[0]+s*.06*o.side,centre[1],centre[2]+c*.06*o.side];
 // On the push side, use the near (left) hand and keep the root nearer the
 // hinge than the handle, so the shoulder and hips clear the latch jamb.
 if(o.bodyPolicy==='door-natural-v2'&&o.side===1){
  // Stay beyond the free edge while pulling, rather than orbiting around the
  // hinge. The torso keeps facing the doorway; the hand follows the leaf.
  const u=Math.max(0,Math.min(1,angle/HAND_OPEN_ANGLE)),ox=.35*u,oz=.45;
  return {hand,root:[centre[0]+dcos(o.yaw)*ox+dsin(o.yaw)*oz,o.floorY??y,centre[2]-dsin(o.yaw)*ox+dcos(o.yaw)*oz] as Vec3};
 }
 const along=o.side<0?(o.bodyPolicy==='door-natural-v2'?-.35:-.5):0;
 const root:Vec3=[centre[0]+s*(o.bodyPolicy==='door-natural-v2'?.37:.42)*o.side+c*along,o.floorY??y,centre[2]+c*(o.bodyPolicy==='door-natural-v2'?.37:.42)*o.side-s*along];
 return {hand,root};
}
/** Where the hand and the body are with a drawer `pos` metres out. */
export function slidePoint(s:NonNullable<HandActuatorParams['slide']>,pos:number){
 const hand:Vec3=[s.at[0]+s.dir[0]*pos,s.at[1],s.at[2]+s.dir[1]*pos];
 return {hand,root:[hand[0]+s.dir[0]*.5,s.floorY,hand[2]+s.dir[1]*.5] as Vec3};
}
export const actuatorHand=(o?:HandActuatorParams['opening'],hand?:'left'|'right'):'left'|'right'=>hand??(o?.bodyPolicy==='door-natural-v2'?'left':(o?.side===-1?'left':'right'));
const issue=(code:string,message:string,subjects:string[]):Diagnostic=>({code:'contact.'+code,message,subjects});
function blocked(rt:Runtime,p:HandActuatorParams,root:Vec3,angle:number):Diagnostic|null{
 const actor=rt.world.entities[p.actor],sp=rt.services.spatial as Spatial|undefined;
 if(!actor?.human)return issue('body-gone','The original body is gone.',[p.actor]);
 if(!sp)return issue('no-geometry','No authoritative clearance is available.',[p.actor]);
 sp.sync(rt.world);
 for(const o of sp.scene.obstacles){
  if(o.id===p.target||o.id.startsWith(p.target+'#')||o.y1<=root[1]+.15||o.y0>=root[1]+1.75)continue;
  const c=dcos(o.obb.yaw),s=dsin(o.obb.yaw),dx=root[0]-o.obb.c[0],dz=root[2]-o.obb.c[1];
  const x=Math.max(0,Math.abs(dx*c+dz*s)-o.obb.half[0]),z=Math.max(0,Math.abs(-dx*s+dz*c)-o.obb.half[1]);
  if(Math.hypot(x,z)<HUMAN_RADIUS+.025)return issue('step-blocked',`There is no clear place to step while holding this handle beside ${o.label??o.id}.`,[p.actor,o.id]);
 }
 const o=p.opening,leaf=o?actuatorPoint(o,angle):null;
 for(const e of Object.values(rt.world.entities)){
  if(e.id===p.actor||!e.human||e.human.level!==actor.human.level)continue;
  if(Math.hypot(e.pose.p[0]-root[0],e.pose.p[2]-root[2])<2*HUMAN_RADIUS+.04)return issue('person-in-way','Someone is in the operating path.',[p.actor,e.id]);
  if(o&&leaf){const dx=e.pose.p[0]-o.hinge[0],dz=e.pose.p[2]-o.hinge[2],a=o.yaw+angle,c=dcos(a),s=dsin(a),along=Math.max(0,Math.min(o.radius+.12,dx*c-dz*s));if(Math.hypot(dx-along*c,dz+along*s)<HUMAN_RADIUS+.06)return issue('leaf-blocked','Someone is in the swinging panel’s path.',[p.target,e.id]);}
 }
 return null;
}
type Exec={p:HandActuatorParams;motion:HandActuatorMotion;t:number;root:Vec3;yaw:number};
function clear(rt:Runtime,ex:Exec){const h=rt.world.entities[ex.p.actor]?.human;if(!h)return;delete h.handActuator;freeHand(h,ex.p);delete h.speed;h.activity='idle';}
/** Lower the operating hand: the other hand keeps what it carries (entry 42); without `hand`, all hands as before. */
function freeHand(h:NonNullable<Entity['human']>,p:HandActuatorParams){if(!p.hand||!h.hands){delete h.hands;return;}delete h.hands[p.hand];if(!h.hands.left&&!h.hands.right)delete h.hands;}
/** Entry 42: the hands of `actor` that hold an item (hold_items keeps them at their carry points). */
const holdingHands=(rt:Runtime,actor:string)=>{const out=new Set<string>();for(const e of Object.values(rt.world.entities))if(e.support?.kind==='in-hand'&&e.support.by===actor)out.add(e.support.hand);return out;};
export const handActuator:ActionDef<HandActuatorParams,true,Exec>={
 verb:'hand_actuator_v1',description:'Reach, operate a switch or hinged opening with continuous hand contact, and lower the arm before releasing the body.',schema:handActuatorParams,
 reservations:(_w,p)=>[{resource:'actor:'+p.actor,mode:'exclusive'},{resource:'hand:'+p.actor+(':'+actuatorHand(p.opening,p.hand)),mode:'exclusive'},{resource:'entity:'+p.target,mode:'exclusive'}],
 plan(rt,p){const actor=rt.world.entities[p.actor],h=actor?.human;if(actor?.body?.family==='floater')return {ok:false,diagnostic:issue('no-arms','This body has no humanoid hand actuator.',[p.actor])};const carried=p.hand&&h?.hands?holdingHands(rt,p.actor):null,carrying=!!carried&&Object.keys(h!.hands!).every(k=>carried.has(k))&&!carried.has(p.hand!);
  if(!h||h.grip||(h.hands&&!carrying)||h.on||h.carrier||h.riding||h.shore||h.holding||h.activity==='sit')return {ok:false,diagnostic:issue('body-busy','Stand with a free hand on stable ground first.',[p.actor])};return {ok:true,program:true};},
 start(rt,p,_plan,_id){const a=rt.world.entities[p.actor];return {p:structuredClone(p),motion:{...structuredClone(p),startTick:rt.tick,actionId:_id},t:0,root:[...a.pose.p],yaw:a.pose.yaw};},
 step(rt,ex,dt){
  const a=rt.world.entities[ex.p.actor],h=a?.human;if(!h)return {status:'failed',diagnostic:issue('body-gone','The original body is gone.',[ex.p.actor])};
  ex.t+=dt;const f=handActuatorFrame(ex.motion,ex.t),point=ex.p.opening?actuatorPoint(ex.p.opening,f.angle):ex.p.slide?slidePoint(ex.p.slide,f.pos):{hand:ex.p.at,root:ex.root};
  if(ex.p.opening&&Math.hypot(ex.root[0]-actuatorPoint(ex.p.opening,ex.p.opening.from).root[0],ex.root[2]-actuatorPoint(ex.p.opening,ex.p.opening.from).root[2])>.22){clear(rt,ex);return {status:'failed',diagnostic:issue('not-at-handle','Walk to the actual handle before operating it.',[ex.p.target])};}
  if(ex.p.slide&&Math.hypot(ex.root[0]-slidePoint(ex.p.slide,ex.p.slide.from).root[0],ex.root[2]-slidePoint(ex.p.slide,ex.p.slide.from).root[2])>.22){clear(rt,ex);return {status:'failed',diagnostic:issue('not-at-handle','Walk to the actual handle before operating it.',[ex.p.target])};}
  if((ex.p.opening||ex.p.slide)&&ex.t<handReachSeconds(ex.p)){const k=smooth(ex.t/handReachSeconds(ex.p));point.root=[ex.root[0]+(point.root[0]-ex.root[0])*k,ex.root[1]+(point.root[1]-ex.root[1])*k,ex.root[2]+(point.root[2]-ex.root[2])*k];}
  const bad=blocked(rt,ex.p,point.root,f.angle);if(bad){clear(rt,ex);return {status:'failed',diagnostic:bad};}
  const before=[...a.pose.p];a.pose.p=[...point.root];
  const face=ex.p.slide?heading([-ex.p.slide.dir[0],-ex.p.slide.dir[1]]):ex.p.opening?heading([-dsin(ex.p.opening.yaw+(ex.p.opening.bodyPolicy==='door-natural-v2'?(ex.p.opening.side===-1?f.angle*.34:0):f.angle))*ex.p.opening.side,-dcos(ex.p.opening.yaw+(ex.p.opening.bodyPolicy==='door-natural-v2'?(ex.p.opening.side===-1?f.angle*.34:0):f.angle))*ex.p.opening.side]):heading([point.hand[0]-a.pose.p[0],point.hand[2]-a.pose.p[2]]),turn=((face-ex.yaw+Math.PI*3)%(Math.PI*2))-Math.PI;
  a.pose.yaw=ex.yaw+turn*smooth(ex.t/.4);
  const speed=Math.hypot(a.pose.p[0]-before[0],a.pose.p[2]-before[2])/dt;h.activity=speed>.08?'walk':'operate';if(speed>.08)h.speed=speed;else delete h.speed;
  if(f.armDown){freeHand(h,ex.p);h.activity='idle';delete h.speed;}else if(ex.p.hand)h.hands={...(h.hands??{}),[ex.p.hand]:[...point.hand]};else h.hands=actuatorHand(ex.p.opening)==='left'?{left:[...point.hand]}:{right:[...point.hand]};h.handActuator=ex.motion;
  if(f.done){clear(rt,ex);return {status:'completed'};}return {status:'running',phase:ex.t<handReachSeconds(ex.motion)?'reaching':ex.t<handReachSeconds(ex.motion)+handSwingSeconds(ex.motion)?'operating':'releasing'};
 },
 cancel(rt,ex){
  // Before contact, return the partly raised arm without applying anything.
  // Once grasped, complete the short safe swing/release before a new walk owns the body.
  if(ex.t<handReachSeconds(ex.motion)&&ex.motion.abortedAt===undefined){ex.motion.abortWeight=handActuatorFrame(ex.motion,ex.t).weight;ex.motion.abortedAt=ex.t;}
  return {ok:true,deferred:true};
 },resumable:true,
};
