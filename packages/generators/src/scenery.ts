// Scenery beyond the edge of the walkable world (lane MARSLAND-FAR). Two point-form, non-solid generators a god
// places once at the world's centre:
//  - far-land/1: the coarse ground from the extent edge out to ~2.3 km, vertex-painted from data (areas, strips,
//    roads with optional pole lines, a sea), with sparse shrub mounds. Joins the terrain at the edge.
//  - panorama/1: mountain ranges at real distances (5–50 km) as a camera-following ring drawn behind everything
//    (like a skybox, no parallax), hazed toward the horizon, plus far water and a ground skirt below the horizon.
// Both replace the generic green horizon ring of the entity view (they carry the `horizon` tag).
// Coordinates in params are metres relative to the entity (x east, z south: north is -z). Bearings are compass
// degrees (0 = north = -z, 90 = east = +x). Physics is trivial (no colliders, nothing walkable): the picture is the
// mesh half (apps/web/src/gen-mesh/scenery.mesh.ts).
import { n } from './geom.ts';
import type { Generator, Vec2 } from './types.ts';

/** Ground finishes a far-land feature may name (or give `c: '#hex'`). Kept in step with the mesh half's colours. */
export const FAR_MATERIALS = ['playa', 'salt', 'flats', 'beach', 'scrub', 'wash', 'delta', 'mud', 'track', 'sand', 'grass', 'rock', 'dirt'] as const;

type Feat = { pts?: unknown; w?: unknown };
const list = (v: unknown): Feat[] => (Array.isArray(v) ? (v as Feat[]).filter((f) => f && typeof f === 'object' && Array.isArray(f.pts)) : []);
const pts = (f: Feat): Vec2[] => (f.pts as unknown[]).filter((p): p is Vec2 => Array.isArray(p) && p.length === 2 && p.every((q) => typeof q === 'number' && Number.isFinite(q)));
const length = (p: Vec2[]) => { let l = 0; for (let i = 1; i < p.length; i++) l += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]); return l; };

export const farLandGen: Generator = {
  id: 'far-land/1', form: 'point', owner: 'MARSLAND-FAR',
  doc: 'The land beyond the walkable edge, out to `radius`: coarse low-poly ground painted from data — areas and strips (salt flat, beach, scrub band, wash, delta…), roads (asphalt, lines, shoulders, pole lines) and a sea polygon at a level. Place once at the world centre; replaces the green horizon ring.',
  params: {
    radius: { type: 'number', min: 600, max: 2400, default: 2300, doc: 'outer reach from the entity (m); the view ends near 2.1 km from the camera' },
    ground: { type: 'color', doc: 'base colour beyond the edge (default: the terrain palette at the edge)' },
    mottle: { type: 'number', min: 0, max: 1, default: 0.5, doc: 'patchiness of every finish' },
    areas: { type: 'json', doc: '[{pts:[[x,z]…], m:"salt"|…|c:"#hex", edge?:m, shrubs?:per-ha}] polygons, painted in order' },
    strips: { type: 'json', doc: '[{pts:[[x,z]…], w:m, m|c, edge?, shrubs?}] polylines with a width (washes, bands, tracks, beaches)' },
    roads: { type: 'json', doc: '[{pts:[[x,z]…], w?:12, lines?:true, poles?:{side:1|-1, every:60, h:10}}] asphalt with centre and edge lines, gravel shoulders' },
    sea: { type: 'json', doc: '{pts:[[x,z]…], level?:-1 (m from base), c?:"#hex", beach?:m} water polygon (may reach far past the radius)' },
  },
  physics({ params }) {
    const R = n(params.radius, 2300), areas = list(params.areas), strips = list(params.strips), roads = list(params.roads);
    const ring = 300 * 40 * 2;
    let shrubs = 0;
    for (const f of [...areas, ...strips]) shrubs += Number((f as { shrubs?: unknown }).shrubs ?? 0) > 0 ? 1 : 0;
    let roadTris = 0, poles = 0;
    for (const r of roads) { const l = Math.min(length(pts(r)), 2 * R); roadTris += Math.ceil(l / 20) * 14; const p = (r as { poles?: { every?: number } }).poles; if (p) poles += Math.ceil(l / Math.max(20, n(p.every, 60))); }
    const tris = ring + roadTris + poles * 20 + Math.min(2000, shrubs * 600) * 15 + (params.sea ? 64 : 0);
    return {
      box: [10, 1, 10], colliders: [], slots: [], tris,
      notes: [`far land out to ${Math.round(R)} m: ${areas.length} areas, ${strips.length} strips, ${roads.length} roads${poles ? ` (${poles} poles)` : ''}${params.sea ? ', a sea' : ''}; nothing walkable, drawn beyond the extent only`],
    };
  },
};

export const panoramaGen: Generator = {
  id: 'panorama/1', form: 'point', owner: 'MARSLAND-FAR',
  doc: 'Far mountain ranges at real distances (5–50 km) drawn as a ring that follows the camera (no parallax, behind everything): each range {from, to (compass °), d m, h m, rough, c, haze}; optional far water and its far shore, hazed to the horizon. Place once; replaces the green horizon ring.',
  params: {
    ranges: { type: 'json', doc: '[{from:°, to:°, d:m, h:m, rough?:0..1, c:"#hex", c2?:"#hex" (strata), bands?:0..1, haze?:mult, foothills?:0..1, seed?, profile?:[0..1…]}] bearings clockwise from north' },
    water: { type: 'json', doc: '{from:°, to:°, c?:"#hex", far?:"#hex"} far water from the near shore to the horizon' },
    ground: { type: 'color', doc: 'below-horizon skirt where no water is (default: the terrain palette\'s plain)' },
    haze: { type: 'color', default: '#c6d6e2', doc: 'air colour at the horizon' },
    visibility: { type: 'number', min: 5000, max: 300000, default: 70000, doc: 'distance (m) at which the air hides ~63% of a far range' },
  },
  physics({ params }) {
    const ranges = Array.isArray(params.ranges) ? params.ranges.length : 0;
    return { box: [10, 1, 10], colliders: [], slots: [], tris: ranges * 720 * 4 + 1440, notes: [`panorama: ${ranges} ranges${params.water ? ', far water' : ''}; drawn behind everything, follows the camera`] };
  },
};

export const SCENERY_GENERATORS = [farLandGen, panoramaGen];
