import type {Entity, WorldModel} from '@sim/world-compiler';

/** Entry 34: like the lamps' contact clock (light-diff-clock.ts), an engine diff that moves a watering can between a hook
 *  and a hand, changes its water, or changes a growing planter (the soil darkening, the patter of water, a stage) waits for
 *  the viewer's depicted tick, so it shows on the same frame as the hand that caused it, never ahead of it. */
export function wateringDiffAhead(model: WorldModel, message: unknown, depictedTick: number): boolean {
  const d = message as {by?: string; tick?: number; diff?: {upserts?: Entity[]}};
  if (d.by !== 'engine' || typeof d.tick !== 'number' || !Number.isFinite(d.tick) || d.tick <= depictedTick) return false;
  return !!d.diff?.upserts?.some((e) => {
    const before = model.entities.get(e.id), def = model.resolvedDef(e.def) as {slots?: {kind: string}[]; state?: Record<string, {type?: string}>} | undefined;
    if (!before || !def) return false;
    const can = !!def.slots?.some((s) => s.kind === 'carry'), growing = def.state?.growth?.type === 'number';
    if (can) return before.in.parent !== e.in.parent || before.state?.level !== e.state?.level;
    return growing && JSON.stringify(before.state ?? {}) !== JSON.stringify(e.state ?? {});
  });
}
