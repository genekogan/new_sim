import {discoverWorlds,readWorldBootstrap,WorldBootstrapError} from './world-discovery.ts';
import { apiPath, worldPath, worldKey } from './world-path.ts';
import {singleLocalPreview} from './local-navigation.ts';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PrivyProvider, usePrivy } from '@privy-io/react-auth';
import { Shell, type AuthCtx } from './Shell.tsx';
import './styles.css';

// Presentation gate only. Exact reviewed candidate builds may enable it;
// current-owner capability/readiness and server authority remain mandatory.
declare const __SIM_ARRIVAL_ENABLED__: boolean;
const arrivalEnabled=typeof __SIM_ARRIVAL_ENABLED__!=='undefined'&&__SIM_ARRIVAL_ENABLED__===true;

type Cfg = { privyAppId: string; publicUrl: string; worldId: string; authReady: boolean; devAuth: boolean;worldKey?:string;accountAuthRequired?:boolean };

function WithPrivy({ cfg }: { cfg: Cfg }) {
  const p = usePrivy();
  const email = p.user?.email?.address ?? p.user?.google?.email ?? null;
  const auth: AuthCtx = {
    ready: p.ready, authed: p.ready && p.authenticated, label: email ?? p.user?.id ?? null,
    login: () => p.login(), logout: () => p.logout(),
    getToken: async () => (p.ready && p.authenticated ? await p.getAccessToken() : null),
    debug: { privyUserId:p.user?.id??null,wallet:null,linked:[] },
  };
  return <Shell cfg={cfg} auth={auth} arrivalEnabled={arrivalEnabled} />;
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
  if (!cfg.privyAppId) return <Shell cfg={cfg} auth={{ ready: true, authed: false, label: null, login: () => alert('Sign-in is not configured on this server.'), logout: () => {}, getToken: async () => null, debug: { privyUserId: null, wallet: null, linked: [] } }} arrivalEnabled={arrivalEnabled} />;
  return (
    <PrivyProvider appId={cfg.privyAppId} config={{ loginMethods:['google','email'],embeddedWallets: { ethereum: { createOnLogin: 'off' }, showWalletUIs: false }, appearance: { theme: 'dark' } }}>
      <WithPrivy cfg={cfg} />
    </PrivyProvider>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode>{location.pathname==='/'&&!location.hash?<WorldList/>:<WorldRoot/>}</StrictMode>);

function WorldList(){
 const local=singleLocalPreview(location.hostname);
 const [served,setServed]=useState<Set<string>|null>(null);
 useEffect(()=>{let active=true;void discoverWorlds(path=>fetch(path,{signal:AbortSignal.timeout(5000)})).then(worlds=>{if(active)setServed(worlds);});return()=>{active=false;};},[]);
 const card=(key:string,name:string,description:string)=>served?.has(key)?<a href={'/w/'+key}><h2>{name}</h2><p>{description}</p><span>enter world →</span></a>:<article aria-disabled="true" style={{border:'1px solid var(--line)',borderRadius:12,padding:18}}><h2>{name}</h2><p>{description}</p><span className="dim">{served?'Not connected to this site':'Checking connection…'}</span></article>;
 return <main className="world-list"><h1>Sim</h1><p>Persistent worlds. Open one to watch, meet its Souls, or give yours direction.</p><div className="world-cards">{card('eden','Eden','Our shared playground. Meet its Souls and see what develops.')}{card('mars','Mars','The 2026 camp, shared places and pallet-rack construction.')}{card('littlemartians','Little Martians','Floating ceramic characters and enterable glazed buildings.')}</div>{!local&&<p><a href="/l/mars">Mars Lab</a> · <a href="/l/littlemartians">Little Martians snapshot</a> · <a href="/l/eden">Eden snapshot</a></p>}</main>;
}
