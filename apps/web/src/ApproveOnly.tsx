// Lane PAIR-UI (Gene's review #1 item 3): what an #approve link shows when another tab of the same world is already open.
// That tab got the request and shows its card (Shell.tsx askOpenTab); this tab starts no world, socket or score. The
// person can still answer here: the same card, on a plain page. Signed out, the card's Sign in works as in the world.
import { useEffect, useState } from 'react';
import type { AuthCtx } from './Shell.tsx';
import { publishSession } from './auth-session.ts';
import { authIdentity } from './auth-projection.ts';
import { ApprovalDialog } from './god-ui/ApprovalDialog.tsx';
import './ApproveOnly.css';

export function ApproveOnly({ id, cfg, auth, worldName }: { id: string; cfg: { authProvider?: string }; auth: AuthCtx; worldName: string }) {
  const [view, setView] = useState<'handed' | 'here' | 'done'>('handed');
  useEffect(() => { publishSession({ mode: auth.mode ?? (cfg.authProvider === 'clerk' ? 'clerk' : 'none'), ready: auth.ready, authed: auth.authed, scope: authIdentity(auth), label: auth.label, signInUrl: auth.signInUrl, getToken: () => auth.getToken(), login: auth.login, logout: auth.logout }); });
  const world = location.pathname + location.search;
  const signIn = !auth.authed && (auth.signInUrl || auth.ready
    ? <button className="ap-btn ap-primary" data-signin="1" onClick={() => { if (auth.signInUrl) location.assign(auth.signInUrl); else auth.login(); }}>Sign in</button>
    : <p>Signing in…</p>);
  return <main className="approve-only" data-approve-only={view}>
    {view === 'handed' && <section>
      <h1>Your open {worldName} tab is showing this request</h1>
      <p>Switch to that tab to approve or refuse it. Nothing else opens here.</p>
      <p className="approve-only-actions"><button type="button" data-approve-here="1" onClick={() => setView('here')}>Answer here instead</button></p>
    </section>}
    {view === 'here' && <ApprovalDialog id={id} signedIn={auth.authed} signIn={signIn} onDone={() => setView('done')} />}
    {view === 'done' && <section>
      <h1>All set</h1>
      <p>You can close this tab.</p>
      <p className="approve-only-actions"><a href={world}>Open {worldName}</a></p>
    </section>}
  </main>;
}
