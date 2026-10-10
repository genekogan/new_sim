import {discoverWorlds,readWorldBootstrap,WorldBootstrapError} from './world-discovery.ts';
import { apiPath, worldPath, worldKey } from './world-path.ts';
import {singleLocalPreview} from './local-navigation.ts';
import { StrictMode, Suspense, lazy, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {ClerkProvider,useAuth,useClerk,useUser} from '@clerk/clerk-react';
const PrivyAuth=lazy(()=>import('./PrivyAuth.tsx'));
import { Shell, type AuthCtx } from './Shell.tsx';
import './styles.css';

// Presentation gate only. Exact reviewed candidate builds may enable it;
// current-owner capability/readiness and server authority remain mandatory.
declare const __SIM_ARRIVAL_ENABLED__: boolean;
const arrivalEnabled=typeof __SIM_ARRIVAL_ENABLED__!=='undefined'&&__SIM_ARRIVAL_ENABLED__===true;

type Cfg = { authProvider?:'clerk'|'privy'|'none';clerkPublishableKey?:string;clerkIssuer?:string;privyAppId: string; publicUrl: string; worldId: string; authReady: boolean; devAuth: boolean;worldKey?:string;accountAuthRequired?:boolean };


function WithClerk({cfg}:{cfg:Cfg}){
 const session=useAuth(),clerk=useClerk(),profile=useUser();
 const [binding,setBinding]=useState<{accountId:string;issuer:string;subject:string}|null>(null);
 const subject=session.userId,sessionId=session.sessionId;
 const [resolveAttempt,setResolveAttempt]=useState(0);
 useEffect(()=>{
  setBinding(null);if(!session.isLoaded||!session.isSignedIn||!subject)return;
  let active=true;const abort=new AbortController();
  void (async()=>{for(let attempt=0;active&&attempt<5;attempt++){try{const token=await session.getToken();if(!active||!token)return;
   const response=await fetch(apiPath('/v1/account/session'),{headers:{authorization:'Bearer '+token},signal:abort.signal,cache:'no-store'});
   const value=await response.json();if(active&&response.ok&&value.subject===subject&&value.issuer===cfg.clerkIssuer&&typeof value.accountId==='string'&&value.accountId.startsWith('acct_')){setBinding(value);return;}
  }catch{}if(active)await new Promise<void>(yes=>setTimeout(yes,1000));}})();return()=>{active=false;abort.abort();};
 },[session.isLoaded,session.isSignedIn,subject,sessionId,cfg.clerkIssuer,resolveAttempt]);
 const accountId=binding&&binding.subject===subject&&binding.issuer===cfg.clerkIssuer?binding.accountId:null;
 const auth:AuthCtx={ready:session.isLoaded,authed:session.isLoaded&&!!session.isSignedIn&&!!accountId,
  label:profile.user?.primaryEmailAddress?.emailAddress??profile.user?.firstName??null,
  login:()=>{if(session.isSignedIn)setResolveAttempt(n=>n+1);else clerk.openSignIn({afterSignInUrl:location.href,afterSignUpUrl:location.href});},
  logout:()=>clerk.signOut(),getToken:async()=>session.isLoaded&&session.isSignedIn?session.getToken():null,
  debug:{privyUserId:null,accountIdentity:accountId,wallet:null,linked:[]}};
 return <Shell cfg={cfg} auth={auth} arrivalEnabled={arrivalEnabled}/>;
}

function WithDev({ cfg }: { cfg: Cfg }) {
  const [name, setName] = useState<string | null>(() => localStorage.getItem('sim.dev'));
  const auth: AuthCtx = {
    ready: true, authed: !!name, label: name ? `dev:${name}` : null,
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
  useEffect(() => { let tries = 0; const go = () => { fetch(apiPath('/v1/config')).then(r=>readWorldBootstrap(r,worldKey)).then(raw=>setCfg(raw as Cfg)).catch((e) => { if (!(e instanceof WorldBootstrapError)&&++tries < 20) setTimeout(go, 3000); else setErr(String(e)); }); }; go(); }, []);
  if (err) return <pre>cannot reach the server: {err}</pre>;
  if (!cfg) return <pre>connecting…</pre>;
  const useDev = !cfg.accountAuthRequired&&cfg.devAuth && new URLSearchParams(location.search).has('dev');
  if (useDev || (!cfg.accountAuthRequired&&!cfg.privyAppId && cfg.devAuth)) return <WithDev cfg={cfg} />;
  if(cfg.authProvider==='clerk'&&cfg.clerkPublishableKey&&cfg.clerkIssuer)return <ClerkProvider publishableKey={cfg.clerkPublishableKey}><WithClerk cfg={cfg}/></ClerkProvider>;
  if (cfg.authProvider==='none'||cfg.authProvider==='clerk'||!cfg.privyAppId) return <Shell cfg={cfg} auth={{ ready: true, authed: false, label: null, login: () => alert('Sign-in is not configured on this server.'), logout: () => {}, getToken: async () => null, debug: { privyUserId: null, wallet: null, linked: [] } }} arrivalEnabled={arrivalEnabled} />;
  return <Suspense fallback={<pre>connecting sign-in…</pre>}><PrivyAuth cfg={cfg} arrivalEnabled={arrivalEnabled}/></Suspense>;
}

createRoot(document.getElementById('root')!).render(<StrictMode>{location.pathname==='/'&&!location.hash?<WorldList/>:<WorldRoot/>}</StrictMode>);

function WorldList(){
 const local=singleLocalPreview(location.hostname);
 const [served,setServed]=useState<Set<string>|null>(null);
 useEffect(()=>{let active=true;void discoverWorlds(path=>fetch(path,{signal:AbortSignal.timeout(5000)})).then(worlds=>{if(active)setServed(worlds);});return()=>{active=false;};},[]);
 const card=(key:string,name:string,description:string)=>served?.has(key)?<a href={'/w/'+key}><h2>{name}</h2><p>{description}</p><span>enter world →</span></a>:<article aria-disabled="true" style={{border:'1px solid var(--line)',borderRadius:12,padding:18}}><h2>{name}</h2><p>{description}</p><span className="dim">{served?'Not connected to this site':'Checking connection…'}</span></article>;
 return <main className="world-list"><h1>Sim</h1><p>Persistent worlds. Open one to watch, meet its Souls, or give yours direction.</p><div className="world-cards">{card('eden','Eden','Our shared playground. Meet its Souls and see what develops.')}{card('mars','Mars','The 2026 camp, shared places and pallet-rack construction.')}{card('littlemartians','Little Martians','Floating ceramic characters and enterable glazed buildings.')}</div>{!local&&<p><a href="/l/mars">Mars Lab</a> · <a href="/l/littlemartians">Little Martians snapshot</a> · <a href="/l/eden">Eden snapshot</a></p>}</main>;
}
