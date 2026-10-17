// M2 (lane M, 2026-10-17): a visitor's own time-of-day preview (the reference Mars viewer's time slider). View only: the
// lights and sky are drawn at the chosen hour in this browser; the world's clock, its Souls and other viewers are unchanged.
let hour: number | null = null;
const listeners = new Set<() => void>();
/** Minutes after midnight the visitor is previewing, or null (the world's own time). */
export const visitorPreviewHour = (): number | null => hour;
export function setVisitorPreviewHour(minutes: number | null) {
  const next = minutes == null || !Number.isFinite(minutes) ? null : ((Math.round(minutes) % 1440) + 1440) % 1440;
  if (next === hour) return; hour = next; for (const f of listeners) f();
}
export function subscribeVisitorHour(f: () => void) { listeners.add(f); return () => { listeners.delete(f); }; }
export const hourLabel = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
