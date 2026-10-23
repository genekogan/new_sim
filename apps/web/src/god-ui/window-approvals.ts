// Lane PUX (Gene 2026-10-20: "it would be nice if the approval request comes up in your existing window"): the signed-in
// page asks the world, every few seconds while it is visible, which Soul requests are waiting for this account (requests
// an agent addressed with this person's window code). GodPanel shows the newest one the person has not closed in this tab.
import { useEffect, useState } from 'react';
import { worldKey } from '../world-path.ts';
import * as J from './join-api.ts';

export const WINDOW_POLL_MS = 2000; // PAIR: worst case 2 s + one request, under the 3 s bar (was 4500: the modal took 0-4.5 s, walked 4.3 s)
const KEY = `sim.approvalsClosed:${worldKey}`;

/** The request to show: the newest waiting one this tab has not closed (the server lists newest first). */
export function pickWindowApproval(waiting: readonly Pick<J.Approval, 'id' | 'status'>[], closed: ReadonlySet<string>): string | null {
  return waiting.find((a) => a.status === 'pending' && !closed.has(a.id))?.id ?? null;
}
export function closedApprovals(storage: Pick<Storage, 'getItem'> | null = safeSession()): Set<string> {
  try { const v = JSON.parse(storage?.getItem(KEY) ?? '[]'); return new Set(Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []); } catch { return new Set(); }
}
export function closeApproval(id: string, storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeSession()): Set<string> {
  const next = closedApprovals(storage); next.delete(id); next.add(id);
  try { storage?.setItem(KEY, JSON.stringify([...next].slice(-20))); } catch { /* private mode: this tab only */ }
  return next;
}
function safeSession(): Storage | null { try { return typeof sessionStorage === 'undefined' ? null : sessionStorage; } catch { return null; } }

/** The Soul's picture only from this site or https (the server builds it; never a script URL). */
export const safePhoto = (url: string | null | undefined) => typeof url === 'string' && (/^https:\/\//.test(url) || /^\/(?!\/)/.test(url)) ? url : null;
/** Gene 2026-10-20c: after Approve the card says only that the Soul is being prepared, with a spinner, until its body is
 *  in the world; then the card closes and the camera follows the Soul. */
export function preparingLine(a: Pick<J.Approval, 'name' | 'mode'>): string {
  return a.mode === 'repair' ? `${a.name} is being reconnected by your agent. Please wait…` : `${a.name} is being prepared by your agent. Please wait…`;
}
/** One short line per refusal reason (the server's own message is written for the agent and runs long). */
const REFUSED: Record<string, string> = { 'arrival-unavailable': 'No clear ground at the arrival point. Nothing was created.' };
/** What the card says under the name, per status (short on purpose: Gene, "avoid verbosity"). `creating` is the spinner
 *  line and `ready` closes the card, so neither has a line here. */
export function approvalLine(a: J.Approval | null, refusedHere: boolean): string | null {
  if (!a) return null;
  switch (a.status) {
    case 'cancelled': return refusedHere ? 'Refused' : 'Withdrawn by the agent';
    case 'expired': return 'Timed out';
    case 'refused': return REFUSED[a.reason?.code ?? ''] ?? 'The body could not be made. Nothing was created.';
    default: return null;
  }
}

/** Requests waiting for the signed-in account; polls only while `enabled` and the tab is visible; stops for good when the
 *  world has no such list (an older server). */
export function useWindowApprovals(enabled: boolean): J.Approval[] {
  const [waiting, setWaiting] = useState<J.Approval[]>([]);
  useEffect(() => {
    if (!enabled) { setWaiting([]); return; }
    let live = true, timer: ReturnType<typeof setTimeout> | undefined, stopped = false, asking = false;
    const tick = async () => {
      clearTimeout(timer);
      if (!live || stopped || asking) return;
      if (typeof document !== 'undefined' && document.hidden) return;   // resumes on visibilitychange
      asking = true;
      const list = await J.waitingApprovals().finally(() => { asking = false; });
      if (!live) return;
      if (list === null) { stopped = true; setWaiting([]); return; }
      setWaiting((prev) => (prev.length === list.length && prev.every((a, i) => a.id === list[i]!.id && a.status === list[i]!.status) ? prev : list));
      timer = setTimeout(() => void tick(), WINDOW_POLL_MS);
    };
    const onVisible = () => { if (!document.hidden) void tick(); };
    document.addEventListener('visibilitychange', onVisible);
    void tick();
    return () => { live = false; clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [enabled]);
  return waiting;
}
