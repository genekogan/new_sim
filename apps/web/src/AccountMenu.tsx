import {useEffect,useLayoutEffect,useRef,useState} from 'react';import type {ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {copyText,manualCopyHint} from './clipboard.ts';
import {requestFeedback,FEEDBACK_LABEL} from './feedback-request.ts';
export type AccountMenuAuth={ready:boolean;authed:boolean;label:string|null;avatarUrl?:string|null;signInUrl?:string;login():void;logout(returnUrl?:string):Promise<void>|void};
/** Explicit auth-off worlds retain their existing creation entry; required auth never falls back. */
export function WorldAccountControls({signinEnabled,accountAuthRequired,auth,newSoul,inviteUrl}:{signinEnabled:boolean;accountAuthRequired?:boolean;auth:AccountMenuAuth;newSoul?:ReactNode;inviteUrl?:string}){return signinEnabled?<AccountMenu auth={auth} newSoul={newSoul} inviteUrl={inviteUrl}/>:<>{accountAuthRequired!==true&&newSoul}</>;}
/** Lane U2: Feedback lives in a menu, never as its own button: the account menu when signed in. Lane U3 (Gene
 * 2026-10-20b): signed out there is no More (⋯) menu beside Sign in any more; phones' HUD More menu still offers it. */
export function FeedbackItem(){return <button type="button" data-feedback-open="" onClick={requestFeedback}>{FEEDBACK_LABEL}</button>;}
/** A <details> menu that closes on an item, a click outside, Escape or focus leaving it. */
function MenuDetails({className,summary,children}:{className:string;summary:ReactNode;children:ReactNode}){
 const menu=useRef<HTMLDetailsElement>(null);
 useEffect(()=>{
  const outside=(e:PointerEvent)=>{if(menu.current?.open&&!menu.current.contains(e.target as Node))menu.current.open=false;};
  const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'&&menu.current?.open){menu.current.open=false;menu.current.querySelector('summary')?.focus();}};
  document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
  return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};
 },[]);
 return <details ref={menu} className={className} onBlur={e=>{if(e.relatedTarget instanceof Node&&!e.currentTarget.contains(e.relatedTarget))e.currentTarget.open=false;}}>
  {summary}
  <div className="account-menu-items" onClick={e=>{if((e.target as Element).closest('button,a')&&menu.current)menu.current.open=false;}}>{children}</div>
 </details>;
}
/** Sign-out returns to the exact world route/view, never the provider's root default. */
export function worldSignOutReturnUrl(location:Pick<Location,'origin'|'pathname'|'search'|'hash'>){return location.origin+location.pathname+location.search+location.hash;}
/** Lane U3 (Gene 2026-10-20b): New Soul is always its own button, left of the profile picture (or of Sign in). */
export function AccountMenu({auth,newSoul,inviteUrl}:{auth:AccountMenuAuth;newSoul?:ReactNode;inviteUrl?:string}){
 if(!auth.ready)return <span className="dim">Signing in…</span>;
 if(!auth.authed)return <>{newSoul}{auth.signInUrl?<a className="account-sign-in" href={auth.signInUrl}>Sign in</a>:<button type="button" className="account-sign-in" onClick={auth.login}>Sign in</button>}</>;
 return <>{newSoul}<MenuDetails className="account-menu" summary={<summary className="account-avatar" aria-label="Account menu" title={auth.label??'Your account'}>{auth.avatarUrl?<img src={auth.avatarUrl} alt="" referrerPolicy="no-referrer"/>:<span aria-hidden="true">{auth.label?.trim()[0]?.toUpperCase()??'●'}</span>}</summary>}>
  {inviteUrl&&<InviteLink url={inviteUrl}/>}<FeedbackItem/><button type="button" onClick={()=>{void auth.logout(worldSignOutReturnUrl(location));}}>Sign out</button>
 </MenuDetails></>;
}
/** The copied link and its outcome stay visible after the account menu closes. */
function InviteLink({url}:{url:string}){
 const [open,setOpen]=useState(false),[result,setResult]=useState<boolean|null>(null);
 const dialog=useRef<HTMLDialogElement>(null),text=useRef<HTMLTextAreaElement>(null);
 useLayoutEffect(()=>{if(!open)return;dialog.current?.showModal();return()=>{dialog.current?.close();document.querySelector<HTMLElement>('.account-avatar')?.focus();};},[open]);
 useLayoutEffect(()=>{if(open&&result===false){text.current?.focus();text.current?.select();}},[open,result]);
 const copy=()=>{setOpen(true);setResult(null);void copyText(url).then(setResult);};
 return <><button type="button" data-join-link={url} title={url} onClick={copy}>Copy invite link</button>{open&&createPortal(<dialog ref={dialog} className="bring-agent invite-link-dialog" aria-labelledby="invite-link-title" onCancel={()=>setOpen(false)} onPointerDown={e=>{const b=e.currentTarget.getBoundingClientRect();if(e.target===e.currentTarget&&(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom))setOpen(false);}}>
  <button className="bring-agent-close" type="button" aria-label="Close invite link" onClick={()=>setOpen(false)}>×</button><h2 id="invite-link-title">Invite a friend</h2>
  <p>This link opens New Soul in this world.</p><textarea ref={text} aria-label="Invite link" readOnly rows={3} value={url}/>
  <div className="bring-agent-row"><button type="button" className="primary" onClick={copy}>Copy link</button><span role="status">{result===null?'Copying…':result?'Link copied.':manualCopyHint}</span></div>
 </dialog>,document.body)}</>;
}
