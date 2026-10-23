// AWAY-UI (Gene's night notes 2026-10-23 #14): one page-wide record of whether each owned Soul's agent is here.
// The open card's inbox poll reports into it (every 2 s); the toolbar chips poll the owner inbox slowly for the rest.
// Only the owner's own inbox reads feed it (GET /v1/edge/owner/:id/inbox, read-only), so nothing here confers control.
import {useEffect,useState} from 'react';
import type {Api} from './useSim.ts';

export type AgentHere={away:boolean;lastSeenAt:number|null};
const known=new Map<string,AgentHere>(),subs=new Set<()=>void>();
/** A fresh owner-inbox answer for this Soul (null: status unavailable, which makes no away claim). */
export function reportAgentPresence(soulId:string,inbox:{presence?:string;connected:boolean;lastSeenAt:number|null}|null){
 const next=inbox?{away:(inbox.presence??(inbox.connected?'recent':'away'))==='away',lastSeenAt:inbox.lastSeenAt}:null,prev=known.get(soulId);
 if(next?prev?.away===next.away&&prev.lastSeenAt===next.lastSeenAt:!prev)return;
 if(next)known.set(soulId,next);else known.delete(soulId);
 for(const f of subs)f();
}
export const agentPresence=(soulId:string)=>known.get(soulId)??null;
function useTick(){const [,set]=useState(0);useEffect(()=>{const f=()=>set(n=>n+1);subs.add(f);return()=>{subs.delete(f);};},[]);}
/** This Soul's agent state as last reported (null = unknown: show the active affordances). */
export function useAgentPresence(soulId:string|null|undefined){useTick();return soulId?agentPresence(soulId):null;}
/** The toolbar chips: poll the owner inbox of each shown Soul every 15 s (the open card refreshes its own every 2 s). */
export const CHIP_POLL_MS=15_000;
export function useOwnedAgentPresence(api:Api|undefined,ids:readonly string[]){
 useTick();
 const key=ids.join(',');
 useEffect(()=>{
  if(!api||!key)return;
  let live=true,timer:ReturnType<typeof setTimeout>|undefined;
  const read=async()=>{
   await Promise.all(key.split(',').map(async id=>{
    try{const r=await api(`/v1/edge/owner/${encodeURIComponent(id)}/inbox`);if(live&&r.status===200&&r.data?.inbox)reportAgentPresence(id,r.data.inbox);}catch{/* keep the last state */}
   }));
   if(live)timer=setTimeout(()=>void read(),CHIP_POLL_MS);
  };
  void read();return()=>{live=false;clearTimeout(timer);};
 },[api,key]);
 return (id:string)=>agentPresence(id);
}
/** "away since 14:05" (today) or "away since Oct 22" (older); "away" when the agent was never seen. */
export function awaySince(lastSeenAt:number|null,now=Date.now()){
 if(lastSeenAt==null)return 'Away';
 const d=new Date(lastSeenAt),today=new Date(now).toDateString()===d.toDateString();
 return `Away since ${today?d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):d.toLocaleDateString([],{month:'short',day:'numeric'})}`;
}
