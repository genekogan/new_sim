import {CLEAR,SWING,spot,type Flight,type FootState,type Gait} from './stair-gait.ts';
import {stairSoleFit} from './stair-sole.ts';

/** Actual measured shoe offsets from its ankle, in world axes after bearing
 * calibration. These retain every vertex; they do not bound skinned deformation. */
export type ShoeOffset={x:number;y:number;z:number};
type Endpoint={s:number;y:number};
const smooth=(t:number)=>t*t*(3-2*t);

/** Distance-timed rise/translate/land, including a stationary horizontal span.
 * A zero-length stage consumes no time and is never divided by. */
export function stairSwingAt(a:Endpoint,b:Endpoint,apex:number,t:number){
 const distances:[number,number,number]=[Math.max(0,apex-a.y),Math.abs(b.s-a.s),Math.max(0,apex-b.y)],total=distances.reduce((sum,d)=>sum+d,0);
 const durations=(total?distances.map(d=>d/total):[0,0,0]) as [number,number,number];
 const [up,across,down]=durations;
 if(t<=0)return {...a,durations};
 if(t>=1||!total)return {...b,durations};
 if(up>0&&t<up)return {s:a.s,y:a.y+(apex-a.y)*smooth(t/up),durations};
 if(across>0&&t<up+across)return {s:a.s+(b.s-a.s)*smooth((t-up)/across),y:apex,durations};
 return {s:b.s,y:down>0?apex+(b.y-apex)*smooth((t-up-across)/down):b.y,durations};
}

/** The part of an actual horizontal triangle crossed at a fixed lateral value.
 * No box or replacement support surface is generated. */
function triangleSpan(t:number[][],lat:number):[number,number]|null{
 const hits:number[]=[];
 for(let i=0;i<3;i++){
  const a=t[i],b=t[(i+1)%3];
  if(Math.abs(a[2]-lat)<1e-8)hits.push(a[0]);
  if((a[2]<lat&&b[2]>lat)||(a[2]>lat&&b[2]<lat))hits.push(a[0]+(b[0]-a[0])*(lat-a[2])/(b[2]-a[2]));
 }
 return hits.length?[Math.min(...hits),Math.max(...hits)]:null;
}

/** Mesh-only ankle trajectory. A spot has one geometry-corrected endpoint used
 * by both stance and swing. During swing the entire measured shoe rises clear
 * at that endpoint, translates above every actual crossed support, then lands.
 * Each stage has zero endpoint velocity; durations follow physical distance.
 * Evaluating decreasing u reverses this same path for descent, without state. */
export function stairShoeTrajectory(f:Flight,g:Gait,foot:FootState,point:readonly number[],offsets:readonly ShoeOffset[]):{point:[number,number];y:number;apex:number;durations:[number,number,number]}|null{
 if(!f.supports||!f.contactTops||!offsets.length)return null;
 const px=point[0]-f.o[0],pz=point[1]-f.o[1],along=px*f.dir[0]+pz*f.dir[1]-foot.s,lat=-px*f.dir[1]+pz*f.dir[0];
 const shape=offsets.map(p=>({s:p.x*f.dir[0]+p.z*f.dir[1],lat:-p.x*f.dir[1]+p.z*f.dir[0],y:p.y}));
 const ankleHeight=.003-Math.min(...shape.map(p=>p.y));
 const endpoint=(k:number):Endpoint=>{
  const q=spot(f,k),s=q.s+along,y=q.y+ankleHeight;
  const vertices=offsets.map(p=>({x:f.o[0]+f.dir[0]*s-f.dir[1]*lat+p.x,y:y+p.y,z:f.o[1]+f.dir[1]*s+f.dir[0]*lat+p.z}));
  const fit=stairSoleFit(f,{...q,planted:true,k,top:q.y},vertices);
  return {s:s+fit.along,y:y+fit.lift};
 };
 const b=endpoint(foot.k),a=foot.planted?b:endpoint(foot.k-2);
 let apex=Math.max(a.y,b.y)+CLEAR;
 if(!foot.planted)for(const p of shape)for(const top of f.contactTops){
  const span=triangleSpan(top,lat+p.lat);
  if(span&&Math.max(a.s,b.s)+p.s>=span[0]-1e-7&&Math.min(a.s,b.s)+p.s<=span[1]+1e-7)apex=Math.max(apex,Math.max(...top.map(v=>v[1]))+CLEAR-p.y);
 }
 const t=foot.planted?1:Math.max(0,Math.min(1,(g.u-(foot.k-2+.5))/SWING)),{s,y,durations}=stairSwingAt(a,b,apex,t);
 return {point:[f.o[0]+f.dir[0]*s-f.dir[1]*lat,f.o[1]+f.dir[1]*s+f.dir[0]*lat],y,apex,durations};
}
