import type {Flight} from './stair-gait.ts';
import type {TakeFrame} from '../../engine/take/replay.ts';
import type {Take} from '../../engine/take/types.ts';
export type SupplementalStair={entity:string;nativeDef:string;pose:{p:readonly number[];yaw:number};flight:Flight;geometry:string;observedSinceTick?:number};
/** A first observation proves nothing about earlier ticks. Only an uninterrupted
 * matching loaded representation can certify a later native take's lifetime. */
export class StairObservation{
  private seen=new Map<string,{key:string;since:number}>();
  private lastTick=-Infinity;
  clear(){this.seen.clear();this.lastTick=-Infinity;}
  observe(contacts:readonly SupplementalStair[],nativeTick:number|null):SupplementalStair[]{
    if(nativeTick===null||!Number.isFinite(nativeTick)||nativeTick<0){this.clear();return contacts.map(({observedSinceTick:_,...c})=>c);}
    if(nativeTick<this.lastTick)this.clear();
    this.lastTick=nativeTick;
    const next=new Map<string,{key:string;since:number}>();
    const result=contacts.map(c=>{
      const key=JSON.stringify([c.nativeDef,c.pose,c.geometry]),before=this.seen.get(c.entity);
      const entry={key,since:before?.key===key?before.since:nativeTick};next.set(c.entity,entry);
      return {...c,observedSinceTick:entry.since};
    });
    this.seen=next;return result;
  }
}
type StaticSelection={liveTakeId:string;take:Take};
const samePose=(p:readonly number[],yaw:number,pitch:number|undefined,roll:number|undefined,c:SupplementalStair)=>p.length===3&&p.every((v,i)=>Math.abs(v-c.pose.p[i])<=.005)&&Math.abs(Math.atan2(Math.sin(yaw-c.pose.yaw),Math.cos(yaw-c.pose.yaw)))<=.002&&!pitch&&!roll;
/** Current decorative metadata may only pose a body beside the same fixture in
 * the selected native frame. No current-model substitute for missing history. */
export function matchedStairFlights(contacts:readonly SupplementalStair[],frame:TakeFrame,records:Readonly<Record<string,{def:string}>>,firstRecords:Readonly<Record<string,{def:string}>>,selection?:StaticSelection):Flight[]{
  return contacts.filter(c=>{
    const e=frame.entities[c.entity];
    if(e)return records[c.entity]?.def===c.nativeDef&&firstRecords[c.entity]?.def===c.nativeDef&&samePose(e.p,e.yaw,e.pitch,e.roll,c);
    // The recorder deliberately excludes entity-world statics from tracks and
    // entities0. Final-state provenance is usable only for an explicitly live
    // selection observed unchanged before this entire take began.
    const since=c.observedSinceTick;
    if(!selection||selection.liveTakeId!==selection.take.id||since===undefined||!Number.isFinite(since)||since>selection.take.startTick)return false;
    const take=selection.take,r=take.finalState.entities[c.entity];
    return !take.tracks[c.entity]&&!take.entities0?.[c.entity]&&r?.kind==='fixture'&&!!r.tags?.includes('entity-world')&&r.def===c.nativeDef&&samePose(r.pose.p,r.pose.yaw,r.pose.pitch,r.pose.roll,c);
  }).map(c=>c.flight);
}
