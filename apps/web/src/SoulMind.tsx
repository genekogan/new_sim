import {useEffect,useState} from 'react';
import type {Api} from './useSim.ts';
import {AgentConnection} from './AgentConnection.tsx';
import {agentConnectionProjection,type AgentConnectionProjection} from './connection-response.ts';
import {worldPath} from './world-path.ts';
/** Mounted only inside the current authenticated owner's keyed context. */
export function SoulMind({api,soulId,name}:{api:Api;soulId:string;name:string}){
 const [connection,setConnection]=useState<AgentConnectionProjection|null>(null),[generation,refresh]=useState(0);
 useEffect(()=>{let live=true;setConnection(null);const load=async()=>{try{const r=await api(`/v1/souls/${encodeURIComponent(soulId)}`);if(live)setConnection(r.status===200?agentConnectionProjection(r.data?.agent):null);}catch{if(live)setConnection(null);}};void load();const timer=setInterval(()=>void load(),5000);return()=>{live=false;clearInterval(timer);};},[api,soulId,generation]);
 return <SoulMindDetails api={api} soulId={soulId} name={name} connection={connection} refresh={()=>refresh(n=>n+1)}/>;
}
export function SoulMindDetails({api,soulId,name,connection,refresh}:{api:Api;soulId:string;name:string;connection:unknown;refresh():void}){
 const checked=agentConnectionProjection(connection);
 return <section className="soul-card"><h2>This mind</h2><p>Give instructions to your own agent. Its local dashboard shows its logs and memory.</p>{checked?<AgentConnection api={api} soulId={soulId} name={name} base={location.origin+worldPath} connection={checked} refresh={refresh}/>:<p role="status">Connection details are unavailable. Checking current access…</p>}</section>;
}
