import {useEffect,useRef,useState} from 'react';
import {accountApproval,type AccountApproval as Approval} from './account-approval.ts';
import type {Api} from './useSim.ts';
import type {AuthCtx} from './Shell.tsx';
export function AccountApproval({id,worldId,worldUrl,worldName,auth,api,onReady,onClose}:{id:string;worldId:string;worldUrl:string;worldName:string;auth:AuthCtx;api:Api;onReady(soulId:string):void;onClose():void}){
 const [approval,setApproval]=useState<Approval|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const generation=useRef(0),active=useRef(true),ready=useRef(false),inflight=useRef(false);
 const callback=useRef(onReady);callback.current=onReady;
 useEffect(()=>{active.current=true;inflight.current=false;setBusy(false);return()=>{active.current=false;generation.current++;inflight.current=false;};},[]);
 const check=async(approve=false)=>{if(!auth.authed||inflight.current)return;inflight.current=true;const current=++generation.current;setBusy(true);setError('');try{
  const response=await api('/v1/account/approvals/'+id+(approve?'/approve':''),approve?{}:undefined);if(!active.current||generation.current!==current)return;
  const value=response.status===200?accountApproval(response.data,id,worldId):null;if(!value){setApproval(null);setError(response.status===403?'This approval belongs to another account.':'Approval is unavailable or unconfirmed. Sign in with the intended account and check again.');return;}
  setApproval(value);if(value.status==='ready'&&value.soulId&&!ready.current){ready.current=true;callback.current(value.soulId);}
 }catch{if(active.current&&generation.current===current)setError('The response was interrupted. Check the same approval again; no new Soul was requested.');}finally{if(generation.current===current){inflight.current=false;if(active.current)setBusy(false);}}};
 useEffect(()=>{if(auth.authed)void check();},[auth.authed,id,worldId]);
 useEffect(()=>{if(!auth.authed||approval?.status!=='creating')return;const timer=setInterval(()=>void check(),3000);return()=>clearInterval(timer);},[auth.authed,approval?.status]);
 return <div className="bring-agent-scrim"><section className="bring-agent" role="dialog" aria-modal="true" aria-labelledby="account-approval-title">
  <h2 id="account-approval-title">Approve your agent’s Soul</h2><p>World: <b>{worldName}</b> <span className="dim">{worldUrl}</span></p>
  {!auth.authed?<><p>Sign in with Google or email to review this request. You can keep viewing the world without signing in.</p><button disabled={!auth.ready} onClick={auth.login}>Sign in</button></>:<>
   <p>Signed in as {auth.label??'your account'}.</p>
   {approval&&<><p><b>{approval.name}</b>{approval.description&&<> — {approval.description}</>}{approval.soulId&&<><br/><span className="dim">Soul ID: {approval.soulId}</span></>}</p><p>Agent label: {approval.agentLabel}. This label is supplied by the agent.</p>
    {approval.status==='pending'&&<><p>{approval.mode==='repair'?'Connect a new agent grant to this existing Soul.':'Create this Soul in your account and delegate control to the requesting agent.'} The agent can perceive, act and edit this Soul’s profile after its body is ready. Signing out does not revoke its grant.</p><button className="primary" disabled={busy} onClick={()=>void check(true)}>Approve {approval.mode==='repair'?'connection':'creation and connection'}</button></>}
    {approval.status==='creating'&&<p role="status">Approved. Waiting for the world to confirm the Soul’s body is ready.</p>}
    {approval.status==='ready'&&<p role="status">Ready. Your agent can finish connecting from its own folder.</p>}
    {approval.status==='refused'&&<p role="alert">{typeof approval.reason?.message==='string'?approval.reason.message:'Approved, but the Soul could not arrive in this world. Nothing was created; ask your agent to try again.'}</p>}
    {['cancelled','expired'].includes(approval.status)&&<p role="status">This request is {approval.status}. No ready body or agent connection is inferred.</p>}
   </>}
   <button disabled={busy} onClick={()=>void check()}>Check same request</button>{error&&<p role="status">{error}</p>}
  </>}
  <button onClick={onClose}>Not now</button><p className="dim">Not now closes this view; it does not approve or cancel the agent’s request. The agent can cancel its pending request.</p>
 </section></div>;
}
