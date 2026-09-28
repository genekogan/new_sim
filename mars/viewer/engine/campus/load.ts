// Runtime side: campus scene file → provenance-tagged SpatialScene, plus
// cropping for local work areas. Pure (no fs / fetch): callers pass the parsed
// JSON (Node: engine/campus/node.ts; browser: fetch CAMPUS_2026_URL).
import { obbCorners, obbOverlap, type OBB2 } from '../core/math.ts';
import type { Provenance } from '../world/types.ts';
import type { CampusObstacle, CampusScene, CampusSceneFile, CampusSurface } from './types.ts';
import { CAMPUS_SCENE_SCHEMA } from './types.ts';

export const CAMPUS_2026_URL = '/engine/campus-2026.json';

export const GROUND_PROVENANCE: Provenance = {
  origin: 'canonical',
  confidence: 'provisional',
  note: 'flat ground plane at y=-0.16 (the reconstruction has no terrain model)',
};

export const WALKABILITY_NOTES = [
  'Only the ground plane (level 0) is walkable.',
  'Decks, upper floors and roofs are NOT walkable: the reconstruction does not identify stairs or verified floor extents, and unknown ≠ walkable.',
  'Covered space under building roofs/upper floors is blocked by explicit interior:* prisms (unverified interiors, non-walkable by rule).',
  'Obstacle prisms are fitted to CAD render geometry, dimensions not field verified (confidence inferred).',
];

export function sceneFromFile(f: Omit<CampusSceneFile, 'contentHash'> & { contentHash?: string }): CampusScene {
  if (f.schema !== CAMPUS_SCENE_SCHEMA) throw new Error(`campus scene: unexpected schema ${String(f.schema)}`);
  const obstacles: CampusObstacle[] = f.obstacles.map((r) => ({
    id: r[0],
    kind: r[1],
    obb: { c: [r[2], r[3]], half: [r[4], r[5]], yaw: r[6] },
    y0: r[7],
    y1: r[8],
    label: f.labels[r[9]],
    component: r[12],
    assembly: r[11],
    provenance: { origin: 'canonical', confidence: r[10], evidence: [f.source.glb, `component ${r[12]}`] },
  }));
  const [x0, z0, x1, z1] = f.bounds;
  const ground: CampusSurface = {
    id: 'ground',
    level: 0,
    y: f.groundY,
    obb: { c: [(x0 + x1) / 2, (z0 + z1) / 2], half: [(x1 - x0) / 2, (z1 - z0) / 2], yaw: 0 },
    label: 'open ground (flat, y=-0.16)',
    provenance: GROUND_PROVENANCE,
    walkableReason: 'open desert ground between structures; blocked wherever an obstacle prism intersects the body band',
  };
  return {
    bounds: f.bounds,
    levels: [{ id: 0, y: f.groundY, label: 'ground' }],
    surfaces: [ground],
    obstacles,
    links: [],
    regions: f.regions,
    meta: { groundY: f.groundY, contentHash: f.contentHash ?? '', source: f.source, notes: WALKABILITY_NOTES, ...(f.northAzimuthOffset !== undefined ? { northAzimuthOffset: f.northAzimuthOffset } : {}) },
  };
}

const obbOf = (b: [number, number, number, number]): OBB2 => ({ c: [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2], half: [(b[2] - b[0]) / 2, (b[3] - b[1]) / 2], yaw: 0 });

/**
 * Local work area: keep obstacles/regions touching `bounds`, clip the ground to
 * it. Grid cost scales with area, so interactive work uses e.g. ±40 m crops.
 */
export function cropScene(scene: CampusScene, bounds: [number, number, number, number]): CampusScene {
  const [ax, az, bx, bz] = scene.bounds;
  const b: [number, number, number, number] = [Math.max(ax, bounds[0]), Math.max(az, bounds[1]), Math.min(bx, bounds[2]), Math.min(bz, bounds[3])];
  if (b[0] >= b[2] || b[1] >= b[3]) throw new Error(`cropScene: bounds ${bounds.join(',')} do not intersect the campus`);
  const box = obbOf(b);
  const surfaces = scene.surfaces
    .filter((s) => obbOverlap(s.obb, box))
    .map((s) => (s.id === 'ground' ? { ...s, obb: box } : s));
  const regions = scene.regions.filter((r) => {
    const xs = r.polygon.map((p) => p[0]), zs = r.polygon.map((p) => p[1]);
    return Math.max(...xs) >= b[0] && Math.min(...xs) <= b[2] && Math.max(...zs) >= b[1] && Math.min(...zs) <= b[3];
  });
  return {
    ...scene,
    bounds: b,
    surfaces,
    obstacles: scene.obstacles.filter((o) => obbOverlap(o.obb, box)),
    links: scene.links.filter((l) => obbOverlap({ c: l.from.p, half: [0.5, 0.5], yaw: 0 }, box) && obbOverlap({ c: l.to.p, half: [0.5, 0.5], yaw: 0 }, box)),
    regions,
  };
}

/** Axis-aligned bounds of an OBB (for quick filters). */
export function obbBounds(o: OBB2): [number, number, number, number] {
  const cs = obbCorners(o);
  return [Math.min(...cs.map((c) => c[0])), Math.min(...cs.map((c) => c[1])), Math.max(...cs.map((c) => c[0])), Math.max(...cs.map((c) => c[1]))];
}
