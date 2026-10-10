import {useEffect,useRef,useState} from 'react';
import {isConnectionRefusal,type AgentConnectionProjection} from './connection-response.ts';
import type {Api} from './useSim.ts';
import {connectionSetupPrompt} from './connection-prompt.ts';
type Connection=AgentConnectionProjection;
type Props={api:Api;soulId:string;name:string;base:string;connection:Connection|null;refresh():void;notice?:{message:string;setMessage(value:string):void}};
export function AgentConnection(props:Props){
  return <ConnectionCard key={JSON.stringify([props.base,props.soulId])} {...props}/>;
}
function ConnectionCard({api,soulId,name,base,connection,refresh,notice}:Props){
  const [localMessage,setLocalMessage]=useState(''),[busy,setBusy]=useState(false),[code,setCode]=useState<string|null>(null);
  const message=notice?.message??localMessage,setMessage=notice?.setMessage??setLocalMessage;
  const [issuedAt,setIssuedAt]=useState(0),[clock,setClock]=useState(Date.now());
  const pending=useRef(false),live=useRef(true);
  useEffect(()=>{live.current=true;const timer=setInterval(()=>setClock(Date.now()),1000);return()=>{live.current=false;clearInterval(timer);};},[]);
  useEffect(()=>{if(connection?.attached&&connection.since&&connection.since>=issuedAt)setCode(null);},[connection?.since,connection?.attached,issuedAt]);
  const expired=!!code&&clock-issuedAt>=15*60_000;
  const setupPrompt=connectionSetupPrompt(base,soulId,name);
  const act=async(kind:'pair'|'revoke')=>{
    if(pending.current)return;pending.current=true;setBusy(true);setMessage(kind==='pair'?'Requesting a one-use code…':'Requesting disconnection…');
    try{
      const result=await api(`/v1/souls/${encodeURIComponent(soulId)}/${kind}`,{});
      if(!live.current)return;
      if(result.status===200&&kind==='revoke'&&result.data?.ok===true){setCode(null);setMessage('Disconnection confirmed. Checking current connection status…');refresh();}
      else if(result.status===200&&kind==='pair'&&/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/.test(result.data?.code??'')){setCode(result.data.code);setIssuedAt(Date.now());setMessage('Code requested. Your assistant is not connected by this code alone.');}
      else if(isConnectionRefusal(result.status))setMessage('Request refused. Check your access to this Soul.');
      else {setMessage('Response unconfirmed. Check current connection status before requesting this again.');refresh();}
    }catch{if(live.current){setMessage('Response unconfirmed. Check current connection status before requesting this again.');refresh();}}
    finally{pending.current=false;if(live.current)setBusy(false);}
  };
  return <section className="wide" aria-label="Assistant connection">
    <h3>Agent access</h3>
    <p>{!connection?'Checking connection…':connection.attached?<><span className="ok">●</span> <b>{connection.label??'Your agent'}</b> has access to {name}.</>: 'No agent has access to this Soul.'}</p>
    {connection?.attached&&<p className="small dim">Granted access does not confirm that your agent is running.</p>}
    <details><summary>Connect or re-pair your agent</summary>
      <p>Give this prompt to your agent, then approve its link in your browser.</p>
      {setupPrompt&&<><textarea aria-label="Connection setup prompt" readOnly rows={4} value={setupPrompt}/><button onClick={async()=>{try{await navigator.clipboard.writeText(setupPrompt);if(live.current)setMessage('Copied.');}catch{if(live.current)setMessage('Copy unavailable. Select the prompt and copy it.');}}}>Copy prompt</button></>}
      <a href={`${base}/instructions.md`} target="_blank" rel="noreferrer">Read the instructions</a>
    </details>
    {connection?.attached&&<button disabled={busy} onClick={()=>void act('revoke')}>Disconnect assistant</button>}
    <details><summary>Advanced: one-use owner code</summary><p>For a reviewed client that accepts a code through a private input channel. Keep the code out of assistant prompts and configuration. Generating a code does not connect an assistant; exchanging it replaces the current connection.</p>
      <button disabled={busy||!connection} onClick={()=>void act('pair')}>Request one-use code</button>
      {code&&!expired&&<p>One-use code: <code>{code}</code>. Expires 15 minutes after request. <button onClick={()=>setCode(null)}>Hide code</button></p>}
      {expired&&<p>Code expired. Request a new one if you still want to connect.</p>}
    </details>
    {message&&<p role="status">{message}</p>}
  </section>;
}
