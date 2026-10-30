/** Opted-in world loads: an absolute native clock for reach and release. */
export const CARRY_REACH_SECONDS = .75;
export const CARRY_RELEASE_SECONDS = 1.2;
export type CarryContact = {item: string; slot: string; startTick: number; releaseTick?: number; releaseFrom?: number};
const smooth = (x: number) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };
export function carryContactWeight(contact: CarryContact, tick: number, dt: number) {
  return contact.releaseTick === undefined
    ? smooth((tick - contact.startTick) * dt / CARRY_REACH_SECONDS)
    : (contact.releaseFrom ?? 1) * (1 - smooth((tick - contact.releaseTick) * dt / CARRY_RELEASE_SECONDS));
}
