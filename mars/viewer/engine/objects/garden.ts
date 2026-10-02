import type { Diagnostic } from '../actions/types.ts';
import type { Runtime } from '../runtime/runtime.ts';
import type { Entity } from '../world/types.ts';
import { CATALOG } from '../world/catalog.ts';
import { rot2, type Vec3 } from '../core/math.ts';

export const GARDEN_INTERVAL_TICKS = 600;
export const GARDEN_WATER_PER_CARE = 0.25;
export const GARDEN_DEPOSIT = 0.0625;
export interface GardenState {
  kind: 'ground-planter-v1';
  cycles: number;
  waterReceived: number;
  lastCareTick: number | null;
  pending?: { purpose: string; water: string; delivered: number };
}
export type GardenEntity = Entity & { gardenCare?: GardenState };
export const gardenState = (): GardenState => ({ kind: 'ground-planter-v1', cycles: 0, waterReceived: 0, lastCareTick: null });
export function gardenIssue(rt: Runtime, plant: string): Diagnostic | null {
  const e = rt.world.entities[plant] as GardenEntity | undefined, s = e?.gardenCare;
  const bad = (code: string, message: string): Diagnostic => ({ code: `garden.${code}`, message, subjects: [plant] });
  if (!e || e.kind !== 'fixture' || e.def !== 'garden-planter' || !CATALOG[e.def]) return bad('missing', `${plant} is not a registered grounded planter`);
  if (e.support?.kind !== 'ground' || e.pose.p[1] !== 0 || (e.pose.pitch ?? 0) !== 0 || (e.pose.roll ?? 0) !== 0) return bad('support', `${plant} must remain upright on level ground`);
  if (!CATALOG[e.def].surfaceSlots?.some(slot => slot.id === 'care' && slot.local[1] === 0.8)) return bad('target', `${plant} has no supported soil care target`);
  if (e.equipment?.config.available === false) return bad('unavailable', `${plant} is unavailable for care`);
  if (!s || s.kind !== 'ground-planter-v1' || !Number.isInteger(s.cycles) || s.cycles < 0 || !Number.isFinite(s.waterReceived) || s.waterReceived < 0 ||
    (s.lastCareTick !== null && (!Number.isInteger(s.lastCareTick) || s.lastCareTick < 0 || s.lastCareTick > rt.tick)) ||
    (s.cycles === 0) !== (s.lastCareTick === null) ||
    (s.pending && (!s.pending.purpose || !s.pending.water || !Number.isFinite(s.pending.delivered) || s.pending.delivered < 0 || s.pending.delivered >= GARDEN_WATER_PER_CARE || s.pending.delivered % GARDEN_DEPOSIT !== 0)) ||
    s.waterReceived !== s.cycles * GARDEN_WATER_PER_CARE + (s.pending?.delivered ?? 0)) return bad('state', `${plant} has inconsistent conserved care state`);
  return null;
}
export function gardenTarget(rt: Runtime, plant: string): Vec3 {
  const e = rt.world.entities[plant], slot = CATALOG[e.def].surfaceSlots!.find(s => s.id === 'care')!;
  const q = rot2([slot.local[0], slot.local[2]], e.pose.yaw);
  return [e.pose.p[0] + q[0], e.pose.p[1] + slot.local[1], e.pose.p[2] + q[1]];
}
export function readGarden(rt: Runtime, plant: string) {
  const issue = gardenIssue(rt, plant);
  if (issue) return issue;
  const e = rt.world.entities[plant] as GardenEntity, s = e.gardenCare!;
  const remainingTicks = s.lastCareTick === null ? 0 : Math.max(0, s.lastCareTick + GARDEN_INTERVAL_TICKS - rt.tick);
  return { plant, ...structuredClone(s), due: !!s.pending || remainingTicks === 0, remainingTicks,
    intervalTicks: GARDEN_INTERVAL_TICKS, requiredWater: GARDEN_WATER_PER_CARE, target: gardenTarget(rt, plant) };
}
