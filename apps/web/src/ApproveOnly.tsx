// Lane PAIR-UI (Gene's review #1 item 3): what an #approve link shows when another tab of the same world is already open.
// That tab got the request and shows its card (Shell.tsx askOpenTab); this tab starts no world, socket or score. The
// person can still answer here: the same card, on a plain page. Signed out, the card's Sign in works as in the world.
import { useEffect, useState } from 'react';
import type { AuthCtx } from './Shell.tsx';
import { publishSession } from './auth-session.ts';
import { authIdentity } from './auth-projection.ts';
import { ApprovalDialog } from './god-ui/ApprovalDialog.tsx';
import { approval, type Approval } from './god-ui/join-api.ts';
import { approvalTitle } from './approval-link.ts';
import { watchApproval } from './approval-status.ts';
import './ApproveOnly.css';

export function ApproveOnly({ id, cfg, auth, worldName }: { id: string; cfg: { authProvider?: string }; auth: AuthCtx; worldName: string }) {
  const [view, setView] = useState<'handed' | 'here' | 'done'>('handed');
  const scope = authIdentity(auth);
  const [status, setStatus] = useState<{ id: string; scope: string | null; value: Approval | null; error: string | null } | null>(null);
  useEffect(() => { publishSession({ mode: auth.mode ?? (cfg.authProvider === 'clerk' ? 'clerk' : 'none'), ready: auth.ready, authed: auth.authed, scope: authIdentity(auth), label: auth.label, signInUrl: auth.signInUrl, getToken: () => auth.getToken(), login: auth.login, logout: auth.logout }); });
  useEffect(() => {
    setStatus(null);
    if (!auth.ready || !auth.authed) return;
    return watchApproval(() => approval(id),
      value => setStatus({ id, scope, value, error: null }),
      error => setStatus({ id, scope, value: null, error: error.message }));
  }, [id, scope, auth.ready, auth.authed, view]);
  const current = auth.ready && auth.authed && status?.id === id && status.scope === scope ? status : null;
  const a = current?.value;
  const world = location.pathname + location.search;
  const signIn = !auth.authed && (auth.signInUrl || auth.ready
    ? <button className="ap-btn ap-primary" data-signin="1" onClick={() => { if (auth.signInUrl) location.assign(auth.signInUrl); else auth.login(); }}>Sign in</button>
    : <p>Signing in…</p>);
  if (a?.status === 'ready') return <main className="approve-only" data-approve-only="paired"><section role="status">
    <h1>Paired</h1>
    <p>{approvalTitle(a)} has been paired with your agent. You can close this tab.</p>
    <p className="approve-only-actions"><a href={world}>Open {worldName}</a></p>
  </section></main>;
  return <main className="approve-only" data-approve-only={view}>
    {!auth.authed ? <section><h1>Check this request</h1><p>Sign in to see whether your Soul is paired.</p>{signIn}</section>
    : !a ? <section><h1>{current?.error ? 'Could not check this request' : 'Checking this request…'}</h1>
      <p role="status">{current?.error ?? 'Getting the latest pairing status.'}</p></section>
    : <>
    {view === 'handed' && a.status === 'pending' && <section>
      <h1>Your open {worldName} tab is showing this request</h1>
      <p>Switch to that tab to approve or refuse it. Nothing else opens here.</p>
      <p className="approve-only-actions"><button type="button" data-approve-here="1" onClick={() => setView('here')}>Answer here instead</button></p>
    </section>}
    {view === 'handed' && a.status === 'creating' && <section role="status"><h1>Pairing…</h1><p>{approvalTitle(a)} is being prepared by your agent. Please wait…</p></section>}
    {(view === 'here' || (view === 'handed' && !['pending', 'creating'].includes(a.status))) && <ApprovalDialog id={id} signedIn={auth.authed} signIn={signIn} onDone={() => setView('done')} />}
    {view === 'done' && <section>
      <h1>Request closed</h1>
      <p>You can close this tab.</p>
      <p className="approve-only-actions"><a href={world}>Open {worldName}</a></p>
    </section>}
    </>}
  </main>;
}
