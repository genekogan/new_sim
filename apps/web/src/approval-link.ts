/** `#approve/ap_…` — the link the Soul CLI prints for its human. No imports: node tests and the page shell both read it. */
export const approvalFromHash = (hash: string) => /^#approve\/(ap_[a-f0-9]{32})$/.exec(hash)?.[1] ?? null;

const MODES = ['create', 'repair'], STATUSES = ['pending', 'creating', 'ready', 'refused', 'cancelled', 'expired'];
/** A world's answer about one approval is that request (`id`), well formed, and ready only together with its Soul. With
 *  `worldId` it must also be this world's request: a shared account registry answers any world's id, and the older
 *  worlds' view refused another world's request (lane LAP 2026-10-21 keeps that), so a link from one world opened on
 *  another can neither be approved there nor make its camera follow a Soul that does not live there. */
export function validApproval(value: unknown, id: string, worldId?: string): boolean {
  const a = value as { id?: unknown; worldId?: unknown; mode?: unknown; status?: unknown; name?: unknown; agentLabel?: unknown; soulId?: unknown } | null;
  if (!a || typeof a !== 'object' || a.id !== id || !MODES.includes(a.mode as string) || !STATUSES.includes(a.status as string)) return false;
  if (typeof a.name !== 'string' || typeof a.agentLabel !== 'string') return false;
  if (!(a.soulId === null || (typeof a.soulId === 'string' && /^s_[A-Za-z0-9_-]+$/.test(a.soulId)))) return false;
  if (a.status === 'ready' && a.soulId === null) return false;
  return worldId === undefined || a.worldId === worldId;
}

/** Gene's review #3 (2026-10-22): the card's one line, his wording. */
export const APPROVAL_COPY = 'If you approve, the connecting agent will be able to control this Soul.';
/** The card's title is the Soul's name as the server put it on the request (a reconnect carries the Soul's real current
 *  name: lane PAIR-INWINDOW), never its ID: an older request whose agent sent the ID as the name reads "Your Soul". The ID
 *  is shown only behind the (i). */
export function approvalTitle(a: { name?: unknown; soulId?: unknown } | null): string | null {
  if (!a || typeof a.name !== 'string') return null;
  const name = a.name.trim();
  return !name || /^s_[A-Za-z0-9_-]+$/.test(name) || name === a.soulId ? 'Your Soul' : name;
}

// Gene's review #1 item 3: an #approve link opened while another tab of the same world is open must not boot a second
// world (and its score). The new tab asks the world's open tabs on a BroadcastChannel; the one most recently in front
// opens the approval card, and the new tab shows only a short note (ApproveOnly.tsx). No answer: the tab boots as before.
type Chan = { postMessage(m: unknown): void; close(): void; onmessage: ((e: { data: unknown }) => void) | null };
export type ChanCtor = new (name: string) => Chan;
const BC = (): ChanCtor | undefined => (globalThis as { BroadcastChannel?: ChanCtor }).BroadcastChannel;
export const approvalChannelName = (worldId: string) => 'sim-approve/' + worldId;
const nonce = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
type Msg = { t?: unknown; ask?: unknown; tab?: unknown; seen?: unknown; id?: unknown };

/** Ask this world's open tabs to show approval `id`; true once one of them says it opened the card. */
export function askOpenTab(name: string, id: string, opts: { Channel?: ChanCtor; probeMs?: number; openMs?: number } = {}): Promise<boolean> {
  const Ctor = opts.Channel ?? BC();
  if (!Ctor) return Promise.resolve(false);
  let ch: Chan;
  try { ch = new Ctor(name); } catch { return Promise.resolve(false); }
  const ask = nonce(), heard: { tab: string; seen: number }[] = [];
  return new Promise<boolean>((resolve) => {
    let picked: string | null = null, settled = false;
    const end = (ok: boolean) => { if (settled) return; settled = true; ch.onmessage = null; try { ch.close(); } catch { /* closed */ } resolve(ok); };
    ch.onmessage = (e) => {
      const m = (e.data ?? {}) as Msg;
      if (m.ask !== ask || typeof m.tab !== 'string') return;
      if (m.t === 'here' && typeof m.seen === 'number') heard.push({ tab: m.tab, seen: m.seen });
      else if (m.t === 'opened' && m.tab === picked) end(true);
    };
    ch.postMessage({ t: 'probe', ask });
    setTimeout(() => {
      if (!heard.length) return end(false);
      picked = heard.reduce((a, b) => (b.seen > a.seen ? b : a)).tab;
      ch.postMessage({ t: 'open', ask, tab: picked, id });
      setTimeout(() => end(false), opts.openMs ?? 1500);
    }, opts.probeMs ?? 300);
  });
}

/** A world tab: answer probes with when it was last in front, and open the card when picked. Returns the stop function. */
export function answerApprovalTabs(name: string, open: (id: string) => void, seen: () => number, opts: { Channel?: ChanCtor } = {}): () => void {
  const Ctor = opts.Channel ?? BC();
  if (!Ctor) return () => {};
  let ch: Chan;
  try { ch = new Ctor(name); } catch { return () => {}; }
  const tab = nonce();
  ch.onmessage = (e) => {
    const m = (e.data ?? {}) as Msg;
    if (typeof m.ask !== 'string') return;
    if (m.t === 'probe') ch.postMessage({ t: 'here', ask: m.ask, tab, seen: seen() });
    else if (m.t === 'open' && m.tab === tab && typeof m.id === 'string' && approvalFromHash('#approve/' + m.id)) { open(m.id); ch.postMessage({ t: 'opened', ask: m.ask, tab }); }
  };
  return () => { ch.onmessage = null; try { ch.close(); } catch { /* closed */ } };
}
