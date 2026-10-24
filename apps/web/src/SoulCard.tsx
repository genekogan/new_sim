import {SoulAvatar} from './MySouls.tsx';
import {useEffect,useRef,useState} from 'react';
import type {PlayView,PublicSoul,TalkLine} from '@sim/protocol';
import type {Api} from './useSim.ts';
import {PUBLIC_SOUL_PATH,readPublicRecord,type PublicRecord} from './public-soul-record.ts';
import {publicSoulActivity} from './PublicSoulActivity.tsx';
import {publicSoulLink} from './soul-link.ts';
import {worldPath} from './world-path.ts';
import {BASE} from './base-path.ts';
import './SoulCard.css';
import {SoulAgentMessageBox} from './AgentMessageBox.tsx';
import {VisitorFrom} from './SoulTravel.tsx';
import {soulPresenceChip,useAgentPresence} from './agent-presence.ts';

/** UI2 (Gene: "it looks like a markdown file"): the selected Soul as a compact card. Name, character, a status
 * dot, what it is doing, Share. Everything else (last action, recent actions/events, public activity) sits in a
 * secondary Activity view. All record text is untrusted and rendered as text only. */
const FADE:Record<string,{word:string;colour:string}>={green:{word:'Active',colour:'#2e9d4f'},yellow:{word:'Fading',colour:'#d6a700'},red:{word:'Nearly gone',colour:'#c2372b'},gone:{word:'Gone',colour:'#9a9a92'}};
type Rec=PublicRecord|'loading'|'unavailable';
function ago(at:number|string|null|undefined){if(at==null)return null;const t=typeof at==='number'?at:Date.parse(at);if(!Number.isFinite(t))return null;const m=Math.round((Date.now()-t)/60000);return m<1?'just now':m<60?`${m} min ago`:`${Math.round(m/60)} h ago`;}
const plain=(s:string|undefined)=>(s??'').replace(/[-_]+/g,' ').trim();
/** "walk:commons" → "Walk · commons" (labels from the record win). */
const actionText=(x:{label?:string;capability?:string})=>{if(x.label)return x.label;const [verb,...rest]=(x.capability??'').split(':');const v=plain(verb);return (v?v[0].toUpperCase()+v.slice(1):'Action')+(rest.length?' · '+plain(rest.join(' ')):'');};
function eventText(e:PublicRecord['events'][number]){
 switch(e.kind){
  case 'arrival':return `${e.soul?.name??'Someone'} arrived`;
  case 'departure':return `${e.soul?.name??'Someone'} left`;
  case 'speech':return `${e.from?.name??'Someone'}: “${e.text??''}”`;
  case 'receipt':return 'Action update';
  default:return e.text??plain(e.kind);
 }
}

function usePublicRecord(api:Api,soulId:string):Rec{
 const [rec,setRec]=useState<Rec>('loading');
 useEffect(()=>{let live=true,timer:ReturnType<typeof setTimeout>|undefined;setRec('loading');
  const read=async()=>{try{const r=await api(PUBLIC_SOUL_PATH(soulId));if(!live)return;
   if(r.status===404||r.status===405){setRec('unavailable');return;}
   const p=r.status===200?readPublicRecord(r.data):null;setRec(prev=>p??(prev!=='loading'?prev:'unavailable'));}catch{/* keep the last record */}
   if(live)timer=setTimeout(()=>void read(),10_000);};
  void read();return()=>{live=false;clearTimeout(timer);};},[api,soulId]);
 return rec;
}

export function SoulCard({api,soul,doing,energy,plays,talk,camera,ownerAction}:{api:Api;soul:PublicSoul;doing:string;energy:string|null;plays:readonly PlayView[];talk:readonly TalkLine[];camera?:{following:boolean;follow():void;stop():void};ownerAction?:()=>void}){
 const rec=usePublicRecord(api,soul.id);
 // AWAY-UI: the owner's card drops Follow while the agent is away (still offered to stop a follow already on)
 const here=useAgentPresence(ownerAction?soul.id:null),agentAway=!!here?.away;
 // PRESENCE (SOUL3): the owner's card says whether its agent is listening (only the owner's own inbox read feeds it)
 const chip=ownerAction?soulPresenceChip(here):null;
 const [view,setView]=useState<'card'|'activity'>('card');
 const [copied,setCopied]=useState<''|'ok'|'failed'>('');
 const title=useRef<HTMLHeadingElement>(null),alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{setView('card');setCopied('');},[soul.id]);
 useEffect(()=>{if(view==='card'&&title.current?.offsetParent)title.current.focus({preventScroll:true});},[soul.id,view]);
 useEffect(()=>{if(!copied)return;const t=setTimeout(()=>setCopied(''),2200);return()=>clearTimeout(t);},[copied]);
 const share=async()=>{try{await navigator.clipboard.writeText(publicSoulLink(location.origin,worldPath,soul.id,BASE));if(alive.current)setCopied('ok');}catch{if(alive.current)setCopied('failed');}};
 const fade=rec!=='loading'&&rec!=='unavailable'&&rec.fade?FADE[rec.fade.colour]??null:null;
 if(view==='activity')return <SoulActivity soul={soul} rec={rec} plays={plays} talk={talk} back={()=>setView('card')}/>;
 return <article className="soul-card" aria-labelledby="soul-card-name" data-agent-away={agentAway?'1':undefined}>
  <div className="soul-card-portrait"><SoulAvatar soul={soul}/></div>
  <div className="soul-card-head">
   <h1 id="soul-card-name" ref={title} tabIndex={-1} title={soul.name}>{soul.name}</h1>
   {/* CARD-TRIM (Gene 2026-10-23 #17): Share is a paperclip by the name; it copies the Soul's public link */}
   <button className="soul-share" aria-label={`Copy a link to ${soul.name}`} title="Copy link" onClick={()=>void share()}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10.5 4.5v6a2.5 2.5 0 01-5 0V3.75a1.75 1.75 0 013.5 0V10a1 1 0 01-2 0V5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg></button>
   <span className="soul-copied" role="status" aria-live="polite">{copied==='ok'?'Link copied':copied==='failed'?'Copy unavailable':''}</span>
  </div>
  {soul.description&&<p className="soul-character">{soul.description}</p>}
  <p className="soul-meta">
   {fade&&<span className="soul-status"><i style={{background:fade.colour}} aria-hidden="true"/>{fade.word}</span>}
   {doing&&<span className="soul-doing">{doing}</span>}
   {energy&&<span className="soul-energy">{energy}</span>}
   <VisitorFrom soulId={soul.id}/>
   {chip&&<span className="soul-agent" data-agent-state={chip.state} title={chip.title}><i aria-hidden="true"/>{chip.text}</span>}
  </p>
  <div className="soul-card-thread" data-soul-thread={soul.id}/>
  {ownerAction&&<SoulAgentMessageBox api={api} soulId={soul.id} name={soul.name}/>}
  <div className="soul-actions">
   {ownerAction&&<button onClick={ownerAction}>This mind</button>}
   {camera&&(!agentAway||camera.following)&&<button className={camera.following?'soul-follow on':'soul-follow'} aria-pressed={camera.following} title={camera.following?'Stop following':'Keep the camera on this Soul'} onClick={camera.following?camera.stop:camera.follow}><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="2.6" fill="currentColor"/><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.4"/></svg>{camera.following?'Following':'Follow'}</button>}
   <button className="soul-more" onClick={()=>setView('activity')}>Activity<span aria-hidden="true">›</span></button>
  </div>
 </article>;
}

function SoulActivity({soul,rec,plays,talk,back}:{soul:PublicSoul;rec:Rec;plays:readonly PlayView[];talk:readonly TalkLine[];back():void}){
 const heading=useRef<HTMLHeadingElement>(null);
 useEffect(()=>{heading.current?.focus({preventScroll:true});},[]);
 const r=rec!=='loading'&&rec!=='unavailable'?rec:null,rows=publicSoulActivity(soul.id,plays,talk);
 const where=r?.self?[plain(r.self.state),r.self.placePath?.map(p=>p.name).filter(Boolean)[0]].filter(Boolean).join(' · '):'';
 const last=r?.receipts[0],lastAgo=ago(r?.lastAcceptedAt);
 const empty=!where&&!last&&!lastAgo&&!(r?.receipts.length)&&!(r?.events.length)&&!rows.length;
 return <article className="soul-card soul-activity" aria-labelledby="soul-activity-title">
  <button className="soul-back" onClick={back} title={soul.name}><span aria-hidden="true">‹</span><span className="soul-back-name">{soul.name}</span></button>
  <h2 id="soul-activity-title" ref={heading} tabIndex={-1}>Activity</h2>
  {(where||lastAgo||last)&&<dl className="soul-facts">
   {where&&<><dt>Now</dt><dd>{where}</dd></>}
   {(lastAgo||last)&&<><dt>Last action</dt><dd>{[last?actionText(last):null,lastAgo].filter(Boolean).join(' · ')}</dd></>}
  </dl>}
  {r&&r.receipts.length>0&&<section className="soul-list-block" aria-label="Recent actions"><h3>Recent actions</h3>
   <ol>{r.receipts.map(x=><li key={x.id}>{actionText(x)}<span className="soul-dim"> · {x.phase}{x.code?` (${x.code})`:''}</span></li>)}</ol></section>}
  {r&&r.events.length>0&&<section className="soul-list-block" aria-label="Recent events"><h3>Recent events</h3>
   <ol>{r.events.slice(-8).reverse().map(e=><li key={e.id}>{eventText(e)}</li>)}</ol></section>}
  {rows.length>0&&<section className="soul-list-block" aria-label="Recent public activity"><h3>Recent public activity</h3>
   <ol>{rows.map(x=><li key={x.key}><b>{x.title}</b> {x.detail}</li>)}</ol></section>}
  {empty&&<p className="soul-dim">{rec==='loading'?'Loading…':'Nothing recorded yet.'}</p>}
  {(r?.events.length||rows.length)?<p className="soul-fine">Names and words are written by other people’s agents.</p>:null}
 </article>;
}
