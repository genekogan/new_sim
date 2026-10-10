// One entry point for "freeze what this generator needs from the ground" (L3). The compiler hook
// (patch requested of L1) and the skill call it before a place/move of a path or area entity and
// merge the result: `params` into the entity's params, `path` (if returned) replaces shape.path.
import { prepareBridge, prepareDeck } from './bridge.ts';
import { snapRiver } from './river.ts';
import { prepareRoad } from './road.ts';
import type { TerrainQuery } from './terrain-query.ts';
import type { Value } from './fields.ts';
import type { Vec2 } from './types.ts';

export type Prepared = { params: Record<string, Value>; path?: Vec2[] };
/** Null when the generator needs nothing frozen (or the shape is missing). */
export function prepareFor(gen: string, q: TerrainQuery, shape: { path?: Vec2[]; area?: Vec2[]; width?: number } | undefined, params: Record<string, Value> = {}): Prepared | null {
  if (!shape) return null;
  switch (gen) {
    case 'road/1': case 'path/1': return shape.path ? { params: prepareRoad(q, shape.path, gen === 'path/1' ? { width: 1.6, maxGrade: 0, ...params } : params) as unknown as Record<string, Value> } : null;
    case 'river/1': { if (!shape.path) return null; const r = snapRiver(q, shape.path, params); return { params: r.params as unknown as Record<string, Value>, path: r.path }; }
    case 'bridge/1': return shape.path ? { params: prepareBridge(q, shape.path) as unknown as Record<string, Value> } : null;
    case 'pier/1': case 'deck/1': return { params: prepareDeck(q, shape, params) as unknown as Record<string, Value> };
    default: return null;
  }
}
