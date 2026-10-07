// Static design edits are checkpoint data, never mutations of the shared campus.
import { hashOf } from '../core/hash.ts';
import type { WorldState } from '../world/types.ts';
import type { Obstacle, SpatialScene, Surface } from './types.ts';

/**
 * nav/1 (logged rules fact `navV1`): extra level-0 walking ground and solid footprints (buildings, water) laid over
 * the source scene. World-state data, so every Spatial built for this world (live, restored, rehearsal) agrees.
 */
export type NavV1 = { version: 'nav/1'; ground: Surface[]; solids: Obstacle[] };

export function sceneForWorld(base: SpatialScene, world: WorldState): SpatialScene {
  const edits = world.obstacleEdits;
  let scene = base;
  if (edits) {
    const sourceIds = new Set(base.obstacles.map((o) => o.id));
    const obstacles: Obstacle[] = [];
    for (const o of base.obstacles) {
      const replacement = Object.hasOwn(edits, o.id) ? edits[o.id] : o;
      if (replacement) obstacles.push(replacement);
    }
    for (const id of Object.keys(edits).sort()) {
      const o = edits[id];
      if (!sourceIds.has(id) && o) obstacles.push(o);
    }
    scene = { ...base, obstacles };
  }
  const nav = world.navV1;
  if (!nav) return scene;
  // Ground widens the raster; solids join the static obstacles (rasterised once per base, StaticRaster).
  let [x0, z0, x1, z1] = scene.bounds;
  for (const s of nav.ground) {
    const hx = Math.abs(s.obb.half[0] * Math.cos(s.obb.yaw)) + Math.abs(s.obb.half[1] * Math.sin(s.obb.yaw)), hz = Math.abs(s.obb.half[0] * Math.sin(s.obb.yaw)) + Math.abs(s.obb.half[1] * Math.cos(s.obb.yaw));
    x0 = Math.min(x0, s.obb.c[0] - hx); z0 = Math.min(z0, s.obb.c[1] - hz); x1 = Math.max(x1, s.obb.c[0] + hx); z1 = Math.max(z1, s.obb.c[1] + hz);
  }
  return { ...scene, bounds: [Math.floor(x0), Math.floor(z0), Math.ceil(x1), Math.ceil(z1)], surfaces: [...scene.surfaces, ...nav.ground], obstacles: [...scene.obstacles, ...nav.solids] };
}

/** Identity of the static base a Spatial for `world` represents: the source id, folded with any edits (unchanged without them). */
export function worldBaseId(sourceId: string, world: WorldState): string {
  const edited = world.obstacleEdits ? hashOf({ source: sourceId, obstacleEdits: world.obstacleEdits }) : sourceId;
  return world.navV1 ? hashOf({ source: edited, navV1: world.navV1 }) : edited;
}
