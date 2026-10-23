// Lane AWARE (2026-10-23): what changed since the owner (or the agent) last looked with `here`, computed at the edge from
// two `here` frames. Pure functions plus one small file (.eden-agent-lastlook.json) holding the last frame's summary.
import {readFileSync,existsSync} from 'node:fs';
import {writeAtomicJSON} from './client-json-file.mjs';
export const LAST_LOOK='.eden-agent-lastlook.json';
/** World minutes since the world's day 1 00:00, from `now` ("... · 03:33 · night · world day 19") or the clock. */
export function worldMinute(h){const n=/(\d\d):(\d\d) .*world day (\d+)/.exec(h?.now??'');if(n)return (Number(n[3])-1)*1440+Number(n[1])*60+Number(n[2]);return null;}
export function lookSummary(h){return {tick:h.tick??null,now:h.now??null,clock:h.clock??null,minute:worldMinute(h),place:h.me?.place??null,where:h.me?.placePath?.[0]??null,light:h.light??null,sky:h.weather?.sky??null,
 near:(h.near??[]).map(n=>({id:n.id,name:n.name,dist:n.dist,doing:n.doing})),talk:(h.conversations_in_earshot??[]).length,soul:h.me?.soulId??null};}
const ago=m=>m<1?'under a world minute':m<90?`${Math.round(m)} world min`:m<2880?`${Math.round(m/60)} world h`:`${Math.round(m/1440)} world days`;
/** The diff a person would say: who left, who came, what they are doing now, where you are, sky and light. */
export function sinceLastLook(prev,cur){
 if(!prev||prev.soul!==cur.soul)return {first:true,note:'First look from this folder; the next here says what changed since now.'};
 const changes=[],was=new Map(prev.near.map(n=>[n.id,n])),is=new Map(cur.near.map(n=>[n.id,n]));
 if(prev.place!==cur.place)changes.push(`you moved: ${prev.where??prev.place??'somewhere'} → ${cur.where??cur.place??'somewhere'}`);
 for(const [id,n] of was)if(!is.has(id))changes.push(`${n.name} left (was ${n.dist} m away, ${n.doing})`);
 for(const [id,n] of is){const o=was.get(id);if(!o)changes.push(`${n.name} arrived: ${n.dist} m away, ${n.doing}`);else if(o.doing!==n.doing)changes.push(`${n.name}: ${o.doing} → ${n.doing}`);}
 if(prev.light&&cur.light&&prev.light!==cur.light)changes.push(`light: ${prev.light} → ${cur.light}`);
 if(prev.sky&&cur.sky&&prev.sky!==cur.sky)changes.push(`sky: ${prev.sky} → ${cur.sky}`);
 if(cur.talk>prev.talk)changes.push(`${cur.talk-prev.talk} more conversation${cur.talk-prev.talk>1?'s':''} in earshot`);
 const m=prev.minute!=null&&cur.minute!=null?cur.minute-prev.minute:null;
 return {lastLooked:m!=null?`${ago(m)} ago (${prev.clock??'?'})`:prev.clock?`at ${prev.clock}`:'earlier',changes:changes.length?changes:['nothing you can see has changed']};
}
/** Read the last look, write this one, return the frame with `now` first and `since` second. */
export function withSince(frame,dir='.'){
 const file=dir+'/'+LAST_LOOK,cur=lookSummary(frame);let prev=null;try{prev=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):null;}catch{prev=null;}
 try{writeAtomicJSON(file,cur);}catch{/* a read-only folder still answers */}
 const {now,...rest}=frame;return {...(now?{now}:{}),since:sinceLastLook(prev,cur),...rest};
}
