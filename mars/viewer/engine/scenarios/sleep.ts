// Hypothetical ground camp/rest fixture; no historical placement claim.
import { emptyWorld, human, addAll, FIXTURE } from '../world/factory.ts';
import { add2, rot2, type Vec2 } from '../core/math.ts';
import type { SpatialScene } from '../spatial/types.ts';
import type { SleepParams } from '../activities/sleep.ts';

export function groundSleepFixture(centre: Vec2 = [0, 0], yaw = 0) {
  const scene: SpatialScene = { bounds: [-12, -12, 12, 12], levels: [{ id: 0, y: 0, label: 'Hypothetical ground' }],
    surfaces: [{ id: 'ground', level: 0, y: 0, obb: { c: [0, 0], half: [12, 12], yaw: 0 } }], obstacles: [], links: [] };
  const mat = { c: centre, half: [1.6, 0.7] as Vec2, yaw };
  const world = addAll(emptyWorld('ground-sleep', scene), human('sleeper', -5, -3), human('visitor', 6, 4));
  const polygon = ([[-mat.half[0], -mat.half[1]], [mat.half[0], -mat.half[1]], [mat.half[0], mat.half[1]], [-mat.half[0], mat.half[1]]] as Vec2[]).map(q => add2(centre, rot2(q, yaw)));
  world.regions.mat = { id: 'mat', label: 'Hypothetical ground sleeping mat', kind: 'work-area', polygon, level: 0, provenance: FIXTURE };
  const p: SleepParams = { actor: 'sleeper', mat: 'mat', duration: 3, returnTo: [-5, -3] };
  return { world, scene, p, anchor: add2(centre, rot2([0.35, 0], yaw)) };
}
