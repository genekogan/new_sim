// D1 (playtest 2026-10-25, "the world reports the plan, not the body"): one reading of what a Soul's body is doing,
// derived from engine state on every read and never stored. Receipts (`body`, `now`), the Soul status, the public Soul
// page and the card's `doing` line all read it, so a rider over the grass is "riding the ferris wheel", a body left
// waist-deep in the pond is "standing in the water", and an approach walk is "walking to Kitchen chair, 18 m left".
import type {WorldState as NativeWorld} from '../../../mars/viewer/engine/world/types.ts';
import type {WorldHost, Mind} from './world.ts';

export type BodyStateV1 = {
  /** stateOf: seated, lying, sleeping, walking, swimming, riding, rowing, standing, busy, absent… */
  posture: string;
  /** The engine's own activity of the body (sit, walk, row, tread, idle…). */
  activity: string;
  /** The carrier (ride, punt) or vehicle the body is in or on, by its label; null on foot. */
  on: string | null;
  /** Where the body is in that carrier: boarding (not seated yet), seated, leaving (stepping out). */
  aboard?: 'boarding' | 'seated' | 'leaving';
  /** The body stands or floats in water (deeper than WET_M at its root, or a swim/tread/wade activity). */
  inWater: boolean;
  /** The step the running program is on while it travels: "walking to Kitchen chair, 18 m left". */
  step?: string;
};
/** Where a running program's travel is headed, as the ledger (edge acts) or the mind (native cards) knows it. */
export type ApproachV1 = {name: string; to?: [number, number] | null};

/** Deeper than this (m) at the body's root is "in the water" (wading ankle-deep at a shore is not). */
export const WET_M = 0.3;
const WATER: Record<string, string> = {swim: 'swimming', tread: 'treading water', wade: 'wading'};
const GAIT: Record<string, string> = {walk: 'walking', jog: 'jogging', run: 'running', cycle: 'cycling', swim: 'swimming', glide: 'gliding'};

export function stateOf(host: WorldHost, entityId: string): string {
  const h = (host.engine.world as NativeWorld).entities[entityId]?.human; if (!h) return 'absent';
  if (h.sleepPose) return 'sleeping';
  if (h.carrier) return h.activity === 'row' ? 'rowing' : 'riding';
  const a = String(h.activity ?? 'idle');
  if (a === 'sit' || a.startsWith('sit') || h.baseActivity === 'sit') return 'seated';
  if (a === 'lie' || a === 'nap') return 'lying';
  if (a === 'walk') return 'walking';
  if (a === 'jog') return 'jogging';
  if (a === 'run') return 'running';
  if (a === 'cycle') return 'cycling';
  if (a === 'row') return 'rowing';
  if (a === 'swim' || a === 'tread' || a === 'wade') return 'swimming';
  if (a === 'wait') return 'waiting';
  if (a === 'idle') return host.engine.programOf(entityId) ? 'busy' : 'standing';
  return 'busy';
}

type Carrier = {label: string; riderPhase: string; phase: string};
const carrierOf = (host: WorldHost, entityId: string): Carrier | null =>
  (host.engine as unknown as {carrierOf?: (a: string) => Carrier | null}).carrierOf?.(entityId) ?? null;

/** The body as the engine has it now. `approach`: where the running program travels to (for `step`). */
export function bodyState(host: WorldHost, entityId: string, approach?: ApproachV1 | null): BodyStateV1 | null {
  const world = host.engine.world as NativeWorld, e = world.entities[entityId], h = e?.human; if (!e || !h) return null;
  const activity = String(h.activity ?? 'idle'), posture = stateOf(host, entityId), ride = carrierOf(host, entityId);
  const vehicle = !ride && h.riding ? world.entities[h.riding] : undefined;
  const on = ride ? ride.label : vehicle ? (vehicle.label ?? h.riding!) : null;
  const depth = on ? 0 : Math.max(h.shore?.submergedHeightMetres ?? 0, (host.engine as {bodyWaterDepthV1?: (a: string) => number}).bodyWaterDepthV1?.(entityId) ?? 0);
  const inWater = !on && (activity in WATER || depth > WET_M);
  const gait = GAIT[activity];
  let step: string | undefined;
  if (approach && gait && !on && host.engine.programOf(entityId)) {
    const left = approach.to ? Math.round(Math.hypot(approach.to[0] - e.pose.p[0], approach.to[1] - e.pose.p[2])) : null;
    step = `${gait} to ${approach.name}${left !== null ? `, ${left} m left` : ''}`;
  }
  return {posture, activity, on, ...(ride ? {aboard: (['boarding', 'seated', 'leaving'].includes(ride.riderPhase) ? ride.riderPhase : 'seated') as BodyStateV1['aboard']} : {}), inWater, ...(step ? {step} : {})};
}

/** The carrier with an article: "the ferris wheel", "the punt" (a label that already has one keeps it). */
const the = (label: string) => /^the\s/i.test(label) ? label : `the ${label}`;
/** What a body on a carrier is doing, from the carrier's own phases: boarding until seated, then riding (rowing a punt),
 *  waiting while it has not left, stepping out at the end. */
export function carrierWords(b: BodyStateV1, phase?: string): string | null {
  if (!b.on) return null;
  if (b.aboard === 'boarding') return `boarding ${the(b.on)}`;
  if (b.aboard === 'leaving') return `stepping out of ${the(b.on)}`;
  if (b.posture === 'rowing') return `rowing ${the(b.on)}`;
  if (phase === 'boarding' || phase === 'parked') return `seated in ${the(b.on)}, waiting for it to start`;
  return `riding ${the(b.on)}`;
}
const POSTURE: Record<string, string> = {seated: 'sitting', lying: 'lying down', sleeping: 'sleeping', walking: 'walking', jogging: 'jogging', running: 'running', cycling: 'cycling', rowing: 'rowing', waiting: 'waiting', standing: 'standing'};
/** One plain sentence for the body ("riding the ferris wheel", "standing in the water", "walking to Kitchen chair, 18 m left"). */
export function bodyWords(host: WorldHost, entityId: string, b: BodyStateV1): string {
  if (b.on) return carrierWords(b, carrierOf(host, entityId)?.phase) ?? `on ${the(b.on)}`;
  if (b.step) return b.step;
  if (b.inWater) return WATER[b.activity] ?? 'standing in the water';
  return POSTURE[b.posture] ?? b.activity.replace(/^mars:/, '').replace(/[-_]+/g, ' ');
}

const MOVING_LABEL = /^(?:walk|stroll|wander|go|head|jog|run|cycle|ride a bicycle|swim|follow|return|come|travel)\b/i;
/** The card's `doing` line (name tag and Soul card): the program label only while the body is in the program's main
 *  pose; the approach step before that ("Walking to Kitchen chair"); the carrier or the water after the program ends.
 *  `m.doing` stays the plan's label (the brain and `recent` read it); this is what the world shows. */
export function cardDoing(host: WorldHost, m: Mind, approach?: ApproachV1 | null): string {
  const b = bodyState(host, m.entityId, approach); if (!b) return m.doing;
  if (b.on) return carrierWords(b, carrierOf(host, m.entityId)?.phase)!;
  if (host.engine.programOf(m.entityId)) {
    if (approach && GAIT[b.activity] && !MOVING_LABEL.test(m.doing)) return `${GAIT[b.activity]} to ${approach.name}`;
    return m.doing;
  }
  if (b.inWater) return WATER[b.activity] ?? 'standing in the water';
  return m.doing;
}
