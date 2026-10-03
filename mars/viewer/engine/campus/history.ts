// Canonical historical campus years (spec §21: 2020–2025 as protected, forkable
// states). Scene files are generated from the procedural Kit scenes by
// deploy/history-scenes.mjs into public/engine/campus-<year>.json, in the same
// schema as campus-2026.json. Pure (no fs / fetch): callers pass the parsed JSON
// (Node: history-node.ts `loadCampusFile(year)`; browser: fetch(campusYearUrl(year))).
import { seedRng } from '../core/rng.ts';
import type { WorldHistory, Workspace } from '../history/store.ts';
import type { Provenance, WorldState } from '../world/types.ts';
import { WORLD_SCHEMA } from '../world/types.ts';
import type { CampusObstacle, CampusScene, CampusSceneFile, CampusSurface } from './types.ts';
import { CAMPUS_SCENE_SCHEMA } from './types.ts';

export const HISTORY_YEARS = [2020, 2021, 2022, 2023, 2024, 2025] as const;
export type HistoryYear = (typeof HISTORY_YEARS)[number];

/** Same schema as campus-2026.json; `campus` is `mars-<year>` and `source` names the procedural scene. */
export type CampusYearFile = Omit<CampusSceneFile, 'campus' | 'source'> & {
  campus: `mars-${number}`;
  year: number;
  source: { scene: string; kit: string; ids: string; notes: string; limitations: string[] };
};

export const campusYearId = (year: number) => `mars-${year}`;
export const campusYearUrl = (year: number) => `/engine/campus-${year}.json`;

export const YEAR_WALKABILITY_NOTES = [
  'Only the ground plane (level 0) is walkable; there are no links or stairs.',
  'Decks, upper floors, roofs and stairs are NOT walkable: the procedural scene draws them but declares no walkable surface, and unknown ≠ walkable.',
  'Building footprints block walking through their ground-floor decks (top 0.41 m above ground > the 0.22 m step).',
  'Meshes the scene flags walkNoCollision (stair risers, the 2021 aluminet and MARS letters) keep only their overhead part.',
  'Prisms are fitted to the procedural photographic reconstruction; placement and dimensions are provisional.',
];

function assertYear(year: number, f: { schema: string; year?: number; campus: string }) {
  if (f.schema !== CAMPUS_SCENE_SCHEMA) throw new Error(`campus ${year}: unexpected schema ${String(f.schema)}`);
  if (f.year !== year || f.campus !== campusYearId(year)) throw new Error(`campus ${year}: file is for ${f.campus}`);
}

/** Year file → provenance-tagged SpatialScene (ground only; same shape as campus 2026). */
export function sceneFromYearFile(year: number, f: CampusYearFile): CampusScene {
  assertYear(year, f);
  const evidence = `${f.source.scene} (${f.source.ids})`;
  const obstacles: CampusObstacle[] = f.obstacles.map((r) => ({
    id: r[0],
    kind: r[1],
    obb: { c: [r[2], r[3]], half: [r[4], r[5]], yaw: r[6] },
    y0: r[7],
    y1: r[8],
    label: f.labels[r[9]],
    component: r[12],
    assembly: r[11],
    provenance: { origin: 'canonical', confidence: r[10], evidence: [evidence, `component ${r[12]}`], note: f.source.notes },
  }));
  const [x0, z0, x1, z1] = f.bounds;
  const groundProv: Provenance = { origin: 'canonical', confidence: 'provisional', note: `flat ground plane at y=${f.groundY} (procedural scene; no terrain model)` };
  const ground: CampusSurface = {
    id: 'ground',
    level: 0,
    y: f.groundY,
    obb: { c: [(x0 + x1) / 2, (z0 + z1) / 2], half: [(x1 - x0) / 2, (z1 - z0) / 2], yaw: 0 },
    label: `open ground ${year} (flat, y=${f.groundY})`,
    provenance: groundProv,
    walkableReason: 'open desert ground between structures; blocked wherever an obstacle prism intersects the body band',
  };
  return {
    bounds: f.bounds,
    levels: [{ id: 0, y: f.groundY, label: 'ground' }],
    surfaces: [ground],
    obstacles,
    links: [],
    regions: f.regions,
    meta: {
      groundY: f.groundY,
      contentHash: f.contentHash,
      source: { glb: f.source.scene, glbBytes: 0, manifest: f.source.kit, status: f.source.notes },
      notes: [...YEAR_WALKABILITY_NOTES, f.source.notes, ...f.source.limitations],
      ...(f.northAzimuthOffset !== undefined ? { northAzimuthOffset: f.northAzimuthOffset } : {}),
      ...(f.assemblies.some(a=>a.parent)?{assemblyParents:Object.fromEntries(f.assemblies.filter(a=>a.parent).map(a=>[a.id,a.parent!]))}:{}),
    },
  };
}

export type CampusYear = { year: number; base: CampusScene; world: WorldState };

/** Canonical world for a historical year: static campus as `base`, regions, no people, no inventory. */
export function loadCampusYear(year: number, file: CampusYearFile): CampusYear {
  const base = sceneFromYearFile(year, file);
  const id = campusYearId(year);
  const world: WorldState = {
    schema: WORLD_SCHEMA,
    base: { campus: id, staticHash: file.contentHash },
    tick: 0,
    entities: {},
    regions: Object.fromEntries(base.regions.map((r) => [r.id, r])),
    env: { datetime: `${year}-03-01T16:00`, weather: { clouds: 0, rain: 0, wind: 0, dust: 0, wet: 0 } },
    inventory: 'finite',
    rng: seedRng(id),
  };
  return { year, base, world };
}

/** Publish protected canonical `mars-<year>`; commits to it are refused (HistoryError 'protected'). */
export function publishCampusYear(history: WorldHistory, year: number, file: CampusYearFile): { canonical: Workspace; base: CampusScene } {
  const { base, world } = loadCampusYear(year, file);
  const canonical = history.publishCanonical(campusYearId(year), `Mars ${year} (procedural photographic reconstruction, canonical)`, world,
    `generated from ${file.source.scene}; see docs/engineering/CAMPUS_SCENE.md`);
  return { canonical, base };
}

/** A new editable workspace forked from canonical `mars-<year>`. */
export function forkCampusYear(history: WorldHistory, year: number, id: string, label: string): Workspace {
  return history.fork(campusYearId(year), id, label);
}
