import {discoverWorlds,readWorldBootstrap,WorldBootstrapError} from './world-discovery.ts';
import { apiPath, worldPath, worldKey } from './world-path.ts';
import {singleLocalPreview} from './local-navigation.ts';
import {BASE} from './base-path.ts';
import {installCdnAssets} from './cdn-assets.ts';
import {takeConfigPrefetch} from './snapshot-prefetch.ts';
import {takeInlineConfig} from './inline-config.ts';
import cdnManifestUrl from './cdn-manifest.json?url';
import { StrictMode, Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
const PrivyAuth=lazy(()=>import('./PrivyAuth.tsx'));
import { Shell, type AuthCtx } from './Shell.tsx';
import './styles.css';
import {clerkNow,clerkOriginRoute,unsignedPreviewAuth} from './auth-ui.ts';
// New worlds (world launcher, world engine): the launcher homepage and its sign-in. Old worlds never reach these.
// P1 phones: the homepage (LauncherHome) and Clerk are lazy chunks, off a world page's critical path; a world's Clerk
// loads once its arrival is over (ClerkWorld below).
import type { LauncherList } from './god-ui/LauncherHome.tsx';
import {whenArrivalCardGone} from './arrival-marks.ts';
const LauncherRoot=lazy(()=>import('./LauncherRoot.tsx'));
const ClerkBridge=lazy(()=>import('./ClerkBridge.tsx'));
// The arrival card's bar counts bytes: meter every asset fetch from the start; old worlds know their total up front.
// (old worlds: initial-assets.json, made at release time by apps/web/scripts/initial-assets.mjs; a world without an
// entry still counts in bytes, its total growing from each Content-Length; new worlds: the snapshot's assetBytes)
import {assetBytes,installAssetMeter} from './asset-bytes.ts';
import initialAssets from './initial-assets.json';
import {newWorld} from './world-kind.ts';
import {forkInitialAssets,marsFork} from './mars-fork.ts';
import {BACKDROP_BLOBS,MARS_CAMPUS_URL,prefetchBackdrop} from './backdrop-prefetch.ts';
if(!newWorld)assetBytes.expect(forkInitialAssets((initialAssets as {worlds?:Record<string,Record<string,number>>}).worlds?.[worldKey]??{}));  // MARSLAND-FORK: the Mars fork's own campus

// Presentation gate only. Exact reviewed candidate builds may enable it;
// current-owner capability/readiness and server authority remain mandatory.
declare const __SIM_ARRIVAL_ENABLED__: boolean;
const arrivalEnabled=typeof __SIM_ARRIVAL_ENABLED__!=='undefined'&&__SIM_ARRIVAL_ENABLED__===true;

type Cfg = { authenticationOrigin?:string; authProvider?:'clerk'|'privy'|'none';clerkPublishableKey?:string;clerkIssuer?:string;privyAppId: string; publicUrl: string; worldId: string; authReady: boolean; devAuth: boolean;worldKey?:string;accountAuthRequired?:boolean };


/** A Clerk world page: the Shell renders at once; ClerkBridge (its own chunk, with clerk-js and Clerk's API calls behind
 *  it) mounts beside it once the arrival card has gone, or at once when the page came for a sign-in step (a Clerk
 *  redirect, an approval, a pairing, a join) or the browser is probably signed in. Until then a visitor sees the
 *  signed-out controls (Sign in loads Clerk and opens once it has), a probably-signed-in person "Signing in…".
 *  The Shell is never remounted. */
function ClerkWorld({cfg,publishableKey}:{cfg:Cfg;publishableKey:string}){
 const pending=useRef(false);
 const [now]=useState(()=>clerkNow(location.href,location.hash,document.cookie));
 const [load,setLoad]=useState(now);
 const [auth,setAuth]=useState<AuthCtx>(()=>({mode:'clerk',ready:!now,authed:false,label:null,
  login:()=>{pending.current=true;setLoad(true);},logout:()=>{},getToken:async()=>null,
  debug:{privyUserId:null,accountIdentity:null,wallet:null,linked:[]}}));
 useEffect(()=>{if(load)return;let live=true;void whenArrivalCardGone({timeoutMs:20_000,fadeMs:0}).then(()=>{if(live)setLoad(true);});return()=>{live=false;};},[load]);
 const takePendingLogin=useCallback(()=>{const p=pending.current;pending.current=false;return p;},[]);
 return <>
  <Shell cfg={cfg} auth={auth} arrivalEnabled={arrivalEnabled}/>
  {load&&<Suspense fallback={null}><ClerkBridge publishableKey={publishableKey} issuer={cfg.clerkIssuer} onAuth={setAuth} takePendingLogin={takePendingLogin}/></Suspense>}
 </>;
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
  useEffect(() => { let tries = 0; const go = () => { ((tries === 0 ? takeInlineConfig() ?? takeConfigPrefetch(apiPath('/v1/config')) : null) ?? fetch(apiPath('/v1/config'))).then(r=>readWorldBootstrap(r,worldKey,worldPath)).then(raw=>setCfg(raw as Cfg)).catch((e) => { if (!(e instanceof WorldBootstrapError)&&++tries < 20) setTimeout(go, 3000); else setErr(String(e)); }); }; go(); }, []);
  if (err) return <pre>cannot reach the server: {err}</pre>;
  if (!cfg) return <pre>connecting…</pre>;
  const useDev = cfg.authProvider!=='clerk'&&!cfg.accountAuthRequired&&cfg.devAuth && new URLSearchParams(location.search).has('dev');
  if (useDev || (cfg.authProvider!=='clerk'&&!cfg.accountAuthRequired&&!cfg.privyAppId && cfg.devAuth)) return <WithDev cfg={cfg} />;
  if(cfg.authProvider==='clerk'&&cfg.clerkPublishableKey&&cfg.clerkIssuer){
   const route=clerkOriginRoute(cfg.authenticationOrigin,location.origin,worldPath,hash,BASE);
   if(route.initialize)return <ClerkWorld cfg={cfg} publishableKey={cfg.clerkPublishableKey}/>;
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
if(!newWorld&&worldKey==='mars'&&!marsFork&&!(location.pathname===BASE+'/'&&!location.hash))prefetchBackdrop(BACKDROP_BLOBS[MARS_CAMPUS_URL]!); // W3: campus starts with the page
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
 if(launcher)return <Suspense fallback={<pre>loading…</pre>}><LauncherRoot list={launcher}/></Suspense>;
 const card=(key:string,name:string,description:string)=>served?.has(key)?<a href={'/w/'+key}><h2>{name}</h2><p>{description}</p><span>enter world →</span></a>:<article aria-disabled="true" style={{border:'1px solid var(--line)',borderRadius:12,padding:18}}><h2>{name}</h2><p>{description}</p><span className="dim">{served?'Not connected to this site':'Checking connection…'}</span></article>;
 return <main className="world-list"><h1>Sim</h1><p>Persistent worlds. Open one to watch, meet its Souls, or give yours direction.</p><div className="world-cards">{card('eden','Eden','Our shared playground. Meet its Souls and see what develops.')}{card('mars','Mars','The 2026 camp, shared places and pallet-rack construction.')}{card('littlemartians','Little Martians','Floating ceramic characters and enterable glazed buildings.')}</div>{!local&&<p><a href="/worlds/">New world</a> · <a href="/l/mars">Mars Lab</a> · <a href="/l/littlemartians">Little Martians snapshot</a> · <a href="/l/eden">Eden snapshot</a></p>}</main>;
}
