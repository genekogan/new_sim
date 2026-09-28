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

const sorted = (w: WorldState) => Object.values(w.entities).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

export function deckSurfaces(w: WorldState): Surface[] {
  const out: Surface[] = [];
  for (const e of sorted(w)) {
    if (!isPlywood(e) || e.phase !== 'installed' || supportProblems(w, e).length) continue;
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

/** Installed joists / sheets / stairs / treads must have a complete support chain. */
export const progressiveSupported: Invariant = (rt) => {
  const out: Diagnostic[] = [];
  for (const e of sorted(rt.world)) {
    if (!PROGRESSIVE(e) || e.phase !== 'installed') continue;
    const pr = supportProblems(rt.world, e);
    if (pr.length)
      out.push({ code: 'support.deck-unsupported', message: `${def(e.def).label} ${e.id} is installed but unsupported: ${pr.join('; ')}`, subjects: [e.id], at: e.pose.p });
  }
  return out;
};
