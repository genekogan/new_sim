// MARSLAND-FORK: the operator's old-world Mars fork (/worlds/w/mars, lane FORKS) shows Mars 2026 as Gene binds it:
//   layer 1  what sim.mars.college (release 43) shows: the campus with the 2026 recipe (add2026Details), not the raw CAD;
//   layer 2  plus Gene's corrections (Mimos L with the raised main, kitchen west bay, diner east bay, the showers) and
//            the 2026 site bearing (Chiba's panels face south);
//   layer 3  the drone surroundings (WorldMarsForkLand.ts).
// Only the fork changes: the root /w/mars (the laptop's old-world release) keeps its exact behaviour.
import { BASE } from './base-path.ts';
import { worldKey } from './world-path.ts';

/** This page is the operator's Mars fork under a launcher base (never the root /w/mars). */
export const marsFork = BASE !== '' && worldKey === 'mars';

/** Layers 1 + 2 baked into one static campus GLB in /browser/campus.glb's own frame (same `at`, same hide rules):
 *  tools/god-skill/scripts/mars-two/fork-backdrop.mjs, from the Mars viewer source c8179e8 (release 43 + Gene's
 *  corrections, the sim.mars.college deploy candidate) on release 43's campus.glb, BLOBS-encoded. `blob` is the content-addressed copy on eden2
 *  (/srv/sim-blobs); `local` is the same file under the fork server's marsWebDir (local runs have no /blobs). */
export const MARS_FORK_BACKDROP = Object.freeze({
  source: 'c8179e81ce6d6b23809e012c48fd5956901da81b',
  sha256: '064a2541a2010ca9adfcc65a9b3c3635775a7a11ebf7ee7a4b1599c6e02117d9',
  bytes: 44616736,
  blob: '/blobs/assets/06/064a2541a2010ca9adfcc65a9b3c3635775a7a11ebf7ee7a4b1599c6e02117d9.glb',
  local: '/browser/campus-owner-c8179e81ce6d.glb',
});
/** The campus GLB the server's scene names (mars-2026-map/1); only this one is replaced. */
const CAMPUS_2026 = '/browser/campus.glb?v=20260922b';

/** Candidate URLs for a backdrop, best first: on the fork the corrected campus (blob, then local), then the usual ones. */
export function backdropCandidates(url: string, alias: string | undefined, fork = marsFork): string[] {
  const own = fork && url === CAMPUS_2026 ? [MARS_FORK_BACKDROP.blob, MARS_FORK_BACKDROP.local] : [];
  return [...own, ...(alias ? [alias] : []), url];
}

/** The arrival byte bar's manifest for this page: on the fork the corrected campus replaces the raw campus blob. */
export function forkInitialAssets(rows: Readonly<Record<string, number>>, fork = marsFork): Record<string, number> {
  if (!fork) return { ...rows };
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(rows)) if (!/\/blobs\/assets\/64\/64b8838c/.test(k)) out[k] = v;
  out[MARS_FORK_BACKDROP.blob] = MARS_FORK_BACKDROP.bytes;
  return out;
}

/** The 2026 site bearing (sun.ts convention, degrees added to a compass azimuth): Chiba's solar slope faces due south.
 *  The Mars viewer source carries the same value as YEAR_NORTH_AZIMUTH_OFFSET[2026] (mars-src-fix afc9d81); the mars-two
 *  world's BEARING 90 is the same orientation (tools/god-skill/scripts/mars-two/frame.mjs). */
export const MARS_2026_NORTH_OFFSET = -65;
