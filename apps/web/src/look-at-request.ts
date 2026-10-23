// OWNER-DAY: a "Today" entry asks the world camera to look at where it happened. The timeline lives in the Soul's
// home panel; the camera belongs to the Shell's viewer handle, so this event carries the spot across (as
// follow-soul-request.ts does for a Soul id).
export const LOOK_AT_EVENT = 'sim:look-at';
export type LookAt = { x: number; z: number };

export function requestLookAt(at: LookAt, target: Pick<EventTarget, 'dispatchEvent'> | null = typeof window === 'undefined' ? null : window): boolean {
  if (!target || !Number.isFinite(at.x) || !Number.isFinite(at.z)) return false;
  target.dispatchEvent(new CustomEvent(LOOK_AT_EVENT, { detail: { x: at.x, z: at.z } }));
  return true;
}

export function onLookAtRequest(cb: (at: LookAt) => void, target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> = window): () => void {
  const listener = (e: Event) => { const d = (e as CustomEvent<Partial<LookAt>>).detail; if (d && Number.isFinite(d.x) && Number.isFinite(d.z)) cb({ x: d.x!, z: d.z! }); };
  target.addEventListener(LOOK_AT_EVENT, listener);
  return () => target.removeEventListener(LOOK_AT_EVENT, listener);
}
