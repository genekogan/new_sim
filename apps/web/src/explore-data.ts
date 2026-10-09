import type {PublicSoul} from '@sim/protocol';
export type ExplorePresence='active'|'fading'|'departed'|'unknown';
/** Public fade activity is authoritative; merely having a standing body does not imply an active agent. */
export function explorePresence(messages:readonly{kind?:string;souls?:unknown;soulId?:unknown;colour?:unknown;change?:unknown}[]):Map<string,ExplorePresence>{
 let map=new Map<string,ExplorePresence>();const phase=(c:unknown):ExplorePresence=>c==='green'?'active':c==='yellow'||c==='red'?'fading':c==='gone'?'departed':'unknown';
 for(const m of messages){if(m.kind==='fade.roster'&&Array.isArray(m.souls)){map=new Map();for(const r of m.souls){if(r&&typeof r==='object'&&typeof r.soulId==='string')map.set(r.soulId,phase(r.colour));}}else if(m.kind==='fade'&&typeof m.soulId==='string')map.set(m.soulId,m.change==='reclaimed'?'active':m.change==='removed'?'departed':phase(m.colour));}return map;
}
export function orderedExploreSouls(souls:ReadonlyMap<string,PublicSoul>,presence:ReadonlyMap<string,ExplorePresence>,query=''){
 const q=query.trim().toLocaleLowerCase(),rank=(id:string)=>({active:0,fading:1,unknown:2,departed:3}[presence.get(id)??'unknown']);return [...souls.values()].filter(s=>!q||`${s.name} ${s.description}`.toLocaleLowerCase().includes(q)).sort((a,b)=>rank(a.id)-rank(b.id)||a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
}
/** Camera-room context annotates a world search; an empty room never erases known Souls. */
export function exploreSoulRoster(souls:ReadonlyMap<string,PublicSoul>,presence:ReadonlyMap<string,ExplorePresence>,query='',room?:{soulIds:readonly string[]}|null){
 const inRoom=new Set((room?.soulIds??[]).filter(id=>souls.has(id)));return{souls:orderedExploreSouls(souls,presence,query),inRoom};
}
type Place={id:string;name:string;kind:string;polygon:readonly(readonly number[])[];level:number};
function contains(poly:Place['polygon'],x:number,z:number){let inside=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;}
export function exploreRoom(camera:readonly number[],places:readonly Place[],souls:ReadonlyMap<string,{entityId:string}>,entities:Readonly<Record<string,{p:readonly number[]}>>){
 const area=(p:Place)=>Math.abs(p.polygon.reduce((sum,a,i)=>{const b=p.polygon[(i+1)%p.polygon.length];return sum+a[0]*b[1]-b[0]*a[1];},0));
 const floor=(p:Place)=>p.level===0?0:p.id.startsWith('int-house-2')?2.6:p.level*3.1;
 const room=places.filter(p=>['room','bedroom','kitchen','studio','library','workshop','shop','chapel','clinic','bathhouse'].includes(p.kind)&&camera[1]>=floor(p)+.5&&camera[1]<=floor(p)+2.9&&contains(p.polygon,camera[0],camera[2])).sort((a,b)=>area(a)-area(b))[0];
 if(!room)return null;return{id:room.id,name:room.name,soulIds:[...souls].flatMap(([id,s])=>{const p=entities[s.entityId]?.p;return p&&Math.abs(p[1]-floor(room))<.6&&contains(room.polygon,p[0],p[2])?[id]:[];})};
}
