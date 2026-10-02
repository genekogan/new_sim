// Entirely hypothetical pre-made gallery fixtures and anonymous people.
import { Runtime } from '../runtime/runtime.ts';
import { createRegistry, ENGINE_INVARIANTS } from '../api/registry.ts';
import { Spatial } from '../spatial/service.ts';
import type { SocialRegion } from '../social/slots.ts';
import { emptyWorld, human } from '../world/factory.ts';
import {
  artSharingWorld,
  artSharingScene,
  artSharingBinding,
} from './art-sharing.ts';
import {
  GALLERY_TOUR_ACTIONS,
  type GalleryTourParams,
} from '../activities/gallery-tour.ts';
export const galleryTourScene = artSharingScene;
const offsets = [
  [-5, 0],
  [0, 5],
  [5, 0],
] as const;
export function galleryTourWorld() {
  const w = emptyWorld(
    'gallery-tour',
    galleryTourScene(),
    'hypothetical-premade-gallery',
  );
  for (let i = 0; i < offsets.length; i++) {
    const source = artSharingWorld(true),
      prefix = `gallery${i + 1}-`,
      [dx, dz] = offsets[i];
    for (const e of Object.values(source.entities))
      if (!e.human) {
        const q = structuredClone(e);
        q.id = prefix + q.id;
        q.pose.p[0] += dx;
        q.pose.p[2] += dz;
        if (q.support?.kind === 'resting-on')
          q.support.on = prefix + q.support.on;
        if (q.equipment?.kind === 'drawing')
          q.equipment.config = {
            ...q.equipment.config,
            pencil: prefix + 'sketch-pencil',
            task: `Hypothetical pre-made gallery study ${i + 1}`,
            fixturePremade: true,
          };
        w.entities[q.id] = q;
      }
    for (const r of Object.values(source.regions)) {
      const q = structuredClone(r) as SocialRegion;
      q.id = prefix + q.id;
      q.label = `Hypothetical pre-made gallery ${i + 1} ${q.label}`;
      q.polygon = q.polygon.map(([x, z]) => [x + dx, z + dz]);
      if (q.layout?.focus)
        q.layout.focus = [q.layout.focus[0] + dx, q.layout.focus[1] + dz];
      w.regions[q.id] = q;
    }
  }
  for (const [id, x, z] of [
    ['sketcher', -5, -3],
    ['art-visitor1', -8, -3],
    ['art-visitor2', -2, -3],
    ['art-visitor3', 8, 4],
  ] as const)
    w.entities[id] = human(id, x, z);
  return w;
}
export function galleryTourBinding(): GalleryTourParams {
  return {
    stops: offsets.map(([x, z], i) => {
      const sharing = artSharingBinding(),
        prefix = `gallery${i + 1}-`;
      sharing.pad = prefix + sharing.pad;
      sharing.host.slot = prefix + sharing.host.slot;
      sharing.visitors = sharing.visitors.map((v) => ({
        ...v,
        slot: prefix + v.slot,
      }));
      sharing.duration = 8;
      sharing.turnSeconds = 2;
      return {
        sharing,
        departure: [
          { actor: 'sketcher', to: [x, z - 3] },
          { actor: 'art-visitor1', to: [x - 2.5, z - 3] },
          { actor: 'art-visitor2', to: [x + 2.5, z - 3] },
          { actor: 'art-visitor3', to: [x + 2.5, z + 3] },
        ],
      };
    }),
  };
}
export function galleryTourRuntime() {
  const common = createRegistry();
  return new Runtime(
    galleryTourWorld(),
    createRegistry(GALLERY_TOUR_ACTIONS.filter(a => !common.has(a.verb))),
    { spatial: new Spatial(galleryTourScene()) },
    ENGINE_INVARIANTS,
  );
}
