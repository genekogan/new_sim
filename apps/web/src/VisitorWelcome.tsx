import {useEffect,useId,useRef,useState} from 'react';
import type {WorldViewerHandle,WorldViewerState} from './WorldViewer.ts';
import {feedbackMoment,awayHasUpdates,type FeedbackMoment,type AwayReport} from './visitor-context.ts';
import {discoverVisitorWorlds} from './visitor-worlds.ts';
import {onFeedbackRequest} from './feedback-request.ts';
import './visitor-welcome.css';
type Api=(path:string,body?:unknown,method?:string)=>Promise<{status:number;data:any}>;
type Props={api:Api;siteApi:Api;worldPath:string;ownerId:string|null;worldId:string;worldName:string;build?:string;handle:WorldViewerHandle|null;state:WorldViewerState|null};
/** Owner|world pairs whose return card this page already offered automatically. */
const autoOpened=new Set<string>();
/** Lane U2 (Gene 2026-10-20: "Hide 'Since your last visit' section and button. We dont need this section"): one switch.
 * Off: no button, no panel and no return-history or visit requests. true brings all of it back unchanged. */
export const RETURN_HISTORY:boolean=false;
type Window={path:string;name:string;report:AwayReport};
export function VisitorWelcome({api,siteApi,worldPath,ownerId,worldId,worldName,build,handle,state}:Props){
 const [moment,setMoment]=useState<FeedbackMoment|null>(null),[windows,setWindows]=useState<Window[]|null>(null),[showAway,setShowAway]=useState(false),[awayError,setAwayError]=useState(''),[missing,setMissing]=useState<string[]>([]),[visitWarning,setVisitWarning]=useState(false);
 const epoch=useRef(0),request=useRef(0),loaded=useRef<string[]>([]);
 async function loadReturn(automatic=false,quiet=false){
  if(!ownerId||document.visibilityState==='hidden')return;const generation=epoch.current,id=++request.current;setAwayError('');
  const current=()=>epoch.current===generation&&id===request.current&&document.visibilityState!=='hidden';
  const discovery=await discoverVisitorWorlds({path:worldPath,name:worldName,worldId},fetch,ownerId);if(!current())return;
  const results:Window[]=[],unavailable:string[]=[];let next=0;
  // At most three reads at once; world registries are bounded to sixty routes.
  await Promise.all(Array.from({length:Math.min(3,discovery.worlds.length)},async()=>{
   while(next<discovery.worlds.length){const w=discovery.worlds[next++]!;const r=await siteApi(w.path+'/v1/me/away');if(!current())return;
    if(r.status!==200||typeof r.data?.worldId!=='string'||w.worldId&&r.data.worldId!==w.worldId||!Array.isArray(r.data.residents)){unavailable.push(w.name);continue;}
    const report=r.data as AwayReport;
    if(w.path===worldPath||report.world.owned||report.residents.length)results.push({path:w.path,name:w.name,report});
   }
  }));if(!current())return;
  results.sort((a,b)=>a.path===worldPath?-1:b.path===worldPath?1:a.name.localeCompare(b.name));
  setWindows(results);setMissing([...unavailable,...discovery.paused.map(n=>n+' (not running)'),...(discovery.capped?['More worlds beyond this sixty-world window']:[])]);loaded.current=results.map(w=>w.path);
  if(!results.length)setAwayError('Your return history could not be loaded. Try again.');
  if(!automatic||!quiet&&results.some(w=>!w.report.firstVisit))setShowAway(true);
  // Acknowledge only source cutoffs actually loaded into this owner's panel.
  setVisitWarning(false);for(const w of results){if(!current())return;const ack=await siteApi(w.path+'/v1/me/visit',{through:w.report.through});if(current()&&ack.status!==200)setVisitWarning(true);}
 }
 // The Feedback form opens from the account menu (signed in), the signed-out More menu or the phone More menu.
 const view=useRef({handle,state});view.current={handle,state};
 useEffect(()=>onFeedbackRequest(()=>{const v=view.current;v.handle?.releaseInput?.();setShowAway(false);setMoment(feedbackMoment(v.handle,v.state));}),[]);
 useEffect(()=>{
  if(!RETURN_HISTORY)return;
  // A reconnect (a release handover, a network blip) remounts this panel with a new authority generation: that is not a
  // return, so only the page's first automatic load per owner and world may open the card (a hidden tab coming back still does).
  const key=`${ownerId}|${worldPath}`,first=!autoOpened.has(key);if(ownerId)autoOpened.add(key);
  epoch.current++;if(ownerId)void loadReturn(true,!first);
  const markVisited=()=>{if(ownerId&&loaded.current.includes(worldPath))void siteApi(worldPath+'/v1/me/visit',{});};
  const timer=setInterval(()=>{if(document.visibilityState==='visible')markVisited();},60_000);
  const visibility=()=>{if(document.visibilityState==='hidden')markVisited();else if(ownerId)void loadReturn(true);};
  document.addEventListener('visibilitychange',visibility);
  return()=>{epoch.current++;clearInterval(timer);document.removeEventListener('visibilitychange',visibility);};
 },[api,siteApi,ownerId,worldId,worldPath]);
 return <>
  {RETURN_HISTORY&&ownerId&&<div className="visitor-controls" aria-label="Return history">
   <button onClick={()=>{handle?.releaseInput?.();if(windows)setShowAway(v=>!v);else{setShowAway(true);void loadReturn();}}}>Since your last visit</button>
  </div>}
  {moment&&<FeedbackForm {...{api,moment,worldId,worldName,build}} close={()=>setMoment(null)}/>}
  {RETURN_HISTORY&&showAway&&ownerId&&<section className="visitor-return" aria-label="While you were away">
   <div className="visitor-heading"><div><span className="visitor-eyebrow">Welcome back</span><h2>While you were away</h2></div><button aria-label="Close return history" onClick={()=>setShowAway(false)}>×</button></div>
   {awayError?<p role="status">{awayError} <button onClick={()=>void loadReturn()}>Retry</button></p>:windows?windows.map(w=><div className="visitor-world-return" key={w.path}><h3>{w.name}</h3><ReturnHistory report={w.report}/></div>):<p role="status">Loading your return history…</p>}
   {visitWarning&&<p className="visitor-history-note">This visit could not be saved. Some updates may repeat next time.</p>}
   {missing.length>0&&<p className="visitor-history-note">Unavailable in this visit: {missing.slice(0,4).join(' · ')+(missing.length>4?` · ${missing.length-4} more`:'')}.</p>}
  </section>}
 </>;
}
function FeedbackForm({api,moment,worldId,worldName,build,close}:{api:Api;moment:FeedbackMoment;worldId:string;worldName:string;build?:string;close:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null),textId=useId(),live=useRef(true);
 const [text,setText]=useState(''),[pending,setPending]=useState(false),[error,setError]=useState(''),[receipt,setReceipt]=useState<{id:string}|null>(null);
 useEffect(()=>{live.current=true;dialog.current?.showModal();return()=>{live.current=false;};},[]);
 async function send(){if(pending||!text.trim())return;setPending(true);setError('');const r=await api('/v1/feedback',{...moment,text:text.trim()});if(!live.current)return;setPending(false);
  if(r.status===201&&r.data?.ok&&typeof r.data.id==='string')setReceipt({id:r.data.id});
  else setError(r.status===429?'Please wait a little before sending more feedback.':r.status===0?'Receipt unconfirmed. Your message may have arrived; keep this text before trying again.':r.data?.message??'Feedback could not be saved. Your text is still here.');
 }
 return <dialog ref={dialog} className="visitor-feedback" onCancel={close} onClose={close} aria-labelledby="feedback-title">
  <div className="visitor-heading"><div><span className="visitor-eyebrow">{worldName}</span><h2 id="feedback-title">{receipt?'Thank you for the feedback':'What did you notice?'}</h2></div><button aria-label="Close feedback" onClick={close}>×</button></div>
  {receipt?<div className="visitor-receipt" role="status"><span className="visitor-check" aria-hidden="true">✓</span><p><strong>We got it.</strong></p><p>Your feedback was saved for this world’s owner.</p><p className="visitor-muted">Receipt</p><code>{receipt.id}</code><button className="visitor-primary" onClick={close}>Back to the world</button></div>:<form onSubmit={e=>{e.preventDefault();void send();}}>
   <p>What delighted you, or what could work better?</p>
   <label htmlFor={textId}>Your feedback</label><textarea autoFocus id={textId} value={text} rows={5} maxLength={4000} onChange={e=>setText(e.target.value)} required/>
   <p className="visitor-muted">Your message and the context below are sent to this world’s owner. You can send without signing in.</p>
   <details><summary>Context attached</summary><dl><dt>World</dt><dd>{worldId}</dd><dt>Resident</dt><dd>{moment.residentId??'None selected'}</dd><dt>Place or object</dt><dd>{moment.placeId??'None selected'}</dd><dt>Moment</dt><dd>{moment.tick===null?'No recorded frame':`Tick ${moment.tick}`} · {moment.clientTime}</dd><dt>Build</dt><dd>{build??'Server records the current build'}</dd><dt>Camera</dt><dd>{moment.camera?moment.camera.position.map(n=>n.toFixed(2)).join(', '):'Unavailable'}</dd></dl></details>
   {error&&<p role="alert">{error}</p>}
   <button className="visitor-primary" type="submit" disabled={pending||!text.trim()}>{pending?'Sending…':'Send feedback'}</button>
  </form>}
 </dialog>;
}
export function ReturnHistory({report}:{report:AwayReport}){
 const since=report.since===null?'':new Date(report.since).toLocaleString();
 return <div className="visitor-return-content">
  <p className="visitor-muted">{report.firstVisit?'Your first visit is now saved. Come back to see what happens here.':`Since ${since}`}</p>
  {report.incomplete&&<p className="visitor-history-note">A limited window of retained history is shown. Some earlier activity may be missing.</p>}
  {!report.firstVisit&&!awayHasUpdates(report)&&<p>No recorded changes since your last visit.</p>}
  {report.residents.map(r=><article key={r.id}><h3>{r.name}</h3>{r.events.length?<ul>{r.events.map(e=><li key={e.id}>{e.text}</li>)}</ul>:<p>No recorded activity in this window.</p>}{r.conversations>0&&<p>{r.conversations} conversation{r.conversations===1?'':'s'}</p>}{r.places.length>0&&<p className="visitor-muted">Places: {r.places.join(' · ')}</p>}{r.incomplete&&<p className="visitor-muted">Recent activity only.</p>}</article>)}
  {report.world.owned&&<article><h3>Your world</h3>{report.world.changes.length?<ul>{report.world.changes.map(e=><li key={e.id}>{e.text}</li>)}</ul>:<p>No recorded world changes in this window.</p>}{report.world.incomplete&&<p className="visitor-muted">Recent changes only.</p>}</article>}
 </div>;
}
