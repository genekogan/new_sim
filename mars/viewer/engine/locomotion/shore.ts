// Explicit calm-water fixture controller. No default registry or flat navigation
// admission changes. A caller supplies a version-bound, detached triangle bed.
import { z } from 'zod';
import type { ActionDef, Diagnostic } from '../actions/types.ts';
import type { Runtime, Invariant } from '../runtime/runtime.ts';
import type { Entity } from '../world/types.ts';
import { entityFootprint } from '../spatial/service.ts';
import { HUMAN_RADIUS } from '../world/catalog.ts';
import { SPEED_CAPS } from '../runtime/invariants.ts';
import { rot2, sub2, heading, angleDelta, wrapAngle, hypot } from '../core/math.ts';

type V2 = [number, number];
type V3 = [number, number, number];
export type ShoreGeometry = {
  terrainId: string; waterId: string; datumY: number;
  point(at: V2): { point: V3; normal: V3; depth: number } | null;
  sweep(from: V2, to: V2, radius: number, grade: number): {
    ok: boolean; reason?: string; spans: { from: V3; to: V3 }[];
  };
};
// An upright capsule and prescribed buoyancy, not hydrostatic or stroke physics.
export const SHORE_POLICY = Object.freeze({
  radius: HUMAN_RADIUS, height: 1.8, floatingRootBelowDatum: 1.2,
  maxGrade: .35, travelSpeed: .9, turnRate: 4,
} as const);
type Params = { actor: string; x: number; z: number };
type Exec = { actor: string; id: string; points: V3[]; index: number; until?: number };
const fail = (code: string, message: string, subjects?: string[]): Diagnostic => ({ code: `shore.${code}`, message, subjects });
const distance = (a: V3, b: V3) => hypot(a[0]-b[0], a[1]-b[1], a[2]-b[2]);
const coord = z.number().min(-10000).max(10000);

function anatomy(rt: Runtime, actor: string): Diagnostic | null {
  const e = rt.world.entities[actor];
  if (!e?.human || e.kind !== 'human') return fail('actor', `${actor} is not a human`, [actor]);
  if (e.body && e.body.family !== 'humanoid') return fail('body-family', `${actor} has no qualified shore equivalent`, [actor]);
  if (e.human.grip || e.human.riding || e.human.on || e.human.boatPassenger || e.human.boatTransit || e.human.sleepPose || e.human.hands?.left || e.human.hands?.right
    || Object.values(rt.world.entities).some(item => item.support?.kind === 'in-hand' && item.support.by === actor))
    return fail('occupied-body', `${actor} must release hands, load, seat or vehicle before shore travel`, [actor]);
  if (e.human.activity.startsWith('sit') || e.human.activity.startsWith('stand-up'))
    return fail('occupied-body', `${actor} must stand on the shore before travelling`, [actor]);
  return null;
}

function root(g: ShoreGeometry, bed: V3): V3 {
  const p = g.point([bed[0], bed[2]])!;
  return [bed[0], p.depth > SHORE_POLICY.floatingRootBelowDatum ? g.datumY-SHORE_POLICY.floatingRootBelowDatum : bed[1], bed[2]];
}

// Conservative segment against a radius-expanded OBB. Vertical spans use the
// whole segment; this may refuse a safe route but never tunnels through a box.
function boxHit(a: V3, b: V3, e: Entity): boolean {
  const box = entityFootprint(e), h = SHORE_POLICY.height, r = SHORE_POLICY.radius;
  if (Math.max(a[1], b[1])+h <= box.y0 || Math.min(a[1], b[1]) >= box.y1) return false;
  const p = rot2(sub2([a[0],a[2]], box.obb.c), -box.obb.yaw);
  const q = rot2(sub2([b[0],b[2]], box.obb.c), -box.obb.yaw);
  let lo = 0, hi = 1;
  for (const axis of [0,1]) {
    const extent = box.obb.half[axis]+r, delta = q[axis]-p[axis];
    if (Math.abs(delta) < 1e-12) { if (Math.abs(p[axis]) >= extent) return false; continue; }
    const t0 = (-extent-p[axis])/delta, t1 = (extent-p[axis])/delta;
    lo = Math.max(lo, Math.min(t0,t1)); hi = Math.min(hi, Math.max(t0,t1));
    if (lo > hi) return false;
  }
  return true;
}
function obstruction(rt: Runtime, actor: string, a: V3, b: V3, supportedIds: ReadonlySet<string> = new Set()): Diagnostic | null {
  for (const e of Object.values(rt.world.entities)) {
    if (e.id === actor || e.kind === 'marker' || supportedIds.has(e.id)) continue;
    if (e.human) {
      const dx=b[0]-a[0], dz=b[2]-a[2], n=dx*dx+dz*dz;
      const t=n===0?0:Math.max(0,Math.min(1,((e.pose.p[0]-a[0])*dx+(e.pose.p[2]-a[2])*dz)/n));
      const radius=e.body?.family==='floater'?(e.body.radius??.28):SHORE_POLICY.radius;
      if (Math.max(a[1],b[1])+SHORE_POLICY.height<=e.pose.p[1] || Math.min(a[1],b[1])>=e.pose.p[1]+SHORE_POLICY.height) continue;
      if (hypot(a[0]+dx*t-e.pose.p[0],a[2]+dz*t-e.pose.p[2]) < SHORE_POLICY.radius+radius+.02)
        return fail('occupied-route', `${actor} must wait for ${e.id}`, [actor,e.id]);
    } else {
      try { if (boxHit(a,b,e)) return fail('occupied-route', `${actor}'s swept capsule meets ${e.id}`, [actor,e.id]); }
      catch { return fail('unknown-envelope', `${e.id} has no qualified collision envelope`, [actor,e.id]); }
    }
  }
  return null;
}
function current(rt: Runtime, g: ShoreGeometry, actor: string): Diagnostic | null {
  const e=rt.world.entities[actor], p=g.point([e.pose.p[0],e.pose.p[2]]);
  if (!p) return fail('outside-terrain', `${actor} is outside the installed bed`, [actor]);
  if (distance(e.pose.p, root(g,p.point)) > .001) return fail('unsupported-root', `${actor} is not at its qualified terrain/buoyant root`, [actor]);
  const at=g.sweep([e.pose.p[0],e.pose.p[2]],[e.pose.p[0],e.pose.p[2]],SHORE_POLICY.radius,SHORE_POLICY.maxGrade);
  if (!at.ok) return fail(at.reason??'terrain', `${actor}'s entire body disc is unsupported`, [actor]);
  return null;
}
function publish(rt: Runtime, g: ShoreGeometry, actor: string, moving: boolean, speed=0) {
  const e=rt.world.entities[actor], h=e.human!, at=g.point([e.pose.p[0],e.pose.p[2]])!;
  const floating=at.depth>=SHORE_POLICY.floatingRootBelowDatum;
  h.activity=floating?(moving?'swim':'tread'):(moving?(at.depth>0?'wade':'walk'):'idle');
  h.speed=speed;
  h.shore={contract:'shore-contact/1',terrainId:g.terrainId,waterId:g.waterId,
    mode:floating?'buoyant':'bed',bedY:at.point[1],datumY:g.datumY,depthMetres:at.depth,
    submergedHeightMetres:Math.max(0,Math.min(e.pose.p[1]+SHORE_POLICY.height,g.datumY)-Math.max(e.pose.p[1],at.point[1])),
    normal:at.normal};
}
function stop(rt: Runtime, g: ShoreGeometry, ex: Exec) {
  publish(rt,g,ex.actor,false);
  // Cancel cleanup resets a task-owned actor to idle. Release our task first so
  // the certified stationary buoyancy/tread state survives that common cleanup.
  delete rt.world.entities[ex.actor].human!.task;
}

export function shoreActions(g: ShoreGeometry): ActionDef[] {
  const travel: ActionDef<Params, V3[], Exec> = {
    verb:'shore_travel', description:'Bounded direct slope/wade/swim travel on an installed calm-water bed; refuses unqualified anatomy, loads, outside terrain and obstructed paths.',
    schema:z.object({actor:z.string().min(1),x:coord,z:coord}).strict(), resumable:true,
    reservations:(_w,p)=>[{resource:`actor:${p.actor}`,mode:'exclusive'}],
    plan(rt,p) {
      const issue=anatomy(rt,p.actor); if(issue)return {ok:false,diagnostic:issue};
      const unsupported=current(rt,g,p.actor);if(unsupported)return {ok:false,diagnostic:unsupported};
      const e=rt.world.entities[p.actor];
      const route=g.sweep([e.pose.p[0],e.pose.p[2]],[p.x,p.z],SHORE_POLICY.radius,SHORE_POLICY.maxGrade);
      if(!route.ok)return {ok:false,diagnostic:fail(route.reason??'terrain', `${p.actor}'s full swept disc has no qualified route`,[p.actor])};
      const points:V3[]=[[...e.pose.p]];
      for(const span of route.spans) {
        // Split the bed/floating contact boundary, keeping a continuous root
        // path instead of snapping upward when the activity label changes.
        const y=g.datumY-SHORE_POLICY.floatingRootBelowDatum;
        if((span.from[1]-y)*(span.to[1]-y)<0) {
          const t=(y-span.from[1])/(span.to[1]-span.from[1]);
          points.push(root(g,[span.from[0]+(span.to[0]-span.from[0])*t,y,span.from[2]+(span.to[2]-span.from[2])*t]));
        }
        points.push(root(g,span.to));
      }
      if(points.length===1)points.push([...e.pose.p]);
      for(let i=1;i<points.length;i++){const hit=obstruction(rt,p.actor,points[i-1],points[i]);if(hit)return {ok:false,diagnostic:hit};}
      return {ok:true,program:points};
    },
    start(rt,p,points,id){rt.world.entities[p.actor].human!.task=id;publish(rt,g,p.actor,false);return {actor:p.actor,id,points,index:1};},
    step(rt,ex,dt) {
      const issue=anatomy(rt,ex.actor)??current(rt,g,ex.actor);
      if(issue){publish(rt,g,ex.actor,false);return {status:'blocked',diagnostic:issue};}
      const e=rt.world.entities[ex.actor];
      while(ex.index<ex.points.length&&distance(e.pose.p,ex.points[ex.index])<1e-10)ex.index++;
      if(ex.index===ex.points.length){stop(rt,g,ex);return {status:'completed',outputs:{position:[...e.pose.p],mode:e.human!.shore!.mode}};}
      const target=ex.points[ex.index], d=distance(e.pose.p,target), desired=heading([target[0]-e.pose.p[0],target[2]-e.pose.p[2]]);
      const turn=angleDelta(e.pose.yaw,desired);
      e.pose.yaw=wrapAngle(e.pose.yaw+Math.max(-SHORE_POLICY.turnRate*dt,Math.min(SHORE_POLICY.turnRate*dt,turn)));
      if(Math.abs(turn)>.35){publish(rt,g,ex.actor,false);return {status:'running',phase:'turning'};}
      const t=Math.min(1,SHORE_POLICY.travelSpeed*dt/d);
      const next=e.pose.p.map((v,i)=>v+(target[i]-v)*t) as V3;
      const hit=obstruction(rt,ex.actor,e.pose.p,next);
      if(hit){publish(rt,g,ex.actor,false);return {status:'blocked',diagnostic:hit};}
      // Recheck the actual per-tick swept disc as well as the planned route.
      const sweep=g.sweep([e.pose.p[0],e.pose.p[2]],[next[0],next[2]],SHORE_POLICY.radius,SHORE_POLICY.maxGrade);
      if(!sweep.ok){publish(rt,g,ex.actor,false);return {status:'blocked',diagnostic:fail(sweep.reason??'terrain','shore contact changed',[ex.actor])};}
      const speed=hypot(next[0]-e.pose.p[0],next[2]-e.pose.p[2])/dt;
      e.pose.p=next;publish(rt,g,ex.actor,true,speed);
      return {status:'running',phase:e.human!.activity};
    },
    cancel(rt,ex){stop(rt,g,ex);return {ok:true};},
  };
  const tread:ActionDef<{actor:string;ticks:number},null,Exec>={
    verb:'shore_tread',description:'Hold a qualified deep-water root for a bounded number of ticks; cancellation retains safe stationary buoyancy.',
    schema:z.object({actor:z.string().min(1),ticks:z.number().int().min(1).max(72000)}).strict(),resumable:true,
    reservations:(_w,p)=>[{resource:`actor:${p.actor}`,mode:'exclusive'}],
    plan(rt,p){const issue=anatomy(rt,p.actor)??current(rt,g,p.actor);if(issue)return {ok:false,diagnostic:issue};
      const e=rt.world.entities[p.actor],at=g.point([e.pose.p[0],e.pose.p[2]])!;
      if(at.depth<SHORE_POLICY.floatingRootBelowDatum)return {ok:false,diagnostic:fail('not-deep-water',`${p.actor} is not at a swimming depth`,[p.actor])};
      const hit=obstruction(rt,p.actor,e.pose.p,e.pose.p);if(hit)return {ok:false,diagnostic:hit};return {ok:true,program:null};},
    start(rt,p,_program,id){rt.world.entities[p.actor].human!.task=id;publish(rt,g,p.actor,false);return {actor:p.actor,id,points:[],index:0,until:rt.tick+p.ticks};},
    step(rt,ex){const issue=anatomy(rt,ex.actor)??current(rt,g,ex.actor);if(issue)return {status:'blocked',diagnostic:issue};
      publish(rt,g,ex.actor,false);if(rt.tick>=ex.until!){stop(rt,g,ex);return {status:'completed'};}return {status:'running',phase:'tread'};},
    cancel(rt,ex){stop(rt,g,ex);return {ok:true};},
  };
  return [travel,tread] as ActionDef[];
}

/** Installed only with the shore registry. Existing default caps remain exact. */
export const shoreSpeedInvariant:Invariant=rt=>Object.values(rt.world.entities).flatMap(e=>{
  const h=e.human;if(h?.speed===undefined)return [];
  const cap=['swim','wade'].includes(h.activity)?SHORE_POLICY.travelSpeed:h.activity==='tread'?0:SPEED_CAPS[h.activity];
  return cap!==undefined&&Number.isFinite(h.speed)&&h.speed>=0&&h.speed<=cap*1.05?[]:[fail('overspeed',`${e.id} exceeds its qualified shore speed`,[e.id])];
});
export function shoreContactInvariant(g:ShoreGeometry, otherSupport?: (rt:Runtime,e:Entity)=>Diagnostic[]|null):Invariant {
  return rt=>Object.values(rt.world.entities).flatMap(e=>{
    if(!e.human||e.human.carrier)return [];   // carrier/1: a carried body's support is its carrier (vehicles/carrier.ts)
    const delegated=otherSupport?.(rt,e);if(delegated!==undefined&&delegated!==null)return delegated;
    const issue=current(rt,g,e.id);if(issue)return [issue];
    const at=g.point([e.pose.p[0],e.pose.p[2]])!;
    if(at.depth>=SHORE_POLICY.floatingRootBelowDatum&&!['tread','swim'].includes(e.human.activity))
      return [fail('lost-buoyancy-state',`${e.id} lost its water activity`,[e.id])];
    if(e.human.shore) {
      const s=e.human.shore;
      if(s.terrainId!==g.terrainId||s.waterId!==g.waterId||Math.abs(s.depthMetres-at.depth)>1e-9||s.datumY!==g.datumY)
        return [fail('stale-contact',`${e.id} has a stale recorded shore contact`,[e.id])];
    }
    return [];
  });
}
export { publish as publishShoreContact, obstruction as shoreObstruction };
