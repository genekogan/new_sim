import {agentConnectionProjection,type AgentConnectionProjection} from './connection-response.ts';
/** One in-flight private read; cancelled generations can never publish or schedule again. */
export function pollSoulConnection(active:boolean,read:()=>Promise<unknown>,publish:(value:AgentConnectionProjection|null)=>void,schedule:(fn:()=>void,ms:number)=>ReturnType<typeof setTimeout>=setTimeout,cancel:(timer:ReturnType<typeof setTimeout>)=>void=clearTimeout){
 let live=true,timer:ReturnType<typeof setTimeout>|undefined;
 publish(null);
 const load=async()=>{if(!live)return;let value:unknown=null;try{value=await read();}catch{}if(!live)return;publish(agentConnectionProjection(value));timer=schedule(()=>void load(),5000);};
 if(active)void load();
 return()=>{live=false;if(timer!==undefined)cancel(timer);};
}
