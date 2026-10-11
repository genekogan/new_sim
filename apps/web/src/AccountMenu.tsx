import {useRef,useState} from 'react';import type {ReactNode} from 'react';
export type AccountMenuAuth={ready:boolean;authed:boolean;label:string|null;avatarUrl?:string|null;signInUrl?:string;login():void;logout(returnUrl?:string):Promise<void>|void};
/** Explicit auth-off worlds retain their existing creation entry; required auth never falls back. */
export function WorldAccountControls({signinEnabled,accountAuthRequired,auth,newSoul,inviteUrl}:{signinEnabled:boolean;accountAuthRequired?:boolean;auth:AccountMenuAuth;newSoul?:ReactNode;inviteUrl?:string}){return signinEnabled?<AccountMenu auth={auth} newSoul={newSoul} inviteUrl={inviteUrl}/>:accountAuthRequired!==true?<>{newSoul}</>:null;}
/** Sign-out returns to the exact world route/view, never the provider's root default. */
export function worldSignOutReturnUrl(location:Pick<Location,'origin'|'pathname'|'search'|'hash'>){return location.origin+location.pathname+location.search+location.hash;}
export function AccountMenu({auth,newSoul,inviteUrl}:{auth:AccountMenuAuth;newSoul?:ReactNode;inviteUrl?:string}){
 const menu=useRef<HTMLDetailsElement>(null);
 if(!auth.ready)return <span className="dim">Signing in…</span>;
 if(!auth.authed)return <>{auth.signInUrl?<a className="account-sign-in" href={auth.signInUrl}>Sign in</a>:<button type="button" className="account-sign-in" onClick={auth.login}>Sign in</button>}{newSoul}</>;
 return <details ref={menu} className="account-menu" onKeyDown={e=>{if(e.key==='Escape'&&menu.current){menu.current.open=false;menu.current.querySelector('summary')?.focus();}}} onBlur={e=>{if(e.relatedTarget instanceof Node&&!e.currentTarget.contains(e.relatedTarget)&&!document.querySelector('.bring-agent-scrim'))e.currentTarget.open=false;}}>
  <summary className="account-avatar" aria-label="Account menu" title={auth.label??'Your account'}>{auth.avatarUrl?<img src={auth.avatarUrl} alt="" referrerPolicy="no-referrer"/>:<span aria-hidden="true">{auth.label?.trim()[0]?.toUpperCase()??'●'}</span>}</summary>
  <div className="account-menu-items">{newSoul}{inviteUrl&&<InviteLink url={inviteUrl}/>}<button type="button" onClick={()=>{if(menu.current)menu.current.open=false;void auth.logout(worldSignOutReturnUrl(location));}}>Sign out</button></div>
 </details>;
}
/** New worlds: one item that copies the link friends open to join (it lands on New Soul, #join). */
function InviteLink({url}:{url:string}){
 const [copied,setCopied]=useState(false);
 return <button type="button" data-join-link={url} title={url} onClick={()=>{void navigator.clipboard?.writeText(url).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),2000);},()=>{});}}>{copied?'Link copied':'Copy invite link'}</button>;
}
