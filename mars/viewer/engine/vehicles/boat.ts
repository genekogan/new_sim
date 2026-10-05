// A deliberately bounded stopped-dock/seat/translation controller. The same
// native Runtime owns boarding, passenger poses and boat motion; no visual path.
import { z } from 'zod';
import type { ActionDef, Diagnostic } from '../actions/types.ts';
import type { Runtime, Invariant } from '../runtime/runtime.ts';
import type { Entity } from '../world/types.ts';
import { hypot, angleDelta, heading, wrapAngle, obbOverlap } from '../core/math.ts';
import { entityFootprint } from '../spatial/service.ts';
import { shoreObstruction, publishShoreContact, type ShoreGeometry } from '../locomotion/shore.ts';

type V3=[number,number,number];
export const BOAT_POLICY=Object.freeze({boatId:'eden-boat-prototype',dockId:'eden-dock',
  keelY:-.3,frameOffsetY:.4,deckOffsetY:.8,draft:.3,keelMargin:.1,
  travelSpeed:.6,boardingSpeed:.35,radius:.28,connectorWidth:.8});
const B=BOAT_POLICY;
function freeze<T>(x:T):T {if(x&&typeof x==='object'){for(const v of Object.values(x))freeze(v);Object.freeze(x);}return x;}
export const BOAT_LAYOUT=freeze({
  contract:'native-boat-layout/1',boatId:B.boatId,dockId:B.dockId,
  nativeFrame:'base-centred-keel',authoredFrameOffset:[0,.4,0] as V3,
  boatDockPosition:[-4,B.keelY,7] as V3,bank:[4,.52,5] as V3,
  dock:{position:[-3,.5,5] as V3,size:[6,.2,2] as V3,topY:.7},
  ramp:{from:[4,.52,5] as V3,to:[0,.7,5] as V3,width:1.5},
  deckEntry:[-4,.7,5.5] as V3,
  connector:{from:[-4,.7,5.5] as V3,to:[-4,.5,6.75] as V3,width:.8},
  seats:{seat0:{root:[-.65,.8,0] as V3,yaw:Math.PI},seat1:{root:[.65,.8,0] as V3,yaw:0}},
});
export type BoatGeometry={shore:ShoreGeometry;clearance(from:V3,to:V3):boolean};
export type BoatPolicy = {[K in keyof typeof BOAT_POLICY]:(typeof BOAT_POLICY)[K] extends number?number:string};
function controllersAt(B:BoatPolicy,layout:typeof BOAT_LAYOUT){
const DOCK=layout.boatDockPosition,BANK=layout.bank,seats=layout.seats;

type PathPoint={p:V3;support:string};
type Transfer={actor:string;boat:string;slot:'seat0'|'seat1';leaving:boolean;points:PathPoint[];index:number;id:string};
type Sailing={boat:string;actor:string;goal:V3;id:string};
const diag=(code:string,message:string,subjects?:string[]):Diagnostic=>({code:`boat.${code}`,message,subjects});
const dist=(a:V3,b:V3)=>hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
const eq=(a:V3,b:V3)=>a.every((v,k)=>Math.abs(v-b[k])<1e-9);
const boat=(rt:Runtime)=>rt.world.entities[B.boatId];
const seatRoot=(v:Entity,slot:'seat0'|'seat1'):V3=>[v.pose.p[0]+seats[slot].root[0],v.pose.p[1]+seats[slot].root[1],v.pose.p[2]];
function docked(rt:Runtime):Diagnostic|null {
  const v=boat(rt),dock=rt.world.entities[B.dockId];
  if(!v?.boat||v.def!=='eden-shore-boat'||v.pose.yaw!==0||v.pose.pitch||v.pose.roll)return diag('unknown-frame','boat frame is not qualified');
  if(!dock||dock.def!=='eden-shore-dock'||!eq(dock.pose.p,layout.dock.position)||dock.pose.yaw!==0||dock.pose.pitch||dock.pose.roll)
    return diag('dock-gone','the published dock support is unavailable',[B.dockId]);
  if(!eq(v.pose.p,DOCK)||v.boat.phase!=='docked'||v.boat.dockId!==B.dockId||!v.boat.connectorOpen||v.boat.speed!==0)
    return diag('not-docked','boarding/exiting requires the exact stopped dock and deployed connector',[v.id]);
  return null;
}
function path(rt:Runtime,slot:'seat0'|'seat1',leaving:boolean):PathPoint[] {
  const p:PathPoint[]=[{p:[...BANK],support:'bank'}, {p:[...layout.ramp.to],support:'shore-ramp'},
    {p:[...layout.deckEntry],support:'dock-deck'}, {p:[...layout.connector.to],support:'dock-gangway'},
    {p:seatRoot(boat(rt),slot),support:'boat-deck'}];
  return leaving?p.map((point,i)=>({p:point.p,support:p[Math.min(i+1,p.length-1)].support})).reverse():p;
}
function freeBody(rt:Runtime,actor:string):Diagnostic|null {
  const e=rt.world.entities[actor],h=e?.human;
  if(!h||e.kind!=='human'||(e.body&&e.body.family!=='humanoid'))return diag('body-family',`${actor} has no qualified passenger anatomy`,[actor]);
  if(h.hands?.left||h.hands?.right||h.grip||h.riding||h.on||h.sleepPose
    ||Object.values(rt.world.entities).some(e=>e.support?.kind==='in-hand'&&e.support.by===actor))
    return diag('occupied-body',`${actor} needs free hands and no load or other support`,[actor]);
  return null;
}
const supportIds=new Set([B.boatId,B.dockId]);
function publishTransfer(rt:Runtime,ex:Transfer,from:PathPoint,to:PathPoint,t:number,speed:number) {
  const h=rt.world.entities[ex.actor].human!;
  h.boatTransit={from:[...from.p],to:[...to.p],t,supportId:to.support};
  h.activity=ex.leaving?'leave-boat':'board';h.speed=speed;delete h.shore;
}
function seated(rt:Runtime,ex:Transfer) {
  const e=rt.world.entities[ex.actor],h=e.human!;
  h.boatPassenger={boatId:B.boatId,slotId:ex.slot,phase:'seated',localRoot:[...seats[ex.slot].root],relativeYaw:seats[ex.slot].yaw};
  h.activity='sit';delete h.speed;delete h.boatTransit;delete h.task;
}
function routeHit(rt:Runtime,from:V3,to:V3):Diagnostic|null {
  const v=boat(rt),occupants=new Set(Object.values(v.boat!.passengers));
  // Bounding rectangle of the entire translated hull and seated upright body
  // envelopes. Yaw is fixed at zero. Conservative, not sampled point clearance.
  const minX=Math.min(from[0],to[0])-1.5,maxX=Math.max(from[0],to[0])+1.5;
  const minZ=Math.min(from[2],to[2])-.65,maxZ=Math.max(from[2],to[2])+.65;
  const top=occupants.size?B.keelY+B.deckOffsetY+1.8:B.keelY+.8;
  for(const e of Object.values(rt.world.entities)) {
    if(e.id===v.id||occupants.has(e.id)||e.kind==='marker')continue;
    let o;
    try{o=e.human?{obb:{c:[e.pose.p[0],e.pose.p[2]] as [number,number],half:[.28,.28] as [number,number],yaw:0},y0:e.pose.p[1],y1:e.pose.p[1]+1.8}:entityFootprint(e);}
    catch{return diag('unknown-envelope',`${e.id} has no qualified boat collision envelope`,[e.id]);}
    if(o.y1<=B.keelY||o.y0>=top)continue;
    if(obbOverlap({c:[(minX+maxX)/2,(minZ+maxZ)/2],half:[(maxX-minX)/2,(maxZ-minZ)/2],yaw:0},o.obb))
      return diag('occupied-route',`boat's full swept hull/passenger envelope meets ${e.id}`,[v.id,e.id]);
  }
  return null;
}
function stopSailing(rt:Runtime) {
  const v=boat(rt),s=v?.boat;if(!s)return;s.speed=0;
  if(eq(v.pose.p,DOCK)&&rt.world.entities[B.dockId]){s.phase='docked';s.dockId=B.dockId;s.connectorOpen=true;}
  else{s.phase='stopped';s.dockId=null;s.connectorOpen=false;}
}
function sailingBodies(rt:Runtime):Diagnostic|null {
  const v=boat(rt),s=v?.boat;
  if(!s||v.def!=='eden-shore-boat'||v.pose.yaw!==0||v.pose.p[1]!==B.keelY||v.pose.pitch||v.pose.roll)
    return diag('unknown-frame','boat is not at its admitted keel/yaw frame');
  for(const [slot,actor] of Object.entries(s.passengers)) {
    const e=rt.world.entities[actor];
    if(!Object.hasOwn(seats,slot)||!e?.human)return diag('passenger-mismatch','boat passenger body or slot is missing',[actor]);
    const body=boatBodyContact(rt,e);
    if(e.human.boatPassenger?.phase!=='seated'||!body||body.length)return diag('passenger-mismatch','boat passenger no longer occupies its admitted seat frame',[actor]);
    const issue=freeBody(rt,actor);if(issue)return issue;
  }
  return null;
}

function boatActions(g:BoatGeometry):ActionDef[] {
  function transfer(leaving:boolean):ActionDef<{actor:string;slot:'seat0'|'seat1'},PathPoint[],Transfer> {
    return {
      verb:leaving?'boat_leave':'boat_board',description:leaving?'Leave a stopped, docked boat through its actual supported connector.':'Board a stopped, docked boat through the admitted ramp, deck and connector into one finite passenger seat.',
      schema:z.object({actor:z.string().min(1),slot:z.enum(['seat0','seat1'])}).strict(),resumable:true,
      reservations:(_w,p)=>[{resource:`actor:${p.actor}`,mode:'exclusive'},{resource:`boat:${B.boatId}`,mode:'exclusive'},
        {resource:`boat-seat:${B.boatId}:${p.slot}`,mode:'exclusive'},{resource:`connector:${B.boatId}`,mode:'exclusive'}],
      plan(rt,p) {
        const issue=freeBody(rt,p.actor)??docked(rt);if(issue)return {ok:false,diagnostic:issue};
        const v=boat(rt),e=rt.world.entities[p.actor],h=e.human!;
        if(rt.holder(`boat:${B.boatId}`).length)return {ok:false,diagnostic:diag('occupied-connector','wait until the current boarding/exiting or route action releases the boat')};
        if(leaving) {
          if(h.boatPassenger?.phase!=='seated'||h.boatPassenger.slotId!==p.slot||v.boat!.passengers[p.slot]!==p.actor)
            return {ok:false,diagnostic:diag('not-passenger',`${p.actor} does not occupy ${p.slot}`)};
        } else if(h.boatPassenger||h.boatTransit||v.boat!.passengers[p.slot])return {ok:false,diagnostic:diag('seat-occupied',`${p.slot} or ${p.actor} is already occupied`)};
        const points=path(rt,p.slot,leaving);
        if(dist(e.pose.p,points[0].p)>.001)return {ok:false,diagnostic:diag('not-at-entry',`${p.actor} must reach the supported boarding/exit entry first`,[p.actor])};
        for(let i=1;i<points.length;i++){const hit=shoreObstruction(rt,p.actor,points[i-1].p,points[i].p,supportIds);if(hit)return {ok:false,diagnostic:hit};}
        return {ok:true,program:points};
      },
      start(rt,p,points,id) {
        const h=rt.world.entities[p.actor].human!;
        boat(rt).boat!.passengers[p.slot]=p.actor;
        h.boatPassenger={boatId:B.boatId,slotId:p.slot,phase:leaving?'leaving':'boarding',localRoot:[...seats[p.slot].root],relativeYaw:seats[p.slot].yaw};h.task=id;
        const ex={actor:p.actor,boat:B.boatId,slot:p.slot,leaving,points,index:1,id};publishTransfer(rt,ex,points[0],points[1],0,0);return ex;
      },
      step(rt,ex,dt) {
        const issue=docked(rt)??freeBody(rt,ex.actor);if(issue)return {status:'blocked',diagnostic:issue};
        const e=rt.world.entities[ex.actor];
        while(ex.index<ex.points.length&&dist(e.pose.p,ex.points[ex.index].p)<1e-10)ex.index++;
        if(ex.index===ex.points.length) {
          if(!ex.leaving) {
            const turn=angleDelta(e.pose.yaw,seats[ex.slot].yaw);
            e.pose.yaw=wrapAngle(e.pose.yaw+Math.max(-4*dt,Math.min(4*dt,turn)));
            if(Math.abs(turn)>1e-10){publishTransfer(rt,ex,ex.points[ex.points.length-2],ex.points[ex.points.length-1],1,0);return {status:'running',phase:'seating'};}
          }
          if(ex.leaving){delete boat(rt).boat!.passengers[ex.slot];delete e.human!.boatPassenger;delete e.human!.boatTransit;delete e.human!.task;publishShoreContact(rt,g.shore,ex.actor,false);}
          else seated(rt,ex);
          return {status:'completed',outputs:{boat:B.boatId,slot:ex.slot,position:[...e.pose.p],phase:ex.leaving?'ashore':'seated'}};
        }
        const from=ex.points[ex.index-1],to=ex.points[ex.index],d=dist(e.pose.p,to.p);
        const desired=heading([to.p[0]-from.p[0],to.p[2]-from.p[2]]),turn=angleDelta(e.pose.yaw,desired);
        e.pose.yaw=wrapAngle(e.pose.yaw+Math.max(-4*dt,Math.min(4*dt,turn)));
        if(Math.abs(turn)>.35){publishTransfer(rt,ex,from,to,dist(from.p,e.pose.p)/dist(from.p,to.p),0);return {status:'running',phase:'turning'};}
        const fraction=Math.min(1,B.boardingSpeed*dt/d),next=e.pose.p.map((v,i)=>v+(to.p[i]-v)*fraction) as V3;
        const hit=shoreObstruction(rt,ex.actor,e.pose.p,next,supportIds);if(hit){e.human!.speed=0;return {status:'blocked',diagnostic:hit};}
        e.pose.p=next;
        const progress=dist(from.p,next)/dist(from.p,to.p);publishTransfer(rt,ex,from,to,Math.min(1,progress),B.boardingSpeed);
        return {status:'running',phase:ex.leaving?'leaving':'boarding'};
      },
      // Finish the supported committed path before cancelling; no connector
      // release with an actor stranded above water, and no forced seat teleport.
      cancel:()=>({ok:true,deferred:true}),
    };
  }
  const sail:ActionDef<{actor:string;x:number;z:number},V3,Sailing>={
    verb:'boat_travel',description:'Translate the fixed-yaw calm-water boat with its actual seated passengers. Pilot permission is separate from a seat. Full hull draft/occupancy are checked before and during motion.',
    schema:z.object({actor:z.string().min(1),x:z.number().min(-10000).max(10000),z:z.number().min(-10000).max(10000)}).strict(),resumable:true,
    reservations:(w)=>[{resource:`boat:${B.boatId}`,mode:'exclusive'},...Object.values(w.entities[B.boatId]?.boat?.passengers??{}).map(actor=>({resource:`actor:${actor}`,mode:'exclusive' as const}))],
    plan(rt,p) {
      const v=boat(rt),s=v?.boat,h=rt.world.entities[p.actor]?.human;
      if(!s||v.pose.yaw!==0||v.pose.p[1]!==B.keelY||v.pose.pitch||v.pose.roll)return {ok:false,diagnostic:diag('unknown-frame','boat is not at its admitted keel/yaw frame')};
      if(!s.pilotIds.includes(p.actor))return {ok:false,diagnostic:diag('pilot-not-authorized',`${p.actor} has no separate pilot capability`)};
      if(h?.boatPassenger?.boatId!==v.id||h.boatPassenger.phase!=='seated')return {ok:false,diagnostic:diag('pilot-not-aboard',`${p.actor} must occupy an actual passenger seat`)};
      if(rt.holder(`boat:${B.boatId}`).length||Object.values(s.passengers).some(a=>rt.world.entities[a]?.human?.boatPassenger?.phase!=='seated'))
        return {ok:false,diagnostic:diag('occupied-connector','the boat cannot depart during boarding/exiting')};
      const bodies=sailingBodies(rt);if(bodies)return {ok:false,diagnostic:bodies};
      const goal:V3=[p.x,B.keelY,p.z];
      if(!g.clearance(v.pose.p,goal))return {ok:false,diagnostic:diag('draft-clearance','full swept hull lacks the declared draft plus under-keel margin')};
      const hit=routeHit(rt,v.pose.p,goal);if(hit)return {ok:false,diagnostic:hit};return {ok:true,program:goal};
    },
    start(rt,p,goal,id){const s=boat(rt).boat!;s.connectorOpen=false;s.dockId=null;s.phase='underway';s.speed=0;return {actor:p.actor,boat:B.boatId,goal,id};},
    step(rt,ex,dt) {
      const issue=sailingBodies(rt)??(!boat(rt).boat!.pilotIds.includes(ex.actor)?diag('pilot-not-authorized','pilot capability is no longer present'):null);
      if(issue){if(boat(rt)?.boat)boat(rt).boat!.speed=0;return {status:'blocked',diagnostic:issue};}
      const v=boat(rt),d=dist(v.pose.p,ex.goal);
      if(d<1e-10){stopSailing(rt);return {status:'completed'};}
      const fraction=Math.min(1,B.travelSpeed*dt/d),next=v.pose.p.map((x,i)=>x+(ex.goal[i]-x)*fraction) as V3;
      if(!g.clearance(v.pose.p,next)){v.boat!.speed=0;return {status:'blocked',diagnostic:diag('draft-clearance','boat stopped before insufficient water depth')};}
      const hit=routeHit(rt,v.pose.p,next);if(hit){v.boat!.speed=0;return {status:'blocked',diagnostic:hit};}
      v.boat!.speed=dist(v.pose.p,next)/dt;v.pose.p=next;
      for(const [slot,actor] of Object.entries(v.boat!.passengers)) {
        const e=rt.world.entities[actor];e.pose.p=seatRoot(v,slot as 'seat0'|'seat1');e.pose.yaw=seats[slot as 'seat0'|'seat1'].yaw;
      }
      return {status:'running',phase:'underway'};
    },
    cancel(rt){stopSailing(rt);return {ok:true};},
  };
  return [transfer(false),transfer(true),sail] as ActionDef[];
}

/** Return null for an ordinary shore root; otherwise certify its other support. */
function boatBodyContact(rt:Runtime,e:Entity):Diagnostic[]|null {
  const h=e.human;if(!h?.boatPassenger&&!h?.boatTransit)return null;
  const v=boat(rt),p=h.boatPassenger;
  if(!v?.boat||!p||p.boatId!==v.id||!Object.hasOwn(seats,p.slotId)||v.boat.passengers[p.slotId]!==e.id)
    return [diag('passenger-mismatch',`${e.id} and boat occupancy disagree`,[e.id])];
  const slot=p.slotId as 'seat0'|'seat1';
  if(!eq(p.localRoot,seats[slot].root)||p.relativeYaw!==seats[slot].yaw)return [diag('passenger-frame',`${e.id}'s seat frame differs`)];
  if(p.phase==='seated')return dist(e.pose.p,seatRoot(v,slot))<1e-8&&Math.abs(angleDelta(e.pose.yaw,seats[slot].yaw))<1e-8&&h.activity==='sit'?[]:[diag('passenger-frame',`${e.id} does not follow its admitted seat frame`)];
  const issue=docked(rt),t=h.boatTransit;
  if(issue)return [issue];
  if(!t||t.t<0||t.t>1||!h.task||!rt.isActive(h.task))return [diag('unsupported-transfer',`${e.id} has no active supported boarding path`)];
  const points=path(rt,slot,p.phase==='leaving');
  const valid=points.some((point,i)=>i>0&&eq(t.from,points[i-1].p)&&eq(t.to,point.p)&&t.supportId===point.support);
  const expected=t.from.map((x,i)=>x+(t.to[i]-x)*t.t) as V3;
  return valid&&dist(e.pose.p,expected)<1e-8?[]:[diag('unsupported-transfer',`${e.id} left its published supported connector path`)];
}
function boatInvariant(g:BoatGeometry):Invariant {
  return rt=>{
    const v=boat(rt),s=v?.boat;if(!s)return [diag('missing','the admitted boat is missing')];
    const out:Diagnostic[]=[];
    if(v.pose.yaw!==0||v.pose.p[1]!==B.keelY||!g.clearance(v.pose.p,v.pose.p))out.push(diag('unsupported-hull','boat no longer has its admitted water/draft/yaw'));
    if(s.speed<0||s.speed>B.travelSpeed+1e-8)out.push(diag('overspeed','boat exceeds admitted travel speed'));
    if(s.connectorOpen&&!eq(v.pose.p,DOCK))out.push(diag('moving-connector','connector remains deployed away from its exact dock'));
    if(s.connectorOpen){const issue=docked(rt);if(issue)out.push(issue);}
    const actors=Object.values(s.passengers);if(new Set(actors).size!==actors.length)out.push(diag('duplicate-passenger','a body occupies multiple boat slots'));
    for(const [slot,actor] of Object.entries(s.passengers))if(!Object.hasOwn(seats,slot)||rt.world.entities[actor]?.human?.boatPassenger?.slotId!==slot)out.push(diag('passenger-mismatch','boat has an invalid occupied slot'));
    return out;
  };
}

/** The legacy flat raster clearance is unsuitable for the sloping water bed
 * and moving hull. Check actual current 3D envelopes in this isolated fixture.
 * Only the exact published transfer can use the dock/hull as support. */
const boatClearanceInvariant:Invariant=rt=>{
  const out:Diagnostic[]=[];
  for(const e of Object.values(rt.world.entities)) {
    if(!e.human||e.human.boatPassenger?.phase==='seated')continue;
    const support=boatBodyContact(rt,e);
    const hit=shoreObstruction(rt,e.id,e.pose.p,e.pose.p,support&&support.length===0?supportIds:undefined);
    if(hit)out.push(hit);
  }
  const v=boat(rt);if(v?.boat){const hit=routeHit(rt,v.pose.p,v.pose.p);if(hit)out.push(hit);}
  return out;
};

function helmIssue(rt:Runtime,actor:string,take:boolean,ownAction?:string):Diagnostic|null {
  const v=boat(rt),s=v?.boat,e=rt.world.entities[actor],p=e?.human?.boatPassenger;
  const issue=freeBody(rt,actor);if(issue)return issue;
  if(!s||!p||p.boatId!==B.boatId||p.phase!=='seated'||boatBodyContact(rt,e)?.length!==0)
    return diag('not-passenger','Taking or releasing the helm requires an actual seated passenger.',[actor]);
  if(s.speed!==0||!['docked','stopped'].includes(s.phase))return diag('helm-underway','Stop the boat before changing its helm capability.',[B.boatId]);
  if(rt.holder('boat:'+B.boatId).some(id=>id!==ownAction)||rt.holder('actor:'+actor).some(id=>id!==ownAction))
    return diag('helm-busy','Wait until the current boat or body action finishes.',[B.boatId,actor]);
  if(take&&s.pilotIds.length)return diag('helm-held','A passenger already holds the helm capability.',[...s.pilotIds]);
  if(!take&&(s.pilotIds.length!==1||s.pilotIds[0]!==actor))return diag('helm-not-held','This passenger does not hold the helm capability.',[actor]);
  return null;
}
function helmActions():ActionDef[] {
  return [true,false].map((take):ActionDef<{actor:string},null,{actor:string;id:string}>=>({
    verb:take?'boat_take_helm':'boat_release_helm',description:take?'Voluntarily take the single helm capability while actually seated, free-handed, stopped and unheld. Sitting alone never grants it.':'Release only your own helm capability while actually seated, free-handed, stopped and unheld.',
    schema:z.object({actor:z.string().min(1).max(96)}).strict(),resumable:true,
    reservations:(_w,p)=>[{resource:'actor:'+p.actor,mode:'exclusive'},{resource:'boat:'+B.boatId,mode:'exclusive'},{resource:'boat-helm:'+B.boatId,mode:'exclusive'}],
    plan(rt,p){const issue=helmIssue(rt,p.actor,take);return issue?{ok:false,diagnostic:issue}:{ok:true,program:null};},
    start(_rt,p,_plan,id){return {actor:p.actor,id};},
    step(rt,ex){const issue=helmIssue(rt,ex.actor,take,ex.id);if(issue)return {status:'failed',diagnostic:issue};boat(rt).boat!.pilotIds=take?[ex.actor]:[];return {status:'completed',outputs:{helm:take?'acquired':'released',actor:ex.actor}};},
    // Effects occur only at the completed native step, never speculative start.
    cancel:()=>({ok:true}),
  })) as ActionDef[];
}
const helmInvariant:Invariant=rt=>{
  const s=boat(rt)?.boat;if(!s)return [diag('missing','The admitted boat is missing.')];
  if(s.pilotIds.length>1)return [diag('multiple-helms','Only one passenger may hold the helm capability.')];
  for(const actor of s.pilotIds){const e=rt.world.entities[actor];if(!e?.human||e.human.boatPassenger?.phase!=='seated'||boatBodyContact(rt,e)?.length!==0)return [diag('helm-without-passenger','The helm holder must occupy its actual seated body frame.',[actor])];}
  return [];
};
function helmControls(rt:Runtime,actor:string){
  const e=rt.world.entities[actor],v=boat(rt);if(!e?.human||!v?.boat||dist(e.pose.p,v.pose.p)>12)return null;
  const choice=(take:boolean)=>{const issue=helmIssue(rt,actor,take);return {available:!issue,reason:issue?{code:issue.code,message:issue.message}:null};};
  return {contract:'native-boat-controls/1' as const,actorId:actor,boatId:B.boatId,tick:rt.tick,physicalBase:{...rt.world.base},phase:v.boat.phase,
    holder:v.boat.pilotIds.length===1?v.boat.pilotIds[0]:null,take:choice(true),release:choice(false)};
}
  return {actions:boatActions,bodyContact:boatBodyContact,invariant:boatInvariant,clearanceInvariant:boatClearanceInvariant,helmActions,helmInvariant,helmControls,policy:B,layout};
}
const legacyControllers=controllersAt(BOAT_POLICY,BOAT_LAYOUT);
export const boatActions=legacyControllers.actions;
export const boatBodyContact=legacyControllers.bodyContact;
export const boatInvariant=legacyControllers.invariant;
export const boatClearanceInvariant=legacyControllers.clearanceInvariant;

/** Only a rigid translation of the admitted layout: no new shape, yaw, force,
 * passenger envelope, seat-derived pilot authority or hidden visual movement. */
export function translatedBoatControllers(raw:unknown){
  const n=z.number().finite().min(-1000).max(1000),t=z.object({x:n,y:n,z:n}).strict().parse(raw);
  const move=(p:V3):V3=>[p[0]+t.x,p[1]+t.y,p[2]+t.z];
  const layout=structuredClone(BOAT_LAYOUT);
  layout.boatDockPosition=move(layout.boatDockPosition);layout.bank=move(layout.bank);
  layout.dock.position=move(layout.dock.position);layout.dock.topY+=t.y;
  layout.ramp.from=move(layout.ramp.from);layout.ramp.to=move(layout.ramp.to);
  layout.deckEntry=move(layout.deckEntry);layout.connector.from=move(layout.connector.from);layout.connector.to=move(layout.connector.to);
  return controllersAt(Object.freeze({...BOAT_POLICY,keelY:BOAT_POLICY.keelY+t.y}),freeze(layout));
}
