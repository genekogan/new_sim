// arrival-search/1 (lane ARR, 2026-10-20): where a new Soul is born when the world's arrival point cannot take it.
//
// The default placement (the native placer's rings round the arrival point) is kept exactly wherever it works: a ready
// probe whose spot lies in the world's open walkable area is returned untouched, so births in ordinary worlds are
// bit-identical. Otherwise (built over, under water, walled in, crowded) the engine's arrival search names the nearest
// standing spot in the open area out to the world's bounds, else the nearest spot of the largest pocket; the birth then
// carries it as the existing birth-near/1 hint {at, first:true}, so the event records the exact place and replay never
// searches. Refused (birth.arrival-unavailable) only when the world has no standing ground at all.
import { probeNativeHumanBirth, type ArrivalPocket, type ArrivalSpot } from '@sim/engine-mars';
import type { BirthNearV1, HumanBirthProbe } from '@sim/engine-contract';
import type { WorldHost } from './world.ts';

type ArrivalEngine = { arrivalSearchV1?(label?: string): ArrivalSpot | null; arrivalPocketV1?(p: [number, number], label?: string): ArrivalPocket; arrivalBlockedV1?(): boolean };
export type BirthIdentity = { id: string; label: string; soul: string };
export type BirthPlan = { probe: HumanBirthProbe; near?: { at: [number, number]; first: true } };

const engineOf = (host: WorldHost) => host.engine as unknown as ArrivalEngine;

/** The spot the arrival search would use instead of the default, or undefined when the default stands (see header). */
function searchFor(host: WorldHost, who: BirthIdentity, probe: HumanBirthProbe): { at: [number, number]; first: true } | 'none' | undefined {
  const e = engineOf(host); if (!e.arrivalSearchV1 || !e.arrivalPocketV1) return undefined;
  let pocket: ArrivalPocket | undefined;
  if (probe.outcome === 'ready') {
    pocket = e.arrivalPocketV1([probe.position[0], probe.position[2]], who.label);
    if (pocket.open) return undefined;
  }
  const s = e.arrivalSearchV1(who.label);
  if (!s) return probe.outcome === 'ready' ? undefined : 'none';
  // a ready default in a pocket at least as large as anything the search found stays where it is
  if (pocket && !s.open && s.size <= pocket.size) return undefined;
  return { at: s.at, first: true };
}

/** Probe a native birth, moving it off a blocked arrival point when needed. Read-only (detached checkpoints). */
export function planNativeBirth(host: WorldHost, who: BirthIdentity): BirthPlan {
  const first = probeNativeHumanBirth(host.engine, host.factory, who);
  if (first.outcome !== 'ready' && !(first.outcome === 'unavailable' && first.diagnostic.code === 'birth.arrival-unavailable')) return { probe: first };
  const near = searchFor(host, who, first);
  if (near === undefined) return { probe: first };
  if (near === 'none') return { probe: first.outcome === 'unavailable' ? { ...first, diagnostic: { code: 'birth.arrival-unavailable', message: 'no free walkable ground in this world' } } : first };
  return { probe: probeNativeHumanBirth(host.engine, host.factory, { ...who, near: near satisfies BirthNearV1 }), near };
}

/** The god's arrival note (null when the arrival point is clear): where the next Soul would really be born. Read-only. */
export function arrivalNote(host: WorldHost): string | null {
  const e = engineOf(host); if (!e.arrivalBlockedV1?.()) return null;
  let at: [number, number] | null | undefined;
  try {
    const plan = planNativeBirth(host, { id: 'h_arrival_note', label: 'Newcomer', soul: 's_arrival_note' });
    at = plan.near?.at ?? (plan.probe.outcome === 'ready' ? [plan.probe.position[0], plan.probe.position[2]] : plan.probe.outcome === 'unavailable' ? null : undefined);
  } catch { at = undefined; }
  if (at === undefined) at = e.arrivalSearchV1?.()?.at ?? null; // no exact checkpoint now: the search alone
  if (!at) return 'Arrival point is blocked and this world has no free ground left; new Souls cannot arrive until some is cleared.';
  return `Arrival point is blocked; new Souls will arrive nearby at ${at[0].toFixed(1)}, ${at[1].toFixed(1)}.`;
}
