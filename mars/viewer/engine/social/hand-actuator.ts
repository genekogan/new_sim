// Recorded, finite hand contact. Native roots own the step around a hinged leaf;
// viewers use this SAME timeline for the panel and the arm's reach/release weight.
import {z} from 'zod';
import type {ActionDef,Diagnostic} from '../actions/types.ts';
import type {Runtime} from '../runtime/runtime.ts';
import type {Spatial} from '../spatial/service.ts';
import {dcos,dsin,heading,type Vec3} from '../core/math.ts';
import {HUMAN_RADIUS} from '../world/catalog.ts';
export const HAND_REACH_SECONDS=.65,HAND_SWING_SECONDS=2.2,HAND_RELEASE_SECONDS=.7;
export const HAND_IDLE_HANDOFF_SECONDS=1.2;
export const HAND_OPEN_ANGLE=-Math.PI*.48;
const vec=z.tuple([z.number().finite(),z.number().finite(),z.number().finite()]);
const opening=z.object({floorY:z.number().finite().optional(),hinge:vec,yaw:z.number().finite(),radius:z.number().min(.2).max(2),height:z.number().min(.3).max(3),handleY:z.number().min(.3).max(2),from:z.number().min(-1.6).max(0),to:z.number().min(-1.6).max(0),side:z.union([z.literal(1),z.literal(-1)]),bodyPolicy:z.literal('door-natural-v2').optional()}).strict();
// A hand that writes or wipes across a flat face (a board): `at` is the face centre, `yaw` its facing.
const stroke=z.object({kind:z.union([z.literal('write'),z.literal('wipe')]),yaw:z.number().finite(),stand:z.number().min(.3).max(.7).optional(),width:z.number().min(.1).max(1.2),height:z.number().min(.05).max(.8),lines:z.number().int().min(1).max(3),seconds:z.number().min(.8).max(6)}).strict();
// Soul Actions entry 24: a drawer slides straight out along `dir` (the chest's front, world xz); `at` is the knob closed,
// `from`/`to` the travel out (m). The hand stays on the knob; the body keeps half a metre in front of it, facing the chest.
const slide=z.object({at:vec,dir:z.tuple([z.number().finite(),z.number().finite()]),travel:z.number().min(.05).max(.8),from:z.number().min(0).max(.8),to:z.number().min(0).max(.8),floorY:z.number().finite()}).strict();
export const handActuatorParams=z.object({actor:z.string(),target:z.string(),at:vec,opening:opening.optional(),stroke:stroke.optional(),slide:slide.optional()}).strict();
export type HandActuatorParams=z.infer<typeof handActuatorParams>;
export type HandActuatorMotion=Omit<HandActuatorParams,'actor'> & {startTick:number;actionId?:string;abortedAt?:number;abortWeight?:number};
const smooth=(v:number)=>{const k=Math.max(0,Math.min(1,v));return k*k*(3-2*k);};
export function handSwingSeconds(m:Pick<HandActuatorMotion,'opening'|'stroke'|'slide'>){
 if(m.slide)return Math.max(1,Math.abs(m.slide.to-m.slide.from)*3.2);   // a drawer: about a second, an ordinary pull
 const o=m.opening;if(!o)return m.stroke?.seconds??0;
 if(o.bodyPolicy==='door-natural-v2')return Math.max(HAND_SWING_SECONDS,(Math.abs(o.to-o.from)*(o.radius+.42)+.35)*1.5/1.2);
 // Slow a larger opted-in leaf rather than exceeding ordinary walking speed.
 return Math.max(HAND_SWING_SECONDS,Math.abs(o.to-o.from)*Math.hypot(o.radius+(o.side<0?-.5:0),.42)*1.5/1.2);
}
export function handActuatorFrame(m:HandActuatorMotion,seconds:number){
 const swing=handSwingSeconds(m),releaseAt=HAND_REACH_SECONDS+swing;
 const commitAt=m.opening?.to===0||m.stroke||m.slide?.to===0?releaseAt:HAND_REACH_SECONDS;
 const k=smooth(((m.abortedAt??seconds)-HAND_REACH_SECONDS)/(swing||1));
 const angle=m.opening?m.opening.from+(m.opening.to-m.opening.from)*k:0,pos=m.slide?m.slide.from+(m.slide.to-m.slide.from)*k:0;
 const weight=m.abortedAt!==undefined?(m.abortWeight??0)*(1-smooth((seconds-m.abortedAt)/HAND_RELEASE_SECONDS))
   :smooth(seconds/HAND_REACH_SECONDS)*(1-smooth((seconds-releaseAt)/HAND_RELEASE_SECONDS));
 const armDownAt=(m.abortedAt??releaseAt)+HAND_RELEASE_SECONDS,idleBlend=smooth((seconds-armDownAt)/HAND_IDLE_HANDOFF_SECONDS);
 const idleWeight=m.abortedAt!==undefined||seconds<HAND_REACH_SECONDS?1-weight:idleBlend;
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
/** Where a writing or wiping hand is on the face at stroke progress `u` (0..1): rows of small letter strokes, left to
 *  right, with a slight lift back to the next row; a wipe is three overlapping sweeps. Continuous at u=0 and u=1. */
export function strokePoint(at:Vec3,s:NonNullable<HandActuatorParams['stroke']>,u:number):Vec3 {
 const k=Math.max(0,Math.min(1,u)),right:[number,number]=[dcos(s.yaw),-dsin(s.yaw)],out:[number,number]=[dsin(s.yaw),dcos(s.yaw)];
 let x:number,y:number,lift=0;
 if(s.kind==='wipe'){const pass=Math.min(2,Math.floor(k*3)),f=k*3-pass,dir=pass%2?-1:1;x=dir*(f-.5)*s.width;y=s.height*.3*(1-2*k)+.03*Math.sin(f*Math.PI*6);}
 else{const row=Math.min(s.lines-1,Math.floor(k*s.lines)),f=k*s.lines-row,top=s.lines>1?s.height/2:0,step=s.lines>1?s.height/(s.lines-1):0;
  const writing=f<.75,g=writing?f/.75:(f-.75)/.25;
  x=writing?(g-.5)*s.width:(.5-smooth(g))*s.width;y=top-row*step-(writing?0:step*smooth(g))+(writing?.012*Math.sin(g*Math.PI*14):0);lift=writing?0:.035*Math.sin(g*Math.PI);
  if(row===s.lines-1&&!writing){x=.5*s.width;y=top-row*step;lift=0;}}
 return [at[0]+right[0]*x+out[0]*lift,at[1]+y,at[2]+right[1]*x+out[1]*lift];
}
/** Where a body stands to write on a face: square in front of `at`, `STROKE_STAND` metres out along the face's facing. */
export const STROKE_STAND=.38;
export const strokeRoot=(at:Vec3,s:NonNullable<HandActuatorParams['stroke']>,y:number):Vec3=>{const d=s.stand??STROKE_STAND;return [at[0]+dsin(s.yaw)*d,y,at[2]+dcos(s.yaw)*d];};
/** Where the hand and the body are with a drawer `pos` metres out. */
export function slidePoint(s:NonNullable<HandActuatorParams['slide']>,pos:number){
 const hand:Vec3=[s.at[0]+s.dir[0]*pos,s.at[1],s.at[2]+s.dir[1]*pos];
 return {hand,root:[hand[0]+s.dir[0]*.5,s.floorY,hand[2]+s.dir[1]*.5] as Vec3};
}
export const actuatorHand=(o?:HandActuatorParams['opening']):'left'|'right'=>o?.bodyPolicy==='door-natural-v2'?'left':(o?.side===-1?'left':'right');
const issue=(code:string,message:string,subjects:string[]):Diagnostic=>({code:'contact.'+code,message,subjects});
type Obstacle=Spatial['scene']['obstacles'][number];
/** M01: obstacles near the whole operation, per scene obstacle array (rebuilt, never mutated, when the scene changes).
 *  Every root of one operation lies within `reach` of `centre`, so a farther obstacle can never block it. */
const nearOps=new WeakMap<Exec,{of:readonly Obstacle[];near:Obstacle[]}>();
export const handClearanceStats={obstaclesVisited:0,candidateBuilds:0};
function nearObstacles(ex:Exec,all:readonly Obstacle[]){
 const was=nearOps.get(ex);if(was?.of===all)return was.near;
 const o=ex.p.opening,centre=o?o.hinge:ex.root,reach=o?o.radius+2:ex.p.stroke?1:ex.p.slide?ex.p.slide.travel+.5:.5,near:Obstacle[]=[];
 for(const b of all){if(b.id===ex.p.target||b.id.startsWith(ex.p.target+'#'))continue;if(Math.hypot(b.obb.c[0]-centre[0],b.obb.c[1]-centre[2])<=reach+Math.hypot(b.obb.half[0],b.obb.half[1])+HUMAN_RADIUS+.1)near.push(b);}
 nearOps.set(ex,{of:all,near});handClearanceStats.candidateBuilds++;return near;
}
function blocked(rt:Runtime,ex:Exec,root:Vec3,angle:number):Diagnostic|null{
 const p=ex.p,actor=rt.world.entities[p.actor],sp=rt.services.spatial as Spatial|undefined;
 if(!actor?.human)return issue('body-gone','The original body is gone.',[p.actor]);
 if(!sp)return issue('no-geometry','No authoritative clearance is available.',[p.actor]);
 sp.sync(rt.world);
 for(const o of nearObstacles(ex,sp.scene.obstacles)){
  handClearanceStats.obstaclesVisited++;
  if(o.y1<=root[1]+.15||o.y0>=root[1]+1.75)continue;
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
function clear(rt:Runtime,ex:Exec){const h=rt.world.entities[ex.p.actor]?.human;if(!h)return;delete h.handActuator;delete h.hands;delete h.speed;h.activity='idle';}
export const handActuator:ActionDef<HandActuatorParams,true,Exec>={
 verb:'hand_actuator_v1',description:'Reach, operate a switch or hinged opening with continuous hand contact, and lower the arm before releasing the body.',schema:handActuatorParams,
 reservations:(_w,p)=>[{resource:'actor:'+p.actor,mode:'exclusive'},{resource:'hand:'+p.actor+(':'+actuatorHand(p.opening)),mode:'exclusive'},{resource:'entity:'+p.target,mode:'exclusive'}],
 plan(rt,p){const actor=rt.world.entities[p.actor],h=actor?.human;if(actor?.body?.family==='floater')return {ok:false,diagnostic:issue('no-arms','This body has no humanoid hand actuator.',[p.actor])};if(!h||h.grip||h.hands||h.on||h.carrier||h.riding||h.shore||h.holding||h.activity==='sit')return {ok:false,diagnostic:issue('body-busy','Stand with a free hand on stable ground first.',[p.actor])};return {ok:true,program:true};},
 start(rt,p,_plan,_id){const a=rt.world.entities[p.actor];return {p:structuredClone(p),motion:{...structuredClone(p),startTick:rt.tick,actionId:_id},t:0,root:[...a.pose.p],yaw:a.pose.yaw};},
 step(rt,ex,dt){
  const a=rt.world.entities[ex.p.actor],h=a?.human;if(!h)return {status:'failed',diagnostic:issue('body-gone','The original body is gone.',[ex.p.actor])};
  ex.t+=dt;const f=handActuatorFrame(ex.motion,ex.t),point=ex.p.opening?actuatorPoint(ex.p.opening,f.angle):ex.p.slide?slidePoint(ex.p.slide,f.pos):{hand:ex.p.stroke?strokePoint(ex.p.at,ex.p.stroke,(ex.t-HAND_REACH_SECONDS)/ex.p.stroke.seconds):ex.p.at,root:ex.root};
  if(ex.p.opening&&Math.hypot(ex.root[0]-actuatorPoint(ex.p.opening,ex.p.opening.from).root[0],ex.root[2]-actuatorPoint(ex.p.opening,ex.p.opening.from).root[2])>.22){clear(rt,ex);return {status:'failed',diagnostic:issue('not-at-handle','Walk to the actual handle before operating it.',[ex.p.target])};}
  if(ex.p.slide&&Math.hypot(ex.root[0]-slidePoint(ex.p.slide,ex.p.slide.from).root[0],ex.root[2]-slidePoint(ex.p.slide,ex.p.slide.from).root[2])>.22){clear(rt,ex);return {status:'failed',diagnostic:issue('not-at-handle','Walk to the actual handle before operating it.',[ex.p.target])};}
  if(ex.p.stroke){const goal=strokeRoot(ex.p.at,ex.p.stroke,ex.root[1]);if(Math.hypot(goal[0]-ex.root[0],goal[2]-ex.root[2])>.5){clear(rt,ex);return {status:'failed',diagnostic:issue('not-at-board','Walk up to the board before writing on it.',[ex.p.target])};}
   const k=smooth(Math.min(1,ex.t/HAND_REACH_SECONDS));point.root=[ex.root[0]+(goal[0]-ex.root[0])*k,ex.root[1],ex.root[2]+(goal[2]-ex.root[2])*k];}
  if((ex.p.opening||ex.p.slide)&&ex.t<HAND_REACH_SECONDS){const k=smooth(ex.t/HAND_REACH_SECONDS);point.root=[ex.root[0]+(point.root[0]-ex.root[0])*k,ex.root[1]+(point.root[1]-ex.root[1])*k,ex.root[2]+(point.root[2]-ex.root[2])*k];}
  const bad=blocked(rt,ex,point.root,f.angle);if(bad){clear(rt,ex);return {status:'failed',diagnostic:bad};}
  const before=[...a.pose.p];a.pose.p=[...point.root];
  const face=ex.p.slide?heading([-ex.p.slide.dir[0],-ex.p.slide.dir[1]]):ex.p.opening?heading([-dsin(ex.p.opening.yaw+(ex.p.opening.bodyPolicy==='door-natural-v2'?(ex.p.opening.side===-1?f.angle*.34:0):f.angle))*ex.p.opening.side,-dcos(ex.p.opening.yaw+(ex.p.opening.bodyPolicy==='door-natural-v2'?(ex.p.opening.side===-1?f.angle*.34:0):f.angle))*ex.p.opening.side]):ex.p.stroke?heading([-dsin(ex.p.stroke.yaw),-dcos(ex.p.stroke.yaw)]):heading([point.hand[0]-a.pose.p[0],point.hand[2]-a.pose.p[2]]),turn=((face-ex.yaw+Math.PI*3)%(Math.PI*2))-Math.PI;
  a.pose.yaw=ex.yaw+turn*smooth(ex.t/.4);
  const speed=Math.hypot(a.pose.p[0]-before[0],a.pose.p[2]-before[2])/dt;h.activity=speed>.08?'walk':'operate';if(speed>.08)h.speed=speed;else delete h.speed;
  if(f.armDown){delete h.hands;h.activity='idle';delete h.speed;}else h.hands=actuatorHand(ex.p.opening)==='left'?{left:[...point.hand]}:{right:[...point.hand]};h.handActuator=ex.motion;
  if(f.done){clear(rt,ex);return {status:'completed'};}return {status:'running',phase:ex.t<HAND_REACH_SECONDS?'reaching':ex.t<HAND_REACH_SECONDS+handSwingSeconds(ex.motion)?'operating':'releasing'};
 },
 cancel(rt,ex){
  // Before contact, return the partly raised arm without applying anything.
  // Once grasped, complete the short safe swing/release before a new walk owns the body.
  if(ex.t<HAND_REACH_SECONDS&&ex.motion.abortedAt===undefined){ex.motion.abortWeight=handActuatorFrame(ex.motion,ex.t).weight;ex.motion.abortedAt=ex.t;}
  return {ok:true,deferred:true};
 },resumable:true,
};
