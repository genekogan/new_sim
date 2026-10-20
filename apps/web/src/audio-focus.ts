// Lane PUX (Gene 2026-10-20: "you end up with music coming out of both tabs"): one world tab sounds at a time.
// Tabs of this site talk over a BroadcastChannel. A tab claims the sound when it loads visible, gains focus, becomes
// visible, or is touched; every other tab goes silent. A hidden tab is always silent. When the sounding tab closes, a
// visible tab takes the sound back. Without BroadcastChannel (old browsers) every tab sounds while visible.
type Msg = { type: 'claim' | 'release'; id: string };
export type AudioFocus = { audible(): boolean; owner(): boolean; claim(): void; subscribe(fn: () => void): () => void; close(): void };
type Doc = Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'>;
type Win = Pick<Window, 'addEventListener' | 'removeEventListener'>;
type Channel = { postMessage(m: Msg): void; close(): void; onmessage: ((e: { data: Msg }) => void) | null };

export function createAudioFocus(env: { doc: Doc; win: Win; channel: Channel | null; id?: string }): AudioFocus {
  const { doc, win, channel } = env;
  const id = env.id ?? Math.random().toString(36).slice(2);
  let mine = true;
  const listeners = new Set<() => void>();
  const notify = () => { for (const fn of listeners) fn(); };
  const set = (v: boolean) => { if (mine !== v) { mine = v; notify(); } };
  const claim = () => { channel?.postMessage({ type: 'claim', id }); set(true); };
  if (channel) channel.onmessage = (e) => {
    const m = e.data; if (!m || m.id === id) return;
    if (m.type === 'claim') set(false);
    else if (m.type === 'release' && !doc.hidden) claim();
  };
  const onVisible = () => { if (!doc.hidden) claim(); notify(); };
  const onClaim = () => claim();
  const onLeave = () => { if (mine) channel?.postMessage({ type: 'release', id }); };
  doc.addEventListener('visibilitychange', onVisible);
  win.addEventListener('focus', onClaim);
  win.addEventListener('pointerdown', onClaim, { capture: true, passive: true } as AddEventListenerOptions);
  win.addEventListener('pagehide', onLeave);
  if (!doc.hidden) claim();
  return {
    audible: () => mine && !doc.hidden,
    owner: () => mine,
    claim,
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    close: () => { onLeave(); doc.removeEventListener('visibilitychange', onVisible); win.removeEventListener('focus', onClaim); win.removeEventListener('pointerdown', onClaim, { capture: true } as EventListenerOptions); win.removeEventListener('pagehide', onLeave); channel?.close(); listeners.clear(); },
  };
}

let shared: AudioFocus | null = null;
/** This page's audio focus (created on first use). */
export function audioFocus(): AudioFocus | null {
  if (shared) return shared;
  if (typeof document === 'undefined' || typeof window === 'undefined') return null;
  let channel: Channel | null = null;
  try { channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('sim-audio') as unknown as Channel; } catch { channel = null; }
  shared = createAudioFocus({ doc: document, win: window, channel });
  (window as unknown as { __edenAudioFocus?: unknown }).__edenAudioFocus = { audible: shared.audible, owner: shared.owner };
  return shared;
}
/** Whether this tab may make sound now (true outside a browser, for tests). */
export const audible = () => audioFocus()?.audible() ?? true;
