import {useId,useRef,useState} from 'react';
export type FeedbackContext={worldId:string;soulId:string|null;observedTick:number|null};
type Props={context:FeedbackContext;scope:string};
/** Manual handoff only until a qualified feedback API exists. No automatic
 * journal, direction, account identifier, credential, URL or scene attachment. */
export function FeedbackDraft({context,scope}:Props){
 return <Draft key={JSON.stringify([scope,context.worldId,context.soulId])} context={context}/>;
}
function Draft({context}:Omit<Props,'scope'>){
 const [captured]=useState(context),[text,setText]=useState(''),[notice,setNotice]=useState(''),[fallback,setFallback]=useState(''),[copying,setCopying]=useState(false);
 const observationId=useId(),fallbackId=useId();
 const tick=typeof captured.observedTick==='number'&&Number.isFinite(captured.observedTick)&&captured.observedTick>=0&&captured.observedTick<=Number.MAX_SAFE_INTEGER?String(captured.observedTick):'not available';
 const live=useRef(true);
 // A pending clipboard operation belongs only to this mounted scope.
 // Callback refs run at unmount without requiring a second effect lifecycle.
 const mount=(node:HTMLElement|null)=>{live.current=!!node;};
 async function copy(){
  if(copying||!text.trim())return;setCopying(true);setNotice('');setFallback('');
  const record=`Sim feedback draft\nWorld: ${captured.worldId}\nSoul: ${captured.soulId??'none selected'}\nObserved tick: ${tick}\n\n${text.trim()}`;
  try{await navigator.clipboard.writeText(record);if(live.current)setNotice('Copied. Nothing was sent. You can share this draft with Gene.');}
  catch{if(live.current){setFallback(record);setNotice('Copy did not complete. Select the draft below and copy it yourself. Nothing was sent.');}}
  finally{if(live.current)setCopying(false);}
 }
 return <section ref={mount} aria-label="Feedback draft"><h2>What did you notice?</h2><p>What did you hope would happen, and what did you see? Tell us what delighted or confused you.</p>
  <p className="small dim">This draft includes the selected world, Soul and observed tick. It stays in this panel until you copy it. It does not send feedback.</p>
  <details className="feedback-context"><summary>Context included with your observation</summary><dl className="kv">
    <dt>World</dt><dd>{captured.worldId}</dd><dt>Soul</dt><dd>{captured.soulId??'none selected'}</dd><dt>Observed tick</dt><dd>{tick}</dd>
  </dl></details>
  <label htmlFor={observationId}>Your observation</label><textarea id={observationId} value={text} maxLength={2000} rows={4} onChange={e=>{setText(e.target.value);setNotice('');setFallback('');}}/>
  <button disabled={copying||!text.trim()} onClick={()=>void copy()}>{copying?'Copying…':'Copy feedback draft'}</button>
  {notice&&<p role="status">{notice}</p>}{fallback&&<div><label htmlFor={fallbackId}>Draft to copy</label><textarea id={fallbackId} readOnly value={fallback} rows={8}/></div>}
 </section>;
}
