import {soulFromFragment,soulFragment} from './soul-link.ts';
/** Sign-in is part of the shared world chrome; public viewing remains unsigned (live release d357). */
export const AUTH_UI=true;
export function configuredSignIn(cfg:{authProvider?:'clerk'|'privy'|'none';privyAppId?:string;clerkPublishableKey?:string;clerkIssuer?:string;devAuth?:boolean}){
 if(cfg.authProvider==='none')return false;
 // world-engine branch: local dev sign-in (dev auth, no provider) shows the same Sign in button
 return cfg.authProvider==='clerk'?!!cfg.clerkPublishableKey&&!!cfg.clerkIssuer:!!cfg.privyAppId||!!cfg.devAuth;
}

/** Raw-world bootstrap prompt; full runtime instructions live in the installed skill. */
export function agentOnboarding(worldUrl:string,worldName?:string){
 const base=worldUrl.replace(/\/+$/,''),key=new URL(base).pathname.match(/^\/w\/(toy|mars|littlemartians|eden)(?:\/|$)/)?.[1];
 const world=worldName??(key==='littlemartians'?'Little Martians':key?key[0].toUpperCase()+key.slice(1):'Eden');
 const instructionsUrl=base+'/instructions.md';
 return {world,instructionsUrl,text:`Read the instructions at ${instructionsUrl} to create a new soul in the world ${world}.`};
}
export function agentQuickstart(worldUrl:string,worldName?:string):string{return agentOnboarding(worldUrl,worldName).text;}

/** Authentication comes from server configuration, never request-derived publicUrl (d357).
 * World-engine branch: any launcher world slug, and a god pairing link (#godpair/CODE) survives the hop. */
export function clerkOriginRoute(authenticationOrigin:string|undefined,currentOrigin:string,path:string,hash=''){
 let origin:URL;try{origin=new URL(authenticationOrigin??'');}catch{return {initialize:false,signInUrl:null};}
 if(origin.origin!==authenticationOrigin||origin.username||origin.password||!['https:','http:'].includes(origin.protocol)||origin.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(origin.hostname)||!/^\/w\/[a-z][a-z0-9-]{0,31}\/?$/.test(path))return {initialize:false,signInUrl:null};
 const soul=soulFromFragment(hash);
 const fragment=/^#approve\/ap_[a-f0-9]{32}$/.test(hash)||/^#godpair\/[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(hash)?hash:soul?'#'+soulFragment(soul):hash==='#join'?'#join':'#watch';
 return {initialize:currentOrigin===origin.origin,signInUrl:origin.origin+path.replace(/\/$/,'')+fragment};
}
/** The homepage (`/`, served by the launcher) mounts Clerk only on the configured origin too. */
export function clerkHomeRoute(authenticationOrigin:string|undefined,currentOrigin:string){
 let origin:URL;try{origin=new URL(authenticationOrigin??'');}catch{return {initialize:false,signInUrl:null};}
 if(origin.origin!==authenticationOrigin||origin.username||origin.password||!['https:','http:'].includes(origin.protocol)||origin.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(origin.hostname))return {initialize:false,signInUrl:null};
 return {initialize:currentOrigin===origin.origin,signInUrl:origin.origin+'/'};
}
export function unsignedPreviewAuth(signInUrl:string|null,login:()=>void){return {ready:true,authed:false,label:null,signInUrl:signInUrl??undefined,login,logout:()=>{},getToken:async()=>null,debug:{privyUserId:null,wallet:null,linked:[]}};}
