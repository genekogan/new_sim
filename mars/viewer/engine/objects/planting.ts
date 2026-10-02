// Independent finite seedbed state. Existing garden care remains its own conserved purpose.
import type { Diagnostic } from '../actions/types.ts';
import type { Runtime } from '../runtime/runtime.ts';
import type { Entity } from '../world/types.ts';
import { gardenIssue, gardenTarget } from './garden.ts';
export const SEED_DEPOSIT = 0.0625;
export const SEEDS_PER_PLANTER = 0.25;
export interface PlantingState {
  kind: 'seedbed-v1';
  deposited: number;
  completed: boolean;
  purpose?: string;
  actor?: string;
  source?: string;
  returnSlot?: string;
  initialFraction?: number;
  binding?: string;
}
export type PlantingEntity = Entity & { planting?: PlantingState };
export const plantingState = (): PlantingState => ({
  kind: 'seedbed-v1',
  deposited: 0,
  completed: false,
});
export function plantingIssue(rt: Runtime, plant: string): Diagnostic | null {
  const issue = gardenIssue(rt, plant);
  if (issue) return issue;
  const s = (rt.world.entities[plant] as PlantingEntity).planting;
  if (!s) return null;
  if (
    s.kind !== 'seedbed-v1' ||
    !Number.isFinite(s.deposited) ||
    s.deposited < 0 ||
    s.deposited > SEEDS_PER_PLANTER ||
    s.deposited % SEED_DEPOSIT !== 0 ||
    s.completed !== (s.deposited === SEEDS_PER_PLANTER) ||
    (s.purpose
      ? !s.actor ||
        !s.source ||
        !s.returnSlot ||
        !s.binding ||
        !Number.isFinite(s.initialFraction) ||
        s.initialFraction! < SEEDS_PER_PLANTER ||
        s.initialFraction! > 1
      : s.deposited !== 0 ||
        s.completed ||
        s.actor !== undefined ||
        s.source !== undefined ||
        s.returnSlot !== undefined ||
        s.initialFraction !== undefined ||
        s.binding !== undefined)
  )
    return {
      code: 'planting.state',
      message: `${plant} has inconsistent conserved seedbed state`,
      subjects: [plant],
    };
  return null;
}
/** Inspection never creates state or claims biological growth. */
export function readSeedbed(rt: Runtime, plant: string) {
  const issue = plantingIssue(rt, plant);
  if (issue) return issue;
  const e = rt.world.entities[plant] as PlantingEntity,
    s = e.planting ?? plantingState();
  return {
    plant,
    ...structuredClone(s),
    material: 'seeds' as const,
    required: SEEDS_PER_PLANTER,
    deposit: SEED_DEPOSIT,
    deposits: s.deposited / SEED_DEPOSIT,
    remaining: SEEDS_PER_PLANTER - s.deposited,
    target: gardenTarget(rt, plant),
    pose: structuredClone(e.pose),
    support: structuredClone(e.support),
  };
}
