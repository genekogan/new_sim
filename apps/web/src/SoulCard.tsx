import {SoulAvatar} from './MySouls.tsx';
import {requestSoulConversations} from './dialogue-speaking.ts';
import {useEffect,useRef,useState} from 'react';
import type {PlayView,PublicSoul,TalkLine} from '@sim/protocol';
import type {Api} from './useSim.ts';
import {PUBLIC_SOUL_PATH,readPublicRecord,type PublicRecord} from './public-soul-record.ts';
import {publicSoulActivity} from './PublicSoulActivity.tsx';
import {publicSoulLink} from './soul-link.ts';
import {worldPath} from './world-path.ts';
import './SoulCard.css';

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

export function SoulCard({api,soul,doing,energy,plays,talk,camera,pin}:{api:Api;soul:PublicSoul;doing:string;energy:string|null;plays:readonly PlayView[];talk:readonly TalkLine[];camera?:{following:boolean;follow():void;stop():void};pin?:{pinned:boolean;toggle():void}}){
 const rec=usePublicRecord(api,soul.id);
 const [view,setView]=useState<'card'|'activity'>('card');
 const [copied,setCopied]=useState<''|'ok'|'failed'>('');
 const title=useRef<HTMLHeadingElement>(null),alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{setView('card');setCopied('');},[soul.id]);
 useEffect(()=>{if(view==='card'&&title.current?.offsetParent)title.current.focus({preventScroll:true});},[soul.id,view]);
 useEffect(()=>{if(!copied)return;const t=setTimeout(()=>setCopied(''),2200);return()=>clearTimeout(t);},[copied]);
 const share=async()=>{try{await navigator.clipboard.writeText(publicSoulLink(location.origin,worldPath,soul.id));if(alive.current)setCopied('ok');}catch{if(alive.current)setCopied('failed');}};
 const fade=rec!=='loading'&&rec!=='unavailable'&&rec.fade?FADE[rec.fade.colour]??null:null;
 if(view==='activity')return <SoulActivity soul={soul} rec={rec} plays={plays} talk={talk} back={()=>setView('card')}/>;
 return <article className="soul-card" aria-labelledby="soul-card-name">
  <div className="soul-card-portrait"><SoulAvatar soul={soul}/></div>
  <h1 id="soul-card-name" ref={title} tabIndex={-1}>{soul.name}</h1>
  {soul.description&&<p className="soul-character">{soul.description}</p>}
  <p className="soul-meta">
   {fade&&<span className="soul-status"><i style={{background:fade.colour}} aria-hidden="true"/>{fade.word}</span>}
   {doing&&<span className="soul-doing">{doing}</span>}
   {energy&&<span className="soul-energy">{energy}</span>}
  </p>
  <div className="soul-actions">
   <button onClick={()=>requestSoulConversations(soul.id)}>Conversations</button>
   {pin&&<button aria-pressed={pin.pinned} aria-label={pin.pinned?'Pinned to your Souls; unpin this Soul':'Pin this Soul to your Souls'} title={pin.pinned?'Unpin from your Souls':'Pin to your Souls'} onClick={pin.toggle}>{pin.pinned?'Pinned':'This is mine'}</button>}
   {camera&&<button className={camera.following?'soul-follow on':'soul-follow'} aria-pressed={camera.following} title={camera.following?'Stop following':'Keep the camera on this Soul'} onClick={camera.following?camera.stop:camera.follow}><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="2.6" fill="currentColor"/><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.4"/></svg>{camera.following?'Following':'Follow'}</button>}
   <button className="soul-share" onClick={()=>void share()}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6.5 9.5l3-3M7 4.5l1.3-1.3a2.6 2.6 0 013.6 3.6L10.5 8.2M9 11.5l-1.3 1.3a2.6 2.6 0 01-3.6-3.6l1.4-1.4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>Share</button>
   <span className="soul-copied" role="status" aria-live="polite">{copied==='ok'?'Link copied':copied==='failed'?'Copy unavailable':''}</span>
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
  <button className="soul-back" onClick={back}><span aria-hidden="true">‹</span>{soul.name}</button>
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
