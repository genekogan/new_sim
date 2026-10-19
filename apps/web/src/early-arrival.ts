// P7 lever D (team/DECISIONS.md 2026-10-19 ~21:40Z): on a phone, a new world's arrival card lifts once the nearby world
// is built and drawn, without waiting for the live socket's first data (its join, first take and scene record). People
// appear (stand-ins, then bodies) when the take arrives. Desktops and old worlds keep the full arrival.
import { arrivalMark } from './arrival-marks.ts';

/** The one switch for lever D. `?early=0` turns it off for a page, `?early=1` turns it on for any new world. */
export const EARLY_ARRIVAL = true;

export function earlyArrivalWanted(tier: string, newWorld: boolean, search: string, shot = false): boolean {
  if (!newWorld || shot) return false;
  const q = new URLSearchParams(search).get('early');
  if (q === '0') return false;
  if (q === '1') return true;
  return EARLY_ARRIVAL && tier === 'phone';
}

/** Page-wide (once per page, like the arrival marks): `revealed` the world's canvas is shown under the card (a canvas drawn
 *  while hidden shows blank once revealed, until its next frame); `shown` frames were then drawn into it: the card may go. */
let shown = false, revealed = false;
const subs = new Set<() => void>();
const tell = () => { for (const f of [...subs]) f(); };
export const earlyArrival = {
  shown: () => shown,
  revealed: () => revealed,
  reveal() { if (revealed) return; revealed = true; tell(); },
  mark() { if (shown) return; shown = revealed = true; arrivalMark('early-drawn'); tell(); },
  subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f); }; },
};
