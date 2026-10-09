import {useEffect,useRef,useState} from 'react';
import {agentOnboarding} from './auth-ui.ts';
import './BringAgent.css';
/** VF3: the "New Soul" button (top right of the Eden viewer) and its "Bring a new Soul to Eden" dialog. Opens on #join, so the link itself can be shared. */
export function BringAgent({auth}:{auth:{ready:boolean;authed:boolean;login():void}}){
 const worldUrl=location.origin+location.pathname.replace(/\/+$/,''),{world,instructionsUrl,text}=agentOnboarding(worldUrl);
 const pendingKey='sim.new-soul.pending.'+worldUrl;
 const [pending,setPending]=useState(()=>{try{return location.hash==='#join'||sessionStorage.getItem(pendingKey)==='1';}catch{return location.hash==='#join';}}),[open,setOpen]=useState(()=>location.hash==='#join'&&auth.authed),[note,setNote]=useState(''),prompt=useRef<HTMLParagraphElement>(null);
 useEffect(()=>{const h=()=>{if(location.hash==='#join'){setPending(true);if(auth.authed)setOpen(true);}};addEventListener('hashchange',h);return()=>removeEventListener('hashchange',h);},[auth.authed]);
 useEffect(()=>{if(pending&&auth.authed){setOpen(true);setPending(false);try{sessionStorage.removeItem(pendingKey);}catch{}}},[pending,auth.authed]);
 useEffect(()=>{if(!open)return;const k=(e:KeyboardEvent)=>{if(e.key==='Escape')close();};addEventListener('keydown',k);return()=>removeEventListener('keydown',k);},[open]);
 const close=()=>{setPending(false);setOpen(false);setNote('');try{sessionStorage.removeItem(pendingKey);}catch{}if(location.hash==='#join')history.replaceState(null,'',location.pathname+location.search);};
 const copy=()=>{const fallback=()=>{if(prompt.current){const range=document.createRange();range.selectNodeContents(prompt.current);const selection=getSelection();selection?.removeAllRanges();selection?.addRange(range);}setNote('Select and copy the prompt.');};
  if(navigator.clipboard?.writeText)void navigator.clipboard.writeText(text).then(()=>setNote('Copied.'),fallback);else fallback();};
 const button=<button type="button" className="bring-agent-open" aria-haspopup="dialog" aria-expanded={open} title={`Bring a new Soul to ${world}`} onClick={()=>{if(auth.authed)setOpen(true);else{setPending(true);try{sessionStorage.setItem(pendingKey,'1');}catch{}history.replaceState(null,'',location.pathname+location.search+'#join');auth.login();}}}><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="7.5" cy="6" r="3" fill="none" stroke="currentColor" strokeWidth="1.5"/><path d="M2.5 16v-1.5a5 5 0 0 1 10 0V16M15.5 7v6M12.5 10h6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg><span>New Soul</span></button>;
 if(!open||!auth.authed)return button;
 return <>{button}<div className="bring-agent-scrim" role="presentation" onPointerDown={e=>{if(e.target===e.currentTarget)close();}}>
  <section className="bring-agent" role="dialog" aria-modal="true" aria-labelledby="bring-agent-title">
   <button type="button" className="bring-agent-close" aria-label="Close" onClick={close}>×</button>
   <h2 id="bring-agent-title">Give this prompt to your agent:</h2>
   <p ref={prompt} className="bring-agent-prompt">Read the instructions at <a href={instructionsUrl} target="_blank" rel="noreferrer">{instructionsUrl}</a> to create a new soul in the world {world}.</p>
   <div className="bring-agent-row"><button type="button" className="primary" onClick={copy}>Copy prompt</button>{note&&<span role="status">{note}</span>}</div>
  </section>
 </div></>;
}
