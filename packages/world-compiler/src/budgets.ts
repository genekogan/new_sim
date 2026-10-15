import { CREATION_LIMITS as L } from '@sim/generators';
import type { WorldModel } from './model.ts';
import type { Failure } from './schemas.ts';

export function worldBudgetFailure(before: WorldModel, after: WorldModel, op: number): Failure | null {
  const fail = (field: string, measured: number, limit: number, code = 'budget.world'): Failure => ({ op, code, field, measured, limit,
    detail: `${field}: ${measured} > ${limit}`, fix: code === 'budget.region' ? `Spread solid construction across ${L.regionSizeM} m cells or remove some solids.` : `Reduce ${field} before adding more construction; use existing definitions where possible.` });
  const entities = Math.min(L.worldEntities, after.constants.limits.entities);
  if (after.entities.size > entities && after.entities.size > before.entities.size) return fail('entities', after.entities.size, entities);
  const defs = new Set(after.defs.values()).size;
  if (defs > L.worldDefs && defs > new Set(before.defs.values()).size) return fail('defs', defs, L.worldDefs);
  let tris = 0;
  for (const e of after.entities.values()) {
    const def = after.resolvedDef(e.def); if (def) tris += after.bake(def, e.params ?? {}, e.seed ?? 0, e.shape).tris;
  }
  if (tris > L.worldTris) {
    let previous = 0;
    for (const e of before.entities.values()) { const def = before.resolvedDef(e.def); if (def) previous += before.bake(def, e.params ?? {}, e.seed ?? 0, e.shape).tris; }
    if (tris > previous) return fail('tris', tris, L.worldTris);
  }
  const old = before.solidRegionCounts();
  for (const [cell, count] of after.solidRegionCounts()) if (count > L.regionSolidEntities && count > (old.get(cell) ?? 0)) return fail(`regions.${cell}.solidEntities`, count, L.regionSolidEntities, 'budget.region');
  return null;
}
