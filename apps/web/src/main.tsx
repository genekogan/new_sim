import {discoverWorlds,readWorldBootstrap,WorldBootstrapError} from './world-discovery.ts';
import { apiPath, worldPath, worldKey } from './world-path.ts';
import {singleLocalPreview} from './local-navigation.ts';
import {BASE} from './base-path.ts';
import {installCdnAssets} from './cdn-assets.ts';
import {takeConfigPrefetch} from './snapshot-prefetch.ts';
import cdnManifestUrl from './cdn-manifest.json?url';
import { StrictMode, Suspense, lazy, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {ClerkProvider,useAuth,useClerk,useUser} from '@clerk/clerk-react';
const PrivyAuth=lazy(()=>import('./PrivyAuth.tsx'));
import { Shell, type AuthCtx } from './Shell.tsx';
import './styles.css';
import {clerkHomeRoute,clerkOriginRoute,unsignedPreviewAuth} from './auth-ui.ts';
// New worlds (world launcher, world engine): the launcher homepage and its sign-in. Old worlds never reach these.
import { LauncherHome, type LauncherList } from './god-ui/LauncherHome.tsx';
import {publishSession,type Session} from './auth-session.ts';
// The arrival card's bar counts bytes: meter every asset fetch from the start; old worlds know their total up front.
// (old worlds: initial-assets.json, made at release time by apps/web/scripts/initial-assets.mjs; a world without an
// entry still counts in bytes, its total growing from each Content-Length; new worlds: the snapshot's assetBytes)
import {assetBytes,installAssetMeter} from './asset-bytes.ts';
import initialAssets from './initial-assets.json';
import {newWorld} from './world-kind.ts';
import {forkInitialAssets} from './mars-fork.ts';
if(!newWorld)assetBytes.expect(forkInitialAssets((initialAssets as {worlds?:Record<string,Record<string,number>>}).worlds?.[worldKey]??{}));  // MARSLAND-FORK: the Mars fork's own campus

// Presentation gate only. Exact reviewed candidate builds may enable it;
// current-owner capability/readiness and server authority remain mandatory.
declare const __SIM_ARRIVAL_ENABLED__: boolean;
const arrivalEnabled=typeof __SIM_ARRIVAL_ENABLED__!=='undefined'&&__SIM_ARRIVAL_ENABLED__===true;

type Cfg = { authenticationOrigin?:string; authProvider?:'clerk'|'privy'|'none';clerkPublishableKey?:string;clerkIssuer?:string;privyAppId: string; publicUrl: string; worldId: string; authReady: boolean; devAuth: boolean;worldKey?:string;accountAuthRequired?:boolean };


function WithClerk({cfg}:{cfg:Cfg}){
 const session=useAuth(),clerk=useClerk(),profile=useUser();
 const [binding,setBinding]=useState<{accountId:string;issuer:string;subject:string}|null>(null);
 const subject=session.userId,sessionId=session.sessionId;
 const [resolveAttempt,setResolveAttempt]=useState(0);
 useEffect(()=>{
  setBinding(null);if(!session.isLoaded||!session.isSignedIn||!subject)return;
  let active=true;const abort=new AbortController();
  void (async()=>{for(let attempt=0;active&&attempt<5;attempt++){try{const token:string|null=await session.getToken();if(!active||!token)return;
   const response:Response=await fetch(apiPath('/v1/account/session'),{headers:{authorization:'Bearer '+token},signal:abort.signal,cache:'no-store'});
   const value:unknown=await response.json();
   if(active&&response.ok&&value!==null&&typeof value==='object'){const candidate=value as Record<string,unknown>;if(candidate.subject===subject&&typeof candidate.issuer==='string'&&candidate.issuer===cfg.clerkIssuer&&typeof candidate.accountId==='string'&&candidate.accountId.startsWith('acct_')){setBinding({accountId:candidate.accountId,issuer:candidate.issuer,subject});return;}}
  }catch{}if(active)await new Promise<void>(yes=>setTimeout(yes,1000));}})();return()=>{active=false;abort.abort();};
 },[session.isLoaded,session.isSignedIn,subject,sessionId,cfg.clerkIssuer,resolveAttempt]);
 const accountId=binding&&binding.subject===subject&&binding.issuer===cfg.clerkIssuer?binding.accountId:null;
 const currentProfile=profile.user?.id===subject?profile.user:null;
 const auth:AuthCtx={mode:'clerk',ready:session.isLoaded,authed:session.isLoaded&&!!session.isSignedIn&&!!accountId,
  label:currentProfile?.primaryEmailAddress?.emailAddress??currentProfile?.firstName??null,
  login:()=>{if(session.isSignedIn)setResolveAttempt(n=>n+1);else clerk.openSignIn({afterSignInUrl:location.href,afterSignUpUrl:location.href});},
  avatarUrl:currentProfile?.imageUrl??null,logout:(returnUrl)=>clerk.signOut({redirectUrl:returnUrl??location.href}),getToken:async()=>session.isLoaded&&session.isSignedIn?session.getToken():null,
  debug:{privyUserId:null,accountIdentity:accountId,wallet:null,linked:[]}};
 return <Shell cfg={cfg} auth={auth} arrivalEnabled={arrivalEnabled}/>;
}

function WithDev({ cfg }: { cfg: Cfg }) {
  const [name, setName] = useState<string | null>(() => localStorage.getItem('sim.dev'));
  const auth: AuthCtx = {
    mode: 'dev', ready: true, authed: !!name, label: name ? `dev:${name}` : null,
    login: () => { const n = prompt('Local demo name (use the same name when you return)'); if (n) { localStorage.setItem('sim.dev', n); setName(n); } },
    logout: async () => { localStorage.removeItem('sim.dev'); setName(null); },
    getToken: async () => (name ? `dev:${name}` : null),
    debug: { privyUserId: null, wallet: null, linked: [] },
  };
  return <Shell cfg={cfg} auth={auth} arrivalEnabled={arrivalEnabled} />;
}

function WorldRoot() {
  const [hash,setHash]=useState(location.hash);
  useEffect(()=>{const changed=()=>setHash(location.hash);addEventListener('hashchange',changed);return()=>removeEventListener('hashchange',changed);},[]);
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { let tries = 0; const go = () => { (takeConfigPrefetch(apiPath('/v1/config')) ?? fetch(apiPath('/v1/config'))).then(r=>readWorldBootstrap(r,worldKey,worldPath)).then(raw=>setCfg(raw as Cfg)).catch((e) => { if (!(e instanceof WorldBootstrapError)&&++tries < 20) setTimeout(go, 3000); else setErr(String(e)); }); }; go(); }, []);
  if (err) return <pre>cannot reach the server: {err}</pre>;
  if (!cfg) return <pre>connecting…</pre>;
  const useDev = cfg.authProvider!=='clerk'&&!cfg.accountAuthRequired&&cfg.devAuth && new URLSearchParams(location.search).has('dev');
  if (useDev || (cfg.authProvider!=='clerk'&&!cfg.accountAuthRequired&&!cfg.privyAppId && cfg.devAuth)) return <WithDev cfg={cfg} />;
  if(cfg.authProvider==='clerk'&&cfg.clerkPublishableKey&&cfg.clerkIssuer){
   const route=clerkOriginRoute(cfg.authenticationOrigin,location.origin,worldPath,hash,BASE);
   if(route.initialize)return <ClerkProvider publishableKey={cfg.clerkPublishableKey}><WithClerk cfg={cfg}/></ClerkProvider>;
   const login=()=>{const target=clerkOriginRoute(cfg.authenticationOrigin,location.origin,worldPath,location.hash,BASE).signInUrl;if(target)location.assign(target);};
   return <Shell cfg={cfg} auth={{...unsignedPreviewAuth(route.signInUrl,login),mode:'clerk'}} arrivalEnabled={arrivalEnabled}/>;
  }
  if (cfg.authProvider==='none'||cfg.authProvider==='clerk'||!cfg.privyAppId) return <Shell cfg={cfg} auth={{ ready: true, authed: false, label: null, login: () => alert('Sign-in is not configured on this server.'), logout: () => {}, getToken: async () => null, debug: { privyUserId: null, wallet: null, linked: [] } }} arrivalEnabled={arrivalEnabled} />;
  return <Suspense fallback={<pre>connecting sign-in…</pre>}><PrivyAuth cfg={cfg} arrivalEnabled={arrivalEnabled}/></Suspense>;
}

// A large CDN file is buffered for its hash check: report its bytes to the arrival bar while they stream in.
// Lane W1: render at once; the CDN transport is in place before the first asset fetch (asset fetches wait for the
// manifest, nothing else does), so the manifest GET is no longer a round trip before the page starts.
installCdnAssets(cdnManifestUrl,(url,loaded)=>assetBytes.progress(url,loaded));
installAssetMeter(); // meter the original asset URL, including its CDN attempt and origin fallback
createRoot(document.getElementById('root')!).render(<StrictMode>{location.pathname===BASE+'/'&&!location.hash?<WorldList/>:<WorldRoot/>}</StrictMode>);

function WorldList(){
 const local=singleLocalPreview(location.hostname);
 const [served,setServed]=useState<Set<string>|null>(null);
 // Served by the world launcher (tools/world-launcher; a prefixed build or a local preview): its own homepage with New
 // world. The production root (sim.eden.art/) never probes for it and stays main's (e8) world list.
 const [launcher,setLauncher]=useState<LauncherList|null>(null);
 useEffect(()=>{let active=true;void (async()=>{
  if(BASE||local){try{const r=await fetch(BASE+'/__sim/worlds.json',{signal:AbortSignal.timeout(5000)});const data=r.ok&&r.headers.get('content-type')?.includes('application/json')?await r.json():null;if(data?.contract==='local-worlds/1'&&typeof data.launcher==='string'&&Array.isArray(data.worlds)){if(active)setLauncher(data);return;}}catch{/* not a launcher: the world list below */}}
  const worlds=await discoverWorlds(path=>fetch(path,{signal:AbortSignal.timeout(5000)}));if(active)setServed(worlds);
 })();return()=>{active=false;};},[local]);
 if(launcher)return <LauncherRoot list={launcher}/>;
 const card=(key:string,name:string,description:string)=>served?.has(key)?<a href={'/w/'+key}><h2>{name}</h2><p>{description}</p><span>enter world →</span></a>:<article aria-disabled="true" style={{border:'1px solid var(--line)',borderRadius:12,padding:18}}><h2>{name}</h2><p>{description}</p><span className="dim">{served?'Not connected to this site':'Checking connection…'}</span></article>;
 return <main className="world-list"><h1>Sim</h1><p>Persistent worlds. Open one to watch, meet its Souls, or give yours direction.</p><div className="world-cards">{card('eden','Eden','Our shared playground. Meet its Souls and see what develops.')}{card('mars','Mars','The 2026 camp, shared places and pallet-rack construction.')}{card('littlemartians','Little Martians','Floating ceramic characters and enterable glazed buildings.')}</div>{!local&&<p><a href="/worlds/">New world</a> · <a href="/l/mars">Mars Lab</a> · <a href="/l/littlemartians">Little Martians snapshot</a> · <a href="/l/eden">Eden snapshot</a></p>}</main>;
}

/** The launcher homepage: Clerk when the launcher serves Clerk worlds (creating a world needs a signed-in creator), else the local name. */
function LauncherRoot({list}:{list:LauncherList}){
 const a=list.auth;
 if(a?.provider==='clerk'&&a.clerkPublishableKey){
  const route=clerkHomeRoute(a.authenticationOrigin,location.origin,BASE);
  if(route.initialize)return <ClerkProvider publishableKey={a.clerkPublishableKey}><HomeClerk list={list}/></ClerkProvider>;
  return <HomeWith list={list} session={{mode:'clerk',ready:true,authed:false,label:null,signInUrl:route.signInUrl??undefined,getToken:async()=>null,login:()=>{if(route.signInUrl)location.assign(route.signInUrl);},logout:()=>{}}}/>;
 }
 const name=localStorage.getItem('sim.dev');
 return <HomeWith list={list} session={{mode:'dev',ready:true,authed:!!name,label:name,getToken:async()=>name?'dev:'+name:null,login:()=>{},logout:()=>{localStorage.removeItem('sim.dev');location.reload();}}}/>;
}
function HomeWith({list,session}:{list:LauncherList;session:Session}){
 useEffect(()=>{publishSession(session);});
 return <LauncherHome initial={list}/>;
}
function HomeClerk({list}:{list:LauncherList}){
 const session=useAuth(),clerk=useClerk(),profile=useUser();
 return <HomeWith list={list} session={{mode:'clerk',ready:session.isLoaded,authed:session.isLoaded&&!!session.isSignedIn,label:profile.user?.primaryEmailAddress?.emailAddress??profile.user?.firstName??null,
  getToken:async()=>session.isLoaded&&session.isSignedIn?session.getToken({skipCache:true}):null,
  login:()=>clerk.openSignIn({afterSignInUrl:location.href,afterSignUpUrl:location.href}),logout:()=>clerk.signOut()}}/>;
}
