// An agent asks to make (or reconnect) the signed-in person's Soul: this card answers it.
// Lane HF (Gene 2026-10-20): a modal dialog in the browser's top layer, above every z-index, from the first render until it
// is answered or closed; when another dialog opens (God Mode, Explore, the account menu) this one is lifted back over it.
// Lane PUX (Gene 2026-10-20b): the same guarantee, drawn as a small frosted card in the top right like the other menus,
// with the Soul's picture (or a generic one), short copy, the agent's self-chosen name only behind an (i), and Ask again
// once a request timed out. Gene 2026-10-20c: after Approve it says "<Name> is being prepared by your agent. Please
// wait…" with a spinner; when the Soul's body is in the world the card closes itself and the camera follows the new Soul
// (follow-soul-request.ts -> the Shell's viewer). A refused body is one short line and Close. It opens from the agent's
// link (#approve/<id>, older agents) or, with no navigation at all, in the window that gave the agent its window code.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import * as J from './join-api.ts';
import { approvalLine, preparingLine, safePhoto } from './window-approvals.ts';
import { requestFollowSoul } from '../follow-soul-request.ts';
import { countPairing, pairingTaken } from '../visitor-counts.ts';
import './approval-card.css';

const AVATAR = <svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="15" r="7" fill="currentColor" opacity=".55" /><path d="M6 36a14 14 0 0 1 28 0" fill="currentColor" opacity=".55" /></svg>;

export function ApprovalCard({ id, signedIn, signIn, onDone }: { id: string; signedIn: boolean; signIn?: ReactNode; onDone: () => void }) {
  const [a, setA] = useState<J.Approval | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [about, setAbout] = useState(false);
  const [refusedHere, setRefusedHere] = useState(false);
  const [approving, setApproving] = useState(false);
  const pressed = useRef(false);   // Approve was pressed in this card: only this card counts the pairing
  const check = useCallback(async (action?: 'approve' | 'cancel' | 'renew') => {
    if (action) setBusy(true);
    if (action === 'approve') { setApproving(true); pressed.current = true; }
    setErr(null);
    try { const next = await J.approval(id, action); setA(next); if (action === 'cancel' && next.status === 'cancelled') setRefusedHere(true); }
    catch (e) { setErr((e as Error).message); if (action === 'approve') setApproving(false); }
    finally { if (action) setBusy(false); }
  }, [id]);
  useEffect(() => { if (signedIn) void check(); }, [signedIn, check]);
  // follow the request while it can still change on its own (the agent withdraws it, it times out, the body arrives)
  const live = a?.status === 'pending' || a?.status === 'creating';
  useEffect(() => { if (!live) return; const t = setInterval(() => void check(), a?.status === 'creating' ? 2000 : 4000); return () => clearInterval(t); }, [live, a?.status, check]);
  const done = useRef(onDone); done.current = onDone;   // the parent re-renders often; closing must happen once
  const closed = useRef(false);
  // GoatCounter "soul paired", once per approval (visitor-counts.ts): when the server took this card's Approve, even if the
  // card is closed before the body is ready; another window's approval seen turning ready here is not counted again
  useEffect(() => { if (pairingTaken(pressed.current, a?.status)) countPairing(id); }, [a?.status, id]);
  useEffect(() => {
    if (a?.status !== 'ready' || closed.current) return;
    closed.current = true;
    if (a.soulId) requestFollowSoul(a.soulId);
    done.current();
  }, [a?.status, a?.soulId]);
  const photo = safePhoto(a?.photo);
  const line = approvalLine(a, refusedHere);
  // from the Approve press until the body is ready (or refused): the spinner line, nothing else to press
  const preparing = a?.status === 'creating' || (approving && a?.status === 'pending');
  const kicker = a?.mode === 'repair' ? 'Connect your Soul' : 'New Soul';
  return (
    <div className="ap-card" data-approval={id} data-approval-status={a?.status ?? ''}>
      <button type="button" className="ap-close" data-approval-close="1" aria-label="Close" onClick={onDone}>×</button>
      <div className="ap-head">
        {photo ? <img className="ap-avatar" src={photo} alt="" /> : <span className="ap-avatar ap-generic">{AVATAR}</span>}
        <div className="ap-who">
          <span className="ap-kicker">{kicker}</span>
          <span className="ap-nameline"><b className="ap-name" data-approval-name="1">{a?.name ?? (signedIn ? '…' : 'Your agent is asking')}</b>
          {a && <button type="button" className="ap-info" aria-expanded={about} aria-label="About this request" data-approval-about="1" onClick={() => setAbout((v) => !v)}><span>i</span></button>}</span>
        </div>
      </div>
      {about && a && <p className="ap-note" data-approval-note="1">Asked by {a.agentLabel}. Approve only if you started this agent: it will act as this Soul.</p>}
      {!signedIn && <><p className="ap-line">Sign in to answer.</p>{signIn && <div className="ap-signin">{signIn}</div>}</>}
      {preparing && a && <p className="ap-line ap-wait" role="status" data-approval-preparing="1"><span className="ap-spinner" aria-hidden="true" />{preparingLine(a)}</p>}
      {a?.status === 'pending' && !preparing && <div className="ap-actions">
        <button type="button" className="ap-btn ap-primary" data-approve-agent={id} disabled={busy} onClick={() => void check('approve')}>Approve</button>
        <button type="button" className="ap-btn" data-refuse-agent={id} disabled={busy} onClick={() => void check('cancel')}>Refuse</button>
      </div>}
      {line && <p className={'ap-line' + (a?.status === 'refused' ? ' ap-bad' : '')}
        role={a?.status === 'refused' ? 'alert' : 'status'} {...(a?.status === 'refused' ? { 'data-approval-reason': a.reason?.code ?? 'refused' } : {})}>{line}</p>}
      {(a?.status === 'refused' || a?.status === 'cancelled') && <div className="ap-actions">
        <button type="button" className="ap-btn" data-approval-done={id} onClick={onDone}>Close</button>
      </div>}
      {a?.status === 'expired' && <div className="ap-actions">
        <button type="button" className="ap-btn ap-primary" data-approval-renew={id} disabled={busy} onClick={() => void check('renew')}>Ask again</button>
      </div>}
      {err && <p className="ap-line ap-bad">{err}</p>}
    </div>
  );
}

export function ApprovalDialog({ id, signedIn, signIn, onDone }: { id: string; signedIn: boolean; signIn?: ReactNode; onDone: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof node.showModal !== 'function') return;
    const raise = () => { if (!node.isConnected) return; try { if (node.open) node.close(); node.showModal(); node.focus({ preventScroll: true }); } catch { /* not in the document */ } };
    raise();
    const others = new MutationObserver((records) => {
      if (records.some((r) => r.target !== node && r.target instanceof HTMLDialogElement && r.target.open)) raise();
    });
    others.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
    document.addEventListener('fullscreenchange', raise);
    return () => { others.disconnect(); document.removeEventListener('fullscreenchange', raise); if (node.open) node.close(); };
  }, [id]);
  // Escape is the person closing it, as the card's own × is; the request stays pending for the agent. Focus starts on the
  // dialog itself, not on a button (Enter must not approve, refuse or close by accident)
  return <dialog ref={ref} className="ap-dialog" data-approval-dialog={id} aria-label="Approve your agent" tabIndex={-1}
    onCancel={(e) => { e.preventDefault(); onDone(); }}>
    <ApprovalCard key={id} id={id} signedIn={signedIn} signIn={signIn} onDone={onDone} />
  </dialog>;
}
