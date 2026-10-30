/** Prospective frisbee/clear-v1: no flight through a body or an upright solid.
 * Only active game steps call this. This cache is a per-tick memo, never canonical state. */
import type {Runtime} from '../runtime/runtime.ts';
import type {Diagnostic} from '../actions/types.ts';
import type {Spatial} from '../spatial/service.ts';
import {entityKeys,entityList,stableIndices} from '../world/entity-list.ts';
import {dcos,dsin,hypot} from '../core/math.ts';
import {bodyProfile} from '../bodies/navigation.ts';
export const FRISBEE_CLEAR_WINDUP=1.2;
// The depicted disc's hand points may be .43m off the body line, radius .13m.
// Another .15m catches walking entry before the following native tick.
const FLIGHT_MARGIN=.43+.13+.15;
const memo=new WeakMap<Runtime,{tick:number;groups:Map<string,Diagnostic|null>}>();
function segmentBox(a:number[],b:number[],half:number[],pad:number){let lo=0,hi=1;for(let k=0;k<2;k++){const d=b[k]-a[k],h=half[k]+pad;if(Math.abs(d)<1e-9){if(Math.abs(a[k])>h)return false;continue}let x=(-h-a[k])/d,y=(h-a[k])/d;if(x>y)[x,y]=[y,x];lo=Math.max(lo,x);hi=Math.min(hi,y);if(lo>hi)return false}return true}
export function frisbeeLaneIssue(rt:Runtime,group:string,actor:string):Diagnostic|null{
 let cache=memo.get(rt);if(!cache||cache.tick!==rt.tick){cache={tick:rt.tick,groups:new Map()};memo.set(rt,cache)}if(cache.groups.has(group))return cache.groups.get(group)!;
 const entities=rt.world.entities,list=entityList(rt.world),keys=entityKeys(rt.world),ids=stableIndices(entities,'frisbee lane bodies',list,keys,e=>e.kind==='human',idx=>idx.map(i=>keys[i])).derived;
 const people=ids.map(id=>entities[id]),players=people.filter(e=>e.id===actor||e.human?.together?.group===group).sort((a,b)=>a.id<b.id?-1:1);
 const bad=(reason:string,subjects:string[])=>({code:'pose.frisbee-lane-blocked',message:`Clear the throwing lane before playing frisbee: ${reason} Move aside and start again.`,subjects});let result:Diagnostic|null=null;
 const spatial=rt.services.spatial as Spatial|undefined;if(!spatial){result=bad('authoritative geometry is unavailable.',players.map(e=>e.id));cache.groups.set(group,result);return result}spatial.sync(rt.world);
 outer:for(let i=0;i<players.length;i++)for(let j=i+1;j<players.length;j++){
  const a=players[i],b=players[j],ax=a.pose.p[0],az=a.pose.p[2],dx=b.pose.p[0]-ax,dz=b.pose.p[2]-az,length=dx*dx+dz*dz;
  if((a.human?.level??0)!==(b.human?.level??0)||Math.abs(a.pose.p[1]-b.pose.p[1])>.2){result=bad('players need the same standing floor.',[a.id,b.id]);break outer}
  for(const e of people){if(e.id===a.id||e.id===b.id)continue;const profile=bodyProfile(e);if(e.pose.p[1]>a.pose.p[1]+1.55||e.pose.p[1]+profile.height<a.pose.p[1]+.9)continue;const t=length?Math.max(0,Math.min(1,((e.pose.p[0]-ax)*dx+(e.pose.p[2]-az)*dz)/length)):0;if(hypot(e.pose.p[0]-ax-t*dx,e.pose.p[2]-az-t*dz)<profile.radius+FLIGHT_MARGIN){result=bad('someone is in a planned throw path.',[a.id,b.id,e.id]);break outer}}
  const floor=a.pose.p[1];for(const o of spatial?.scene.obstacles??[]){if(o.y1<floor+.9||o.y0>floor+1.55)continue;const c=dcos(o.obb.yaw),s=dsin(o.obb.yaw),local=(x:number,z:number)=>[(x-o.obb.c[0])*c+(z-o.obb.c[1])*s,-(x-o.obb.c[0])*s+(z-o.obb.c[1])*c];if(segmentBox(local(ax,az),local(b.pose.p[0],b.pose.p[2]),o.obb.half,FLIGHT_MARGIN)){result=bad('an upright obstacle blocks a planned throw path.',[a.id,b.id,o.id]);break outer}}
 }
 cache.groups.set(group,result);return result;
}
