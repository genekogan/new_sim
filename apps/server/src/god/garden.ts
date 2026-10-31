// Soul Actions entry 18: gardens dry out. Each new world day, every thing with numeric `moisture` (a planter) loses a
// third, so a watered plant droops again after a few days unless someone waters it. One pass per world-day change (the
// bridge compares day numbers each tick); the commit is an ordinary engine edit, so viewers redraw the wilting.
import { opSchema, type Op, type WorldModel } from '@sim/world-compiler';
export const DRY_PER_DAY = 1 / 3, DRY_BELOW = 0.34;
/** The ops that dry every moist thing by `days` world days (none when nothing is moist). */
export function dryingOps(model: WorldModel, days: number): Op[] {
  if (!(days > 0)) return [];
  const ops: Op[] = [];
  for (const e of model.entities.values()) {
    const def = model.resolvedDef(e.def), f = (def?.state as Record<string, { type?: string; default?: unknown }> | undefined)?.moisture;
    if (f?.type !== 'number') continue;
    const now = typeof e.state?.moisture === 'number' ? e.state.moisture : Number(f.default ?? 0);
    if (now <= 0) continue;
    { const next = Math.round((now - DRY_PER_DAY * days) * 1000) / 1000; ops.push(opSchema.parse({ op: "set", id: e.id, state: { moisture: next < 0.02 ? 0 : next } })); }
  }
  return ops;
}
/** Is this thing dry enough that a Soul standing by it would notice (`dry` fact)? */
export const isDry = (moisture: unknown) => typeof moisture === 'number' && moisture < DRY_BELOW;
