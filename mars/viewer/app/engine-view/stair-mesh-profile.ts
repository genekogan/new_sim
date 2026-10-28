// Renderer-only, mesh-proven contacts. Never used by native navigation or poses.
import {hashOf} from '../../engine/core/hash.ts';
import type {Flight} from './stair-gait.ts';
export type Point3=[number,number,number];
export type Triangle=[Point3,Point3,Point3];
export type StairSupport={s:number;y:number;lo:number;hi:number;left:number;right:number};
export type MeshStairProfile={asset:string;representation:string;geometry:string;extent:Point3;fitAxis:number;origin:[number,number];dir:[number,number];width:number;bottom:number;top:number;treads:StairSupport[];contactTops:Triangle[];source:{mesh:string;footprint:string;footprintHash:string;link:string;bottomSupport:'native-lower-terrain'}};
const rounded=(n:number)=>Math.round(n*1000);
/** Geometry order, material buckets, node names and triangle winding do not own contact identity. */
export function stairGeometryDigest(triangles:readonly Triangle[]):string{
  return hashOf([...new Set(triangles.map(t=>t.map(p=>p.map(rounded).join(',')).sort().join(';')))].sort());
}
const area=(t:Triangle)=>Math.abs((t[1][0]-t[0][0])*(t[2][2]-t[0][2])-(t[1][2]-t[0][2])*(t[2][0]-t[0][0]))/2;
function inside(x:number,z:number,t:Triangle){
  const c=(a:Point3,b:Point3)=>(b[0]-a[0])*(z-a[2])-(b[2]-a[2])*(x-a[0]);const a=c(t[0],t[1]),b=c(t[1],t[2]),d=c(t[2],t[0]);
  return a>=-1e-7&&b>=-1e-7&&d>=-1e-7||a<=1e-7&&b<=1e-7&&d<=1e-7;
}
/** Extract only complete rectangular tread tops inside an already authored corridor.
 * Actual heights, depths and spacing are retained. A ramp, table or gap is not a flight. */
export function extractStairSupports(triangles:readonly Triangle[],a:Point3,b:Point3,width:number,bottomIsTerrain=false){
  const length=Math.hypot(b[0]-a[0],b[2]-a[2]);if(length<.3||b[1]<=a[1])throw Error('stair corridor must ascend');
  const dir:[number,number]=[(b[0]-a[0])/length,(b[2]-a[2])/length];
  const project=(p:Point3):Point3=>[(p[0]-a[0])*dir[0]+(p[2]-a[2])*dir[1],p[1],-(p[0]-a[0])*dir[1]+(p[2]-a[2])*dir[0]];
  const horizontal:Triangle[]=triangles.filter(t=>{
    const u=t[1].map((v,i)=>v-t[0][i]),v=t[2].map((v,i)=>v-t[0][i]);
    return u[2]*v[0]-u[0]*v[2]>1e-7&&Math.max(...t.map(p=>p[1]))-Math.min(...t.map(p=>p[1]))<.002;
  }).map(t=>t.map(project) as Triangle);
  const bands=new Map<number,Triangle[]>();
  for(const t of horizontal){
    const s=t.map(p=>p[0]),lat=t.map(p=>p[2]),y=Math.max(...t.map(p=>p[1]));
    if(y<a[1]+.05||y>b[1]+.02||Math.min(...s)<-.02||Math.max(...s)>length+.02||Math.max(...s)-Math.min(...s)>.6||Math.min(...lat)<-width/2-.1||Math.max(...lat)>width/2+.1)continue;
    const key=rounded(y),band=bands.get(key)??[];band.push(t);bands.set(key,band);
  }
  const treads:StairSupport[]=[];
  for(const ts of bands.values()){
    const points=ts.flat(),lo=Math.min(...points.map(p=>p[0])),hi=Math.max(...points.map(p=>p[0])),left=Math.min(...points.map(p=>p[2])),right=Math.max(...points.map(p=>p[2]));
    const sum=ts.reduce((n,t)=>n+area(t),0),rectangle=(hi-lo)*(right-left);
    if(hi-lo<.15||right-left<.7||Math.abs(sum-rectangle)>.0001)throw Error('tread is not a complete contact rectangle');
    // A full grid also rejects overlapping triangles concealing a hole.
    for(let s=lo+.002;s<hi;s+=.02)for(let z=left+.002;z<right;z+=.04)if(!ts.some(t=>inside(s,z,t)))throw Error('tread contains a support hole');
    treads.push({s:(lo+hi)/2,y:Math.max(...points.map(p=>p[1])),lo,hi,left,right});
  }
  treads.sort((m,n)=>m.s-n.s);
  if(treads.length<3)throw Error('fewer than three mesh-proven treads');
  let previous=a[1];
  for(let i=0;i<treads.length;i++){
    const t=treads[i],rise=t.y-previous;
    if(rise<.12||rise>.23||i&&Math.abs(t.lo-treads[i-1].hi)>.02)throw Error('disconnected or nonordinary stair support');
    previous=t.y;
  }
  if(Math.abs(previous-b[1])>.02)throw Error('top tread does not meet authored landing');
  const supportAt=(s:number,near:number)=>{
    const candidates=horizontal.filter(t=>Math.abs(t[0][1]-near)<.025&&[-.3,0,.3].every(z=>inside(s,z,t)||horizontal.some(q=>Math.abs(q[0][1]-t[0][1])<.002&&inside(s,z,q))));
    if(!candidates.length)throw Error('missing actual landing support');return Math.max(...candidates.map(t=>Math.max(...t.map(p=>p[1]))));
  };
  const contactTops=horizontal.filter(t=>Math.max(...t.map(p=>p[0]))>=-.8&&Math.min(...t.map(p=>p[0]))<=length+.8&&Math.max(...t.map(p=>p[2]))>=-width/2&&Math.min(...t.map(p=>p[2]))<=width/2&&Math.max(...t.map(p=>p[1]))>=a[1]-.01&&Math.max(...t.map(p=>p[1]))<=b[1]+.02);
  return {origin:[a[0],a[2]] as [number,number],dir,width:Math.min(width,...treads.map(t=>2*Math.min(-t.left,t.right))),bottom:bottomIsTerrain?a[1]:supportAt(treads[0].lo-.12,a[1]),top:supportAt(treads.at(-1)!.hi+.12,b[1]),treads,contactTops};
}

/** Upright uniform transform; no resampling or invented tread height. */
export function meshStairFlight(profile:MeshStairProfile,id:string,pose:{x:number;y:number;z:number;yaw:number;s:number}):Flight|null{
  if(!Number.isFinite(pose.s)||pose.s<=0)return null;
  const c=Math.cos(pose.yaw),sn=Math.sin(pose.yaw),scale=pose.s;
  return {id,o:[pose.x+scale*(profile.origin[0]*c+profile.origin[1]*sn),pose.z+scale*(-profile.origin[0]*sn+profile.origin[1]*c)],dir:[profile.dir[0]*c+profile.dir[1]*sn,-profile.dir[0]*sn+profile.dir[1]*c],width:profile.width*scale,yBottom:pose.y+profile.bottom*scale,yTop:pose.y+profile.top*scale,going:(profile.treads[1].s-profile.treads[0].s)*scale,treads:profile.treads.map(t=>({s:t.s*scale,y:pose.y+t.y*scale})),supports:profile.treads.map(t=>({...t,s:t.s*scale,y:pose.y+t.y*scale,lo:t.lo*scale,hi:t.hi*scale,left:t.left*scale,right:t.right*scale})),contactTops:profile.contactTops.map(t=>t.map(p=>[p[0]*scale,pose.y+p[1]*scale,p[2]*scale]) as Triangle)};
}
