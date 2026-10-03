// Static design edits are checkpoint data, never mutations of the shared campus.
import type { WorldState } from '../world/types.ts';
import type { Obstacle, SpatialScene } from './types.ts';

export function sceneForWorld(base: SpatialScene, world: WorldState): SpatialScene {
  const edits = world.obstacleEdits;
  if (!edits) return base;
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
  return { ...base, obstacles };
}
