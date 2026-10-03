// Hypothetical table readaloud fixture; anonymous roles/book, no reconstructed event.
import { Runtime } from '../runtime/runtime.ts';
import { createRegistry, ENGINE_INVARIANTS } from '../api/registry.ts';
import { Spatial } from '../spatial/service.ts';
import { READING_SCENE, readingRuntime } from './reading.ts';
import { human, FIXTURE } from '../world/factory.ts';
import { add2, rot2, heading, sub2, type Vec2 } from '../core/math.ts';
import type { SocialRegion } from '../social/slots.ts';
import {
  READING_CIRCLE_ACTIONS,
  type ReadingCircleParams,
} from '../activities/reading-circle.ts';
export const readingCircleScene = () => structuredClone(READING_SCENE);
export function readingCircleWorld(yaw = 0) {
  const w = readingRuntime(yaw).world;
  delete w.entities.visitor;
  const book = w.entities.book,
    focus: Vec2 = [book.pose.p[0], book.pose.p[2]];
  for (const [i, local, start] of [
    [1, [-1.45, -0.25], [-3, -3]],
    [2, [1.45, -0.25], [3, -3]],
    [3, [0, 1.15], [3, 3]],
  ] as const) {
    const p = rot2([...local], yaw),
      a = rot2([...start], yaw),
      angle = heading(sub2(focus, p)),
      centre = add2(p, rot2([0.3, 0], angle));
    const region: SocialRegion = {
      id: `reading-listener-${i}`,
      label: 'hypothetical listening place',
      kind: 'place',
      level: 0,
      provenance: FIXTURE,
      polygon: [
        [-0.4, -0.15],
        [0.4, -0.15],
        [0.4, 0.15],
        [-0.4, 0.15],
      ].map((q) => add2(centre, rot2(q as Vec2, angle))),
      layout: { focus, spacing: 1, rowGap: 0.7, kind: 'stand' },
    };
    w.regions[region.id] = region;
    w.entities[`listener-${i}`] = human(`listener-${i}`, a[0], a[1]);
  }
  return w;
}
export const readingCircleBinding = (): ReadingCircleParams => ({
  book: 'book',
  reader: 'reader',
  seat: 'reading-chair#seat',
  listeners: [
    { actor: 'listener-1', slot: 'reading-listener-1#r1c0' },
    { actor: 'listener-2', slot: 'reading-listener-2#r1c0' },
    { actor: 'listener-3', slot: 'reading-listener-3#r1c0', join: false },
  ],
  duration: 12,
  interval: 4,
  turnSeconds: 2,
  task: 'Hypothetical shared reading',
});
export function readingCircleRuntime(yaw = 0) {
  const common = createRegistry();
  return new Runtime(
    readingCircleWorld(yaw),
    createRegistry(READING_CIRCLE_ACTIONS.filter((a) => !common.has(a.verb))),
    { spatial: new Spatial(readingCircleScene()) },
    ENGINE_INVARIANTS,
  );
}
