// The entities an invariant can be about (S1 round 2, tranche 2026-10-19: idle world CPU with a resident body).
//
// An Eden 2026 world holds ~4,500 entities and ~4,400 of them are plain placed fixtures: the god's kit pieces, trees and
// walls, standing on the ground or resting on another thing, never in a construction phase, never carried, ridden or held.
// The invariant pass walked all of them in ~25 invariants every tick (~112k megamorphic entity reads a tick, ~3 ms on
// the laptop, ~9 ms on eden2) to find the handful of bodies, components, vehicles and rides each one is about.
//
// `relevantEntities(w)` is the pass's entity list without the plain fixtures, in the same order, filtered once per pass.
// An invariant (or a helper it calls) may walk it instead of `entityList(w)` when its own test rejects every plain
// fixture: each call site says which field its test needs (a body, a phase, a non-ground support, a ride's state, a
// kind other than fixture, or a catalogue obstacle / rack upright def), and each of those makes an entity relevant
// here. Outside a pass it is the whole list, as before. The result is exact: the same entities, in the same order, give
// the same diagnostics.
import { CATALOG } from './catalog.ts';
import { entityList, passMemo, stableIndices } from './entity-list.ts';
import type { Entity, WorldState } from './types.ts';

/**
 * True for every entity an invariant may be about; false only for a plain fixture: kind 'fixture', a catalogue def that
 * is neither a walking obstacle (spatial isStatic) nor a rack upright (uprightsSupported), no ride state (`carrier`), no
 * body (`human`), no construction phase, no reservation, and a ground / resting support or none. An unknown def is
 * relevant (the invariants that read it throw, as before).
 */
export function isRelevant(e: Entity): boolean {
  return fixedRelevant(e) || nowRelevant(e);
}
/** The part fixed for an entity object's life: kind, def and ride state are never changed after an entity is made. */
function fixedRelevant(e: Entity): boolean {
  if (e.kind !== 'fixture' || e.carrier !== undefined) return true;
  const def = e.def;
  if (PLAIN_DEFS.has(def)) return false;
  if (DEF_RELEVANT.has(def)) return true;
  const d = CATALOG[def];
  if (d === undefined) return true;   // not memoised: a def registered later may be plain (relevant is the safe side)
  if (d.obstacle === true || d.category === 'rack-upright') { DEF_RELEVANT.add(def); return true; }
  PLAIN_DEFS.add(def);
  return false;
}
/** The part that changes as the world runs (a fixture is carried, reserved, held, put on forks). */
function nowRelevant(e: Entity): boolean {
  if (e.human !== undefined || e.phase !== undefined || e.reservedBy !== undefined) return true;
  const s = e.support;
  return s !== undefined && s.kind !== 'ground' && s.kind !== 'resting-on';
}
/** Catalogue def ids known to be neither an obstacle nor a rack upright, and known to be one of them. Exact while
 *  catalogue entries are only ever added, never replaced (registerAssets; UPRIGHT_DEFS relies on it too). */
const PLAIN_DEFS = new Set<string>(), DEF_RELEVANT = new Set<string>();

/** The relevant entities of `list`, in order: the fixed part is found again from the last scan while the table holds
 *  the same objects (stableIndices), and only the other entities (Eden 2026: ~1,900 plain kit pieces) are read for the
 *  part that changes. */
function relevantOf(w: WorldState, list: readonly Entity[]): Entity[] {
  const { idx, derived: rest } = stableIndices(w.entities, 'relevant: fixed part', list, null, fixedRelevant, (idx) => {
    const others: number[] = [];
    for (let i = 0, k = 0; i < list.length; i++) { if (k < idx.length && idx[k] === i) k++; else others.push(i); }
    return others;
  });
  const out: Entity[] = [];
  let a = 0, b = 0;
  while (a < idx.length || b < rest.length) {
    if (b >= rest.length || (a < idx.length && idx[a] < rest[b])) out.push(list[idx[a++]]);
    else { const e = list[rest[b++]]; if (nowRelevant(e)) out.push(e); }
  }
  return out;
}

/** The pass's entities without plain fixtures (list order); outside a pass every entity, as entityList. */
export function relevantEntities(w: WorldState): Entity[] {
  return passMemo(w, 'relevant', (list) => relevantOf(w, list)) ?? entityList(w);
}

/** The same during a pass over `w`; null outside one (callers then walk the table themselves). */
export function passRelevant(w: WorldState): Entity[] | null {
  return passMemo(w, 'relevant', (list) => relevantOf(w, list));
}
