// Each room keeps the synthetic proving ground and carry yard; when a campus
// file is supplied it also publishes that year's protected reconstruction.
// Callers must fork canonical workspaces before editing or executing.
import { WorldHistory } from '../history/store.ts';
import { campusYearId, HISTORY_YEARS, publishCampusYear, sceneFromYearFile, type CampusYearFile } from '../campus/history.ts';
import { loadCampus2026 } from '../campus/world.ts';
import { sceneFromFile } from '../campus/load.ts';
import type { CampusSceneFile } from '../campus/types.ts';
import { provingGround } from '../scenes/proving-ground.ts';
import { carryCorridors } from '../carry/scenes.ts';
import type { SpatialScene } from '../spatial/types.ts';
import { addAll, component, emptyWorld, FIXTURE, human } from '../world/factory.ts';
import type { Entity, Region, WorldState } from '../world/types.ts';
import { ENGINE_RULES_VERSION } from './registry.ts';

export const ENGINE_SCENES: Record<string, SpatialScene> = {
  'proving-ground': provingGround(),
  'carry-yard': carryCorridors(),
};

/** A catalog fixture (bench, chair, campfire): a static obstacle by its catalog def, no phase. */
function fixture(id: string, defId: string, x: number, z: number, yaw = 0): Entity {
  return { id, def: defId, kind: 'fixture', pose: { p: [x, 0, z], yaw }, provenance: FIXTURE };
}

type SeedRegion = Region & { layout?: { focus: [number, number]; spacing?: number; rowGap?: number } };
const box = (x0: number, z0: number, x1: number, z1: number): [number, number][] => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
function withRegions(w: WorldState, ...regions: Omit<SeedRegion, 'provenance'>[]): WorldState {
  for (const r of regions) w.regions[r.id] = { ...r, provenance: FIXTURE } as Region;
  return w;
}

/** Proving ground: people n1, s1, p1; a staged plywood panel; west of the test wall a campfire with two benches and a lawn facing it. */
export function provingGroundWorld(): WorldState {
  const w = addAll(
    emptyWorld('proving-ground', ENGINE_SCENES['proving-ground']),
    human('n1', 15, -20, { yaw: Math.PI / 2 }),
    human('s1', 15, -10, { yaw: -Math.PI / 2 }),
    human('p1', 3.5, 12.5),
    component('panel', 'plywood-4x8', [-25, 0, 25], 0, { phase: 'staged', pose: { p: [-25, 0, 25], yaw: 0, roll: Math.PI / 2 } }),
    fixture('fire', 'campfire', -24, -2),
    fixture('bench-s', 'bench-6ft', -24, -5.2, 0), // seats face +z, toward the fire
    fixture('bench-n', 'bench-6ft', -24, 1.2, Math.PI), // seats face -z
  );
  return withRegions(
    w,
    { id: 'lawn', label: 'lawn (audience facing the fire)', kind: 'place', polygon: box(-29, -12, -19, -7), layout: { focus: [-24, -2] } },
    { id: 'staging', label: 'staging (panel)', kind: 'staging', polygon: box(-28, 22, -22, 28) },
    { id: 'deck', label: 'deck', kind: 'work-area', polygon: box(6, 7, 14, 13), level: 1 },
  );
}

/** Carry yard: beam b1 and crew p1, p2 in yard A; yard B empty; a campfire with two benches in yard B2 (clear of the corridor B mouth and its middle). */
export function carryYardWorld(): WorldState {
  const w = addAll(
    emptyWorld('carry-yard', ENGINE_SCENES['carry-yard']),
    component('b1', 'beam-12ft', [4, 0, 4], 0),
    human('p1', 2, 6.5),
    human('p2', 6, 1.5),
    fixture('fire', 'campfire', 16, 38),
    fixture('bench-s', 'bench-6ft', 15.6, 35.6, 0), // seats face +z, toward the fire
    fixture('bench-e', 'bench-6ft', 19.9, 38, Math.PI / 2), // seats face -x
  );
  return withRegions(
    w,
    { id: 'yard-a', label: 'yard A', kind: 'staging', polygon: box(0, 0, 8, 8) },
    { id: 'yard-b', label: 'yard B', kind: 'staging', polygon: box(0, 18, 8, 26) },
    { id: 'yard-b2', label: 'yard B2 (around the fire)', kind: 'place', polygon: box(14, 32, 22, 40), layout: { focus: [16, 38] } },
  );
}

export type RoomCampusFile = CampusYearFile | CampusSceneFile;
export type RoomCampusSeed = { year: number; file: RoomCampusFile };

/** A legacy workspace uses the new canonical id; never overwrite user work. */
export class CampusSeedConflict extends Error {
  code = 'room.campus-conflict';
}

/** Validate the requested year's file without inventing historical defaults. */
function validateCampusSeed(campus: RoomCampusSeed): void {
  const reconstructed = !('year' in campus.file);
  if (campus.file.campus !== campusYearId(campus.year) || reconstructed !== (campus.year === 2026))
    throw new Error(`room campus ${campus.year}: incompatible scene file ${campus.file.campus}`);
}

function publishRoomCampus(h: WorldHistory, campus: RoomCampusSeed) {
  validateCampusSeed(campus);
  if ('year' in campus.file) return publishCampusYear(h, campus.year, campus.file);
  const { world } = loadCampus2026(campus.file, { flagshipInventory: false });
  return h.publishCanonical('mars-2026', 'Mars 2026 (reconstructed campus, canonical)', world, 'CAD-derived reconstruction; see docs/engineering/CAMPUS_SCENE.md');
}

/**
 * A room's seed history: the synthetic proving ground and carry yard, plus — for a historical
 * year room (2020–2026) given that year's generated scene file — protected canonical
 * `mars-<year>` (static campus + regions, finite inventory; reconstructed 2026
 * includes its existing generic context people, no flagship inventory; fork it, then
 * engine_edit_world with inventory 'unlimited' to add people/materials).
 */
export function seedHistory(rulesVersion = ENGINE_RULES_VERSION, campus?: RoomCampusSeed): WorldHistory {
  const h = new WorldHistory(rulesVersion);
  h.publishCanonical('proving-ground', 'Proving ground (canonical, synthetic)', provingGroundWorld(), 'engine preview seed');
  h.publishCanonical('carry-yard', 'Carry corridors (canonical, synthetic)', carryYardWorld(), 'engine preview seed');
  if (campus) publishRoomCampus(h, campus);
  return h;
}

/** Years whose rooms also seed a canonical campus scene (`mars-<year>`). */
export const CAMPUS_SEED_YEARS: readonly number[] = [...HISTORY_YEARS, 2026];

/** Static scenes a room needs: the synthetic ones, plus `mars-<year>` when a year file is given. */
export function roomScenes(campus?: RoomCampusSeed): Record<string, SpatialScene> {
  if (!campus) return ENGINE_SCENES;
  validateCampusSeed(campus);
  const scene = 'year' in campus.file ? sceneFromYearFile(campus.year, campus.file) : sceneFromFile(campus.file);
  return { ...ENGINE_SCENES, [campusYearId(campus.year)]: scene };
}

/** Add canonical `mars-<year>` to a room history seeded before campus years existed. Returns whether it did. */
export function ensureCampusYear(h: WorldHistory, campus: RoomCampusSeed): boolean {
  const id = campusYearId(campus.year);
  const existing = h.workspaces.get(id);
  if (existing) {
    if (!existing.protected || h.read(id).base.campus !== id)
      throw new CampusSeedConflict(`cannot seed canonical ${id}: an existing workspace with that id is not its protected campus reconstruction; existing work was preserved. Use a new room or resolve the conflicting workspace before retrying`);
    return false;
  }
  publishRoomCampus(h, campus);
  return true;
}
