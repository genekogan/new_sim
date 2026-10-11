import { apiPath, worldPath, worldKey } from './world-path.ts';
import {singleLocalPreview} from './local-navigation.ts';
import {BASE} from './base-path.ts';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PrivyProvider, usePrivy } from '@privy-io/react-auth';
import {ClerkProvider,useAuth,useClerk,useUser} from '@clerk/clerk-react';
import { Shell, type AuthCtx } from './Shell.tsx';
import './styles.css';
import { LauncherHome, type LauncherList } from './god-ui/LauncherHome.tsx';
import {clerkHomeRoute,clerkOriginRoute,unsignedPreviewAuth} from './auth-ui.ts';
import {publishSession,type Session} from './auth-session.ts';

// Presentation gate only. Exact reviewed candidate builds may enable it;
// current-owner capability/readiness and server authority remain mandatory.
declare const __SIM_ARRIVAL_ENABLED__: boolean;
const arrivalEnabled=typeof __SIM_ARRIVAL_ENABLED__!=='undefined'&&__SIM_ARRIVAL_ENABLED__===true;

type Cfg = { authenticationOrigin?:string; authProvider?:'clerk'|'privy'|'none';clerkPublishableKey?:string;clerkIssuer?:string;privyAppId: string; publicUrl: string; worldId: string; authReady: boolean; devAuth: boolean;worldKey?:string;accountAuthRequired?:boolean };

/** Clerk (production sign-in, live release d357): signed in = a Clerk session bound to this server's account id. */
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
 const auth:AuthCtx={mode:'clerk',ready:session.isLoaded,authed:session.isLoaded&&!!session.isSignedIn&&!!accountId,
  label:profile.user?.primaryEmailAddress?.emailAddress??profile.user?.firstName??null,
  login:()=>{if(session.isSignedIn)setResolveAttempt(n=>n+1);else clerk.openSignIn({afterSignInUrl:location.href,afterSignUpUrl:location.href});},
  logout:()=>clerk.signOut(),getToken:async()=>session.isLoaded&&session.isSignedIn?session.getToken():null,
  debug:{privyUserId:null,accountIdentity:accountId,wallet:null,linked:[]}};
 return <Shell cfg={cfg} auth={auth} arrivalEnabled={arrivalEnabled}/>;
}

function WithPrivy({ cfg }: { cfg: Cfg }) {
  const p = usePrivy();
  const email = p.user?.email?.address ?? p.user?.google?.email ?? null;
  const auth: AuthCtx = {
    mode: 'privy', ready: p.ready, authed: p.ready && p.authenticated, label: email ?? p.user?.id ?? null,
    login: () => p.login(), logout: () => p.logout(),
    getToken: async () => (p.ready && p.authenticated ? await p.getAccessToken() : null),
    debug: { privyUserId: p.user?.id ?? null, wallet: p.user?.wallet ?? null, linked: p.user?.linkedAccounts?.map((a) => ({ type: a.type, ...(('address' in a) ? { address: (a as { address: string }).address } : {}) })) ?? [] },
  };
  return <Shell cfg={cfg} auth={auth} arrivalEnabled={arrivalEnabled} />;
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
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { let tries = 0; const go = () => { fetch(apiPath('/v1/config')).then((r) => { if (!r.ok) throw new Error(`the server answered ${r.status}`); return r.json(); }).then((cfg:Cfg)=>{if((cfg.worldKey&&cfg.worldKey!==worldKey)||(singleLocalPreview(location.hostname)&&worldKey!=='eden'&&cfg.worldKey!==worldKey))throw new Error('This world is not served by the connected preview');setCfg(cfg);}).catch((e) => { if (++tries < 20) setTimeout(go, 3000); else setErr(String(e)); }); }; go(); }, []);
  if (err) return <pre>cannot reach the server: {err}</pre>;
  if (!cfg) return <pre>connecting…</pre>;
  // Clerk is production: never the dev sign-in, whatever the URL says.
  const useDev = cfg.authProvider!=='clerk'&&!cfg.accountAuthRequired&&cfg.devAuth && new URLSearchParams(location.search).has('dev');
  if (useDev || (cfg.authProvider!=='clerk'&&!cfg.accountAuthRequired&&!cfg.privyAppId && cfg.devAuth)) return <WithDev cfg={cfg} />;
  if(cfg.authProvider==='clerk'&&cfg.clerkPublishableKey&&cfg.clerkIssuer){
   const route=clerkOriginRoute(cfg.authenticationOrigin,location.origin,worldPath,location.hash,BASE);
   if(route.initialize)return <ClerkProvider publishableKey={cfg.clerkPublishableKey}><WithClerk cfg={cfg}/></ClerkProvider>;
   const login=()=>{const target=clerkOriginRoute(cfg.authenticationOrigin,location.origin,worldPath,location.hash,BASE).signInUrl;if(target)location.assign(target);};
   return <Shell cfg={cfg} auth={{...unsignedPreviewAuth(route.signInUrl,login),mode:'clerk'}} arrivalEnabled={arrivalEnabled}/>;
  }
  if (cfg.authProvider==='none'||cfg.authProvider==='clerk'||!cfg.privyAppId) return <Shell cfg={cfg} auth={{ ready: true, authed: false, label: null, login: () => alert('Sign-in is not configured on this server.'), logout: () => {}, getToken: async () => null, debug: { privyUserId: null, wallet: null, linked: [] } }} arrivalEnabled={arrivalEnabled} />;
  return (
    <PrivyProvider appId={cfg.privyAppId} config={{ embeddedWallets: { ethereum: { createOnLogin: 'users-without-wallets' }, showWalletUIs: false }, appearance: { theme: 'dark' } }}>
      <WithPrivy cfg={cfg} />
    </PrivyProvider>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode>{location.pathname===BASE+'/'&&!location.hash?<WorldList/>:<WorldRoot/>}</StrictMode>);

function WorldList(){
 const local=singleLocalPreview(location.hostname);
 const [served,setServed]=useState<Set<string>|null>(local?null:new Set(['eden','mars','littlemartians']));
 // Served by the world launcher (tools/world-launcher): its own homepage with New world.
 const [launcher,setLauncher]=useState<LauncherList|null>(null);
 useEffect(()=>{if(!local&&!BASE)return;let active=true;void fetch(BASE+'/__sim/worlds.json').then(r=>r.ok?r.json():null).then(data=>{if(!active)return;if(data?.contract==='local-worlds/1'&&typeof data.launcher==='string'&&Array.isArray(data.worlds)){setLauncher(data);return;}setServed(data?.contract==='local-worlds/1'&&Array.isArray(data.worlds)?new Set(data.worlds.filter((w:{key?:unknown;basePath?:unknown})=>typeof w.key==='string'&&w.basePath==='/w/'+w.key).map((w:{key:string})=>w.key)):new Set(['eden']));}).catch(()=>{if(active)setServed(new Set(['eden']));});return()=>{active=false;};},[local]);
 if(launcher)return <LauncherRoot list={launcher}/>;
 const card=(key:string,name:string,description:string)=>served?.has(key)?<a href={'/w/'+key}><h2>{name}</h2><p>{description}</p><span>enter world →</span></a>:<article aria-disabled="true" style={{border:'1px solid var(--line)',borderRadius:12,padding:18}}><h2>{name}</h2><p>{description}</p><span className="dim">{served?'Not connected to this local preview':'Checking connection…'}</span></article>;
 return <main className="world-list"><h1>Sim</h1><p>Persistent worlds. Open one to watch, meet its Souls, or give yours direction.</p><div className="world-cards">{card('eden','Eden','Our shared playground. Meet its Souls and see what develops.')}{card('mars','Mars','The 2026 camp, shared places and pallet-rack construction.')}{card('littlemartians','Little Martians','Floating ceramic characters and enterable glazed buildings.')}</div>{!local&&<p><a href="/l/mars">Mars Lab</a> · <a href="/l/littlemartians">Little Martians snapshot</a> · <a href="/l/eden">Eden snapshot</a></p>}</main>;
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
