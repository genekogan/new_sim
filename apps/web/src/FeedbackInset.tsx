import {useState} from 'react';
import {FeedbackDraft,type FeedbackContext} from './FeedbackDraft.tsx';
/** Opening the disclosure captures public context. Closing or leaving this
 * human panel drops the manual draft rather than keeping a hidden form alive. */
export function FeedbackInset({context,scope,active}:{context:FeedbackContext;scope:string;active:boolean}){
 if(!active)return null;
 return <Disclosure key={JSON.stringify([scope,context.worldId,context.soulId])} context={context} scope={scope}/>;
}
function Disclosure({context,scope}:{context:FeedbackContext;scope:string}){
 const [open,setOpen]=useState(false);
 return <details onToggle={event=>setOpen(event.currentTarget.open)}>
  <summary>Share an observation</summary>
  {open&&<FeedbackDraft context={context} scope={scope}/>}
 </details>;
}
