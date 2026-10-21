// Lane LAP (2026-10-21): the older worlds (/w/eden, mars, littlemartians, toy) show the same approval card as the new
// worlds' god panel (god-ui/ApprovalDialog.tsx): top right, on top, Approve / Refuse, Ask again once a request timed out;
// when the body is ready it closes itself and the Shell's camera follows the new Soul (follow-soul-request.ts). It opens
// from the agent's link (#approve/<id>) or, with no navigation, for a request the person's agent addressed to this window.
// Lane ANALYTICS (ported by STACK): a request seen waiting here that turns ready counts GoatCounter event "soul paired".
import { lazy, Suspense, useEffect, useState } from 'react';
import { closeApproval, closedApprovals, pickWindowApproval, useWindowApprovals } from './god-ui/window-approvals.ts';
import type { AuthCtx } from './Shell.tsx';
import { countEvent } from './visitor-counts.ts';

const ApprovalDialog = lazy(() => import('./god-ui/ApprovalDialog.tsx').then((m) => ({ default: m.ApprovalDialog })));

export function OldWorldApprovals({ linkId, auth, accountAuthRequired, onLinkDone }: { linkId: string | null; auth: AuthCtx; accountAuthRequired: boolean; onLinkDone: () => void }) {
  const waiting = useWindowApprovals(auth.authed && accountAuthRequired);
  const [windowId, setWindowId] = useState<string | null>(null);
  useEffect(() => { if (!windowId) setWindowId(pickWindowApproval(waiting, closedApprovals())); }, [waiting, windowId]);
  const shownId = linkId ?? windowId;
  if (!shownId) return null;
  const done = () => { closeApproval(shownId); if (linkId) onLinkDone(); else setWindowId(null); };
  const signIn = !auth.authed && (auth.signInUrl || auth.ready
    ? <button className="ap-btn ap-primary" data-signin="1" onClick={() => { if (auth.signInUrl) location.assign(auth.signInUrl); else auth.login(); }}>Sign in</button>
    : <p>Signing in…</p>);
  return <Suspense fallback={null}><ApprovalDialog id={shownId} signedIn={auth.authed} onDone={done} signIn={signIn} onPaired={() => countEvent('soul paired')} /></Suspense>;
}
