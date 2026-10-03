// Named regions for the 2026 campus: canonical assembly footprints plus the
// hypothetical flagship work areas (staging-east, material piles), found by a
// deterministic clear-rectangle search on the engine grid near Chiba.
import { obbCorners, obbOverlap, type OBB2, type Vec2, hypot } from '../core/math.ts';
import { buildGrids } from '../spatial/grid.ts';
import type { Region } from '../world/types.ts';
import { convexHull } from './geom.ts';
import { cropScene, sceneFromFile } from './load.ts';
import type { CampusObstacle, CampusSceneFile } from './types.ts';

export const STAGING = { w: 22, d: 16, margin: 1 }; // region 22×16 m (≥ 20×15 required), +1 m clear margin
/** Pile footprints sized for items laid side by side on the ground with crew access gaps (see world.ts). */
export const PILES: { id: string; label: string; w: number; d: number }[] = [
  { id: 'pile-uprights', label: 'Upright pile (hypothetical)', w: 8, d: 9.5 },
  { id: 'pile-beams', label: 'Beam pile (hypothetical)', w: 6, d: 7 },
  { id: 'pile-timber', label: '2x4 + plywood pile (hypothetical)', w: 11, d: 7 },
];
const PILE_MARGIN = 0.5;
const SEARCH_CELL = 0.25;

const HYPOTHETICAL_NOTE = 'flagship scenario work area in a fork of 2026 — hypothetical, not historical';

/** SAT overlap of two convex polygons, with a clearance gap (m). */
export function convexOverlap(a: Vec2[], b: Vec2[], gap = 0): boolean {
  for (const poly of [a, b])
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const len = hypot(q[0] - p[0], q[1] - p[1]) || 1;
      const n: Vec2 = [-(q[1] - p[1]) / len, (q[0] - p[0]) / len];
      let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
      for (const v of a) { const d = v[0] * n[0] + v[1] * n[1]; amin = Math.min(amin, d); amax = Math.max(amax, d); }
      for (const v of b) { const d = v[0] * n[0] + v[1] * n[1]; bmin = Math.min(bmin, d); bmax = Math.max(bmax, d); }
      if (amax + gap <= bmin || bmax + gap <= amin) return false;
    }
  return true;
}

const rectPoly = (cx: number, cz: number, w: number, d: number): [number, number][] =>
  [[cx - w / 2, cz - d / 2], [cx + w / 2, cz - d / 2], [cx + w / 2, cz + d / 2], [cx - w / 2, cz + d / 2]];

/** Obstacles that block standing/walking on the ground (intersect the body band). */
export function groundBlockers(obs: CampusObstacle[], groundY: number): CampusObstacle[] {
  return obs.filter((o) => o.y1 > groundY + 0.22 && o.y0 < groundY + 1.8);
}

/** Exact check: ids of ground-blocking obstacles overlapping an OBB. */
export function blockersIn(obs: CampusObstacle[], groundY: number, area: OBB2): string[] {
  return groundBlockers(obs, groundY).filter((o) => obbOverlap(o.obb, area)).map((o) => o.id);
}

type FileNoRegions = Omit<CampusSceneFile, 'contentHash' | 'regions'> & { regions?: Region[] };

export function assemblyRegions(file: FileNoRegions, obs: CampusObstacle[]): Region[] {
  const out: Region[] = [];
  for (const a of file.assemblies) {
    if (a.id === 'site-context') continue; // scattered vehicles/shelters: not one place
    const pts: Vec2[] = obs.filter((o) => o.assembly === a.id && !o.id.includes('.up')).flatMap((o) => obbCorners(o.obb));
    if (pts.length < 3) continue;
    out.push({
      id: a.id,
      label: a.name,
      kind: 'place',
      polygon: convexHull(pts).map((p) => [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100]),
      provenance: { origin: 'canonical', confidence: 'inferred', evidence: ['components.json assemblies'], note: 'convex hull of the assembly obstacle prisms' },
    });
  }
  return out;
}

export function buildRegions(file: FileNoRegions): Region[] {
  const scene = sceneFromFile({ ...file, regions: [] });
  const regions = assemblyRegions(file, scene.obstacles);
  const chiba = regions.find((r) => r.id === 'chiba');
  if (!chiba) throw new Error('buildRegions: no chiba assembly');
  const xs = chiba.polygon.map((p) => p[0]), zs = chiba.polygon.map((p) => p[1]);
  const cMinX = Math.min(...xs), cMaxX = Math.max(...xs), cMinZ = Math.min(...zs), cMaxZ = Math.max(...zs);
  const cc: Vec2 = [(cMinX + cMaxX) / 2, (cMinZ + cMaxZ) / 2];
  const crop = cropScene(scene, [cMinX - 20, cMinZ - 40, cMaxX + 90, cMaxZ + 40]);
  const g = buildGrids(crop, SEARCH_CELL).levels.get(0)!;
  // integral image of blocked cells
  const W = g.nx + 1;
  const S = new Int32Array(W * (g.nz + 1));
  for (let j = 0; j < g.nz; j++) for (let i = 0; i < g.nx; i++)
    S[(j + 1) * W + i + 1] = (g.free[j * g.nx + i] ? 0 : 1) + S[j * W + i + 1] + S[(j + 1) * W + i] - S[j * W + i];
  const clear = (cx: number, cz: number, w: number, d: number) => {
    const i0 = Math.floor((cx - w / 2 - g.x0) / g.cell), i1 = Math.ceil((cx + w / 2 - g.x0) / g.cell);
    const j0 = Math.floor((cz - d / 2 - g.z0) / g.cell), j1 = Math.ceil((cz + d / 2 - g.z0) / g.cell);
    if (i0 < 0 || j0 < 0 || i1 > g.nx || j1 > g.nz) return false;
    return S[j1 * W + i1] - S[j0 * W + i1] - S[j1 * W + i0] + S[j0 * W + i0] === 0;
  };
  const blockers = groundBlockers(crop.obstacles, file.groundY);
  const places = regions.map((r) => r.polygon as Vec2[]);
  const offPlaces = (cx: number, cz: number, w: number, d: number, gap: number) => !places.some((pl) => convexOverlap(pl, rectPoly(cx, cz, w, d), gap));
  const exactClear = (cx: number, cz: number, w: number, d: number) =>
    !blockers.some((o) => obbOverlap(o.obb, { c: [cx, cz], half: [w / 2, d / 2], yaw: 0 }));
  // staging: east of Chiba (+x), nearest clear 24×18 m rectangle
  const sw = STAGING.w + 2 * STAGING.margin, sd = STAGING.d + 2 * STAGING.margin;
  let staging: Vec2 | null = null, best = Infinity;
  for (let cx = Math.ceil(cMaxX - 10); cx <= cMaxX + 70; cx++)
    for (let cz = Math.floor(cMinZ - 25); cz <= cMaxZ + 25; cz++) {
      const dd = hypot(cx - cMaxX, cz - cc[1]);
      if (dd >= best || cx < cc[0]) continue;
      if (offPlaces(cx, cz, sw, sd, 3) && clear(cx, cz, sw, sd) && exactClear(cx, cz, sw, sd)) { best = dd; staging = [cx, cz]; }
    }
  if (!staging) throw new Error('buildRegions: no clear 24×18 m staging area east of Chiba');
  const hyp = { origin: 'design-edit' as const, confidence: 'hypothetical' as const, note: HYPOTHETICAL_NOTE };
  regions.push({ id: 'staging-east', label: 'Staging east of Chiba (hypothetical flagship build site)', kind: 'staging', polygon: rectPoly(staging[0], staging[1], STAGING.w, STAGING.d), provenance: hyp });
  // material piles: nearest clear 9×6 m spots around staging, ≥ 2 m apart from staging and each other
  const taken: OBB2[] = [{ c: staging, half: [sw / 2 + 2, sd / 2 + 2], yaw: 0 }];
  for (const { id, label, w, d } of PILES) {
    const pw = w + 2 * PILE_MARGIN, pd = d + 2 * PILE_MARGIN;
    let spot: Vec2 | null = null, bd = Infinity;
    for (let cx = Math.floor(staging[0] - 30); cx <= staging[0] + 30; cx++)
      for (let cz = Math.floor(staging[1] - 30); cz <= staging[1] + 30; cz++) {
        const dd = hypot(cx - staging[0], cz - staging[1]);
        if (dd >= bd) continue;
        const box: OBB2 = { c: [cx, cz], half: [pw / 2 + 1, pd / 2 + 1], yaw: 0 };
        if (taken.some((t) => obbOverlap(t, box))) continue;
        if (offPlaces(cx, cz, pw, pd, 2) && clear(cx, cz, pw, pd) && exactClear(cx, cz, pw, pd)) { bd = dd; spot = [cx, cz]; }
      }
    if (!spot) throw new Error(`buildRegions: no clear spot for ${id}`);
    taken.push({ c: spot, half: [pw / 2 + 1, pd / 2 + 1], yaw: 0 });
    regions.push({ id, label, kind: 'material-pile', polygon: rectPoly(spot[0], spot[1], w, d), provenance: { ...hyp, note: 'flagship scenario inventory, not historical' } });
  }
  return regions;
}
