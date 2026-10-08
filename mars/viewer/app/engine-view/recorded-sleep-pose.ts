import type {Take,ChangeEvent} from '../../engine/take/types.ts';
import type {SleepPose} from '../../engine/activities/sleep.ts';
type Knot={tick:number;pose:SleepPose|null};
const indexes=new WeakMap<ChangeEvent[],Map<string,Knot[]>>();
const valid=(pose:SleepPose|null|undefined):pose is SleepPose=>!!pose&&typeof pose.mat==='string'&&Number.isFinite(pose.standingFraction)&&pose.standingFraction>=0&&pose.standingFraction<=1;
/** Visual interpolation only between adjacent recorded sleep ticks on one mat.
 * The native sampled state, activity, root and timing remain untouched. Gaps,
 * clears and changed mats retain the native pose rather than predict motion. */
export function recordedSleepPose(take:Take,id:string,tick:number,current:SleepPose):SleepPose{
 const fallback={...current};if(!valid(current)||!Number.isFinite(tick))return fallback;
 let index=indexes.get(take.changes);
 if(!index){index=new Map();for(const [at,actor,field,value] of take.changes){if(field!=='sleepPose')continue;const knots=index.get(actor)??[];knots.push({tick:at,pose:valid(value as SleepPose)?{...(value as SleepPose)}:null});index.set(actor,knots);}indexes.set(take.changes,index);}
 const knots=index.get(id);if(!knots?.length)return fallback;
 let lo=-1,hi=knots.length;while(hi-lo>1){const mid=(lo+hi)>>1;if(knots[mid].tick<=tick)lo=mid;else hi=mid;}
 const a=knots[lo],b=knots[hi];if(!a||!b||!a.pose||!b.pose||a.pose.mat!==current.mat||b.pose.mat!==current.mat||a.pose.standingFraction!==current.standingFraction||b.tick-a.tick!==1)return fallback;
 const u=Math.max(0,Math.min(1,tick-a.tick));return{...current,standingFraction:a.pose.standingFraction+(b.pose.standingFraction-a.pose.standingFraction)*u};
}
