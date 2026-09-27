// Canonical Mars 2026 WorldState on top of the extracted campus scene, the
// hypothetical flagship inventory, and WorldHistory publishing helpers.
// Pure: callers pass the parsed scene file (Node: node.ts; browser: fetch CAMPUS_2026_URL).
import { FT, type Vec2 } from '../core/math.ts';
import { seedRng } from '../core/rng.ts';
import type { WorldHistory, Workspace } from '../history/store.ts';
import { def } from '../world/catalog.ts';
import { component, human } from '../world/factory.ts';
import type { Entity, Provenance, Region, WorldState } from '../world/types.ts';
import { WORLD_SCHEMA } from '../world/types.ts';
import { sceneFromFile } from './load.ts';
import type { CampusScene, CampusSceneFile } from './types.ts';

export const CAMPUS_ID = 'mars-2026';
export const FLAGSHIP_WORKSPACE = 'mars-2026-flagship';

export const PEOPLE_PROVENANCE: Provenance = {
  origin: 'canonical',
  confidence: 'hypothetical',
  note: 'generic context people placed on open ground; not specific attendees or recorded positions',
};
export const INVENTORY_PROVENANCE: Provenance = {
  origin: 'design-edit',
  confidence: 'hypothetical',
  note: 'flagship scenario inventory, not historical',
};

const bbox = (r: Region) => {
  const xs = r.polygon.map((p) => p[0]), zs = r.polygon.map((p) => p[1]);
  return { x0: Math.min(...xs), z0: Math.min(...zs), x1: Math.max(...xs), z1: Math.max(...zs) };
};
const region = (base: CampusScene, id: string) => {
  const r = base.regions.find((q) => q.id === id);
  if (!r) throw new Error(`campus 2026: region ${id} missing from scene file`);
  return r;
};

/** Six generic people standing in the staging area (2 rows × 3, 3 m apart). */
export function contextPeople(base: CampusScene): Entity[] {
  const b = bbox(region(base, 'staging-east'));
  const out: Entity[] = [];
  for (let row = 0; row < 2; row++)
    for (let k = 0; k < 3; k++) {
      const p: Vec2 = [b.x0 + 3 + k * 3, b.z0 + 3 + row * 3];
      const id = `person-${row * 3 + k + 1}`;
      out.push(human(id, p[0], p[1], { y: base.meta.groundY, yaw: 0, label: `generic person ${row * 3 + k + 1}`, provenance: PEOPLE_PROVENANCE }));
    }
  return out;
}

/**
 * Flagship inventory laid side by side on the ground (support 'ground', phase
 * 'stored') with crew-access gaps, so carry validation can pick any item:
 *   pile-uprights: 3 × 19 ft + 2 × 12 ft uprights lying flat, height along +x
 *   pile-beams:    8 × 12 ft + 4 × 9 ft beams on edge, along x
 *   pile-timber:   12 × 12 ft 2x4 + 6 × 4x8 plywood sheets flat
 */
export function flagshipInventory(base: CampusScene): Entity[] {
  const G = base.meta.groundY;
  const out: Entity[] = [];
  const add = (id: string, d: string, p: [number, number, number], yaw: number, pitch?: number) =>
    out.push(component(id, d, p, yaw, { pose: { p, yaw, pitch }, provenance: INVENTORY_PROVENANCE, label: `${def(d).label} (hypothetical)`, tags: ['flagship-inventory'] }));
  { // uprights: lying pose (yaw −π/2, pitch π/2) puts the height axis along +x, thickness vertical
    const b = bbox(region(base, 'pile-uprights'));
    const list = ['upright-19ft', 'upright-19ft', 'upright-19ft', 'upright-12ft', 'upright-12ft'];
    let z = b.z0 + 0.3;
    list.forEach((d, i) => {
      const [depth, h, t] = def(d).size;
      z += depth / 2;
      add(`u${i + 1}`, d, [b.x0 + (b.x1 - b.x0 - h) / 2, G + t / 2, z], -Math.PI / 2, Math.PI / 2);
      z += depth / 2 + 1.0;
    });
  }
  { // beams on edge along x, 0.5 m apart
    const b = bbox(region(base, 'pile-beams'));
    const list = [...Array(8).fill('beam-12ft'), ...Array(4).fill('beam-9ft')] as string[];
    list.forEach((d, i) => add(`b${i + 1}`, d, [(b.x0 + b.x1) / 2, G, b.z0 + 0.5 + i * 0.5], 0));
  }
  { // 2x4s along x at 0.3 m, plywood in 2 columns × 3 rows
    const b = bbox(region(base, 'pile-timber'));
    const L = 12 * FT;
    for (let i = 0; i < 12; i++) add(`t${i + 1}`, '2x4-12ft', [b.x0 + 0.5 + L / 2, G, b.z0 + 0.6 + i * 0.3], 0);
    const [pw, , pd] = def('plywood-4x8').size;
    let n = 0;
    for (let col = 0; col < 2; col++)
      for (let row = 0; row < 3; row++)
        add(`p${++n}`, 'plywood-4x8', [b.x0 + 0.5 + L + 1.0 + pw / 2 + col * (pw + 0.6), G, b.z0 + 0.5 + pd / 2 + row * (pd + 0.6)], 0);
  }
  return out;
}

export type Campus2026 = { base: CampusScene; world: WorldState };

/**
 * Canonical 2026 world: static campus (as `base`) + generic people + regions.
 * `flagshipInventory` (default true) adds the hypothetical piles; the canonical
 * workspace published by `publishCampus2026` never contains them.
 */
export function loadCampus2026(file: CampusSceneFile, opts: { flagshipInventory?: boolean } = {}): Campus2026 {
  const base = sceneFromFile(file);
  const world: WorldState = {
    schema: WORLD_SCHEMA,
    base: { campus: CAMPUS_ID, staticHash: file.contentHash },
    tick: 0,
    entities: {},
    regions: Object.fromEntries(base.regions.map((r) => [r.id, r])),
    env: { datetime: '2026-03-01T16:00', weather: { clouds: 0, rain: 0, wind: 0, dust: 0, wet: 0 } },
    inventory: 'finite',
    rng: seedRng(CAMPUS_ID),
  };
  const ents = [...contextPeople(base), ...(opts.flagshipInventory === false ? [] : flagshipInventory(base))];
  for (const e of ents) world.entities[e.id] = e;
  return { base, world };
}

/**
 * Publish protected canonical 'mars-2026' (no hypothetical inventory) and a
 * flagship fork whose first commit adds the inventory as a design edit.
 */
export function publishCampus2026(history: WorldHistory, file: CampusSceneFile): { canonical: Workspace; flagship: Workspace; base: CampusScene } {
  const { base, world } = loadCampus2026(file, { flagshipInventory: false });
  const canonical = history.publishCanonical(CAMPUS_ID, 'Mars 2026 (reconstructed campus, canonical)', world, 'CAD-derived reconstruction; see docs/engineering/CAMPUS_SCENE.md');
  const flagship = forkCampus2026(history, FLAGSHIP_WORKSPACE, 'Flagship build — hypothetical fork of 2026');
  const w = history.read(flagship.id);
  for (const e of flagshipInventory(base)) w.entities[e.id] = e;
  history.commit(flagship.id, w, { kind: 'design-edit', note: 'flagship scenario inventory (hypothetical, not historical)' }, 'flagship inventory');
  return { canonical, flagship: history.workspaces.get(flagship.id)!, base };
}

/** A new editable workspace forked from canonical 2026. */
export function forkCampus2026(history: WorldHistory, id: string, label: string): Workspace {
  return history.fork(CAMPUS_ID, id, label);
}
