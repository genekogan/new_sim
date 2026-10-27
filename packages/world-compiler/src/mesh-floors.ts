// Compile-time geometry supplements for shipped mesh assets. Content-addressed
// inputs cover pinned live defs as well as freshly placed catalogue revisions.
// Authored surfaces always win at their height; unsupported roofs/tables do not
// become floors just because the mesh has upward-facing triangles.
import type {Surface} from '@sim/generators';
import overlays from './mesh-floor-overlays.json' with {type: 'json'};
type Record = {box: number[]; fitAxis: number; surfaces: Surface[]};
const records = overlays.assets as unknown as {[hash: string]: Record};
export function meshFloors(asset: string, box: readonly number[], authored: readonly Surface[] = []): Surface[] {
  const entry = records[asset];
  // The viewer fits uniformly on the mesh's largest axis. Other box dimensions
  // can differ on older pinned definitions without changing that rendered fit.
  if (!entry || Math.abs(box[entry.fitAxis] - entry.box[entry.fitAxis]) > .002) return [];
  return entry.surfaces.filter(s => !authored.some(a => Math.abs(a.y - s.y) < .02)).map(s => ({...s, polygon: s.polygon.map(p => [...p] as [number, number])}));
}
