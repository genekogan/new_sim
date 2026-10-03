import { apiPath, worldPath } from './world-path.ts';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PrivyProvider, usePrivy } from '@privy-io/react-auth';
import { Shell, type AuthCtx } from './Shell.tsx';
import './styles.css';

type Cfg = { privyAppId: string; publicUrl: string; worldId: string; authReady: boolean; devAuth: boolean };

function WithPrivy({ cfg }: { cfg: Cfg }) {
  const p = usePrivy();
  const email = p.user?.email?.address ?? p.user?.google?.email ?? null;
  const auth: AuthCtx = {
    ready: p.ready, authed: p.ready && p.authenticated, label: email ?? p.user?.id ?? null,
    login: () => p.login(), logout: () => p.logout(),
    getToken: async () => (p.ready && p.authenticated ? await p.getAccessToken() : null),
    debug: { privyUserId: p.user?.id ?? null, wallet: p.user?.wallet ?? null, linked: p.user?.linkedAccounts?.map((a) => ({ type: a.type, ...(('address' in a) ? { address: (a as { address: string }).address } : {}) })) ?? [] },
  };
  return <Shell cfg={cfg} auth={auth} />;
}

function WithDev({ cfg }: { cfg: Cfg }) {
  const [name, setName] = useState<string | null>(() => localStorage.getItem('sim.dev'));
  const auth: AuthCtx = {
    ready: true, authed: !!name, label: name ? `dev:${name}` : null,
    login: () => { const n = prompt('dev user name (dev auth is on; "admin" is an admin)'); if (n) { localStorage.setItem('sim.dev', n); setName(n); } },
    logout: async () => { localStorage.removeItem('sim.dev'); setName(null); },
    getToken: async () => (name ? `dev:${name}` : null),
    debug: { privyUserId: null, wallet: null, linked: [] },
  };
  return <Shell cfg={cfg} auth={auth} />;
}

function WorldRoot() {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { let tries = 0; const go = () => { fetch(apiPath('/v1/config')).then((r) => { if (!r.ok) throw new Error(`the server answered ${r.status}`); return r.json(); }).then(setCfg).catch((e) => { if (++tries < 20) setTimeout(go, 3000); else setErr(String(e)); }); }; go(); }, []);
  if (err) return <pre>cannot reach the server: {err}</pre>;
  if (!cfg) return <pre>connecting…</pre>;
  const useDev = cfg.devAuth && new URLSearchParams(location.search).has('dev');
  if (useDev || (!cfg.privyAppId && cfg.devAuth)) return <WithDev cfg={cfg} />;
  if (!cfg.privyAppId) return <Shell cfg={cfg} auth={{ ready: true, authed: false, label: null, login: () => alert('Sign-in is not configured on this server.'), logout: () => {}, getToken: async () => null, debug: { privyUserId: null, wallet: null, linked: [] } }} />;
  return (
    <PrivyProvider appId={cfg.privyAppId} config={{ embeddedWallets: { ethereum: { createOnLogin: 'users-without-wallets' }, showWalletUIs: false }, appearance: { theme: 'dark' } }}>
      <WithPrivy cfg={cfg} />
    </PrivyProvider>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode>{location.pathname === '/' && !location.hash ? <WorldList /> : <WorldRoot />}</StrictMode>);

function WorldList() {
  return <main className="world-list"><h1>Sim</h1><p>Persistent worlds. Open one to watch, meet its Souls, or give yours direction.</p><div className="world-cards">
    <a href="/w/mars"><h2>Mars</h2><p>A camp of people, shared places and things to do.</p><span>enter world →</span></a>
    <a href="/w/toy"><h2>Toy</h2><p>The original world, still living.</p><span>enter world →</span></a>
    <article><h2>Little Martians</h2><p>Floating ceramic characters and enterable glazed buildings.</p><a href="/buildings">see the first buildings →</a></article>
    <article><h2>Eden</h2><p>A green field and one quiet Soul.</p><span>being built</span></article>
  </div><p><a href="/l/mars">Mars Lab</a> · {[2020,2021,2022,2023,2024,2025,2026,2027].map(year=><a key={year} href={`/w/mars/${year}`} style={{marginRight:12}}>{year}</a>)}</p></main>;
}
