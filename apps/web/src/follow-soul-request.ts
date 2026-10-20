// Gene 2026-10-20c: once an approved Soul's body is in the world, the approval card closes and the camera follows the new
// Soul. The card lives in the god panel (inside the viewer); the camera belongs to the Shell's viewer handle. This event
// carries the Soul id across; the Shell follows it the way Explore -> a Soul does (select it, camera mode 'follow').
export const FOLLOW_SOUL_EVENT = 'sim:follow-soul';
/** How long the Shell keeps trying while the new Soul has not reached this window's picture yet. */
export const FOLLOW_SOUL_WAIT_MS = 60_000;

export const isSoulId = (id: unknown): id is string => typeof id === 'string' && /^s_[A-Za-z0-9_-]+$/.test(id);

export function requestFollowSoul(soulId: string, target: Pick<EventTarget, 'dispatchEvent'> | null = typeof window === 'undefined' ? null : window): boolean {
  if (!isSoulId(soulId) || !target) return false;
  target.dispatchEvent(new CustomEvent(FOLLOW_SOUL_EVENT, { detail: { soulId } }));
  return true;
}

export function onFollowSoulRequest(cb: (soulId: string) => void, target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> = window): () => void {
  const listener = (e: Event) => { const id = (e as CustomEvent<{ soulId?: unknown }>).detail?.soulId; if (isSoulId(id)) cb(id); };
  target.addEventListener(FOLLOW_SOUL_EVENT, listener);
  return () => target.removeEventListener(FOLLOW_SOUL_EVENT, listener);
}
