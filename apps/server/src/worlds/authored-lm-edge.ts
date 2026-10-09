// Prospective, data-bound public aliases; no physical region or role mutation.
import type {WorldHost} from '../world.ts';import type {EdgeSoul,EdgeCapability} from '../edge/contract.ts';
import {validatePlaceData,type PlaceData,inPoly} from '../edge/ledger/places.ts';import {loadSpots} from '../edge/ledger/activities.ts';import type {WorldPlans} from './mars-edge.ts';
type V2=[number,number];type Alias={place:string;nativeRegion:string};
const finitePt=(v:unknown):v is V2=>Array.isArray(v)&&v.length===2&&v.every(Number.isFinite);
const keys=(v:Record<string,unknown>,allowed:string[])=>Object.keys(v).every(k=>allowed.includes(k));
const contains=(poly:V2[],p:V2)=>inPoly(p[0],p[1],poly)||poly.some((a,i)=>{const b=poly[(i+1)%poly.length],dx=b[0]-a[0],dz=b[1]-a[1];return Math.abs(dx*(p[1]-a[1])-dz*(p[0]-a[0]))<1e-7&&p[0]>=Math.min(a[0],b[0])-1e-7&&p[0]<=Math.max(a[0],b[0])+1e-7&&p[1]>=Math.min(a[1],b[1])-1e-7&&p[1]<=Math.max(a[1],b[1])+1e-7;});
function convex(poly:V2[]){let sign=0;for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],c=poly[(i+2)%poly.length],cross=(b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]);if(Math.abs(cross)<1e-9)continue;const next=Math.sign(cross);if(sign&&sign!==next)return false;sign=next;}return !!sign;}
function simple(poly:V2[]){
 const cross=(a:V2,b:V2,c:V2)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
 for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length];if(a[0]===b[0]&&a[1]===b[1])return false;for(let j=i+2;j<poly.length;j++){if(i===0&&j===poly.length-1)continue;const c=poly[j],d=poly[(j+1)%poly.length];if(Math.max(Math.min(a[0],b[0]),Math.min(c[0],d[0]))>Math.min(Math.max(a[0],b[0]),Math.max(c[0],d[0]))||Math.max(Math.min(a[1],b[1]),Math.min(c[1],d[1]))>Math.min(Math.max(a[1],b[1]),Math.max(c[1],d[1])))continue;if(cross(a,b,c)*cross(a,b,d)<=0&&cross(c,d,a)*cross(c,d,b)<=0)return false;}}
 return true;
}
export function validateAuthoredLmSidecars(host:WorldHost,raw:{placeData:unknown;activityData:unknown;nativeAliases:unknown}){
 const fail=(why:string):never=>{throw Error('authored-lm.invalid: '+why);},places=raw.placeData as PlaceData;
 if(places?.world!=='littlemartians'||validatePlaceData(places,host.engine.world as Parameters<typeof validatePlaceData>[1]).length)fail('place data');
 const byId=new Map(places.places.map(p=>[p.id,p]));
 for(const p of places.places){
  if(!keys(p as unknown as Record<string,unknown>,['id','name','kind','parent','polygon','level','enclosed','capacity','starting','description'])||!convex(p.polygon)||!simple(p.polygon))fail('bounded convex place geometry only');
  const parent=p.parent?byId.get(p.parent):undefined;if(parent&&p.polygon.some(v=>!contains(parent.polygon,v)))fail('place outside parent');
 }
 const root=places.places.find(p=>p.parent===null)!,activities=raw.activityData as any;
 if(activities?.world!=='littlemartians'||!keys(activities,['contract','world','spots','shelves','solids','interiors','rings']))fail('activity data');
 if(loadSpots(activities).refused.length)fail('refused activity geometry');
 for(const s of [...(activities.spots??[]),...(activities.shelves??[])]){const poly=s.place?byId.get(s.place)?.polygon:root.polygon;if(!poly||!finitePt(s.at)||!contains(poly,s.at)||(s.faceTo&&!finitePt(s.faceTo)))fail('spot outside place');}
 for(const s of activities.solids??[]){if(!finitePt(s.half)||s.half.some((x:number)=>x<=0)||!Number.isFinite(s.height)||s.height<=0)fail('solid bounds');for(const x of [-s.half[0],s.half[0]])for(const z of [-s.half[1],s.half[1]])if(!contains(root.polygon,[s.c[0]+x*Math.cos(s.yaw)-z*Math.sin(s.yaw),s.c[1]+x*Math.sin(s.yaw)+z*Math.cos(s.yaw)]))fail('solid outside root');}
 for(const g of activities.rings??[])for(const x of [-g.r,g.r])for(const z of [-g.r,g.r])if(!contains(root.polygon,[g.c[0]+x,g.c[1]+z]))fail('ring outside root');
 for(const i of activities.interiors??[]){const place=byId.get(i.place);if(!place||!Number.isFinite(i.wall)||i.wall<=0||(i.furniture??[]).length)fail('interior');for(const d of i.doors)if(!contains(place!.polygon,[d[0],d[1]])||!contains(place!.polygon,[d[2],d[3]]))fail('door outside place');}
 const aliases=raw.nativeAliases as any;
 if(aliases?.schema!=='native-place-aliases/1'||!keys(aliases,['schema','aliases'])||!Array.isArray(aliases.aliases))fail('alias schema');
 const seen=new Set<string>(),targets=new Set<string>();for(const a of aliases.aliases){
  const place=byId.get(a?.place),region=host.engine.world.regions[a?.nativeRegion];
  if(!a||!keys(a,['place','nativeRegion'])||!place||!Object.hasOwn(host.engine.world.regions,a.nativeRegion)||!region||seen.has(a.place)||targets.has(a.nativeRegion)||place.id===root.id||place.level!==region.level||!Array.isArray(region.polygon)||!region.polygon.every(v=>finitePt(v))||!convex(region.polygon)||place.polygon.some(v=>!contains(region.polygon,v))||region.polygon.some(v=>!contains(place.polygon,v)))fail('unknown or mismatched native alias');
  seen.add(a.place);targets.add(a.nativeRegion);
 }
 return {places,activities,aliases:structuredClone(aliases.aliases) as Alias[]};
}
export function authoredLmAliasProfile(host:WorldHost,aliases:Alias[]){return Object.assign((soul:EdgeSoul,caps:EdgeCapability[],plans:WorldPlans)=>{
 for(const alias of aliases){
  for(let i=caps.length-1;i>=0;i--)if(caps[i].target?.kind==='place'&&(caps[i].target!.id===alias.nativeRegion||caps[i].id==='walk:'+alias.place)){plans.delete(caps[i].id);caps.splice(i,1);}
  const region=host.engine.world.regions[alias.nativeRegion],id='walk:'+alias.place,label=((host.engine.world.entities[soul.entityId] as {body?:{family?:string}}|undefined)?.body?.family==='floater'?'Glide':'Walk')+' to '+region.label,steps=[{verb:'walk_to',params:{to:alias.nativeRegion}}];
  const issue=host.engine.canPerform({actor:soul.entityId,label,steps});caps.push({id,verb:'walk',label,target:{id:alias.place,kind:'place'},available:!issue,...(issue?{blocked:{code:issue.code,reason:issue.message}}:{})});plans.set(id,{label,steps});
 }
},{nativePlaceAliases:structuredClone(aliases)});}
