// Cosmetic transitions derived from immutable recorded activity/contact changes.
// No wall clock, controller changes or interpolation across recording gaps.
import type {Take} from '../../engine/take/types.ts';
import type {ShoreContactV1} from '../../../../packages/engine-contract/src/shore.ts';
import {sampleTake} from '../../engine/take/replay.ts';
import {shoreDepiction} from './recorded-shore.ts';
// Standing-to-water and water-to-standing retain the slower whole-body ease.
export const WATER_ENTRY_SECONDS=1.5;
// Already buoyant bodies can reorient before a short recorded tread phase ends.
export const WATER_MODE_SECONDS=.6;
export type RecordedWaterPose={activity:string;contact:ShoreContactV1};
export type WaterPoseOrigin={weight:number;pose:RecordedWaterPose|null};
export type WaterTransition={weight:number;from:RecordedWaterPose|null;origins:WaterPoseOrigin[]};
const smooth=(x:number)=>{const k=Math.max(0,Math.min(1,x));return k*k*(3-2*k);};
export function waterTransitions(take:Take,recorded:readonly Take[]=[]):(id:string,seconds:number)=>WaterTransition {
 const ids=Object.entries({...take.finalState.entities,...take.entities0}).filter(([,e])=>e.kind==='human').map(([id])=>id);
 const chain:Take[]=[take];let first=take;
 // Only unique, exact adjacent recorded checkpoints can supply preceding pose history.
 while((take.startTick-first.startTick)*take.dt<WATER_ENTRY_SECONDS){const matches=recorded.filter(p=>p!==first&&p.startTick+p.ticks===first.startTick&&p.ticks>0&&p.dt===first.dt&&p.rulesVersion===first.rulesVersion&&p.finalStateHash===first.baselineStateHash&&JSON.stringify(Reflect.get(p,'renderSceneRef'))===JSON.stringify(Reflect.get(first,'renderSceneRef')));if(matches.length!==1)break;first=matches[0];chain.unshift(first);}
 const times=chain.flatMap(part=>[...new Set([0,...part.changes.filter(c=>c[2]==='activity'||c[2]==='shore'||c[2]==='present').map(c=>c[0])])].sort((a,b)=>a-b).map(tick=>({part,tick})));
 const states=new Map<string,{since:number;duration:number;known:boolean;from:RecordedWaterPose|null;origins:WaterPoseOrigin[]}[]>(),last=new Map<string,{key:string;pose:RecordedWaterPose|null}>();
 for(const {part,tick} of times){const frame=sampleTake(part,tick*part.dt);for(const id of ids){const e=frame.entities[id],d=e?shoreDepiction(e):null;
  const pose=e&&d?.status==='recorded'&&(e.activity==='swim'||e.activity==='tread')?{activity:e.activity,contact:d.contact}:null;
  const key=pose?(pose.activity==='swim'&&pose.contact.mode==='buoyant'?'surface-swim':pose.activity):'dry',prior=last.get(id);
  let s=states.get(id);if(!s)states.set(id,s=[]);
  if(!prior||prior.key!==key){
   const since=(part.startTick-take.startTick+tick)*take.dt,previous=s.at(-1),progress=previous?.known?smooth((since-previous.since)/previous.duration):1;
   // Preserve the actual previous mixture if a new mode interrupts its blend.
   const origins:WaterPoseOrigin[]=previous?previous.origins.map(x=>({weight:x.weight*(1-progress),pose:x.pose})):[];
   origins.push({weight:progress,pose:prior?.pose?structuredClone(prior.pose):null});
   const duration=prior?.pose?.contact.mode==='buoyant'&&pose?.contact.mode==='buoyant'?WATER_MODE_SECONDS:WATER_ENTRY_SECONDS;
   s.push({since,duration,known:!!prior,from:prior?.pose?structuredClone(prior.pose):null,origins:origins.filter(x=>x.weight>0)});
  }
  last.set(id,{key,pose});
 }}
 return(id,seconds)=>{if(!Number.isFinite(seconds)||seconds<0||seconds>take.ticks*take.dt)return{weight:1,from:null,origins:[]};const s=states.get(id);if(!s)return{weight:1,from:null,origins:[]};let lo=0,hi=s.length;while(lo<hi){const mid=(lo+hi)>>>1;if(s[mid].since<=seconds)lo=mid+1;else hi=mid;}const current=s[lo-1];return !current||!current.known?{weight:1,from:null,origins:[]}:{weight:smooth((seconds-current.since)/current.duration),from:current.from?structuredClone(current.from):null,origins:structuredClone(current.origins)};};
}
