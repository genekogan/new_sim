// Recorded, finite hand contact. Native roots own the step around a hinged leaf;
// viewers use this SAME timeline for the panel and the arm's reach/release weight.
import {z} from 'zod';
import type {ActionDef,Diagnostic,StepResult} from '../actions/types.ts';
import {DT,type Runtime} from '../runtime/runtime.ts';
import type {Spatial} from '../spatial/service.ts';
import {dcos,dsin,heading,type Vec2,type Vec3} from '../core/math.ts';
import {HUMAN_RADIUS} from '../world/catalog.ts';
import {clearanceAt} from '../spatial/grid.ts';
import {makeWay} from '../locomotion/walk.ts';
export const HAND_REACH_SECONDS=.65,HAND_SWING_SECONDS=2.2,HAND_RELEASE_SECONDS=.7;
export const HAND_IDLE_HANDOFF_SECONDS=1.2;
export const HAND_OPEN_ANGLE=-Math.PI*.48;
const vec=z.tuple([z.number().finite(),z.number().finite(),z.number().finite()]);
const opening=z.object({hinge:vec,yaw:z.number().finite(),radius:z.number().min(.2).max(2),height:z.number().min(.3).max(3),handleY:z.number().min(.3).max(2),from:z.number().min(-1.6).max(0),to:z.number().min(-1.6).max(0),side:z.union([z.literal(1),z.literal(-1)]),bodyPolicy:z.literal('door-natural-v2').optional()}).strict();
/** Soul Actions entry 31: this operation is one leg of a walk through the door (`open` before the doorway, `close` after
 *  it). `door` is the doorway centre, `from` the side (door-local z sign) the walk comes from. */
const passage=z.object({mode:z.enum(['open','close']),door:z.tuple([z.number().finite(),z.number().finite()]),from:z.union([z.literal(1),z.literal(-1)])}).strict();
export const handActuatorParams=z.object({actor:z.string(),target:z.string(),at:vec,opening:opening.optional(),passage:passage.optional()}).strict();
export type HandActuatorParams=z.infer<typeof handActuatorParams>;
export type HandActuatorMotion=Omit<HandActuatorParams,'actor'> & {startTick:number;actionId?:string;abortedAt?:number;abortWeight?:number};
const smooth=(v:number)=>{const k=Math.max(0,Math.min(1,v));return k*k*(3-2*k);};
export function handSwingSeconds(m:Pick<HandActuatorMotion,'opening'>){
 const o=m.opening;if(!o)return 0;
 if(o.bodyPolicy==='door-natural-v2')return Math.max(HAND_SWING_SECONDS,(Math.abs(o.to-o.from)*(o.radius+.42)+.35)*1.5/1.2);
 // Slow a larger opted-in leaf rather than exceeding ordinary walking speed.
 return Math.max(HAND_SWING_SECONDS,Math.abs(o.to-o.from)*Math.hypot(o.radius+(o.side<0?-.5:0),.42)*1.5/1.2);
}
export function handActuatorFrame(m:HandActuatorMotion,seconds:number){
 const swing=handSwingSeconds(m),releaseAt=HAND_REACH_SECONDS+swing;
 const commitAt=m.opening?.to===0?releaseAt:HAND_REACH_SECONDS;
 const k=smooth(((m.abortedAt??seconds)-HAND_REACH_SECONDS)/(swing||1));
 const angle=m.opening?m.opening.from+(m.opening.to-m.opening.from)*k:0;
 const weight=m.abortedAt!==undefined?(m.abortWeight??0)*(1-smooth((seconds-m.abortedAt)/HAND_RELEASE_SECONDS))
   :smooth(seconds/HAND_REACH_SECONDS)*(1-smooth((seconds-releaseAt)/HAND_RELEASE_SECONDS));
 const armDownAt=(m.abortedAt??releaseAt)+HAND_RELEASE_SECONDS,idleBlend=smooth((seconds-armDownAt)/HAND_IDLE_HANDOFF_SECONDS);
 return {angle,weight,idleBlend,armDown:seconds>=armDownAt,commitAt,done:seconds>=armDownAt+HAND_IDLE_HANDOFF_SECONDS,contact:m.abortedAt===undefined&&seconds>=commitAt};
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
  // Entry 31: pushing it shut from this side the body steps in with the leaf, and the drawn body trails its native root by
  // ~3 cm, so the close keeps 3 cm more from the wall (0.38 m measured clearance natively, 0.353 drawn, was the margin).
  const u=Math.max(0,Math.min(1,angle/HAND_OPEN_ANGLE)),ox=.35*u,oz=o.to===0&&o.from!==0?.48:.45;
  return {hand,root:[centre[0]+dcos(o.yaw)*ox+dsin(o.yaw)*oz,y,centre[2]-dsin(o.yaw)*ox+dcos(o.yaw)*oz] as Vec3};
 }
 const along=o.side<0?(o.bodyPolicy==='door-natural-v2'?-.35:-.5):0;
 const root:Vec3=[centre[0]+s*(o.bodyPolicy==='door-natural-v2'?.37:.42)*o.side+c*along,y,centre[2]+c*(o.bodyPolicy==='door-natural-v2'?.37:.42)*o.side-s*along];
 return {hand,root};
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
 const o=ex.p.opening,centre=o?o.hinge:ex.root,reach=o?o.radius+2:.5,near:Obstacle[]=[];
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
 const who=personBlocking(rt,ex,root,angle);
 return who?(who.code==='leaf-blocked'?issue('leaf-blocked','Someone is in the swinging panel’s path.',[p.target,who.id]):issue('person-in-way','Someone is in the operating path.',[p.actor,who.id])):null;
}
/** Distance from a point to the leaf's mid-plane segment at `angle` (hinge to free edge, plus a little). */
export function leafDistance(o:NonNullable<HandActuatorParams['opening']>,angle:number,x:number,z:number){
 const dx=x-o.hinge[0],dz=z-o.hinge[2],a=o.yaw+angle,c=dcos(a),s=dsin(a),along=Math.max(0,Math.min(o.radius+.12,dx*c-dz*s));
 return Math.hypot(dx-along*c,dz+along*s);
}
/** Another body on this level standing where the operator steps (`root`) or in the leaf's way at `angle`. */
function personBlocking(rt:Runtime,ex:Exec,root:Vec3,angle:number):{id:string;code:'person-in-way'|'leaf-blocked'}|null{
 const p=ex.p,actor=rt.world.entities[p.actor],o=p.opening;if(!actor?.human)return null;
 for(const e of Object.values(rt.world.entities)){
  if(e.id===p.actor||!e.human||(e.human.level??0)!==(actor.human.level??0))continue;
  if(Math.hypot(e.pose.p[0]-root[0],e.pose.p[2]-root[2])<2*HUMAN_RADIUS+.04)return {id:e.id,code:'person-in-way'};
  if(o&&leafDistance(o,angle,e.pose.p[0],e.pose.p[2])<HUMAN_RADIUS+.06)return {id:e.id,code:'leaf-blocked'};
 }
 return null;
}
// ---- Soul Actions entry 31: door passage (a door opened and closed as one leg of a walk) ----
/** Seconds a passage waits on a body in the swing before asking it to step aside, the longest it waits before reaching,
 *  the longest a swing stays paused on a body that stepped into it, and the longest it waits for another Soul to pass. */
export const PASSAGE_ASK_SECONDS=1,PASSAGE_WAIT_SECONDS=8,PASSAGE_PAUSE_SECONDS=6,PASSAGE_YIELD_SECONDS=15;
/** Other Souls' door passages through `door` (engine-mars installs `doorPassersV1` from its programmes). */
type Passer={actor:string;phase:'approach'|'opening'|'through'|'closing'};
const passers=(rt:Runtime,door:string):Passer[]=>((rt.services as {doorPassersV1?:(d:string)=>Passer[]}).doorPassersV1?.(door)??[]);
/** Is the door's closed gap still a solid in the walk graph (god engine-bridge: `<door>#door:<opening>`)? */
function doorShut(rt:Runtime,target:string){const sp=rt.services.spatial as Spatial|undefined;if(!sp)return false;sp.sync(rt.world);return sp.scene.obstacles.some(o=>o.id.startsWith(target+'#door:'));}
/** Door-local frame: `u` along the wall towards the latch, `n` the normal whose sign is the side. */
function doorFrame(p:HandActuatorParams){const y=p.opening!.yaw,u:[number,number]=[dcos(y),-dsin(y)],n:[number,number]=[dsin(y),dcos(y)],[cx,cz]=p.passage!.door;
 return {u,n,side:(x:number,z:number)=>((x-cx)*n[0]+(z-cz)*n[1])>=0?1:-1,local:(x:number,z:number)=>[(x-cx)*u[0]+(z-cz)*u[1],(x-cx)*n[0]+(z-cz)*n[1]] as const,at:(a:number,b:number):[number,number]=>[cx+u[0]*a+n[0]*b,cz+u[1]*a+n[1]*b]};}
/** Someone still to come through behind this Soul: another Soul's passage not yet through the doorway (within 10 m),
 *  or another body walking towards the doorway from the side this Soul came from (within 6 m) to a goal beyond it. */
function following(rt:Runtime,ex:Exec):string|null{
 const p=ex.p,f=doorFrame(p),[cx,cz]=p.passage!.door;
 for(const q of passers(rt,p.target)){if(q.actor===p.actor||q.phase==='closing')continue;const e=rt.world.entities[q.actor];if(e&&Math.hypot(e.pose.p[0]-cx,e.pose.p[2]-cz)<=10)return q.actor;}
 const walks=rt.services.walkExecs as Map<string,{actor?:string;goal?:{p:[number,number]}}>|undefined;
 for(const w of walks?.values()??[]){const e=w.actor&&w.actor!==p.actor?rt.world.entities[w.actor]:undefined;if(!e?.human||!w.goal)continue;
  if(Math.hypot(e.pose.p[0]-cx,e.pose.p[2]-cz)<=6&&f.side(e.pose.p[0],e.pose.p[2])===p.passage!.from&&f.side(w.goal.p[0],w.goal.p[1])!==p.passage!.from)return e.id;}
 return null;
}
/** Another Soul now opening, walking through or closing this door, or any body in the doorway itself. */
function passing(rt:Runtime,ex:Exec):string|null{
 const p=ex.p,[cx,cz]=p.passage!.door;
 const hand=handOnDoor(rt,ex);if(hand)return hand;
 for(const q of passers(rt,p.target))if(q.actor!==p.actor&&q.phase!=='approach')return q.actor;
 for(const e of Object.values(rt.world.entities))if(e.id!==p.actor&&e.human&&Math.hypot(e.pose.p[0]-cx,e.pose.p[2]-cz)<.75)return e.id;
 return null;
}
/** Another body's hand on this door now (its operation has begun and not yet let go). */
function handOnDoor(rt:Runtime,ex:Exec):string|null{for(const e of Object.values(rt.world.entities))if(e.id!==ex.p.actor&&e.human?.handActuator?.target===ex.p.target)return e.id;return null;}
/** Where a Soul waits for another to come through: beside the doorway on its own side, latch side first (out of the swing
 *  and of the way through), else the hinge side, else straight back; the first with standing room. */
function waitSpot(rt:Runtime,ex:Exec):[number,number]|null{
 const p=ex.p,a=rt.world.entities[p.actor],f=doorFrame(p),side=f.side(a.pose.p[0],a.pose.p[2]),sp=rt.services.spatial as Spatial|undefined,g=sp?.levelAt(a.human?.level??0,[a.pose.p[0],a.pose.p[2]]);
 for(const [x,zz] of [[1.35,1.0],[1.35,1.5],[-1.6,1.2],[0,1.9]] as const){const q=f.at(x,zz*side);if(!g||clearanceAt(g,q)>=HUMAN_RADIUS+.1)return q;}
 return null;
}
/** In the doorway's lane or swing (door-local |x| < 0.95 m, |z| < 1.6 m): where a waiting body is in the way. */
function inTheWay(ex:Exec,x:number,z:number){const [lx,lz]=doorFrame(ex.p).local(x,z);return Math.abs(lx)<.95&&Math.abs(lz)<1.6;}
/** A short courtesy walk of this Soul's own (a child of the operation, so the body stays reserved to it). */
function stepTo(rt:Runtime,ex:Exec,q:[number,number]){const r=rt.submit('walk_to',{actor:ex.p.actor,x:q[0],z:q[1]},{parent:ex.id});if(r.status!=='failed')ex.child=r.id;return r.status!=='failed';}
/** One passage tick before or while operating: a result to return now, or null to run the ordinary operation. */
function passageStep(rt:Runtime,ex:Exec,dt:number):StepResult|null{
 const p=ex.p,o=p.opening!,a=rt.world.entities[p.actor],pass=p.passage!;
 if(ex.child){if(rt.isActive(ex.child))return {status:'running',phase:'waiting'};delete ex.child;}
 if(!ex.began){
  if(pass.mode==='open'&&!doorShut(rt,p.target)){const who=passing(rt,ex);if(!who)return skip(rt,ex,'found open');return hold(rt,ex,'passing',who);}
  if(pass.mode==='close'){if(doorShut(rt,p.target))return skip(rt,ex,'already shut');const who=following(rt,ex);if(who)return skip(rt,ex,'held open for '+who);}
  const hand=handOnDoor(rt,ex);if(hand)return hold(rt,ex,'passing',hand);
  // the whole swing and the stepping path, closed to open, before the hand goes out
  for(let k=0;k<=8;k++){const ang=o.from+(o.to-o.from)*k/8,pt=actuatorPoint(o,ang),who=personBlocking(rt,ex,pt.root,ang);if(who)return hold(rt,ex,'swing',who.id);}
  const r0=actuatorPoint(o,o.from).root;
  if(Math.hypot(a.pose.p[0]-r0[0],a.pose.p[2]-r0[2])>.2){if(stepTo(rt,ex,[r0[0],r0[2]]))return {status:'running',phase:'waiting'};return {status:'failed',diagnostic:issue('not-at-handle','Walk to the actual handle before operating it.',[p.target])};}
  ex.began=true;delete ex.held;ex.t=0;ex.root=[...a.pose.p];ex.yaw=a.pose.yaw;ex.motion.startTick=rt.tick;
  rt.mark('hand.passage-begin',{action:ex.id,target:p.target,mode:pass.mode});
  return null;
 }
 // operating: a body that steps into the swing pauses the leaf (the shared timeline shifts with it, so every viewer draws
 // the same pause); after PASSAGE_PAUSE_SECONDS the ordinary check below refuses and the hand lets go
 const swing=handSwingSeconds(ex.motion);
 if(ex.t<HAND_REACH_SECONDS+swing&&(ex.paused??0)*dt<PASSAGE_PAUSE_SECONDS){
  const f=handActuatorFrame(ex.motion,ex.t+dt),pt=actuatorPoint(o,f.angle),who=personBlocking(rt,ex,pt.root,f.angle);
  if(who){ex.paused=(ex.paused??0)+1;ex.motion.startTick+=1;if(ex.paused*dt>=PASSAGE_ASK_SECONDS&&ex.held?.asked!==who.id){ex.held={since:rt.tick,why:'swing',asked:who.id};ask(rt,who.id,swingCentre(o));}return {status:'running',phase:'operating'};}
 }
 return null;
}
/** Ask a body standing idle in the swing to step aside (entry 28's courtesy step-aside); someone sitting, lying, asleep
 *  or busy is not shooed off for a door: the Soul waits, and stops with a reason if the way does not clear. */
function ask(rt:Runtime,who:string,keepClear:Vec2){const h=rt.world.entities[who]?.human;if(h&&h.activity==='idle'&&!h.sleepPose&&!h.baseActivity&&!h.task)makeWay(rt,who,keepClear);}
const swingCentre=(o:NonNullable<HandActuatorParams['opening']>):Vec2=>{const a=o.yaw+(o.from+o.to)/2,r=o.radius*.6;return [o.hinge[0]+dcos(a)*r,o.hinge[2]-dsin(a)*r];};
function skip(rt:Runtime,ex:Exec,why:string):StepResult{ex.skip=why;rt.mark('hand.passage-skip',{action:ex.id,target:ex.p.target,mode:ex.p.passage!.mode,why});return {status:'completed'};}
/** Wait before reaching: out of the way for a Soul passing; a body in the swing is asked to step aside after a second. */
function hold(rt:Runtime,ex:Exec,why:'passing'|'swing',who:string):StepResult{
 const p=ex.p,a=rt.world.entities[p.actor];ex.held??={since:rt.tick,why};if(ex.held.why!==why)ex.held={since:rt.tick,why};
 const waited=(rt.tick-ex.held.since)*DT;
 if(waited>(why==='passing'?PASSAGE_YIELD_SECONDS:PASSAGE_WAIT_SECONDS))return {status:'failed',diagnostic:why==='passing'?issue('door-busy','Someone else kept passing through the door; this walk stopped before it.',[p.target,who]):issue('swing-blocked','Someone is in the door’s swing and did not move aside; nothing was opened.',[p.target,who])};
 if(why==='passing'&&inTheWay(ex,a.pose.p[0],a.pose.p[2])){const q=waitSpot(rt,ex);if(q&&Math.hypot(q[0]-a.pose.p[0],q[1]-a.pose.p[2])>.3&&stepTo(rt,ex,q))return {status:'running',phase:'waiting'};}
 if(why==='swing'&&waited>=PASSAGE_ASK_SECONDS&&ex.held.asked!==who){ex.held.asked=who;ask(rt,who,swingCentre(p.opening!));}
 if(a.human&&!ex.child)a.human.activity='idle';
 return {status:'running',phase:'waiting'};
}
type Exec={p:HandActuatorParams;motion:HandActuatorMotion;t:number;root:Vec3;yaw:number;id?:string;
 /** passage: nothing to do (found open, or someone is following) */ skip?:string;
 /** passage: waiting before the reach (a body in the swing, another Soul passing) since tick; who was asked to step aside */ held?:{since:number;asked?:string;why:string};
 /** passage: ticks the swing has been paused on a body in it */ paused?:number;
 /** passage: a courtesy walk of this Soul's own in progress */ child?:string;
 /** passage: the operation reached the door (motion begun) */ began?:true};
function clear(rt:Runtime,ex:Exec){const h=rt.world.entities[ex.p.actor]?.human;if(!h)return;delete h.handActuator;delete h.hands;delete h.speed;h.activity='idle';}
export const handActuator:ActionDef<HandActuatorParams,true,Exec>={
 verb:'hand_actuator_v1',description:'Reach, operate a switch or hinged opening with continuous hand contact, and lower the arm before releasing the body.',schema:handActuatorParams,
 // A passage step shares the door with other passages and decides who goes first itself (passageStep: one hand on the
 // door at a time); against an explicit open/close it is exclusive as before, and waits for it (runtime nudgeHolds).
 reservations:(_w,p)=>[{resource:'actor:'+p.actor,mode:'exclusive'},{resource:'hand:'+p.actor+(':'+actuatorHand(p.opening)),mode:'exclusive'},{resource:'entity:'+p.target,mode:p.passage?'shared':'exclusive'}],
 plan(rt,p){const actor=rt.world.entities[p.actor],h=actor?.human;if(actor?.body?.family==='floater')return {ok:false,diagnostic:issue('no-arms','This body has no humanoid hand actuator.',[p.actor])};if(!h||h.grip||h.hands||h.on||h.carrier||h.riding||h.shore||h.holding||h.activity==='sit')return {ok:false,diagnostic:issue('body-busy','Stand with a free hand on stable ground first.',[p.actor])};return {ok:true,program:true};},
 start(rt,p,_plan,_id){const a=rt.world.entities[p.actor];return {p:structuredClone(p),motion:{...structuredClone(p),startTick:rt.tick,actionId:_id},t:0,root:[...a.pose.p],yaw:a.pose.yaw,id:_id};},
 step(rt,ex,dt){
  const a=rt.world.entities[ex.p.actor],h=a?.human;if(!h)return {status:'failed',diagnostic:issue('body-gone','The original body is gone.',[ex.p.actor])};
  if(ex.p.passage&&ex.p.opening){const r=passageStep(rt,ex,dt);if(r)return r;}
  ex.t+=dt;const f=handActuatorFrame(ex.motion,ex.t),point=ex.p.opening?actuatorPoint(ex.p.opening,f.angle):{hand:ex.p.at,root:ex.root};
  if(ex.p.opening&&Math.hypot(ex.root[0]-actuatorPoint(ex.p.opening,ex.p.opening.from).root[0],ex.root[2]-actuatorPoint(ex.p.opening,ex.p.opening.from).root[2])>.22){clear(rt,ex);return {status:'failed',diagnostic:issue('not-at-handle','Walk to the actual handle before operating it.',[ex.p.target])};}
  if(ex.p.opening&&ex.t<HAND_REACH_SECONDS){const k=smooth(ex.t/HAND_REACH_SECONDS);point.root=[ex.root[0]+(point.root[0]-ex.root[0])*k,ex.root[1]+(point.root[1]-ex.root[1])*k,ex.root[2]+(point.root[2]-ex.root[2])*k];}
  const bad=blocked(rt,ex,point.root,f.angle);if(bad){clear(rt,ex);return {status:'failed',diagnostic:bad};}
  const before=[...a.pose.p];a.pose.p=[...point.root];
  const face=ex.p.opening?heading([-dsin(ex.p.opening.yaw+(ex.p.opening.bodyPolicy==='door-natural-v2'?(ex.p.opening.side===-1?f.angle*.34:0):f.angle))*ex.p.opening.side,-dcos(ex.p.opening.yaw+(ex.p.opening.bodyPolicy==='door-natural-v2'?(ex.p.opening.side===-1?f.angle*.34:0):f.angle))*ex.p.opening.side]):heading([point.hand[0]-a.pose.p[0],point.hand[2]-a.pose.p[2]]),turn=((face-ex.yaw+Math.PI*3)%(Math.PI*2))-Math.PI;
  a.pose.yaw=ex.yaw+turn*smooth(ex.t/.4);
  const speed=Math.hypot(a.pose.p[0]-before[0],a.pose.p[2]-before[2])/dt;h.activity=speed>.08?'walk':'operate';if(speed>.08)h.speed=speed;else delete h.speed;
  if(f.armDown){delete h.hands;h.activity='idle';delete h.speed;}else h.hands=actuatorHand(ex.p.opening)==='left'?{left:[...point.hand]}:{right:[...point.hand]};h.handActuator=ex.motion;
  if(f.done){clear(rt,ex);return {status:'completed'};}return {status:'running',phase:ex.t<HAND_REACH_SECONDS?'reaching':ex.t<HAND_REACH_SECONDS+handSwingSeconds(ex.motion)?'operating':'releasing'};
 },
 cancel(rt,ex){
  // Before contact, return the partly raised arm without applying anything.
  // Once grasped, complete the short safe swing/release before a new walk owns the body.
  if(ex.p.passage&&!ex.began)return {ok:true};
  if(ex.t<HAND_REACH_SECONDS&&ex.motion.abortedAt===undefined){ex.motion.abortWeight=handActuatorFrame(ex.motion,ex.t).weight;ex.motion.abortedAt=ex.t;}
  return {ok:true,deferred:true};
 },resumable:true,
};
