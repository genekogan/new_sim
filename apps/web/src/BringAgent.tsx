import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {pendingNewSoul,requestNewSoul,resumeNewSoul,dismissNewSoul} from './new-soul-entry.ts';
import {agentOnboarding} from './auth-ui.ts';
import './BringAgent.css';
import {copyText,manualCopyHint} from './clipboard.ts';
/** VF3: the "New Soul" button (top right of the Eden viewer) and its "Bring a new Soul to Eden" dialog. Opens on #join, so the link itself can be shared. */
export function BringAgent({auth,requireAuth=false,showButton=true,worldName}:{auth:{ready:boolean;authed:boolean;login():void;signInUrl?:string};requireAuth?:boolean;showButton?:boolean;worldName?:string}){
 const worldUrl=location.origin+location.pathname.replace(/\/+$/,''),{world,instructionsUrl,text}=agentOnboarding(worldUrl,worldName);
 const port={location,history:{replaceState:(data:unknown,title:string,url?:string|URL|null)=>history.replaceState(data,title,url)},storage:()=>sessionStorage};
 const [pending,setPending]=useState(()=>pendingNewSoul(worldUrl,location.hash,port.storage)),[open,setOpen]=useState(()=>location.hash==='#join'&&(!requireAuth||auth.authed)),[note,setNote]=useState(''),prompt=useRef<HTMLParagraphElement>(null),modal=useRef<HTMLElement>(null);
 useEffect(()=>{const h=()=>{if(location.hash==='#join'){setPending(true);if(!requireAuth||auth.authed)setOpen(true);}};addEventListener('hashchange',h);return()=>removeEventListener('hashchange',h);},[auth.authed,requireAuth]);
 useEffect(()=>{if(resumeNewSoul(pending,requireAuth,auth.authed,worldUrl,port.storage)){setOpen(true);setPending(false);}},[pending,auth.authed,requireAuth]);
 useEffect(()=>{if(!open)return;const prior=document.activeElement as HTMLElement|null;modal.current?.querySelector<HTMLButtonElement>('.primary')?.focus();const k=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();close();}if(e.key==='Tab'){const nodes=[...modal.current?.querySelectorAll<HTMLElement>('button,a[href]')??[]];const first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}};addEventListener('keydown',k);return()=>{removeEventListener('keydown',k);if(prior?.isConnected&&prior.getClientRects().length)prior.focus();else document.querySelector<HTMLElement>('.account-avatar,.account-sign-in')?.focus();};},[open]);
 const close=()=>{setPending(false);setOpen(false);setNote('');dismissNewSoul(worldUrl,port);};
 const copy=async()=>{if(await copyText(text)){setNote('Copied.');return;}if(prompt.current){const range=document.createRange();range.selectNodeContents(prompt.current);const selection=getSelection();selection?.removeAllRanges();selection?.addRange(range);}setNote(manualCopyHint);};
 const canonicalJoin=auth.signInUrl?new URL(auth.signInUrl):null;if(canonicalJoin)canonicalJoin.hash='join';
 if(canonicalJoin)return showButton?<a className="bring-agent-open" href={canonicalJoin.href} title={`Bring a new Soul to ${world}`}><span>New Soul</span></a>:null;
 const button=<button type="button" className="bring-agent-open" aria-haspopup="dialog" aria-expanded={open} title={`Bring a new Soul to ${world}`} onClick={()=>{if(requestNewSoul(auth,requireAuth,worldUrl,port))setOpen(true);else setPending(true);}}><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="7.5" cy="6" r="3" fill="none" stroke="currentColor" strokeWidth="1.5"/><path d="M2.5 16v-1.5a5 5 0 0 1 10 0V16M15.5 7v6M12.5 10h6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg><span>New Soul</span></button>;
 const entry=showButton?button:null;
 if(!open||requireAuth&&!auth.authed)return entry;
 return <>{entry}{createPortal(<div className="bring-agent-scrim" role="presentation" onPointerDown={e=>{if(e.target===e.currentTarget)close();}}>
  <section ref={modal} className="bring-agent" role="dialog" aria-modal="true" aria-labelledby="bring-agent-title">
   <button type="button" className="bring-agent-close" aria-label="Close" onClick={close}>×</button>
   <h2 id="bring-agent-title">Give this prompt to your agent:</h2>
   <p ref={prompt} className="bring-agent-prompt">Read the instructions at <a href={instructionsUrl} target="_blank" rel="noreferrer">{instructionsUrl}</a> to create a new soul in the world {world}.</p>
   <div className="bring-agent-row"><button type="button" className="primary" onClick={copy}>Copy prompt</button>{note&&<span role="status">{note}</span>}</div>
  </section>
 </div>,document.body)}</>;
}

/** Secondary entry has no onboarding state or portal; the header owns #join. */
export function NewSoulLink({auth}:{auth:{signInUrl?:string}}){const target=auth.signInUrl?new URL(auth.signInUrl):null;if(target)target.hash='join';return <a className="bring-agent-open" href={target?.href??'#join'}>New Soul</a>;}
