import type {Flight} from './stair-gait.ts';
import type {TakeFrame} from '../../engine/take/replay.ts';
export type SupplementalStair={entity:string;nativeDef:string;pose:{p:readonly number[];yaw:number};flight:Flight;geometry:string};
/** Current decorative metadata may only pose a body beside the same fixture in
 * the selected native frame. No current-model substitute for missing history. */
export function matchedStairFlights(contacts:readonly SupplementalStair[],frame:TakeFrame,records:Readonly<Record<string,{def:string}>>,firstRecords:Readonly<Record<string,{def:string}>>):Flight[]{
  return contacts.filter(c=>{
    const e=frame.entities[c.entity];
    return !!e&&records[c.entity]?.def===c.nativeDef&&firstRecords[c.entity]?.def===c.nativeDef&&e.p.every((v,i)=>Math.abs(v-c.pose.p[i])<=.005)&&Math.abs(Math.atan2(Math.sin(e.yaw-c.pose.yaw),Math.cos(e.yaw-c.pose.yaw)))<=.002&&!e.pitch&&!e.roll;
  }).map(c=>c.flight);
}
