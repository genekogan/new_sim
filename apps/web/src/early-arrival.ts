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

/** Page-wide: the near world has been drawn before the live data came (once per page, like the arrival marks). */
let shown = false;
const subs = new Set<() => void>();
export const earlyArrival = {
  shown: () => shown,
  mark() { if (shown) return; shown = true; arrivalMark('early-drawn'); for (const f of [...subs]) f(); },
  subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f); }; },
};
