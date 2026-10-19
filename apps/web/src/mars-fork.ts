// MARSLAND-FORK: the operator's old-world Mars fork (/worlds/w/mars, lane FORKS) shows Mars 2026 as Gene binds it:
//   layer 1  what sim.mars.college (release 43) shows: the campus with the 2026 recipe (add2026Details), not the raw CAD;
//   layer 2  plus Gene's corrections in true compass (Mimos L with the raised main and the south glazing, kitchen west bay,
//            diner east bay, the showers north-east) and
//            the 2026 site bearing (Chiba's panels face south);
//   layer 3  the drone surroundings (WorldMarsForkLand.ts).
// Only the fork changes: the root /w/mars (the laptop's old-world release) keeps its exact behaviour.
import { BASE } from './base-path.ts';
import { worldKey } from './world-path.ts';

/** This page is the operator's Mars fork under a launcher base (never the root /w/mars). */
export const marsFork = BASE !== '' && worldKey === 'mars';

/** Layers 1 + 2 baked into one static campus GLB in /browser/campus.glb's own frame (same `at`, same hide rules):
 *  tools/god-skill/scripts/mars-two/fork-backdrop.mjs, from the Mars viewer source 076d458 (release 43 + Gene's
 *  corrections in TRUE compass, the sim.mars.college deploy candidate; MARSFIX) on release 43's campus.glb, BLOBS-encoded.
 *  `blob` is the content-addressed copy on eden2 (/srv/sim-blobs); `local` is the same file under the fork server's
 *  marsWebDir (local runs have no /blobs). Superseded bakes: 064a2541… (c8179e8), 70f0cfff… (7d9688f). */
export const MARS_FORK_BACKDROP = Object.freeze({
  source: '076d458a3d8e8f0332c744a0724386b0b7cd82c4',
  sha256: '909504a44dc358530fd5b426e6068100a65b6bad7686caefa2e73c77af844976',
  bytes: 41912564,
  blob: '/blobs/assets/90/909504a44dc358530fd5b426e6068100a65b6bad7686caefa2e73c77af844976.glb',
  local: '/browser/campus-owner-076d458a3d8e.glb',
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
  for (const [k, v] of Object.entries(rows)) if (!/\/blobs\/assets\/0d\/0d473682/.test(k)) out[k] = v;
  out[MARS_FORK_BACKDROP.blob] = MARS_FORK_BACKDROP.bytes;
  return out;
}

/** The 2026 site bearing (sun.ts convention, degrees added to a compass azimuth): Chiba's solar slope faces due south.
 *  The Mars viewer source carries the same value as YEAR_NORTH_AZIMUTH_OFFSET[2026] (mars-src-fix afc9d81); the mars-two
 *  world's BEARING 90 is the same orientation (tools/god-skill/scripts/mars-two/frame.mjs). */
export const MARS_2026_NORTH_OFFSET = -65;
