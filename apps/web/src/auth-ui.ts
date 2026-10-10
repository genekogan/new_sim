import {approvalFromHash} from './account-approval.ts';
import {soulFromFragment,soulFragment} from './soul-link.ts';
/** Sign-in is part of the shared world chrome; public viewing remains unsigned. */
export const AUTH_UI=true;
export function configuredSignIn(cfg:{authProvider?:'clerk'|'privy'|'none';privyAppId?:string;clerkPublishableKey?:string;clerkIssuer?:string}){
 if(cfg.authProvider==='none')return false;
 return cfg.authProvider==='clerk'?!!cfg.clerkPublishableKey&&!!cfg.clerkIssuer:!!cfg.privyAppId;
}

/** Raw-world bootstrap prompt; full runtime instructions live in the installed skill. */
export function agentOnboarding(worldUrl:string,worldName?:string){
 const base=worldUrl.replace(/\/+$/,''),key=new URL(base).pathname.match(/^\/w\/(toy|mars|littlemartians|eden)(?:\/|$)/)?.[1];
 const world=worldName??(key==='littlemartians'?'Little Martians':key?key[0].toUpperCase()+key.slice(1):'Eden');
 const instructionsUrl=base+'/instructions.md';
 return {world,instructionsUrl,text:`Read the instructions at ${instructionsUrl} to create a new soul in the world ${world}.`};
}
export function agentQuickstart(worldUrl:string,worldName?:string):string{return agentOnboarding(worldUrl,worldName).text;}

/** Authentication comes from server configuration, never request-derived publicUrl. */
export function clerkOriginRoute(authenticationOrigin:string|undefined,currentOrigin:string,path:string,hash=''){
 let origin:URL;try{origin=new URL(authenticationOrigin??'');}catch{return {initialize:false,signInUrl:null};}
 if(origin.origin!==authenticationOrigin||origin.username||origin.password||!['https:','http:'].includes(origin.protocol)||origin.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(origin.hostname)||!/^\/w\/(eden|mars|littlemartians|toy)\/?$/.test(path))return {initialize:false,signInUrl:null};
 const approval=approvalFromHash(hash),soul=soulFromFragment(hash);
 const fragment=approval?'#approve/'+approval:soul?'#'+soulFragment(soul):hash==='#join'?'#join':'#watch';
 return {initialize:currentOrigin===origin.origin,signInUrl:origin.origin+path.replace(/\/$/,'')+fragment};
}
export function unsignedPreviewAuth(signInUrl:string|null,login:()=>void){return {ready:true,authed:false,label:null,signInUrl:signInUrl??undefined,login,logout:()=>{},getToken:async()=>null,debug:{privyUserId:null,wallet:null,linked:[]}};}
