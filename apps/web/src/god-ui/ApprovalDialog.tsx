// Lane HF (hotfix, Gene 2026-10-20): an agent's approval link (#approve/<id>) shows its card as a modal dialog on top of
// everything, for everyone who opens it (the world's god included), from the first render until the person approves,
// refuses or closes it. Before, the god's card lived inside the God modal: it flashed while Clerk was still loading (the
// page saw an anonymous visitor's floating card), then vanished once the god's status arrived with God Mode closed.
// A modal dialog sits in the browser's top layer, above every z-index; a later modal (God Mode, Explore, the account menu,
// the return card) would sit above it, so whenever another dialog opens this one is lifted back over it.
import { useEffect, useRef, type ReactNode } from 'react';
import { ApprovalCard } from './JoinPanel.tsx';

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
  }, []);
  // Escape is the person closing it, as the card's own "close" is; the request stays pending for the agent. Focus starts on
  // the dialog itself, not on a button (Enter must not approve, refuse or close by accident)
  return <dialog ref={ref} className="gp-approval-dialog" data-approval-dialog={id} aria-label="Approve your agent" tabIndex={-1}
    onCancel={(e) => { e.preventDefault(); onDone(); }}>
    <ApprovalCard id={id} signedIn={signedIn} onDone={onDone} />
    {signIn && <div className="gp-block">{signIn}</div>}
  </dialog>;
}
