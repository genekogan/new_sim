// Hypothetical Drawing Klerb-inspired sharing. Equipment, anonymous people, staging
// and optional pre-made artwork are synthetic fixtures, not historical reconstruction.
import { Runtime } from '../runtime/runtime.ts';
import { createRegistry, ENGINE_INVARIANTS } from '../api/registry.ts';
import { Spatial } from '../spatial/service.ts';
import { drawingWorkWorld, drawingWorkScene } from './drawing-work.ts';
import { human, FIXTURE } from '../world/factory.ts';
import type { WorldState } from '../world/types.ts';
import { add2, heading, rot2, sub2, type Vec2 } from '../core/math.ts';
import type { SocialRegion } from '../social/slots.ts';
import {
  ART_SHARING_ACTIONS,
  type ArtSharingParams,
} from '../activities/art-sharing.ts';
export const artSharingScene = drawingWorkScene;
/** Install real region slots into an existing drawing world; this never creates marks. */
export function installArtSharingPlaces(w: WorldState) {
  const pad = w.entities['sketch-pad'],
    table = w.entities['sketch-table'];
  for (const [name, local] of [
    ['host', [0, -1.15]],
    ['left', [-1.45, -0.25]],
    ['right', [1.45, -0.25]],
    ['late', [0.1, 1.0]],
  ] as const) {
    const spot = add2(
        [table.pose.p[0], table.pose.p[2]],
        rot2([...local], table.pose.yaw),
      ),
      focus: Vec2 = [pad.pose.p[0], pad.pose.p[2]],
      yaw = heading(sub2(focus, spot)),
      centre = add2(spot, rot2([0.3, 0], yaw));
    const region: SocialRegion = {
      id: `art-${name}`,
      label: `hypothetical ${name} artwork viewing place`,
      kind: 'place',
      level: 0,
      provenance: FIXTURE,
      polygon: [
        [-0.4, -0.15],
        [0.4, -0.15],
        [0.4, 0.15],
        [-0.4, 0.15],
      ].map((p) => add2(centre, rot2(p as Vec2, yaw))),
      layout: { focus, spacing: 1, rowGap: 0.7, kind: 'stand' },
    };
    w.regions[region.id] = region;
  }
  return w;
}
/** Standalone pre-made fixture is explicit; pass false for a real drawing→sharing chain. */
export function artSharingWorld(premade = true) {
  const w = installArtSharingPlaces(drawingWorkWorld());
  for (const [id, x, z] of [
    ['art-visitor1', -3, -3],
    ['art-visitor2', 3, -3],
    ['art-visitor3', 3, 3],
  ] as const)
    w.entities[id] = human(id, x, z);
  if (premade)
    w.entities['sketch-pad'].equipment = {
      kind: 'drawing',
      config: {
        drawTicks: 160,
        status: 'completed',
        user: 'sketcher',
        task: 'Hypothetical pre-made shelter study',
        pencil: 'sketch-pencil',
        fixturePremade: true,
      },
    };
  return w;
}
export const artSharingBinding = (): ArtSharingParams => ({
  pad: 'sketch-pad',
  host: { actor: 'sketcher', slot: 'art-host#r1c0' },
  visitors: [
    { actor: 'art-visitor1', slot: 'art-left#r1c0' },
    { actor: 'art-visitor2', slot: 'art-right#r1c0' },
    { actor: 'art-visitor3', slot: 'art-late#r1c0', join: false },
  ],
  duration: 32,
  turnSeconds: 4,
});
export function artSharingRuntime(premade = true) {
  const common = createRegistry();
  return new Runtime(
    artSharingWorld(premade),
    createRegistry(ART_SHARING_ACTIONS.filter((a) => !common.has(a.verb))),
    { spatial: new Spatial(artSharingScene()) },
    ENGINE_INVARIANTS,
  );
}
