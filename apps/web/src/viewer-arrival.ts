/** VF1: what a visitor is told about the connection and the first frame.
 *
 * "Reconnecting" is only true after a socket that was open has been down for a moment: the very first connect
 * is part of arriving, and a quick drop-and-reconnect (the browser was busy, the network blinked) is invisible
 * because playback runs a moment behind the server on frames it already holds. */
/** An initial-assets gate's progress, when the viewer has one (old worlds' InitialWorldReadiness shape). */
export type InitialWorldProgress = { stage: 'waiting' | 'downloading' | 'preparing' | 'first-frame' | 'ready' | 'failed' | 'cancelled'; required: number; completed: number; bytesLoaded: number; bytesTotal: number | null };

export const RECONNECT_GRACE_MS = 3000;

type ConnLike = { stats: { state: string; reconnects?: number } };
const seen = new WeakMap<object, { everOpen: boolean; downSince: number | null }>();

/** True only when a previously open connection has been down for at least RECONNECT_GRACE_MS. */
export function connectionLost(conn: ConnLike | null | undefined, now = performance.now()): boolean {
  if (!conn) return false;
  let s = seen.get(conn);
  if (!s) { s = { everOpen: false, downSince: null }; seen.set(conn, s); }
  if (conn.stats.state === 'open') { s.everOpen = true; s.downSince = null; return false; }
  if (!s.everOpen && !(conn.stats.reconnects ?? 0)) return false; // still arriving
  s.downSince ??= now;
  return now - s.downSince >= RECONNECT_GRACE_MS;
}

/** The arrival card's line for a viewer that has not drawn its first frame yet. */
export function arrivalStage(reason: string | null | undefined, connecting: boolean): string {
  if (connecting) return 'Connecting to the world';
  if (!reason || /recorded world frame/i.test(reason)) return 'Catching the first moments';
  if (/scenery/i.test(reason)) return 'Loading the scenery';
  return 'Getting the view ready';
}

/** A short, plain pill label for a drawn view that is not live right now. */
export function heldLabel(reason: string | null | undefined): string {
  if (!reason) return 'Live';
  if (/reconnect/i.test(reason)) return 'Reconnecting…';
  if (/graphics|3D/i.test(reason)) return 'View paused';
  if (/covered by controls/i.test(reason)) return 'View hidden';
  return 'Catching up';
}

/** True while the viewer's initial-assets gate still hides the world (a failure shows its own Retry instead). */
export function initialPending(initial: InitialWorldProgress | null | undefined): boolean {
  return !!initial && initial.stage !== 'ready' && initial.stage !== 'failed';
}

/** The arrival card's bar, 0..1, for the initial-assets gate; null while nothing is measurable yet.
 * Bytes when the whole download graph is known, else world parts prepared; full once everything has arrived. */
export function arrivalProgress(initial: InitialWorldProgress | null | undefined): number | null {
  if (!initial) return null;
  if (initial.stage === 'preparing' || initial.stage === 'first-frame') return 1;
  if (initial.stage !== 'downloading') return null;
  if (initial.bytesTotal !== null && initial.bytesTotal > 0) return Math.min(1, Math.max(0, initial.bytesLoaded / initial.bytesTotal));
  if (initial.required > 0) return Math.min(1, Math.max(0, initial.completed / initial.required));
  return null;
}

/** Without an initial gate, the bar follows the actual asset downloads (finished of started) while any are pending. */
export function assetDownloadProgress(d: { loaded: number; failed: number; total: number; pending: number } | null | undefined): number | null {
  return d && d.pending > 0 && d.total > 0 ? Math.min(1, Math.max(0, (d.loaded + d.failed) / d.total)) : null;
}
