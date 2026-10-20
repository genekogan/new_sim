import {useEffect,useMemo,useState} from 'react';
import type {AuthCtx} from './Shell.tsx';
import {authIdentity} from './auth-projection.ts';

// Lane U3 (Gene 2026-10-20b: "sign out doesn't immediately update the UI"). The provider's sign-out (Clerk: a network
// round trip, then its redirect back to this world) takes a moment, and until it finishes every signed-in surface (the
// avatar, New Soul's state, your Souls, God, private panels) kept showing the account. All of them read this one auth, so
// it reads signed-out from the moment Sign out is pressed; a sign-out the provider refuses restores the account.

/** The same session seen as signed out: no account, no token. */
export function signedOutView(auth:AuthCtx):AuthCtx{
 return {...auth,authed:false,label:null,avatarUrl:null,getToken:async()=>null,logout:()=>{},debug:{...auth.debug,privyUserId:null,accountIdentity:null}};
}
/** True while `leaving` (the identity whose Sign out was pressed) is still the provider's signed-in account. */
export const signingOut=(leaving:string|null|undefined,authed:boolean,identity:string|null)=>leaving!==undefined&&authed&&leaving===identity;

export function useSignOutAtOnce(auth:AuthCtx):AuthCtx{
 const [leaving,setLeaving]=useState<string|null|undefined>(undefined);
 const identity=authIdentity(auth),out=signingOut(leaving,auth.authed,identity);
 // the provider caught up (or another account arrived): nothing left to hide
 useEffect(()=>{if(leaving!==undefined&&!out)setLeaving(undefined);},[leaving,out]);
 return useMemo(()=>out?signedOutView(auth):{...auth,logout:(returnUrl?:string)=>{
  setLeaving(identity);
  try{const done=auth.logout(returnUrl);return done&&typeof done.then==='function'?done.catch((e:unknown)=>{setLeaving(undefined);throw e;}):done;}
  catch(e){setLeaving(undefined);throw e;}
 }},[auth,out,identity]);
}
