// LINK Pairing (spec §4, Gene 2026-10-24: "the card is the approval"): one page-wide record of the approval request shown
// in this window and of whether a Soul card is open. The god panel still forces the request up in the browser's top layer
// (lanes HF/PUX) when no card is open; while a card is open the card itself turns into the Pairing card, so a second dialog
// is never drawn over an open Soul card. Nothing here confers authority: the card reads the request from the server.
import {useEffect,useState} from 'react';

export type ShownApproval={id:string;done():void};
let shown:ShownApproval|null=null,openCards=0;
const subs=new Set<()=>void>();
const tell=()=>{for(const f of subs)f();};
/** The god panel's current request for this window (null: none). `done` closes it for this window, as its × did. */
export function offerApproval(next:ShownApproval|null){
 if(shown?.id===next?.id&&shown?.done===next?.done)return;
 const changed=shown?.id!==next?.id;shown=next;if(changed)tell();
}
export const shownApproval=()=>shown;
export const cardOpen=()=>openCards>0;
function useSubscribe(){const [,set]=useState(0);useEffect(()=>{const f=()=>set(n=>n+1);subs.add(f);return()=>{subs.delete(f);};},[]);}
/** A Soul card registers while it is visible. */
export function useCardOpen(open:boolean){
 useEffect(()=>{if(!open)return;openCards++;tell();return()=>{openCards--;tell();};},[open]);
}
/** For the god panel: is a card open (then it draws no dialog of its own)? */
export function useCardIsOpen(){useSubscribe();return cardOpen();}
/** For the card: the request it should turn into, if any. */
export function useShownApproval(){useSubscribe();return shown;}
