import {platformFloorOffset,type PlatformFloor} from '../../lib/platform-floor.ts';
import type {TakeFrame} from '../../engine/take/replay.ts';
/** Private draw projection for the explicit CN5 nav/1 contract. Takes, records and native state stay immutable. */
export function projectPlatformFrame(frame:TakeFrame,records:Readonly<Record<string,{kind:string;human?:unknown}>>,platforms:readonly PlatformFloor[],baseY=0):TakeFrame{
 if(!platforms.length)return frame;let changed=false;const entities={...frame.entities};
 for(const [id,e] of Object.entries(frame.entities)){
  const record=records[id];if(record?.kind!=='human'||e.level&&e.level!==0||e.state.on||e.state.grip||e.state.riding||e.hands?.left||e.hands?.right||/boat|ride|drive|board|disembark/.test(e.activity??''))continue;
  const offset=platformFloorOffset(platforms,e.p[0],e.p[2],e.p[1],baseY);if(!offset)continue;
  const state={...e.state};if(typeof state.seatHeight==='number'&&Number.isFinite(state.seatHeight))state.seatHeight=Math.max(.02,state.seatHeight-offset);
  entities[id]={...e,p:[e.p[0],e.p[1]+offset,e.p[2]],state};changed=true;
 }
 return changed?{...frame,entities}:frame;
}
