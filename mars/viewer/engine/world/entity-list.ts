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

type Scope = { world: WorldState; entities: WorldState['entities']; list: Entity[]; keys: string[]; byId?: Entity[]; memo?: Map<string, unknown> };
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

/** During a pass over `w`: `compute(list)` of the pass list, computed once per pass and `key` (one computation per key;
 *  never mutate the result). Outside a pass: null (callers then walk the table themselves). */
export function passMemo<T>(w: WorldState, key: string, compute: (list: readonly Entity[]) => T): T | null {
  const s = live(w);
  if (!s) return null;
  const memo = (s.memo ??= new Map());
  if (memo.has(key)) return memo.get(key) as T;
  const out = compute(s.list);
  memo.set(key, out);
  return out;
}

// S1 r2 (tranche 2026-10-19): what a tick reads of every entity only to find the few it is about (the rides, the bodies,
// the entities a take samples) depends on fields an entity object never changes after it is made: `kind`, the ride
// state `carrier` (set by carrierEntity when the ride is made, never added or deleted later), `tags` (never reassigned
// or mutated in place). So while the table holds the same objects under the same keys in the same order, the same
// entities are found. stableIndices keeps, per table and purpose, the list it last scanned and the indices it found,
// and answers again from them when the new list (and keys) are the same objects in the same order: comparing two arrays
// of pointers instead of reading ~4,500 scattered entity objects (each read is a cache miss in a big idle world).
type Stable = { list: readonly Entity[]; keys: readonly string[] | null; idx: number[]; derived?: unknown };
const STABLE = new WeakMap<object, Map<string, Stable>>();
const sameArray = <T>(a: readonly T[], b: readonly T[]) => {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

/**
 * The indices i of `list` (with `keys[i]` its key, or null when the caller does not read keys) for which `keep(list[i])`
 * holds. `keep` must read only fields fixed for an entity object's life (kind, carrier, tags). Exact: a new or replaced
 * or removed entity, a moved key or another order changes the arrays and the list is scanned afresh. The returned array
 * is shared: never mutate it. `derive` (optional) is computed once per scan and returned as `.derived`.
 */
export function stableIndices<D = never>(entities: object, purpose: string, list: readonly Entity[], keys: readonly string[] | null, keep: (e: Entity) => boolean, derive?: (idx: number[]) => D): { idx: number[]; derived: D } {
  let byPurpose = STABLE.get(entities);
  if (!byPurpose) STABLE.set(entities, (byPurpose = new Map()));
  const was = byPurpose.get(purpose);
  if (was && sameArray(was.list, list) && (keys === null ? was.keys === null : was.keys !== null && sameArray(was.keys, keys))) return was as { idx: number[]; derived: D };
  const idx: number[] = [];
  for (let i = 0; i < list.length; i++) if (keep(list[i])) idx.push(i);
  const next: Stable = { list, keys, idx, ...(derive ? { derived: derive(idx) } : {}) };
  byPurpose.set(purpose, next);
  return next as { idx: number[]; derived: D };
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
