// TRAVEL (M3, docs/sim/TRAVEL.md) on the world page. The owner's Soul card gets "Travel to…": pick another world of
// this site (or home), the server moves the Soul (POST /v1/souls/:id/travel; no token reaches the browser) and the
// card offers to follow it there. Everyone sees who is visiting: "Visiting from Alder" on a visitor's card, and a
// visitors line under "Meet its Souls" (GET /v1/world/visitors). Names come from the site's world list.
import {useEffect,useState} from 'react';
import type {Api} from './useSim.ts';
import {apiPath,worldKey} from './world-path.ts';
import {BASE} from './base-path.ts';
import './SoulTravel.css';

type LogEntry={at:number;kind:'travel'|'refused'|'recalled';from:string;fromName:string;to:string;toName:string;code?:string};
type Status={available:boolean;state:'present'|'departing'|'away';here:string;home:string;atHome:boolean;open:boolean;log:LogEntry[]};
type Visitors={available?:boolean;open:boolean;visitors:{soulId:string;name:string;home:string}[]};
type SiteWorld={slug:string;name:string};

let worldsOnce:Promise<SiteWorld[]>|null=null;
/** The site's worlds (the launcher's list); [] where there is none. */
export function siteWorlds():Promise<SiteWorld[]>{
 worldsOnce??=fetch(`${BASE}/__sim/worlds.json`,{cache:'no-store'}).then(r=>r.ok&&r.headers.get('content-type')?.includes('json')?r.json():null).then((d:{worlds?:{slug?:unknown;name?:unknown}[]}|null)=>(d?.worlds??[]).flatMap(w=>typeof w.slug==='string'&&typeof w.name==='string'?[{slug:w.slug,name:w.name}]:[])).catch(()=>{worldsOnce=null;return [];});
 return worldsOnce;
}
const nameOf=(worlds:SiteWorld[],slug:string)=>worlds.find(w=>w.slug===slug)?.name??slug;

/** This world's visitors: one poll for the whole page, shared by every card. A world without travel (no Godmode: the
 * original worlds, plain local worlds) answers available:false, or 404 on an older server; it is not asked again. */
const NO_TRAVEL:Visitors={available:false,open:false,visitors:[]};
const visitorSubs=new Set<(v:Visitors)=>void>();
let visitorsNow:Visitors|null=null,visitorsTimer:ReturnType<typeof setInterval>|undefined;
const stopVisitors=()=>{clearInterval(visitorsTimer);visitorsTimer=undefined;};
function readVisitors(){
 void fetch(apiPath('/v1/world/visitors'),{cache:'no-store'}).then(r=>r.status===404?NO_TRAVEL:r.ok?r.json():null).then((d:Visitors|null)=>{
  if(!d||!Array.isArray(d.visitors))return;visitorsNow=d;if(d.available===false)stopVisitors();for(const f of visitorSubs)f(d);}).catch(()=>{});
}
function useVisitors():Visitors|null{
 const [v,setV]=useState<Visitors|null>(visitorsNow);
 useEffect(()=>{visitorSubs.add(setV);if(visitorsNow)setV(visitorsNow);
  if(!visitorsTimer&&visitorsNow?.available!==false){readVisitors();visitorsTimer=setInterval(readVisitors,15_000);}
  return()=>{visitorSubs.delete(setV);if(!visitorSubs.size)stopVisitors();};},[]);
 return v;
}
function useWorlds(){const [w,setW]=useState<SiteWorld[]>([]);useEffect(()=>{let live=true;void siteWorlds().then(x=>{if(live)setW(x);});return()=>{live=false;};},[]);return w;}

/** "Visiting from Alder" for a Soul that came from another world (any viewer). */
export function VisitorFrom({soulId}:{soulId:string}){
 const v=useVisitors(),worlds=useWorlds(),me=v?.visitors.find(x=>x.soulId===soulId);
 return me?<span className="soul-visiting" data-visiting-from={me.home}>Visiting from {nameOf(worlds,me.home)}</span>:null;
}

/** The world's visitors in one line (under "Meet its Souls"): who is here from elsewhere, and whether it is closed. */
export function VisitorsLine(){
 const v=useVisitors(),worlds=useWorlds();
 if(!v||v.available===false||(v.open&&!v.visitors.length))return null;
 return <p className="soul-visitors" data-visitors={v.visitors.length} data-open={v.open?'1':'0'}>
  {v.visitors.length?<>Visiting now: {v.visitors.map((x,i)=><span key={x.soulId}>{i?', ':''}<b>{x.name}</b> from {nameOf(worlds,x.home)}</span>)}</>:null}
  {!v.open&&<span className="soul-dim">{v.visitors.length?' · ':''}Closed to new visitors</span>}
 </p>;
}

/** The owner's "Travel to…" on their Soul's card. Hidden where travel is not available (no site, no fading). */
export function SoulTravel({api,soulId,name}:{api:Api;soulId:string;name:string}){
 const [st,setSt]=useState<Status|null>(null);
 const worlds=useWorlds();
 const [open,setOpen]=useState(false),[to,setTo]=useState(''),[busy,setBusy]=useState(false);
 const [done,setDone]=useState<{toName:string;url:string}|null>(null),[err,setErr]=useState('');
 useEffect(()=>{let live=true;void api<Status>(`/v1/souls/${encodeURIComponent(soulId)}/travel`).then(r=>{if(live&&r.status===200)setSt(r.data);});return()=>{live=false;};},[api,soulId]);
 if(!st?.available||st.state!=='present')return null;
 const choices=[...(st.atHome?[]:[{slug:'home',name:`Home (${nameOf(worlds,st.home)})`}]),...worlds.filter(w=>w.slug!==worldKey&&(st.atHome||w.slug!==st.home))];
 if(!choices.length)return null;
 const last=st.log.filter(e=>e.kind!=='refused').at(-1);
 const go=async()=>{
  const dest=to||choices[0].slug;setBusy(true);setErr('');
  const r=await api<{ok?:boolean;toName?:string;url?:string;message?:string}>(`/v1/souls/${encodeURIComponent(soulId)}/travel`,{to:dest});
  setBusy(false);
  if(r.status===200&&r.data.ok&&r.data.url)setDone({toName:r.data.toName??dest,url:r.data.url});
  else setErr(r.data?.message??'Travel did not happen; try again.');
 };
 if(done)return <div className="soul-travel" data-travel-done="1" role="status"><span>{name} left for <b>{done.toName}</b>.</span> <a className="soul-travel-follow" href={done.url} data-travel-follow="1">Follow {name} to {done.toName} ›</a></div>;
 return <div className="soul-travel" data-soul-travel="1">
  {!open?<button className="soul-travel-open" data-travel-open="1" onClick={()=>{setOpen(true);setTo(choices[0].slug);}}>Travel to…</button>:
  <form className="soul-travel-form" onSubmit={e=>{e.preventDefault();if(!busy)void go();}}>
   <select data-travel-to="1" aria-label={`Travel ${name} to`} value={to} onChange={e=>setTo(e.target.value)}>{choices.map(w=><option key={w.slug} value={w.slug}>{w.name}</option>)}</select>
   <button type="submit" data-travel-go="1" disabled={busy}>{busy?'Travelling…':'Travel'}</button>
   <button type="button" className="soul-travel-cancel" onClick={()=>{setOpen(false);setErr('');}}>Cancel</button>
  </form>}
  {err&&<p className="soul-travel-err" role="alert">{err}</p>}
  {last&&!err&&<p className="soul-fine">Last trip: {last.fromName} → {last.toName}</p>}
 </div>;
}
