// Hypothetical generic two-table cleanup; no historical staging or participants.
import { Runtime } from '../runtime/runtime.ts';
import { createRegistry, ENGINE_INVARIANTS } from '../api/registry.ts';
import { Spatial } from '../spatial/service.ts';
import type { SpatialScene } from '../spatial/types.ts';
import type { Entity } from '../world/types.ts';
import { rot2 } from '../core/math.ts';
import { addAll, emptyWorld, human, FIXTURE } from '../world/factory.ts';
import { itemEntity, placeOnSlot, surfaceSlot } from '../items/model.ts';
import {
  TABLE_CLEANUP_ACTIONS,
  type TidyTableParams,
} from '../activities/table-cleanup.ts';
export function tidyTableScene(): SpatialScene {
  return {
    bounds: [-10, -10, 10, 10],
    levels: [{ id: 0, y: 0, label: 'hypothetical communal ground' }],
    surfaces: [
      {
        id: 'floor',
        level: 0,
        y: 0,
        obb: { c: [0, 0], half: [10, 10], yaw: 0 },
      },
    ],
    obstacles: [],
    links: [],
  };
}
const props = [
  ['meal-bowl', 'bowl'],
  ['work-book', 'reading-book'],
  ['water-bowl', 'bowl'],
  ['second-book', 'reading-book'],
];
export function tidyTableBinding(count: 2 | 3 | 4 = 3): TidyTableParams {
  return {
    actor: 'tidier',
    transfers: props
      .slice(0, count)
      .map(([item], i) => ({
        item,
        from: `source-table#r1c${i + 1}`,
        to: `destination-table#r1c${i + 1}`,
      })),
  };
}
export function tidyTableWorld(yaw = 0, count: 2 | 3 | 4 = 3) {
  const fixture = (id: string, x: number): Entity => {
    const p = rot2([x, 0], yaw);
    return {
      id,
      def: 'table-6ft',
      kind: 'fixture',
      pose: { p: [p[0], 0, p[1]], yaw },
      support: { kind: 'ground' },
      provenance: FIXTURE,
    };
  };
  const person = rot2([-2, -3], yaw),
    w = addAll(
      emptyWorld('table-cleanup', tidyTableScene(), 'hypothetical-tidying'),
      fixture('source-table', -2),
      fixture('destination-table', 2),
      human('tidier', person[0], person[1]),
    );
  for (const [i, q] of tidyTableBinding(count).transfers.entries()) {
    const e = itemEntity(
        q.item,
        props[i][1],
        [0, 0, 0],
        yaw,
        i % 2 === 0
          ? {
              contents: {
                food: i === 0 ? 'hypothetical meal remainder' : 'water',
                fraction: 0.25,
              },
            }
          : {},
      ),
      s = surfaceSlot(w, q.from);
    if ('code' in s) throw Error(s.message);
    placeOnSlot(e, s, yaw);
    w.entities[e.id] = e;
  }
  return w;
}
export function tidyTableRuntime(yaw = 0, count: 2 | 3 | 4 = 3) {
  const common = createRegistry();
  return new Runtime(
    tidyTableWorld(yaw, count),
    createRegistry(TABLE_CLEANUP_ACTIONS.filter((a) => !common.has(a.verb))),
    { spatial: new Spatial(tidyTableScene()) },
    ENGINE_INVARIANTS,
  );
}
