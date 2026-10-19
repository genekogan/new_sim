// One entity list per invariant pass (lane L1, tick cost).
//
// `Object.values(world.entities)` over a big world is the cost of an invariant, not its check: Eden 2026 has 4,338
// entities in a dictionary-mode object and each Object.values over it takes ~0.46 ms, while the loop that follows takes
// ~0.02–0.06 ms. The runtime ran ~24 invariants each tick, each listing every entity (11 ms of a 13 ms invariant pass).
//
// Runtime.step lists the entities once for the pass (withEntityList) and the invariants and the helpers they call read
// that list (entityList / entitiesById). Exact: the list is taken after the tick's last mutation, invariants only read
// the world (they never add, remove or replace an entity), and the list has Object.values' order, so every invariant
// sees the same entities in the same order and returns the same diagnostics. Outside a pass both functions list the
// world afresh, as before. The returned arrays are shared: callers never sort or splice them in place.
import type { Entity, WorldState } from './types.ts';

type Scope = { world: WorldState; entities: WorldState['entities']; list: Entity[]; keys: string[]; byId?: Entity[] };
let scope: Scope | null = null;

const byIdOrder = (a: Entity, b: Entity) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
/** Object.values(entities), same entities in the same order (own enumerable keys: integer-like ascending, then insertion
 *  order; for-in follows it on an ordinary object), ~2.7x cheaper on a dictionary-mode object (0.17 vs 0.46 ms, Eden 2026). */
export function listEntities(entities: WorldState['entities']): Entity[] {
  const out: Entity[] = [];
  for (const k in entities) if (Object.hasOwn(entities, k)) out.push(entities[k]);
  return out;
}
const live = (w: WorldState) => (scope !== null && scope.world === w && scope.entities === w.entities ? scope : null);

/** The world's entities in Object.values order (shared during an invariant pass; never mutate the array). */
export function entityList(w: WorldState): Entity[] {
  return live(w)?.list ?? listEntities(w.entities);
}

/** The world's entities sorted by id (shared during an invariant pass; never mutate the array). */
export function entitiesById(w: WorldState): Entity[] {
  const s = live(w);
  if (!s) return listEntities(w.entities).sort(byIdOrder);
  return (s.byId ??= s.list.slice().sort(byIdOrder));
}

/** The shared list while an entity-list pass over `w` is open, else null (callers then walk the table themselves). */
export function passList(w: WorldState): Entity[] | null {
  return live(w)?.list ?? null;
}

/** The world's entity keys in Object.keys order, parallel to entityList (shared during a pass; never mutate the array). */
export function entityKeys(w: WorldState): string[] {
  return live(w)?.keys ?? Object.keys(w.entities);
}

/** Run `fn` (read-only over `w`) with one entity list for the whole call. */
export function withEntityList<T>(w: WorldState, fn: () => T): T {
  const prev = scope, entities = w.entities, list: Entity[] = [], keys: string[] = [];
  for (const k in entities) if (Object.hasOwn(entities, k)) { keys.push(k); list.push(entities[k]); }
  scope = { world: w, entities, list, keys };
  try {
    return fn();
  } finally {
    scope = prev;
  }
}
