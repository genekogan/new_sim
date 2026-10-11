import {useEffect,useRef,useState} from 'react';
import {publicSoulLink} from './soul-link.ts';
import {worldPath} from './world-path.ts';
import {BASE} from './base-path.ts';

export function PublicSoulLink({id}:{id:string}){
  const link=publicSoulLink(location.origin,worldPath,id,BASE);
  const [message,setMessage]=useState('');const live=useRef(true);
  useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
  return <details className="public-soul-link"><summary>Share Soul</summary>
    <p>Send a friend this Soul’s live public view. The link grants no ownership or private access.</p>
    <input aria-label="Public Soul link" value={link} readOnly onFocus={e=>e.currentTarget.select()}/>
    <button onClick={async()=>{try{await navigator.clipboard.writeText(link);if(live.current)setMessage('Public link copied.');}catch{if(live.current)setMessage('Copy unavailable. Select the link above to copy it.');}}}>Copy public link</button>
    {message&&<p role="status">{message}</p>}
  </details>;
}
