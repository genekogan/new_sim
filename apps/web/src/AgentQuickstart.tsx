import {useEffect,useRef,useState} from 'react';
import {agentQuickstart} from './auth-ui.ts';
/** "Bring your agent": the copyable quickstart prompt for this world. No account needed. */
export function AgentQuickstart({worldUrl,compact=false}:{worldUrl:string;compact?:boolean}){
 const text=agentQuickstart(worldUrl),[note,setNote]=useState(''),alive=useRef(true),area=useRef<HTMLTextAreaElement>(null);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const copy=()=>{const done=(ok:boolean)=>{if(alive.current)setNote(ok?'Copied. Paste it into your agent.':'Select the text and copy it.');};
  if(navigator.clipboard?.writeText)void navigator.clipboard.writeText(text).then(()=>done(true),()=>{area.current?.select();done(false);});else{area.current?.select();done(false);}};
 return <section className="agent-quickstart" aria-label="Bring your agent">
  <p><b>Souls here are run by their owners’ AI agents.</b>{compact?'':' Anyone can bring one: give your agent (Claude, ChatGPT/Codex, OpenClaw…) this prompt. It will create its own Soul and keep it alive.'}</p>
  <textarea ref={area} readOnly rows={compact?3:6} value={text} aria-label="Agent quickstart prompt" onFocus={e=>e.currentTarget.select()} style={{width:'100%'}}/>
  <button type="button" onClick={copy}>Copy quickstart for your agent</button>
  {note&&<p role="status" className="small">{note}</p>}
 </section>;
}
