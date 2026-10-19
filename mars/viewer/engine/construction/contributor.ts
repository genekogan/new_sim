// Progressive construction → navigation (spec §10 "construction must alter
// future navigation", §28 "Incomplete floor/stairs"). Plugged into Spatial via
// its `contributors` hook; re-run whenever navigation-relevant entity state
// changes (Spatial.sync keys on phase/pose/connections/support).
//   * every installed plywood sheet whose support chain is complete contributes
//     a walkable Surface at its top, on level round(y / 0.5) (adjacent sheets
//     merge in the raster); an unsupported sheet contributes nothing;
//   * every installed stair flight contributes its Link, usable only when all
//     treads are in and a landing exists (reason otherwise). The flight body is
//     an ordinary component obstacle (lower level only: it ends below the
//     deck's step band).
import type { Diagnostic } from '../actions/types.ts';
import type { Invariant } from '../runtime/runtime.ts';
import type { Contributor } from '../spatial/service.ts';
import type { Link, Surface } from '../spatial/types.ts';
import type { Entity, WorldState } from '../world/types.ts';
import { def } from '../world/catalog.ts';
import { levelFor } from './access.ts';
import { flatObb, isJoist, isPlywood, memberTop, supportProblems } from './deck.ts';
import { isStairFlight, stairLink } from './stairs.ts';
import { frameLinks } from './frame.ts';
import { entitiesById, entityList } from '../world/entity-list.ts';

// (shared and read-only during an invariant pass: world/entity-list.ts)
const sorted = (w: WorldState) => entitiesById(w);

export function deckSurfaces(w: WorldState): Surface[] {
  const out: Surface[] = [];
  for (const e of sorted(w)) {
    // standing sheets (wall panels, year builds phase B: wall.ts) are walls, not decks
    if (!isPlywood(e) || e.phase !== 'installed' || Math.abs(e.pose.roll ?? 0) > 0.1 || Math.abs(e.pose.pitch ?? 0) > 0.1 || supportProblems(w, e).length) continue;
    const y = memberTop(e);
    out.push({ id: `deck:${e.id}`, level: levelFor(y), y, obb: flatObb(e.pose, e), label: `deck ${y.toFixed(2)} m` });
  }
  return out;
}

export const progressiveContributor: Contributor = (world, base) => {
  const surfaces = deckSurfaces(world);
  const all = [...base.surfaces, ...surfaces];
  const links: Link[] = [];
  for (const e of sorted(world)) if (isStairFlight(e) && e.phase === 'installed') links.push(stairLink(world, e, all));
  return { surfaces, links };
};

/**
 * Rack-structure access (frame.ts): climb links up installed uprights and beam walkways on connected
 * beam pairs. Kept separate from progressiveContributor so existing scenes (and their pinned hashes /
 * routes) are unchanged; the links are narrower than a routing disc, so walk_to never uses them.
 */
export const frameAccessContributor: Contributor = (world) => ({ links: frameLinks(world) });

const PROGRESSIVE = (e: Entity) => isJoist(e) || isPlywood(e) || isStairFlight(e) || e.def === 'stair-tread';

// A completed deck has the same support chain for many ticks. Reuse only a
// successful proof, after comparing every input read by supportProblems and
// groupStability by value (connections/holder arrays mutate in place). Only
// copied proof inputs are retained; no diagnostics, controllers or history.
type SupportSnap = { key: string; id: string; def: string; category: string; phase: Entity['phase'];
  pitch: number | undefined; roll: number | undefined; support: string; holders: number;
  levels: number; crew: number; connections: string[] };
const supported = new WeakMap<WorldState, SupportSnap[]>();

function supportInputs(w: WorldState, previous?: SupportSnap[]): SupportSnap[] | undefined {
  let i = 0, same = !!previous;
  const oldLength = previous?.length;
  const next: SupportSnap[] = previous ?? [];
  for (const key in w.entities) {
    if (!Object.hasOwn(w.entities, key)) continue;
    const e = w.entities[key], d = def(e.def), s = previous?.[i];
    const holders = e.support?.kind === 'held' ? e.support.by.length : 0;
    const levels = d.size[1], crew = d.handling?.holdCrew ?? 1;
    const cs = e.connections;
    let match = !!s && s.key === key && s.id === e.id && s.def === e.def && s.category === d.category && s.phase === e.phase &&
      s.pitch === e.pose.pitch && s.roll === e.pose.roll && s.support === (e.support?.kind ?? '') &&
      s.holders === holders && s.levels === levels && s.crew === crew && s.connections.length === (cs?.length ?? 0) * 3;
    if (match && cs) for (let j = 0; j < cs.length; j++) {
      const c = cs[j];
      if (s!.connections[j * 3] !== c.socket || s!.connections[j * 3 + 1] !== c.to || s!.connections[j * 3 + 2] !== c.toSocket) { match = false; break; }
    }
    same &&= match;
    // Reuse copied scalar snapshots on hits; copy changed inputs only.
    next[i++] = match ? s! : { key, id: e.id, def: e.def, category: d.category, phase: e.phase,
      pitch: e.pose.pitch, roll: e.pose.roll, support: e.support?.kind ?? '', holders, levels, crew,
      connections: (cs ?? []).flatMap(c => [c.socket, c.to, c.toSocket]) };
  }
  if (oldLength !== i) same = false;
  next.length = i;
  return same ? undefined : next;
}

/** Installed joists / sheets / stairs / treads must have a complete support chain. */
export const progressiveSupported: Invariant = (rt) => {
  // S1 V7a: nothing installed is a joist / sheet / stair → nothing to prove (a world without construction skips the
  // per-entity input snapshot every tick). The proof cache is dropped so a later deck is proven from scratch.
  if (!entityList(rt.world).some((e) => e.phase === 'installed' && PROGRESSIVE(e))) { supported.delete(rt.world); return []; }
  let inputs: SupportSnap[] | undefined;
  try { inputs = supportInputs(rt.world, supported.get(rt.world)); }
  catch (error) { supported.delete(rt.world); throw error; }
  if (!inputs) return [];
  supported.delete(rt.world); // An exception must never leave a success proof for changed inputs.
  const out: Diagnostic[] = [];
  for (const e of sorted(rt.world)) {
    if (!PROGRESSIVE(e) || e.phase !== 'installed') continue;
    const pr = supportProblems(rt.world, e);
    if (pr.length)
      out.push({ code: 'support.deck-unsupported', message: `${def(e.def).label} ${e.id} is installed but unsupported: ${pr.join('; ')}`, subjects: [e.id], at: e.pose.p });
  }
  if (!out.length) supported.set(rt.world, inputs);
  else supported.delete(rt.world);
  return out;
};
