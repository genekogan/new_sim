// Optional drink/1 action; registered only by its explicit native fixture.
// Existing item registry/history and hunger/need semantics remain unchanged.
import {z} from 'zod';
import type {ActionDef,Diagnostic} from '../actions/types.ts';
import type {Runtime} from '../runtime/runtime.ts';
import type {Entity} from '../world/types.ts';
import type {Vec3} from '../core/math.ts';
import {bodyFrame,carryHand,mouthPoint,SEAT_DROP,lerp3,smooth,type Hand} from './body.ts';
import {followHand,heldBy,isItem} from './model.ts';
import {slotsOf,slotById} from '../social/slots.ts';
import {angleDelta,hypot} from '../core/math.ts';
export const DRINK_POLICY=Object.freeze({contract:'drink/1',raiseSeconds:.8,sipSeconds:.4,lowerSeconds:.8,fractionPerSip:.125});
type Params={actor:string;container:string;sips:number};
type Exec={id:string;p:Params;hand:Hand;at:Vec3;level:number;base:string;phase:'raise'|'sip'|'lower';t:number;done:number;stopping:boolean;from:Vec3};
const still=new Set(['idle','sit','gather','converse','listen','watch']);
const issue=(code:string,message:string,subjects:string[]):Diagnostic=>({code:'drink.'+code,message,subjects});
function actualSeat(rt:Runtime,actor:Entity):boolean{
  for(const id of rt.holder('actor:'+actor.id)){
    const record=rt.records.get(id);if(!record||!['sit','take_slot'].includes(record.verb)||record.phase!=='occupied')continue;
    const p=record.params as {fixture?:string;slot?:string};const slots=p.slot?[slotById(rt,p.slot)]:p.fixture?slotsOf(rt,p.fixture):[];if(!Array.isArray(slots))continue;
    if(slots.some(slot=>!('code' in slot)&&slot.kind==='seat'&&slot.claimedBy===id&&slot.level===actor.human!.level
      &&hypot(actor.pose.p[0]-slot.p[0],actor.pose.p[2]-slot.p[1])<1e-6&&Math.abs(angleDelta(actor.pose.yaw,slot.yaw))<1e-6))return true;
  }return false;
}
/** Only the registered optional invariant may recognize this overlay, and only
 * with the actual current native seat/actor claims and exact occupied frame. */
export const qualifiedSeatedDrink=(rt:Runtime,actor:Entity)=>actor.human?.activity==='drink'&&actor.human.baseActivity==='sit'&&actualSeat(rt,actor);
function admission(rt:Runtime,p:Params,allowDrink=false):{actor:Entity;container:Entity;hand:Hand}|Diagnostic{
  const actor=rt.world.entities[p.actor],container=rt.world.entities[p.container],h=actor?.human;
  if(!h||actor.kind!=='human'||actor.body&&actor.body.family!=='humanoid')return issue('body-family','This drink profile requires actual humanoid hands and mouth.',[p.actor]);
  if(h.grip||h.riding||h.on||h.shore||h.boatPassenger||h.boatTransit||h.sleepPose)return issue('occupied-support','Release climbing, load, water, vehicle or sleeping support before this drink.',[p.actor]);
  if(rt.holder('actor:'+p.actor).some(id=>rt.records.get(id)?.verb==='walk_to'))return issue('not-still','Finish the actual walking controller before drinking.',[p.actor]);
  if(!(still.has(h.activity)||allowDrink&&h.activity==='drink'))return issue('not-still','Drink while seated or standing still on admitted ordinary support.',[p.actor]);
  if((h.activity==='sit'||h.activity==='drink'&&h.baseActivity==='sit')&&!actualSeat(rt,actor))return issue('seat-unqualified','The drink has no actual occupied native seat frame.',[p.actor]);
  if(!container||!isItem(container)||container.def!=='bowl'||container.support?.kind!=='in-hand'||container.support.by!==p.actor)return issue('not-held','Hold this supported bowl before drinking.',[p.actor,p.container]);
  if(heldBy(rt.world,p.actor).length!==1)return issue('other-hand-occupied','This first drink profile requires the other hand to be free.',[p.actor]);
  if(container.contents?.food!=='water')return issue('not-water','This profile is qualified only for water in the held bowl.',[p.container]);
  if(!Number.isFinite(container.contents.fraction)||container.contents.fraction<0||container.contents.fraction>1)return issue('quantity-unqualified','The finite water fraction must be within zero and one.',[p.container]);
  return {actor,container,hand:container.support.hand};
}
function clear(rt:Runtime,ex:Exec){const actor=rt.world.entities[ex.p.actor];if(!actor?.human)return;if(actor.human.activity==='drink')actor.human.activity=ex.base;delete actor.human.baseActivity;}
export const drinkWater:ActionDef<Params,{hand:Hand},Exec>={
  verb:'drink_water',description:'Consume finite water from an actually held bowl, one recorded mouth sip at a time, seated or still-standing with the other hand free. Raise/sip/lower are recorded; cancellation lowers safely without refunding a completed sip. No thirst/hunger outcome is invented.',
  schema:z.object({actor:z.string().min(1).max(80),container:z.string().min(1).max(80),sips:z.number().int().min(1).max(8)}).strict(),
  reservations:(_w,p)=>[{resource:'hand:'+p.actor+':left',mode:'exclusive'},{resource:'hand:'+p.actor+':right',mode:'exclusive'},{resource:'entity:'+p.container,mode:'exclusive'}],
  plan(rt,p){const a=admission(rt,p);if('code' in a)return {ok:false,diagnostic:a};if(!a.container.contents||a.container.contents.fraction<DRINK_POLICY.fractionPerSip)return {ok:false,diagnostic:issue('empty','There is not enough water for one sip.',[p.container])};return {ok:true,program:{hand:a.hand}};},
  start(rt,p,plan,id){const actor=rt.world.entities[p.actor],base=actor.human!.activity,b=bodyFrame(actor,base==='sit'?SEAT_DROP:0);return {id,p:structuredClone(p),hand:plan.hand,at:[...actor.pose.p],level:actor.human!.level,base,phase:'raise',t:0,done:0,stopping:false,from:actor.human!.hands?.[plan.hand]?[...actor.human!.hands[plan.hand]!]:carryHand(b,plan.hand)};},
  step(rt,ex,dt){
    const a=admission(rt,ex.p,true);if('code' in a){clear(rt,ex);return {status:'failed',diagnostic:a};}
    if(a.actor.human!.level!==ex.level||a.actor.pose.p.some((n,i)=>Math.abs(n-ex.at[i])>1e-6)){clear(rt,ex);return {status:'failed',diagnostic:issue('moved','The actor stopped being still; no further sip was consumed.',[ex.p.actor])};}
    const h=a.actor.human!,b=bodyFrame(a.actor,ex.base==='sit'?SEAT_DROP:0),duration=ex.phase==='raise'?DRINK_POLICY.raiseSeconds:ex.phase==='sip'?DRINK_POLICY.sipSeconds:DRINK_POLICY.lowerSeconds;
    ex.t+=dt;const k=smooth(Math.min(1,ex.t/duration)),q=ex.phase==='raise'?lerp3(ex.from,mouthPoint(b),k):ex.phase==='sip'?mouthPoint(b):lerp3(ex.from,carryHand(b,ex.hand),k);
    h.activity='drink';h.baseActivity=ex.base;(h.hands??={})[ex.hand]=q;followHand(a.container,q,a.actor.pose.yaw);
    if(ex.t+1e-9<duration)return {status:'running',phase:ex.phase};
    if(ex.phase==='raise'){ex.phase='sip';ex.t=0;return {status:'running',phase:ex.phase};}
    if(ex.phase==='sip'){
      if(a.container.contents!.fraction<DRINK_POLICY.fractionPerSip){clear(rt,ex);return {status:'failed',diagnostic:issue('depleted','The water changed before this sip; no partial sip was taken.',[ex.p.container])};}
      a.container.contents!.fraction-=DRINK_POLICY.fractionPerSip;ex.done++;ex.phase='lower';ex.from=[...q];ex.t=0;return {status:'running',phase:ex.phase};
    }
    if(ex.stopping||ex.done>=ex.p.sips||a.container.contents!.fraction<DRINK_POLICY.fractionPerSip){clear(rt,ex);return {status:'completed',outputs:{sips:ex.done,fractionConsumed:ex.done*DRINK_POLICY.fractionPerSip}};}
    ex.phase='raise';ex.from=[...q];ex.t=0;return {status:'running',phase:ex.phase};
  },
  cancel(rt,ex){if(ex.stopping)return {ok:true,deferred:true};const actor=rt.world.entities[ex.p.actor];if(!actor?.human){clear(rt,ex);return {ok:true};}ex.stopping=true;ex.from=[...(actor.human.hands?.[ex.hand]??ex.from)];ex.phase='lower';ex.t=0;return {ok:true,deferred:true};},
  resumable:true,
};
