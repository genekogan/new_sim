// Pure extraction core for the procedural historical years (2020–2025, spec §21):
// Kit components (world-space triangles + stable ids) → the same compact
// obstacle rows / regions / file schema as the 2026 GLB extractor. The three.js
// scene build lives in deploy/history-scenes.mjs; this file is deterministic TS.
import type { Vec2 } from '../core/math.ts';
import { hashOf } from '../core/hash.ts';
import type { Confidence, Region } from '../world/types.ts';
import { fitPieces, GROUND_Y, LOW_BAND } from './extract.ts';
import { clipTrianglesToBandPolys, clusterPolygons, convexHull } from './geom.ts';
import { obbCorners, hypot } from '../core/math.ts';
import type { ObstacleKind, ObstacleRow } from './types.ts';
import { CAMPUS_SCENE_SCHEMA } from './types.ts';
import type { CampusYearFile } from './history.ts';

export type HistoryComponentInput = {
  id: string; // stable Kit component_id (docs/engineering/HISTORY_IDS.md)
  kind: string; // Kit definition name ('rack upright', 'salvaged glazing', …)
  layer: string;
  assembly: string;
  confidence: Confidence;
  /** The scene flags the mesh `walkNoCollision`: only its overhead part is kept. */
  walkThrough: boolean;
  /** World-space triangles, 9 numbers each. */
  tris: Float64Array;
};

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const VEHICLE_KIND = /vehicle|trailer|windscreen|rv window|roof ac/i;
const GLASS_KIND = /glaz|glass|translucent|plexi|acrylic|polycarb/i;

export function classifyHistory(c: Pick<HistoryComponentInput, 'kind' | 'layer' | 'assembly'>): { kind: ObstacleKind; name: string } {
  if (/^rv-\d+$/.test(c.assembly) || VEHICLE_KIND.test(c.kind)) return { kind: 'vehicle', name: c.kind };
  if (GLASS_KIND.test(c.kind)) return { kind: 'glass', name: `${c.kind} (glass/plexiglass not distinguished)` };
  if (c.layer === 'Walls and screens') return { kind: 'wall', name: c.kind };
  if (c.layer === 'Interior details' || /solar|photovoltaic/i.test(c.kind)) return { kind: 'fixture', name: c.kind };
  return { kind: 'solid', name: c.kind };
}

/** 2020 group confidence ('high' | 'medium' | 'low') or a Kit `source` note → engine Confidence. */
export function historyConfidence(note: string | undefined): Confidence {
  if (!note || note === 'low' || note === 'medium' || /provisional|approximate|estimated/i.test(note)) return 'provisional';
  return 'inferred';
}

export type HistoryExtracted = { rows: ObstacleRow[]; labels: string[]; stats: Record<string, number> };

/**
 * As extract.ts `extractObstacles`, minus the GLB-specific rules: per component,
 * geometry inside the ground body band → one prism per cluster (`id`, `id.1` …),
 * geometry above it → `id.up…` (overhead only). No `interior:` prisms: every
 * procedural hall has a ground-floor deck (top 0.41 m above ground > step 0.22),
 * which already blocks its footprint. `walkThrough` components emit only `.up`.
 */
export function extractHistoryObstacles(components: HistoryComponentInput[], assemblyNames: Record<string, string>): HistoryExtracted {
  const labels: string[] = [];
  const labelIdx = new Map<string, number>();
  const L = (s: string) => {
    let i = labelIdx.get(s);
    if (i === undefined) { i = labels.length; labels.push(s); labelIdx.set(s, i); }
    return i;
  };
  const rows: ObstacleRow[] = [];
  const stats: Record<string, number> = { components: 0, lowPrisms: 0, upperPrisms: 0, skippedFlat: 0, walkThroughLowDropped: 0 };
  const sorted = [...components].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const [b0, b1] = LOW_BAND;
  for (const c of sorted) {
    if (!c.tris.length) continue;
    stats.components++;
    let ymin = Infinity, ymax = -Infinity;
    for (let k = 1; k < c.tris.length; k += 3) { const y = c.tris[k]; if (y < ymin) ymin = y; if (y > ymax) ymax = y; }
    const { kind, name } = classifyHistory(c);
    const label = L(`${name} · ${assemblyNames[c.assembly] ?? c.assembly}`);
    const emit = (polys: Vec2[][], prefix: string, y0: number, y1: number, cell: number) => {
      const pieces = clusterPolygons(polys, cell).flatMap((cl) => fitPieces(cl));
      const thin = y1 - y0 < 0.02; // zero-thickness sheets get a 2 cm slab
      pieces.forEach((o, i) => rows.push([i === 0 ? prefix : `${prefix}.${i}`, kind, o.c[0], o.c[1], o.half[0], o.half[1], o.yaw,
        r3(thin ? (y0 + y1) / 2 - 0.01 : y0), r3(thin ? (y0 + y1) / 2 + 0.01 : y1), label, c.confidence, c.assembly, c.id]));
      return pieces.length;
    };
    if (ymax <= b0) { stats.skippedFlat++; continue; }
    if (ymin < b1) {
      if (c.walkThrough) stats.walkThroughLowDropped++;
      else {
        const polys = clipTrianglesToBandPolys(c.tris, b0, b1);
        if (polys.length) stats.lowPrisms += emit(polys, c.id, ymin, Math.min(ymax, b1), 0.5);
      }
    }
    if (ymax > b1) {
      const polys = clipTrianglesToBandPolys(c.tris, Math.max(b1, ymin), ymax);
      if (polys.length) stats.upperPrisms += emit(polys, `${c.id}.up`, Math.max(b1, ymin), ymax, 1.0);
    }
  }
  return { rows, labels, stats };
}

/** One convex hull per assembly (from its ground-band prisms); vehicles/trailers included. */
export function historyRegions(assemblies: { id: string; name: string; confidence: Confidence }[], rows: ObstacleRow[]): Region[] {
  const out: Region[] = [];
  for (const a of assemblies) {
    const pts: Vec2[] = rows
      .filter((r) => r[11] === a.id && !r[0].includes('.up'))
      .flatMap((r) => obbCorners({ c: [r[2], r[3]], half: [r[4], r[5]], yaw: r[6] }));
    if (pts.length < 3) continue;
    out.push({
      id: a.id,
      label: a.name,
      kind: 'place',
      polygon: convexHull(pts).map((p) => [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100]),
      provenance: { origin: 'canonical', confidence: a.confidence, evidence: ['app/history/scenes.ts assemblies'], note: 'convex hull of the assembly obstacle prisms (procedural photographic reconstruction)' },
    });
  }
  return out;
}

export type YearBuildInput = {
  year: number;
  generator: string;
  source: CampusYearFile['source'];
  assemblies: { id: string; name: string; confidence: Confidence }[];
  components: HistoryComponentInput[];
  /** The year's measured site bearing (engine/env/sun.ts YEAR_NORTH_AZIMUTH_OFFSET); omitted = the global. */
  northAzimuthOffset?: number;
};

/** Everything a year file holds, with `contentHash = hashOf(file minus contentHash)`. */
export function buildYearFile(inp: YearBuildInput): CampusYearFile {
  const names = Object.fromEntries(inp.assemblies.map((a) => [a.id, a.name]));
  const ex = extractHistoryObstacles(inp.components, names);
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const r of ex.rows) {
    const e = hypot(r[4], r[5]);
    minX = Math.min(minX, r[2] - e); maxX = Math.max(maxX, r[2] + e); minZ = Math.min(minZ, r[3] - e); maxZ = Math.max(maxZ, r[3] + e);
  }
  const m = 10; // open-ground margin beyond the outermost object
  const file: Omit<CampusYearFile, 'contentHash'> = {
    schema: CAMPUS_SCENE_SCHEMA,
    campus: `mars-${inp.year}`,
    year: inp.year,
    generator: inp.generator,
    source: inp.source,
    groundY: GROUND_Y,
    ...(inp.northAzimuthOffset !== undefined ? { northAzimuthOffset: inp.northAzimuthOffset } : {}),
    bands: { low: LOW_BAND, note: 'low prisms = geometry within the ground body band; .up = above it (overhead). No walkable decks/stairs: none are declared by the procedural scene.' },
    bounds: [Math.floor(minX - m), Math.floor(minZ - m), Math.ceil(maxX + m), Math.ceil(maxZ + m)],
    assemblies: inp.assemblies.map((a) => ({ id: a.id, name: a.name })),
    labels: ex.labels,
    obstacles: ex.rows,
    regions: historyRegions(inp.assemblies, ex.rows),
    stats: ex.stats,
  };
  return { ...file, contentHash: hashOf(file) };
}
