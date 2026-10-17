// upper-floors/1 (lane L4b, 2026-10-17; Gene's decision #5: fix old Eden's upper floors). One logged rules fact
// `upperFloorsV1` adds a building's upper floors to an existing world — or removes them again (the operator's rollback).
// Pure validation and the world-state change; the engine (engine.ts) re-bases its Spatial and the fold adds the rooms'
// kernel places. Geometry and its scene composition: mars/viewer/engine/spatial/edits.ts (UpperFloorsV1, withUpperFloors).
//   {version:'upper-floors/1', building:{id, label, crop, levels, surfaces, solids, links, regions}}   install
//   {version:'upper-floors/1', remove:'<building id>'}                                                  remove
import type { UpperFloorsBuildingV1, UpperFloorsV1 } from '../../../mars/viewer/engine/spatial/edits.ts';
import type { WorldState } from '../../../mars/viewer/engine/world/types.ts';
import { hashOf } from '@sim/engine-contract';

export type { UpperFloorsBuildingV1, UpperFloorsV1 };
export type UpperFloorsFactV1 = { version: 'upper-floors/1'; building: UpperFloorsBuildingV1 } | { version: 'upper-floors/1'; remove: string };
type Diag = { code: string; message: string };
const ID = /^[a-z0-9][a-z0-9._-]{0,99}$/;
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const v2 = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && v.every(fin);
const v3 = (v: unknown): v is [number, number, number] => Array.isArray(v) && v.length === 3 && v.every(fin);
const obbOk = (o: any) => !!o && v2(o.c) && v2(o.half) && o.half.every((h: number) => h > 0 && h < 100) && fin(o.yaw);
const label = (s: unknown) => typeof s === 'string' && s.length > 0 && s.length <= 100;
const inside = (crop: number[], x: number, z: number, pad = 0) => x >= crop[0] - pad && x <= crop[2] + pad && z >= crop[1] - pad && z <= crop[3] + pad;

/** Engine levels of the world's static scene (ground, decks), so a building never reuses one. */
export type UpperFloorsContext = { world: WorldState; sceneLevels: number[]; groundWorld: boolean; bodiesOn: (levels: Set<number>) => string[] };

/** Why this fact cannot be applied here (pure), or null. A building equal to the installed one is not an error (no-op). */
export function previewUpperFloorsV1(fact: unknown, cx: UpperFloorsContext): Diag | null {
  const f = fact as any;
  if (!f || f.version !== 'upper-floors/1' || (f.building === undefined) === (f.remove === undefined)) return { code: 'upper-floors.bad-fact', message: '{version:"upper-floors/1", building} or {version:"upper-floors/1", remove:id} required' };
  const installed = cx.world.upperFloorsV1?.buildings ?? {};
  if (f.remove !== undefined) {
    const b = installed[f.remove];
    if (!b) return { code: 'upper-floors.not-installed', message: `no upper floors installed for ${String(f.remove)}` };
    const on = cx.bodiesOn(new Set(b.levels.map((l) => l.id)));
    if (on.length) return { code: 'upper-floors.occupied', message: `still upstairs in ${b.id}: ${on.join(', ')} (wait until they come down)` };
    return null;
  }
  const b = f.building as UpperFloorsBuildingV1;
  if (!b || !ID.test(String(b.id)) || !label(b.label)) return { code: 'upper-floors.bad-building', message: 'building id (place-style) and label (1..100) required' };
  if (installed[b.id]) return hashOf(installed[b.id]) === hashOf(b) ? null : { code: 'upper-floors.exists', message: `${b.id} already has other upper floors; remove them first` };
  if (cx.groundWorld) return { code: 'upper-floors.ground-world', message: 'upper floors are for flat-campus worlds (a ground/1 world builds floors through its entity world)' };
  const crop = b.crop;
  if (!Array.isArray(crop) || crop.length !== 4 || !crop.every(fin) || !(crop[0] < crop[2] && crop[1] < crop[3]) || (crop[2] - crop[0]) * (crop[3] - crop[1]) > 10000) return { code: 'upper-floors.bad-crop', message: 'crop [minX,minZ,maxX,maxZ], at most 10 000 m²' };
  if (!Array.isArray(b.levels) || !b.levels.length || b.levels.length > 8) return { code: 'upper-floors.bad-levels', message: '1..8 levels' };
  const taken = new Set([0, ...cx.sceneLevels, ...Object.values(installed).flatMap((o) => o.levels.map((l) => l.id))]), mine = new Map<number, number>();
  for (const l of b.levels) {
    if (!Number.isInteger(l?.id) || l.id < 2 || l.id > 99 || taken.has(l.id) || mine.has(l.id)) return { code: 'upper-floors.bad-level', message: `level ${l?.id}: a new engine level id 2..99` };
    if (!fin(l.y) || l.y < 0.5 || l.y > 60 || !label(l.label) || !Number.isInteger(l.placeLevel) || l.placeLevel < 1 || l.placeLevel > 20) return { code: 'upper-floors.bad-level', message: `level ${l.id}: y 0.5..60, label, placeLevel 1..20` };
    mine.set(l.id, l.y);
  }
  const ids = new Set<string>(), okId = (id: unknown) => typeof id === 'string' && ID.test(id) && !ids.has(id) && !!ids.add(id);
  if (!Array.isArray(b.surfaces) || !b.surfaces.length || b.surfaces.length > 64) return { code: 'upper-floors.bad-surfaces', message: '1..64 floor surfaces' };
  for (const s of b.surfaces) {
    if (!okId(s?.id) || !mine.has(s.level) || s.y !== mine.get(s.level) || !obbOk(s.obb)) return { code: 'upper-floors.bad-surface', message: `surface ${s?.id}: id, one of the building's levels at its height, obb` };
    if (!inside(crop, s.obb.c[0], s.obb.c[1])) return { code: 'upper-floors.bad-surface', message: `surface ${s.id} lies outside the crop` };
  }
  if (!Array.isArray(b.solids) || b.solids.length > 512) return { code: 'upper-floors.bad-solids', message: 'at most 512 solids' };
  for (const o of b.solids) if (!okId(o?.id) || !obbOk(o.obb) || !fin(o.y0) || !fin(o.y1) || !(o.y0 < o.y1) || !inside(crop, o.obb.c[0], o.obb.c[1], 1)) return { code: 'upper-floors.bad-solid', message: `solid ${o?.id}: id, obb inside the crop, y0 < y1` };
  if (!Array.isArray(b.links) || !b.links.length || b.links.length > 16) return { code: 'upper-floors.bad-links', message: '1..16 stairs' };
  const reachable = new Set([0, ...cx.sceneLevels, ...mine.keys()]);
  for (const l of b.links) {
    if (!okId(l?.id) || l.kind !== 'stairs' || l.usable !== true || !fin(l.width) || l.width < 0.7 || l.width > 4 || !fin(l.heading)) return { code: 'upper-floors.bad-link', message: `stairs ${l?.id}: id, kind stairs, usable, width 0.7..4, heading` };
    for (const end of [l.from, l.to]) if (!end || !reachable.has(end.level) || !v2(end.p) || !fin(end.y) || !inside(crop, end.p[0], end.p[1], 2)) return { code: 'upper-floors.bad-link', message: `stairs ${l.id}: each end on a known level, near the building` };
    if (!mine.has(l.to.level) || !(l.to.y > l.from.y)) return { code: 'upper-floors.bad-link', message: `stairs ${l.id}: climbs from a lower level onto one of the building's levels` };
    if (!Array.isArray(l.path) || l.path.length < 2 || l.path.length > 64 || !l.path.every(v3)) return { code: 'upper-floors.bad-link', message: `stairs ${l.id}: 2..64 [x,y,z] step points` };
    if (l.approach !== undefined && !(typeof l.approach === 'object' && (l.approach.from === undefined || v2(l.approach.from)) && (l.approach.to === undefined || v2(l.approach.to)))) return { code: 'upper-floors.bad-link', message: `stairs ${l.id}: approach {from?,to?} points` };
  }
  if (!Array.isArray(b.regions) || b.regions.length > 32) return { code: 'upper-floors.bad-regions', message: 'at most 32 rooms' };
  for (const r of b.regions) {
    if (!r || !ID.test(String(r.id)) || cx.world.regions[r.id] || cx.world.entities[r.id] || !label(r.label) || !mine.has(r.level)) return { code: 'upper-floors.bad-region', message: `room ${r?.id}: a new id, label and one of the building's levels` };
    if (!Array.isArray(r.polygon) || r.polygon.length < 3 || r.polygon.length > 64 || !r.polygon.every((p) => v2(p) && inside(crop, p[0], p[1], 0.01))) return { code: 'upper-floors.bad-region', message: `room ${r.id}: 3..64 [x,z] points inside the crop` };
  }
  return null;
}

/** Apply a previewed fact to world state (pure state change; returns the region ids added and removed). */
export function applyUpperFloorsV1(world: WorldState, fact: UpperFloorsFactV1): { added: string[]; removed: string[]; levels: number[] } {
  const uf: UpperFloorsV1 = world.upperFloorsV1 ? structuredClone(world.upperFloorsV1) : { version: 'upper-floors/1', buildings: {} };
  const added: string[] = [], removed: string[] = [];
  let levels: number[] = [];
  if ('remove' in fact) {
    const b = uf.buildings[fact.remove]; if (!b) return { added, removed, levels };
    levels = b.levels.map((l) => l.id);
    for (const r of b.regions) if (world.regions[r.id]?.provenance?.note?.includes('upperFloorsV1')) { delete world.regions[r.id]; removed.push(r.id); }
    delete uf.buildings[fact.remove];
  } else {
    const b = structuredClone(fact.building);
    if (uf.buildings[b.id]) return { added, removed, levels };
    uf.buildings[b.id] = b; levels = b.levels.map((l) => l.id);
    const placeLevel = new Map(b.levels.map((l) => [l.id, l.placeLevel]));
    for (const r of b.regions) {
      world.regions[r.id] = { id: r.id, label: r.label, kind: 'place', level: r.level, placeLevel: placeLevel.get(r.level), polygon: r.polygon.map((v) => [v[0], v[1]] as [number, number]),
        provenance: { origin: 'design-edit', confidence: 'hypothetical', note: `${b.id} upper floor room (upperFloorsV1)` } };
      added.push(r.id);
    }
  }
  const sorted: Record<string, UpperFloorsBuildingV1> = {};
  for (const id of Object.keys(uf.buildings).sort()) sorted[id] = uf.buildings[id];
  uf.buildings = sorted;
  if (Object.keys(sorted).length) world.upperFloorsV1 = uf; else delete world.upperFloorsV1;
  const regions: WorldState['regions'] = {};
  for (const id of Object.keys(world.regions).sort()) regions[id] = world.regions[id];
  world.regions = regions;
  return { added, removed, levels };
}

/** The authored floor number (place data `level`) of an engine level: an upper floor's placeLevel, else the level itself. */
export function placeLevelOf(world: Pick<WorldState, 'upperFloorsV1'>, level: number): number {
  const uf = world.upperFloorsV1; if (!uf || level < 2) return level;
  for (const b of Object.values(uf.buildings)) for (const l of b.levels) if (l.id === level) return l.placeLevel;
  return level;
}
